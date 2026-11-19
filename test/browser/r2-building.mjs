// Round 2, lane B (docs/redesign/ROUND2.md): the building and home in a real browser, mock mode. One check per job, added as the jobs land.
// npm run e2e:r2-building
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';
import { seedShowcase } from './redesign-seed.mjs';

const t = await boot({ towerFloors: 30 });
const base = `http://localhost:${t.port}/theoffice`;
const boss = await claim(t, 'Tiny Arcade Works', { floor: 5 });
const lab = await claim(t, 'LabStackr', { floor: 3 });
const seeded = await seedShowcase(t, boss, { others: [lab.slug] });
const hiddenLab = await claim(t, 'Hidden Lab', { floor: 9 });
t.db.prepare('UPDATE floors SET hidden=1 WHERE slug=?').run(hiddenLab.slug);
// Two more real screenshots of Loopling, so its hero card has three to fade between (r2-j33).
const shot = t.db.prepare("SELECT image FROM launch_shots WHERE project='loopling' AND image IS NOT NULL").get()?.image;
if (shot) {
  const card = Number(t.db.prepare("INSERT INTO job_cards (floor_id,key,project,title,created_at,updated_at) VALUES (?,'r2','loopling','Loopling',1,1)").run(seeded.floorId).lastInsertRowid);
  for (const s of ['a', 'b']) t.db.prepare('INSERT INTO job_shots (floor_id,card_id,step,project,image,bytes,created_at,taken_at) VALUES (?,?,?,?,?,?,?,?)').run(seeded.floorId, card, s, 'loopling', shot, shot.length, Date.now(), Date.now());
}
const b = await launch({});
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
/** A New York wall-clock time in November 2026 (EST), as the page's clock. */
const nyAt = (hh, mm) => Date.UTC(2026, 10, 19, hh + 5, mm);
async function page(opts, { clock = null } = {}) {
  const p = await b.newPage(opts);
  if (clock) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__officeNow = () => ${clock} + (performance.now() | 0);` });
  await p.goto(`${base}/`);
  await p.until('document.body.dataset.page === "lobby" && !document.querySelector("#boot")', 'home', 60000);
  return p;
}

try {
  // ---- desktop, 23:30 in New York ----
  let p = await page({ width: 1440, height: 900 }, { clock: nyAt(23, 30) });
  // r2-j34: a first-time visitor hears nothing: the sound button starts off.
  check(await p.ev('document.querySelector("[data-mute]").getAttribute("aria-pressed") === "true"'), 'r2-j34: sound starts off for a first-time visitor');
  // r2-j33: Loopling's hero card has 3 real screenshots and fades to the next within about 4 s.
  const frames = await p.until('document.querySelector(".lcard-hero[data-project=loopling]")?.dataset.frames || null', 'hero frames', 20000).catch(() => null);
  check(frames === '3', `r2-j33: the Loopling hero card has 3 screenshots to fade between (${frames})`);
  await sleep(4900);
  check(await p.ev('getComputedStyle(document.querySelector(".lcard-hero[data-project=loopling] .lcard-fade")).opacity === "1"'), 'r2-j33: after 4 s the next screenshot has faded in');
  // r2-j35: at 23:30 New York every room light is off and the crown sign is lit.
  await p.until('!!document.querySelector(".home-tower.ready") && !!window.__lobbyDebug?.lightState', 'the tower', 90000);
  const light = await p.ev('window.__lobbyDebug.lightState');
  check(light.lightsOn === false && light.crownLit === true && light.phase === 'night', `r2-j35: 23:30 New York: room lights off, crown sign lit, night (${JSON.stringify(light)})`);
  check(!p.errors.length, `desktop: no console errors ${p.errors.slice(0, 2).join(' | ')}`);
  p.close();
  // ---- desktop, noon ----
  // r2-j36: a test job started on a hidden floor brightens that floor's windows within 10 s.
  p = await page({ width: 1440, height: 900 }, { clock: nyAt(12, 0) });
  await p.until('!!window.__lobbyDebug?.liveState', 'the live tower', 90000);
  const hid = t.db.prepare('SELECT id, number FROM floors WHERE slug=?').get(hiddenLab.slug);
  check(await p.ev(`window.__lobbyDebug.tower.state[${(hid.number - 1) * 3 + 1}] === 0`), 'r2-j36: the hidden floor is dark before its job');
  const started = Date.now();
  t.db.prepare("INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,'A test job','doing',?,?)").run(hid.id, started, started);
  const lit = await p.until(`(() => { const s = window.__lobbyDebug.tower.state; return s[${(hid.number - 1) * 3}] === 1 && s[${(hid.number - 1) * 3 + 1}] >= 1; })()`, 'the hidden floor to light', 10000).then(() => Date.now() - started).catch(() => null);
  check(lit !== null && lit <= 10000, `r2-j36: a job on a hidden floor brightens its windows within 10 s (${lit} ms)`);
  t.db.prepare("UPDATE tasks SET status='done' WHERE floor_id=?").run(hid.id);
  p.close();
  // r2-j37: on a tier above low the crown billboard shows the 3 hero pictures and moves to the next every 6 s.
  p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(`${base}/?q=mid`);
  await p.until('!!window.__lobbyDebug?.boardOn', 'the billboard', 90000).catch(() => null);
  const board = await p.ev('(() => { const v = window.__lobbyDebug; return v?.board ? { n: v.board.count, w: v.board.canvas.width, h: v.board.canvas.height, on: v.boardOn } : null; })()');
  check(board?.on && board.n === 3 && board.w === 512 && board.h === 320, `r2-j37: the crown billboard has the 3 hero pictures at 512 x 320 (${JSON.stringify(board)})`);
  // Sampled inside the page every 100 ms (a busy machine drawing with software WebGL can be late by up to a second), so a slow line to the browser can't blur the timing: when does the picture change, and how far apart?
  const changes = await p.ev(`new Promise((r) => { const v = window.__lobbyDebug, out = []; let last = v.board.frame(performance.now()).index; const t0 = performance.now();
    const iv = setInterval(() => { const i = v.board.frame(performance.now()).index; if (i !== last) { out.push({ i, at: Math.round(performance.now() - t0) }); last = i; } if (performance.now() - t0 > 13000) { clearInterval(iv); r(out); } }, 100); })`);
  const gaps = changes.slice(1).map((c, k) => c.at - changes[k].at);
  check(changes.length >= 2 && gaps.every((g) => Math.abs(g - 6000) < 1200) && changes.every((c, k) => k === 0 || c.i === (changes[k - 1].i + 1) % 3), `r2-j37: it moves to the next picture every 6 s (${JSON.stringify(changes)})`);
  p.close();
  p = await page({ width: 1440, height: 900 }, { clock: nyAt(12, 0) });
  await p.until('!!window.__lobbyDebug?.lightState', 'the tower', 90000);
  const noon = await p.ev('window.__lobbyDebug.lightState');
  check(noon.lightsOn === true && noon.phase === 'day', `r2-j35: noon New York: lights on, day (${noon.phase})`);
  p.close();
  // ---- phone ----
  p = await page({ phone: { width: 390, height: 844 } });
  const pulse = await p.until('(() => { const b = document.querySelector(".dir-row .badge[data-state=working]"); return b ? getComputedStyle(b, "::before").animationName : null; })()', 'a Working badge', 20000).catch(() => null);
  check(pulse === 'r2-pulse', `r2-j33: on a phone a Working floor's badge pulses (${pulse})`);
  p.close();
  // r2-j43: with sound on, a launch rings one bell, and no two event sounds play within 2 s.
  p = await b.newPage({ width: 1440, height: 900 });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('office.muted', '0'); } catch {}" });
  await p.goto(`${base}/`);
  await p.until('document.body.dataset.page === "lobby" && !document.querySelector("#boot")', 'home', 60000);
  await p.click('.home-brand');  // the first touch lets the page make sound at all
  await p.until('!!window.__officeSound', 'sound', 10000);
  await sleep(6000);  // the live tower's first reading: what is launched already rings nothing
  const before = await p.ev('window.__officeSound.log.length');
  const at = Date.now();
  t.db.prepare("UPDATE projects SET published_at=? WHERE slug='loopling'").run(at);
  await p.until('window.__officeSound.log.some((s) => s.kind === "launch")', 'the bell', 12000).catch(() => null);
  await sleep(6000);  // another reading or so: still one bell
  const log = await p.ev('window.__officeSound.log');
  check(log.slice(before).filter((s) => s.kind === 'launch').length === 1, `r2-j43: a launch rings one bell (${JSON.stringify(log)})`);
  const twice = await p.ev('(() => { const n = performance.now() + 10000; return [window.__officeSound.eventSound("stamp", n), window.__officeSound.eventSound("paper", n + 1500), window.__officeSound.eventSound("paper", n + 2000)]; })()');
  check(JSON.stringify(twice) === '[true,false,true]', `r2-j43: no two event sounds within 2 s (${JSON.stringify(twice)})`);
  p.close();
  // r2-j50: the basement shows at the foot of the tower panel and at B on the lift, with the robot at its desk.
  p = await page({ width: 1440, height: 900 }, { clock: nyAt(12, 0) });
  await p.until('!!document.querySelector(".home-tower .mailroom-strip") && !!document.querySelector(".lift-btn.lift-b")', 'the basement on the home page', 20000).catch(() => null);
  check(await p.ev('!!document.querySelector(".home-tower .tower-foot .mailroom-strip") && document.querySelector(".lift-btn.lift-b")?.textContent === "B"'), 'r2-j50: the basement at the foot of the tower panel, and B on the lift');
  await p.click('.lift-btn.lift-b');
  await p.until('document.body.dataset.page === "mailroom" && window.__mailroomDebug?.holeCount !== undefined', 'the mailroom', 30000).catch(() => null);
  const room = await p.ev('(() => { const v = window.__mailroomDebug; if (!v) return null; return { atDesk: v.robot.group.position.distanceTo(v.deskSpot) < 1e-6, tris: v.robot.triangles, plate: v.robot.plate.userData.text, holes: v.holeCount }; })()');
  check(room?.atDesk && room.tris < 1500 && room.plate === 'buddehbot' && room.holes >= 2, `r2-j50: B opens the mailroom with buddehbot at its desk (${JSON.stringify(room)})`);
  await sleep(1500);
  await p.shot?.('/tmp/claude-0/-home-user-theoffice/ba670692-e452-55d2-8e03-8f74c9fdfb92/scratchpad/mailroom-desktop.jpg');
  check(!p.errors.length, `r2-j50: no console errors in the mailroom ${p.errors.slice(0, 2).join(' | ')}`);
  p.close();
  p = await page({ phone: { width: 390, height: 844 } });
  await p.click('.lift-btn.lift-b');
  await p.until('document.body.dataset.page === "mailroom" && !!document.querySelector(".dom-room .robot-svg")', 'the plain mailroom', 20000).catch(() => null);
  check(await p.ev('!!document.querySelector(".dom-room .robot-svg") && !window.__mailroomDebug && !performance.getEntriesByType("resource").some((e) => ["three.module", "mailroom-scene", "/js/stage.js"].some((k) => e.name.includes(k)))'),'r2-j50: on a phone, the plain mailroom with the robot and no 3D code');
  await p.shot?.('/tmp/claude-0/-home-user-theoffice/ba670692-e452-55d2-8e03-8f74c9fdfb92/scratchpad/mailroom-phone.jpg');
  p.close();
  // r2-j51: a test purchase request: a folder in a bean's hand within 10 s on the floor, and in the mailroom it comes down the tube and the tray rises by one.
  const bossFloor = t.db.prepare('SELECT * FROM floors WHERE slug=?').get(boss.slug);
  p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(`${base}/floor/${boss.slug}`);
  await p.until('!!window.__office?.view?.mailFolders', 'the floor room and its tube point', 90000).catch(() => null);
  await sleep(5500);  // its first reading: what is already there plays nothing
  const buyAt = Date.now();
  const buy = Number(t.db.prepare("INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'Test item',5,'test','',?)").run(bossFloor.id, buyAt).lastInsertRowid);
  await p.until(`window.__office.view.mailFolders.played.some((e) => e.number === ${buy})`, 'a bean to carry the folder', 40000).catch(() => null);
  // Timed on the page's own clock. Where software WebGL makes one frame of the room take a second or more, the page's own timers stall with it,
  // and the 10 s can't be measured here: that is said, not passed (test/r2-folders.test.js proves it on a fake clock).
  // How late a 50 ms timer comes back, worst of five: the page's own stall.
  const lag = await p.ev('(async () => { let worst = 0; for (let i = 0; i < 5; i++) { const t0 = performance.now(); await new Promise((r) => setTimeout(r, 50)); worst = Math.max(worst, performance.now() - t0 - 50); } return Math.round(worst); })()');
  const carry = { at: await p.ev(`window.__office.view.mailFolders.played.find((e) => e.number === ${buy})?.at || null`), frameMs: lag };
  const carried = carry.at ? carry.at - buyAt : null;
  if (carried !== null && carried > 10000 && carry.frameMs >= 1000) console.log(`skip r2-j51: the folder reached a bean's hand after ${carried} ms, but this page's timers run ${carry.frameMs} ms late (software WebGL drawing the room), so 10 s can't be measured here`);
  else check(carried !== null && carried <= 10000, `r2-j51: a purchase request puts a folder in a bean's hand within 10 s (${carried} ms)`);
  p.close();
  p = await page({ width: 1440, height: 900 }, { clock: nyAt(12, 0) });
  await p.ev('window.officeGo("/mailroom")');
  await p.until('window.__mailroomDebug?.trayCount !== undefined', 'the mailroom', 30000);
  const trayBefore = await p.ev('window.__mailroomDebug.trayCount');
  const buy2 = Number(t.db.prepare("INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'Second',5,'test','',?)").run(bossFloor.id, Date.now()).lastInsertRowid);
  await p.until(`window.__mailroomDebug.player.played.some((e) => e.event === 'arrive' && e.number === ${buy2})`, 'the folder down the tube', 12000).catch(() => null);
  const after = await p.ev(`({ tray: window.__mailroomDebug.trayCount, played: window.__mailroomDebug.player.played.filter((e) => e.number === ${buy2}).map((e) => e.event), refused: window.__mailroomDebug.player.refused })`);
  check(after.tray === trayBefore + 1 && after.played.includes('arrive') && after.refused === 0, `r2-j51: in the mailroom the folder comes down the tube and the tray rises by one (${trayBefore} -> ${JSON.stringify(after)})`);
  p.close();
  // r2-j38: a fresh browser (a first-time visitor): the fly-in plays once on the desktop, never on the second visit, never under reduce motion,
  // and a click skips it.
  const b2 = await launch({});
  try {
    const first = await b2.newPage({ width: 1440, height: 900 });
    await first.goto(`${base}/`);
    await first.until('!!window.__lobbyDebug?.flyinPlayed', 'the fly-in', 90000).catch(() => null);
    check(await first.ev('window.__lobbyDebug?.flyinPlayed === 1'), 'r2-j38: the first visit on a desktop plays the fly-in');
    await first.until('window.__lobbyDebug.flyinDone === true', 'the fly-in to end', 15000).catch(() => null);
    check(await first.ev('window.__lobbyDebug.flyinDone === true && !window.__lobbyDebug.flyin'), 'r2-j38: it ends on the normal view');
    first.close();
    const second = await b2.newPage({ width: 1440, height: 900 });
    await second.goto(`${base}/`);
    await second.until('!!window.__lobbyDebug?.liveState', 'the tower', 90000);
    await sleep(1500);
    check(await second.ev('!window.__lobbyDebug.flyinPlayed'), 'r2-j38: never a second time');
    second.close();
  } finally { b2.close(); }
  const b3 = await launch({});
  try {
    const reduce = await b3.newPage({ width: 1440, height: 900 });
    await reduce.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await reduce.goto(`${base}/`);
    await reduce.until('!!window.__lobbyDebug?.liveState', 'the tower', 90000);
    await sleep(1500);
    check(await reduce.ev('!window.__lobbyDebug.flyinPlayed'), 'r2-j38: never under reduce motion');
    reduce.close();
    // The reduce-motion visit set no mark, so this is still a first visit: a click skips the fly-in at once.
    const skip = await b3.newPage({ width: 1440, height: 900 });
    await skip.goto(`${base}/`);
    // The click lands inside the page the moment the fly-in starts.
    const skipped = await skip.ev(`new Promise((r) => { const t0 = performance.now(); const f = () => { const v = window.__lobbyDebug; if (v?.flyin) { window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); r(v.flyinSkipped === true && !v.flyin); } else if (performance.now() - t0 > 90000) r('never started'); else requestAnimationFrame(f); }; f(); })`);
    check(skipped === true, `r2-j38: any input skips it (${skipped})`);
    skip.close();
  } finally { b3.close(); }
} finally {
  b.close(); await t.close();
}
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
