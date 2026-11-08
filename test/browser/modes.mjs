// Work modes in a real browser, against the real server in mock mode: the Hours tab under Customise sets the mode and the sign follows,
// a visitor sees the sign but not the plan, set hours outside their time close the floor and send the staff home, and "work nonstop" in
// the chat turns the floor 24/7 and fills the Work tab's goal and next-up list. MODES_SHOTS=dir saves four pictures.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim, until } from '../helpers.js';

const OUT = process.env.MODES_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };
const t = await boot({ mockDelayMs: 40, rateScale: 50, modesTickMs: 60, autopilotGapMin: 0.02, peopleTalk: false });
const base = `http://localhost:${t.port}/theoffice`;
const enter = async (p, c) => {
  await p.goto(base);
  if (c) await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await p.goto(`${base}/floor/${c?.slug || visitorSlug}?q=low`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
};
let visitorSlug = '';
const sign = (p) => p.ev('[document.querySelector(".hours-sign b")?.textContent, document.querySelector(".hours-sign small")?.textContent, document.querySelector(".status-pill")?.textContent].join(" | ")');
const openHours = async (p) => {
  await p.click('.controls .btn:nth-of-type(4)');
  await p.until('document.querySelector(".modal.customise") !== null', 'panel');
  await p.click('[data-custom="hours"]');
  await p.until('!!document.querySelector(".hours-plate")', 'hours tab');
};
const save = async (p) => { await p.click('.custom-foot .btn.primary'); await p.until('document.querySelector(".modal") === null', 'panel closed'); };
const nyHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const hh = (n) => `${String(((n % 24) + 24) % 24).padStart(2, '0')}:00`;

const c = await claim(t, 'Hourly Soup', { body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
visitorSlug = c.slug;
const b = await launch();
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await enter(p, c);

  await step('the floor starts on call, and its sign says so', async () => {
    const s = await sign(p);
    if (!/^On call \| When the boss calls/.test(s)) throw new Error(s);
  });

  await step('the Hours tab sets 9 to 5 on weekdays in New York: the plate, the sign and the server all agree, and the chat gets a line', async () => {
    await openHours(p);
    if (await p.ev('document.querySelector(".hours-plate b").textContent') !== 'On call') throw new Error('plate before');
    await p.click('[data-work-mode="hours"]');
    await p.until('!document.querySelector(".hours-when").hidden', 'the hours show');
    const plate = await p.ev('document.querySelector(".hours-plate b").textContent + " / " + document.querySelector(".hours-plate span").textContent');
    if (plate !== 'Open 9–5 / Mon–Fri') throw new Error(plate);
    await p.ev(`(() => { const s = document.querySelector('select[name="hours-tz"]'); s.value = 'America/New_York'; s.dispatchEvent(new Event('change')); })()`);
    await p.type('textarea[name="hours-goal"]', 'Get our first hundred soup fans');
    if (OUT) { await sleep(400); await p.shot(join(OUT, 'modes-1-hours-tab.jpg')); }
    await save(p);
    const w = (await c.get(`/api/floors/${c.slug}/work-mode`)).data.workMode;
    if (w.mode !== 'hours' || w.start !== '09:00' || w.end !== '17:00' || w.dayList.join() !== '1,2,3,4,5' || w.tz !== 'America/New_York' || w.goal !== 'Get our first hundred soup fans') throw new Error(JSON.stringify(w));
    await p.until('document.querySelector(".hours-sign b")?.textContent === "Open 9–5"', 'sign changed');
    const line = await until(async () => ((await c.get(`/api/floors/${c.slug}`)).data.messages || []).find((m) => /^Now working 9am to 5pm, Mon–Fri \(America\/New_York\)/.test(m.text)), { what: 'chat line' });
    if (!line) throw new Error('no line');
  });

  await step('hours that are over for today close the floor: the pill says Closed, the banner says when they are back, and the staff go home', async () => {
    const h = nyHour();
    await c.post(`/api/floors/${c.slug}/work-mode`, { mode: 'hours', days: [0, 1, 2, 3, 4, 5, 6], start: hh(h + 2), end: hh(h + 3), tz: 'America/New_York' });
    await p.until('document.querySelector(".status-pill")?.textContent === "Closed"', 'closed pill', 15000);
    const banner = await p.ev('document.querySelector(".floor-banner")?.textContent || ""');
    if (!/^Closed for now: everyone has gone home\. Back (at|tomorrow at|[A-Z][a-z]+day at) .+\. You can still call your manager\.$/.test(banner)) throw new Error(banner);
    await p.until('window.__office.view.closed === true', 'room closed');
    // A software-rendered headless room runs slow frames, so this waits for the next ones rather than a fixed time.
    await p.until('[...window.__office.view.actors.values()].filter((a) => !a.isBoss).every((a) => !a.group.visible && a.tag.hidden)', 'everyone gone home', 20000);
    if (OUT) { await sleep(500); await p.shot(join(OUT, 'modes-2-closed.jpg')); }
  });

  await step('a visitor sees the sign and the closed floor, but never the plan', async () => {
    // A browser of its own: a second tab would share the boss's cookie.
    const vb = await launch();
    const v = await vb.newPage({ width: 1280, height: 800 });
    await enter(v, null);
    const s = await sign(v);
    if (!/^Open \d+–\d+ \| Every day \| Closed$/.test(s)) throw new Error(s);
    await v.ev('document.querySelector(\'[data-tab="work"]\')?.click()');
    await sleep(200);
    if (await v.ev('!!document.querySelector(".work-plan")')) throw new Error('a visitor sees the plan');
    if (await v.ev('/soup fans/.test(document.body.textContent)')) throw new Error('the goal leaked');
    vb.close();
  });

  await step('"work nonstop" in the chat turns the sign to 24/7, staff come back, and the Work tab fills with the goal and next up', async () => {
    await p.ev('document.querySelector(\'[data-tab="chat"]\')?.click()');
    await p.type('.chat-form textarea, .composer textarea, textarea', 'Work nonstop from now on please');
    await p.press('Enter');
    await p.until('document.querySelector(".hours-sign b")?.textContent === "Open 24/7"', 'nonstop sign', 20000);
    await until(async () => ((await c.get(`/api/floors/${c.slug}`)).data.messages || []).some((m) => /^\*\*On our own:\*\*/.test(m.text)), { what: 'the first digest', timeout: 30000 });
    await p.ev('document.querySelector(\'[data-tab="work"]\')?.click()');
    await p.until('!!document.querySelector(".work-plan .plan-next li")', 'next up list', 15000);
    const plan = await p.ev('document.querySelector(".work-plan").textContent');
    if (!/Open 24\/7/.test(plan) || !/soup fans/.test(plan)) throw new Error(plan.slice(0, 200));
    await p.until('[...window.__office.view.actors.values()].filter((a) => !a.isBoss).some((a) => a.group.visible)', 'the staff back in', 20000);
    if (/\$\d|budget/i.test(await p.ev('document.body.textContent'))) throw new Error('money words on the page');
    if (OUT) { await sleep(500); await p.shot(join(OUT, 'modes-3-nonstop-work-tab.jpg')); }
  });

  await step('on a phone the Hours tab stacks and fits the screen', async () => {
    const m = await b.newPage({ mobile: true });
    await enter(m, c);
    await m.ev('document.querySelector(".controls .btn:nth-of-type(4)")?.click()');
    await m.until('document.querySelector(".modal.customise") !== null', 'panel');
    await m.ev('document.querySelector(\'[data-custom="hours"]\').click()');
    await m.until('!!document.querySelector(".mode-pick")', 'hours tab');
    const fit = await m.ev('(() => { const r = [...document.querySelectorAll(".mode-card")].map((x) => x.getBoundingClientRect()); return r.length === 3 && r.every((x) => x.left >= 0 && x.right <= innerWidth + 1) && r[1].top > r[0].top; })()');
    if (!fit) throw new Error('mode cards do not stack');
    if (OUT) { await sleep(400); await m.shot(join(OUT, 'modes-4-phone-hours.jpg')); }
    m.close();
  });
  const errs = p.errors?.filter?.((e) => !/favicon|ERR_ABORTED/.test(e)) || [];
  check('no page errors', !errs.length, errs.slice(0, 2).join(' | ').slice(0, 200));
} finally {
  b.close();
  await t.close();
}
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
