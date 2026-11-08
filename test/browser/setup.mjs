// Real Chrome, mock models, real phone emulation: the full-screen Setup a fresh floor's boss gets, on a phone and a desktop.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { get } from '../../server/db.js';
import { boot, claim } from '../helpers.js';

const SHOTS = process.env.SETUP_SHOTS || '/tmp/setup-shots'; mkdirSync(SHOTS, { recursive: true });
let failures = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 240)})` : ''}`); };
let lastPage = null;
const step = async (name, fn) => { try { await fn(); } catch (e) {
  let info = '';
  try { info = await lastPage?.ev('JSON.stringify({ step: document.querySelector(".setup")?.dataset.step, tab: window.__office?.tab, floor: window.__office?.state?.floor?.name, text: document.querySelector(".setup")?.textContent.slice(0, 90), toast: [...document.querySelectorAll(".toast")].map((x) => x.textContent).join("|") })'); } catch {}
  try { await lastPage?.shot(join(SHOTS, `fail-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.jpg`)); } catch {}
  check(name, false, `${e.message} ${info}`); } };

const t = await boot({ mockDelayMs: 350, peopleTalk: false });
const base = t.base;
const q = JSON.stringify;
const ID = /favicon|Office Cloud: no Office server/;
const errorsOf = (p) => p.errors.filter((e) => !ID.test(e));

/** Everything the brief asks of a step on a phone, in numbers. */
const fits = (p) => p.ev(`(() => {
  const root = document.querySelector('.setup'), r = root.getBoundingClientRect(), vv = window.visualViewport;
  const foot = root.querySelector('.setup-foot').getBoundingClientRect(), main = root.querySelector('.setup-main');
  const go = root.querySelector('.setup-foot .setup-btn.primary')?.getBoundingClientRect();
  const small = [...root.querySelectorAll('button, input, textarea')].filter((e) => e.offsetParent && !e.closest('.setup-dots')).map((e) => { const b = e.getBoundingClientRect(); return { what: (e.textContent || e.name || e.tagName).slice(0, 24), h: Math.round(b.height), w: Math.round(b.width) }; }).filter((b) => b.h < 44 || b.w < 44);
  return { full: Math.abs(r.top - vv.offsetTop) < 2 && Math.abs(r.height - vv.height) < 2 && Math.abs(r.width - vv.width) < 2, wide: root.scrollWidth <= root.clientWidth + 1 && main.scrollWidth <= main.clientWidth + 1, footIn: foot.bottom <= vv.height + vv.offsetTop + 1 && foot.top >= 0, goIn: !go || (go.top >= 0 && go.bottom <= vv.height + vv.offsetTop + 1), small };
})()`);
const fitsAt = async (p, label, width, height) => {
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await sleep(250);
  const f = await fits(p);
  check(`${label} at ${width}x${height}: full height, nothing clipped, main button reachable, 44px taps`, f.full && f.wide && f.footIn && f.goIn && !f.small.length, JSON.stringify(f));
};
const phoneSizes = (label, p) => [[360, 640], [390, 664]].reduce((c, [w, h]) => c.then(() => fitsAt(p, label, w, h)), Promise.resolve()).then(() => p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })).then(() => sleep(150));

const claimHere = async (p, name) => {
  await p.goto(`${base}/robots.txt`);
  const body = { code: t.code(), ...(name ? { name, bossName: 'Sam' } : {}) };
  return p.ev(`fetch('/theoffice/api/claim',{method:'POST',headers:{'content-type':'application/json'},body:${q(q(body))}}).then(r=>r.json())`);
};
const setupOpen = (step) => `document.querySelector(".setup")?.dataset.step === ${q(step)}`;
const floorIdOf = (slug) => get(t.db, 'SELECT id FROM floors WHERE slug=?', slug)?.id;

const kinds = [['phone', { mobile: true }], ['desktop', { width: 1280, height: 800 }]].filter(([k]) => !process.env.SETUP_ONLY || process.env.SETUP_ONLY === k);
const b = await launch();
try {
  for (const [label, opts] of kinds) {
    const phone = label === 'phone';
    // ---- 1. through the front door: the keys, every step and Back, a reload, then Go ----
    const p = await b.newPage(opts); lastPage = p;
    await step(`${label}: a boss with a code lands in Setup, not the chat, and gets the keys`, async () => {
      await p.goto(`${base}/?q=low`);
      await p.until('!!document.querySelector(".open-pill")', 'the Open an office button', 20000);
      await p.until('(() => { const r = document.querySelector(".open-pill")?.getBoundingClientRect(); if (!r) return false; const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && !!t.closest(".open-pill"); })()', 'the pill on top', 20000);
      await p.click('.open-pill');
      await p.until('document.activeElement && document.activeElement.classList.contains("code-input")', 'the code field', 8000);
      await p.ev(`(() => { const i = document.querySelector(".code-input"); i.value = ${q(t.code())}; i.dispatchEvent(new ClipboardEvent("paste", { bubbles: true })); })()`);
      await p.until('document.body.dataset.page === "floor" && !!window.__office', 'straight to the floor', 15000);
      await p.until(setupOpen('keys'), 'the keys, in Setup', 8000);
      check(`${label}: the recovery code is on the Setup screen`, /^RECOVER-/.test(await p.ev('document.querySelector("[data-setup-keys] [data-recovery]").textContent')));
      const covered = await p.ev(`(() => { const r = document.querySelector('.setup').getBoundingClientRect(); const pts = [[r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8], [r.left + r.width / 2, r.top + r.height / 2]]; const inSetup = pts.every(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.setup')); const chat = document.querySelector('.chat-input textarea'); const c = chat?.getBoundingClientRect(); const chatOnTop = !!c && !!document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2)?.closest('.chat-input'); return { inSetup, chatOnTop }; })()`);
      check(`${label}: Setup covers the screen and the chat is out of reach`, covered.inSetup && !covered.chatOnTop, JSON.stringify(covered));
      if (phone) await p.shot(join(SHOTS, 'keys-phone.jpg'));
      await p.click('[data-setup-saved]');
      await p.until(setupOpen('what'), 'What are we making');
      check(`${label}: saving the code moves on, and it is gone from the floor`, !(await p.ev('!!document.querySelector("[data-recovery-card]") || window.__office.recoveryEl')));
    });
    await step(`${label}: each question is a screen of its own, and Back works on every one`, async () => {
      const types = await p.ev('[...document.querySelectorAll(".setup [data-type] b")].map((x) => x.textContent).join("|")');
      check(`${label}: What are we making? offers the four`, types === 'Game|App / SaaS|Website|Business', types);
      if (phone) { await phoneSizes(`${label} what`, p); await p.shot(join(SHOTS, 'what-phone.jpg')); }
      await p.click('[data-type="game"]');
      await p.until('document.querySelectorAll(".setup [data-idea]").length === 3 && !!document.querySelector(".setup [data-surprise]")', 'ideas');
      check(`${label}: Which one offers idea cards, Surprise me and your own words`, await p.ev('!!document.querySelector(".setup textarea[name=own]")'));
      if (phone) await phoneSizes(`${label} which`, p);
      await p.click('[data-setup-back]');
      await p.until(setupOpen('what'), 'Back to What');
      check(`${label}: Back from Which lands on What`, await p.ev('document.querySelectorAll(".setup [data-type]").length === 4'));
      await p.click('[data-type="game"]');
      await p.until('document.querySelectorAll(".setup [data-idea]").length === 3', 'ideas again');
      await p.click('[data-idea]');
      await p.until('document.querySelector("[data-idea].sel") && !document.querySelector("[data-next]").disabled', 'the pick highlighted, Next live');
      await p.click('[data-next]');
      await p.until(setupOpen('ready'), 'Ready');
      const filled = await p.ev('(() => { const v = (s) => document.querySelector(".setup [name=" + s + "]").value; return { company: v("company"), name: v("name"), goal: v("goal"), planLines: document.querySelectorAll(".setup [data-plan-step]").length }; })()');
      check(`${label}: Ready has the company's name filled in from the pick, and the name, goal and plan`, filled.company.length > 1 && filled.company === filled.name && filled.goal.length > 3 && filled.planLines >= 3, JSON.stringify(filled));
      if (phone) { await phoneSizes(`${label} ready`, p); await p.shot(join(SHOTS, 'ready-phone.jpg')); }
      await p.click('[data-setup-back]');
      await p.until('document.querySelectorAll(".setup [data-idea]").length === 3', 'Back to Which');
      check(`${label}: Back from Ready lands on Which`, await p.ev(setupOpen('which')));
    });
    await step(`${label}: a typed company name survives Back, a new pick and a reload; a bad one is stopped`, async () => {
      await p.click('[data-idea]');
      await p.click('[data-next]');
      await p.until(setupOpen('ready'), 'Ready');
      await p.type('.setup input[name=company]', 'Moth Works');
      await p.click('[data-setup-back]');
      await p.until('document.querySelectorAll(".setup [data-idea]").length === 3', 'Which');
      await p.ev('document.querySelectorAll(".setup [data-idea]")[1].click()');
      await p.click('[data-next]');
      await p.until(setupOpen('ready'), 'Ready, a different pick');
      check(`${label}: the typed company name stays through a new pick`, await p.ev('document.querySelector(".setup input[name=company]").value === "Moth Works"'));
      await p.type('.setup input[name=goal]', 'Win the night');
      await sleep(150);
      await p.ev('location.reload()');
      await p.until('document.body.dataset.page === "floor" && !!window.__office', 'the floor again', 20000);
      await p.until(setupOpen('ready'), 'back on Ready after a reload', 8000);
      const kept = await p.ev('({ company: document.querySelector(".setup input[name=company]").value, goal: document.querySelector(".setup input[name=goal]").value })');
      check(`${label}: a reload keeps the place and what was typed`, kept.company === 'Moth Works' && kept.goal === 'Win the night', JSON.stringify(kept));
      check(`${label}: a reload doesn't show the keys again`, !(await p.ev('!!document.querySelector("[data-setup-keys]")')));
      await p.type('.setup input[name=company]', 'M');
      await p.click('[data-go]');
      await sleep(250);
      check(`${label}: a one-letter company is stopped at the field`, await p.ev('!!document.querySelector(".setup-field.bad") && document.querySelector(".setup").dataset.step === "ready"'));
      await p.type('.setup input[name=company]', 'Moth Works');
    });
    await step(`${label}: Go closes Setup and lands in the chat with the team building`, async () => {
      await p.ev('window.__seen = []; new MutationObserver(() => { const m = document.querySelector("[data-maker]"); if (m) window.__seen.push(m.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); true');
      const slugBefore = await p.ev('window.__office.slug');
      await p.click('[data-go]');
      await p.until('!document.querySelector(".setup")', 'Setup gone', 15000);
      await p.until('window.__office.tab === "chat" && !!document.querySelector(".chat-input textarea")', 'the chat', 8000);
      await p.until('(window.__seen || []).some((x) => /Team is building/.test(x))', '"Team is building"', 15000);
      check(`${label}: the maker card shows the team building`, true);
      await p.until('window.__office.state.floor.name === "Moth Works"', 'the company named', 8000);
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', await p.ev('window.__office.slug')).id;
      check(`${label}: the company name saved before the job, and the job has its own`, get(t.db, 'SELECT name FROM floors WHERE id=?', fid).name === 'Moth Works' && !!get(t.db, 'SELECT id FROM maker_jobs WHERE floor_id=?', fid));
      check(`${label}: the place is forgotten`, await p.ev(`localStorage.getItem(${q('office-setup-' + slugBefore)}) === null`));
      if (phone) await p.shot(join(SHOTS, 'after-go-phone.jpg'));
      await p.ev('location.reload()');
      await p.until('document.body.dataset.page === "floor" && !!window.__office', 'the floor again', 20000);
      await sleep(600);
      check(`${label}: Setup is over for good`, !(await p.ev('!!document.querySelector(".setup")')));
      check(`${label}: no console errors`, errorsOf(p).length === 0, errorsOf(p).join(' || '));
    });
    p.close();

    // ---- 2. leaving and coming back: the lobby, the browser's own Back, own words, Surprise me ----
    const p2 = await b.newPage(opts); lastPage = p2;
    await step(`${label}: leaving the floor mid-setup and coming back keeps the place, own words and Surprise me reach Ready`, async () => {
      const made = await claimHere(p2);
      await p2.goto(`${base}/floor/${made.slug}?q=low`);
      await p2.until(setupOpen('what'), 'Setup, no keys pending', 15000);
      await p2.click('[data-type="website"]');
      await p2.until('document.querySelectorAll(".setup [data-idea]").length === 3', 'ideas');
      // Off to the lobby and back: nothing crashes and the place is still there.
      await p2.ev('window.officeGo("/"); true');
      await p2.until('document.body.dataset.page !== "floor"', 'the lobby', 10000);
      check(`${label}: Setup leaves with the floor`, !(await p2.ev('!!document.querySelector(".setup")')));
      await p2.ev(`window.officeGo(${q('/floor/' + made.slug)}); true`);
      await p2.until('document.body.dataset.page === "floor" && !!window.__office', 'the floor', 15000);
      await p2.until(setupOpen('which'), 'back where they were', 8000);
      await p2.until('document.querySelectorAll(".setup [data-idea]").length === 3', 'ideas, again', 8000);
      check(`${label}: coming back from the lobby keeps the place`, true);
      // The browser's own Back leaves the floor, as any page does, and Forward returns to the same step.
      await p2.ev('history.back(); true');
      await p2.until('document.body.dataset.page !== "floor" || location.pathname.endsWith("/robots.txt")', 'off the floor', 10000);
      await p2.ev('history.forward(); true');
      await p2.until('document.body.dataset.page === "floor" && !!window.__office', 'the floor', 15000);
      await p2.until(setupOpen('which'), 'back on the same step', 8000);
      check(`${label}: the browser's Back and Forward come back to the same step`, true);
      // Own words and Surprise me both reach Ready from here.
      await p2.type('.setup textarea[name=own]', 'A site for people who rate park benches');
      await p2.until('!document.querySelector("[data-next]").disabled', 'Next lights up for own words');
      await p2.click('[data-next]');
      await p2.until(setupOpen('ready'), 'Ready, from own words', 8000);
      const own = await p2.ev(`({ picked: JSON.parse(localStorage.getItem(${q('office-setup-' + made.slug)})).pitch, company: document.querySelector(".setup [name=company]").value })`);
      check(`${label}: own words become the idea, and name the company`, /park benches/.test(own.picked) && own.company.length > 1, JSON.stringify(own));
      await p2.click('[data-setup-back]');
      await p2.until('document.querySelectorAll(".setup [data-idea]").length === 3', 'Which');
      await p2.click('[data-surprise]');
      await p2.until(setupOpen('ready'), 'Ready, from Surprise me', 8000);
      check(`${label}: Surprise me fills Ready too`, await p2.ev('document.querySelector(".setup [name=name]").value.length > 1 && document.querySelectorAll(".setup [data-plan-step]").length >= 3'));
      check(`${label}: no console errors along the way`, errorsOf(p2).length === 0, errorsOf(p2).join(' || '));
    });
    if (phone) await step(`${label}: with the keyboard up, the field being typed in and Go stay in view`, async () => {
      // Headless Chrome has no on-screen keyboard. The visual viewport is what Setup follows, so that is what shrinks here.
      await p2.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
      await sleep(200);
      await p2.ev('(() => { const i = document.querySelector(".setup input[data-plan-step]"); i.scrollIntoView(); i.focus(); return true; })()');
      await p2.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 340, deviceScaleFactor: 2, mobile: true });
      await sleep(600);
      const seen = await p2.ev(`(() => {
        const vv = window.visualViewport, f = document.activeElement, r = f.getBoundingClientRect(), go = document.querySelector('.setup-foot .setup-btn.primary').getBoundingClientRect(), root = document.querySelector('.setup').getBoundingClientRect();
        return { field: f.getAttribute('aria-label') || f.name, fieldTop: r.top, fieldBottom: r.bottom, goTop: go.top, goBottom: go.bottom, vh: vv.height, rootH: root.height };
      })()`);
      check(`${label}: the plan field stays visible above the keyboard`, /^Step/.test(seen.field) && seen.fieldTop >= 0 && seen.fieldBottom <= seen.goTop + 1 && seen.goBottom <= seen.vh + 1 && Math.abs(seen.rootH - seen.vh) < 2, JSON.stringify(seen));
      await p2.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(200);
    });
    p2.close();

    // ---- 3. the way out, a visitor, and a floor that already has a name ----
    const p3 = await b.newPage(opts); lastPage = p3;
    await step(`${label}: "I'd rather just tell the manager" goes to the chat and doesn't come back`, async () => {
      const made = await claimHere(p3);
      await p3.goto(`${base}/floor/${made.slug}?q=low`);
      await p3.until(setupOpen('what'), 'Setup', 15000);
      await p3.click('[data-setup-out]');
      await p3.until('!document.querySelector(".setup") && window.__office.tab === "chat" && !!document.querySelector(".chat-input textarea")', 'the chat', 8000);
      check(`${label}: the chat has no launcher to come back at them, just the note`, await p3.ev('!document.querySelector("[data-launcher]") && !!document.querySelector("[data-setup]")'));
      await p3.ev('location.reload()');
      await p3.until('document.body.dataset.page === "floor" && !!window.__office', 'the floor again', 20000);
      await sleep(800);
      check(`${label}: a reload doesn't bring Setup back`, !(await p3.ev('!!document.querySelector(".setup")')));
      await p3.type('.chat-input textarea', 'Let us talk about a bakery called Night Loaf');
      await p3.click('.send');
      await p3.until('[...document.querySelectorAll(".msg.boss")].some((m) => /Night Loaf/.test(m.textContent))', 'the boss\'s message');
      await p3.ev('location.reload()');
      await p3.until('document.body.dataset.page === "floor" && !!window.__office', 'the floor again', 20000);
      await sleep(800);
      check(`${label}: after talking to the manager, Setup stays away`, !(await p3.ev('!!document.querySelector(".setup")')));
      check(`${label}: no console errors on the way out`, errorsOf(p3).length === 0, errorsOf(p3).join(' || '));

      const b2 = await launch();
      const v = await b2.newPage(opts);
      await v.goto(`${base}/floor/${made.slug}?q=low`);
      await v.until('!!window.__office', 'visitor floor', 20000);
      await sleep(600);
      check(`${label}: a visitor never gets Setup`, !(await v.ev('!!document.querySelector(".setup")')) && !(await v.ev('!!window.__office.state.viewer.owner')));
      v.close(); b2.close();
    });
    p3.close();

    const p4 = await b.newPage(opts); lastPage = p4;
    await step(`${label}: a floor that already has a name isn't interrupted`, async () => {
      const made = await claimHere(p4, `Named ${label}`);
      await p4.goto(`${base}/floor/${made.slug}?q=low`);
      await p4.until('!!window.__office && !!document.querySelector(".chat-input textarea")', 'the floor', 15000);
      await sleep(800);
      check(`${label}: no Setup on a named floor`, !(await p4.ev('!!document.querySelector(".setup")')));
      check(`${label}: the named floor keeps its launcher in the chat`, await p4.ev('document.querySelectorAll("[data-launcher] [data-type]").length === 4'));
      check(`${label}: no console errors on the named floor`, errorsOf(p4).length === 0, errorsOf(p4).join(' || '));
    });
    p4.close();
  }
} finally { b.close(); await t.close(); }

console.log(`${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
