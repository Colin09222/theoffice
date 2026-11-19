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
  const i0 = await p.ev('window.__lobbyDebug.board.frame(performance.now()).index');
  await sleep(6100);
  const i1 = await p.ev('window.__lobbyDebug.board.frame(performance.now()).index');
  check(i1 === (i0 + 1) % 3, `r2-j37: 6 s later it shows the next one (${i0} then ${i1})`);
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
} finally {
  b.close(); await t.close();
}
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
