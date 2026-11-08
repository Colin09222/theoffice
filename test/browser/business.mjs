// Business mode in a real browser, against the real server in mock mode, on a desktop and on a phone: the boss taps Start a business, the step
// header lights up over the room, the research desk and the idea cards show, a card is picked, the four track lamps and the live preview follow,
// the ads, the campaign plan and the ad money come next, and launching with ad money gives a request slip that the boss approves with one click
// and that ends up queued for the building manager. A visitor sees the steps and the launched ads and never the money. BUSINESS_SHOTS=dir saves six pictures.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim, until } from '../helpers.js';
import { purchaseListing } from '../../server/purchases.js';

const OUT = process.env.BUSINESS_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };
const t = await boot({ mockDelayMs: 60, rateScale: 50, businessTickMs: 80, modesTickMs: 60000, mediaMock: true, searchMock: true, peopleTalk: false });
const base = `http://localhost:${t.port}/theoffice`;
const enter = async (p, c, slug) => {
  await p.goto(base);
  if (c) await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await p.goto(`${base}/floor/${slug || c.slug}?q=low`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
};
const shot = async (p, name) => { if (OUT) { await sleep(500); await p.shot(join(OUT, name)); } };
const inView = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; })()`;
const noSideScroll = '(document.documentElement.scrollWidth <= innerWidth + 1)';

const c = await claim(t, 'Dog Days', { body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
const phoneBoss = await claim(t, 'Night Owls', { body: { colors: { primary: '#5b3f8f', accent: '#ffc425' } } });
const b = await launch();
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await enter(p, c);

  await step('desktop: the boss sees Start a business, and it opens the journey with the step header over the room', async () => {
    await p.until('!!document.querySelector("[data-start-business]")', 'the start button');
    if (await p.ev('!!document.querySelector(".journey")')) throw new Error('header before starting');
    await p.click('[data-start-business]');
    await p.until('!!document.querySelector("[data-business-go]")', 'the start dialog');
    await p.type('textarea[name="wish"]', 'Something for dog owners');
    await p.click('[data-business-go]');
    await p.until('document.querySelectorAll(".journey-slot .journey-steps li").length === 4', 'the step header');
    const steps = await p.ev('[...document.querySelectorAll(".journey-slot .journey-steps li")].map((li) => li.className + ":" + li.textContent).join(" ")');
    if (steps !== 'now:1Idea next:2Build next:3Customers next:4Launch') throw new Error(steps);
    if (!await p.ev(inView('.journey-slot .journey'))) throw new Error('the header is off screen');
    if (await p.ev('document.querySelector(".tab.on")?.dataset.tab') !== 'business') throw new Error('not on the Business tab');
    if (!await p.ev('!document.querySelector("[data-start-business]")')) throw new Error('start button still there');
  });

  await step('desktop: the research desk shows the searches and the idea cards come with who pays, problem, what you sell, why now and links', async () => {
    await p.until('document.querySelectorAll(".idea-card").length === 3', 'three idea cards', 40000);
    const desk = await p.ev('document.querySelector(".desk").textContent');
    if (!/Searched/.test(desk) || !/dog grooming at home/.test(desk) || !/Markets checked/.test(desk) || !/Compared/.test(desk)) throw new Error(desk.slice(0, 200));
    const card = await p.ev('document.querySelector(".idea-card").textContent');
    for (const w of ['Who pays', 'Their problem', 'What you sell', 'Why now', 'Evidence', 'Estimate', 'source']) if (!card.includes(w)) throw new Error(`card has no ${w}`);
    if (await p.ev('document.querySelector(".idea-card .evidence").querySelectorAll("a").length') < 2) throw new Error('fewer than two links');
    const chips = await p.ev('[...document.querySelectorAll(".biz-chips .chip")].map((x) => x.textContent)');
    if (chips.length < 2 || chips.length > 4 || !chips.includes('Show me other ideas')) throw new Error(JSON.stringify(chips));
    await shot(p, 'business-1-desktop-ideas.jpg');
  });

  await step('desktop: a chip is sent as the boss\'s own words and the manager answers in the chat', async () => {
    await p.click('.biz-chips .chip[data-chip="Why this idea?"]');
    await p.until('document.querySelector(".tab.on")?.dataset.tab === "chat"', 'the chat');
    await p.until('[...document.querySelectorAll(".msg.boss .msg-body")].some((m) => m.textContent.includes("Why this idea?"))', 'the boss line');
    await p.until('[...document.querySelectorAll(".msg.manager .msg-body")].some((m) => /Good question/.test(m.textContent))', 'the answer', 20000);
    if (!await p.ev('document.querySelectorAll(".chat-chips .chip").length >= 2')) throw new Error('no chips under the chat');
  });

  await step('desktop: picking a card starts the build: four track lamps with counts, and the live preview of the page as it is saved', async () => {
    await p.click('[data-tab="business"]');
    await p.until('!!document.querySelector("[data-pick=\'0\']")', 'the pick button');
    await p.click('[data-pick="0"]');
    await p.until('document.querySelectorAll(".tracks .track").length === 4', 'four tracks');
    const labels = await p.ev('[...document.querySelectorAll(".track-head b")].map((x) => x.textContent).join(",")');
    if (labels !== 'Website,Product,Payments,Analytics') throw new Error(labels);
    if (!/no Stripe/.test(await p.ev('document.querySelector("[data-track=payments]").textContent'))) throw new Error('payments note');
    await p.until('!!document.querySelector(".biz-frame")?.src', 'the live preview', 40000);
    const head = await p.ev('[...document.querySelectorAll(".journey-slot .journey-steps li")].map((li) => li.className).join(",")');
    if (head !== 'done,now,next,next') throw new Error(head);
    await p.until('[...document.querySelectorAll(".track")].filter((x) => x.classList.contains("done") || x.classList.contains("working")).length >= 2', 'lamps lit', 30000);
    await shot(p, 'business-2-desktop-build.jpg');
  });

  await step('desktop: the ads (pictures and captioned videos), the campaign plan and the ad money, $0 chosen to start with', async () => {
    await p.until('!!document.querySelector("[data-money-box] [data-launch]:not([disabled])")', 'the ads are ready', 60000);
    const pics = await p.ev('document.querySelectorAll(".ad.picture img").length'), vids = await p.ev('document.querySelectorAll(".ad.video video track[kind=captions]").length');
    if (pics !== 2 || vids !== 2) throw new Error(`${pics} pictures, ${vids} captioned videos`);
    const plan = await p.ev('document.querySelector("[data-plan]").textContent');
    for (const w of ['Goal', 'Who', 'Where', 'Facebook', 'A vs B']) if (!plan.includes(w)) throw new Error(`plan has no ${w}`);
    const coins = await p.ev('[...document.querySelectorAll(".coin")].map((x) => x.textContent + (x.classList.contains("on") ? "*" : "")).join(" ")');
    if (coins !== '$0just for fun* $5 $10 $25') throw new Error(coins);
    if (!/Launch for free/.test(await p.ev('document.querySelector("[data-launch]").textContent'))) throw new Error('launch label');
    await shot(p, 'business-3-desktop-ads.jpg');
  });

  await step('desktop: launching with $10 files an AD SPEND slip; one click approves it and it is queued for the building manager', async () => {
    await p.click('[data-money="10"]');
    if (!/Launch with \$10 of ads/.test(await p.ev('document.querySelector("[data-launch]").textContent'))) throw new Error('label did not follow');
    await p.click('[data-launch]');
    await p.until('!!document.querySelector("[data-ad-spend=awaiting_boss] [data-approve]") && document.querySelectorAll(".journey-slot .journey-steps li.done").length === 4', 'the request slip, launched', 30000);
    const slip = await p.ev('document.querySelector("[data-ad-spend]").textContent');
    if (!/\$10/.test(slip) || !/Waiting for your approval/.test(slip)) throw new Error(slip.slice(0, 200));
    await p.click('[data-approve]');
    await p.until('/Queued for the building manager/.test(document.querySelector("[data-ad-spend]")?.textContent || "")', 'queued').catch(async (e) => { throw new Error(`${e.message}: ${await p.ev('document.querySelector("[data-ad-spend]")?.textContent')} | ${JSON.stringify(t.db.prepare('SELECT status FROM ad_spend').all())} | ${await p.ev('[...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" / ")')}`); });
    const l = purchaseListing(t.db);
    if (l.purchases.length !== 1 || l.purchases[0].priceUsd !== 10 || !/AD SPEND/.test(l.purchases[0].item)) throw new Error(JSON.stringify(l.purchases).slice(0, 200));
    await p.until('document.querySelectorAll(".journey-slot .journey-steps li.done").length === 4', 'all four steps done', 30000);
    await shot(p, 'business-4-desktop-launch.jpg');
  });

  await step('desktop: a visitor sees the steps, the lamps and the launched ads to share, and no ad money anywhere', async () => {
    // A browser of their own: cookies are shared by every page in one.
    const vb = await launch();
    const v = await vb.newPage({ width: 1280, height: 800 });
    await enter(v, null, c.slug);
    await v.click('[data-talk-pill]');
    await v.click('[data-tab="business"]');
    await v.until('document.querySelectorAll(".ad-wall .ad").length === 4', 'the ads');
    const text = await v.ev('document.querySelector(".tab-body").textContent + document.querySelector(".journey-slot").textContent');
    if (/\$\d|ad money|AD SPEND|Approve/i.test(text)) throw new Error(text.match(/.{0,40}(\$\d|ad money|AD SPEND|Approve).{0,40}/i)[0]);
    if (await v.ev('document.querySelectorAll(".idea-card, .coin, .chip").length')) throw new Error('boss-only parts showed');
    if (await v.ev('document.querySelectorAll("[data-share]").length') !== 4) throw new Error('no share buttons');
    vb.close();
  });

  await step('phone: the step header fits, the idea cards and chips show in the sheet, and picking lights the tracks', async () => {
    const mb = await launch();
    const m = await mb.newPage({ mobile: true, width: 390, height: 844 });
    await enter(m, phoneBoss);
    await m.until('!!document.querySelector("[data-start-business]")', 'the start button');
    await m.click('[data-start-business]');
    await m.click('[data-business-go]');
    await m.until('document.querySelectorAll(".journey-slot .journey-steps li").length === 4', 'the step header');
    if (!await m.ev(inView('.journey-slot .journey'))) throw new Error('header off screen');
    if (!await m.ev(noSideScroll)) throw new Error('the page scrolls sideways');
    await m.until('document.querySelectorAll(".idea-card").length === 3', 'idea cards', 40000);
    const fits = await m.ev('[...document.querySelectorAll(".idea-card")].every((x) => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })');
    if (!fits) throw new Error('cards spill sideways');
    if (await m.ev('document.querySelectorAll(".biz-chips .chip").length') < 2) throw new Error('no chips');
    await shot(m, 'business-5-phone-ideas.jpg');
    await m.click('[data-pick="1"]');
    await m.until('document.querySelectorAll(".tracks .track").length === 4', 'tracks');
    await m.until('[...document.querySelectorAll(".track")].some((x) => x.classList.contains("done") || x.classList.contains("working"))', 'a lamp lit', 30000);
    const twoUp = await m.ev('(() => { const r = [...document.querySelectorAll(".track")].map((x) => x.getBoundingClientRect()); return r.every((x) => x.right <= innerWidth + 1) && Math.abs(r[0].top - r[1].top) < 2; })()');
    if (!twoUp) throw new Error('tracks do not sit two by two');
    if (!await m.ev(noSideScroll)) throw new Error('the page scrolls sideways');
    await shot(m, 'business-6-phone-tracks.jpg');
    mb.close();
  });

  const errs = p.errors?.filter?.((e) => !/favicon|ERR_ABORTED/.test(e)) || [];
  check('no page errors', !errs.length, errs.slice(0, 2).join(' | ').slice(0, 200));
} finally {
  b.close();
  await t.close();
}
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
