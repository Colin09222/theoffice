// The stack view and the lift's one-click floors, in a real browser on a desktop and a phone.
// STACK_SHOTS=/some/dir keeps screenshots.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const OUT = process.env.STACK_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, String(e.message).slice(0, 240)); } };
const t = await boot({ mockDelayMs: 40, peopleTalk: false });
const base = `http://localhost:${t.port}/theoffice`;
await claim(t, 'Alpha Soup', { floor: 3 });
await claim(t, 'Beta Bakes', { floor: 7, body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
await claim(t, 'Hidden Co', { floor: 5 });
await claim(t, 'Gamma Gears', { floor: 12 });
t.db.prepare('UPDATE floors SET hidden=1 WHERE number=5').run();
t.db.prepare("UPDATE floors SET name='' WHERE number=12").run();  // claimed, still in setup

const b = await launch();
// A real key, the way a keyboard sends it: a non-text key needs its key code or Chrome drops it.
const key = async (p, k) => { const vk = { PageUp: 33, PageDown: 34 }[k]; await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
const floorNow = (p) => p.ev('location.pathname.split("/").pop()');
const onFloor = (p, slug) => p.until(`document.body.dataset.page === "floor" && location.pathname.endsWith("/${slug}") && !document.querySelector('.scrub-btn[data-scrub="up"]').title.startsWith('')===false`, `floor ${slug}`);
const lift = (p) => p.until('!!document.querySelector(".scrub-btn .scrub-to") && document.querySelectorAll(".scrub-btn:not(:disabled)").length > 0', 'lift loaded');
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await step('desktop lobby has the Building | Outside toggle, Outside first', async () => {
    await p.goto(`${base}/?q=low`);
    await p.until('document.body.dataset.page === "lobby" && !!document.querySelector(".lobby-mode")', 'lobby');
    const m = await p.ev('document.body.dataset.lobby'); if (m !== 'outside') throw new Error(`mode ${m}`);
  });
  await step('Building shows every floor as a strip, hidden ones left out', async () => {
    await p.click('.mode-btn[data-mode="building"]');
    await p.until('!document.querySelector(".stack").hidden && document.querySelectorAll(".stack-strip").length > 10', 'stack');
    await p.until('document.querySelectorAll(\'.stack-strip[data-floor="7"] .portrait\').length > 0', 'staff faces', 8000).catch(() => {});
    const s = await p.ev(`JSON.stringify({
      n7: document.querySelector('.stack-strip[data-floor="7"] b')?.textContent,
      n12: document.querySelector('.stack-strip[data-floor="12"] b')?.textContent,
      n5: !!document.querySelector('.stack-strip[data-floor="5"]'),
      n4: document.querySelector('.stack-strip[data-floor="4"]')?.textContent,
      faces: document.querySelectorAll('.stack-strip[data-floor="7"] .portrait').length,
      paused: !!window.__lobbyDebug && document.querySelector('#scene') && getComputedStyle(document.querySelector('#scene')).visibility })`);
    const o = JSON.parse(s);
    if (o.n7 !== 'Beta Bakes' || o.n12 !== 'New company moving in' || o.n5 || !/To let/.test(o.n4) || o.faces < 1) throw new Error(s);
    if (OUT) await p.shot(join(OUT, 'desktop-stack.jpg'));
  });
  await step('a strip opens its floor, and Back to building lands on the same spot', async () => {
    await p.ev('document.querySelector(".stack").scrollTop = 120');
    await sleep(100);
    await p.click('.stack-strip[data-floor="7"]');
    await p.until('document.body.dataset.page === "floor" && !!window.__office', 'floor 7');
    await lift(p);
    const back = await p.ev('document.querySelector(".floor-top .back span")?.textContent');
    if (back !== 'Back to building') throw new Error(`back says ${back}`);
    const tos = await p.ev('[...document.querySelectorAll(".scrub-btn .scrub-to")].map((e) => e.textContent).join(",")');
    if (tos !== '12,3') throw new Error(`lift shows ${tos}`);
  });
  await step('PageUp and PageDown ride to the next open floor, skipping hidden and empty ones', async () => {
    await key(p, 'PageDown');
    await p.until('window.__office?.state?.floor?.number === 3 && location.pathname.includes("/floor/")', 'down to 3');
    await lift(p);
    await key(p, 'PageUp');
    await p.until('window.__office?.state?.floor?.number === 7 && location.pathname.includes("/floor/")', 'up to 7');
    await lift(p);
    await p.click('.scrub-btn[data-scrub="down"]');
    await p.until('window.__office?.state?.floor?.number === 3 && location.pathname.includes("/floor/")', 'button down to 3');
    await lift(p);
    if (OUT) await p.shot(join(OUT, 'desktop-floor.jpg'));
  });
  await step('Back to building returns to the stack where it was', async () => {
    await p.click('.floor-top .back');
    await p.until('document.body.dataset.page === "lobby" && document.body.dataset.lobby === "building" && !document.querySelector(".stack").hidden', 'stack back');
    await sleep(200);
    const y = await p.ev('document.querySelector(".stack").scrollTop'), saved = Number(await p.ev('sessionStorage.getItem("office:stack-y")'));
    if (!saved || Math.abs(y - saved) > 4) throw new Error(`scrollTop ${y}, saved ${saved}`);
  });
  await step('Outside brings the 3D tower back, and the directory still works', async () => {
    await p.until('!document.querySelector("#fade.in")', 'doors open');
    await sleep(500);
    await p.click('.mode-btn[data-mode="outside"]');
    await p.until('document.body.dataset.lobby === "outside" && document.querySelector(".stack").hidden && document.querySelectorAll(".dir-row").length === 3', 'outside');
  });

  const m = await b.newPage({ mobile: true, width: 390, height: 844 });
  await step('a phone starts in the Building', async () => {
    await m.goto(`${base}/?q=low`);
    await m.until('document.body.dataset.page === "lobby" && document.body.dataset.lobby === "building" && document.querySelectorAll(".stack-strip").length > 10', 'phone stack');
    await sleep(400);
    if (OUT) await m.shot(join(OUT, 'phone-stack.jpg'));
  });
  await step('phone: tap a strip, then flick up a floor', async () => {
    await m.until('!document.querySelector(".boot-bar") || getComputedStyle(document.querySelector(".boot-bar").closest("div") || document.body).visibility === "hidden" || !document.querySelector(".boot-bar").offsetParent', 'curtain up', 8000).catch(() => {});
    await sleep(800);
    await m.click('.stack-strip[data-floor="7"]');
    await m.until('window.__office?.state?.floor?.number === 7 && location.pathname.includes("/floor/")', 'phone floor 7');
    await lift(m);
    await sleep(800);
    await m.drag(200, 560, 205, 330, true);
    await m.until('window.__office?.state?.floor?.number === 12 && location.pathname.includes("/floor/")', 'flick up to 12', 10000);
    await lift(m);
    if (OUT) await m.shot(join(OUT, 'phone-floor.jpg'));
  });
  void onFloor;
} finally {
  b.close(); await t.close?.();
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
