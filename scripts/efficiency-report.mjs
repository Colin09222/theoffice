// Where the floors' money went, read-only: by role, how much of each role's prompt was written to the cache against read from it, the manager's wakes,
// work-mode rounds that handed out nothing, runs that kept cutting their own history, whether each role's work finished and finished first time, the
// cost alerts sent, and the dearest tasks. See docs/EFFICIENCY.md.
//   docker compose exec -T theoffice node scripts/efficiency-report.mjs [days] </dev/null
// For the admin's terminal only: it prints dollar figures, and nothing here reaches a floor.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { loadConfig, loadModels } from '../server/config.js';

const days = Math.max(0.1, Number(process.argv[2]) || 3);
const db = new DatabaseSync(join(loadConfig(process.env).dataDir, 'office.db'), { readOnly: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const prices = loadModels().prices;
const since = Date.now() - days * 86400000;
const usd = (n) => `$${n.toFixed(2)}`;
const pad = (s, n) => String(s).padEnd(n);

const total = q('SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) usd FROM ledger WHERE created_at>=?', since)[0];
console.log(`Last ${days} days: ${total.n} ledger rows, ${usd(total.usd)}\n`);

console.log('By floor');
for (const r of q('SELECT f.number, f.name, COUNT(*) n, SUM(l.cost_usd) usd FROM ledger l LEFT JOIN floors f ON f.id=l.floor_id WHERE l.created_at>=? GROUP BY l.floor_id ORDER BY usd DESC', since)) console.log(`  ${pad(`${r.number} ${r.name}`, 34)} ${pad(r.n, 6)} ${usd(r.usd)}`);

// A call's prompt cost, less what its completion cost, says how much of the prompt was written to the cache (1.25 times the input price) and how much read from it.
console.log('\nBy role and model: calls, spent, completion, cache writes (est), cache reads (est), average prompt tokens, calls that missed the cache');
const rows = q("SELECT COALESCE(a.role,'-') role, l.model, l.kind, l.prompt_tokens p, l.completion_tokens c, l.cost_usd usd FROM ledger l LEFT JOIN agents a ON a.id=l.agent_id WHERE l.created_at>=?", since);
const by = new Map();
for (const r of rows) {
  const key = r.kind === 'model' ? `${r.role} ${r.model}` : `${r.role} [${r.kind}]`;
  const a = by.get(key) || { n: 0, usd: 0, comp: 0, write: 0, read: 0, p: 0, miss: 0, missUsd: 0 };
  a.n++; a.usd += r.usd; a.p += r.p;
  const pr = r.kind === 'model' ? prices[r.model] : null;
  if (pr && r.p > 0 && pr.cacheRead !== undefined) {
    const comp = r.c * pr.completion / 1e6, prompt = Math.max(0, r.usd - comp);
    const share = Math.max(0, Math.min(1, (prompt / r.p * 1e6 - pr.cacheRead) / (1.25 * pr.prompt - pr.cacheRead)));
    a.comp += comp; a.write += share * r.p * 1.25 * pr.prompt / 1e6; a.read += (1 - share) * r.p * pr.cacheRead / 1e6;
    if (share > 0.5) { a.miss++; a.missUsd += prompt; }
  }
  by.set(key, a);
}
for (const [k, a] of [...by].sort((x, y) => y[1].usd - x[1].usd).filter(([, a]) => a.usd >= 0.5)) console.log(`  ${pad(k, 44)} ${pad(a.n, 6)} ${pad(usd(a.usd), 9)} ${pad(usd(a.comp), 8)} ${pad(usd(a.write), 8)} ${pad(usd(a.read), 8)} ${pad(Math.round(a.p / a.n), 8)} ${a.miss} (${usd(a.missUsd)})`);

console.log('\nWork-mode rounds: floor, day, rounds, of which handed out nothing');
for (const r of q("SELECT f.number, m.day, COUNT(*) n, SUM(m.tasks_done=0 AND m.tasks_failed=0 AND m.published='[]' AND m.status='done') quiet FROM mode_runs m JOIN floors f ON f.id=m.floor_id WHERE m.started_at>=? GROUP BY m.floor_id, m.day ORDER BY m.day", since)) console.log(`  floor ${pad(r.number, 4)} ${r.day}  ${pad(r.n, 4)} ${r.quiet}`);
for (const r of q("SELECT f.number, w.mode, w.idle_streak, w.next_at FROM work_modes w JOIN floors f ON f.id=w.floor_id WHERE w.mode!='ask'")) console.log(`  floor ${r.number}: ${r.mode}, ${r.idle_streak} quiet in a row, next look ${r.next_at ? new Date(r.next_at).toISOString().slice(0, 16) : 'now'}`);

console.log('\nManager, by floor: calls, spent');
for (const r of q("SELECT f.number, COUNT(*) n, SUM(l.cost_usd) usd FROM ledger l JOIN agents a ON a.id=l.agent_id JOIN floors f ON f.id=l.floor_id WHERE a.role='manager' AND l.kind='model' AND l.created_at>=? GROUP BY l.floor_id ORDER BY usd DESC", since)) console.log(`  floor ${pad(r.number, 4)} ${pad(r.n, 6)} ${usd(r.usd)}`);

console.log('\nTasks: by how they ended');
for (const r of q('SELECT status, COUNT(*) n, SUM(cost_usd) usd, SUM(revisions) rev FROM tasks WHERE updated_at>=? GROUP BY status ORDER BY usd DESC', since)) console.log(`  ${pad(r.status, 10)} ${pad(r.n, 5)} ${pad(usd(r.usd), 9)} sent back ${r.rev} times`);
const cut = q("SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) usd FROM tasks WHERE updated_at>=? AND session_id='' AND transcript LIKE '%Earlier steps of this job were dropped%'", since)[0];
console.log(`  ${cut.n} tasks without a computer had their oldest steps dropped at least once (${usd(cut.usd)})`);

const out = q("SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) usd FROM tasks WHERE updated_at>=? AND status='failed' AND result LIKE 'Ran out of steps%'", since)[0];
const searched = q("SELECT COUNT(*) n FROM tasks WHERE updated_at>=? AND session_id='' AND transcript LIKE '%\"search_files\"%'", since)[0];
console.log(`  ${out.n} tasks ran out of steps (${usd(out.usd)}); ${searched.n} tasks without a computer used search_files`);

// Did the work finish, and first time? A floor that is cheap because half its jobs fail is not cheap.
console.log('\nBy floor and role: tasks, done, failed, cancelled after money was spent, spent, per finished task, finished without being sent back');
for (const r of q("SELECT f.number, COALESCE(a.role,'-') role, COUNT(*) n, SUM(t.status='done') done, SUM(t.status='failed') failed, SUM(t.status='cancelled' AND t.cost_usd>0) dropped, SUM(t.cost_usd) usd, SUM(t.status='done' AND t.revisions=0) first FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id JOIN floors f ON f.id=t.floor_id WHERE t.updated_at>=? AND f.filler=0 GROUP BY t.floor_id, role HAVING usd>0 ORDER BY f.number, usd DESC", since)) console.log(`  floor ${pad(r.number, 4)} ${pad(r.role, 11)} ${pad(r.n, 4)} ${pad(r.done, 4)} ${pad(r.failed, 3)} ${pad(r.dropped, 3)} ${pad(usd(r.usd), 9)} ${pad(r.done ? usd(r.usd / r.done) : '-', 8)} ${r.done ? `${r.first}/${r.done}` : '-'}`);

// The cost alert (server/costalert.js): what the owner's log was sent.
console.log('\nCost alerts sent: kind, how many');
for (const r of q('SELECT kind, COUNT(*) n FROM cost_alerts WHERE created_at>=? GROUP BY kind ORDER BY n DESC', since)) console.log(`  ${pad(r.kind, 10)} ${r.n}`);

console.log('\nThe dearest tasks: id, floor, role, how it ended, sent back, cost, biggest computer conversation (tokens), title');
for (const t of q("SELECT t.id, f.number, COALESCE(a.role,'-') role, t.status, t.revisions rev, t.cost_usd usd, t.session_ctx ctx, t.title FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id LEFT JOIN floors f ON f.id=t.floor_id WHERE t.updated_at>=? ORDER BY t.cost_usd DESC LIMIT 15", since)) console.log(`  #${pad(t.id, 6)} ${pad(t.number, 4)} ${pad(t.role, 11)} ${pad(t.status, 10)} ${t.rev}  ${pad(usd(t.usd), 8)} ${pad(t.ctx || '', 8)} ${String(t.title).slice(0, 60)}`);
