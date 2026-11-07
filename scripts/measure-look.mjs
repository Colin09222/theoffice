// Real numbers on this machine's real GPU, against the mock server: uncapped frame rates (no vsync, no 60fps limit) and bytes on the
// wire for a first visit and a return visit. macOS only as written (ANGLE on Metal); the test suites use a software renderer instead.
// Usage: node scripts/measure-look.mjs            (no model is called; AI_MODE=mock)
import { launch, sleep } from '../test/browser/cdp.mjs';
import { boot, claim } from '../test/helpers.js';

const t = await boot({ mockDelayMs: 600, rateScale: 50 });
const c = await claim(t, 'Night Bakery', { floor: 12, body: { tagline: 'Warm ideas', colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
await claim(t, 'Soup Finder', { floor: 25, body: { tagline: 'Every soup, ranked', colors: { primary: '#c8455a', accent: '#f4c95d' } } });
const base = `http://localhost:${t.port}/theoffice`;
const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const kb = (n) => `${Math.round(n / 1024)} KB`;
const ready = (p) => p.until('document.documentElement?.classList.contains("ready")', 'ready', 60000);
const frames = (p, ms = 3000) => p.ev(`new Promise((done) => { __stage.adapt = () => {}; const ts = []; const start = performance.now(); let last = start, n = 0; const f = (now) => { n++; ts.push(now - last); last = now; if (now - start < ${ms}) requestAnimationFrame(f); else { const d = ts.slice(1).sort((a, b) => a - b); done({ fps: Math.round(n / ((now - start) / 1000)), p50: +d[Math.floor(d.length / 2)].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), tier: __stage.tier, ao: __stage.q.ao, dpr: __stage.renderer.getPixelRatio(), calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles, gpu: __stage.gpu }); } }; requestAnimationFrame(f); })`);
const line = (name, s) => console.log(`  ${name}: ${s.fps} fps (median ${s.p50} ms, p95 ${s.p95} ms), tier ${s.tier}, occlusion ${s.ao}, pixel ratio ${s.dpr}, ${s.calls} draw calls, ${Math.round(s.tris / 1000)}k triangles`);

const b = await launch({ args: GPU, noAngle: true });
console.log('Frame rates, uncapped:');
for (const [name, opts, dsf, q] of [['desktop 1440x900 at 2x', { width: 1440, height: 900 }, 2, 'high'], ['desktop 1440x900 at 1x', { width: 1440, height: 900 }, 1, 'high'], ['phone 390x844 mid', { mobile: true }, 3, 'mid'], ['phone 390x844 low', { mobile: true }, 3, 'low']]) {
  const p = await b.newPage(opts);
  if (dsf) await p.send('Emulation.setDeviceMetricsOverride', opts.mobile ? { width: 390, height: 844, deviceScaleFactor: dsf, mobile: true } : { width: opts.width, height: opts.height, deviceScaleFactor: dsf, mobile: false });
  await p.goto(`${base}/?q=${q}`); await ready(p); await sleep(2000);
  line(`${name}, lobby`, await frames(p));
  await p.goto(`${base}/floor/${c.slug}?q=${q}`); await ready(p); await sleep(2000);
  line(`${name}, floor`, await frames(p));
  if (name.includes('2x')) console.log(`  on: ${(await frames(p, 200)).gpu}`);
  p.close(); await sleep(300);
}
console.log('Bytes on the wire (empty cache, cache on):');
for (const [name, opts, q] of [['desktop, high', { width: 1440, height: 900 }, 'high'], ['phone, mid', { mobile: true }, 'mid'], ['phone, low', { mobile: true }, 'low']]) {
  const p = await b.newPage(opts);
  await p.send('Network.clearBrowserCache');
  p.transfer.total = 0;
  await p.goto(`${base}/?q=${q}`); await ready(p);
  const atReady = p.transfer.total;
  await sleep(7000);
  const settled = p.transfer.total;
  console.log(`  ${name}: lobby ${kb(atReady)} when ready, ${kb(settled)} once the floor code has been fetched in the background`);
  p.close(); await sleep(300);
  const f = await b.newPage(opts);
  await f.send('Network.clearBrowserCache');
  f.transfer.total = 0;
  await f.goto(`${base}/floor/${c.slug}?q=${q}`); await ready(f); await sleep(2500);
  const cold = f.transfer.total;
  f.transfer.total = 0;
  await f.goto(`${base}/floor/${c.slug}?q=${q}`); await ready(f); await sleep(2000);
  console.log(`  ${name}: floor by direct link ${kb(cold)} on a first visit, ${kb(f.transfer.total)} on a return visit`);
  f.close(); await sleep(300);
}
b.close();
await t.close();
process.exit(0);
