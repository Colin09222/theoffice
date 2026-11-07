// One real check of the merged code: real Claude, real computers, real OpenRouter. Spends real money.
// Keys come from the environment and go nowhere else. The building's own limits are the guard, which is part of what is being checked, and a watcher sits behind them.
// Usage: node scripts/proof-next.mjs website | tone | help | stop | spend
//   website  one small Website job, start to finish
//   tone     the same request on a silly floor and a serious one: the real manager and Writer, nobody else
//   help     an ask_buddehbot round trip, answered through the real CLI in its own process
//   stop     a limit just above what has gone: Claude roles stop, nobody sees a figure, an OpenRouter role carries on, and raising it resumes the work
//   session  a real computer at a limit it can't finish inside. Run it with its own PROOF_BASE
//   spend    what every step has cost so far
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, get, all, run } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { createApp } from '../server/app.js';
import { issueCode, createSession, COOKIE, OWNER_MAX_AGE } from '../server/auth.js';
import { launch, sleep } from '../test/browser/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PROOF_BASE || '/tmp/office-next-proof';
const OUT = join(ROOT, 'docs/proof-next');
const PORT = Number(process.env.PROOF_PORT || 18099);
const ORIGIN = `http://localhost:${PORT}`;
const DATA = join(BASE, 'data');
// Under what this check was allowed: Anthropic $4, OpenRouter $0.50.
const LIMIT = { anthropic: 3.5, openrouter: 0.4 };
const HARD = { anthropic: 3.8, openrouter: 0.45 };
mkdirSync(DATA, { recursive: true }); mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const spent = (db) => Object.fromEntries(['anthropic', 'openrouter'].map((p) => [p, Number(get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE provider=?', p).n.toFixed(4))]));
const floorCost = (db, id) => Number(get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND kind!='domain'", id).n.toFixed(4));

let watcher = null;
async function makeApp({ budgetAnthropic = LIMIT.anthropic, computer = true } = {}) {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENROUTER_API_KEY) throw new Error('keys are not set');
  const cfg = loadConfig({
    AI_MODE: 'live', COMPUTER_ENABLED: computer ? '1' : '0', DATA_DIR: DATA, ADMIN_PASSWORD: 'proof-only', APPS_BASE_DOMAIN: `apps.localhost:${PORT}`, APPS_SCHEME: 'http', PUBLIC_ORIGIN: ORIGIN,
    FLOOR_DAILY_USD: '8', GLOBAL_DAILY_USD: '8', TASK_MAX_USD: '1.2', SESSION_MAX_USD: '1', BUDGET_ANTHROPIC_USD: String(budgetAnthropic), BUDGET_OPENROUTER_USD: String(LIMIT.openrouter),
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });
  const db = openDb(cfg.dataDir);
  const app = createApp({ db, cfg, models: loadModels(), log: (level, msg, x) => { if (level !== 'info') log(level, msg, JSON.stringify(x ?? {}).slice(0, 300)); } });
  await new Promise((r) => app.server.listen(PORT, '127.0.0.1', r));
  app.engine.start();
  clearInterval(watcher);
  watcher = setInterval(() => {
    const s = spent(db);
    if ((s.anthropic >= HARD.anthropic || s.openrouter >= HARD.openrouter) && !app.engine.globalPaused()) { log('HARD LIMIT REACHED, pausing the building', JSON.stringify(s)); app.engine.setGlobalPause(true); }
  }, 3000);
  watcher.unref();
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
  own(db, floor) { const s = createSession(db, 'owner', floor.id, OWNER_MAX_AGE, Date.now()); this.cookies[COOKIE] = s.token; this.csrf = s.csrf; this.slug = floor.slug; return this; }
  say(text) { log(`[${this.slug}] BOSS:`, text); return this.call('POST', `/api/floors/${this.slug}/chat`, { text }); }
  state() { return this.call('GET', `/api/floors/${this.slug}`).then((r) => r.data); }
  answer(id, text) { return this.call('POST', `/api/floors/${this.slug}/questions/${id}/answer`, { text }); }
}
const until = async (what, fn, ms = 300000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(1500); } };
const watchFloor = (app, floor) => app.bus.subscribe(floor.id, { ip: 'proof', send: (ev) => {
  if (ev.type === 'feed') log(`[${floor.slug}]`, ev.data.name, String(ev.data.text).slice(0, 110));
  if (ev.type === 'message' && ev.data.role !== 'boss') log(`[${floor.slug}] SAYS`, ev.data.role, String(ev.data.text).slice(0, 140).replace(/\n/g, ' '));
}, close() {} });
const quiet = (app, db, floor) => ![...app.engine.runs.values()].some((r) => r.floorId === floor.id) && !get(db, 'SELECT manager_wake w FROM floors WHERE id=?', floor.id).w;
const settled = (app, db, floor) => quiet(app, db, floor) && !get(db, "SELECT 1 x FROM tasks WHERE floor_id=? AND status IN ('todo','doing','review')", floor.id);
const chat = (db, floor) => all(db, 'SELECT role,text FROM messages WHERE floor_id=? ORDER BY id', floor.id).map((m) => `### ${m.role}\n${m.text}`).join('\n\n');
const finish = async (app, db) => { clearInterval(watcher); await app.close(); db.close(); };
const cli = (...args) => {
  // Its own process, on the same database, with no key in its environment: the way the owner's assistant runs it.
  const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), ...args], { env: { PATH: process.env.PATH, DATA_DIR: DATA, BUDGET_ANTHROPIC_USD: process.env.CLI_BUDGET_ANTHROPIC ?? String(LIMIT.anthropic), BUDGET_OPENROUTER_USD: String(LIMIT.openrouter) }, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`cli ${args.join(' ')}: ${(r.stderr || '').slice(0, 300)}`);
  return r.stdout;
};
// Figures a boss or a visitor should never meet. What a real site quotes as its own price is told apart by reading the hits, so they are listed rather than failed on here.
const FIGURE = /.{0,60}(?:\$\s?\d|\b\d+(?:\.\d+)?\s?cents?\b|\bUSD\b).{0,30}/g;
const MONEY_FIELD = /"(?:spend|costUsd|estUsd|estimateUsd|limitUsd|spentUsd|remainingUsd|today)"/g;
const scan = (text) => ({ figures: [...new Set(String(text).match(FIGURE) || [])].slice(0, 12), fields: [...new Set(String(text).match(MONEY_FIELD) || [])] });

async function website() {
  const { db, app, cfg } = await makeApp();
  const boss = new Boss();
  const made = await boss.claim(db, 'Corner Spokes', 'Dana');
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', made.slug);
  watchFloor(app, floor);
  const started = Date.now();
  await boss.say('need a website for my bike repair shop. its called corner spokes, in pittsburgh. mostly flats and tune-ups, open saturdays too');
  const done = await until('the job to finish', async () => {
    const s = await boss.state();
    for (const q of (s.questions || []).filter((x) => !x.answeredAt && !x.answer)) { log('question', String(q.text).slice(0, 140)); await boss.answer(q.id, 'u pick'); }
    return settled(app, db, floor) && s.tasks.length && (s.projects || []).some((p) => p.url) ? s : null;
  }, 20 * 60000);
  const visitor = new Boss();
  const seen = await visitor.call('GET', `/api/floors/${floor.slug}`);
  const site = done.projects.find((p) => p.kind === 'site') || done.projects[0];
  const out = { minutes: Math.round((Date.now() - started) / 6000) / 10, cost: floorCost(db, floor.id), spent: spent(db), tasks: all(db, 'SELECT t.id,t.title,t.status,a.role,ROUND(t.cost_usd,3) usd FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=?', floor.id), projects: done.projects.map((p) => ({ slug: p.slug, kind: p.kind, url: p.url })), owner: scan(JSON.stringify(done)), visitor: scan(JSON.stringify(seen.data)) };
  writeFileSync(join(OUT, 'website-chat.md'), chat(db, floor));
  let b;
  try {
    b = await launch();
    for (const [view, opts] of [['desktop', { width: 1280, height: 800 }], ['phone', { mobile: true }]]) {
      const p = await b.newPage(opts);
      await p.goto(site.url.startsWith('http') ? site.url : `${ORIGIN}${site.url}`); await sleep(2500);
      await p.shot(join(ROOT, `media/next-website-${view}.jpg`));
    }
  } catch (e) { log('shot failed', e.message); } finally { b?.close(); }
  writeFileSync(join(OUT, 'website.json'), JSON.stringify(out, null, 1));
  log('DONE website', out.minutes, 'min, floor cost', out.cost, 'all spend', JSON.stringify(out.spent));
  await finish(app, db);
}

async function tone() {
  const { db, app } = await makeApp({ computer: false });
  // The real manager and the real Writer. Everyone else's task is parked, because a tone is heard in the words.
  const realStaff = app.engine.runStaff.bind(app.engine);
  app.engine.runStaff = async (floorId, agentId, taskId, ctl) => {
    if (get(db, 'SELECT role FROM agents WHERE id=?', agentId).role === 'writer') return realStaff(floorId, agentId, taskId, ctl);
    run(db, "UPDATE tasks SET status='cancelled', result='(not run in this check)' WHERE id=?", taskId);
  };
  const out = {};
  for (const [name, toneKey] of [['Sunny Cups Silly', 'silly'], ['Sunny Cups Serious', 'serious']]) {
    const boss = new Boss();
    // A floor from an earlier try is picked up where it got to, so a restart of this script doesn't pay for the same words twice.
    let floor = get(db, 'SELECT * FROM floors WHERE name=?', name);
    if (floor) boss.own(db, floor);
    else {
      const made = await boss.claim(db, name, 'Robin');
      floor = get(db, 'SELECT * FROM floors WHERE slug=?', made.slug);
      const saved = await boss.call('POST', `/api/floors/${floor.slug}/customise`, { identity: { tone: toneKey, about: 'A lemonade stand in the park.' } });
      if (saved.status !== 200) throw new Error(`customise: ${saved.status}`);
      await boss.say('need a one page site for my lemonade stand, sunny cups. we do classic and strawberry');
    }
    watchFloor(app, floor);
    const written = () => get(db, "SELECT t.id FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='writer' AND t.status IN ('review','done','failed')", floor.id);
    await until(`${toneKey} to settle`, () => written() && ![...app.engine.runs.values()].some((r) => r.floorId === floor.id), 8 * 60000);
    const files = all(db, "SELECT path,content FROM files WHERE floor_id=? AND path LIKE 'projects/%' AND (path LIKE '%.md' OR path LIKE '%.html')", floor.id).map((f) => ({ path: f.path, text: String(f.content).slice(0, 1600) }));
    out[toneKey] = { cost: floorCost(db, floor.id), manager: all(db, "SELECT text FROM messages WHERE floor_id=? AND role='manager' ORDER BY id", floor.id).map((m) => m.text), writerResult: get(db, "SELECT t.result r FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='writer' ORDER BY t.id LIMIT 1", floor.id)?.r ?? '', files };
    log('tone', toneKey, 'cost', out[toneKey].cost);
  }
  writeFileSync(join(OUT, 'tone.json'), JSON.stringify(out, null, 1));
  log('DONE tone, all spend', JSON.stringify(spent(db)));
  await finish(app, db);
}

async function help() {
  const { db, app } = await makeApp({ computer: false });
  const boss = new Boss();
  const made = await boss.claim(db, 'Question Mark', 'Lee');
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', made.slug);
  watchFloor(app, floor);
  await boss.say('I have a question you can\'t answer and nor can I: does this building back up what we publish, and how long does a published project stay up if I stop visiting? Nobody on the team can know that. Please ask for me.');
  const pending = await until('the manager to ask', () => get(db, "SELECT id FROM help_requests WHERE floor_id=? AND status='pending'", floor.id), 180000);
  const listing = JSON.parse(cli('help', 'list', '--json'));
  const req = listing.requests.find((r) => r.id === pending.id);
  const answerFile = join(BASE, 'answer.txt');
  writeFileSync(answerFile, 'Yes, published projects are backed up nightly and stay up however long a boss stays away. Tell the boss plainly and carry on.');
  log('CLI', cli('help', 'answer', '--id', String(pending.id), '--text-file', answerFile).trim());
  const before = get(db, "SELECT COALESCE(MAX(id),0) n FROM messages WHERE floor_id=? AND role='manager'", floor.id).n;
  await until('the manager to hear and answer', () => quiet(app, db, floor) && get(db, "SELECT 1 x FROM messages WHERE floor_id=? AND role='help'", floor.id) && get(db, "SELECT 1 x FROM messages WHERE floor_id=? AND role='manager' AND id>?", floor.id, before), 180000);
  const out = { cost: floorCost(db, floor.id), status: get(db, 'SELECT status s FROM help_requests WHERE id=?', pending.id).s, fenced: [req.floorName, req.question, req.whatWasTried].every((v) => v.startsWith(`<<<UNTRUSTED_FLOOR_DATA ${listing.fence} `) && v.endsWith(`<<<END_UNTRUSTED_FLOOR_DATA ${listing.fence}>>>`)), managerAfter: get(db, "SELECT text FROM messages WHERE floor_id=? AND role='manager' ORDER BY id DESC LIMIT 1", floor.id).text };
  writeFileSync(join(OUT, 'help.json'), JSON.stringify(out, null, 1));
  log('DONE help', JSON.stringify({ cost: out.cost, status: out.status, fenced: out.fenced }), 'all spend', JSON.stringify(spent(db)));
  await finish(app, db);
}

// One boss message at a limit just above what has gone. The building keeps its ledger across all three boots, as it would on the server.
async function stop() {
  const results = [];
  const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 200)})` : ''}`); log(results.at(-1)); };
  const first = openDb(DATA); const already = spent(first); first.close();
  const low = Math.round((already.anthropic + 0.05) * 100) / 100;
  log('spent so far', JSON.stringify(already), 'limit set to', low);
  process.env.CLI_BUDGET_ANTHROPIC = String(low);
  let { db, app } = await makeApp({ budgetAnthropic: low, computer: false });
  const boss = new Boss();
  const made = await boss.claim(db, `Out Of Luck ${Date.now() % 1000}`, 'Sage');
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', made.slug);
  watchFloor(app, floor);
  await boss.say('write me one line of welcome for the site');
  const notices = () => all(db, "SELECT text FROM messages WHERE floor_id=? AND role='budget' ORDER BY id", floor.id).map((m) => m.text);
  await until('the boss to hear', () => notices().length >= 1, 30000);
  await sleep(3000);
  const s = await boss.state();
  check('the floor shows it is out of budget', s.floor.outOfBudget === true);
  check('the boss hears once, and only to ask the owner', notices().length === 1 && /out of budget/.test(notices()[0]) && /ask the owner/.test(notices()[0]) && !/\d/.test(notices()[0]), notices()[0]);
  check('no Claude call was made', spent(db).anthropic === already.anthropic, JSON.stringify(spent(db)));
  const owner = scan(JSON.stringify(s));
  check('no figure in what the boss gets', !owner.figures.length && !owner.fields.length, JSON.stringify(owner));
  const seen = await new Boss().call('GET', `/api/floors/${floor.slug}`);
  const visitor = scan(JSON.stringify(seen.data));
  check('no figure in what a visitor gets, and no word of it', !visitor.figures.length && !visitor.fields.length && !/budget/i.test(JSON.stringify(seen.data)), JSON.stringify(visitor));
  // As people really see it, in a real browser.
  let b, b2;
  try {
    b = await launch();
    const p = await b.newPage({ width: 1280, height: 800 });
    await p.send('Network.setCookie', { name: COOKIE, value: boss.cookies[COOKIE], url: `${ORIGIN}/theoffice/`, path: '/theoffice', httpOnly: true });
    await p.goto(`${ORIGIN}/theoffice/floor/${floor.slug}`);
    await p.until('document.body.dataset.page === "floor" && !!window.__office', 'the floor', 30000);
    await sleep(2500);
    const text = await p.ev('document.body.textContent');
    check('the owner\'s page says out of budget, with no amount', /Out of budget/.test(text) && !/\$\s?\d/.test(text), scan(text).figures.join(' | '));
    await p.shot(join(ROOT, 'media/next-out-of-budget.jpg'));
    b2 = await launch();
    const v = await b2.newPage({ width: 1280, height: 800 });
    await v.goto(`${ORIGIN}/theoffice/floor/${floor.slug}`);
    await v.until('document.body.dataset.page === "floor" && !!window.__office', 'the visitor floor', 30000);
    await sleep(1500);
    const vt = await v.ev('document.body.textContent');
    check('a visitor\'s page has no figure and no word of the budget', !/\$\s?\d/.test(vt) && !/budget/i.test(vt), scan(vt).figures.join(' | '));
  } catch (e) { check('browser check', false, e.message); } finally { b?.close(); b2?.close(); }
  const report = JSON.parse(cli('budget', '--json'));
  check('the admin CLI shows it stopped', report.providers.anthropic.stopped === true && report.providers.anthropic.flag === '100%', JSON.stringify(report.providers.anthropic));
  // An OpenRouter role on the same floor keeps working.
  app.engine.hireStaff(floor, 'tester', '');
  const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
  const orBefore = spent(db).openrouter;
  const t = app.engine.assignTask(floor, mgr, { to: 'tester', title: 'A one line note', brief: 'Reply with one short line saying the note is done. Use no tools.', plan: '', project: 'note', private: false, dependsOn: [] });
  app.engine.kick();
  await until('the OpenRouter role to finish', () => ['review', 'done', 'failed'].includes(get(db, 'SELECT status s FROM tasks WHERE id=?', t.id).s), 120000);
  check('an OpenRouter role carried on', get(db, 'SELECT status s FROM tasks WHERE id=?', t.id).s === 'review' && spent(db).openrouter > orBefore, `${get(db, 'SELECT status s FROM tasks WHERE id=?', t.id).s}, openrouter ${orBefore} to ${spent(db).openrouter}`);
  check('and Claude still made no call', spent(db).anthropic === already.anthropic);
  await finish(app, db);

  // A restart at the same limit stays stopped, and doesn't tell the boss again.
  ({ db, app } = await makeApp({ budgetAnthropic: low, computer: false }));
  await sleep(4000);
  check('a restart stays stopped, and the boss isn\'t told twice', all(db, "SELECT 1 x FROM messages WHERE floor_id=? AND role='budget'", floor.id).length === 1 && spent(db).anthropic === already.anthropic);
  await finish(app, db);

  // The owner raises it. Nobody else does anything.
  ({ db, app } = await makeApp({ budgetAnthropic: LIMIT.anthropic, computer: false }));
  boss.own(db, floor);
  await until('the boss to hear it is back', () => all(db, "SELECT text FROM messages WHERE floor_id=? AND role='budget'", floor.id).some((m) => /budget again/.test(m.text)), 60000);
  await until('the manager to answer the waiting message', () => quiet(app, db, floor) && get(db, "SELECT 1 x FROM messages WHERE floor_id=? AND role='manager' AND id>?", floor.id, get(db, "SELECT COALESCE(MAX(id),0) n FROM messages WHERE floor_id=? AND role='boss'", floor.id).n), 240000);
  const after = await boss.state();
  check('raising the limit resumed the work without being asked', after.floor.outOfBudget === false && spent(db).anthropic > already.anthropic, JSON.stringify(spent(db)));
  const told = all(db, "SELECT text FROM messages WHERE floor_id=? AND role='manager' ORDER BY id", floor.id).map((m) => m.text).join('\n');
  check('the manager, resuming, says nothing about money', !/out of budget|\$\s?\d|\bcents?\b/i.test(told), told.slice(0, 200));
  writeFileSync(join(OUT, 'stop.txt'), `${results.join('\n')}\n\nspent ${JSON.stringify(spent(db))}\n\nboss's notices:\n${all(db, "SELECT text FROM messages WHERE floor_id=? AND role='budget' ORDER BY id", floor.id).map((m) => m.text).join('\n')}\n\nmanager afterwards:\n${told}\n`);
  log('DONE stop', results.filter((r) => r.startsWith('FAIL')).length, 'failed of', results.length, 'all spend', JSON.stringify(spent(db)));
  await finish(app, db);
}

// A real computer session at a limit it can't finish inside. Its own data folder, because the limit is measured from nothing here: run it with PROOF_BASE set.
async function session() {
  const results = [];
  const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 200)})` : ''}`); log(results.at(-1)); };
  const low = 0.2;
  process.env.CLI_BUDGET_ANTHROPIC = String(low);
  let { db, app } = await makeApp({ budgetAnthropic: low });
  app.engine.runManager = async () => {};
  const seen = { budgets: [] };
  const real = app.engine.computer.client.createSession?.bind(app.engine.computer.client);
  app.engine.computer.client.createSession = (x, ...rest) => { seen.budgets.push(x?.budget?.max_list_cost?.amount); return real(x, ...rest); };
  const boss = new Boss();
  const made = await boss.claim(db, 'Small Computer', 'Ari');
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', made.slug);
  watchFloor(app, floor);
  const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
  const t = app.engine.assignTask(floor, mgr, { to: 'builder', title: 'Build a one page site', brief: 'A one page site about a cat called Biscuit: a drawn SVG portrait, a hand-written stylesheet and a short story about her. Check it in a browser at phone and desktop size, then publish it.', plan: '', project: 'biscuit', private: false, dependsOn: [] });
  app.engine.kick();
  const task = () => get(db, 'SELECT * FROM tasks WHERE id=?', t.id);
  const notices = () => all(db, "SELECT text FROM messages WHERE floor_id=? AND role='budget' ORDER BY id", floor.id).map((m) => m.text);
  const sessionId = await until('a computer to start', () => task().session_id, 180000);
  check('the session was capped to what is left of the limit', seen.budgets.length === 1 && Number(seen.budgets[0]) <= low * 100, `${seen.budgets[0]} cents on a limit of ${low * 100}`);
  await until('it to stop or finish', () => !app.engine.runs.size && ['todo', 'review', 'failed'].includes(task().status), 8 * 60000);
  const stopped = task().status === 'todo';
  check('it stopped at the limit, and the task waits rather than fails', stopped, task().status);
  await until('the boss to hear', () => notices().length >= 1 || !stopped, 30000);
  check('the boss hears once, with no figures', notices().length === 1 && /out of budget/.test(notices()[0]) && !/\d/.test(notices()[0]), notices()[0]);
  const gone = spent(db).anthropic;
  check('the overrun is small', gone <= low + 0.15, `${gone} on a limit of ${low}`);
  check('nothing is left held', get(db, 'SELECT COUNT(*) n FROM budget_holds').n === 0);
  const owner = scan(JSON.stringify(await boss.state()));
  check('no figure in what the boss gets', !owner.figures.length && !owner.fields.length, JSON.stringify(owner));
  const report = JSON.parse(cli('budget', '--json'));
  check('the admin sees it stopped', report.providers.anthropic.stopped === true && report.providers.anthropic.flag === '100%', JSON.stringify(report.providers.anthropic));
  await finish(app, db);

  // The owner raises it. The same session carries on.
  ({ db, app } = await makeApp({ budgetAnthropic: 1.5 }));
  app.engine.runManager = async () => {};
  await until('the work to finish', () => !app.engine.runs.size && ['review', 'failed'].includes(task().status), 12 * 60000);
  check('raising the limit carried on in the same session', task().session_id === sessionId, `${task().status}`);
  check('it finished', task().status === 'review', String(task().result).slice(0, 160));
  check('the boss is told it is back', notices().some((n) => /budget again/.test(n)) && !notices().some((n) => /\d/.test(n)));
  check('the work was saved and published', !!get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND published_at IS NOT NULL', floor.id));
  writeFileSync(join(OUT, 'session.txt'), `${results.join('\n')}\n\nspent ${JSON.stringify(spent(db))}\n\nboss's notices:\n${notices().join('\n')}\n`);
  log('DONE session', results.filter((r) => r.startsWith('FAIL')).length, 'failed of', results.length, 'all spend', JSON.stringify(spent(db)));
  await finish(app, db);
}

const cmd = process.argv[2];
try {
  if (cmd === 'website') await website();
  else if (cmd === 'tone') await tone();
  else if (cmd === 'help') await help();
  else if (cmd === 'stop') await stop();
  else if (cmd === 'session') await session();
  else if (cmd === 'spend') { if (!existsSync(join(DATA, 'office.db'))) console.log('nothing yet'); else { const db = openDb(DATA); console.log(JSON.stringify(spent(db))); db.close(); } }
  else { console.error('website | tone | help | stop | session | spend'); process.exitCode = 1; }
} catch (e) { log('FAILED', String(e?.message || e).slice(0, 400)); process.exitCode = 1; }
process.exit();
