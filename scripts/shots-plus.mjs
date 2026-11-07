// Screenshots and render stats for the walk-in office, in real headless Chrome against the mock server.
// Usage: node scripts/shots-plus.mjs [prefix]   (prefix defaults to "plus")
// Prints draw calls / triangles / dpr for the lobby and the office at the high and low tiers, and writes media/<prefix>-*.jpg.
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../test/browser/cdp.mjs';
import { boot, claim } from '../test/helpers.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../media');
mkdirSync(OUT, { recursive: true });
const prefix = process.argv[2] || 'plus';
const stats = [];

const t = await boot({ mockDelayMs: Number(process.env.SHOT_DELAY || 1100), rateScale: 50 });
const busy = await claim(t, 'Night Bakery', { body: { tagline: 'Warm ideas, baked overnight', colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
const quiet = await claim(t, 'Soup Finder', { body: { tagline: 'Every soup, ranked', colors: { primary: '#c8455a', accent: '#f4c95d' } } });
await quiet.post(`/api/floors/${quiet.slug}/settings`, { decor: { floor: 'terrazzo', wall: '#dfe6ea', plants: 5, pet: 'cat', arcade: true, coffee: true, rug: true, art: true, neon: true } }).catch(() => {});
const base = `http://localhost:${t.port}/theoffice`;

async function session(opts, client, q) {
  const b = await launch();
  const p = await b.newPage(opts);
  await p.goto(base);
  await p.send('Network.setCookie', { name: 'office_s', value: client.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  const floor = async (slug) => {
    await p.goto(`${base}/floor/${slug}${q ? `?q=${q}` : ''}`);
    try { await p.until('document.body.dataset.page === "floor" && !!window.__office && !!window.__office.view', 'floor page'); } catch (e) {
      console.log('floor did not load:', await p.ev('JSON.stringify({ page: document.body.dataset.page, href: location.href, txt: document.body.textContent.slice(0, 120) })'), p.errors.slice(0, 3));
      throw e;
    }
  };
  return { b, p, floor };
}
async function measure(p, label) {
  await sleep(300);
  const s = await p.ev('({ calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles, dpr: __stage.renderer.getPixelRatio(), tier: __stage.tier, fps: Math.round(__stage.fps) })');
  stats.push({ label, ...s });
  console.log(`  ${label}: ${s.calls} calls, ${s.tris} tris, dpr ${s.dpr}, tier ${s.tier}, ~${s.fps} fps`);
  return s;
}
const shot = (p, name) => p.shot(join(OUT, `${prefix}-${name}.jpg`));
const turn = (p, yaw, zoom) => p.ev(`(() => { const v = window.__office.view; v.targetYaw = ${yaw}; v.targetZoom = ${zoom}; return true; })()`);

for (const [label, opts, q] of [['desktop', { width: 1440, height: 900 }, 'high'], ['phone', { mobile: true }, 'low']]) {
  console.log(`\n== ${label} (${q}) ==`);
  const { b, p, floor } = await session(opts, busy, q);
  await p.goto(`${base}/${q ? `?q=${q}` : ''}`);
  await p.until('document.documentElement.classList.contains("ready")', 'ready');
  await sleep(3000);
  await measure(p, `${label} lobby`);
  await shot(p, `${label}-lobby`);

  // A quiet floor first: everyone idle at their desks.
  await floor(quiet.slug);
  await sleep(3200);
  await measure(p, `${label} office quiet`);
  await shot(p, label === 'desktop' ? 'office-quiet' : 'office-phone-quiet');
  if (label === 'desktop') { await turn(p, 0.95, 1.9); await sleep(1600); await shot(p, 'office-quiet-zoom'); }

  // Then the busy one: a real build, with a meeting at the whiteboard, typing, hand-offs.
  await floor(busy.slug);
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
    // The busy floor is still running from the desktop pass.
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
