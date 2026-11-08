// Work modes, end to end in mock mode: a floor set to Nonstop does three jobs in a row on its own, with the gap between jobs shortened,
// and prints each job's start, finish, gap, tasks and the manager's digest, plus what ran on which model. No key, no spend.
//   AI_MODE=mock AUTOPILOT_GAP_MIN=0.05 node scripts/proof-modes.mjs
import { openDb, get, all } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { createApp } from '../server/app.js';
import { issueCode } from '../server/auth.js';

const JOBS = Number(process.env.JOBS || 3);
const gapMin = Number(process.env.AUTOPILOT_GAP_MIN || 0.05);
const db = openDb(':memory:');
const cfg = loadConfig({ AI_MODE: 'mock', MOCK_DELAY_MS: '20', AUTOPILOT_GAP_MIN: String(gapMin), MODES_TICK_MS: '100', PEOPLE_TALK: '0', ADMIN_PASSWORD: 'proof proof proof' });
const app = createApp({ db, cfg, models: loadModels(), log: () => {} });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}/theoffice`;
app.engine.start();
let cookie = '', csrf = '';
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${app.server.address().port}`, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-office-csrf': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie?.() || []; if (set.length) cookie = set.map((s) => s.split(';')[0]).join('; ');
  return { status: r.status, data: await r.json().catch(() => null) };
};
const claimed = await call('POST', '/api/claim', { code: issueCode(db, null), name: 'Nonstop Noodles', tagline: 'Never closes', bossName: 'Colon', colors: { primary: '#2f6f62', accent: '#f4c95d' }, look: {} });
csrf = claimed.data.csrf; const slug = claimed.data.slug;
const floor = get(db, 'SELECT * FROM floors WHERE slug=?', slug);
const t0 = Date.now();
const set = await call('POST', `/api/floors/${slug}/work-mode`, { mode: 'nonstop', goal: '[build] Get Nonstop Noodles known' });
console.log(`set ${set.status}: sign "${set.data.workMode.label}", gap ${gapMin} min (${Math.round(gapMin * 60)} s), goal "${set.data.workMode.goal}"`);

const s = (ms) => `${((ms - t0) / 1000).toFixed(1)}s`;
const deadline = Date.now() + 120000;
while (all(db, "SELECT id FROM mode_runs WHERE floor_id=? AND status!='running'", floor.id).length < JOBS) {
  if (Date.now() > deadline) { console.log('TIMED OUT'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 100));
}
await call('POST', `/api/floors/${slug}/work-mode`, { mode: 'ask' });
const runs = all(db, "SELECT * FROM mode_runs WHERE floor_id=? AND status!='running' ORDER BY id", floor.id).slice(0, JOBS);
let ok = runs.length === JOBS;
runs.forEach((r, i) => {
  const gap = i ? (r.started_at - runs[i - 1].finished_at) / 1000 : 0;
  if (i && gap < gapMin * 60 - 0.2) ok = false;
  console.log(`job ${i + 1}: ${r.status}, started ${s(r.started_at)}, finished ${s(r.finished_at)}${i ? `, gap ${gap.toFixed(1)}s` : ''}, tasks done ${r.tasks_done}, failed ${r.tasks_failed}`);
});
const digests = all(db, "SELECT text FROM messages WHERE floor_id=? AND role='office' AND text LIKE '**On our own:**%' ORDER BY id", floor.id).map((m) => m.text);
digests.slice(0, JOBS).forEach((d, i) => console.log(`digest ${i + 1}: ${d.slice(0, 220)}`));
const models = all(db, "SELECT a.role, l.model, COUNT(*) n FROM ledger l JOIN agents a ON a.id=l.agent_id WHERE l.floor_id=? GROUP BY a.role, l.model ORDER BY a.role", floor.id);
console.log(`models: ${models.map((m) => `${m.role} ${m.model} x${m.n}`).join(', ')}`);
const plan = get(db, 'SELECT goal, backlog FROM work_modes WHERE floor_id=?', floor.id);
console.log(`plan: goal "${plan.goal}", next up ${plan.backlog}`);
const autoTasks = get(db, 'SELECT COUNT(*) n, SUM(auto) a FROM tasks WHERE floor_id=?', floor.id);
console.log(`tasks: ${autoTasks.n}, all the team's own: ${autoTasks.a === autoTasks.n}`);
if (models.some((m) => m.model !== 'claude-sonnet-5-5')) ok = false;
if (digests.length < JOBS || digests.some((d) => /\$\d|budget/i.test(d))) ok = false;
console.log(ok ? `OK: ${JOBS} jobs in a row on their own, each at least the gap apart, all on Sonnet, a digest after each` : 'NOT OK');
await app.close(); db.close();
process.exit(ok ? 0 : 1);
