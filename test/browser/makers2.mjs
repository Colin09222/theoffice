// Real Chrome, mock models: the shorter way in from the lobby, the Launch hold and the honest pass list, on a phone and a desktop.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { get } from '../../server/db.js';
import { boot, claim } from '../helpers.js';

const SHOTS = process.env.MAKERS_SHOTS || '/tmp/makers2-shots'; mkdirSync(SHOTS, { recursive: true });
let failures = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 240)})` : ''}`); };
let lastPage = null;
const step = async (name, fn) => { try { await fn(); } catch (e) {
  let info = '';
  try { info = await lastPage?.ev('JSON.stringify({ tab: window.__office?.tab, panel: window.__office?.panelOpen, launcher: document.querySelector("[data-launcher]")?.textContent.slice(0, 90), maker: document.querySelector("[data-maker]")?.dataset.stage, job: window.__office?.state?.makers?.job?.stage, heldFix: window.__office?.state?.makers?.job?.held, ask: window.__office?.state?.makers?.job?.asking })'); } catch {}
  try { await lastPage?.shot(join(SHOTS, `fail-${name.replace(/[^a-z0-9]+/gi, '-')}.jpg`)); } catch {}
  check(name, false, `${e.message} ${info}`); } };

// A slow enough team that the held state is on screen long enough to read.
const t = await boot({ mockDelayMs: 700, peopleTalk: false, liveCheckDelayMs: 5 });
const base = t.base;
const main = new URL(base).origin;
const b = await launch();
const kinds = [['phone', { mobile: true }], ['desktop', { width: 1280, height: 800 }]].filter(([k]) => !process.env.MAKERS2_ONLY || process.env.MAKERS2_ONLY === k);
try {
  for (const [label, opts] of kinds) {
    const p = await b.newPage(opts); lastPage = p;
    await step(`${label}: lobby to launcher`, async () => {
      await p.goto(`${base}/?q=low`);
      await p.until('!!document.querySelector(".open-pill")', 'the Open an office button', 20000);
      const legal = await p.ev('[...document.querySelectorAll(".dir-legal a")].map((x) => x.getAttribute("href"))');
      check(`${label}: the lobby links About and Privacy`, legal.some((x) => x.endsWith('/about')) && legal.some((x) => x.endsWith('/privacy')), legal.join(','));
      // A wrong code is refused exactly as before, and leaves the dialog open.
      // The loading veil over the lobby lifts first.
      await p.until('(() => { const r = document.querySelector(".open-pill")?.getBoundingClientRect(); if (!r) return false; const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && !!t.closest(".open-pill"); })()', 'the pill on top', 20000);
      await p.click('.open-pill');
      await p.until('document.activeElement && document.activeElement.classList.contains("code-input")', 'the code field focused', 8000);
      await p.ev('(() => { const i = document.querySelector(".code-input"); i.value = "OFFICE-NOPE-NOPE-NOPE-NOPE"; i.dispatchEvent(new ClipboardEvent("paste", { bubbles: true })); })()');
      await p.until('!document.querySelector(".form-error").hidden', 'the error for a bad code', 8000);
      check(`${label}: a bad code is refused and the dialog stays`, await p.ev('document.body.dataset.page !== "floor" && !!document.querySelector(".code-input")'));
      await p.ev('document.querySelector(".code-input").value = ""');
      const code = t.code();
      await p.ev(`(() => { const i = document.querySelector(".code-input"); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new ClipboardEvent("paste", { bubbles: true })); })()`);
      await p.until('document.body.dataset.page === "floor" && !!window.__office', 'straight to the floor', 15000);
      const unlockShown = await p.ev('!!document.querySelector(".modal")');
      check(`${label}: no Unlock or Go up step: the dialog closed itself`, !unlockShown);
      await p.until('!!document.querySelector("[data-setup-keys] [data-recovery]")', 'the keys, in Setup', 8000);
      check(`${label}: the recovery code is on the Setup screen`, /^RECOVER-/.test(await p.ev('document.querySelector("[data-setup-keys] [data-recovery]").textContent')));
      await p.shot(join(SHOTS, `lobby-${label}.jpg`));
      await p.click('[data-setup-saved]');
      await p.until('document.querySelectorAll("[data-launcher] [data-type]").length === 4', 'straight into Setup', 15000);
      check(`${label}: one tap and a paste land on Setup`, true);
      await sleep(200);
      check(`${label}: the code goes away only when saved`, !(await p.ev('!!document.querySelector("[data-setup-keys]")')));
      // After Go, the chat lands on the step the team is on.
      await p.click('[data-launcher] [data-type="website"]');
      await p.until('document.querySelectorAll("[data-launcher] [data-idea]").length === 3', 'ideas');
      await p.click('[data-launcher] [data-idea]');
      await p.click('[data-next]');
      await p.until('!!document.querySelector("[data-go]")', 'Go');
      await p.click('[data-go]');
      await p.until('!!document.querySelector("[data-maker]") && !document.querySelector(".setup")', 'the maker card', 15000);
      await sleep(500);
      const onStep = await p.ev(`(() => {
        const step = document.querySelector('[data-maker] [data-step-state="doing"], [data-maker] [data-step-state="todo"]');
        const list = document.querySelector('.chat-list');
        if (!step || !list) return { ok: false, why: 'no step or list' };
        const s = step.getBoundingClientRect(), l = list.getBoundingClientRect();
        return { ok: s.top >= l.top - 2 && s.bottom <= l.bottom + 2, top: s.top, bottom: s.bottom, listTop: l.top, listBottom: l.bottom };
      })()`);
      check(`${label}: after Go the chat is on the current step`, onStep.ok, JSON.stringify(onStep));
      await p.shot(join(SHOTS, `after-go-${label}.jpg`));
    });
    p.close();
  }

  // ---- the Launch hold ----
  for (const [label, opts] of kinds) {
    const c = await claim(t, `Hold ${label}`);
    const p = await b.newPage(opts); lastPage = p;
    await step(`${label}: the hold`, async () => {
      await p.goto(`${base}/robots.txt`);
      await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, secure: false, sameSite: 'Lax' });
      await p.goto(`${base}/floor/${c.slug}?q=low`);
      await p.until('!!window.__office', 'the floor', 20000);
      await p.ev('window.__held = 0; window.__seen = []; new MutationObserver(() => { if (document.querySelector("[data-launch-held]")) window.__held++; const m = document.querySelector("[data-maker]"); if (m) window.__seen.push(m.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); true');
      const r = await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', name: 'Cheat Hive', pitch: 'Bees and a cheat [cheat]' });
      if (r.status !== 200) throw new Error(`start ${r.status}`);
      await p.ev('window.__office.tab = "chat"; window.__office.panelOpen = true; window.__office.reload()');
      await p.until('window.__held > 0', 'Launch held while the team fixes it', 40000);
      check(`${label}: the button says it is fixing a serious bug first`, /Fixing a serious bug first/.test(await p.ev('(window.__seen || []).filter((x) => /Fixing a serious bug/.test(x)).slice(-1)[0] || ""')));
      check(`${label}: no Launch button while held`, !(await p.ev('!!document.querySelector("[data-launch]")')));
      await p.until('!!document.querySelector("[data-launch-anyway]")', 'the boss being asked', 70000);
      await p.shot(join(SHOTS, `hold-${label}.jpg`));
      const warn = await p.ev('document.querySelector("[data-launch-warning]").textContent');
      check(`${label}: the warning names the bug`, /wave=9/.test(warn), warn);
      check(`${label}: Keep trying is offered`, await p.ev('[...document.querySelectorAll("[data-maker] button")].some((x) => x.textContent === "Keep trying")'));
      await p.click('[data-launch-anyway]');
      await sleep(300);
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
      check(`${label}: one tap only arms it`, get(t.db, 'SELECT launched_at a FROM maker_jobs WHERE floor_id=?', fid)?.a === null);
      check(`${label}: the armed button asks to confirm`, /Yes, launch it anyway/.test(await p.ev('document.querySelector("[data-launch-anyway]").textContent')));
      await p.click('[data-launch-anyway]');
      await p.until('!!document.querySelector("[data-launched-with]")', 'the warning stays on the card after launching', 15000);
      check(`${label}: the card says it went live with the known bug`, /wave=9/.test(await p.ev('document.querySelector("[data-launched-with]").textContent')));
      check(`${label}: share link present`, !!(await p.ev('!!document.querySelector("[data-share-url]")')));
    });
    p.close();
  }

  // ---- the honest pass list ----
  for (const [label, opts] of kinds) {
    const c = await claim(t, `Honest ${label}`);
    const p = await b.newPage(opts); lastPage = p;
    await step(`${label}: the pass list`, async () => {
      await p.goto(`${base}/robots.txt`);
      await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, secure: false, sameSite: 'Lax' });
      const r = await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'website', name: 'Full Site', pitch: 'A complete site [full]' });
      if (r.status !== 200) throw new Error(`start ${r.status}`);
      await p.goto(`${base}/floor/${c.slug}?q=low`);
      await p.until('!!window.__office', 'the floor', 20000);
      await p.ev('window.__office.tab = "chat"; window.__office.panelOpen = true; window.__office.reload()');
      await p.until('!!document.querySelector("[data-launch]")', 'Launch once it is ready', 30000);
      await p.until('document.querySelector("[data-maker]")?.dataset.stage === "ready"', 'the job finishing', 30000);
      await p.click('[data-launch]');
      await p.until('!!document.querySelector("[data-share-url]")', 'launched', 15000);
      await p.shot(join(SHOTS, `passes-${label}.jpg`));
      const steps = await p.ev('[...document.querySelectorAll("[data-maker] [data-step-state]")].map((x) => `${x.textContent.trim()}|${x.dataset.stepState}`)');
      check(`${label}: a pass that ran is done`, steps.some((x) => /Polish pass 1.*done\|done/.test(x)), steps.join(' / '));
      check(`${label}: the passes that did not run say skipped`, steps.filter((x) => /Polish pass [23].*skipped\|skipped/.test(x)).length === 2, steps.join(' / '));
      check(`${label}: nothing is left unticked next to LIVE`, !steps.some((x) => /\|todo$|\|doing$/.test(x)));
      check(`${label}: it says Live`, /Live/.test(await p.ev('document.querySelector("[data-maker] .maker-head").textContent')));
      if (label === 'phone') {
        const name = await p.ev(`(() => { const e = document.querySelector('.floor-name'); return { text: e.textContent, sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight, top: e.getBoundingClientRect().top }; })()`);
        check('phone: the header shows the whole company name', name.text === `Honest ${label}` && name.sw <= name.cw + 1 && name.sh <= name.ch + 1, JSON.stringify(name));
      }
    });
    p.close();
  }
} finally {
  await b.close(); await t.close();
}
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);
