// Phones (docs/redesign, job 16): no 3D code loads until "Watch the room" is tapped, on the home page and on floors; the page weight before
// that is under 300 KB, and first paint is under 2 seconds on a mid-range phone over 4G. Measured here with a cold cache, the CPU slowed 4x
// and the network held to DevTools' "Fast 4G" (9 Mbit/s down, 1.5 Mbit/s up, 60 ms latency); Lighthouse's "Slow 4G" (1.6 Mbit/s,
// 750 kbit/s, 150 ms) is reported too, as a harder case. npm run e2e:phone   PHONE_REPORT=file.json writes the numbers.
import { writeFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';
import { seedShowcase } from './redesign-seed.mjs';

const t = await boot({ mockDelayMs: 2500, towerFloors: 30 });
const base = `http://localhost:${t.port}/theoffice`;
const boss = await claim(t, 'Tiny Arcade Works', { floor: 5 });
const lab = await claim(t, 'LabStackr', { floor: 3 });
await seedShowcase(t, boss, { others: [lab.slug] });
const b = await launch({});
const THREE_D = /three\.module|\/js\/stage\.js|stage-start|lobby-scene|tower-nav|office-scene|addons|\.glb|\/models\/|\/assets\/3d\/|\/assets\/tex\/|character\.js|portrait\.js|floor-ui\.js/;
const NETS = {
  'fast-4g': { latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 },
  'slow-4g': { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 },
};
const MARK = `window.__shown = null; new MutationObserver(() => { if (window.__shown === null && !document.querySelector('#boot') && document.querySelector('.home-dir .dir-row, .floor-lite .status-card')) window.__shown = performance.now(); }).observe(document, { subtree: true, childList: true, attributes: true });`;
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const report = [];

async function measure(path, { net, who }) {
  const p = await b.newPage({ phone: { width: 390, height: 844 } });
  await p.send('Network.setCacheDisabled', { cacheDisabled: true });
  await p.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.send('Network.emulateNetworkConditions', { offline: false, ...NETS[net] });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: MARK });
  if (who === 'boss') await p.send('Network.setCookie', { name: 'office_s', value: boss.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  const urls = [];
  p.on('Network.requestWillBeSent', (e) => urls.push(e.request.url));
  p.transfer.total = 0; p.transfer.byUrl.clear();
  await p.goto(`${base}${path}`);
  await p.until('window.__shown !== null', 'content', 30000);
  await sleep(1500);  // whatever else the page fetches once it is up, so the weight counts it
  const fcp = await p.ev('performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint")?.startTime ?? null');
  const shown = await p.ev('window.__shown');
  const bytes = p.transfer.total;
  const threeD = urls.filter((u) => THREE_D.test(u));
  const row = { path: path.replace(/floor\/[a-z0-9-]+/, 'floor/<slug>'), who, net, kb: Math.round(bytes / 1024), firstContentfulPaintMs: fcp && Math.round(fcp), contentShownMs: Math.round(shown), threeDRequests: threeD.length };
  report.push(row);
  console.log('  ', JSON.stringify(row));
  return { p, row, threeD };
}

try {
  for (const net of ['fast-4g', 'slow-4g']) {
    for (const [path, who] of [['/', 'visitor'], [`/floor/${boss.slug}`, 'visitor'], [`/floor/${boss.slug}`, 'boss']]) {
      const { p, row, threeD } = await measure(path, { net, who });
      const tag = `${net} ${row.path} ${who}`;
      check(!threeD.length, `${tag}: no 3D code before the tap ${threeD.slice(0, 2).join(' ')}`);
      if (net === 'fast-4g') {
        check(row.kb < 300, `${tag}: page weight ${row.kb} KB, under 300`);
        check(row.contentShownMs < 2000 && (row.firstContentfulPaintMs ?? 0) < 2000, `${tag}: first paint ${row.firstContentfulPaintMs} ms, content ${row.contentShownMs} ms, under 2000`);
      }
      // On a floor, tapping Watch the room brings the room in: now the 3D code loads.
      if (path !== '/' && net === 'fast-4g' && who === 'visitor') {
        await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await p.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await p.click('[data-watch-room]');
        await p.until('document.body.dataset.page === "floor" && !!window.__office', 'the room', 120000);
        check(await p.ev('performance.getEntriesByType("resource").some((e) => /three\\.module/.test(e.name))'), 'Watch the room: the room and its 3D code load on the tap');
      }
      check(!p.errors.length, `${tag}: no console errors ${p.errors.slice(0, 2).join(' | ')}`);
      p.close();
    }
  }
} catch (e) { console.log('FAIL', e.message); failed++; }
if (process.env.PHONE_REPORT) writeFileSync(process.env.PHONE_REPORT, JSON.stringify(report, null, 1));
b.close(); await t.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
