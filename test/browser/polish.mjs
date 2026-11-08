// The floor pages, polished: take the lift floor to floor with no doors, turn a floor all the way round, a cold direct link, the job titles over
// the names, the idle frame rate, and the stage stepping down by itself on a throttled device. The lobby itself is in tower.mjs.
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
const STEP = process.env.POLISH_STEP || '';  // run only the steps whose name matches this pattern
const step = async (name, fn) => { if (STEP && !new RegExp(STEP).test(name)) return; try { const d = await fn(); check(name, true, d || ''); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };


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
  const st = window.__stage, r = st.renderer, ts = [], calls = [], tris = [], long = []; let last = performance.now(); const end = last + ${ms}; const d0 = st.drawn || 0;
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); try { po.observe({ type: 'longtask' }); } catch {}
  const f = (now) => { st.wake?.(); ts.push(now - last); last = now; calls.push(r.info.render.calls); tris.push(r.info.render.triangles); if (now < end) requestAnimationFrame(f); else done(); };
  const q = (a, x) => { const s = [...a].sort((m, n) => m - n); return s[Math.min(s.length - 1, Math.floor(s.length * x))]; };
  const done = () => { po.disconnect(); res({ long: long.slice(0, 12), frames: ts.length, p50: +q(ts, 0.5).toFixed(1), p95: +q(ts, 0.95).toFixed(1), max: +Math.max(...ts).toFixed(1), fps: +(1000 * ts.length / ${ms}).toFixed(1), drawnFps: +(1000 * ((st.drawn || 0) - d0) / ${ms}).toFixed(1), calls: Math.max(...calls), callsP50: q(calls, 0.5), tris: Math.max(...tris), geos: r.info.memory.geometries, tex: r.info.memory.textures, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, tier: st.tier, dpr: st.dpr }); };
  requestAnimationFrame(f);
})`);

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
/** A full-detail frame: the floor page's room, its furniture in, everyone in their own model, and a frame drawn since. */
const fullDetail = 'window.__office?.view && window.__stage.view === window.__office.view && window.__office.view.loading?.settled && window.__office.view.baked && [...window.__office.view.actors.values()].every((a) => a.char.isModel)';

async function profile(kind) {
  const phone = kind === 'phone';
  const p = await b.newPage(phone ? { mobile: true, width: 390, height: 844 } : { width: 1440, height: 900 });
  if (phone) await p.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = results[kind] = {};
  await step(`${kind}: job titles sit above the names on a floor page's tags`, async () => {
    await work(phone ? [15, 16, 18] : [10, 11, 12, 14]);
    await p.goto(`${base}/floor/${owners[12].slug}`);
    await p.until(fullDetail, 'floor 12', 40000);
    await sleep(phone ? 3000 : 1500);
    const tags = await p.ev(`[...document.querySelectorAll('#labels .char-tag')].filter((t) => t.style.visibility !== 'hidden' && t.offsetParent !== null).map((t) => { const r = t.querySelector('.char-role'), n = t.querySelector('.char-name'); return { role: r?.textContent || '', name: n?.textContent || '', above: !!r && !!n && r.getBoundingClientRect().top < n.getBoundingClientRect().top, px: r ? parseFloat(getComputedStyle(r).fontSize) : 0 }; })`);
    if (tags.length < 2) throw new Error(`only ${tags.length} tags showing`);
    const bad = tags.filter((x) => !x.role || !x.above);
    if (bad.length) throw new Error(`no title above: ${JSON.stringify(bad.slice(0, 3))}`);
    return `${tags.length} tags, e.g. ${tags.slice(0, 3).map((x) => `${x.role} / ${x.name}`).join('; ')}; title ${tags[0].px}px`;
  });
  await step(`${kind}: frame time holding still on a floor page`, async () => { r.floorStill = await sample(p, 4000); return JSON.stringify(r.floorStill); });
  await step(`${kind}: the lift goes floor to floor with no doors, warm under 300 ms`, async () => {
    await p.goto(`${base}/floor/${owners[12].slug}`);
    await p.until(fullDetail, 'floor 12', 30000);
    // The neighbours are fetched while the floor is looked at, and built ahead in a quiet spell: what that costs the main thread.
    await p.ev('window.__lt = []; window.__po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }); try { window.__po.observe({ type: "longtask" }); } catch {}');
    await sleep(phone ? 4500 : 3000);
    const ahead = await p.ev('(() => { window.__po.disconnect(); return window.__lt; })()');
    r.buildAhead = ahead;
    const times = [];
    for (const [dir, n] of [['up', 14], ['down', 12], ['up', 14], ['down', 12]]) {
      // Timed in the page, frame by frame: from the press to the first frame on which the new floor is there in full detail.
      await p.ev(`(() => { performance.clearMarks(); window.__t0 = performance.now(); window.__t1 = 0; window.__doors = 0; window.__fr = []; const w = () => { if (document.querySelector("#fade")?.classList.contains("in") || document.querySelector("#boot:not(.gone)")) window.__doors++;
        const v = window.__office?.view; window.__fr.push(Math.round(performance.now() - window.__t0) + (v ? (window.__office.state.floor.number + (v.loading?.settled ? 's' : 'l') + [...v.actors.values()].filter((a) => !a.char.isModel).length + (window.__stage.view === v ? 'v' : '')) : '-'));
        if (window.__office?.state?.floor?.number === ${n} && (${fullDetail})) { if (window.__d0 === undefined) window.__d0 = window.__stage.drawn; else if (window.__stage.drawn > window.__d0) { window.__t1 = performance.now(); delete window.__d0; return; } } requestAnimationFrame(w); }; delete window.__d0; requestAnimationFrame(w); })()`);
      if (phone) { const at = await p.ev(`(() => { const q = document.querySelector('[data-scrub=${dir}]').getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; })()`); await tapAt(p, at[0], at[1], true); } else await click(p, `[data-scrub=${dir}]`);
      await p.until('window.__t1 > 0', `floor ${n}`, 20000);
      times.push(await p.ev('({ ms: Math.round(window.__t1 - window.__t0), doors: window.__doors, fr: window.__fr.slice(-3).join(" ") + " marks " + performance.getEntriesByType("mark").map((x) => x.name.replace("office:", "") + "@" + Math.round(x.startTime - window.__t0)).join(" ") })'));
      await sleep(phone ? 2500 : 1500);
    }
    r.lift = times;
    const warm = times.slice(1).map((x) => x.ms);
    // And pressed the moment a floor opens, before anything has been built ahead: the slow case, reported as it is.
    await p.goto(`${base}/floor/${owners[8].slug}`);
    await p.until(`(${fullDetail}) && !!document.querySelector('[data-scrub=up]:not([disabled])')`, 'floor 8', 30000);
    await p.ev(`(() => { window.__t0 = performance.now(); window.__t1 = 0; const w = () => { if (window.__office?.state?.floor?.number === 10 && (${fullDetail})) { if (window.__d0 === undefined) window.__d0 = window.__stage.drawn; else if (window.__stage.drawn > window.__d0) { window.__t1 = performance.now(); return; } } requestAnimationFrame(w); }; delete window.__d0; requestAnimationFrame(w); })()`);
    if (phone) { const at = await p.ev(`(() => { const q = document.querySelector('[data-scrub=up]').getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; })()`); await tapAt(p, at[0], at[1], true); } else await click(p, '[data-scrub=up]');
    await p.until('window.__t1 > 0', 'floor 10, straight away', 20000);
    r.liftAtOnce = Math.round(await p.ev('window.__t1 - window.__t0'));
    if (times.some((x) => x.doors)) throw new Error(`the doors closed: ${JSON.stringify(times)}`);
    if (Math.max(...warm) > 300) throw new Error(`warm switches ${warm.join(', ')} ms; ${times.map((x) => x.fr).join(' | ')}`);
    return `first ${times[0].ms} ms, then ${warm.join(', ')} ms, no doors; pressed the moment a floor opens, nothing built ahead yet: ${r.liftAtOnce} ms; building ahead while idle: long tasks ${JSON.stringify(ahead)} ms`;
  });
  if (!phone) await step(`${kind}: the floor page turns all the way round too, its far walls up from behind`, async () => {
    await p.until(fullDetail, 'floor page', 20000);
    await p.ev('(() => { const v = window.__office.view; v.targetZoom = 1; })()');
    await sleep(800);
    const y0 = await p.ev('window.__office.view.targetYaw');
    await mouseDrag(p, 700, 500, 180, 505, 20);
    await sleep(200);
    await p.ev('(() => { const v = window.__office.view; v.targetYaw = Math.PI + 0.6; })()');
    await sleep(2000);
    const st = await p.ev('(() => { const v = window.__office.view; return { yaw: v.yaw, far: v.farWalls.visible, page: document.body.dataset.page }; })()');
    if (!st.far) throw new Error(`from behind the far walls are down: ${JSON.stringify(st)}`);
    const turned = await p.ev(`window.__office.view.targetYaw`);
    if (OUT) await p.shot(join(OUT, `${kind}-floor-behind.jpg`));
    await p.ev('window.__office.view.targetYaw = 0.5'); await sleep(1500);
    if (await p.ev('window.__office.view.farWalls.visible')) throw new Error('far walls still up from the front');
    return `drag turned from ${y0.toFixed(2)}; from behind (${turned.toFixed(2)} rad) the far walls stand, gone again from the front`;
  });
  await step(`${kind}: a direct link to a floor draws its first 3D frame fast, with no spinner`, async () => {
    const WATCH = 'window.__ff = 0; (() => { let d0; const w = () => { const s = window.__stage; if (s?.view && window.__office?.view === s.view && !document.querySelector("#boot:not(.gone)")) { if (d0 === undefined) d0 = s.drawn || 0; else if ((s.drawn || 0) > d0) { window.__ff = performance.now(); return; } } requestAnimationFrame(w); }; requestAnimationFrame(w); })();';
    await p.send('Network.enable'); await p.send('Page.enable');
    const added = await p.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
    const load = async (label) => {
      await p.send('Network.clearBrowserCache'); await p.send('Network.setCacheDisabled', { cacheDisabled: true });
      await p.goto('about:blank');
      await p.goto(`${base}/floor/${owners[14].slug}`);
      await p.until('window.__ff > 0', `first frame, ${label}`, 40000);
      const ff = Math.round(await p.ev('window.__ff'));
      await p.until(fullDetail, `full detail, ${label}`, 40000);
      return { firstFrame: ff, fullDetailBy: Math.round(await p.ev('performance.now()')) };
    };
    const local = await load('no line');
    // The same over a 4G-like line: 9 Mbit/s down, 60 ms each way.
    await p.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
    const line = await load('4G');
    await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await p.send('Network.setCacheDisabled', { cacheDisabled: false });
    await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.result.identifier });
    r.cold = { local, line };
    if (line.firstFrame > 2500) throw new Error(`over a 4G-like line the first 3D frame came at ${line.firstFrame} ms (localhost ${local.firstFrame} ms)`);
    return `no cache, localhost: first 3D frame ${local.firstFrame} ms, full detail ${local.fullDetailBy} ms; over a 4G-like line: first frame ${line.firstFrame} ms, full detail ${line.fullDetailBy} ms`;
  });
  await step(`${kind}: left alone, the stage draws every other frame; a touch brings it back`, async () => {
    await p.goto(`${base}/floor/${owners[12].slug}`);
    await p.until(fullDetail, 'floor', 30000);
    await sleep(8500);
    const measure = () => p.ev(`new Promise((res) => { const s = window.__stage; const d0 = s.drawn, t0 = performance.now(); let n = 0; const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res({ idle: s.idle, ticks: Math.round(n / 1.5), drawn: Math.round((s.drawn - d0) / 1.5) }); }; requestAnimationFrame(f); })`);
    const idle = await measure();
    await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    await sleep(100);
    const awake = await measure();
    r.idle = { idle, awake };
    if (!idle.idle || idle.drawn > idle.ticks * 0.7) throw new Error(`not throttled: ${JSON.stringify(idle)}`);
    if (awake.idle || awake.drawn < awake.ticks * 0.85) throw new Error(`not back to full: ${JSON.stringify(awake)}`);
    return `idle ${idle.drawn} drawn of ${idle.ticks} ticks a second; after a touch ${awake.drawn} of ${awake.ticks}`;
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
    await p.goto(`${base}/floor/${owners[12].slug}`);
    await p.until(fullDetail, 'floor', 40000);
    await sleep(2500);
    const before = await p.ev('({ tier: window.__stage.tier, steps: [...window.__stage.steps] })');
    await p.send('Emulation.setCPUThrottlingRate', { rate: 24 });
    const t0 = Date.now();
    await p.until(`window.__stage.steps.length > ${before.steps.length}`, 'a step down', 30000);
    const first = Date.now() - t0;
    await sleep(6000);
    const after = await p.ev('({ tier: window.__stage.tier, steps: [...window.__stage.steps], fps: Math.round(window.__stage.fps) })');
    await p.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    results.governor = { before, after, firstStepMs: first };
    return `${before.tier} → ${after.steps.join(' → ')}; first step after ${first} ms`;
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
