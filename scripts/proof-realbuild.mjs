// The one real run: a floor's Builder and Tester make a small game in real Anthropic-hosted containers, and it is then played in a real browser on its own origin.
// Spends real money. Needs ANTHROPIC_API_KEY in the environment. Usage: node scripts/proof-realbuild.mjs build | browser
// Everything lives in PROOF_DIR, so the browser half can be rerun without paying for another build.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, get, all } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { createApp } from '../server/app.js';
import { issueCode } from '../server/auth.js';
import { launch, sleep } from '../test/browser/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.PROOF_DIR || '/tmp/office-proof';
const PORT = Number(process.env.PROOF_PORT || 18083);
const MEDIA = join(ROOT, 'media');
mkdirSync(DIR, { recursive: true }); mkdirSync(MEDIA, { recursive: true });

const BRIEF = `Build a small, genuinely fun, playable browser game called "Orbit Dodge": you steer a little ship around a planet with the arrow keys (or A/D, or by touching the left and right of the screen) and dodge incoming rocks. The score rises the longer you survive. One hit ends the run. Make it look good: canvas, a starfield, a few particles.

It must keep a saved high score with the Office data library: Office.save('high', n) and Office.load('high', 0), and post to a leaderboard with Office.submitScore('top', name, score), showing the top 5 on the game-over screen, with names rendered by textContent. Reloading the page must show the saved high score.

Make it an installable PWA: a web app manifest with an icon, and a service worker that caches the game for offline play.

Use Vite for the build, with base: './', and publish dist/ as kind "game". For our automated check, also expose window.__game with {state} (one of "menu", "playing", "over"), {score}, and a start() method, and let Space or Enter start a run.

Test it for real before you finish: serve dist/, and with Playwright and Chromium play a run with real key presses, confirm the score rises and a game ends, confirm the high score is still there after a reload, and look at a screenshot. Keep it small: one or two source files.`;
const TEST_BRIEF = `Test "Orbit Dodge" in this project. Build it if dist/ is missing, serve dist/ and play it in a real browser with Playwright using real key presses. Check that it starts, the score rises, a collision ends the run, the high score survives a reload, the manifest and service worker are valid, and there are no console errors. Fix anything small and clear. Write TEST-REPORT.md and save.`;

function makeApp(extra = {}) {
  const cfg = loadConfig({ AI_MODE: 'mock', COMPUTER_ENABLED: '1', DATA_DIR: join(DIR, 'data'), ADMIN_PASSWORD: 'proof-only', APPS_BASE_DOMAIN: `apps.localhost:${PORT}`, APPS_SCHEME: 'http', PUBLIC_ORIGIN: `http://localhost:${PORT}`, MOCK_DELAY_MS: '50', FLOOR_DAILY_USD: '4.5', GLOBAL_DAILY_USD: '4.5', TASK_MAX_USD: '3', SESSION_MAX_USD: process.env.PROOF_MAX_USD || '2', ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '' });
  const db = openDb(cfg.dataDir);
  const lines = [];
  const app = createApp({ db, cfg, models: loadModels(), log: (level, msg, x) => { if (level !== 'info') console.log(level, msg, JSON.stringify(x ?? {})); }, ...extra });
  return { db, cfg, app, lines };
}

async function build() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const { createManagedClient } = await import('../server/sessions.js');
  const cfg0 = loadConfig({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
  const { db, app, cfg } = makeApp({ sessions: createManagedClient(cfg0) });
  const engine = app.engine;
  engine.runManager = async () => {}; // the manager is not what's being proved, and its turns would be mock anyway
  await new Promise((r) => app.server.listen(PORT, '127.0.0.1', r));
  engine.start();
  const res = await fetch(`http://localhost:${PORT}/theoffice/api/claim`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://localhost:${PORT}` }, body: JSON.stringify({ code: issueCode(db), name: 'Proof Games', bossName: 'Colin' }) });
  const claim = await res.json();
  if (res.status !== 201) throw new Error(`claim failed: ${JSON.stringify(claim)}`);
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', claim.slug);
  const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
  app.bus.subscribe(floor.id, { ip: 'proof', send: (ev) => { if (ev.type === 'feed') console.log(new Date().toISOString().slice(11, 19), ev.data.name, ev.data.text); }, close() {} });

  const runTask = async (to, title, brief) => {
    const started = Date.now();
    const { id } = engine.assignTask(floor, mgr, { to, title, brief, plan: 'Proof', project: 'orbit-dodge', private: false, dependsOn: [] });
    engine.kick();
    let row;
    while (true) { row = get(db, 'SELECT * FROM tasks WHERE id=?', id); if (['review', 'failed', 'done', 'cancelled'].includes(row.status) && !engine.runs.size) break; if (get(db, 'SELECT paused FROM floors WHERE id=?', floor.id).paused) { console.log('FLOOR PAUSED', get(db, 'SELECT pause_reason r FROM floors WHERE id=?', floor.id).r); break; } await sleep(1000); }
    const ledger = all(db, 'SELECT model,SUM(prompt_tokens) p,SUM(completion_tokens) c,SUM(cost_usd) usd,COUNT(*) n FROM ledger WHERE floor_id=? GROUP BY model', floor.id);
    const out = { id, status: row.status, result: row.result, costUsd: row.cost_usd, seconds: Math.round((Date.now() - started) / 1000), session: row.session_id };
    console.log(JSON.stringify(out, null, 1)); console.log(JSON.stringify(ledger));
    return out;
  };
  const report = { slug: claim.slug, recovery: 'not kept' };
  report.builder = await runTask('builder', 'Build Orbit Dodge', BRIEF);
  const spent = get(db, 'SELECT SUM(cost_usd) n FROM ledger').n;
  if (report.builder.status !== 'failed' && spent < Number(process.env.PROOF_TESTER_UNDER || 2)) {
    engine.hireStaff(floor, 'tester', 'Tess');
    report.tester = await runTask('tester', 'Test Orbit Dodge', TEST_BRIEF);
  }
  report.total = get(db, 'SELECT SUM(cost_usd) n FROM ledger').n;
  report.files = all(db, "SELECT path,size FROM files WHERE floor_id=? ORDER BY path", floor.id);
  report.published = all(db, 'SELECT path,size FROM published_files WHERE floor_id=? ORDER BY path', floor.id);
  writeFileSync(join(DIR, 'report.json'), JSON.stringify(report, null, 1));
  console.log('TOTAL', report.total);
  await app.close(); db.close();
}

async function browser() {
  const report = JSON.parse(readFileSync(join(DIR, 'report.json'), 'utf8'));
  const { db, app } = makeApp();
  app.engine.start();
  const seen = [];
  const inner = app.server.listeners('request')[0];
  app.server.removeAllListeners('request');
  app.server.on('request', (req, res) => { seen.push({ host: req.headers.host, url: req.url, cookie: req.headers.cookie || '' }); inner(req, res); });
  await new Promise((r) => app.server.listen(PORT, '127.0.0.1', r));
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', report.slug);
  const label = get(db, "SELECT label FROM app_labels WHERE floor_id=? AND project='orbit-dodge'", floor.id)?.label
    || (await import('../server/apps.js')).appLabel(db, floor, 'orbit-dodge');
  const origin = `http://${label}.apps.localhost:${PORT}`;
  const results = []; let fail = 0;
  const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) fail++; console.log(results.at(-1)); };
  const b = await launch();
  try {
    const p = await b.newPage({ width: 1280, height: 800 });
    // Sign in on the main origin first, so a real browser holds a real office cookie while it visits the project.
    await p.goto(`http://localhost:${PORT}/theoffice/robots.txt`);
    await p.send('Network.enable');
    await p.send('Network.setCookie', { name: 'office_s', value: 'real-owner-token', url: `http://localhost:${PORT}/theoffice/`, path: '/theoffice', httpOnly: true });
    await p.send('Network.setCookie', { name: 'bhq_auth', value: 'private-site-token', url: `http://localhost:${PORT}/`, path: '/', httpOnly: true });
    await p.goto(`http://localhost:${PORT}/theoffice/f/${report.slug}/orbit-dodge/`);
    await sleep(1500);
    check('the friendly link lands on the project\'s own origin', (await p.ev('location.origin')) === origin, await p.ev('location.href'));
    await p.shot(join(MEDIA, 'realbuild-1-menu.jpg'));
    check('the origin is real, not opaque', (await p.ev('self.origin')) === origin);
    check('localStorage works', await p.ev('(()=>{localStorage.setItem("t","1");return localStorage.getItem("t")==="1"})()'));
    check('document.cookie holds nothing of The Office or the private site', !/office_s|bhq_auth/.test(await p.ev('document.cookie')));
    const reg = await p.ev('navigator.serviceWorker.ready.then(r => r.active ? r.active.state + " " + r.scope : "none")');
    check('a service worker is registered and active', /activated|activating/.test(reg), reg);
    const manifest = await p.ev('(async()=>{const l=document.querySelector("link[rel=manifest]"); if(!l) return null; const r=await fetch(l.href); return {type:r.headers.get("content-type"), json:await r.json()}})()');
    check('a web app manifest is served', !!manifest?.json?.name && /manifest|json/.test(manifest.type), manifest ? `${manifest.json.name}, ${manifest.type}` : 'none');
    check('Office.connected after loading saves', await p.ev('Office.load("high",0).then(()=>Office.connected)'));
    const toMain = await p.ev(`fetch('http://localhost:${PORT}/theoffice/api/me',{credentials:'include'}).then(r=>'status '+r.status).catch(e=>'blocked: '+e.name)`);
    check('the page cannot reach The Office API', /blocked/.test(toMain), toMain);
    const toSibling = await p.ev(`fetch('http://other--floor.apps.localhost:${PORT}/').then(r=>'status '+r.status).catch(e=>'blocked: '+e.name)`);
    check('the page cannot reach another project', /blocked/.test(toSibling), toSibling);
    const before = await p.ev('window.__game && window.__game.state');
    check('the game is up, at its menu', before === 'menu', String(before));
    await p.ev('document.querySelector("canvas") && document.querySelector("canvas").focus()');
    const key = async (type, k, code, vk) => p.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await key('keyDown', ' ', 'Space', 32); await key('keyUp', ' ', 'Space', 32);
    await sleep(600);
    check('a real Space press starts a run', (await p.ev('window.__game.state')) === 'playing');
    await key('keyDown', 'ArrowRight', 'ArrowRight', 39);
    await sleep(1800);
    await p.shot(join(MEDIA, 'realbuild-2-playing.jpg'));
    const during = await p.ev('window.__game.score');
    check('the score rises while playing', during > 0, `score ${during}`);
    let over = false; const until = Date.now() + 90000;
    while (Date.now() < until) { if ((await p.ev('window.__game.state')) === 'over') { over = true; break; } await sleep(500); }
    await key('keyUp', 'ArrowRight', 'ArrowRight', 39);
    check('a real collision ends the run', over);
    const finalScore = await p.ev('window.__game.score');
    await sleep(1500);
    await p.shot(join(MEDIA, 'realbuild-3-gameover.jpg'));
    const saved = await p.ev('Office.load("high",0)');
    check('the high score was saved', saved >= finalScore && saved > 0, `saved ${saved}, run ${finalScore}`);
    const rows = all(db, 'SELECT scope,key,value FROM app_kv WHERE floor_id=?', floor.id);
    check('the save reached the project backend', rows.some((r) => r.key === 'high' && Number(r.value) === saved), JSON.stringify(rows.map((r) => [r.key, r.value])));
    const board = all(db, 'SELECT name,score FROM app_scores WHERE floor_id=?', floor.id);
    check('the leaderboard has the run', board.length >= 1, JSON.stringify(board));
    await p.goto(origin + '/');
    await sleep(1500);
    const text = await p.ev('document.body.innerText');
    const reloaded = await p.ev('Office.load("high",0)');
    check('the high score survives a reload', reloaded === saved, `${reloaded}`);
    await p.shot(join(MEDIA, 'realbuild-4-reloaded.jpg'));
    console.log('page text after reload:', String(text).slice(0, 200));
    const appRequests = seen.filter((r) => r.host?.startsWith(label));
    check('no request to the project origin carried a cookie', appRequests.length > 0 && appRequests.every((r) => !r.cookie), `${appRequests.length} requests checked`);
    const mainWithCookie = seen.filter((r) => r.host === `localhost:${PORT}` && /office_s/.test(r.cookie));
    check('the main origin did get the cookie, so the check above means something', mainWithCookie.length > 0, `${mainWithCookie.length} requests`);
    await p.send('Network.setCacheDisabled', { cacheDisabled: false });
    await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await p.goto(origin + '/').catch(() => {});
    await sleep(1000);
    const offlineOk = await p.ev('!!(window.__game)').catch(() => false);
    check('it loads offline from its service worker', offlineOk === true);
    await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // Refused requests above, a first load with no save yet and no favicon on robots.txt all log something. Anything else is a real error.
    const errs = (p.errors || []).filter((e) => !/Content Security Policy|violates|status of 404|Failed to fetch|ERR_INTERNET_DISCONNECTED|net::ERR/.test(e));
    check('no page errors in the browser', !errs.length, errs.slice(0, 3).join(' | ').slice(0, 300));
  } finally { b.close(); }
  writeFileSync(join(DIR, 'browser.txt'), results.join('\n'));
  console.log(`${results.length - fail} of ${results.length} passed`);
  await app.close(); db.close();
  process.exit(fail ? 1 : 0);
}

await ({ build, browser }[process.argv[2]] || (() => { throw new Error('say build or browser'); }))();
