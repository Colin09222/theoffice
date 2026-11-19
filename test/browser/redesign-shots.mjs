// Redesign look checks: home and a floor, as a visitor and as the boss, at desktop (1440x900) and phone (390x844), in mock mode.
// Saves small JPEGs to SHOTS_DIR (default docs/redesign/jobs/$JOB/shots) and fails if any page logged a console error.
// JOB=j01 node test/browser/redesign-shots.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';
import { seedShowcase } from './redesign-seed.mjs';

const JOB = process.env.JOB || 'jXX';
const OUT = process.env.SHOTS_DIR || join('docs/redesign/jobs', JOB, 'shots'); mkdirSync(OUT, { recursive: true });
const WAIT = Number(process.env.SHOTS_WAIT || 4000);
const t = await boot({ mockDelayMs: 2500, peopleTalk: true, towerFloors: 30, fillerCompanies: true, fillerTickMs: 2500 });
const base = `http://localhost:${t.port}/theoffice`;
const boss = await claim(t, 'Tiny Arcade Works', { floor: 5, body: { tagline: 'Small browser games', bossName: 'Colon', colors: { primary: '#17766F', accent: '#F2A33A' } } });
await claim(t, 'LabStackr', { floor: 3, body: { tagline: 'Cash prices for lab tests', bossName: 'Colon', colors: { primary: '#C93A24', accent: '#F6F1E7' } } });
await seedShowcase(t, boss);
await sleep(1500);

const sizes = [['desktop', 1440, 900], ['phone', 390, 844]];
const b = await launch({});
const report = [];
let errors = 0;
for (const [kind, w, h] of sizes) {
  for (const who of ['visitor', 'boss']) {
    const p = await b.newPage(kind === 'phone' ? { phone: { width: w, height: h } } : { width: w, height: h });
    if (who === 'boss') await p.send('Network.setCookie', { name: 'office_s', value: boss.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
    const snap = async (name) => {
      const r = await p.send('Page.captureScreenshot', { format: 'jpeg', quality: 62 });
      const file = join(OUT, `${name}-${who}-${kind}.jpg`);
      writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      report.push(file);
    };
    try {
      await p.goto(`${base}/`);
      await p.until('document.body.dataset.page === "lobby" && !document.querySelector("#boot")', 'lobby', 60000);
      await sleep(WAIT);
      await snap('home');
      await p.goto(`${base}/floor/${boss.slug}`);
      await p.until('document.body.dataset.page === "floor" && !document.querySelector("#boot")', 'floor', 60000);
      await sleep(WAIT + 2000);
      await p.ev('(() => { const v = window.__office?.view; if (v && v.intro < 1) v.intro = 0.999; return true; })()').catch(() => {});
      await sleep(800);
      await snap('floor');
    } catch (e) { console.log('FAILED', kind, who, e.message); errors++; }
    // Not every failed request is a page error (a sound that never loads in a headless box, say); console errors are.
    if (p.errors.length) { console.log('console errors', kind, who, p.errors.slice(0, 6)); errors += p.errors.length; }
    p.close();
  }
}
b.close(); await t.close();
console.log(JSON.stringify({ shots: report.length, consoleErrors: errors }));
process.exit(errors ? 1 : 0);
