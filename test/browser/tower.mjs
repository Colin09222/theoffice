// The 3D building in a real browser on the machine's GPU: ride it with the wheel and a swipe, check the floors near the camera are real
// rooms with people in them, fly into one, come back out, and measure frame times and draw calls on a desktop and on a phone profile
// with the CPU slowed four times. TOWER_SHOTS=/some/dir keeps screenshots; TOWER_ONLY=desktop|phone runs one profile.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const OUT = process.env.TOWER_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
const ONLY = process.env.TOWER_ONLY || '';
let failures = 0;
const results = {};
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };
const step = async (name, fn) => { try { const d = await fn(); check(name, true, d || ''); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };

const t = await boot({ mockDelayMs: 60, peopleTalk: true });
const base = `http://localhost:${t.port}/theoffice`;
const LAYOUTS = ['open', 'studio', 'garage', 'lounge', 'pods'];
const FLOORS = ['wood', 'carpet', 'terrazzo', 'concrete', 'parquet', 'tile'];
const PALETTE = [['#2f6f62', '#f4c95d'], ['#6a4c93', '#f4c95d'], ['#c8392b', '#ffd27a'], ['#1d5fb8', '#9be3c8'], ['#d9774a', '#2a3a4a'], ['#37b679', '#1f2a44'], ['#8c2f39', '#e6e0d2'], ['#22577a', '#f27d2e']];
const owners = {};
// Twenty-two companies over thirty floors: some to let, one hidden, one moving in, one closed by the manager.
const taken = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18, 19, 20, 22, 23, 25, 27];
for (const [i, n] of taken.entries()) {
  const [primary, accent] = PALETTE[i % PALETTE.length];
  owners[n] = await claim(t, `Company ${n}`, { floor: n, body: { colors: { primary, accent } } });
  t.db.prepare('UPDATE floors SET decor=? WHERE number=?').run(JSON.stringify({ layout: LAYOUTS[i % 5], floor: FLOORS[i % 6], wall: ['#e9e1d3', '#d9cfe8', '#f3e3c7', '#e4ecf7', '#dfe6e1'][i % 5], wallMat: 'paint', artStyle: 'shapes', plants: 2 + (i % 4), rug: true, art: true, coffee: i % 2 === 0, arcade: i % 3 === 0, neon: true, pet: ['none', 'dog', 'cat', 'robot'][i % 4] }), n);
}
t.db.prepare('UPDATE floors SET hidden=1 WHERE number=9').run();
t.db.prepare("UPDATE floors SET name='' WHERE number=27").run();
t.db.prepare("UPDATE agents SET state='typing' WHERE id % 3 = 0").run();
const staffN = t.db.prepare('SELECT COUNT(*) n FROM agents').get().n;
console.log(`building: ${taken.length} companies, ${staffN} staff`);
// Work going on, so people really move: the boss of a few floors asks for something.
for (const n of [10, 11, 12, 14]) await owners[n].post(`/api/floors/${owners[n].slug}/chat`, { text: 'Make us a tiny game about stacking boxes, please.' }).catch(() => {});

const b = await launch({ noAngle: true });
/** Frame times and draw calls over `ms`, while `during` runs. */
const sample = (p, ms) => p.ev(`new Promise((res) => {
  const st = window.__stage, r = st.renderer, ts = [], calls = [], tris = [], long = []; let last = performance.now(); const end = last + ${ms};
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); try { po.observe({ type: 'longtask' }); } catch {}
  const f = (now) => { ts.push(now - last); last = now; calls.push(r.info.render.calls); tris.push(r.info.render.triangles); if (now < end) requestAnimationFrame(f); else done(); };
  const q = (a, x) => { const s = [...a].sort((m, n) => m - n); return s[Math.min(s.length - 1, Math.floor(s.length * x))]; };
  const done = () => { po.disconnect(); res({ long: long.slice(0, 12), frames: ts.length, p50: +q(ts, 0.5).toFixed(1), p95: +q(ts, 0.95).toFixed(1), max: +Math.max(...ts).toFixed(1), fps: +(1000 * ts.length / ${ms}).toFixed(1), calls: Math.max(...calls), callsP50: q(calls, 0.5), tris: Math.max(...tris), geos: r.info.memory.geometries, tex: r.info.memory.textures, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, tier: st.tier, dpr: st.dpr, full: window.__tower ? [...window.__tower.full.keys()].length : null }); };
  requestAnimationFrame(f);
})`);
const wheel = async (p, dy, n = 1, gap = 40) => { for (let i = 0; i < n; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 420, deltaX: 0, deltaY: dy }); await sleep(gap); } };
const towerState = (p) => p.ev(`(() => { const T = window.__tower; if (!T) return null; const c = Math.round(T.ride); const s = T.slots[c]; const f = T.full.get(c);
  const moving = f ? [...f.view.actors.values()].filter((a) => a.char.isModel && (a.path.length || a.char.anim !== 'sit' || a.state !== 'idle')).length : 0;
  return { ride: +T.ride.toFixed(2), n: s?.n, kind: s?.kind, slots: T.slots.length, numbers: T.slots.map((x) => x.n), full: [...T.full.keys()], shown: [...T.full.values()].filter((x) => x.view.root.visible).map((x) => x.slot.n), actors: f ? f.view.actors.size : 0, models: f ? [...f.view.actors.values()].filter((a) => a.char.isModel).length : 0, moving, tags: [...document.querySelectorAll('#labels .char-tag')].filter((e) => e.style.visibility !== 'hidden').length, plaques: document.querySelectorAll('.tower-plaque:not(.off)').length }; })()`);

async function profile(kind) {
  const phone = kind === 'phone';
  const p = await b.newPage(phone ? { mobile: true, width: 390, height: 844 } : { width: 1440, height: 900 });
  if (phone) await p.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = results[kind] = {};
  await step(`${kind}: the lobby opens on the 3D building`, async () => {
    await p.goto(`${base}/`);
    await p.until('document.body.dataset.page === "lobby" && !!document.querySelector(".lobby-mode")', 'lobby', 40000);
    if (!phone) await p.click('.mode-btn[data-mode="building"]');
    await p.until('window.__tower && window.__stage.view === window.__tower && window.__tower.slots.length > 0', 'tower', 40000);
    const s = await towerState(p);
    if (s.numbers.includes(9)) throw new Error('hidden floor 9 is in the stack');
    if (!s.numbers.includes(13) || !s.numbers.includes(30)) throw new Error(`to-let floors missing: ${s.numbers}`);
    return `${s.slots} floors in the stack, starting at ${s.n}`;
  });
  await step(`${kind}: the floor in the middle becomes a real room with its people`, async () => {
    await p.ev('window.__tower.rideToFloor(12, { instant: true })');
    await p.until('(() => { const T = window.__tower; const f = T.full.get(Math.round(T.ride)); return f && f.view.root.visible && f.show >= 1 && [...f.view.actors.values()].every((a) => a.char.isModel); })()', 'real floor', 45000);
    await sleep(phone ? 6000 : 3000);
    const s = await towerState(p);
    if (s.actors < 3 || s.models < 3) throw new Error(JSON.stringify(s));
    if (s.tags < 2) throw new Error(`name tags: ${s.tags}`);
    if (OUT) await p.shot(join(OUT, `${kind}-tower.jpg`));
    return `floor ${s.n}: ${s.actors} people, ${s.moving} at work or walking, ${s.tags} name tags, real floors ${s.shown.join(',')}`;
  });
  await step(`${kind}: frame time holding still`, async () => { r.still = await sample(p, 4000); return JSON.stringify(r.still); });
  await step(`${kind}: frame time riding the tower with the wheel and a swipe`, async () => {
    const run = sample(p, 9000);
    await sleep(200);
    if (phone) { for (let i = 0; i < 3; i++) { await p.drag(200, 560, 205, 260, true); await sleep(900); } for (let i = 0; i < 3; i++) { await p.drag(200, 260, 205, 600, true); await sleep(900); } }
    else { await wheel(p, 120, 12, 60); await sleep(1200); await wheel(p, -120, 18, 50); await sleep(1500); await wheel(p, 120, 6, 80); }
    r.ride = await run;
    return JSON.stringify(r.ride);
  });
  await step(`${kind}: after the ride, the floor in the middle is real again`, async () => {
    await p.until('(() => { const T = window.__tower; const k = Math.round(T.ride); const s = T.slots[k]; if (s.kind !== "company") return true; const f = T.full.get(k); return f && f.view.root.visible && f.show >= 1; })()', 'settled floor', 30000);
    const s = await towerState(p);
    return `at floor ${s.n} (${s.kind}), real: ${s.shown.join(',')}`;
  });
  await step(`${kind}: tapping a floor flies into it, and the floor page carries on with the same room`, async () => {
    await p.ev('window.__tower.rideToFloor(14, { instant: true })');
    await p.until('(() => { const T = window.__tower; const f = T.full.get(Math.round(T.ride)); return f && f.view.root.visible && f.show >= 1; })()', 'floor 14 real', 30000);
    await sleep(500);
    const before = await p.ev('(() => { const T = window.__tower; const f = T.full.get(Math.round(T.ride)); window.__handed = f.view; return f.view.actors.size; })()');
    const at = await p.ev(`(() => { const T = window.__tower; const k = Math.round(T.ride); const v = new (T.camera.position.constructor)(0, ${'T.rideY() + 2.3'}, 0).project(T.camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]; })()`);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'left', clickCount: 1 });
    const flight = sample(p, 2600);
    if (OUT) { await sleep(700); await p.shot(join(OUT, `${kind}-flying.jpg`)); }
    r.flyIn = await flight;
    await p.until('document.body.dataset.page === "floor" && window.__office?.view && window.__stage.view === window.__office.view', 'floor page', 20000);
    const same = await p.ev('window.__office.view === window.__handed');
    const doors = await p.ev('document.querySelector("#fade").classList.contains("in")');
    if (!same) throw new Error('the floor page built a new room');
    if (doors) throw new Error('the lift doors closed');
    await sleep(1500);
    if (OUT) await p.shot(join(OUT, `${kind}-floor.jpg`));
    return `same room, ${before} people, no doors; flight ${JSON.stringify(r.flyIn)}`;
  });
  await step(`${kind}: Back flies out to the same spot in the building`, async () => {
    const handed = await p.ev('!!window.__handed');
    await p.click('.floor-top .back');
    await p.until('document.body.dataset.page === "lobby" && window.__tower && window.__stage.view === window.__tower', 'back to the tower', 20000);
    const out = sample(p, 2000);
    r.flyOut = await out;
    await p.until('!window.__tower.flight', 'landed', 8000);
    const s = await towerState(p);
    const same = await p.ev('[...window.__tower.full.values()].some((f) => f.view === window.__handed)');
    if (s.n !== 14) throw new Error(`landed on ${s.n}`);
    if (!same && handed) throw new Error('the tower built the room again');
    return `back at floor ${s.n}, same room ${same}; flight ${JSON.stringify(r.flyOut)}`;
  });
  await step(`${kind}: no console errors`, async () => {
    const errs = p.errors.filter((e) => !/favicon|ERR_ABORTED|net::ERR/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 4).join(' | ').slice(0, 300));
  });
  p.close();
}

try {
  if (ONLY !== 'phone') await profile('desktop');
  if (ONLY !== 'desktop') await profile('phone');
} finally {
  b.close(); await t.close?.();
}
if (OUT) writeFileSync(join(OUT, 'perf.json'), JSON.stringify(results, null, 1));
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
