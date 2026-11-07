// Screenshots, render stats and first-load bytes for the lobby and the office, in real headless Chrome against the mock server.
// Usage: node scripts/shots-look.mjs [prefix] [desktop|phone|all]   (prefix defaults to "look")
// Prints draw calls, triangles, pixel ratio and the bytes on the wire for a cold load of the lobby and of a floor, at the
// high tier on a desktop viewport and the low tier on a phone viewport, and writes media/<prefix>-*.jpg.
// Headless Chrome here renders in software, so the frame rates it prints say nothing about a real phone.
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../test/browser/cdp.mjs';
import { boot, claim } from '../test/helpers.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../media');
mkdirSync(OUT, { recursive: true });
const prefix = process.argv[2] || 'look';
const only = process.argv[3] || 'all';
const stats = [];

const t = await boot({ mockDelayMs: Number(process.env.SHOT_DELAY || 1100), rateScale: 50 });
const busy = await claim(t, 'Night Bakery', { body: { tagline: 'Warm ideas, baked overnight', colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
const quiet = await claim(t, 'Soup Finder', { body: { tagline: 'Every soup, ranked', colors: { primary: '#c8455a', accent: '#f4c95d' } } });
await quiet.post(`/api/floors/${quiet.slug}/settings`, { decor: { floor: 'terrazzo', wall: '#dfe6ea', plants: 5, pet: 'cat', arcade: true, coffee: true, rug: true, art: true, neon: true } }).catch(() => {});
const base = `http://localhost:${t.port}/theoffice`;

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
async function session(opts, client, q) {
  const b = await launch();
  const p = await b.newPage(opts);
  await p.send('Network.setCacheDisabled', { cacheDisabled: true });
  await p.goto(base);
  await p.send('Network.setCookie', { name: 'office_s', value: client.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  const floor = async (slug) => {
    await p.goto(`${base}/floor/${slug}${q ? `?q=${q}` : ''}`);
    await p.until('document.body.dataset.page === "floor" && !!window.__office && !!window.__office.view', 'floor page');
  };
  return { b, p, floor };
}
async function measure(p, label) {
  await sleep(300);
  // The shadow map redraws every other frame, so two consecutive frames are sampled: the heavier one carries the shadow pass.
  const s = await p.ev(`new Promise((done) => { const one = () => ({ calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles });
    requestAnimationFrame(() => { const a = one(); requestAnimationFrame(() => { const b = one();
      done({ calls: Math.max(a.calls, b.calls), callsLight: Math.min(a.calls, b.calls), tris: Math.max(a.tris, b.tris), trisLight: Math.min(a.tris, b.tris),
        dpr: __stage.renderer.getPixelRatio(), tier: __stage.tier, ao: __stage.q.ao, post: !!__stage.post, fps: Math.round(__stage.fps) }); }); }); })`);
  stats.push({ label, ...s });
  console.log(`  ${label}: ${s.calls} calls (${s.callsLight} on a frame without the shadow pass), ${s.tris} tris (${s.trisLight}), dpr ${s.dpr}, tier ${s.tier}, ao ${s.ao}, post ${s.post}, ~${s.fps} fps (software)`);
  return s;
}
function bytes(p, label) {
  const by = [...p.transfer.byUrl.entries()].filter(([u]) => /\/theoffice\//.test(u));
  const sum = (re) => by.filter(([u]) => re.test(u)).reduce((a, [, n]) => a + n, 0);
  const line = { label, total: p.transfer.total, js: sum(/\/js\//), three: sum(/three\.module/), addons: sum(/addons\.module/), models: sum(/\/models\//), css: sum(/\.css/), fonts: sum(/\/fonts\//), api: sum(/\/api\//) };
  stats.push({ bytes: line });
  console.log(`  ${label} bytes on the wire: ${kb(line.total)} total (app js ${kb(line.js)}, three ${kb(line.three)}, addons ${kb(line.addons)}, models ${kb(line.models)}, css ${kb(line.css)}, fonts ${kb(line.fonts)}, api ${kb(line.api)})`);
  p.transfer.total = 0; p.transfer.byUrl.clear();
}
const shot = (p, name) => p.shot(join(OUT, `${prefix}-${name}.jpg`));
const turn = (p, yaw, zoom) => p.ev(`(() => { const v = window.__office.view; v.targetYaw = ${yaw}; v.targetZoom = ${zoom}; return true; })()`);
const settled = (p) => p.until('(() => { const v = window.__office.view; return !v.loading || v.loading.settled; })()', 'models loaded', 20000).catch(() => {});

for (const [label, opts, q] of [['desktop', { width: 1440, height: 900 }, 'high'], ['phone', { mobile: true }, 'low']]) {
  if (only !== 'all' && only !== label) continue;
  console.log(`\n== ${label} (${q}) ==`);
  const { b, p, floor } = await session(opts, busy, q);
  p.transfer.total = 0; p.transfer.byUrl.clear();
  await p.goto(`${base}/${q ? `?q=${q}` : ''}`);
  await p.until('document.documentElement.classList.contains("ready")', 'ready');
  await sleep(3500);
  await measure(p, `${label} lobby`);
  bytes(p, `${label} lobby cold load`);
  await shot(p, `${label}-lobby`);
  if (label === 'desktop') {
    await p.ev('(() => { const c = window.__lobbyDebug; if (c) { c.targetTheta += 1.1; c.targetRide = 12; c.lastTouch = performance.now(); } return true; })()');
    await sleep(2200);
    await shot(p, 'desktop-lobby-turned');
    await p.ev('(() => { const c = window.__lobbyDebug; if (c) { c.targetTheta -= 2.4; c.targetRide = 44; c.lastTouch = performance.now(); } return true; })()');
    await sleep(2200);
    await shot(p, 'desktop-lobby-high');
  }

  // A quiet floor first: everyone idle at their desks.
  p.transfer.total = 0; p.transfer.byUrl.clear();
  await floor(quiet.slug);
  await settled(p);
  await sleep(3200);
  await measure(p, `${label} office quiet`);
  bytes(p, `${label} office cold load`);
  await shot(p, label === 'desktop' ? 'office-quiet' : 'office-phone-quiet');
  if (label === 'desktop') { await turn(p, 0.95, 1.9); await sleep(1600); await shot(p, 'office-quiet-zoom'); }

  // Then the busy one: a real build, with a meeting at the whiteboard, typing, hand-offs.
  await floor(busy.slug);
  await settled(p);
  await sleep(2600);
  await measure(p, `${label} office idle`);
  await shot(p, label === 'desktop' ? 'office-desktop' : 'office-phone-low');
  if (label === 'desktop') {
    await busy.post(`/api/floors/${busy.slug}/chat`, { text: 'go build midnight rolls' });
    await p.until('window.__office.state.tasks.length === 4', 'plan', 20000);
    await p.until('(() => { const v = window.__office.view; const m = v.manager; return !!m.action || m.path.length > 0; })()', 'manager to board', 8000);
    await sleep(4200);
    await shot(p, 'office-meeting');
    await p.until('[...window.__office.view.actors.values()].some((a) => a.state === "typing")', 'typing', 30000).catch(() => {});
    await sleep(1800);
    await measure(p, 'desktop office busy');
    await shot(p, 'office-desktop-busy');
    await turn(p, 1.1, 1.7); await sleep(1600);
    await shot(p, 'office-desktop-turned');
    await turn(p, -0.1, 2.2); await sleep(1600);
    await shot(p, 'office-desktop-zoom');
    await turn(p, 0.5, 1); await sleep(800);
    await p.ev('window.__office.view.cheer(); true'); await sleep(900);
    await shot(p, 'office-cheer');
  } else {
    await p.until('[...window.__office.view.actors.values()].some((a) => a.state !== "idle")', 'something happening', 30000).catch(() => {});
    await sleep(1500);
    await measure(p, 'phone office busy');
    await shot(p, 'office-phone-busy');
    await turn(p, 1.0, 1.6); await sleep(1600);
    await shot(p, 'office-phone-turned');
  }
  const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
  if (errs.length) console.log(`  console errors: ${errs.slice(0, 5).join(' | ').slice(0, 600)}`);
  p.close(); b.close();
}
console.log('\nSTATS ' + JSON.stringify(stats));
await t.close();
process.exit(0);
