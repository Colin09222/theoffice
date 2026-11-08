// The maker flow in real Chrome, in mock mode with no spend:
// 1. The 3-tap launch on a phone and on a desktop: What are we making, an idea card, Go. Then "Team is building", the passes, Launch, a share link.
// 2. Every starter published to its own origin (*.apps.localhost) and put through the Tester's browser half (server/playtest.js): the games
//    played for MAKERS_SECONDS (60 by default) at desktop and phone size with keyboard, touch and gamepad, saving and posting a score to
//    Office Cloud; the app signed up, used, reloaded, signed out and in; the site's layout, links, meta and form.
// MAKERS_SHOTS=dir keeps every screenshot; four go to media/out/office-makers/ when MAKERS_OUT is set.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { launch, sleep } from './cdp.mjs';
import { get, all } from '../../server/db.js';
import { writeFile, publishSnapshot } from '../../server/workspace.js';
import { appLabel } from '../../server/apps.js';
import { starterFiles } from '../../server/makers.js';
import { INIT_SCRIPT, playGame, useApp, walkSite, combine } from '../../server/playtest.js';
import { boot, claim, hostFetch } from '../helpers.js';

const SECONDS = Number(process.env.MAKERS_SECONDS || 60);
const SHOTS = process.env.MAKERS_SHOTS || '/tmp/makers-shots'; mkdirSync(SHOTS, { recursive: true });
const OUT = process.env.MAKERS_OUT || '';
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(ok); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 300)})` : ''}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message); } };

// An OS-assigned port, known before boot so the apps domain can name it and project origins resolve to this server.
const PORT = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const t = await boot({ appsBaseDomain: `apps.localhost:${PORT}`, appsScheme: 'http', mockDelayMs: 350, peopleTalk: false }, {});
await new Promise((r) => t.app.server.close(r));
await new Promise((r) => t.app.server.listen(PORT, '127.0.0.1', r));
const main = `http://localhost:${PORT}`;
t.cfg.publicOrigin = main; t.base = `${main}/theoffice`; t.host = `localhost:${PORT}`;
const base = `${main}/theoffice`;

const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32, ShiftLeft: 16, Enter: 13, Escape: 27, KeyA: 65, KeyD: 68, KeyW: 87, KeyS: 83 };
const KEY = { Space: ' ', ShiftLeft: 'Shift', KeyA: 'a', KeyD: 'd', KeyW: 'w', KeyS: 's' };
/** The playtest's driver over this repo's CDP page. */
function driver(p, { phone, w, h, prefix }) {
  return {
    phone, size: { w, h },
    goto: (u) => p.goto(u),
    eval: (x) => p.ev(x),
    key: (code, down) => p.send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: KEY[code] || code, windowsVirtualKeyCode: VK[code] || 0, ...(down && code === 'Enter' ? { text: '\r' } : {}) }),
    drag: (x1, y1, x2, y2) => p.drag(x1, y1, x2, y2, true),
    shot: async (name) => { const f = join(SHOTS, `${prefix}-${name}.jpg`); await p.shot(f); return f; },
    errors: () => p.errors.filter((e) => !/favicon|Office Cloud: no Office server/.test(e)),
  };
}
const b = await launch();
const kept = {};
try {
  // ---- 1. three taps ----
  for (const [label, opts] of [['phone', { mobile: true }], ['desktop', { width: 1280, height: 800 }]]) {
    const c = await claim(t, `Makers ${label}`);
    const p = await b.newPage(opts);
    await step(`${label}: three taps from a fresh floor to a team that is building`, async () => {
      await p.goto(`${base}/robots.txt`);
      await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, secure: false, sameSite: 'Lax' });
      await p.goto(`${base}/floor/${c.slug}?q=low`);
      await p.until('document.querySelectorAll("[data-launcher] [data-type]").length === 4', 'the four types', 20000);
      const types = await p.ev('[...document.querySelectorAll("[data-launcher] [data-type] b")].map((x) => x.textContent).join("|")');
      check(`${label}: What are we making? offers Game, App / SaaS, Website and Business`, types === 'Game|App / SaaS|Website|Business', types);
      let taps = 0;
      await p.click('[data-launcher] [data-type="game"]'); taps++;
      await p.until('document.querySelectorAll("[data-launcher] [data-idea]").length === 3 && !!document.querySelector("[data-surprise]") && !!document.querySelector("[data-own]")', 'three cards, surprise me and own words');
      if (label === 'phone') { kept.launch = join(SHOTS, `launch-${label}.jpg`); await p.shot(kept.launch); }
      await p.click('[data-launcher] [data-idea]'); taps++;
      await p.until('!!document.querySelector("[data-go]") && document.querySelector(".launch-review input[name=name]").value.length > 1', 'Go, with the name filled in');
      const filled = await p.ev('(() => { const q = (s) => document.querySelector(".launch-review " + s); return !!(q("input[name=name]").value && q("input[name=goal]").value && q("textarea[name=plan]").value.split("\\n").length >= 3); })()');
      check(`${label}: name, goal and plan are filled in and editable`, filled);
      await p.ev('document.querySelector(".launch-review input[name=name]").value = "Moth Patrol"');
      // Whatever the card shows from now on is recorded, so a quick mock team can't finish before the check looks.
      await p.ev('window.__seen = []; new MutationObserver(() => { const m = document.querySelector("[data-maker]"); if (m) window.__seen.push(m.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); true');
      await p.click('[data-go]'); taps++;
      try { await p.until('(window.__seen || []).some((x) => /Team is building/.test(x))', '"Team is building"', 15000); } catch (e) {
        await p.shot(join(SHOTS, `fail-${label}.jpg`));
        throw new Error(`${e.message}: ${await p.ev('JSON.stringify({ tab: window.__office?.tab, panel: window.__office?.panelOpen, maker: !!document.querySelector("[data-maker]"), launcher: !!document.querySelector("[data-launcher]"), stage: window.__office?.state?.makers?.job?.stage, msgs: (window.__office?.state?.messages || []).length })')} ${p.errors.slice(0, 3).join(' | ')}`);
      }
      check(`${label}: "Team is building" after ${taps} taps`, taps === 3);
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
      check(`${label}: the name the boss typed is the job's name`, get(t.db, 'SELECT title FROM maker_jobs WHERE floor_id=?', fid)?.title === 'Moth Patrol');
      try { await p.until('!!document.querySelector("[data-launch]")', 'the Launch button once the Tester passes a version', 30000); } catch (e) {
        await p.shot(join(SHOTS, `fail-launch-${label}.jpg`));
        const j = get(t.db, 'SELECT stage, pass, state FROM maker_jobs WHERE floor_id=?', fid);
        const ts = all(t.db, 'SELECT t.status, a.role FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? ORDER BY t.id', fid).map((x) => `${x.role}:${x.status}`).join(',');
        throw new Error(`${e.message}: job ${j?.stage}/${j?.pass} ${String(j?.state).slice(0, 160)} tasks ${ts} card ${await p.ev('document.querySelector("[data-maker]")?.textContent.slice(0, 160) || "none"')}`);
      }
      await p.click('[data-launch]');
      let url;
      try { url = await p.until('document.querySelector("[data-share-url]")?.href || null', 'a share link', 15000); } catch (e) {
        await p.shot(join(SHOTS, `fail-share-${label}.jpg`));
        throw new Error(`${e.message}: launched ${get(t.db, 'SELECT launched_at l FROM maker_jobs WHERE floor_id=?', fid)?.l} card ${await p.ev('document.querySelector("[data-maker]")?.textContent.slice(0, 200) || "none"')} toast ${await p.ev('[...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | ")')}`);
      }
      check(`${label}: Launch gives a share link on the project's own origin`, /^http:\/\/.+\.apps\.localhost:\d+\/$/.test(url), url);
      const live = await hostFetch(PORT, '/', { headers: { host: new URL(url).host } }); check(`${label}: the shared link opens the game`, live.status === 200 && /kit\.css/.test(await live.text()));
      if (label === 'desktop') await p.shot(join(SHOTS, 'launched-desktop.jpg'));
    });
    p.close();
  }

  // ---- 2. every starter, published and played ----
  const c = await claim(t, 'Starter Co');
  const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const publish = (slug, name, title) => {
    for (const f of starterFiles(name)) writeFile(t.db, floor.id, `projects/${slug}/${f.path}`, f.data.replaceAll('{{TITLE}}', title).replaceAll('{{PITCH}}', `${title}: a starter the Office team builds on, checked in a real browser.`), null, 1e8);
    publishSnapshot(t.db, floor.id, slug, 1e8);
    t.app.engine.upsertProject(floor, slug, { title, kind: name.startsWith('game') ? 'game' : 'site', published: true });
    return `http://${appLabel(t.db, floor, slug)}.apps.localhost:${PORT}/`;
  };
  const views = { desktop: { width: 1280, height: 800 }, phone: { mobile: true } };
  const runOn = async (label, url, fn) => {
    const p = await b.newPage(views[label]);
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SCRIPT });
    const size = label === 'phone' ? { w: 390, h: 844 } : { w: 1280, h: 800 };
    const d = driver(p, { phone: label === 'phone', ...size, prefix: url.split('//')[1].split('--')[0] + `-${label}` });
    try { if (fn === playGame) await p.goto(url); return await fn(d, { url, seconds: SECONDS }); } finally { p.close(); }
  };
  for (const [slug, name, title] of [['arena', 'game-2d', 'Starfall Arena'], ['sky', 'game-3d', 'Sky Arena']]) {
    await step(`${name}: plays`, async () => {
      const url = publish(slug, name, title);
      const runs = [];
      for (const label of ['desktop', 'phone']) {
        const r = await runOn(label, url, playGame); runs.push(r);
        console.log(`  ${name} ${label}: ${JSON.stringify(r.rules)} fps ${r.fps} scenes ${r.scenes?.join(',')} restarts ${r.restarts}${r.notes.length ? ` notes: ${r.notes.join(' ').slice(0, 300)}` : ''}${r.errors?.length ? ` errors: ${r.errors.slice(0, 3).join(' | ').slice(0, 300)}` : ''}`);
      }
      const all = combine(runs);
      for (const [rule, v] of Object.entries(all.rules)) check(`${name}: ${rule}`, v === true, JSON.stringify(runs.map((r) => r.rules[rule])));
      kept[name] = runs[0].shots.find((s) => /-play\.jpg$/.test(s)) || runs[0].shots[0];
      const saves = get(t.db, "SELECT COUNT(*) n FROM cloud_saves WHERE floor_id=? AND project=?", floor.id, slug).n;
      const scores = get(t.db, "SELECT COUNT(*) n FROM cloud_scores WHERE floor_id=? AND project=?", floor.id, slug)?.n ?? 0;
      check(`${name}: the best is saved and a score posted on the server`, saves >= 1 && scores >= 1, `saves ${saves}, scores ${scores}`);
    });
  }
  await step('app: end to end', async () => {
    const url = publish('lists', 'app', 'Tiny Lists');
    for (const label of ['desktop', 'phone']) {
      const r = await runOn(label, url, useApp);
      console.log(`  app ${label}: ${JSON.stringify(r.rules)}${r.notes.length ? ` notes: ${r.notes.join(' ')}` : ''}${r.errors?.length ? ` errors: ${r.errors.slice(0, 3).join(' | ').slice(0, 300)}` : ''}`);
      for (const k of ['loads', 'signup', 'create', 'persist', 'relogin', ...(label === 'phone' ? ['mobile'] : [])]) check(`app ${label}: ${k}`, r.rules[k] === true);
      if (label === 'phone') kept.app = r.shots.find((s) => /-app\.jpg$/.test(s));
    }
    check('app: the item is in the database, private to its owner', get(t.db, "SELECT COUNT(*) n FROM cloud_docs WHERE floor_id=? AND project='lists' AND private=1", floor.id).n >= 2);
  });
  await step('website: layout, links, meta and form', async () => {
    const url = publish('site', 'website', 'Bike Stand');
    for (const label of ['desktop', 'phone']) {
      const r = await runOn(label, url, walkSite);
      console.log(`  site ${label}: ${JSON.stringify(r.rules)}${r.notes.length ? ` notes: ${r.notes.join(' ')}` : ''}${r.errors?.length ? ` errors: ${r.errors.slice(0, 3).join(' | ').slice(0, 300)}` : ''}`);
      for (const k of ['loads', 'links', 'meta', 'form', ...(label === 'phone' ? ['mobile'] : [])]) check(`site ${label}: ${k}`, r.rules[k] === true);
      if (label === 'phone') kept.site = r.shots.find((s) => /-site\.jpg$/.test(s));
    }
    // The same message twice is stored once, by design.
    check('website: the message reached the boss\'s forms', get(t.db, "SELECT COUNT(*) n FROM app_forms WHERE floor_id=? AND project='site'", floor.id).n >= 1);
  });

  // Four pictures: the launcher, the two games mid-play, and the app beside the site.
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    if (kept.launch) copyFileSync(kept.launch, join(OUT, '1-launch-phone.jpg'));
    if (kept['game-2d']) copyFileSync(kept['game-2d'], join(OUT, '2-game-2d.jpg'));
    if (kept['game-3d']) copyFileSync(kept['game-3d'], join(OUT, '3-game-3d.jpg'));
    if (kept.app && kept.site) {
      const img = (f) => `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`;
      const p = await b.newPage({ width: 820, height: 860 });
      const html = `<!doctype html><body style="margin:0;background:#222;display:flex;gap:20px;padding:10px"><img src="${img(kept.app)}" style="width:390px"><img src="${img(kept.site)}" style="width:390px"></body>`;
      writeFileSync(join(SHOTS, 'pair.html'), html);
      await p.goto(`file://${join(SHOTS, 'pair.html')}`); await sleep(400); await p.shot(join(OUT, '4-app-and-site-phone.jpg')); p.close();
    }
  }
} finally {
  b.close();
  await t.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(failures ? 1 : 0);
