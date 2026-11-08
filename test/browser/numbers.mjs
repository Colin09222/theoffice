// The Numbers tab in a real browser, against the real server in mock mode: phone and desktop, real figures on the tiles and in the charts,
// honest empty states, the daily opt-in under Customise, Hours, and a visitor who sees no such tab. NUMBERS_SHOTS=dir saves three pictures.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim, Client } from '../helpers.js';
import { get, run } from '../../server/db.js';

const OUT = process.env.NUMBERS_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };

const t = await boot({ mockDelayMs: 40, rateScale: 50, peopleTalk: false, dailyTickMs: 60000 });
const base = `http://localhost:${t.port}/theoffice`;
const enter = async (p, c, slug) => {
  await p.goto(base);
  if (c) await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await p.goto(`${base}/floor/${slug}?q=low`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
};
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const c = await claim(t, 'Counted Co', { body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
const empty = await claim(t, 'Brand New Co');
const f = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug);
const addProject = (slug, title) => run(t.db, 'INSERT INTO projects (floor_id,slug,title,description,kind,created_at,published_at) VALUES (?,?,?,?,?,?,?)', f.id, slug, title, '', 'site', Date.now(), Date.now());
addProject('shop', 'The Shop'); addProject('blog', 'The Blog');
for (const [ago, views, uniques] of [[0, 12, 7], [1, 30, 20], [3, 9, 5], [6, 21, 14], [20, 44, 30]]) run(t.db, 'INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,?,?,?)', f.id, 'shop', dayAgo(ago), '/', views, uniques);
run(t.db, 'INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,?,?,?)', f.id, 'blog', dayAgo(1), 'first-post', 5, 3);
run(t.db, 'INSERT INTO app_visit_refs (floor_id,project,day,ref,n) VALUES (?,?,?,?,?)', f.id, 'shop', dayAgo(1), 'news.example.com', 9);
run(t.db, 'INSERT INTO app_forms (floor_id,project,form,data,size,hash,created_at) VALUES (?,?,?,?,?,?,?)', f.id, 'shop', 'list', '{}', 2, 'a1', Date.now() - 3600000);
const b = await launch();
const shown = (p) => p.ev('[...document.querySelectorAll(".num-tile")].map((x) => x.querySelector("span").textContent + ":" + x.querySelector("b").textContent).join("|")');
const openNumbers = async (p) => {
  await p.until('!!document.querySelector(\'[data-tab="numbers"]\')', 'tab');
  await p.click('[data-tab="numbers"]');
  await p.until('!!document.querySelector(".num-tiles")', 'dashboard');
};
try {
  const p = await b.newPage({ width: 390, height: 844, mobile: true });
  await enter(p, c, c.slug);
  await step('phone: the boss has a Numbers tab, and it opens on the last 7 days with real figures', async () => {
    await openNumbers(p);
    const tiles = await shown(p);
    if (!/Visitors:49\|Page views:77/.test(tiles)) throw new Error(tiles);
    if (!/Sales:–/.test(tiles)) throw new Error(`no honest empty sales: ${tiles}`);
    if (!/Sign-ups:1\|New accounts:0/.test(tiles)) throw new Error(tiles);
  });
  await step('phone: the charts are there, and tapping a bar reads that day out', async () => {
    if (!await p.ev('document.querySelector(\'[data-chart="visitors"] svg path\') !== null')) throw new Error('no bars');
    const read = () => p.ev('document.querySelector(\'[data-chart="visitors"] .num-read\').textContent');
    const bars = () => p.ev('document.querySelectorAll(\'[data-chart="visitors"] .num-hit\').length');
    if (await bars() !== 7) throw new Error(`${await bars()} bars`);
    const tap = (i) => p.ev(`document.querySelectorAll('[data-chart="visitors"] .num-hit')[${i}].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
    await tap(0);
    if (!/14 visitors, 21 page views/.test(await read())) throw new Error(await read());
    await tap(6);
    if (!/7 visitors, 12 page views/.test(await read())) throw new Error(await read());
    if (await p.ev('document.documentElement.scrollWidth > window.innerWidth + 1')) throw new Error('the page scrolls sideways');
  });
  await step('phone: Today and 30 days change the tiles; the 30-day figures add up', async () => {
    await p.click('[data-win="today"]');
    let tiles = await shown(p);
    if (!/Visitors:7\|Page views:12/.test(tiles)) throw new Error(tiles);
    await p.click('[data-win="month"]');
    tiles = await shown(p);
    if (!/Visitors:79\|Page views:121/.test(tiles)) throw new Error(tiles);
    await p.click('[data-win="week"]');
  });
  await step('phone: per project, with sources and pages, and honest about what isn\'t there', async () => {
    const sel = 'select[name="numbers-project"]';
    if (await p.ev(`document.querySelector(${JSON.stringify(sel)}).options.length`) !== 3) throw new Error('project choices');
    await p.ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = 'blog'; s.dispatchEvent(new Event('change')); })()`);
    await p.until('[...document.querySelectorAll(".num-tile")].some((x) => x.textContent.includes("Visitors") && x.querySelector("b").textContent === "3")', 'blog numbers');
    const text = await p.ev('document.querySelector(".numbers").textContent');
    if (!/\/first-post/.test(text)) throw new Error('no top page');
    if (!/No links from other sites in this period yet/.test(text)) throw new Error('no honest empty source');
    if (!/No ads have run/.test(text)) throw new Error('no honest empty ads');
    if (OUT) { await sleep(300); await p.shot(join(OUT, 'numbers-1-phone.jpg')); }
    await p.close();
  });

  const d = await b.newPage({ width: 1440, height: 900 });
  await enter(d, c, c.slug);
  await step('desktop: the Numbers tab fits the panel, and the charts show', async () => {
    await openNumbers(d);
    if (!await d.ev('document.querySelector(\'[data-chart="visitors"] svg\') !== null')) throw new Error('no chart');
    const tiles = await shown(d);
    if (!/Visitors:49/.test(tiles)) throw new Error(tiles);
    if (await d.ev('document.documentElement.scrollWidth > window.innerWidth + 1')) throw new Error('the page scrolls sideways');
    if (OUT) { await sleep(300); await d.shot(join(OUT, 'numbers-2-desktop.jpg')); }
  });
  await step('the daily run is off by default, and the boss turns it on under Customise, Hours, at a time they pick', async () => {
    await d.click('.controls .btn:nth-of-type(4)');
    await d.until('document.querySelector(".modal.customise") !== null', 'panel');
    await d.click('[data-custom="hours"]');
    await d.until('!!document.querySelector(\'[data-daily]\')', 'daily box');
    if (await d.ev('document.querySelector(\'input[name="daily-on"]\').checked')) throw new Error('it was on');
    if (!await d.ev('document.querySelector(".daily-when").hidden')) throw new Error('the time showed while off');
    await d.click('input[name="daily-on"]');
    await d.until('!document.querySelector(".daily-when").hidden', 'the time shows');
    await d.ev(`(() => { const s = document.querySelector('input[name="daily-at"]'); s.value = '07:30'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    if (OUT) { await sleep(300); await d.shot(join(OUT, 'numbers-3-daily.jpg')); }
    await d.click('.custom-foot .btn.primary');
    await d.until('document.querySelector(".modal") === null', 'panel closed');
    const v = (await c.get(`/api/floors/${c.slug}/daily`)).data.daily;
    if (!v.on || v.at !== '07:30') throw new Error(JSON.stringify(v));
  });
  await d.close();

  await step('desktop: a brand-new company gets honest empty states and no made-up figures', async () => {
    const e = await b.newPage({ width: 1440, height: 900 });
    await enter(e, empty, empty.slug);
    await openNumbers(e);
    const text = await e.ev('document.querySelector(".numbers").textContent');
    if (!/No visitors or sign-ups on record yet/.test(text)) throw new Error('no empty note');
    if (!/no sales yet/.test(text)) throw new Error('no sales note');
    if (!/Nothing on record yet/.test(text)) throw new Error('no empty chart');
    await e.close();
  });

  const vb = await launch();
  const visitor = await vb.newPage({ width: 1440, height: 900 });
  await enter(visitor, null, c.slug);
  await step('a visitor sees no Numbers tab, and the route tells them nothing', async () => {
    await visitor.until('document.querySelectorAll(".tab").length > 0', 'tabs');
    if (await visitor.ev('!!document.querySelector(\'[data-tab="numbers"]\')')) throw new Error('a visitor has the tab');
    const r = await new Client(t).get(`/api/floors/${c.slug}/numbers`);
    if (r.status !== 401 && r.status !== 403) throw new Error(`status ${r.status}`);
  });
  await visitor.close();
  await vb.close();
} finally { await b.close(); await t.close(); }
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
