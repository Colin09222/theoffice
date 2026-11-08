// The lobby in a real browser on the machine's GPU: the tower from outside is the whole building view, ten floors in frame, To Let boards on the
// empty ones, and a floor a tap away. Going up and down is the lift's buttons and nothing else: nothing rides the building on scroll.
// A desktop and a phone profile with the CPU slowed four times. TOWER_SHOTS=/some/dir keeps screenshots; TOWER_ONLY=desktop|phone runs one profile.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const OUT = process.env.TOWER_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
const ONLY = process.env.TOWER_ONLY || '';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`.slice(0, 500)); if (!ok) failures++; };
const step = async (name, fn) => { try { const d = await fn(); check(name, true, d || ''); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };

// Ten floors as they will be live: two companies at the bottom, a code holding 3, a hidden test floor moved out above the building, the rest to let.
const t = await boot({ mockDelayMs: 300, peopleTalk: true, towerFloors: 10 });
const base = `http://localhost:${t.port}/theoffice`;
const pigeon = await claim(t, 'Pigeon Logistics', { floor: 1, body: { colors: { primary: '#3b3f46', accent: '#37b679' } } });
const candles = await claim(t, 'Mildly Haunted Candles', { floor: 2, body: { colors: { primary: '#6a4c93', accent: '#f4c95d' } } });
const hive = await claim(t, 'Neon Hive', { floor: 6 });
t.db.prepare('UPDATE floors SET hidden=1, number=105 WHERE slug=?').run(hive.slug);
t.code(3);  // holds floor 3, as LabStackr's does
const SIDE = ['Math.sin(L.theta)', 'Math.cos(L.theta)'];
const frameInfo = (p) => p.ev(`(() => { const L = window.__lobbyDebug, c = L.camera, V = c.position.constructor;
  const at = (y) => new V(0, y, 0).project(c); const top = at(L.tower.height), ground = at(0);
  return { top: Math.round((1 - top.y) / 2 * innerHeight), ground: Math.round((1 - ground.y) / 2 * innerHeight), x: Math.round((top.x + 1) / 2 * innerWidth), h: innerHeight, w: innerWidth, dist: L.dist, camY: c.position.y, pill: document.querySelector('.open-pill')?.getBoundingClientRect().top ?? 0 }; })()`);
const floorPoint = (p, n) => p.ev(`(() => { const L = window.__lobbyDebug, c = L.camera, V = c.position.constructor; const r = 4.3 + 0.1, y = 3.6 + (${n} - 0.5) * 1;
  const v = new V(${SIDE[0]} * r, y, ${SIDE[1]} * r).project(c); return [Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)]; })()`);
const tap = async (p, x, y, touch) => {
  if (touch) { await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(50); await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); return; }
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(40);
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(40);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const wheel = async (p, x, y, dy, n = 6) => { for (let i = 0; i < n; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy }); await sleep(50); } };
const openLobby = async (p) => { await p.goto(`${base}/`); await p.until('document.body.dataset.page === "lobby" && window.__stage.view === window.__lobbyDebug && !document.querySelector("#boot")', 'lobby', 40000); await sleep(1200); };
const stillTouching = 'window.__lobbyDebug.lastTouch = performance.now()';  // hold the slow turn while a point is taken and tapped

async function profile(kind) {
  const phone = kind === 'phone';
  const b = await launch({ noAngle: true });
  const p = await b.newPage(phone ? { mobile: true, width: 390, height: 844 } : { width: 1440, height: 900 });
  if (phone) await p.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await step(`${kind}: the lobby opens on the Outside tower, with no Building switch anywhere`, async () => {
    await openLobby(p);
    const s = await p.ev('({ mode: document.body.dataset.lobby, ok: !!window.__stage.ok, sw: !!document.querySelector(".lobby-mode, .mode-btn"), stack: !!document.querySelector("section.stack"), tower: typeof window.__tower, count: window.__lobbyDebug.floorCount })');
    if (s.mode !== 'outside' || s.sw || s.stack || s.tower !== 'undefined' || s.count !== 10) throw new Error(JSON.stringify(s));
    return `${s.count} floors, no switch`;
  });
  await step(`${kind}: the whole tower is in frame, ground to mast, and stands clear of the panels`, async () => {
    await p.ev(stillTouching); await sleep(600);
    const f = await frameInfo(p);
    if (f.top < 0.02 * f.h) throw new Error(`mast is off the top: ${JSON.stringify(f)}`);
    if (f.ground > (phone ? f.pill : 0.98 * f.h)) throw new Error(`ground is off the bottom or under the pill: ${JSON.stringify(f)}`);
    const fill = (f.ground - f.top) / f.h;
    if (fill < (phone ? 0.42 : 0.5) || fill > 0.92) throw new Error(`the tower fills ${fill.toFixed(2)} of the screen: ${JSON.stringify(f)}`);
    if (!phone && (f.x < 0.3 * f.w || f.x > 0.65 * f.w)) throw new Error(`tower is off to one side: ${JSON.stringify(f)}`);
    if (OUT) await p.shot(join(OUT, `${kind}-outside.jpg`));
    return `tower ${f.top} to ${f.ground} of ${f.h}, fills ${(fill * 100).toFixed(0)}%, x ${f.x}`;
  });
  await step(`${kind}: scrolling doesn't ride the building`, async () => {
    const a = await frameInfo(p);
    if (phone) { await p.drag(195, 520, 200, 300, true); await sleep(900); } else { await wheel(p, 640, 760, -240); await wheel(p, 640, 760, 240); await sleep(900); }
    const c = await frameInfo(p);
    if (Math.abs(c.camY - a.camY) > 0.05) throw new Error(`the camera moved from ${a.camY} to ${c.camY}`);
    return `camera height held at ${a.camY.toFixed(1)}`;
  });
  await step(`${kind}: dragging turns the tower`, async () => {
    const th0 = await p.ev('window.__lobbyDebug.targetTheta');
    if (phone) await p.drag(100, 420, 300, 440, true); else await p.drag(560, 700, 760, 705, false);
    await sleep(500);
    const th1 = await p.ev('window.__lobbyDebug.targetTheta');
    if (Math.abs(th1 - th0) < 0.1) throw new Error(`no turn: ${th0} to ${th1}`);
    return `turned by ${Math.abs(th1 - th0).toFixed(2)} rad`;
  });
  await step(`${kind}: the empty floors show To Let, floor 3 (held) doesn't, and the counts are right`, async () => {
    const s = await p.ev(`(() => {
      const btn = (n) => document.querySelector('.lift-btn[data-lift="' + n + '"]');
      return { boards: window.__lobbyDebug.tower.boards.count, lifts: document.querySelectorAll('.lift-btn').length, lit: document.querySelectorAll('.lift-btn.lit').length,
        three: { label: btn(3).getAttribute('aria-label'), disabled: btn(3).disabled }, seven: btn(7).getAttribute('aria-label'), heading: document.querySelector('.lift-wrap h3 small')?.textContent, pill: document.querySelector('.open-pill .pill-status')?.textContent }; })()`);
    if (s.boards !== 7 * 4) throw new Error(`boards: ${JSON.stringify(s)}`);
    if (s.lifts !== 10 || s.lit !== 2) throw new Error(`lift buttons: ${JSON.stringify(s)}`);
    if (s.three.label !== 'Floor 3, reserved' || !s.three.disabled) throw new Error(`floor 3: ${JSON.stringify(s)}`);
    if (s.seven !== 'Floor 7, to let') throw new Error(`floor 7: ${JSON.stringify(s)}`);
    if (s.heading !== '7 floors to let') throw new Error(`heading: ${s.heading}`);
    if (!/Floor 4/.test(s.pill)) throw new Error(`pill: ${s.pill}`);
    return `${s.boards / 4} floors with boards, 2 lit, floor 3 reserved`;
  });
  await step(`${kind}: tapping a To Let floor on the tower opens the Open an office flow`, async () => {
    await p.ev(stillTouching); await sleep(1200);
    const [x, y] = await floorPoint(p, 8);
    await p.ev(stillTouching);
    await tap(p, x, y, phone);
    await p.until('document.querySelector(".code-input") !== null', 'code dialog', 6000);
    return `opened from (${x}, ${y})`;
  });
  await openLobby(p);
  await step(`${kind}: tapping a lit floor arrives on its floor page, quickly`, async () => {
    await p.ev(stillTouching); await sleep(1200);
    const [x, y] = await floorPoint(p, 2);
    await p.ev(`${stillTouching}; window.__picked = performance.now(); window.__left = 0; (function w() { if (document.body.dataset.page === 'floor') window.__left = performance.now(); else requestAnimationFrame(w); })()`);
    await tap(p, x, y, phone);
    await p.until('window.__office?.state?.floor?.number === 2 && document.body.dataset.page === "floor"', 'floor 2', 20000);
    const ms = Math.round(await p.ev('window.__left - window.__picked'));
    await p.until('!document.querySelector("#fade.in")', 'doors open', 8000);
    if (ms > (phone ? 3500 : 1800)) throw new Error(`took ${ms} ms`);
    if (await p.ev('!!window.__office.view.host')) throw new Error('a stale tower view');
    return `${ms} ms from the tap`;
  });
  await step(`${kind}: the lift's buttons go up and down and skip what they should`, async () => {
    await p.until('document.querySelector(".scrub-btn[data-scrub=down]") && !document.querySelector(".scrub-btn[data-scrub=down]").disabled', 'lift loaded', 15000);
    // Going down from 2 gets 1, nothing more; going up from 2 there's no floor to go to: 3 is held, 4 to 10 are to let, 105 is hidden.
    const up = await p.ev('(() => { const b = document.querySelector(".scrub-btn[data-scrub=up]"); return { disabled: b.disabled, title: b.title }; })()');
    if (!up.disabled) throw new Error(`up should be off on 2: ${JSON.stringify(up)}`);
    await p.click('.scrub-btn[data-scrub=down]');
    await p.until('window.__office?.state?.floor?.number === 1 && !document.querySelector("#fade.in")', 'down to 1', 15000);
    await p.until('document.querySelector(".scrub-btn[data-scrub=up]") && !document.querySelector(".scrub-btn[data-scrub=up]").disabled', 'lift loaded', 15000);
    if (!(await p.ev('document.querySelector(".scrub-btn[data-scrub=down]").disabled'))) throw new Error('down should be off on 1');
    await p.click('.scrub-btn[data-scrub=up]');
    await p.until('window.__office?.state?.floor?.number === 2', 'up to 2', 15000);
    return 'down to 1, up to 2, nothing above';
  });
  if (!phone) await step(`${kind}: PageUp and PageDown take the lift`, async () => {
    await p.until('document.querySelector(".scrub-btn[data-scrub=down]") && !document.querySelector(".scrub-btn[data-scrub=down]").disabled', 'lift loaded', 15000);
    const key = async (k, code) => { await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }); };
    await sleep(600);
    await key('PageDown', 34);
    await p.until('window.__office?.state?.floor?.number === 1', 'PageDown', 15000);
    await p.until('document.querySelector(".scrub-btn[data-scrub=up]") && !document.querySelector(".scrub-btn[data-scrub=up]").disabled', 'lift loaded', 15000);
    await sleep(400);
    await key('PageUp', 33);
    await p.until('window.__office?.state?.floor?.number === 2', 'PageUp', 15000);
  });
  await step(`${kind}: scrolling on a floor doesn't change floor`, async () => {
    await p.until('window.__office?.state?.floor?.number === 2 && !document.querySelector("#fade.in")', 'on 2', 15000);
    await sleep(1200);
    if (phone) { await p.drag(195, 560, 200, 320, true); await sleep(1600); await p.drag(195, 320, 200, 560, true); await sleep(1600); }
    else { await wheel(p, 640, 450, 240, 8); await sleep(800); await wheel(p, 640, 450, -240, 8); await sleep(1200); }
    const n = await p.ev('window.__office?.state?.floor?.number');
    if (n !== 2) throw new Error(`ended up on ${n}`);
    return phone ? 'a flick over the room stayed on 2' : 'the wheel only zooms the room';
  });
  await step(`${kind}: Back to building returns to the lobby, ten floors, with no leftovers from the old view`, async () => {
    const label = await p.ev('document.querySelector(".floor-top .back").getAttribute("aria-label")');
    if (label !== 'Back to building') throw new Error(`back says ${label}`);
    await p.click('.floor-top .back');
    await p.until('document.body.dataset.page === "lobby" && window.__stage.view === window.__lobbyDebug', 'lobby', 20000);
    await sleep(800);
    const s = await p.ev('({ fading: document.querySelector("#fade").classList.contains("in"), tower: typeof window.__tower, lifts: document.querySelectorAll(".lift-btn").length, flying: document.body.classList.contains("flying") })');
    if (s.fading || s.tower !== 'undefined' || s.lifts !== 10 || s.flying) throw new Error(JSON.stringify(s));
    return 'the Outside tower again';
  });
  await step(`${kind}: a hidden test floor's own link still works, up above the building, and goes down the lift to the real floors`, async () => {
    await p.goto(`${base}/floor/${hive.slug}`);
    await p.until('window.__office?.state?.floor?.number === 105 && !document.querySelector("#fade.in")', 'floor 105', 30000);
    await p.until('document.querySelector(".scrub-btn[data-scrub=down]") && !document.querySelector(".scrub-btn[data-scrub=down]").disabled', 'lift loaded', 15000);
    const up = await p.ev('document.querySelector(".scrub-btn[data-scrub=up]").disabled');
    if (!up) throw new Error('nothing is above the hidden floor');
    await p.click('.scrub-btn[data-scrub=down]');
    await p.until('window.__office?.state?.floor?.number === 2 && document.querySelector(".floor-num")?.textContent === "Floor 2"', 'down to the top real floor', 15000);
    if (OUT) await p.shot(join(OUT, `${kind}-floor.jpg`));
    return 'its page loaded on 105, the lift goes down to 2';
  });
  await step(`${kind}: no console errors`, async () => {
    const errs = p.errors.filter((e) => !/favicon|ERR_ABORTED|net::ERR/.test(e) && !/Evaluating a string as JavaScript violates/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 4).join(' | ').slice(0, 300));
  });
  p.close();
  b.close();
}

try {
  if (ONLY !== 'phone') await profile('desktop');
  if (ONLY !== 'desktop') await profile('phone');
} finally {
  await t.close?.();
}
void pigeon; void candles;
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
