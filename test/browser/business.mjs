// Business mode in a real browser, against the real server in mock mode, on a desktop and on a phone: the boss taps Start a business, the step
// header lights up over the room, the research desk and the idea cards show, a card is picked, the four track lamps and the live preview follow,
// the ads, the campaign plan and the ad money come next, and launching with ad money gives a request slip that the boss approves with one click
// and that becomes a Google search campaign (against the mocked Google Ads API: nothing reaches Google), with Facebook and Instagram shown as
// coming soon. A visitor sees the steps and the launched ads and never the money. BUSINESS_SHOTS=dir saves nine pictures.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim, until } from '../helpers.js';

const OUT = process.env.BUSINESS_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };
const t = await boot({ mockDelayMs: 60, rateScale: 50, businessTickMs: 80, modesTickMs: 60000, mediaMock: true, searchMock: true, peopleTalk: false, adsPaidEnabled: true, adsMock: true });
// The ad has to point at an https address; locally the site lives at a path on http, so the ad is given the address it would have on the web.
{ const live = t.app.engine.liveUrl.bind(t.app.engine); t.app.engine.liveUrl = (f, s) => live(f, s).replace(/^\/theoffice\//, 'https://office.example/theoffice/'); }
const base = `http://localhost:${t.port}/theoffice`;
const enter = async (p, c, slug) => {
  await p.goto(base);
  if (c) await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await p.goto(`${base}/floor/${slug || c.slug}?q=low`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
};
// Before every picture: no bare "null" or "undefined" left on the page by a missing piece of the UI (one sat under the floor's controls).
const STRAY = `(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (/^\\s*(null|undefined|NaN|\\[object Object\\])\\s*$/.test(n.nodeValue)) out.push(\`\${n.parentElement?.className || n.parentElement?.tagName}: \${n.nodeValue.trim()}\`);
  return out.slice(0, 4).join(' | '); })()`;
const shot = async (p, name) => {
  await sleep(OUT ? 500 : 200);
  const stray = await p.ev(STRAY);
  check(`${name}: no stray null or undefined text on the page`, !stray, stray);
  if (OUT) await p.shot(join(OUT, name));
};
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
    // Mock builds are quick, so the preview is watched for as it comes rather than looked for once.
    await p.ev('window.__sawPreview = false; new MutationObserver(() => { if (document.querySelector(".biz-frame")?.getAttribute("src")) window.__sawPreview = true; }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] }); true');
    await p.click('[data-pick="0"]');
    await p.until('document.querySelectorAll(".tracks .track").length === 4', 'four tracks');
    const labels = await p.ev('[...document.querySelectorAll(".track-head b")].map((x) => x.textContent).join(",")');
    if (labels !== 'Website,Product,Payments,Analytics') throw new Error(labels);
    if (!/no Stripe/.test(await p.ev('document.querySelector("[data-track=payments]").textContent'))) throw new Error('payments note');
    await p.until('window.__sawPreview === true', 'the live preview', 40000).catch(async (e) => { throw new Error(`${e.message}: step ${await p.ev('document.querySelector("[data-biz]")?.dataset.biz')}, box ${await p.ev('!!document.querySelector("[data-preview]")')}, api ${JSON.stringify(await p.ev(`fetch("/theoffice/api/floors/${c.slug}/business/preview", { credentials: "same-origin" }).then((r) => r.status + " " + r.statusText).catch((x) => String(x))`))}`); });
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
    for (const w of ['Goal', 'Who', 'Where', 'Google Search', 'Keywords', 'mobile dog grooming', 'Sponsored', 'A vs B']) if (!plan.includes(w)) throw new Error(`plan has no ${w}`);
    const plates = await p.ev('[...document.querySelectorAll("[data-ad-where] .plate")].map((x) => x.dataset.channel + (x.classList.contains("on") ? "+on" : "") + (x.disabled ? "+off" : "") + ":" + x.textContent).join(" | ")');
    if (!/^google\+on:Google Search ads \| meta\+off:Facebook & Instagram adscoming soon$/.test(plates)) throw new Error(plates);
    const coins = await p.ev('[...document.querySelectorAll(".coin")].map((x) => x.textContent + (x.classList.contains("on") ? "*" : "")).join(" ")');
    if (coins !== '$0just for fun* $5 $10 $25') throw new Error(coins);
    if (!/Launch for free/.test(await p.ev('document.querySelector("[data-launch]").textContent'))) throw new Error('launch label');
    // Every ad picture is a real picture, decoded at its own size: never one pixel of colour stretched over the slot.
    await p.until('[...document.querySelectorAll(".ad.picture img")].every((i) => i.complete && i.naturalWidth >= 64)', 'the ad pictures drawn');
    await p.ev('document.querySelector(".ad-wall").scrollIntoView({ block: "start" })');
    await shot(p, 'business-3-desktop-ads.jpg');
    await p.ev('document.querySelector("[data-ad-where]").scrollIntoView({ block: "center" })');
    await shot(p, 'business-3b-desktop-money.jpg');
  });

  await step('desktop: launching with $10 files an AD SPEND slip; one click approves it and it runs as a Google search ad', async () => {
    await p.click('[data-money="10"]');
    if (!/Launch with \$10 of ads/.test(await p.ev('document.querySelector("[data-launch]").textContent'))) throw new Error('label did not follow');
    await p.click('[data-launch]');
    await p.until('!!document.querySelector("[data-ad-spend=awaiting_boss] [data-approve]") && document.querySelectorAll(".journey-slot .journey-steps li.done").length === 4', 'the request slip, launched', 30000);
    const slip = await p.ev('document.querySelector("[data-ad-spend]").textContent');
    if (!/\$10/.test(slip) || !/Waiting for your approval/.test(slip)) throw new Error(slip.slice(0, 200));
    await p.click('[data-approve]');
    await p.until('/Running on Google Search/.test(document.querySelector("[data-ad-spend]")?.textContent || "")', 'running', 20000).catch(async (e) => { throw new Error(`${e.message}: ${await p.ev('document.querySelector("[data-ad-spend]")?.textContent')} | ${JSON.stringify(t.db.prepare('SELECT status, note FROM ad_spend').all())} | ${await p.ev('[...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" / ")')}`); });
    const slip2 = await p.ev('document.querySelector("[data-ad-spend]").textContent');
    if (!/Ends[A-Z][a-z]{2}, /.test(slip2) || !/Seen 0 times, 0 clicks/.test(slip2)) throw new Error(slip2.slice(0, 300));
    const camps = [...t.app.engine.business.ads.mock.campaigns.values()];
    if (camps.length !== 1 || camps[0].status !== 'ENABLED') throw new Error(JSON.stringify(camps.map((x) => x.status)));
    if (!await p.ev('!!document.querySelector("[data-ad-where] [data-channel=meta][disabled]")')) throw new Error('no coming-soon plate at launch');
    await p.until('document.querySelectorAll(".journey-slot .journey-steps li.done").length === 4', 'all four steps done', 30000);
    await p.ev('document.querySelector("[data-ad-spend]").scrollIntoView({ block: "start" })');
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
    if (await v.ev('document.querySelectorAll(".ad-wall [data-share]").length') !== 4) throw new Error('no share buttons');
    if (/\bnull\b/.test(await v.ev('document.body.innerText'))) throw new Error('"null" written on the page');
    vb.close();
  });

  await step('phone: the step header fits, the idea cards and chips show in the sheet, picking lights the tracks, and the ads and the money follow', async () => {
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
    // On to the ads: the pictures, then where paid ads run (Facebook & Instagram coming soon) and the ad money, $0 to start with.
    await m.until('!!document.querySelector("[data-money-box] [data-launch]:not([disabled])")', 'the ads are ready', 60000);
    await m.until('[...document.querySelectorAll(".ad.picture img")].every((i) => i.complete && i.naturalWidth >= 64)', 'the ad pictures drawn');
    if (!/Facebook & Instagram adscoming soon/.test(await m.ev('document.querySelector("[data-ad-where] [data-channel=meta]").textContent'))) throw new Error('no coming-soon plate');
    if (await m.ev('document.querySelector(".coin.on")?.textContent') !== '$0just for fun') throw new Error('$0 is not the choice to start with');
    if (!await m.ev(noSideScroll)) throw new Error('the page scrolls sideways');
    await m.ev('document.querySelector(".ad-wall").scrollIntoView({ block: "start" })');
    await shot(m, 'business-7-phone-ads.jpg');
    await m.ev('document.querySelector("[data-ad-where]").scrollIntoView({ block: "center" })');
    await shot(m, 'business-8-phone-money.jpg');
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
