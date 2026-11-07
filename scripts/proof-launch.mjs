// The real thing, end to end: real Claude manager and staff, real Managed Agents computers, real OpenRouter images and reviews, real web search, a real browser.
// Only Namecheap is a stub, because nothing here may spend on a domain. Spends real money: keys come from the environment, and PROOF_MAX_USD stops the building if it is reached.
// Usage: node scripts/proof-launch.mjs run | browser. Everything lives in PROOF_DIR, so the browser half can be repeated for free.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, get, all } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { createApp } from '../server/app.js';
import { issueCode } from '../server/auth.js';
import { launch, sleep } from '../test/browser/cdp.mjs';
import { startNamecheapStub } from '../test/stubs/namecheap.mjs';
import { hostFetch } from '../test/helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.PROOF_DIR || '/tmp/lk-proof';
const PORT = Number(process.env.PROOF_PORT || 18084);
const MAX = Number(process.env.PROOF_MAX_USD || 7.5);
const MEDIA = join(ROOT, 'media');
mkdirSync(DIR, { recursive: true });
const ORIGIN = `http://localhost:${PORT}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function makeApp(live) {
  const stub = await startNamecheapStub();
  stub.state.price.com = 11.28;
  const cfg = loadConfig({
    AI_MODE: live ? 'live' : 'mock', COMPUTER_ENABLED: '1', DATA_DIR: join(DIR, 'data'), ADMIN_PASSWORD: 'proof-only', APPS_BASE_DOMAIN: `apps.localhost:${PORT}`, APPS_SCHEME: 'http', PUBLIC_ORIGIN: ORIGIN,
    FLOOR_DAILY_USD: process.env.PROOF_FLOOR_USD || '5', GLOBAL_DAILY_USD: String(MAX), TASK_MAX_USD: '2.5', SESSION_MAX_USD: '1.6', SESSION_MAX_STEPS: '40', MAX_SESSIONS_GLOBAL: '4',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '', OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '', NAMECHEAP_API_USER: 'proof', NAMECHEAP_API_KEY: 'stub-key', NAMECHEAP_CLIENT_IP: '203.0.113.7', NAMECHEAP_BASE_URL: stub.url, DOMAIN_CONTACT_SOURCE: 'existing-domain.com', SERVER_IP: '198.51.100.9',
  });
  const db = openDb(cfg.dataDir);
  const app = createApp({ db, cfg, models: loadModels(), log: (level, msg, x) => { if (level !== 'info') log(level, msg, JSON.stringify(x ?? {})); } });
  await new Promise((r) => app.server.listen(PORT, '127.0.0.1', r));
  app.engine.start();
  return { db, cfg, app, stub };
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
  state() { return this.call('GET', `/api/floors/${this.slug}`).then((r) => r.data); }
}
const quiet = (s) => s.agents.every((a) => a.state === 'idle') && !s.tasks.some((t) => ['todo', 'doing'].includes(t.status));

async function run() {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENROUTER_API_KEY) throw new Error('keys are not set');
  const { db, app, stub } = await makeApp(true);
  const engine = app.engine;
  // The domain is the stub's play money, so it doesn't count against the real budget.
  const total = () => get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE kind!='domain'").n;
  const watch = setInterval(() => { if (total() >= MAX && !engine.globalPaused()) { log('PROOF LIMIT REACHED, pausing the building'); engine.setGlobalPause(true); } }, 2000);
  const follow = (floorId, tag) => app.bus.subscribe(floorId, { ip: 'proof', send: (ev) => { if (ev.type === 'feed') log(tag, ev.data.name, ev.data.text); if (ev.type === 'message' && ev.data.role !== 'boss') log(tag, 'SAYS', String(ev.data.text).slice(0, 500)); }, close() {} });
  const waitQuiet = async (boss, what, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      await sleep(4000);
      const s = await boss.state();
      if (s.floor.paused || engine.globalPaused()) { log(what, 'paused:', s.floor.pauseReason); return s; }
      if (quiet(s) && !get(db, 'SELECT manager_wake w FROM floors WHERE slug=?', boss.slug).w) { await sleep(3000); const again = await boss.state(); if (quiet(again)) return again; }
      if (Date.now() > end) { log(what, 'TIMED OUT'); return s; }
    }
  };
  const report = { floors: {} };
  // ---- A: a real product launch ----
  const a = new Boss(); const ca = await a.claim(db, 'Tiny Teacups', 'Priya');
  follow(get(db, 'SELECT id FROM floors WHERE slug=?', ca.slug).id, 'A');
  report.floors.a = ca.slug;
  await a.say('I am thinking about a small online shop for handmade teacups. Give me three angles to think about. Do not start any work yet.');
  let s = await waitQuiet(a, 'brainstorm', 180000);
  report.brainstormStartedWork = s.tasks.length > 0;
  log('A brainstorm: tasks created =', s.tasks.length, 'spent', total().toFixed(3));
  await a.say('Good. Go: launch "Tiny Teacups" for real. It does not exist yet and has no customers, so be honest about that. One page that says what it is, with a waitlist, a real hero image, a favicon, proper search and social-preview metadata. Have the researcher quickly look up two real competitors first, in a short note. Find a good .com that is available and ask me to buy it. Then have a tester check it and give me the launch report. Keep it cheap.');
  // Being the boss: press Buy when asked.
  const buyer = setInterval(async () => {
    const st = await a.state().catch(() => null);
    for (const d of st?.domains || []) if (d.status === 'awaiting_boss' && !d.pressed && !report.boughtName) {
      report.boughtName = d.domain;
      log('A boss presses Buy on', d.domain, d.priceUsd);
      await a.call('POST', `/api/floors/${a.slug}/domains/${d.id}/buy`, { priceUsd: d.priceUsd });
    }
  }, 5000);
  s = await waitQuiet(a, 'launch', 25 * 60000);
  clearInterval(buyer);
  log('A settled. spent', total().toFixed(3));
  if (s.projects.length) {
    const site = s.projects.find((p) => !/research|notes|brief/.test(p.slug)) || s.projects[0];
    report.site = site.slug;
    const r = await a.call('POST', `/api/floors/${a.slug}/projects/${site.slug}/payment`, { link: 'https://buy.stripe.com/test_proof123' });
    report.paymentSet = r.status;
  }
  // ---- B and C: two floors at once, both with computers ----
  const b = new Boss(); const cb = await b.claim(db, 'Orbit Games', 'Sam');
  const c = new Boss(); const cc = await c.claim(db, 'Flock Lab', 'Noor');
  follow(get(db, 'SELECT id FROM floors WHERE slug=?', cb.slug).id, 'B');
  follow(get(db, 'SELECT id FROM floors WHERE slug=?', cc.slug).id, 'C');
  report.floors.b = cb.slug; report.floors.c = cc.slug;
  await Promise.all([
    b.say('Go: build a tiny playable browser game, a one-screen dodge game with arrow keys and touch, with a saved high score and a leaderboard. Just the Builder, one task. Keep it small and cheap.'),
    c.say('Go: build a small interactive flocking simulation on a canvas, with sliders for cohesion and speed, that runs well on a phone. Just the Builder, one task. Keep it small and cheap.'),
  ]);
  const [sb, sc] = await Promise.all([waitQuiet(b, 'game', 15 * 60000), waitQuiet(c, 'sim', 15 * 60000)]);
  report.game = sb.projects.map((p) => p.slug); report.sim = sc.projects.map((p) => p.slug);
  clearInterval(watch);
  report.total = total();
  report.byKind = all(db, 'SELECT kind, model, COUNT(*) n, ROUND(SUM(cost_usd),4) usd FROM ledger GROUP BY kind, model ORDER BY usd DESC');
  report.domainOrders = engine.domains.adminList();
  report.creates = stub.state.creates.length;
  report.taskCosts = all(db, 'SELECT f.slug floor, t.title, t.status, ROUND(t.cost_usd,3) usd, a.role FROM tasks t JOIN floors f ON f.id=t.floor_id LEFT JOIN agents a ON a.id=t.agent_id ORDER BY t.id');
  writeFileSync(join(DIR, 'report.json'), JSON.stringify(report, null, 1));
  log('TOTAL', report.total); log(JSON.stringify(report.byKind));
  await stub.close(); await app.close(); db.close();
}

async function browser() {
  const report = JSON.parse(readFileSync(join(DIR, 'report.json'), 'utf8'));
  const { db, app, stub } = await makeApp(false);
  stub.state.owned.add(report.boughtName || 'none.com');
  const results = []; let fail = 0;
  const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) fail++; console.log(results.at(-1)); };
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', report.floors.a);
  const labelOf = async (f, p) => (await import('../server/apps.js')).appLabel(db, f, p);
  const b = await launch();
  const open = async (f, slug, tag, opts = {}) => {
    const url = `http://${await labelOf(f, slug)}.apps.localhost:${PORT}/`;
    const p = await b.newPage(opts);
    await p.goto(url); await sleep(2500);
    const text = await p.ev('document.body.innerText');
    await p.shot(join(MEDIA, `launch-${tag}.jpg`));
    return { p, text, url };
  };
  try {
    const { p, text, url } = await open(floor, report.site, 'site-desktop', { width: 1280, height: 800 });
    check('the site loads with no console errors', p.errors.length === 0, p.errors.join(' | ').slice(0, 200));
    check('no invented reviews or customer numbers on the page', !/testimonial|what (our )?customers|★★★|happy customers|trusted by \d/i.test(text), text.slice(0, 120));
    const html = await p.ev('document.documentElement.outerHTML');
    for (const [n, re] of [['title', /<title>[^<]{3,}/], ['description', /name="description"/], ['og:title', /og:title/], ['og:image', /og:image/], ['favicon', /rel="[^"]*icon/], ['lang', /<html[^>]*lang=/]]) check(`has ${n}`, re.test(html));
    const imgs = await p.ev('JSON.stringify([...document.images].map(i=>[i.getAttribute("src"),i.naturalWidth]))');
    check('images really load', JSON.parse(imgs).length > 0 && JSON.parse(imgs).every((x) => x[1] > 0), imgs.slice(0, 160));
    // A real sign-up through the page's own form.
    const form = await p.ev(`(async()=>{const e=document.querySelector('input[type=email],input[name=email]');if(!e)return 'no email input';e.value='friend@example.com';e.dispatchEvent(new Event('input',{bubbles:true}));const f=e.closest('form');if(!f)return 'no form';f.requestSubmit();await new Promise(r=>setTimeout(r,1500));return document.body.innerText.slice(0,400)})()`);
    const rows = all(db, 'SELECT data FROM app_forms WHERE floor_id=?', floor.id);
    check('the waitlist form stores a real entry', rows.some((r) => r.data.includes('friend@example.com')), String(form).slice(0, 100));
    // Headless Chrome announces itself and counts as a robot, which is right. A person's browser is what should count.
    const host = new URL(url).host;
    const before = get(db, 'SELECT COALESCE(SUM(views),0) v FROM app_visits WHERE floor_id=?', floor.id).v;
    await hostFetch(PORT, '/', { headers: { host, 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604', referer: 'https://news.example/x' } });
    check('a person\'s visit is counted, and the robot wasn\'t', get(db, 'SELECT COALESCE(SUM(views),0) v FROM app_visits WHERE floor_id=?', floor.id).v === before + 1);
    const phone = await open(floor, report.site, 'site-phone', { mobile: true });
    check('fits a phone: no sideways scroll', await phone.p.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    const pay = await hostFetch(PORT, '/_office/pay', { headers: { host } });
    check('_office/pay goes to the boss\'s link', pay.status === 302 && /buy\.stripe\.com/.test(pay.headers.get('location') || ''));
    if (report.game?.length) { const f = get(db, 'SELECT * FROM floors WHERE slug=?', report.floors.b); const g = await open(f, report.game.find((x) => !/research|notes/.test(x)) || report.game[0], 'game', { width: 1280, height: 800 }); check('the game runs with no console errors', g.p.errors.length === 0, g.p.errors.join(' | ').slice(0, 200)); check('the game has a canvas', await g.p.ev('!!document.querySelector("canvas")')); }
    if (report.sim?.length) { const f = get(db, 'SELECT * FROM floors WHERE slug=?', report.floors.c); const g = await open(f, report.sim.find((x) => !/research|notes/.test(x)) || report.sim[0], 'simulation', { mobile: true }); check('the simulation runs with no console errors', g.p.errors.length === 0, g.p.errors.join(' | ').slice(0, 200)); check('the simulation has a canvas and sliders', await g.p.ev('!!document.querySelector("canvas") && document.querySelectorAll("input[type=range]").length >= 2')); }
    if (report.boughtName) {
      const o = get(db, 'SELECT * FROM domain_orders WHERE domain=?', report.boughtName);
      check('the bought domain reached live', o?.status === 'live', o?.status);
      check('it was bought exactly once', (report.creates ?? 0) === 1, String(report.creates));
    } else check('a domain was asked for', false);
  } finally { b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  writeFileSync(join(DIR, 'browser.txt'), results.join('\n'));
  await stub.close(); await app.close(); db.close();
  process.exitCode = fail ? 1 : 0;
}
// A friend's nervous first hour on a real computer: pause it mid-build, resume, redirect it, sign out and back in with the recovery code, look at it as a visitor and as admin.
async function qa() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('keys are not set');
  const { db, app, stub } = await makeApp(true);
  const results = []; let fail = 0;
  const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) fail++; console.log(results.at(-1)); };
  const total = () => get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE kind!='domain'").n;
  const boss = new Boss(); const cl = await boss.claim(db, 'Second Thoughts', 'Ana');
  const floorId = get(db, 'SELECT id FROM floors WHERE slug=?', boss.slug).id;
  app.bus.subscribe(floorId, { ip: 'proof', send: (ev) => { if (ev.type === 'feed') log(ev.data.name, ev.data.text); }, close() {} });
  const session = () => get(db, "SELECT id,session_id,status FROM tasks WHERE floor_id=? AND session_id!='' ORDER BY id DESC LIMIT 1", floorId);
  const until = async (fn, ms, what) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) { log('timed out:', what); return null; } await sleep(1500); } };
  await boss.say('Go: have the Builder build a one-screen page that shows a clock. One task, keep it tiny.');
  const live = await until(session, 120000, 'a computer to start');
  check('the Builder started a real computer', !!live);
  await sleep(15000);
  const paused = await boss.call('POST', `/api/floors/${boss.slug}/control`, { action: 'pause' });
  check('pause takes effect', paused.data.paused === true);
  await until(() => !app.engine.runs.size, 60000, 'runs to stop');
  check('nothing is running while paused', app.engine.runs.size === 0);
  const before = total(); await sleep(8000);
  check('no spending while paused', total() - before < 0.02, (total() - before).toFixed(3));
  await boss.call('POST', `/api/floors/${boss.slug}/control`, { action: 'resume' });
  check('resume reattaches', !!(await until(() => app.engine.runs.size > 0, 30000, 'work to resume')));
  await sleep(10000);
  const redirected = await boss.call('POST', `/api/floors/${boss.slug}/control`, { action: 'redirect', text: 'Drop the clock. Just tell me, in one sentence, what you think a good first product would be. No tasks.' });
  check('redirect is accepted', redirected.status === 200);
  check('the old task is cancelled', !!(await until(() => get(db, 'SELECT status FROM tasks WHERE id=?', live.id).status === 'cancelled', 30000, 'cancel')));
  const answered = await until(async () => { const st = await boss.state(); return st.messages.at(-1)?.role === 'manager' && !st.agents.some((a) => a.state !== 'idle') && st.messages.at(-1); }, 120000, 'the manager to answer');
  check('the manager follows the new instruction', !!answered, answered?.text?.slice(0, 120));
  const anon = new Boss(); anon.slug = boss.slug;
  const seen = await anon.state();
  check('a visitor sees the floor without chat, briefs or costs', !seen.messages && seen.tasks.every((t) => t.brief === undefined && t.costUsd === undefined));
  const recovered = new Boss();
  const r = await recovered.call('POST', '/api/login', { slug: boss.slug, recoveryCode: cl.recoveryCode });
  check('the recovery code signs in on a new device and rotates', r.status === 200 && r.data.recoveryCode !== cl.recoveryCode);
  check('the old session is gone', (await boss.state()).viewer.owner === false);
  const admin = new Boss();
  const al = await admin.call('POST', '/api/admin/login', { password: 'proof-only' }); admin.csrf = al.data.csrf;
  const o = await admin.call('GET', '/api/admin/overview');
  check('admin sees the floor and its spend', o.data.floors.some((f) => f.slug === boss.slug && f.spendToday > 0));
  log('QA spent', total().toFixed(3));
  writeFileSync(join(DIR, 'qa.txt'), [...results, `spent ${total().toFixed(3)}`].join('\n'));
  await stub.close(); await app.close(); db.close();
  process.exitCode = fail ? 1 : 0;
}
async function simAgain() {
  const report = existsSync(join(DIR, 'report.json')) ? JSON.parse(readFileSync(join(DIR, 'report.json'), 'utf8')) : { floors: {} };
  const { db, app, stub } = await makeApp(true);
  const boss = new Boss(); const made = await boss.claim(db, process.env.PROOF_FLOOR || 'Flock Two', 'Noor');
  const floorId = get(db, 'SELECT id FROM floors WHERE slug=?', boss.slug).id;
  app.bus.subscribe(floorId, { ip: 'proof', send: (ev) => { if (ev.type === 'feed') log(ev.data.name, ev.data.text); }, close() {} });
  await boss.say(process.env.PROOF_BRIEF || 'Go: build a small interactive flocking simulation on a canvas, with sliders for cohesion and speed, that runs well on a phone. Just the Builder, one task. Keep it small and cheap.');
  const end = Date.now() + 15 * 60000;
  let s;
  for (;;) { await sleep(4000); s = await boss.state(); if ((s.projects.length && !s.agents.some((a) => a.state !== 'idle')) || Date.now() > end) break; }
  report.floors.c = made.slug; report.sim = s.projects.map((p) => p.slug);
  report.simCost = all(db, "SELECT ROUND(SUM(cost_usd),3) usd FROM ledger WHERE floor_id=? AND kind!='domain'", floorId)[0].usd;
  writeFileSync(join(DIR, 'report.json'), JSON.stringify(report, null, 1));
  log('sim', JSON.stringify(report.sim), 'cost', report.simCost);
  for (const p of report.sim) { const files = all(db, 'SELECT path,content FROM published_files WHERE floor_id=? AND project=?', floorId, p).filter((f) => /\.(html|js)$/.test(f.path)).map((f) => String(f.content)).join(''); log('uses', p, JSON.stringify({ submitScore: /submitScore/.test(files), leaderboard: /Office\.leaderboard|\.leaderboard\(/.test(files), local: /local top|local leaderboard/i.test(files) })); }
  await stub.close(); await app.close(); db.close();
}
(process.argv[2] === 'browser' ? browser : process.argv[2] === 'qa' ? qa : process.argv[2] === 'sim' ? simAgain : run)().catch((e) => { console.error(e); process.exit(1); });
