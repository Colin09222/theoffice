// What a struggling device does: the GPU context goes away and comes back, comes back never, or was never there. In real Chrome, on the
// mock server. The page must never go black, the interface must keep working, and the 3D must come back with a live picture.
// Since the redesign the home page draws without 3D and its small tower comes last on a desktop; a phone has no 3D on the home page at all,
// and its floor's room loads on Watch the room (docs/redesign, jobs 14 and 16).
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const t = await boot({ mockDelayMs: 30, rateScale: 50 });
const c = await claim(t, 'Night Bakery', { body: { tagline: 'Warm ideas', colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
const base = `http://localhost:${t.port}/theoffice`;
let failures = 0; const results = [];
const step = async (name, fn) => { try { await fn(); results.push(`PASS ${name}`); console.log(`  ok  ${name}`); } catch (e) { failures++; results.push(`FAIL ${name}`); console.log(`  FAIL ${name}: ${e.message}`); } };
// A frame on demand and a pixel read straight after it, in one task, so the drawing buffer can't have been cleared in between. Post chain included.
const PIXEL = `(() => { __stage.renderOnce(0.016); const gl = __stage.renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; const out = []; for (const [fx, fy] of [[0.5, 0.75], [0.3, 0.5], [0.6, 0.4]]) { const px = new Uint8Array(4); gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(px[0] + px[1] + px[2]); } return Math.max(...out); })()`;
const usable = async (p, what) => { const v = await p.ev(PIXEL); if (!(v > 40)) throw new Error(`${what}: the picture is black (${v})`); };
const wallpaper = `getComputedStyle(document.body).backgroundImage`;

async function losing(label, opts, q) {
  const b = await launch();
  const p = await b.newPage(opts);
  const tag = (s) => `${label}: ${s}`;
  const phone = !!opts.mobile;
  if (phone) await step(tag('the home page needs no GPU: no 3D starts, and the floor list is there'), async () => {
    await p.goto(`${base}/?q=${q}`);
    await p.until('document.documentElement.classList.contains("ready") && !document.querySelector("#boot")', 'ready', 60000);
    await sleep(800);
    if (await p.ev('!!window.__stage')) throw new Error('3D started on a phone home page');
    if ((await p.ev('document.querySelectorAll(".home-dir .dir-row").length')) < 1) throw new Error('no floor list');
  });
  if (!phone) await step(tag('the home page paints its tower a real picture'), async () => {
    await p.goto(`${base}/?q=${q}`);
    await p.until('document.documentElement.classList.contains("ready") && !document.querySelector("#boot")', 'ready', 60000);
    await p.until('!!window.__stage && !!document.querySelector(".home-tower.ready")', 'the tower', 60000);
    if (q === 'mid') await p.until('!!__stage.post', 'post chain', 30000);
    await sleep(800);
    await usable(p, 'lobby');
  });
  if (!phone) await step(tag('losing the GPU hides the tower at once, and the home page stays usable'), async () => {
    await p.ev('window.__ext = __stage.renderer.getContext().getExtension("WEBGL_lose_context"); __ext.loseContext(); true');
    await p.until('document.body.classList.contains("gl-lost")', 'the fallback', 5000);
    if (await p.ev('getComputedStyle(document.querySelector("#scene")).opacity') !== '0') throw new Error('canvas still showing');
    // The floor list is the way round without the tower: its rows still take you in.
    if ((await p.ev('document.querySelectorAll(".home-dir .dir-row").length')) !== 1) throw new Error('floor list');
    if (!(await p.ev('(() => { const r = document.querySelector(".home-dir .dir-row").getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest(".dir-row"); })()'))) throw new Error('the floor row is covered');
  });
  if (!phone) await step(tag('it comes back with a live picture, a lighter tier and no errors'), async () => {
    const before = await p.ev('__stage.frame');
    await p.ev('__ext.restoreContext(); true');
    await p.until('!document.body.classList.contains("gl-lost")', 'recovery', 8000);
    await p.until(`__stage.frame > ${before + 4}`, 'the loop to run again', 40000);
    if (q === 'mid') { const tier = await p.ev('__stage.tier'); if (tier !== 'mid') throw new Error(`forced tier moved to ${tier}`); }
    await sleep(800);
    await usable(p, 'lobby after restore');
    if (!(await p.ev('__stage.renderer.info.render.calls')) > 0) throw new Error('nothing drawn');
    const env = await p.ev('!!__lobbyDebug.scene.environment === !!__stage.floatTargets');
    if (!env) throw new Error('reflections were not rebaked');
  });
  await step(tag('it also survives on a floor, with the people and furniture back'), async () => {
    await p.goto(`${base}/floor/${c.slug}?q=${q}`);
    await p.room();  // a phone opens the floor without its room until Watch the room (docs/redesign, job 16)
    await p.until('document.documentElement.classList.contains("ready") && !!window.__office && !!window.__office.view', 'floor', 60000);
    await p.ev('window.__office.ready');
    await sleep(600);
    await usable(p, 'floor');
    await p.ev('window.__ext = __stage.renderer.getContext().getExtension("WEBGL_lose_context"); __ext.loseContext(); true');
    await p.until('document.body.classList.contains("gl-lost")', 'the fallback', 5000);
    if (!(await p.ev('!!document.querySelector(".floor-panel") && !!document.querySelector(".tabs")'))) throw new Error('panel gone');
    await sleep(300);
    await p.ev('__ext.restoreContext(); true');
    await p.until('!document.body.classList.contains("gl-lost")', 'recovery', 8000);
    await sleep(1000);
    await usable(p, 'floor after restore');
  });
  await step(tag('a third loss gives up on 3D for the visit, and the page still works'), async () => {
    await p.ev('__stage.losses = 2; __ext.loseContext(); true');
    await p.until('document.body.classList.contains("gl-lost")', 'the fallback', 5000);
    await sleep(200);
    await p.ev('__ext.restoreContext(); true');
    await p.until('document.body.classList.contains("no-webgl")', 'giving up', 8000);
    if (await p.ev('__stage.ok')) throw new Error('stage still claims to be ok');
    if (!/gradient/.test(await p.ev(wallpaper))) throw new Error('no painted background');
    if (!(await p.ev('!!document.querySelector(".floor-panel")'))) throw new Error('panel gone');
    await p.ev('window.officeGo("/"); true');
    await p.until('document.body.dataset.page === "lobby" && !!document.querySelector(".home-dir .dir-row")', 'the home page to open with no 3D', 8000);
    if (!phone) await p.until('document.querySelector(".home-tower")?.hidden === true', 'the tower frame to go, the floor list stays', 8000);
  });
  await step(tag('no console errors from all of that'), async () => {
    const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429|CONTEXT_LOST|context lost|Context Lost/i.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  p.close(); b.close();
}

await losing('desktop', { width: 1440, height: 900 }, 'mid');
await losing('phone', { mobile: true }, 'low');

// A browser with no WebGL at all: the wizard, the directory and a floor must all still work.
{
  const b = await launch({ args: ['--disable-3d-apis'], noAngle: true });
  const p = await b.newPage({ mobile: true });
  // A phone's home page asks for no 3D, so it never needs to notice there is none.
  await step('no WebGL at all: the home page opens with its floor list', async () => {
    await p.goto(`${base}/`);
    await p.until('document.documentElement.classList.contains("ready")', 'ready', 30000);
    if ((await p.ev('document.querySelectorAll(".home-dir .dir-row").length')) < 1) throw new Error('directory empty');
  });
  await step('no WebGL at all: a desktop home page drops the tower frame and keeps the floor list', async () => {
    const d = await b.newPage({ width: 1440, height: 900 });
    await d.goto(`${base}/`);
    await d.until('document.documentElement.classList.contains("ready") && document.querySelectorAll(".home-dir .dir-row").length >= 1', 'home', 30000);
    await d.until('document.querySelector(".home-tower")?.hidden === true', 'the tower frame gone', 15000);
    d.close();
  });
  await step('no WebGL at all: a floor opens without its room, then with the room asked for its panel still works over the painted city', async () => {
    await p.goto(`${base}/floor/${c.slug}`);
    await p.until('document.body.dataset.page === "floor-lite" && !!document.querySelector(".status-card")', 'the floor without its room', 15000);
    await p.room();
    await p.until('document.body.dataset.page === "floor" && !!document.querySelector(".floor-panel")', 'floor', 15000);
    await p.until('!!window.__office', 'floor object', 5000);
    if (!(await p.ev('document.body.classList.contains("no-webgl")'))) throw new Error('did not notice');
    if (!/gradient/.test(await p.ev(wallpaper))) throw new Error('no painted background');
  });
  await step('no WebGL at all: the claim wizard opens with no 3D preview and no crash', async () => {
    await p.goto(`${base}/`);
    await p.until('document.documentElement.classList.contains("ready")', 'ready', 30000);
    await p.ev('document.querySelector(".open-office").click(); true');
    await p.until('!!document.querySelector(".modal")', 'the wizard', 8000);
  });
  await step('no WebGL at all: no uncaught exceptions', async () => {
    const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429|WebGL|webgl|Error creating/i.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  p.close(); b.close();
}
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed`);
await t.close();
process.exit(failures ? 1 : 0);
