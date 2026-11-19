// The boss's Business tab (docs/redesign, job 22): Numbers, Orders, Payments, Inbox and Launch live under one tab, each the same panel as
// before; a visitor has no such tab. Real browser, mock mode. npm run e2e:biztab
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';
import { seedShowcase } from './redesign-seed.mjs';

const t = await boot({ mockDelayMs: 2500, towerFloors: 30 });
const base = `http://localhost:${t.port}/theoffice`;
const boss = await claim(t, 'Tiny Arcade Works', { floor: 5 });
await seedShowcase(t, boss);
const b = await launch({});
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
try {
  for (const who of ['visitor', 'boss']) {  // the visitor first: the boss's cookie stays in this browser
    const p = await b.newPage({ width: 1440, height: 900 });
    if (who === 'boss') await p.send('Network.setCookie', { name: 'office_s', value: boss.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
    await p.goto(`${base}/floor/${boss.slug}`);
    await p.until('document.body.dataset.page === "floor" && !!window.__office && !document.querySelector("#boot")', 'floor', 120000);
    const tabs = await p.ev('[...document.querySelectorAll(".tabs .tab[data-tab]")].map((x) => x.dataset.tab)');
    if (who === 'visitor') { check(!tabs.includes('biz') && !['numbers', 'orders', 'pay', 'inbox'].some((x) => tabs.includes(x)), `visitor: no Business tab, no Numbers (${tabs.join(',')})`); p.close(); continue; }
    check(tabs.includes('biz') && !['numbers', 'orders', 'pay', 'inbox'].some((x) => tabs.includes(x)), `boss: one Business tab, the old tabs gone from the row (${tabs.join(',')})`);
    await p.click('.tabs .tab[data-tab="biz"]');
    await p.until('!!document.querySelector(".biz-sections")', 'the sections', 10000);
    const sections = await p.ev('[...document.querySelectorAll(".biz-sections [data-biz]")].map((x) => x.textContent)');
    check(['Numbers', 'Orders', 'Payments', 'Inbox', 'Launch'].every((x) => sections.some((s) => s.startsWith(x))), `sections: ${sections.join(', ')}`);
    for (const id of ['numbers', 'orders', 'pay', 'inbox', 'launch']) {
      await p.click(`.biz-sections [data-biz="${id}"]`);
      await sleep(1200);
      const r = await p.ev(`({ tab: window.__office.tab, on: document.querySelector('.tabs .tab[data-tab="biz"]').classList.contains('on'), filled: document.querySelector('.tab-body').children.length > 0, sectionOn: document.querySelector('.biz-sections [data-biz="${id}"]').classList.contains('on') })`);
      check(r.tab === id && r.on && r.filled && r.sectionOn, `section ${id}: its panel shows under the Business tab ${JSON.stringify(r)}`);
    }
    await p.shot('docs/redesign/jobs/j22/shots/business-boss-desktop.jpg').catch(() => {});
    check(!p.errors.length, `no console errors ${p.errors.slice(0, 2).join(' | ')}`);
    p.close();
  }
} catch (e) { console.log('FAIL', e.message); failed++; }
b.close(); await t.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
