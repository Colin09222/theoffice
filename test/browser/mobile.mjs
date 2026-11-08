// Real phones: touch, a phone's user agent and device metrics, at the sizes people actually hold them, with AI_MODE=mock. Every screen is
// audited for anything past the right edge, sideways scrolling, clipped control text, small or unreachable primary controls and console errors.
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';
import { mkdirSync } from 'node:fs';
import { AUDIT } from './mobile-audit.mjs';

const SIZES = [[360, 640], [375, 667], [390, 664], [390, 844], [430, 932], [844, 390]].filter(([w, h]) => !process.env.MOBILE_SIZES || process.env.MOBILE_SIZES.split(',').includes(`${w}x${h}`));
const OUT = process.env.MOBILE_OUT || null; if (OUT) mkdirSync(OUT, { recursive: true });
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 900)})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, e.message); } };

const t = await boot({ mockDelayMs: 40, rateScale: 50 });
const base = `http://localhost:${t.port}/theoffice`;

async function audit(p, name, opts) {
  const bad = await p.ev(AUDIT(name, opts));
  const errs = p.errors.splice(0).filter((e) => !/favicon|Failed to load resource.*(?:40[134]|429)/i.test(e));
  if (bad.length || errs.length) throw new Error([...bad, ...errs.map((e) => `console: ${e.slice(0, 160)}`)].join(' | '));
}
const screen = (p, tag, opts) => async (name, fn) => {
  await step(`${tag}: ${name}`, async () => {
    await fn?.();
    await sleep(140);
    await p.until('!document.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming?.().iterations !== Infinity && a.effect?.target?.closest?.(".modal-back, .floor-panel"))', 'settled', 3000).catch(() => {});
    if (OUT && process.env.MOBILE_SHOTS?.split(',').some((w) => name.startsWith(w))) await p.shot(`${OUT}/${tag}-${name.replace(/[^a-z0-9]+/gi, '-')}.jpg`);
    await audit(p, name, opts);
  });
};
const cookie = (p, c) => p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
const onFloor = (p) => p.until('document.body.dataset.page === "floor" && !!window.__office?.state && !!document.querySelector(".floor-panel")', 'the floor', 45000);
const settled = (p) => p.until('!document.querySelector(".floor-panel") || !document.getAnimations().some((a) => a.playState === "running" && a.effect?.target?.closest?.(".floor-panel"))', 'the sheet at rest', 4000).catch(() => {});

// A simulated keyboard: the visible viewport shrinks and iOS-style offset, the way a real keyboard does, and the page hears about it.
const keyboard = (p, kb, top = 0) => p.ev(`(() => {
  const vv = visualViewport, H = innerHeight - ${kb};
  Object.defineProperty(vv, 'height', { configurable: true, get: () => H - ${top} });
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => ${top} });
  vv.dispatchEvent(new Event('resize'));
  return H;
})()`);
const noKeyboard = (p) => p.ev(`(() => { delete visualViewport.height; delete visualViewport.offsetTop; visualViewport.dispatchEvent(new Event('resize')); return true; })()`);

const LONG = ['Here is a very long update with a sticky note, a link and a table.', 'Averyveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongwordthatkeepsgoing '.repeat(2),
  '[A link with a long address](https://example.com/one/two/three/four/five/six/seven/eight/nine/ten/eleven/twelve/thirteen)', 'https://example.com/a-bare-link-that-is-also-very-long-and-should-wrap-inside-the-bubble-without-any-trouble-at-all',
  '| Name | Long heading for a column | A third column with lots of words |\n| --- | --- | --- |\n| Sally | Something quite wordy that really should wrap | 123456789012345678901234567890 |',
  '```\nconst thisIsAVeryLongLineOfCodeThatShouldNeverMakeThePageScrollSideways = "and that is a promise from the phone";\n```'].join('\n\n');

for (const size of SIZES) {
  const [w, h] = size; const portrait = h > w; const phoneLayout = w <= 760; const tag = `${w}x${h}`; const opts = { portrait, phoneLayout };
  const b = await launch();
  const newPage = async (ua) => b.newPage({ phone: { width: w, height: h, ua: ua || undefined } });

  // ---- the lobby and its dialogs, as a visitor ----
  await (async () => {
    const p = await newPage(IOS); const see = screen(p, `${tag} visitor`, opts);
    await p.goto(`${base}?q=low`);
    await p.until('document.documentElement.classList.contains("ready") && document.body.dataset.page === "lobby"', 'the lobby', 45000);
    await sleep(800);
    await see('lobby');
    await see('Open an office dialog', async () => { await p.click('.open-pill'); await p.until('!!document.querySelector(".modal .code-input")', 'dialog'); });
    await see('Sign in dialog', async () => { await p.ev('[...document.querySelectorAll(".modal button")].find((b) => /Sign in/.test(b.textContent))?.click(); true'); await p.until('!!document.querySelector(".modal input[name=code], .modal input")', 'sign in', 5000); });
    await p.ev('document.querySelector(".modal .icon-btn")?.click(); true');
    p.close();
  })();

  // ---- a brand new floor: its full-screen Setup, from the recovery code to Ready ----
  await (async () => {
    const p = await newPage(); const see = screen(p, `${tag} setup`, opts);
    await p.goto(`${base}?q=low`);
    await p.until('document.documentElement.classList.contains("ready") && document.body.dataset.page === "lobby"', 'the lobby', 45000);
    await step(`${tag} setup: opens a new office`, async () => {
      await p.click('.open-pill');
      await p.until('!!document.querySelector(".modal .code-input")', 'dialog');
      await p.type('.code-input', t.code());
      await p.click('.modal button[type=submit]');
      await onFloor(p);
      await p.until('!!document.querySelector("[data-setup-flow] [data-recovery]")', 'the recovery code', 15000);
      await sleep(500);
    });
    await see('recovery code', async () => {
      const code = await p.ev('(() => { const e = document.querySelector("[data-recovery]"); const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { shown: r.top >= 0 && r.bottom <= innerHeight, hit: !!hit && (e.contains(hit) || e === hit || !!hit.closest(".recovery, .setup-keys")) }; })()');
      if (!code.shown || !code.hit) throw new Error(`the recovery code is not on the screen ${JSON.stringify(code)}`);
    });
    await see('what are we making', async () => { await p.click('[data-setup-saved]'); await p.until('document.querySelectorAll("[data-setup-flow] [data-type]").length === 4', 'the four kinds', 8000); await sleep(300); });
    await see('which one', async () => { await p.click('[data-setup-flow] [data-type=game]'); await p.until('document.querySelectorAll("[data-setup-flow] [data-idea]").length >= 2', 'the ideas', 12000); await sleep(350); });
    await see('ready', async () => { await p.click('[data-setup-flow] [data-idea]'); await p.click('[data-setup-flow] [data-next]'); await p.until('!!document.querySelector("[data-setup-flow] [data-go]")', 'ready', 8000); await sleep(350); });
    await see('back through it', async () => { await p.click('[data-setup-back]'); await p.until('!!document.querySelector("[data-setup-flow] [data-next]")', 'which one again', 5000); await sleep(200); await p.click('[data-setup-back]'); await p.until('!!document.querySelector("[data-setup-flow] [data-setup-out]")', 'what again', 5000); await sleep(200); });
    await see('out to the manager', async () => { await p.click('[data-setup-out]'); await p.until('!document.querySelector("[data-setup-flow]")', 'setup to close', 8000); await settled(p); await sleep(400); });
    p.close();
  })();

  // ---- a fresh floor with a name: the options in the chat ----
  await (async () => {
    const fresh = await claim(t, `Fresh ${tag}`);
    const p = await newPage(); const see = screen(p, `${tag} new boss`, opts);
    await p.goto(`${base}?q=low`);
    await cookie(p, fresh);
    await p.goto(`${base}/floor/${fresh.slug}?q=low`);
    await onFloor(p);
    await p.until('document.querySelectorAll("[data-launcher] .launch-type").length === 4', 'the launcher', 15000);
    await sleep(600);
    if (phoneLayout) await step(`${tag} new boss: the options are on the screen without hunting`, async () => {
      const opt = await p.ev(`(() => { const out = []; const list = document.querySelector('.chat-list').getBoundingClientRect(); for (const el of document.querySelectorAll('.launch-type')) { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); if (r.top < list.top - 1 || r.bottom > list.bottom + 1 || !hit || !(el === hit || el.contains(hit))) out.push(el.textContent.slice(0, 18) + ' ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' list ' + Math.round(list.top) + '-' + Math.round(list.bottom)); } return out; })()`);
      if (opt.length) throw new Error(opt.join('; '));
    });
    await see('the launcher, step 1');
    await see('the launcher, step 2 (ideas)', async () => { await p.click('[data-launcher] .launch-type[data-type=game]'); await p.until('document.querySelectorAll("[data-launcher] .launch-card").length >= 2', 'ideas', 12000); await sleep(400); });
    await see('the launcher, step 3 (review)', async () => { await p.click('[data-launcher] .launch-card[data-idea]'); await p.until('!!document.querySelector("[data-launcher] [data-go]")', 'review', 8000); await sleep(400); });
    p.close();
  })();

  // ---- a floor that's been running, as its boss ----
  const c = await claim(t, `Phone Co ${tag}`);
  await c.post(`/api/floors/${c.slug}/chat`, { text: 'hello there, tell me about the team' });
  await sleep(400);
  await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build a very small website [fast]' });
  await sleep(1200);
  await (async () => {
    const p = await newPage(IOS); const see = screen(p, `${tag} boss`, opts);
    await p.goto(`${base}?q=low`);
    await cookie(p, c);
    await p.goto(`${base}/floor/${c.slug}?q=low`);
    await onFloor(p);
    await sleep(1600);
    await settled(p);
    await see('Manager, on arrival', async () => { await p.ev('window.__office.chatFollow?.settle(); true'); });
    if (phoneLayout) {
      await step(`${tag} boss: the chat gets at least 55% of the visible height`, async () => {
        for (const tab of ['chat', 'talk']) {
          await p.click(`[data-tab=${tab}]`); await settled(p); await sleep(200);
          const r = await p.ev(`(() => { const l = document.querySelector('.chat-list, .talk-list').getBoundingClientRect(); return { h: l.height, vh: visualViewport.height, sheet: document.body.dataset.sheet, list: l.height / visualViewport.height }; })()`);
          if (r.list < 0.55) throw new Error(`${tab}: ${JSON.stringify(r)}`);
          if (r.sheet !== 'full') throw new Error(`${tab} opened ${r.sheet}`);
        }
        await p.click('[data-tab=chat]');
      });
      await step(`${tag} boss: the staff strip folds away while a chat or tab is open`, async () => {
        const hRatio = await p.ev('(() => { const s = document.querySelector(".floor-panel > .staff-strip"); return s ? s.getBoundingClientRect().height : 0; })()');
        if (hRatio !== 0) throw new Error(`the strip is ${hRatio} tall`);
      });
      await step(`${tag} boss: dragging the handle between all three sizes, with touch`, async () => {
        const grip = await p.ev('(() => { const r = document.querySelector(".panel-grip").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
        const size = () => p.ev('({ s: document.body.dataset.sheet, h: Math.round(document.querySelector(".floor-panel").getBoundingClientRect().height), top: Math.round(document.querySelector(".panel-grip").getBoundingClientRect().top + 22), vh: innerHeight })');
        const dragTo = async (toY) => { const g = await size(); await p.drag(grip.x, g.top, grip.x, toY, true); await sleep(380); await settled(p); return size(); };
        let st = await size();
        if (st.s !== 'full') throw new Error(`starts at ${JSON.stringify(st)}`);
        st = await dragTo(Math.round(h * 0.42)); if (st.s !== 'half' || Math.abs(st.h - h * 0.58) > 3) throw new Error(`to half: ${JSON.stringify(st)}`);
        st = await dragTo(h - 60); if (st.s !== 'peek' || st.h > 260) throw new Error(`to peek: ${JSON.stringify(st)}`);
        st = await dragTo(Math.round(h * 0.42)); if (st.s !== 'half') throw new Error(`peek to half: ${JSON.stringify(st)}`);
        st = await dragTo(10); if (st.s !== 'full') throw new Error(`half to full: ${JSON.stringify(st)}`);
        // Flicked, not dragged: a short fast move goes to the next size.
        const g = await size();
        // Timestamps given rather than left to the wall clock: a loaded machine can't turn a flick into a slow drag.
        const t0 = Date.now() / 1000;
        await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x, y: g.top }], timestamp: t0 });
        for (let i = 1; i <= 4; i++) { await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: grip.x, y: g.top + 14 * i }], timestamp: t0 + i * 0.02 }); await sleep(10); }
        await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.09 });
        await p.until('document.body.dataset.sheet !== "full"', 'the flick to count', 2500).catch(() => {});
        await settled(p); await sleep(300);
        st = await size(); if (st.s !== 'half') throw new Error(`flick down: ${JSON.stringify(st)}`);
        await p.click('[data-sheet-step]'); await settled(p); st = await size(); if (st.s !== 'full') throw new Error(`step up: ${JSON.stringify(st)}`);
        await p.click('[data-sheet-step]'); await settled(p); st = await size(); if (st.s !== 'half') throw new Error(`step down: ${JSON.stringify(st)}`);
        await p.click('.panel-grip'); await settled(p); st = await size(); if (st.s !== 'peek') throw new Error(`tap to fold: ${JSON.stringify(st)}`);
        await p.click('[data-tab=chat]'); await settled(p);
        st = await size(); if (st.s !== 'half') throw new Error(`chat from peek should reopen at the size last chosen (${st.s})`);
        await p.click('[data-sheet-step]'); await settled(p);
      });
      await see('Manager, at half', async () => { await p.ev('window.__office.setSheet("half"); true'); await settled(p); });
      await see('Manager, at peek', async () => { await p.ev('window.__office.setSheet("peek"); true'); await settled(p); });
      await p.ev('window.__office.setSheet("full"); true'); await settled(p);
      await step(`${tag} boss: long text, links, tables and code wrap with no sideways scroll`, async () => {
        await p.ev(`(() => { const o = window.__office; o.chatList.insertBefore(o.messageEl({ id: 'long', role: 'manager', agentId: o.manager.id, text: ${JSON.stringify(LONG)} }), o.lanesEl || o.questionsEl); o.scrollChat({ force: true }); return true; })()`);
        await sleep(200);
        const r = await p.ev('(() => { const m = document.querySelector("[data-id=long]").getBoundingClientRect(); const l = document.querySelector(".chat-list"); return { right: m.right, width: innerWidth, listSw: l.scrollWidth, listCw: l.clientWidth }; })()');
        if (r.right > r.width || r.listSw > r.listCw + 1) throw new Error(JSON.stringify(r));
        await audit(p, 'long message', opts);
      });
      await step(`${tag} boss: quick-reply options sit right above the composer, wrapped, nothing clipped`, async () => {
        await p.ev(`(() => { const o = window.__office; o.state.business = { ...(o.state.business || {}), active: true, chips: ['Yes, go ahead with the plan as you laid it out', 'What would it cost me in time?', 'Change the name first', 'Tell me more about the research'] }; o.renderBody(); return true; })()`);
        await sleep(250);
        const r = await p.ev(`(() => { const chips = [...document.querySelectorAll('.chat-chips .chip')]; const input = document.querySelector('.chat-input').getBoundingClientRect(); const out = chips.map((c) => { const b = c.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { top: b.top, bottom: b.bottom, right: b.right, h: b.height, ok: !!hit && (c === hit || c.contains(hit)), clipped: c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 2 }; }); const list = document.querySelector('.chat-list').getBoundingClientRect(); return { chips: out, inputTop: input.top, listBottom: list.bottom, list: list.height, vh: innerHeight, vw: innerWidth }; })()`);
        for (const c of r.chips) {
          if (!c.ok) throw new Error(`a chip is covered: ${JSON.stringify(c)}`);
          if (c.clipped) throw new Error(`a chip's text is cut: ${JSON.stringify(c)}`);
          if (c.h < 43.5) throw new Error(`a chip is too small: ${JSON.stringify(c)}`);
          if (c.bottom > r.inputTop + 1 || c.top < r.listBottom - 1) throw new Error(`a chip isn't between the messages and the composer: ${JSON.stringify(c)} ${JSON.stringify({ i: r.inputTop, l: r.listBottom })}`);
          if (c.right > r.vw) throw new Error(`a chip runs off the screen: ${JSON.stringify(c)}`);
        }
        if (r.list < 180) throw new Error(`the chips left ${r.list}px for the conversation`);
        await audit(p, 'chips', opts);
        await p.ev('(() => { const o = window.__office; o.state.business = null; o.renderBody(); return true; })()');
      });
      await step(`${tag} boss: scrolled up, a new message waits behind a pill and the list stays put`, async () => {
        await p.ev('(() => { const l = document.querySelector(".chat-list"); l.scrollTop = 0; l.dispatchEvent(new Event("scroll")); return true; })()');
        await sleep(100);
        await p.ev(`(() => { const o = window.__office; o.chatList.insertBefore(o.messageEl({ id: 'n1', role: 'manager', agentId: o.manager.id, text: 'A new one while you were reading' }), o.lanesEl || o.questionsEl); o.scrollChat({ line: true }); return true; })()`);
        await sleep(120);
        const pill = await p.ev('(() => { const e = document.querySelector("[data-new-pill]"); const l = document.querySelector(".chat-list"); return { hidden: e.hidden, top: l.scrollTop }; })()');
        if (pill.hidden || pill.top > 8) throw new Error(JSON.stringify(pill));
        await p.click('[data-new-pill]');
        await sleep(300);
        const end = await p.ev('(() => { const l = document.querySelector(".chat-list"); return { gap: l.scrollHeight - l.scrollTop - l.clientHeight, hidden: document.querySelector("[data-new-pill]").hidden }; })()');
        if (end.gap > 80 || !end.hidden) throw new Error(`after the pill: ${JSON.stringify(end)}`);
      });
      for (const [kb, top, how] of [[300, 0, 'Android-style'], [320, 96, 'iOS-style (page shifted)']]) {
        await step(`${tag} boss: the keyboard (${how}): the composer sits right above it, recent messages visible`, async () => {
          await p.click('.chat-input textarea');
          await sleep(120);
          const H = await keyboard(p, kb, top);
          await sleep(320);
          try {
          const r = await p.ev(`(() => { const c = document.querySelector('.chat-input').getBoundingClientRect(); const l = document.querySelector('.chat-list').getBoundingClientRect(); const msgs = [...document.querySelectorAll('.chat-list .msg:not([hidden])')]; const last = msgs.at(-1).getBoundingClientRect(); const panel = document.querySelector('.floor-panel').getBoundingClientRect(); return { composer: Math.round(c.bottom), list: Math.round(l.height), lastBottom: Math.round(last.bottom), listBottom: Math.round(l.bottom), panelTop: Math.round(panel.top), panelBottom: Math.round(panel.bottom), inner: innerHeight }; })()`);
          if (Math.abs(r.composer - H) > 2) throw new Error(`composer ${r.composer} should sit at ${H}: ${JSON.stringify(r)}`);
          if (r.panelTop < top - 1) throw new Error(`the sheet's top is above the visible screen ${JSON.stringify(r)}`);
          if (r.list < 100) throw new Error(`only ${r.list}px of chat: ${JSON.stringify(r)}`);
          const stuck = await p.ev(`({ pinned: window.__office.chatFollow.pinned, sh: document.querySelector('.chat-list').scrollHeight, st: document.querySelector('.chat-list').scrollTop, ch: document.querySelector('.chat-list').clientHeight })`);
          await p.until(`(() => { const l = document.querySelector('.chat-list').getBoundingClientRect(); const msgs = [...document.querySelectorAll('.chat-list .msg:not([hidden])')]; const b = msgs.at(-1).getBoundingClientRect().bottom; return b <= l.bottom + 2 && b >= l.bottom - 140; })()`, "the newest message on screen with the keyboard up", 3000).catch(() => { throw new Error(`the newest message isn't visible: ${JSON.stringify(r)} ${JSON.stringify(stuck)}`); });
          await audit(p, 'keyboard', { ...opts, portrait: false });
          } finally { await noKeyboard(p); await p.ev('document.activeElement?.blur?.(); true'); }
          await sleep(300);
          const back = await p.ev(`({ c: Math.round(document.querySelector('.chat-input').getBoundingClientRect().bottom), h: innerHeight })`);
          if (back.c < back.h - 110) throw new Error(`the composer stayed up: ${JSON.stringify(back)}`);
        });
      }
      await step(`${tag} boss: every tab is reachable from the row, and none is cut off`, async () => {
        const tabs = await p.ev(`(() => { const row = [...document.querySelectorAll('.floor-panel > .tabs > .tab')]; return { n: row.length, right: Math.max(...row.map((b) => b.getBoundingClientRect().right)), rows: new Set(row.map((b) => Math.round(b.getBoundingClientRect().top))).size, sw: document.querySelector('.tabs').scrollWidth, cw: document.querySelector('.tabs').clientWidth, width: innerWidth }; })()`);
        if (tabs.right > tabs.width || tabs.n !== 5 || tabs.rows !== 1 || tabs.sw > tabs.cw + 1) throw new Error(JSON.stringify(tabs));
      });
      await see('More open', async () => { await p.click('[data-tab-more]'); await sleep(120); });
      await step(`${tag} boss: More closes when you tap outside`, async () => { await p.ev('document.querySelector(".tab-body").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); true'); await sleep(60); if (await p.ev('window.__office.moreOpen')) throw new Error('still open'); });
    }
    const tabs = await p.ev('[...document.querySelectorAll("[data-tab]")].map((x) => x.dataset.tab)');
    for (const tab of tabs) await see(`tab ${tab}`, async () => { await p.click(`[data-tab=${tab}]`); await sleep(260); if (phoneLayout) await settled(p); });
    await see('a staff file', async () => { if (phoneLayout) { await p.click('[data-tab=work]'); await sleep(200); await p.click('.staff-chip[data-agent]'); } else await p.ev('window.__office.openAgent(window.__office.state.agents[0]); true'); await p.until('!!document.querySelector(".modal [data-profile]")', 'the file', 5000); await sleep(200); });
    await see('staff editor', async () => { await p.click('[data-profile-edit]'); await p.until('!!document.querySelector(".modal .staff-pick")', 'the editor', 5000); await sleep(300); });
    await p.ev('document.querySelector(".modal .icon-btn")?.click(); true');
    await sleep(150);
    await p.ev('window.__office.setTab("chat"); true');
    const custom = await p.ev('[...document.querySelectorAll(".controls button")].map((b) => b.textContent.trim()).join()');
    await see('customise: vibe', async () => { if (phoneLayout) await p.ev('window.__office.setSheet("half"); true'); await p.ev('window.__office.openCustomise("vibe"); true'); await p.until('!!document.querySelector(".modal .custom-tabs")', 'customise', 5000); await sleep(400); });
    for (const part of await p.ev('[...document.querySelectorAll(".modal .custom-tabs [data-custom]")].map((b) => b.dataset.custom)')) await see(`customise: ${part}`, async () => { await p.click(`.modal .custom-tabs [data-custom="${part}"]`); await sleep(350); });
    await p.ev('document.querySelector(".modal .icon-btn")?.click(); true');
    await sleep(120);
    await see('redirect dialog', async () => { await p.ev('window.__office.openRedirect(); true'); await sleep(250); });
    await p.ev('document.querySelector(".modal .icon-btn")?.click(); true');
    await see('stop dialog', async () => { await p.ev('window.__office.confirmStop(); true'); await sleep(250); });
    await p.ev('document.querySelector(".modal .icon-btn")?.click(); true');
    console.log(`  ${tag}: tabs ${tabs.join(' ')} | controls ${custom}`);
    p.close();
  })();

  // ---- the same floor as a visitor ----
  await (async () => {
    const p = await newPage(); const see = screen(p, `${tag} visitor`, opts);
    await p.send('Network.clearBrowserCookies');
    await p.goto(`${base}/floor/${c.slug}?q=low`);
    await onFloor(p);
    await sleep(1400);
    await see('floor on arrival');
    const tabs = await p.ev('[...document.querySelectorAll("[data-tab]")].map((x) => x.dataset.tab)');
    for (const tab of tabs) await see(`tab ${tab}`, async () => { await p.click(`[data-tab=${tab}]`); await sleep(220); if (phoneLayout) await settled(p); });
    await see('This is my floor', async () => { const hasBtn = await p.ev('(() => { const b = [...document.querySelectorAll(".controls button")].find((b) => /my floor/.test(b.textContent)); if (!b) return false; b.click(); return true; })()'); if (hasBtn) await p.until('!!document.querySelector(".modal")', 'sign in', 5000); });
    await p.ev('document.querySelector(".modal .icon-btn")?.click(); true');
    p.close();
  })();
  b.close();
}

console.log(`\n${results.length - failures}/${results.length} passed`);
await t.close();
process.exit(failures ? 1 : 0);
