// Real jobs through the real app, with a boss who types the way people type. Spends real money.
// Keys come from the environment and go nowhere else. A watcher pauses the building when the ledgers of every run under PROOF_BASE reach PROOF_ANTHROPIC_MAX or PROOF_OPENROUTER_MAX.
// Usage: node scripts/proof-workers.mjs <scenario> [<scenario> ...]     Scenarios given together run at once, on one server, as separate floors.
//   plan-* scenarios run the real manager and no staff: the cheap way to see how a vague request is understood.
//   `again <floor-slug> "<what the boss says>"` follows up on a floor from an earlier run in the same PROOF_RUN.
//   `spend` prints what every run has cost.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { openDb, get, all, run } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { createApp } from '../server/app.js';
import { issueCode, createSession, COOKIE, OWNER_MAX_AGE } from '../server/auth.js';
import { appLabel } from '../server/apps.js';
import { launch, sleep } from '../test/browser/cdp.mjs';

const BASE = process.env.PROOF_BASE || '/tmp/workers-proof';
const RUN = process.env.PROOF_RUN || 'run';
const DIR = join(BASE, RUN);
const OUT = join(DIR, 'out');
const PORT = Number(process.env.PROOF_PORT || 18097);
const ANTHROPIC_MAX = Number(process.env.PROOF_ANTHROPIC_MAX || 11);
const OPENROUTER_MAX = Number(process.env.PROOF_OPENROUTER_MAX || 0.85);
const ORIGIN = `http://localhost:${PORT}`;
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Every run's ledger counts, not just this process's, so a stack of short runs can't overshoot.
function spentEverywhere() {
  const total = { anthropic: 0, openrouter: 0 };
  if (!existsSync(BASE)) return total;
  for (const name of readdirSync(BASE)) {
    const file = join(BASE, name, 'data', 'office.db');
    if (!existsSync(file)) continue;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      total.anthropic += db.prepare("SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE kind NOT IN ('domain','image','review')").get().n;
      total.openrouter += db.prepare("SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE kind IN ('image','review')").get().n;
    } finally { db.close(); }
  }
  return total;
}

async function makeApp({ dry }) {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENROUTER_API_KEY) throw new Error('keys are not set');
  const cfg = loadConfig({
    AI_MODE: 'live', COMPUTER_ENABLED: '1', DATA_DIR: join(DIR, 'data'), ADMIN_PASSWORD: 'proof-only', APPS_BASE_DOMAIN: `apps.localhost:${PORT}`, APPS_SCHEME: 'http', PUBLIC_ORIGIN: ORIGIN,
    FLOOR_DAILY_USD: '8', GLOBAL_DAILY_USD: String(ANTHROPIC_MAX + OPENROUTER_MAX + 1), TASK_MAX_USD: process.env.PROOF_TASK_MAX || '2.5', SESSION_MAX_USD: process.env.PROOF_SESSION_MAX || '1.8', SESSION_MAX_STEPS: '40', MAX_SESSIONS_GLOBAL: '4',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });
  const db = openDb(cfg.dataDir);
  const app = createApp({ db, cfg, models: loadModels(), log: (level, msg, x) => { if (level !== 'info') log(level, msg, JSON.stringify(x ?? {})); } });
  if (dry) {
    // The manager is real. Staff don't run: their tasks are parked, so what's measured is the understanding and the plan.
    const park = async (floorId, agentId, taskId) => { run(db, "UPDATE tasks SET status='blocked', result='(dry run: staff did not work)' WHERE id=?", taskId); };
    app.engine.runStaff = park;
    if (app.engine.computer) app.engine.computer.run = park;
  }
  await new Promise((r) => app.server.listen(PORT, '127.0.0.1', r));
  app.engine.start();
  const watch = setInterval(() => {
    const s = spentEverywhere();
    if ((s.anthropic >= ANTHROPIC_MAX || s.openrouter >= OPENROUTER_MAX) && !app.engine.globalPaused()) { log('PROOF LIMIT REACHED, pausing the building', JSON.stringify(s)); app.engine.setGlobalPause(true); }
  }, 3000);
  watch.unref();
  return { db, cfg, app };
}

class Boss {
  constructor() { this.cookies = {}; this.csrf = null; }
  async call(method, path, body) {
    const headers = { origin: ORIGIN };
    if (Object.keys(this.cookies).length) headers.cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.csrf) headers['x-office-csrf'] = this.csrf;
    const r = await fetch(`${ORIGIN}/theoffice${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); }
    const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
    if (r.status >= 400) log('HTTP', r.status, path, JSON.stringify(d).slice(0, 200));
    return { status: r.status, data: d };
  }
  async claim(db, name, bossName) { const r = await this.call('POST', '/api/claim', { code: issueCode(db), name, tagline: '', bossName }); this.csrf = r.data.csrf; this.slug = r.data.slug; return r.data; }
  say(text) { return this.call('POST', `/api/floors/${this.slug}/chat`, { text }); }
  control(action, text) { return this.call('POST', `/api/floors/${this.slug}/control`, { action, ...(text ? { text } : {}) }); }
  state() { return this.call('GET', `/api/floors/${this.slug}`).then((r) => r.data); }
  answer(id, text) { return this.call('POST', `/api/floors/${this.slug}/questions/${id}/answer`, { text }); }
}

const floorCost = (db, id) => Number(get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND kind!='domain'", id).n.toFixed(4));
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// What a person would actually read and open afterwards, in files.
async function dump(db, floor, tag, { shots = true } = {}) {
  const out = join(OUT, floor.slug);
  mkdirSync(out, { recursive: true });
  for (const r of all(db, 'SELECT project,path,content FROM published_files WHERE floor_id=?', floor.id)) {
    const p = join(out, 'published', r.project, r.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof r.content === 'string' ? r.content : Buffer.from(r.content));
  }
  for (const r of all(db, "SELECT path,content FROM files WHERE floor_id=? AND (path LIKE '%/notes/%' OR path LIKE '%TEST-REPORT%')", floor.id)) {
    const p = join(out, 'drive', r.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof r.content === 'string' ? r.content : Buffer.from(r.content));
  }
  writeFileSync(join(out, 'chat.md'), all(db, 'SELECT role,text FROM messages WHERE floor_id=? ORDER BY id', floor.id).map((m) => `### ${m.role} (${words(m.text)} words)\n${m.text}`).join('\n\n'));
  const tasks = all(db, 'SELECT t.id,t.title,t.status,t.revisions,t.lane,ROUND(t.cost_usd,3) usd,a.role,t.brief,t.result,t.project,t.depends_on FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? ORDER BY t.id', floor.id);
  writeFileSync(join(out, 'tasks.md'), tasks.map((t) => `### #${t.id} ${t.role} [${t.status}] $${t.usd} rev${t.revisions} lane=${t.lane} deps=${t.depends_on} project=${t.project}\nTITLE: ${t.title}\nBRIEF: ${t.brief}\nRESULT: ${t.result}`).join('\n\n'));
  const ledger = all(db, 'SELECT a.role,l.kind,l.model,COUNT(*) n,ROUND(SUM(l.cost_usd),4) usd,SUM(l.prompt_tokens) pt,SUM(l.completion_tokens) ct FROM ledger l LEFT JOIN agents a ON a.id=l.agent_id WHERE l.floor_id=? GROUP BY a.role,l.kind,l.model ORDER BY usd DESC', floor.id);
  writeFileSync(join(out, 'ledger.json'), JSON.stringify(ledger, null, 1));
  const projects = all(db, 'SELECT slug,title,kind,published_at,launch_check,design_review,launch_report FROM projects WHERE floor_id=?', floor.id);
  const summary = { tag, floor: floor.slug, cost: floorCost(db, floor.id), tasks: tasks.map((t) => ({ id: t.id, role: t.role, status: t.status, usd: t.usd, rev: t.revisions, project: t.project, title: t.title })), projects: projects.map((p) => ({ slug: p.slug, kind: p.kind, live: !!p.published_at, url: `http://${appLabel(db, floor, p.slug)}.apps.localhost:${PORT}/`, review: p.design_review ? JSON.parse(p.design_review).verdict : null, reported: !!p.launch_report })) };
  writeFileSync(join(out, `summary-${tag}.json`), JSON.stringify(summary, null, 1));
  if (shots) {
    let b;
    try {
      b = await launch();
      mkdirSync(join(out, 'shots'), { recursive: true });
      for (const p of summary.projects.filter((x) => x.live)) {
        for (const [view, opts] of [['desktop', { width: 1280, height: 800 }], ['phone', { mobile: true }]]) {
          const pg = await b.newPage(opts);
          try {
            await pg.goto(p.url); await sleep(2500);
            await pg.shot(join(out, 'shots', `${tag}-${p.slug}-${view}.jpg`));
            const errs = pg.errors.filter((e) => !/_data\/v1|favicon/.test(e));
            if (errs.length) log(floor.slug, p.slug, view, 'console errors:', errs.join(' | ').slice(0, 300));
          } catch (e) { log('shot failed', p.slug, view, e.message); }
        }
      }
    } catch (e) { log('browser failed', e.message); } finally { b?.close(); }
  }
  return summary;
}

// The boss in these scripts answers what they're asked in as few words as a person would. A step is a line said, or a control pressed part-way through the work.
const SCENARIOS = {
  // ---- how a vague request is understood: real manager, no staff ----
  'plan-game-vague': { plan: true, company: 'Snack Attack', boss: 'Dee', steps: ['make me a game', 'idk u pick'] },
  'plan-game-named': { plan: true, company: 'Doggo Inc', boss: 'Kel', steps: ['i want a game like flappy bird but w my dog lol', 'just do it'] },
  'plan-game-kids': { plan: true, company: 'Tablet Time', boss: 'Rae', steps: ['can u make somthing fun for my kids to play on the ipad', 'theyre 6 and 8. go'] },
  'plan-web-vague': { plan: true, company: 'Rosa Sweets', boss: 'Tony', steps: ['need a website for my moms bakery', 'its called rosas. in queens. she does cakes mostly'] },
  'plan-web-band': { plan: true, company: 'Wet Socks', boss: 'Jo', steps: ['site for my band?? we r called the wet socks', 'just make something cool'] },
  'plan-biz-vague': { plan: true, company: 'Big Plans', boss: 'Mo', steps: ['i wanna make money online, ideas?', 'the second one. go'] },
  'plan-biz-dog': { plan: true, company: 'Good Boy', boss: 'Ana', steps: ['dog walking biz in austin, can u figure it out', 'sure'] },
  'plan-hi': { plan: true, company: 'Just Saying', boss: 'Lu', steps: ['hi'] },
  // ---- whole jobs ----
  'game-vague': { company: 'Snack Attack', boss: 'Dee', steps: ['make me a game. idk something fun, not too hard', 'u pick'] },
  'web-vague': { company: 'Rosa Sweets', boss: 'Tony', steps: ['need a website for my moms bakery', 'its called rosas. in queens. she does cakes mostly, birthday and quinceañera stuff. no prices yet, ppl should just call or ask. i dont have her number on me so leave it out for now'] },
  'biz-vague': { company: 'Good Boy', boss: 'Ana', steps: ['dog walking biz in austin, can u figure it out', 'sure go'] },
};

async function runOne(db, app, name, sc) {
  const boss = new Boss();
  const made = await boss.claim(db, sc.company, sc.boss);
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', made.slug);
  log('FLOOR', name, floor.slug);
  app.bus.subscribe(floor.id, { ip: 'proof', send: (ev) => {
    if (ev.type === 'feed') log(`[${floor.slug}]`, ev.data.name, ev.data.text);
    if (ev.type === 'message' && ev.data.role !== 'boss') log(`[${floor.slug}] SAYS`, `[${ev.data.role}] (${words(ev.data.text)}w)`, String(ev.data.text).slice(0, 1200));
  }, close() {} });
  const turns = [];
  for (const step of sc.steps) {
    const text = typeof step === 'string' ? step : step.say;
    const before = await boss.state();
    log(`[${floor.slug}] BOSS:`, text);
    const c0 = floorCost(db, floor.id);
    await boss.say(text);
    const s = await waitQuiet(db, app, boss, floor, sc.plan ? 150000 : (sc.minutes || 40) * 60000, sc.plan);
    const fresh = s.messages.slice(before.messages.length).filter((m) => m.role === 'manager');
    turns.push({ boss: text, replies: fresh.map((m) => m.text), words: fresh.reduce((n, m) => n + words(m.text), 0), cost: Number((floorCost(db, floor.id) - c0).toFixed(4)), tasksAfter: s.tasks.length, questions: (s.questions || []).filter((q) => !q.answer).length });
    // In a plan run the second line only goes in if the manager is still waiting for something.
    if (sc.plan && s.tasks.length) break;
  }
  return { name, floor, boss, turns };
}

async function waitQuiet(db, app, boss, floor, ms, dry) {
  const end = Date.now() + ms;
  for (;;) {
    await sleep(3000);
    const s = await boss.state();
    const wake = get(db, 'SELECT manager_wake w FROM floors WHERE id=?', floor.id).w;
    const busy = [...app.engine.runs.values()].some((r) => r.floorId === floor.id);
    if (s.floor.paused || app.engine.globalPaused()) { log(`[${floor.slug}] paused:`, s.floor.pauseReason); return s; }
    const open = s.tasks.some((t) => ['todo', 'doing'].includes(t.status));
    const pendingQ = (s.questions || []).filter((q) => !q.answer);
    if (!busy && !wake && !open) {
      if (pendingQ.length && !dry) {
        // A staff member or the manager asked. This boss always says the same thing, because most people do.
        for (const q of pendingQ) { log(`[${floor.slug}] QUESTION:`, q.text, '-> answering'); await boss.answer(q.id, 'whatever u think is best'); }
        continue;
      }
      await sleep(2500);
      const again = await boss.state();
      if (![...app.engine.runs.values()].some((r) => r.floorId === floor.id) && !get(db, 'SELECT manager_wake w FROM floors WHERE id=?', floor.id).w && !again.tasks.some((t) => ['todo', 'doing'].includes(t.status))) return again;
    }
    if (Date.now() > end) { log(`[${floor.slug}] TIMED OUT`); return s; }
  }
}

function planRow(db, r) {
  const tasks = all(db, 'SELECT t.title,t.lane,t.project,t.depends_on,a.role,length(t.brief) n,t.brief FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? ORDER BY t.id', r.floor.id);
  return { scenario: r.name, floor: r.floor.slug, cost: floorCost(db, r.floor.id), turnsToWork: r.turns.findIndex((t) => t.tasksAfter > 0) + 1, turns: r.turns, plan: tasks };
}

const args = process.argv.slice(2);
if (args[0] === 'spend') {
  const out = { total: spentEverywhere(), runs: {} };
  for (const name of readdirSync(BASE)) {
    const file = join(BASE, name, 'data', 'office.db');
    if (!existsSync(file)) continue;
    const db = new DatabaseSync(file, { readOnly: true });
    out.runs[name] = db.prepare("SELECT f.name, ROUND(SUM(l.cost_usd),3) usd FROM ledger l JOIN floors f ON f.id=l.floor_id WHERE l.kind!='domain' GROUP BY f.id").all();
    db.close();
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
log('spent before this', JSON.stringify(spentEverywhere()));
if (args[0] === 'again') {
  // The boss comes back to a floor that already has something on it.
  const { db, app } = await makeApp({ dry: false });
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', args[1]);
  if (!floor) throw new Error('no such floor in this run');
  const boss = new Boss(); const own = createSession(db, 'owner', floor.id, OWNER_MAX_AGE, Date.now()); boss.cookies[COOKIE] = own.token; boss.csrf = own.csrf; boss.slug = floor.slug;
  app.bus.subscribe(floor.id, { ip: 'proof', send: (ev) => {
    if (ev.type === 'feed') log(`[${floor.slug}]`, ev.data.name, ev.data.text);
    if (ev.type === 'message' && ev.data.role !== 'boss') log(`[${floor.slug}] SAYS`, `[${ev.data.role}] (${words(ev.data.text)}w)`, String(ev.data.text).slice(0, 1200));
  }, close() {} });
  const c0 = floorCost(db, floor.id);
  log(`[${floor.slug}] BOSS:`, args[2]);
  await boss.say(args[2]);
  await waitQuiet(db, app, boss, floor, 30 * 60000, false);
  log('FOLLOW-UP COST', (floorCost(db, floor.id) - c0).toFixed(4));
  await dump(db, floor, args[3] || 'after-change');
  await app.close(); db.close();
  process.exit(0);
}
const names = args.filter((a) => SCENARIOS[a]);
if (!names.length) { console.error(`Usage: node scripts/proof-workers.mjs <${Object.keys(SCENARIOS).join('|')}> ...  |  again <floor-slug> "<text>" [tag]  |  spend`); process.exit(1); }
const dry = names.every((n) => SCENARIOS[n].plan);
if (!dry && names.some((n) => SCENARIOS[n].plan)) throw new Error('plan runs and whole jobs go in separate runs');
const { db, app } = await makeApp({ dry });
const results = await Promise.all(names.map((n) => runOne(db, app, n, SCENARIOS[n]).catch((e) => { log('SCENARIO FAILED', n, e.stack); return null; })));
if (dry) {
  const rows = results.filter(Boolean).map((r) => planRow(db, r));
  writeFileSync(join(DIR, `plans-${process.env.PROOF_TAG || 'x'}.json`), JSON.stringify(rows, null, 1));
  for (const r of rows) {
    log('PLAN', r.scenario, `cost ${r.cost}`, `work started on turn ${r.turnsToWork || 'never'}`, `reply words ${r.turns.map((t) => t.words).join('+')}`);
    for (const t of r.turns) for (const m of t.replies) console.log(`  BOSS: ${t.boss}\n  MGR: ${m.replace(/\n/g, '\n       ')}`);
    for (const p of r.plan) console.log(`  TASK ${p.role} lane=${p.lane} project=${p.project} deps=${p.depends_on} brief=${p.n}c: ${p.title}`);
  }
} else {
  for (const r of results.filter(Boolean)) {
    const sum = await dump(db, r.floor, process.env.PROOF_TAG || 'job');
    log('DONE', r.name, JSON.stringify({ cost: sum.cost, tasks: sum.tasks.map((t) => [t.role, t.status, t.usd]), live: sum.projects.filter((p) => p.live).map((p) => p.url) }));
  }
}
log('spent after this', JSON.stringify(spentEverywhere()));
await app.close(); db.close();
process.exit(0);
