// The home page, first content then the tower (docs/redesign, job 14): real browser, mock mode.
// 1. Desktop: the hero, Happening now and the floor list are in the page before any 3D code (three.js, the stage, the tower) is requested,
//    and the tower comes after, in a frame about a third of the width.
// 2. Phone: no 3D code is requested at all.
// 3. No WebGL: the tower frame goes away and the floor list stays.
// 4. The feed fails: Happening now is hidden, with no error shown.
// npm run e2e:home
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';
import { seedShowcase } from './redesign-seed.mjs';

const t = await boot({ mockDelayMs: 2500, towerFloors: 30 });
const base = `http://localhost:${t.port}/theoffice`;
const boss = await claim(t, 'Tiny Arcade Works', { floor: 5 });
const lab = await claim(t, 'LabStackr', { floor: 3 });
await seedShowcase(t, boss, { others: [lab.slug] });
const b = await launch({});
const THREE_D = /three\.module|\/js\/stage\.js|lobby-scene|tower-nav|office-scene|addons/;
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
// Marks the moment each piece of content lands in the page, from the very first script on.
const WATCH = `window.__seen = {}; new MutationObserver(() => { for (const s of ['.hero-strip:not([hidden])', '.home-now:not([hidden])', '.home-dir .dir-row', '.home-tower.ready']) if (!window.__seen[s] && document.querySelector(s)) window.__seen[s] = performance.now(); }).observe(document, { subtree: true, childList: true, attributes: true });`;
async function page(opts, { noGl = false, failFeed = false } = {}) {
  const p = await b.newPage(opts);
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH + (noGl ? 'HTMLCanvasElement.prototype.getContext = function () { return null; };' : '') });
  if (failFeed) {
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*building/ticker*' }] });
    p.on('Fetch.requestPaused', (e) => { p.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'Failed' }).catch(() => {}); });
  }
  await p.goto(`${base}/`);
  await p.until('document.body.dataset.page === "lobby" && !document.querySelector("#boot")', 'home', 60000);
  return p;
}
const firstThreeD = (p) => p.ev(`(() => { const r = performance.getEntriesByType('resource').filter((e) => ${THREE_D}.test(e.name)).map((e) => e.startTime); return r.length ? Math.min(...r) : null; })()`);

try {
  // 1. Desktop.
  let p = await page({ width: 1440, height: 900 });
  await p.until('!!document.querySelector(".home-tower.ready")', 'the tower', 60000);
  await sleep(500);
  const seen = await p.ev('window.__seen');
  const first3d = await firstThreeD(p);
  console.log('  content at', JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, Math.round(v)]))), 'first 3D request at', Math.round(first3d));
  check(first3d !== null, 'desktop: the tower loads');
  check(seen['.hero-strip:not([hidden])'] < first3d && seen['.home-now:not([hidden])'] < first3d && seen['.home-dir .dir-row'] < first3d, 'desktop: hero, Happening now and the floor list are in the page before any 3D code is requested');
  const frame = await p.ev('(() => { const r = document.querySelector(".home-tower").getBoundingClientRect(); const c = document.querySelector("#scene").getBoundingClientRect(); return { share: r.width / innerWidth, canvas: Math.abs(c.width - r.width) < 2 && Math.abs(c.left - r.left) < 2 }; })()');
  check(frame.share > 0.28 && frame.share < 0.36 && frame.canvas, `desktop: the tower frame is about a third of the width (${frame.share.toFixed(2)}), and the canvas sits in it`);
  check(await p.ev('document.querySelectorAll(".home-dir .lift-btn").length === 2 && /floors to let/.test(document.querySelector(".to-let").textContent)'), 'the lift: open floors only, plus N floors to let');
  check(!p.errors.length, `desktop: no console errors ${p.errors.slice(0, 2).join(' | ')}`);
  p.close();
  // 2. Phone.
  p = await page({ phone: { width: 390, height: 844 } });
  await sleep(4000);
  check(await firstThreeD(p) === null, 'phone: no 3D code is requested on the home page');
  check(await p.ev('!!document.querySelector(".home-dir .dir-row") && getComputedStyle(document.querySelector(".home-tower")).display === "none"'), 'phone: the floor list is there, the tower frame is not');
  check(!p.errors.length, 'phone: no console errors');
  p.close();
  // 3. No WebGL.
  p = await page({ width: 1440, height: 900 }, { noGl: true });
  await p.until('document.querySelector(".home-tower")?.hidden === true', 'the frame to go', 30000).catch(() => {});
  check(await p.ev('document.querySelector(".home-tower").hidden && document.querySelectorAll(".home-dir .dir-row").length === 2'), 'no WebGL: the tower frame goes, the floor list shows');
  p.close();
  // 4. The feed fails.
  p = await page({ width: 1440, height: 900 }, { failFeed: true });
  await sleep(2500);
  check(await p.ev('document.querySelector(".home-now").hidden === true && !/error|failed|wrong/i.test(document.querySelector(".home").textContent)'), 'feed fails: Happening now is hidden, and no error is shown');
  p.close();
} catch (e) { console.log('FAIL', e.message); failed++; }
b.close(); await t.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
