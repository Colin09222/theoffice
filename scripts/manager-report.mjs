// How each floor handled what its boss said, read-only: how fast the manager answered and acted, how many jobs a message became and how many of those were
// cancelled before anyone started, small jobs and what they cost against their estimate, self-checks handed in, send-backs, questions put to the boss, and how
// many lines the boss got in the chat. See docs/MANAGER.md.
//   docker compose exec -T theoffice node scripts/manager-report.mjs [days] </dev/null
// For the admin's terminal only: it prints dollar figures, and counts only, never what anyone said.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { loadConfig } from '../server/config.js';

const days = Math.max(0.1, Number(process.argv[2]) || 3);
const db = new DatabaseSync(join(loadConfig(process.env).dataDir, 'office.db'), { readOnly: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);
// A building that has never used a feature has no table for it yet.
const maybe = (sql, ...a) => { try { return q(sql, ...a); } catch (e) { if (/no such table/.test(e.message)) return []; throw e; } };
const since = Date.now() - days * 86400000;
const usd = (n) => `$${(n || 0).toFixed(2)}`;
const at = (list, p) => { const s = [...list].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const secs = (ms) => (ms === null ? '-' : ms < 90000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
const words = (s) => String(s).trim().split(/\s+/).length;

console.log(`How the floors handled their bosses, last ${days} days\n`);
const floors = q("SELECT f.id, f.number, f.name FROM floors f WHERE f.filler=0 AND EXISTS (SELECT 1 FROM messages m WHERE m.floor_id=f.id AND m.role='boss' AND m.created_at>=?) ORDER BY f.number", since);
if (!floors.length) console.log('No boss said anything in that time.');
for (const f of floors) {
  const msgs = q('SELECT id, role, text, created_at t FROM messages WHERE floor_id=? AND created_at>=? ORDER BY id', f.id, since);
  const tasks = q("SELECT t.id, t.status, t.cost_usd c, t.est_usd e, t.size, t.checks, t.selfcheck, t.revisions r, t.transcript!='' started, t.created_at made, COALESCE(a.role,'-') role FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND t.created_at>=? ORDER BY t.id", f.id, since);
  const boss = msgs.filter((m) => m.role === 'boss'), mgr = msgs.filter((m) => m.role === 'manager'), office = msgs.filter((m) => m.role === 'office');
  const reply = [], first = []; let led = 0;
  boss.forEach((b, i) => {
    const next = boss[i + 1]?.t ?? Infinity;
    const r = mgr.find((m) => m.id > b.id); if (r) reply.push(r.t - b.t);
    const made = tasks.filter((t) => t.made >= b.t && t.made < next);
    if (made.length) { led++; first.push(made[0].made - b.t); }
  });
  const spent = q("SELECT COALESCE(SUM(cost_usd),0) usd FROM ledger WHERE floor_id=? AND created_at>=? AND kind!='domain'", f.id, since)[0].usd;
  const own = q("SELECT COUNT(*) n, COALESCE(SUM(l.cost_usd),0) usd FROM ledger l JOIN agents a ON a.id=l.agent_id WHERE l.floor_id=? AND l.created_at>=? AND a.role='manager' AND l.kind='model'", f.id, since)[0];
  const cancelled = tasks.filter((t) => t.status === 'cancelled');
  const small = tasks.filter((t) => t.size === 'small'), smallDone = small.filter((t) => t.status === 'done');
  const withChecks = tasks.filter((t) => t.checks && t.role !== 'tester' && ['done', 'review'].includes(t.status));
  const checked = withChecks.filter((t) => t.selfcheck);
  const failedLines = checked.filter((t) => /"verdict":"(fail|unchecked)"/.test(t.selfcheck)).length;
  const estimated = tasks.filter((t) => t.e > 0 && t.status === 'done');
  const over = estimated.filter((t) => t.c > 2 * t.e && t.c >= 1);
  const amended = q("SELECT COUNT(*) n FROM events WHERE floor_id=? AND type='feed' AND created_at>=? AND data LIKE '%changed the brief for%'", f.id, since)[0].n;
  const asked = q("SELECT COUNT(*) n FROM questions q JOIN agents a ON a.id=q.agent_id WHERE q.floor_id=? AND q.created_at>=? AND a.role='manager'", f.id, since)[0].n;
  const rounds = maybe("SELECT COUNT(*) n, COALESCE(SUM(tasks_done=0 AND tasks_failed=0 AND published='[]' AND status='done'),0) quiet FROM mode_runs WHERE floor_id=? AND started_at>=?", f.id, since)[0] || { n: 0, quiet: 0 };
  const testers = tasks.filter((t) => t.role === 'tester');
  console.log(`Floor ${f.number} ${f.name}`);
  console.log(`  boss messages ${boss.length}; AI spent ${usd(spent)} (${usd(boss.length ? spent / boss.length : 0)} a message); the manager's own calls ${own.n}, ${usd(own.usd)}`);
  console.log(`  first reply: median ${secs(at(reply, 0.5))}, nine in ten within ${secs(at(reply, 0.9))}; messages that led to tasks ${led}, first task after median ${secs(at(first, 0.5))}`);
  console.log(`  tasks made ${tasks.length}: done ${tasks.filter((t) => t.status === 'done').length}, failed ${tasks.filter((t) => t.status === 'failed').length}, cancelled ${cancelled.length} (${cancelled.filter((t) => !t.started && t.c === 0).length} before anyone started, ${usd(cancelled.reduce((s, t) => s + t.c, 0))} on the rest); waiting jobs changed in place ${amended}`);
  console.log(`  small jobs ${small.length}: done ${smallDone.length}, ${usd(smallDone.reduce((s, t) => s + t.c, 0))} against an estimate of ${usd(smallDone.reduce((s, t) => s + t.e, 0))}; Tester jobs ${testers.length}, ${usd(testers.reduce((s, t) => s + t.c, 0))}`);
  console.log(`  estimate against cost, finished jobs: ${usd(estimated.reduce((s, t) => s + t.e, 0))} estimated, ${usd(estimated.reduce((s, t) => s + t.c, 0))} spent over ${estimated.length} jobs; ${over.length} cost more than twice their estimate${over.length ? ` (${over.slice(0, 6).map((t) => `#${t.id}`).join(', ')})` : ''}`);
  console.log(`  self-check: ${checked.length} of ${withChecks.length} jobs with acceptance checks came back with one; ${failedLines} of those owned up to a FAIL or a NOT CHECKED; sent back ${tasks.filter((t) => t.r > 0).length} tasks, ${tasks.reduce((s, t) => s + t.r, 0)} times`);
  console.log(`  questions the manager put to the boss ${asked}; work-mode rounds ${rounds.n}, ${rounds.quiet} handed out nothing, "On our own" lines ${office.filter((m) => m.text.startsWith('**On our own:**')).length}`);
  console.log(`  lines the boss got: ${mgr.length} from the manager (median ${at(mgr.map((m) => words(m.text)), 0.5) ?? 0} words, one in ten over ${at(mgr.map((m) => words(m.text)), 0.9) ?? 0}), ${office.length} office notices; ${boss.length ? ((mgr.length + office.length) / boss.length).toFixed(1) : '0'} lines for each thing the boss said\n`);
}
