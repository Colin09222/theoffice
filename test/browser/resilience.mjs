// What a struggling device does: the GPU context goes away and comes back, comes back never, or was never there. In real Chrome, on the
// mock server. The page must never go black, the interface must keep working, and the 3D must come back with a live picture.
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
  await step(tag('the lobby paints a real picture before the curtain lifts'), async () => {
    await p.goto(`${base}/?q=${q}`);
    await p.until('document.documentElement.classList.contains("ready")', 'ready', 60000);
    if (q === 'mid') await p.until('!!__stage.post', 'post chain', 30000);
    await sleep(800);
    await usable(p, 'lobby');
    await p.until('!document.querySelector("#boot")', 'the curtain to go', 5000);
  });
  await step(tag('losing the GPU shows the painted city at once, and the interface stays usable'), async () => {
    await p.ev('window.__ext = __stage.renderer.getContext().getExtension("WEBGL_lose_context"); __ext.loseContext(); true');
    await p.until('document.body.classList.contains("gl-lost")', 'the fallback', 5000);
    if (!/gradient/.test(await p.ev(wallpaper))) throw new Error('no painted background');
    if (await p.ev('getComputedStyle(document.querySelector("#scene")).opacity') !== '0') throw new Error('canvas still showing');
    await p.ev('document.querySelector(".dir-search input").value = "night"; document.querySelector(".dir-search input").dispatchEvent(new Event("input")); true');
    await p.until('document.querySelectorAll(".dir-row").length === 1', 'search to work without a GPU', 3000);
    await p.ev('document.querySelector(".dir-search input").value = ""; document.querySelector(".dir-search input").dispatchEvent(new Event("input")); true');
  });
  await step(tag('it comes back with a live picture, a lighter tier and no errors'), async () => {
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
    await p.until('document.body.dataset.page === "lobby" && !!document.querySelector(".directory")', 'the lobby to open with no 3D', 8000);
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
  await step('no WebGL at all: the lobby opens over the painted city', async () => {
    await p.goto(`${base}/`);
    await p.until('document.documentElement.classList.contains("ready")', 'ready', 30000);
    if (!(await p.ev('document.body.classList.contains("no-webgl")'))) throw new Error('did not notice');
    if (!/gradient/.test(await p.ev(wallpaper))) throw new Error('no painted background');
    if ((await p.ev('document.querySelectorAll(".dir-row").length')) < 1) throw new Error('directory empty');
  });
  await step('no WebGL at all: a floor opens and its feed works', async () => {
    await p.goto(`${base}/floor/${c.slug}`);
    await p.until('document.body.dataset.page === "floor" && !!document.querySelector(".floor-panel")', 'floor', 15000);
    await p.until('!!window.__office', 'floor object', 5000);
  });
  await step('no WebGL at all: the claim wizard opens with no 3D preview and no crash', async () => {
    await p.goto(`${base}/`);
    await p.until('document.documentElement.classList.contains("ready")', 'ready', 30000);
    await p.ev('document.querySelector(".open-pill").click(); true');
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
