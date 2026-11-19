// The building with no WebGL, and the lift's one-click floors, in a real browser on a desktop and a phone. This was the strip stack, the 3D
// tower's stand-in; since the redesign (docs/redesign, jobs 14 and 16) the home page's floor list does that work for everyone, and a phone's
// floor opens without its room. Same paths: every open floor listed (hidden ones left out), one tap in, the lift skipping hidden and empty
// floors, Back to building, and a flick over a phone's room never changing floor. STACK_SHOTS=/some/dir keeps screenshots.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const OUT = process.env.STACK_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, String(e.message).slice(0, 240)); } };
const t = await boot({ onboarding: false, mockDelayMs: 40, peopleTalk: false });
const base = `http://localhost:${t.port}/theoffice`;
await claim(t, 'Alpha Soup', { floor: 3 });
await claim(t, 'Beta Bakes', { floor: 7, body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
await claim(t, 'Hidden Co', { floor: 5 });
await claim(t, 'Gamma Gears', { floor: 12 });
t.db.prepare('UPDATE floors SET hidden=1 WHERE number=5').run();
t.db.prepare("UPDATE floors SET name='' WHERE number=12").run();  // claimed, still in setup

const b = await launch({ args: ['--disable-webgl', '--disable-3d-apis'] });  // no WebGL: the strips are what the Building falls back to
// A real key, the way a keyboard sends it: a non-text key needs its key code or Chrome drops it.
const key = async (p, k) => { const vk = { PageUp: 33, PageDown: 34 }[k]; await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
const floorNow = (p) => p.ev('location.pathname.split("/").pop()');
const onFloor = (p, slug) => p.until(`document.body.dataset.page === "floor" && location.pathname.endsWith("/${slug}") && !document.querySelector('.scrub-btn[data-scrub="up"]').title.startsWith('')===false`, `floor ${slug}`);
const lift = (p) => p.until('!!document.querySelector(".scrub-btn .scrub-to") && document.querySelectorAll(".scrub-btn:not(:disabled)").length > 0', 'lift loaded');
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await step('desktop home with no WebGL: the floor list, no tower frame, no switch', async () => {
    await p.goto(`${base}/?q=low`);
    await p.until('document.body.dataset.page === "lobby" && document.querySelectorAll(".home-dir .dir-row").length > 0 && !document.querySelector(".lobby-mode, .mode-btn")', 'home');
    await p.until('document.querySelector(".home-tower")?.hidden === true', 'the tower frame gone', 15000);
    if (await p.ev('!!window.__stage && window.__stage.ok')) throw new Error('a 3D stage with no WebGL');
  });
  await step('the floor list shows every open floor, hidden ones left out, one still setting up as moving in', async () => {
    const o = await p.ev(`({ rows: [...document.querySelectorAll('.home-dir .dir-row')].map((r) => [r.dataset.floor, r.querySelector('b').textContent]), lift: [...document.querySelectorAll('.home-dir .lift-btn:not(.lift-b)')].map((b) => b.dataset.lift), toLet: document.querySelector('.to-let').textContent })`);
    const rows = Object.fromEntries(o.rows);
    if (rows['7'] !== 'Beta Bakes' || rows['3'] !== 'Alpha Soup' || rows['12'] !== 'Moving in' || rows['5']) throw new Error(JSON.stringify(o));
    if (o.lift.sort().join() !== '12,3,7') throw new Error(`lift ${o.lift}`);
    if (!/floors to let$/.test(o.toLet)) throw new Error(o.toLet);
    if (OUT) await p.shot(join(OUT, 'desktop-stack.jpg'));
  });
  await step('a floor row opens its floor, and its lift shows the next open floors', async () => {
    await p.click('.home-dir .dir-row[data-floor="7"]');
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
  await step('Back to building returns to the home page, its floor list and lift intact', async () => {
    await p.click('.floor-top .back');
    await p.until('document.body.dataset.page === "lobby" && document.querySelectorAll(".home-dir .dir-row").length === 3', 'home again');
    await p.until('!document.querySelector("#fade.in")', 'doors open');
    if ((await p.ev('document.querySelectorAll(".home-dir .lift-btn:not(.lift-b)").length')) !== 3) throw new Error('lift');
  });

  const m = await b.newPage({ mobile: true, width: 390, height: 844 });
  await step('a phone starts on the home page with its floor list', async () => {
    await m.goto(`${base}/?q=low`);
    await m.until('document.body.dataset.page === "lobby" && document.querySelectorAll(".home-dir .dir-row").length === 3', 'phone home');
    await sleep(400);
    if (OUT) await m.shot(join(OUT, 'phone-stack.jpg'));
  });
  await step('phone: tap a floor and it opens without its room; Watch the room brings the room and its lift', async () => {
    await m.until('!document.querySelector("#boot")', 'curtain', 8000).catch(() => {});
    await sleep(800);
    await m.click('.home-dir .dir-row[data-floor="7"]');
    await m.until('document.body.dataset.page === "floor-lite" && location.pathname.includes("/floor/")', 'phone floor 7, no room');
    await m.room();
    await m.until('window.__office?.state?.floor?.number === 7', 'the room of floor 7');
    await lift(m);
  });
  // A flick over the room moves the room, never the floor: the lift's buttons do that. Tried where the floor page has its 3D room.
  const b3 = await launch();
  try {
    const m3 = await b3.newPage({ mobile: true, width: 390, height: 844 });
    await step('phone with WebGL: a flick does not change floor', async () => {
      await m3.goto(`${base}/floor/${t.db.prepare('SELECT slug FROM floors WHERE number=7').get().slug}?q=low`);
      await m3.room();  // a phone opens the floor without its room until Watch the room (docs/redesign, job 16)
      await m3.until('window.__office?.state?.floor?.number === 7', 'floor 7');
      await lift(m3);
      await m3.until('!document.querySelector("#fade.in")', 'doors open');
      await sleep(800);
      await m3.drag(200, 560, 205, 330, true);
      await sleep(1500);
      if (await m3.ev('window.__office?.state?.floor?.number') !== 7) throw new Error('the flick changed floor');
      await lift(m3);
      if (OUT) await m3.shot(join(OUT, 'phone-floor.jpg'));
    });
  } finally { b3.close(); }
  void onFloor;
} finally {
  b.close(); await t.close?.();
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
