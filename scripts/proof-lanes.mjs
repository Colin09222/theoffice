// The lanes and the help line for real: real Claude manager and staff, real computers, real OpenRouter pictures and reviews, real web search.
// Spends real money. Keys come from the environment and go nowhere else. A watcher pauses the building at PROOF_ANTHROPIC_MAX or PROOF_OPENROUTER_MAX, counted across every run in PROOF_DIR.
// Usage: node scripts/proof-lanes.mjs game | website | business | help | spend | look, or `resume <lane>` to pick a job up again after a stop.
// `look` needs no key and no model: it opens what was made in real Chrome, plays it, and takes screenshots. Domain buying stays off throughout.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, get, all } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { createApp } from '../server/app.js';
import { issueCode, createSession, COOKIE, OWNER_MAX_AGE } from '../server/auth.js';
import { appLabel } from '../server/apps.js';
import { launch, sleep } from '../test/browser/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.PROOF_DIR || '/tmp/lanes-proof';
const PORT = Number(process.env.PROOF_PORT || 18087);
const ANTHROPIC_MAX = Number(process.env.PROOF_ANTHROPIC_MAX || 7.5);
const OPENROUTER_MAX = Number(process.env.PROOF_OPENROUTER_MAX || 0.9);
const MEDIA = join(ROOT, 'media');
mkdirSync(DIR, { recursive: true });
const ORIGIN = `http://localhost:${PORT}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const reportPath = join(DIR, 'report.json');
const report = () => (existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {});
const save = (key, value) => writeFileSync(reportPath, JSON.stringify({ ...report(), [key]: value }, null, 1));

async function makeApp(live) {
  const cfg = loadConfig({
    AI_MODE: live ? 'live' : 'mock', COMPUTER_ENABLED: '1', DATA_DIR: join(DIR, 'data'), ADMIN_PASSWORD: 'proof-only', APPS_BASE_DOMAIN: `apps.localhost:${PORT}`, APPS_SCHEME: 'http', PUBLIC_ORIGIN: ORIGIN,
    FLOOR_DAILY_USD: '5', GLOBAL_DAILY_USD: String(ANTHROPIC_MAX + OPENROUTER_MAX), TASK_MAX_USD: '2.2', SESSION_MAX_USD: '1.6', SESSION_MAX_STEPS: '40', MAX_SESSIONS_GLOBAL: '4', HELP_TICK_MS: '2000',
    ANTHROPIC_API_KEY: live ? process.env.ANTHROPIC_API_KEY || '' : '', OPENROUTER_API_KEY: live ? process.env.OPENROUTER_API_KEY || '' : '',
  });
  const db = openDb(cfg.dataDir);
  const app = createApp({ db, cfg, models: loadModels(), log: (level, msg, x) => { if (level !== 'info') log(level, msg, JSON.stringify(x ?? {})); } });
  await new Promise((r) => app.server.listen(PORT, '127.0.0.1', r));
  app.engine.start();
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
  state() { return this.call('GET', `/api/floors/${this.slug}`).then((r) => r.data); }
}
const spent = (db) => ({
  anthropic: get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE kind NOT IN ('domain','image','review')").n,
  openrouter: get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE kind IN ('image','review')").n,
});
const quiet = (s) => s.agents.every((a) => a.state === 'idle') && !s.tasks.some((t) => ['todo', 'doing'].includes(t.status));

// One floor's whole job, as a person would drive it: tap, reply, say go, wait.
async function job(lane, { company, boss: bossName, tap, reply, go, minutes = 45 }, resuming) {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENROUTER_API_KEY) throw new Error('keys are not set');
  const { db, app } = await makeApp(true);
  const engine = app.engine;
  const watch = setInterval(() => {
    const s = spent(db);
    if ((s.anthropic >= ANTHROPIC_MAX || s.openrouter >= OPENROUTER_MAX) && !engine.globalPaused()) { log('PROOF LIMIT REACHED, pausing the building', JSON.stringify(s)); engine.setGlobalPause(true); }
  }, 2000);
  log('spent before this', JSON.stringify(spent(db)));
  const boss = new Boss();
  const was = resuming ? report()[lane] : null;
  const made = was ? { slug: was.floor, number: was.number } : await boss.claim(db, company, bossName);
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', made.slug);
  if (was) { const own = createSession(db, 'owner', floor.id, OWNER_MAX_AGE, Date.now()); boss.cookies[COOKIE] = own.token; boss.csrf = own.csrf; boss.slug = floor.slug; }
  app.bus.subscribe(floor.id, { ip: 'proof', send: (ev) => {
    if (ev.type === 'feed') log(ev.data.name, ev.data.text);
    if (ev.type === 'message' && ev.data.role !== 'boss') log('SAYS', `[${ev.data.role}]`, String(ev.data.text).slice(0, 1500));
  }, close() {} });
  const waitQuiet = async (what, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      await sleep(4000);
      const s = await boss.state();
      if (s.floor.paused || engine.globalPaused()) { log(what, 'paused:', s.floor.pauseReason); return s; }
      if (quiet(s) && !get(db, 'SELECT manager_wake w FROM floors WHERE slug=?', boss.slug).w) { await sleep(3000); const again = await boss.state(); if (quiet(again)) return again; }
      if (Date.now() > end) { log(what, 'TIMED OUT'); return s; }
    }
  };
  const out = was || { lane, floor: made.slug, number: made.number, company, turns: [] };
  const say = async (text, what, ms) => {
    log('BOSS', text);
    await boss.say(text);
    const s = await waitQuiet(what, ms);
    out.turns.push({ what, tasks: s.tasks.length, costSoFar: floorCost(db, floor.id) });
    return s;
  };
  let s;
  if (was) s = await waitQuiet('resume', minutes * 60000);
  else {
    // The first reply has to be a conversation, not work.
    s = await say(tap, 'tap', 180000);
    out.tapStartedWork = s.tasks.length > 0;
    out.firstReply = s.messages.filter((m) => m.role === 'manager').at(-1)?.text;
    if (reply) s = await say(reply, 'reply', 180000);
    s = await say(go, 'go', minutes * 60000);
  }
  out.projects = s.projects.map((p) => ({ slug: p.slug, title: p.title, kind: p.kind, private: p.private, url: `http://${appLabel(db, floor, p.slug)}.apps.localhost:${PORT}/`, sources: p.sources?.length, check: p.launchCheck ? { errors: p.launchCheck.errors, claims: p.launchCheck.claims, warnings: p.launchCheck.warnings, reason: p.launchCheck.reason } : null, review: p.designReview?.verdict || null, reported: !!p.launchReport }));
  out.tasks = all(db, 'SELECT t.id, t.title, t.status, t.lane, t.project, t.revisions, ROUND(t.cost_usd,3) usd, a.role, substr(t.result,1,1200) result FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? ORDER BY t.id', floor.id);
  out.messages = s.messages.map((m) => ({ role: m.role, text: m.text }));
  out.cost = floorCost(db, floor.id);
  out.byKind = all(db, 'SELECT kind, model, COUNT(*) n, ROUND(SUM(cost_usd),4) usd FROM ledger WHERE floor_id=? GROUP BY kind, model ORDER BY usd DESC', floor.id);
  out.seconds = Math.round((Date.now() - floor.created_at) / 1000);
  out.paused = !!s.floor.paused;
  save(lane, out);
  clearInterval(watch);
  log('DONE', lane, 'floor cost', out.cost, 'all spend', JSON.stringify(spent(db)));
  log('projects', JSON.stringify(out.projects.map((p) => [p.slug, p.kind, p.url])));
  await app.close(); db.close();
}
const floorCost = (db, id) => Number(get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND kind!='domain'", id).n.toFixed(4));

// The help line for real: the manager really asks, the real CLI lists and answers in its own process against the same database, and the manager really hears.
async function helpTrip() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('keys are not set');
  const { db, app } = await makeApp(true);
  const boss = new Boss(); const made = await boss.claim(db, process.env.PROOF_FLOOR || 'Blocked Bakery', 'Dana');
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
  app.bus.subscribe(floor.id, { ip: 'proof', send: (ev) => {
    if (ev.type === 'feed') log(ev.data.name, ev.data.text);
    if (ev.type === 'message') log('SAYS', `[${ev.data.role}]`, String(ev.data.text).slice(0, 800));
  }, close() {} });
  const cli = (...args) => execFileSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), ...args], { env: { PATH: process.env.PATH, DATA_DIR: join(DIR, 'data') }, encoding: 'utf8' });
  await boss.say(process.env.PROOF_HELP_TEXT || 'I have a question you can\'t answer and nor can I: does this building back up what we publish, and for how long does a published project stay up if I stop visiting? Nobody on the team can know that. Please ask the help line, and tell me what comes back. No other work for now.');
  const until = async (fn, ms, what) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(2000); } };
  await until(() => get(db, "SELECT id FROM help_requests WHERE floor_id=? AND status='pending'", floor.id), 180000, 'the manager to ask');
  await until(() => !app.engine.runs.size, 120000, 'the manager to carry on');
  const before = await boss.state();
  const listing = JSON.parse(cli('help', 'list', '--json'));
  log('CLI LIST', JSON.stringify(listing, null, 1));
  const req = listing.requests.at(-1);
  const file = join(DIR, 'answer.txt');
  writeFileSync(file, process.env.PROOF_HELP_ANSWER || 'Published projects stay up as long as the floor exists, whether or not the boss visits. Backups are not promised to floors, so anything the boss cannot lose should be kept elsewhere as well. Tell the boss both of those things plainly.\n');
  log('CLI ANSWER', cli('help', 'answer', '--id', String(req.id), '--text-file', file).trim());
  const managerSaid = before.messages.filter((m) => m.role === 'manager').length;
  const after = await until(async () => { const s = await boss.state(); return s.messages.filter((m) => m.role === 'manager').length > managerSaid && !app.engine.runs.size && !get(db, 'SELECT manager_wake w FROM floors WHERE id=?', floor.id).w ? s : null; }, 180000, 'the manager to hear');
  const out = {
    floor: made.slug, number: made.number, request: get(db, 'SELECT id,status,question,tried FROM help_requests WHERE floor_id=? ORDER BY id DESC LIMIT 1', floor.id), listing: { fence: listing.fence, requests: listing.requests },
    guidance: after.messages.filter((m) => m.role === 'help').map((m) => m.text), managerBefore: before.messages.filter((m) => m.role === 'manager').map((m) => m.text), managerAfter: after.messages.filter((m) => m.role === 'manager').at(-1)?.text,
    feed: after.feed.map((f) => `${f.name} ${f.text}`), tasks: after.tasks.length, cost: floorCost(db, floor.id),
  };
  save('help', out);
  log('DONE help, floor cost', out.cost, 'all spend', JSON.stringify(spent(db)));
  await app.close(); db.close();
}

const JOBS = {
  game: { company: process.env.PROOF_COMPANY || 'Pocket Arcade', boss: 'Sam', tap: 'Let\'s do a game. What could we build?', go: 'Go with your favourite of those. Keep it small and cheap.' },
  website: { company: process.env.PROOF_COMPANY || 'Corner Spokes', boss: 'Maya', tap: 'Let\'s do a website. What do you need from me?', reply: 'It is for my Saturday bike repair stand, Corner Spokes, in my neighbourhood. People should find out what I fix and join a list so I can tell them when I am next out. I have not settled a location or prices yet, so do not make any up.', go: 'Go, keep it small and cheap.' },
  business: { company: process.env.PROOF_COMPANY || 'Second Shelf', boss: 'Priya', tap: 'Let\'s do a small business. Help me work it out.', reply: 'I want to start a monthly subscription box of second-hand paperback novels picked by theme, for people in the US who read a lot on a budget. Nothing exists yet. I have no customers and no supplier.', go: 'Go. Use the Analyst for the numbers, and keep it cheap.' },
};

async function look() {
  const { db, app } = await makeApp(false);
  const r = report();
  const results = []; let fail = 0;
  const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) fail++; console.log(results.at(-1)); };
  const b = await launch();
  const open = async (f, slug, tag, opts = {}) => {
    const url = `http://${appLabel(db, f, slug)}.apps.localhost:${PORT}/`;
    const p = await b.newPage(opts);
    await p.goto(url); await sleep(2500);
    await p.shot(join(MEDIA, `lanes-${tag}.jpg`));
    return { p, url, text: await p.ev('document.body.innerText') };
  };
  const invented = /testimonial|what (our )?(customers|people) (say|are saying)|★★★|happy customers|trusted by \d|\b\d+ (customers|subscribers|members)\b/i;
  try {
    if (r.game) {
      const f = get(db, 'SELECT * FROM floors WHERE slug=?', r.game.floor);
      const slug = r.game.projects.find((x) => x.kind === 'game')?.slug;
      check('game: it was published as a game', !!slug);
      check('game: a tap started no work', r.game.tapStartedWork === false);
      check('game: a Tester played it', r.game.tasks.some((t) => t.role === 'tester' && ['done', 'review'].includes(t.status)));
      if (slug) {
        const { p, text } = await open(f, slug, 'game-desktop', { width: 1280, height: 800 });
        check('game: no console errors on load', p.errors.length === 0, p.errors.join(' | ').slice(0, 300));
        check('game: it has something to play on', await p.ev('!!document.querySelector("canvas") || document.querySelectorAll("button").length > 0'));
        for (const key of ['Space', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', ' ']) { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === ' ' ? 'Space' : key }); await sleep(120); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key }); await sleep(120); }
        await sleep(1500);
        await p.shot(join(MEDIA, 'lanes-game-playing.jpg'));
        check('game: still no errors after real key presses', p.errors.length === 0, p.errors.join(' | ').slice(0, 300));
        const files = all(db, 'SELECT path,content FROM published_files WHERE floor_id=? AND project=?', f.id, slug).filter((x) => /\.(html|js)$/.test(x.path)).map((x) => String(x.content)).join('');
        check('game: it uses the saved high score', /submitScore/.test(files) && /leaderboard/.test(files));
        check('game: nothing invented on the page', !invented.test(text), text.slice(0, 200));
        const phone = await open(f, slug, 'game-phone', { mobile: true });
        check('game: fits a phone', await phone.p.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
        check('game: no errors on a phone', phone.p.errors.length === 0, phone.p.errors.join(' | ').slice(0, 300));
      }
    }
    if (r.website) {
      const f = get(db, 'SELECT * FROM floors WHERE slug=?', r.website.floor);
      const slug = r.website.projects.find((x) => x.kind === 'site')?.slug;
      check('website: it was published as a site', !!slug);
      check('website: a tap started no work', r.website.tapStartedWork === false);
      if (slug) {
        const { p, text } = await open(f, slug, 'website-desktop', { width: 1280, height: 800 });
        check('website: no console errors', p.errors.length === 0, p.errors.join(' | ').slice(0, 300));
        check('website: nothing invented on the page', !invented.test(text), text.slice(0, 200));
        const html = await p.ev('document.documentElement.outerHTML');
        for (const [n, re] of [['title', /<title>[^<]{3,}/], ['description', /name="description"/], ['og:title', /og:title/], ['favicon', /rel="[^"]*icon/], ['lang', /<html[^>]*lang=/]]) check(`website: has ${n}`, re.test(html));
        check('website: design was reviewed by the other lab', !!r.website.projects.find((x) => x.slug === slug)?.review, r.website.projects.find((x) => x.slug === slug)?.review || 'no review');
        check('website: no working papers went live', !get(db, "SELECT 1 x FROM published_files WHERE floor_id=? AND project=? AND (path LIKE 'notes/%' OR path='TEST-REPORT.md')", f.id, slug));
        const phone = await open(f, slug, 'website-phone', { mobile: true });
        check('website: fits a phone', await phone.p.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
      }
    }
    if (r.business) {
      const f = get(db, 'SELECT * FROM floors WHERE slug=?', r.business.floor);
      const research = r.business.projects.find((x) => x.kind === 'research');
      const plan = r.business.projects.find((x) => x.kind === 'doc');
      const page = r.business.projects.find((x) => x.kind === 'site');
      check('business: research published with cited sources', !!research && research.sources >= 3, `${research?.sources} sources`);
      check('business: a plan published', !!plan);
      check('business: a landing page published', !!page);
      check('business: the report went to the boss', !!page?.reported);
      if (page) {
        const { p, text } = await open(f, page.slug, 'business-landing', { width: 1280, height: 800 });
        check('business: no console errors', p.errors.length === 0, p.errors.join(' | ').slice(0, 300));
        check('business: nothing invented on the page', !invented.test(text), text.slice(0, 200));
        check('business: the page says it is not open yet', /not open|isn.t open|not (yet )?(live|launched|shipping|started)|coming|before we|waitlist|haven.t (started|launched|shipped)/i.test(text), text.slice(0, 200));
        const before = get(db, 'SELECT COUNT(*) n FROM app_forms WHERE floor_id=?', f.id).n;
        const form = await p.ev(`(async()=>{const e=document.querySelector('input[type=email],input[name=email]');if(!e)return 'no email input';e.value='friend@example.com';e.dispatchEvent(new Event('input',{bubbles:true}));const fm=e.closest('form');if(!fm)return 'no form';fm.requestSubmit();await new Promise(r=>setTimeout(r,1500));return document.body.innerText.slice(-500)})()`);
        check('business: the waitlist form stores a real entry', get(db, 'SELECT COUNT(*) n FROM app_forms WHERE floor_id=?', f.id).n === before + 1, String(form).slice(0, 200));
        await p.shot(join(MEDIA, 'lanes-business-waitlist.jpg'));
        check('business: the thank-you promises no automatic email', !/check your (email|inbox)|we.ve sent|confirmation email/i.test(String(form)), String(form).slice(0, 200));
        const phone = await open(f, page.slug, 'business-phone', { mobile: true });
        check('business: fits a phone', await phone.p.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
      }
      if (plan) {
        const md = String(get(db, "SELECT content FROM published_files WHERE floor_id=? AND project=? AND path='index.md'", f.id, plan.slug)?.content ?? '');
        for (const [n, re] of [['target customer', /target customer/i], ['offer and pricing', /offer and pricing/i], ['competitors with links', /competitors[\s\S]*https?:\/\//i], ['numbers marked as estimates', /estimate/i], ['a launch checklist', /launch checklist/i], ['what only a human can do', /only you can do/i]]) check(`business plan: ${n}`, re.test(md));
        await open(f, plan.slug, 'business-plan', { width: 1280, height: 800 });
      }
      if (research) await open(f, research.slug, 'business-research', { width: 1280, height: 800 });
    }
    if (r.help) {
      check('help: the request was answered', r.help.request?.status === 'answered', r.help.request?.status);
      check('help: every floor string was fenced in the real listing', r.help.listing.requests.every((x) => [x.floorName, x.question, x.whatWasTried].every((v) => v.startsWith(`<<<UNTRUSTED_FLOOR_DATA ${r.help.listing.fence} `) && v.endsWith(`<<<END_UNTRUSTED_FLOOR_DATA ${r.help.listing.fence}>>>`))));
      check('help: the guidance reached the chat', r.help.guidance.length === 1);
      check('help: the feed says it asked', r.help.feed.some((l) => /asked buddehbot for help/.test(l)));
      check('help: the feed says it heard back', r.help.feed.some((l) => /heard back from buddehbot/.test(l)));
      check('help: the manager passed it on', /stay up|back ?up/i.test(r.help.managerAfter || ''), (r.help.managerAfter || '').slice(0, 200));
      check('help: no staff were sent off', r.help.tasks === 0);
    }
  } finally { b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  writeFileSync(join(DIR, 'look.txt'), results.join('\n'));
  await app.close(); db.close();
  process.exitCode = fail ? 1 : 0;
}

function spend() {
  const db = openDb(join(DIR, 'data'));
  console.log(JSON.stringify({ ...spent(db), byFloor: all(db, "SELECT f.name, ROUND(SUM(l.cost_usd),3) usd FROM ledger l JOIN floors f ON f.id=l.floor_id WHERE l.kind!='domain' GROUP BY f.id"), byKind: all(db, 'SELECT kind, model, COUNT(*) n, ROUND(SUM(cost_usd),4) usd FROM ledger GROUP BY kind, model ORDER BY usd DESC') }, null, 1));
  db.close();
}

const what = process.argv[2];
if (JOBS[what]) await job(what, JOBS[what]);
else if (what === 'resume' && JOBS[process.argv[3]]) await job(process.argv[3], JOBS[process.argv[3]], true);
else if (what === 'help') await helpTrip();
else if (what === 'look') await look();
else if (what === 'spend') spend();
else { console.error('Usage: node scripts/proof-lanes.mjs game | website | business | help | spend | look'); process.exit(1); }
