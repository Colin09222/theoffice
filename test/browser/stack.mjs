// The stack of dollhouse cutaways and the lift's one-click floors, in a real browser on a desktop and a phone.
// STACK_SHOTS=/some/dir keeps screenshots: the desktop and the phone mid-scroll, with people in their rooms.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const OUT = process.env.STACK_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };
const step = async (name, fn) => {
  try { const d = await fn(); if (/^SKIP/.test(d || '')) console.log(`SKIP ${name} (${d.slice(6)})`); else check(name, true, d || ''); } catch (e) { check(name, false, String(e.message).slice(0, 300)); }
};
const t = await boot({ mockDelayMs: 40, peopleTalk: false });
const base = `http://localhost:${t.port}/theoffice`;
await claim(t, 'Alpha Soup', { floor: 3 });
await claim(t, 'Beta Bakes', { floor: 7, body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
await claim(t, 'Hidden Co', { floor: 5 });
await claim(t, 'Gamma Gears', { floor: 12 });
await claim(t, 'Delta Dough', { floor: 9, body: { colors: { primary: '#6b3fa0', accent: '#f2b5d4' } } });
await claim(t, 'Echo Ink', { floor: 30 });
t.db.prepare('UPDATE floors SET hidden=1 WHERE number=5').run();
t.db.prepare("UPDATE floors SET name='' WHERE number=12").run();  // claimed, still in setup

// Life on floor 7: two at it, a meeting just called, and a line said out loud. The hidden floor gets the same, and must never show it.
const floorId = (n) => t.db.prepare('SELECT id FROM floors WHERE number=?').get(n).id;
const crew = (n) => t.db.prepare('SELECT id, name, role FROM agents WHERE floor_id=? ORDER BY id').all(floorId(n));
const seven = crew(7), hidden = crew(5);
t.db.prepare(`UPDATE agents SET state='thinking' WHERE id IN (${seven.slice(1, 3).map((a) => a.id).join(',')})`).run();
const say = (n, from, to, text) => t.app.engine.emit(floorId(n), 'talk', { from: from.id, to: to?.id ?? null, fromName: from.name, toName: to?.name || '', text, kind: 'ask' });
t.app.engine.emit(floorId(7), 'meeting', { manager: seven[0].id, staff: seven.slice(1, 3).map((a) => a.id) });
say(7, seven[1], seven[2], 'Can you check the bread prices on the menu page?');
say(5, hidden[1], hidden[2], 'Nobody should ever read this in the lobby');
// More said on floor 9 every few seconds, so a room on screen has something to say while it's watched.
const chatter = setInterval(() => { const c = crew(9); say(9, c[1], c[0], `Draft ${Math.floor(Math.random() * 90) + 10} of the dough guide is up`); }, 4000);

const b = await launch();
// A real key, the way a keyboard sends it: a non-text key needs its key code or Chrome drops it.
const key = async (p, k) => { const vk = { PageUp: 33, PageDown: 34 }[k]; await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
const lift = (p) => p.until('!!document.querySelector(".scrub-btn .scrub-to") && document.querySelectorAll(".scrub-btn:not(:disabled)").length > 0', 'lift loaded');
const top = (p) => p.ev('document.querySelector(".tower").scrollTop');
// Where someone in floor N's room is on screen, and the room's middle, once its people are in.
const personIn = (p, n) => p.until(`(() => { const ps = [...document.querySelectorAll('.dh-floor[data-floor="${n}"] .dh-person')].map((e) => e.firstChild.getBoundingClientRect()).filter((r) => r.width && r.top > 60 && r.bottom < innerHeight - 20);
  return ps.length ? JSON.stringify({ x: ps[0].left + ps[0].width / 2, y: ps[0].top + ps[0].height / 3 }) : null; })()`, `people on floor ${n}`, 12000).then(JSON.parse);
const errorsSoFar = (p) => p.errors.filter((e) => !/favicon/.test(e));
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await step('desktop lobby has the Building | Outside toggle, Outside first', async () => {
    await p.goto(`${base}/?q=low`);
    await p.until('document.body.dataset.page === "lobby" && !!document.querySelector(".lobby-mode")', 'lobby');
    const m = await p.ev('document.body.dataset.lobby'); if (m !== 'outside') throw new Error(`mode ${m}`);
  });
  await step('Building shows every floor as a cutaway, hidden ones left out', async () => {
    await p.click('.mode-btn[data-mode="building"]');
    await p.until('!document.querySelector(".tower-wrap").hidden && document.querySelectorAll(".dh-floor").length > 10', 'tower');
    const s = await p.ev(`JSON.stringify({
      n7: document.querySelector('.dh-floor[data-floor="7"] .dh-name b')?.textContent,
      s7: document.querySelector('.dh-floor[data-floor="7"] .dh-name small')?.textContent,
      n12: document.querySelector('.dh-floor[data-floor="12"] .dh-name b')?.textContent,
      n5: !!document.querySelector('.dh-floor[data-floor="5"]'),
      n4: document.querySelector('.dh-floor[data-floor="4"]')?.textContent,
      floors: document.querySelectorAll('.dh-floor').length,
      scene: getComputedStyle(document.querySelector('#scene')).visibility })`);
    const o = JSON.parse(s);
    if (o.n7 !== 'Beta Bakes' || !/Quiet right now|at work now/.test(o.s7) || o.n12 !== 'New company moving in' || o.n5 || !/To let/.test(o.n4) || o.floors !== 39 || o.scene !== 'hidden') throw new Error(s);
  });
  await step('rooms near the screen are built and their staff are in them; far ones are not built', async () => {
    // Every bubble that comes up from here on is noted, so one that came and went while something else was being checked still counts.
    await p.ev(`(() => { window.__said = []; new MutationObserver((ms) => { for (const m of ms) if (m.target.classList?.contains('up')) window.__said.push(m.target.closest('.dh-floor').dataset.floor + ':' + m.target.textContent); })
      .observe(document.querySelector('.tower'), { subtree: true, attributes: true, attributeFilter: ['class'] }); })()`);
    await p.ev('document.querySelector(".dh-floor[data-floor=\\"7\\"]").scrollIntoView({ block: "center" })');
    await p.until('document.querySelectorAll(\'.dh-floor[data-floor="7"] .dh-person\').length >= 4', 'staff on 7', 12000);
    const o = JSON.parse(await p.ev(`JSON.stringify({ rooms: document.querySelectorAll('.dh-room').length, floors: document.querySelectorAll('.dh-floor').length,
      far: !!document.querySelector('.dh-floor[data-floor="40"] .dh-room'), faces: document.querySelectorAll('.dh-floor[data-floor="7"] .dh-person .portrait svg').length,
      desks: document.querySelectorAll('.dh-floor[data-floor="7"] .dh-desk').length, table: !!document.querySelector('.dh-floor[data-floor="7"] .dh-table'),
      door: !!document.querySelector('.dh-floor[data-floor="7"] .dh-door'), plant: !!document.querySelector('.dh-floor[data-floor="7"] .dh-plant') })`));
    if (o.rooms >= o.floors || o.far || o.faces < 4 || o.desks < 2 || !o.table || !o.door || !o.plant) throw new Error(JSON.stringify(o));
    return `${o.rooms} of ${o.floors} rooms built`;
  });
  await step('a meeting fills the table, the busy ones type, and a line comes up as a bubble', async () => {
    await p.until(`!!document.querySelector('.dh-floor[data-floor="7"] .dh-board.on') && document.querySelectorAll('.dh-floor[data-floor="7"] .dh-person[data-at="seat"]').length >= 2
      && !!document.querySelector('.dh-floor[data-floor="7"] .dh-person[data-at="head"]')`, 'meeting round the table', 15000);
    const said = await p.until(`window.__said.filter((s) => s.startsWith('7:')).join('|')`, 'bubble on 7', 15000);
    if (!/bread prices/.test(said)) throw new Error(`said ${said}`);
    const up = await p.ev('document.querySelectorAll(".dh-say.up").length');
    if (up > 3) throw new Error(`${up} bubbles up at once`);
    const leak = await p.ev('document.body.textContent.includes("Nobody should ever read this")');
    if (leak) throw new Error('the hidden floor\'s line reached the lobby');
  });
  await step('hovering a person names them and their job', async () => {
    const at = await personIn(p, 7);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    const tipText = await p.until('!document.querySelector(".dh-tip").hidden && document.querySelector(".dh-tip").textContent', 'tip', 4000);
    const names = seven.map((a) => a.name);
    if (!names.some((nm) => tipText.startsWith(nm))) throw new Error(`tip says ${tipText}`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    return tipText;
  });
  await step('the wheel scrolls it, and a mouse drag slides it and keeps going when let go', async () => {
    await p.ev('document.querySelector(".tower").scrollTop = 600');
    await sleep(150);
    const box = JSON.parse(await p.ev('JSON.stringify(document.querySelector(".tower").getBoundingClientRect())'));
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const y0 = await top(p);
    for (let i = 0; i < 4; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 120 }); await sleep(40); }
    await sleep(400);
    const y1 = await top(p);
    if (y1 <= y0 + 100) throw new Error(`wheel moved ${y0} -> ${y1}`);
    // A quick drag upward: the building slides down the floors, and on after the button comes up.
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy + 150, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy + 150 - i * 30, button: 'left', buttons: 1 }); await sleep(12); }
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy - 90, button: 'left', clickCount: 1 });
    const y2 = await top(p);
    await sleep(500);
    const y3 = await top(p);
    if (y2 < y1 + 200 || y3 <= y2 + 20) throw new Error(`drag ${y1} -> ${y2}, coasted to ${y3}`);
    if (await p.ev('document.body.dataset.page') !== 'lobby') throw new Error('the drag went into a floor');
    return `wheel +${Math.round(y1 - y0)}, drag +${Math.round(y2 - y1)}, coast +${Math.round(y3 - y2)}`;
  });
  await step('desktop mid-scroll, people in their rooms', async () => {
    await p.ev('(() => { const t = document.querySelector(".tower"), f = document.querySelector(\'.dh-floor[data-floor="9"]\'); t.scrollTop = f.offsetTop - 120; })()');
    await personIn(p, 9);
    await sleep(2500);
    if (OUT) await p.shot(join(OUT, 'desktop.jpg'));
  });
  await step('a cutaway opens its floor, and Back to building lands on the same spot', async () => {
    await p.ev('(() => { const t = document.querySelector(".tower"), f = document.querySelector(\'.dh-floor[data-floor="7"]\'); t.scrollTop = f.offsetTop - 200; })()');
    await sleep(200);
    await p.click('.dh-floor[data-floor="7"]');
    await p.until('document.body.dataset.page === "floor" && !!window.__office', 'floor 7');
    await lift(p);
    const back = await p.ev('document.querySelector(".floor-top .back span")?.textContent');
    if (back !== 'Back to building') throw new Error(`back says ${back}`);
    const tos = await p.ev('[...document.querySelectorAll(".scrub-btn .scrub-to")].map((e) => e.textContent).join(",")');
    if (tos !== '9,3') throw new Error(`lift shows ${tos}`);
  });
  await step('PageUp and PageDown ride to the next open floor, skipping hidden and empty ones', async () => {
    await key(p, 'PageDown');
    await p.until('window.__office?.state?.floor?.number === 3 && location.pathname.includes("/floor/")', 'down to 3');
    await lift(p);
    await key(p, 'PageUp');
    await p.until('window.__office?.state?.floor?.number === 7 && location.pathname.includes("/floor/")', 'up to 7');
    await lift(p);
  });
  await step('Back to building returns to the tower where it was, rooms and all', async () => {
    await p.click('.floor-top .back');
    await p.until('document.body.dataset.page === "lobby" && document.body.dataset.lobby === "building" && !document.querySelector(".tower-wrap").hidden', 'tower back');
    await sleep(200);
    const y = await top(p), saved = Number(await p.ev('sessionStorage.getItem("office:stack-y")'));
    if (!saved || Math.abs(y - saved) > 4) throw new Error(`scrollTop ${y}, saved ${saved}`);
    await p.until('document.querySelectorAll(\'.dh-floor[data-floor="7"] .dh-person\').length >= 4', 'staff back on 7', 8000);
  });
  await step('Outside brings the 3D tower back, and the directory still works', async () => {
    await p.until('!document.querySelector("#fade.in")', 'doors open');
    await sleep(500);
    await p.click('.mode-btn[data-mode="outside"]');
    await p.until('document.body.dataset.lobby === "outside" && document.querySelector(".tower-wrap").hidden && document.querySelectorAll(".dir-row").length === 5', 'outside');
  });
  await step('a form\'s .stack column is not the tower', async () => {
    const pos = await p.ev('(() => { const d = document.createElement("div"); d.className = "stack"; document.body.append(d); const s = getComputedStyle(d).position; d.remove(); return s; })()');
    if (pos !== 'static') throw new Error(`a plain .stack is ${pos}`);
  });
  await step('no errors on the desktop', async () => { const e = errorsSoFar(p); if (e.length) throw new Error(e.slice(0, 3).join(' | ')); });

  await p.ev('localStorage.removeItem("office:lobby-mode")');  // one browser profile: the desktop's choice would carry over to the phone
  const m = await b.newPage({ mobile: true, width: 390, height: 844 });
  await step('a phone starts in the Building, with people in the rooms', async () => {
    await m.goto(`${base}/?q=low`);
    await m.until('document.body.dataset.page === "lobby" && document.body.dataset.lobby === "building" && document.querySelectorAll(".dh-floor").length > 10', 'phone tower');
    await m.until('!document.querySelector(".boot-bar") || getComputedStyle(document.querySelector(".boot-bar").closest("div") || document.body).visibility === "hidden" || !document.querySelector(".boot-bar").offsetParent', 'curtain up', 8000).catch(() => {});
    await personIn(m, 30);  // it opens on the top floor with anyone in it
  });
  await step('phone: a finger scrolls it, and the frames stay smooth on a slow phone', async () => {
    await m.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const y0 = await top(m);
    await m.ev(`(() => { window.__frames = []; let last = 0; const f = (t) => { if (last) window.__frames.push(t - last); last = t; if (window.__frames.length < 400) window.__fr = requestAnimationFrame(f); }; window.__fr = requestAnimationFrame(f); })()`);
    // A real gesture through the input pipeline: down the building and back up, with the fling at the end of each.
    await m.send('Input.synthesizeScrollGesture', { x: 195, y: 520, yDistance: -900, speed: 1600, gestureSourceType: 'touch' });
    const y1 = await top(m);
    await m.send('Input.synthesizeScrollGesture', { x: 195, y: 300, yDistance: 700, speed: 1600, gestureSourceType: 'touch' });
    await sleep(600);
    const frames = JSON.parse(await m.ev('(() => { cancelAnimationFrame(window.__fr); return JSON.stringify(window.__frames); })()'));
    await m.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    frames.sort((a, b2) => a - b2);
    const q = (f) => frames[Math.min(frames.length - 1, Math.floor(frames.length * f))];
    const med = q(0.5), p95 = q(0.95);
    if (y1 <= y0 + 300) throw new Error(`finger scroll ${y0} -> ${y1}`);
    if (frames.length < 60 || med > 20 || p95 > 50) throw new Error(`frames ${frames.length}, median ${med.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms`);
    return `4x slower CPU: ${frames.length} frames, median ${med.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms`;
  });
  await step('phone: touch and hold a person for their name and job, and it doesn\'t open the floor', async () => {
    await m.ev('(() => { const t = document.querySelector(".tower"), f = document.querySelector(\'.dh-floor[data-floor="7"]\'); t.scrollTop = f.offsetTop - 140; })()');
    const at = await personIn(m, 7);
    await m.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
    await sleep(700);
    const tipText = await m.until('!document.querySelector(".dh-tip").hidden && document.querySelector(".dh-tip").textContent', 'held tip', 3000);
    await m.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    if (await m.ev('document.body.dataset.page') !== 'lobby') throw new Error('the hold opened the floor');
    return tipText;
  });
  await step('phone mid-scroll, people in their rooms', async () => {
    await m.ev('(() => { const t = document.querySelector(".tower"), f = document.querySelector(\'.dh-floor[data-floor="9"]\'); t.scrollTop = f.offsetTop - 260; })()');
    await personIn(m, 9);
    await sleep(2500);
    if (OUT) await m.shot(join(OUT, 'phone.jpg'));
  });
  await step('phone: tap a cutaway, then flick up a floor', async () => {
    await sleep(800);
    await m.click('.dh-floor[data-floor="7"]');
    await m.until('window.__office?.state?.floor?.number === 7 && location.pathname.includes("/floor/")', 'phone floor 7');
    await lift(m);
    await sleep(800);
    // A flick has to be quick. Where the floor's 3D room renders in software (a headless machine with no GPU) each touch event can take
    // seconds to go through, so the gesture is timed in the page, and a run that couldn't make a flick says so instead of failing on it.
    await m.ev('(() => { window.__touch = {}; addEventListener("pointerdown", () => { window.__touch.down = performance.now(); }, { capture: true, once: true }); addEventListener("pointerup", () => { window.__touch.up = performance.now(); }, { capture: true, once: true }); })()');
    await m.drag(200, 560, 205, 330, true);
    const took = await m.until('window.__touch.up && Math.round(window.__touch.up - window.__touch.down)', 'the flick to land', 60000);
    if (took >= 700) return `SKIP: a flick took ${took}ms to reach the page here, too slow to count as one`;
    await m.until('window.__office?.state?.floor?.number === 9 && location.pathname.includes("/floor/")', `flick up to 9 (${took}ms)`, 10000);
    await lift(m);
  });
  await step('phone: Back to building finds its spot again', async () => {
    await m.click('.floor-top .back');
    await m.until('document.body.dataset.page === "lobby" && document.body.dataset.lobby === "building" && !document.querySelector(".tower-wrap").hidden', 'phone tower back');
    await sleep(300);
    const y = await top(m), saved = Number(await m.ev('sessionStorage.getItem("office:stack-y")'));
    if (!saved || Math.abs(y - saved) > 4) throw new Error(`scrollTop ${y}, saved ${saved}`);
  });
  await step('a hidden tab stops the polling and the rooms, and they pick up again when it comes back', async () => {
    await m.ev('(() => { const f = window.fetch; window.__asks = 0; window.fetch = (...a) => { if (String(a[0]).includes("/building/life")) window.__asks++; return f(...a); }; })()');
    await m.until('window.__asks > 0', 'asking what the floors are up to', 12000);
    await m.ev('Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange"))');
    const a = await m.ev('window.__asks');
    await sleep(11000);
    const b2 = await m.ev('window.__asks');
    await m.ev('delete document.hidden; document.dispatchEvent(new Event("visibilitychange"))');
    await m.until(`window.__asks > ${b2}`, 'asking again', 3000);
    if (b2 !== a) throw new Error(`asked ${b2 - a} times while hidden`);
  });
  await step('no errors on the phone', async () => { const e = errorsSoFar(m); if (e.length) throw new Error(e.slice(0, 3).join(' | ')); });
} finally {
  clearInterval(chatter);
  b.close(); await t.close?.();
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
