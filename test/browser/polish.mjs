// The 3D building, polished: turn it all the way round, zoom from the whole tower down to a desk, ride it, tap in and back out, take the
// lift floor to floor with no doors, check the job titles sit over the names, and watch the stage step down on a throttled device.
// POLISH_SHOTS=/some/dir keeps screenshots; POLISH_ONLY=desktop|phone runs one profile. Frame times, draw calls and memory are printed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const OUT = process.env.POLISH_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
const ONLY = process.env.POLISH_ONLY || '';
let failures = 0;
const results = {};
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`.slice(0, 600)); if (!ok) failures++; };
const STEP = process.env.POLISH_STEP || '';  // run only the steps whose name has this in it
const step = async (name, fn) => { if (STEP && !name.includes(STEP)) return; try { const d = await fn(); check(name, true, d || ''); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };


// A slow mock line, so the staff are still at their work when the building is looked at.
const t = await boot({ mockDelayMs: 1800, peopleTalk: true });
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
const work = async (list) => { for (const n of list) await owners[n].post(`/api/floors/${owners[n].slug}/chat`, { text: 'Make us a tiny game about stacking boxes, please.' }).catch(() => {}); };

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

// Where the page's camera is, how far round, how close, and what the cut is doing on the floor in the middle.
const view = (p) => p.ev(`(() => { const T = window.__tower; const c = T.camera.position; const k = Math.round(T.ride); const f = T.full.get(k);
  return { yaw: T.yaw, targetYaw: T.targetYaw, zoom: T.zoom, zMin: T.zMin, ride: T.ride, k, n: T.slots[k]?.n, flight: !!T.flight, page: document.body.dataset.page,
    camY: c.y - (${'T.rideY()'}), cutOn: window.__cut?.() ?? null, far: f ? f.view.farWalls?.visible : null, real: !!f && f.view.root.visible && f.show >= 1 }; })()`);
const settle = (p, what = 'settled') => p.until('(() => { const T = window.__tower; return Math.abs(T.targetYaw - T.yaw) < 0.003 && Math.abs(T.targetZoom - T.zoom) < 0.003 && Math.abs(T.target - T.ride) < 0.01 && !T.flight; })()', what, 15000);
const click = async (p, sel) => { const r = await p.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; })()`); if (!r) throw new Error(`no ${sel}`); await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 }); await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0], y: r[1], button: 'left', clickCount: 1 }); };
const tapAt = async (p, x, y, touch) => {
  if (touch) { await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(60); await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); return; }
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const mouseDrag = async (p, x1, y1, x2, y2, n = 14) => {
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
  for (let i = 1; i <= n; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / n, y: y1 + (y2 - y1) * i / n, button: 'left', buttons: 1 }); await sleep(16); }
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
};
const pinch = async (p, cx, cy, from, to, n = 12) => {
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= n; i++) { await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + (to - from) * i / n) }); await sleep(20); }
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const whereIs = (p, n) => p.ev(`(() => { const T = window.__tower; const s = T.byNumber.get(${n}); const v = new (T.camera.position.constructor)(0, ${'T.rideY(s.k) + 1.6'} + T.offsetOf(s.k), 0).project(T.camera); return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)]; })()`);
/** A full-detail frame: the floor page's room, its furniture in, everyone in their own model, and a frame drawn since. */
const fullDetail = 'window.__office?.view && window.__stage.view === window.__office.view && window.__office.view.loading?.settled && [...window.__office.view.actors.values()].every((a) => a.char.isModel)';

async function profile(kind) {
  const phone = kind === 'phone';
  const p = await b.newPage(phone ? { mobile: true, width: 390, height: 844 } : { width: 1440, height: 900 });
  if (phone) await p.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = results[kind] = {};
  await step(`${kind}: the lobby opens on the 3D building`, async () => {
    await p.goto(`${base}/`);
    await p.until('document.body.dataset.page === "lobby" && !!document.querySelector(".lobby-mode") && !document.querySelector("#boot")', 'lobby', 40000);
    if (!phone) await p.click('.mode-btn[data-mode="building"]');
    await p.until('window.__tower && window.__stage.view === window.__tower && window.__tower.slots.length > 0', 'tower', 40000);
    await p.ev('window.__cut = () => window.__tower && (() => { const c = window.__tower.camera.position, l = Math.hypot(c.x, c.z); return [+(c.z / l).toFixed(2), +(c.x / l).toFixed(2)]; })()');
    const n = await p.ev('document.querySelectorAll(".tower-ctrl .tower-btn").length');
    if (n !== 7) throw new Error(`${n} control buttons`);
    return '7 buttons: up, down, turn left, turn right, in, out, whole building';
  });
  await step(`${kind}: job titles sit above the names on the tower's tags`, async () => {
    await work(phone ? [15, 16, 18] : [10, 11, 12, 14]);
    await p.ev('window.__tower.rideToFloor(12, { instant: true })');
    await p.until('(() => { const T = window.__tower; const f = T.full.get(Math.round(T.ride)); return f && f.view.root.visible && f.show >= 1 && [...f.view.actors.values()].every((a) => a.char.isModel); })()', 'floor 12 real', 40000);
    await sleep(phone ? 3000 : 1500);
    const tags = await p.ev(`[...document.querySelectorAll('#labels .char-tag')].filter((t) => t.style.visibility !== 'hidden' && t.offsetParent !== null).map((t) => { const r = t.querySelector('.char-role'), n = t.querySelector('.char-name'); return { role: r?.textContent || '', name: n?.textContent || '', above: !!r && !!n && r.getBoundingClientRect().bottom <= n.getBoundingClientRect().top + 2, px: r ? parseFloat(getComputedStyle(r).fontSize) : 0 }; })`);
    if (tags.length < 2) throw new Error(`only ${tags.length} tags showing`);
    const bad = tags.filter((x) => !x.role || !x.above);
    if (bad.length) throw new Error(`no title above: ${JSON.stringify(bad.slice(0, 3))}`);
    if (OUT) await p.shot(join(OUT, `${kind}-tower.jpg`));
    return `${tags.length} tags, e.g. ${tags.slice(0, 3).map((x) => `${x.role} / ${x.name}`).join('; ')}; title ${tags[0].px}px`;
  });
  await step(`${kind}: frame time holding still in the tower`, async () => { r.towerStill = await sample(p, 4000); return JSON.stringify(r.towerStill); });
  await step(`${kind}: a sideways drag turns the building and never enters a floor`, async () => {
    const a = await view(p);
    if (phone) await p.drag(330, 420, 60, 428, true); else await mouseDrag(p, 420, 430, 900, 436);
    await sleep(300);
    const b2 = await view(p);
    if (Math.abs(b2.targetYaw - a.targetYaw) < 0.8) throw new Error(`turned only ${(b2.targetYaw - a.targetYaw).toFixed(2)} rad`);
    if (Math.abs(b2.ride - a.ride) > 0.05) throw new Error(`rode ${a.ride} to ${b2.ride}`);
    if (b2.flight || b2.page !== 'lobby') throw new Error('a drag started a flight');
    return `turned ${(b2.targetYaw - a.targetYaw).toFixed(2)} rad, still on floor ${b2.n}`;
  });
  await step(`${kind}: all the way round: from behind, the walls facing the camera are cut and the far walls stand`, async () => {
    await p.ev('(() => { const T = window.__tower; T.targetYaw = Math.round(T.yaw / (Math.PI * 2)) * Math.PI * 2 + 0.4; })()');
    await settle(p);
    const run = sample(p, 5200);
    const a = await view(p);
    for (let i = 0; i < 4; i++) { await click(p, '.tb-right'); await sleep(260); }
    r.orbit = await run;
    await settle(p);
    await sleep(400);
    const b2 = await view(p);
    if (b2.cutOn[0] > -0.4 && b2.cutOn[1] > -0.4) throw new Error(`camera not behind: ${JSON.stringify(b2.cutOn)}`);
    if (b2.real && !b2.far) throw new Error('the far walls are not up');
    if (OUT) await p.shot(join(OUT, `${kind}-behind.jpg`));
    for (let i = 0; i < 4; i++) { await click(p, '.tb-right'); await sleep(120); }
    await settle(p);
    const c = await view(p);
    const turned = c.yaw - a.yaw;
    if (Math.abs(turned - Math.PI * 2) > 0.8) throw new Error(`a full turn went ${turned.toFixed(2)} rad`);
    if (c.far) throw new Error('far walls still up from the front');
    return `round ${(turned / Math.PI * 180).toFixed(0)} degrees; from behind cut ${JSON.stringify(b2.cutOn)}, far walls up; orbiting ${JSON.stringify(r.orbit)}`;
  });
  await step(`${kind}: zoom in and out (${phone ? 'pinch' : 'ctrl+wheel'} and the buttons), down to desk height`, async () => {
    const a = await view(p);
    if (phone) await pinch(p, 195, 420, 120, 300); else for (let i = 0; i < 6; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 420, deltaX: 0, deltaY: -40, modifiers: 2 }); await sleep(30); }
    await sleep(200);
    const b2 = await view(p);
    if (b2.zoom <= a.zoom * 1.25 && (await p.ev('window.__tower.targetZoom')) <= a.zoom * 1.25) throw new Error(`zoom ${a.zoom} to ${b2.zoom}`);
    for (let i = 0; i < 6; i++) { await click(p, '.tb-in'); await sleep(80); }
    await settle(p);
    const c = await view(p);
    if (c.camY > 9.5) throw new Error(`closest view is ${c.camY.toFixed(1)} above the floor`);
    if (OUT && !phone) await p.shot(join(OUT, `${kind}-close.jpg`));
    for (let i = 0; i < 8; i++) { await click(p, '.tb-out'); await sleep(60); }
    await settle(p);
    const d = await view(p);
    if (d.zoom >= 1) throw new Error(`zoom out stopped at ${d.zoom}`);
    return `${a.zoom.toFixed(2)} → ${b2.zoom.toFixed(2)} by ${phone ? 'pinch' : 'ctrl+wheel'}; closest: camera ${c.camY.toFixed(1)} above the floor; out to ${d.zoom.toFixed(2)}`;
  });
  await step(`${kind}: Whole building shows every floor, ground to roof, and back`, async () => {
    await p.ev('window.__tower.targetZoom = 1');
    await settle(p);
    await click(p, '.tb-whole');
    await settle(p, 'whole building');
    const fit = await p.ev(`(() => { const T = window.__tower; const V = T.camera.position.constructor; const out = []; for (const y of [0, ${'T.rideY(T.slots.length)'} + 30]) { const v = new V(0, y, 0).project(T.camera); out.push(+((-v.y * 0.5 + 0.5) * innerHeight).toFixed(0)); } return { ys: out, zoom: T.zoom, zMin: T.zMin }; })()`);
    if (fit.ys.some((y) => y < 0 || y > (phone ? 844 : 900))) throw new Error(`building runs off screen: ${JSON.stringify(fit)}`);
    r.whole = await sample(p, 2500);
    if (OUT) await p.shot(join(OUT, `${kind}-whole.jpg`));
    await click(p, '.tb-whole');
    await settle(p);
    const back = await view(p);
    if (Math.abs(back.zoom - 1) > 0.01) throw new Error(`came back to zoom ${back.zoom}`);
    return `ground at y=${fit.ys[0]}, roof at y=${fit.ys[1]}, zoom ${fit.zoom.toFixed(2)}; ${JSON.stringify(r.whole)}`;
  });
  await step(`${kind}: ${phone ? 'a vertical swipe' : 'the wheel'} still rides the floors after turning`, async () => {
    await p.ev('window.__tower.rideToFloor(12, { instant: true }); window.__tower.targetYaw = window.__tower.yaw + 1.3');
    await settle(p);
    const a = await view(p);
    if (phone) await p.drag(200, 300, 205, 640, true); else for (let i = 0; i < 4; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 420, deltaX: 0, deltaY: 120 }); await sleep(40); }
    await settle(p);
    const b2 = await view(p);
    if (Math.round(b2.ride) === Math.round(a.ride)) throw new Error(`stayed on ${b2.n}`);
    if (Math.abs(b2.yaw - a.yaw) > 0.05) throw new Error('riding turned the building');
    return `floor ${a.n} to ${b2.n}`;
  });
  await step(`${kind}: tapping a floor from behind flies round and in; Back flies out to the same turn`, async () => {
    await p.ev('window.__tower.rideToFloor(14, { instant: true }); window.__tower.targetYaw = window.__tower.yaw + Math.PI');
    await settle(p);
    await p.until('(() => { const T = window.__tower; const f = T.full.get(Math.round(T.ride)); return f && f.view.root.visible && f.show >= 1; })()', 'floor 14 real', 30000);
    await sleep(400);
    const yaw0 = (await view(p)).targetYaw;
    await p.ev('(() => { const T = window.__tower; window.__handed = T.full.get(Math.round(T.ride)).view; })()');
    const at = await whereIs(p, 14);
    const flight = sample(p, 2400);
    await tapAt(p, at[0], at[1], phone);
    r.flyIn = await flight;
    await p.until('document.body.dataset.page === "floor" && window.__office?.view && window.__stage.view === window.__office.view', 'floor page', 20000);
    if (!(await p.ev('window.__office.view === window.__handed'))) throw new Error('the floor page built a new room');
    if (await p.ev('document.querySelector("#fade").classList.contains("in")')) throw new Error('the lift doors closed');
    await sleep(1200);
    const roles = await p.ev(`[...document.querySelectorAll('#labels .char-tag')].filter((t) => t.style.visibility !== 'hidden').map((t) => !!t.querySelector('.char-role')?.textContent && t.querySelector('.char-role').getBoundingClientRect().bottom <= t.querySelector('.char-name').getBoundingClientRect().top + 2)`);
    if (!roles.length || roles.some((x) => !x)) throw new Error(`floor page tags: ${JSON.stringify(roles)}`);
    if (OUT && !phone) await p.shot(join(OUT, `${kind}-floor.jpg`));
    r.floorStill = await sample(p, 3000);
    await p.click('.floor-top .back');
    await p.until('document.body.dataset.page === "lobby" && window.__tower && window.__stage.view === window.__tower', 'back to the tower', 20000);
    await p.until('!window.__tower.flight', 'landed', 8000);
    const b2 = await view(p);
    if (b2.n !== 14) throw new Error(`landed on ${b2.n}`);
    if (Math.abs(b2.targetYaw - yaw0) > 0.01) throw new Error(`came back turned ${b2.targetYaw} not ${yaw0}`);
    return `in ${JSON.stringify(r.flyIn)}; ${roles.length} floor-page tags with titles; floor page ${JSON.stringify(r.floorStill)}; back at 14, same turn`;
  });
  await step(`${kind}: the lift goes floor to floor with no doors, warm under 300 ms`, async () => {
    await p.goto(`${base}/floor/${owners[12].slug}`);
    await p.until(fullDetail, 'floor 12', 30000);
    await sleep(phone ? 3500 : 2000);  // the neighbours are fetched while the floor is looked at
    const times = [];
    for (const [dir, n] of [['up', 14], ['down', 12], ['up', 14], ['down', 12]]) {
      // Timed in the page, frame by frame: from the press to the first frame on which the new floor is there in full detail.
      await p.ev(`(() => { performance.clearMarks(); window.__t0 = performance.now(); window.__t1 = 0; window.__doors = 0; window.__fr = []; const w = () => { if (document.querySelector("#fade")?.classList.contains("in") || document.querySelector("#boot:not(.gone)")) window.__doors++;
        const v = window.__office?.view; window.__fr.push(Math.round(performance.now() - window.__t0) + (v ? (window.__office.state.floor.number + (v.loading?.settled ? 's' : 'l') + [...v.actors.values()].filter((a) => !a.char.isModel).length + (window.__stage.view === v ? 'v' : '')) : '-'));
        if (window.__office?.state?.floor?.number === ${n} && (${fullDetail})) { window.__t1 = performance.now(); return; } requestAnimationFrame(w); }; requestAnimationFrame(w); })()`);
      if (phone) { const at = await p.ev(`(() => { const q = document.querySelector('[data-scrub=${dir}]').getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; })()`); await tapAt(p, at[0], at[1], true); } else await click(p, `[data-scrub=${dir}]`);
      await p.until('window.__t1 > 0', `floor ${n}`, 20000);
      times.push(await p.ev('({ ms: Math.round(window.__t1 - window.__t0), doors: window.__doors, fr: window.__fr.slice(-3).join(" ") + " marks " + performance.getEntriesByType("mark").map((x) => x.name.replace("office:", "") + "@" + Math.round(x.startTime - window.__t0)).join(" ") })'));
      await sleep(phone ? 2500 : 1500);
    }
    r.lift = times;
    const warm = times.slice(1).map((x) => x.ms);
    if (times.some((x) => x.doors)) throw new Error(`the doors closed: ${JSON.stringify(times)}`);
    if (Math.max(...warm) > 300) throw new Error(`warm switches ${warm.join(', ')} ms; ${times.map((x) => x.fr).join(' | ')}`);
    return `first ${times[0].ms} ms, then ${warm.join(', ')} ms, no doors`;
  });
  await step(`${kind}: a direct link to a floor draws its first 3D frame fast, with no spinner`, async () => {
    await p.send('Network.enable'); await p.send('Network.clearBrowserCache'); await p.send('Network.setCacheDisabled', { cacheDisabled: true });
    await p.goto('about:blank');
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__ff = 0; const w = () => { if (window.__stage?.view && window.__office?.view === window.__stage.view && window.__stage.frame > 0 && !document.querySelector("#boot:not(.gone)")) { window.__ff = performance.now(); return; } requestAnimationFrame(w); }; requestAnimationFrame(w);' });
    await p.goto(`${base}/floor/${owners[14].slug}`);
    await p.until('window.__ff > 0', 'first frame', 20000);
    const ff = Math.round(await p.ev('window.__ff'));
    await p.until(fullDetail, 'full detail', 30000);
    const full = Math.round(await p.ev('performance.now()'));
    await p.send('Network.setCacheDisabled', { cacheDisabled: false });
    r.cold = { firstFrame: ff, fullDetailBy: full };
    if (ff > 2500) throw new Error(`first 3D frame at ${ff} ms`);
    return `first 3D frame ${ff} ms after navigation (no cache), full detail by ${full} ms`;
  });
  await step(`${kind}: no console errors`, async () => {
    const errs = p.errors.filter((e) => !/favicon|ERR_ABORTED|net::ERR/.test(e) && !/Evaluating a string as JavaScript violates/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 4).join(' | ').slice(0, 300));
  });
  p.close();
}

/** On its own page, so its permanent step-downs touch nothing else: a CPU slowed far past what the stage can carry. */
async function governor() {
  const p = await b.newPage({ width: 1280, height: 800 });
  await step('governor: a throttled device steps down by itself within a few seconds', async () => {
    await p.goto(`${base}/`);
    await p.until('document.body.dataset.page === "lobby" && !!document.querySelector(".lobby-mode") && !document.querySelector("#boot")', 'lobby', 40000);
    await p.click('.mode-btn[data-mode="building"]');
    await p.until('window.__tower && window.__stage.view === window.__tower && window.__tower.slots.length > 0', 'tower', 40000);
    await sleep(2500);
    const before = await p.ev('({ tier: window.__stage.tier, radius: window.__tower.radius, steps: [...window.__stage.steps] })');
    await p.send('Emulation.setCPUThrottlingRate', { rate: 24 });
    const t0 = Date.now();
    await p.until(`window.__stage.steps.length > ${before.steps.length}`, 'a step down', 30000);
    const first = Date.now() - t0;
    await sleep(6000);
    const after = await p.ev('({ tier: window.__stage.tier, radius: window.__tower.radius, steps: [...window.__stage.steps], fps: Math.round(window.__stage.fps) })');
    await p.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    results.governor = { before, after, firstStepMs: first };
    return `${before.tier} (radius ${before.radius}) → ${after.steps.join(' → ')} (radius ${after.radius}); first step after ${first} ms`;
  });
  p.close();
}

try {
  if (ONLY !== 'phone') await profile('desktop');
  if (ONLY !== 'desktop') await profile('phone');
  if (!ONLY || ONLY === 'governor') await governor();
} finally {
  b.close(); await t.close?.();
}
if (OUT) writeFileSync(join(OUT, 'perf.json'), JSON.stringify(results, null, 1));
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
