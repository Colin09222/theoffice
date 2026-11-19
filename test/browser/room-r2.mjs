// Round 2, lane A, in a real browser: the floor room (docs/redesign/OFFICE-ANSWERS-2.md). Each check names its job. npm run e2e:room2
// ROOM2_ONLY=j31,j32 runs some of them; ROOM2_SHOTS=dir saves a picture of each.
import { launch, sleep } from './cdp.mjs';
import { boot, claim, waitDone, adminClient } from '../helpers.js';
import { get, run } from '../../server/db.js';
import { weekOf } from '../../server/weekplan.js';
import { storeShot } from '../../server/shots.js';
import { REAL_JPEG, publish } from '../r2-fixtures.js';

const only = (process.env.ROOM2_ONLY || '').split(',').filter(Boolean);
const want = (j) => !only.length || only.includes(j);
const shots = process.env.ROOM2_SHOTS || '';
const t = await boot({ mockDelayMs: 50 });
const base = `http://localhost:${t.port}/theoffice`;
const b = await launch({});
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

/** Room time, stepped by hand through the room's own update(): software rendering here runs the room clock at a few percent of real time. */
const step = (p, secs, each = '') => p.ev(`(() => { const v = window.__office.view; for (let i = 0; i < ${secs} * 10; i++) { v.update(0.1); ${each} } })()`);
async function openRoom(slug, opts = {}, query = '') {
  const p = await b.newPage(opts);
  await p.goto(`${base}/floor/${slug}${query}`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view?.manager', 'room', 120000);
  return p;
}

try {
  if (want('j31')) {
    // r2-j31: on an Idle floor no bean types and at least one idle move plays within 20 s.
    const boss = await claim(t, 'Quiet Corner');
    const p = await openRoom(boss.slug);
    await p.ev('window.__seen = { moves: [], typed: 0, glow: 0 }');
    await step(p, 20, "for (const a of v.actors.values()) { if (a.action?.idleMove && a.path.length === 0) window.__seen.moves.push(a.action.idleMove); if (a.char.anim === 'type' || a.char.blend.type > 0.5) window.__seen.typed++; if (a.seat.glow?.visible) window.__seen.glow++; }");
    await sleep(1500);
    const seen = await p.ev('({ ...window.__seen, idle: window.__office.view.life.wasIdle, state: window.__office.view.floorState })');
    check(seen.state === 'idle' && seen.idle === true, `j31 the room knows the floor is Idle (${seen.state})`);
    check(seen.moves.length > 0, `j31 an idle move played within 20 s of room time (${[...new Set(seen.moves)].join(', ')})`);
    check(seen.typed === 0, `j31 nobody typed (${seen.typed})`);
    check(seen.glow === 0, `j31 no monitor glowed (${seen.glow})`);
    check(!p.errors.length, `j31 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
    if (shots) await p.shot(`${shots}/r2-j31-idle.jpg`);
  }
  if (want('j32')) {
    // r2-j32: floor 6's wall shows one frame with the real TheTireRx photo.
    const six = await claim(t, 'TheTireRx', { floor: 6 });
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', six.slug);
    publish(t.db, f.id, 'thetirerx', 'TheTireRx', Date.now() - 3600000);
    storeShot(t.db, { floorId: f.id, project: 'thetirerx', image: REAL_JPEG, url: 'https://thetirerx.com/' });
    const p = await openRoom(six.slug);
    await p.until('window.__office.view.frameMeshes?.[0]?.userData.photo', 'the photo in the frame', 30000);
    const r = await p.ev('(() => { const v = window.__office.view; return { n: v.frameMeshes.length, photo: v.frameMeshes[0].userData.photo, launch: v.frameMeshes[0].userData.launch, w: v.frameMeshes[0].material.map.image.width, low: v.low, more: !!v.frameMore }; })()');
    check(r.n === 1 && r.launch === 'thetirerx' && !r.more, `j32 one frame on floor 6's wall, for TheTireRx (${r.n}, ${r.launch})`);
    check(/\/api\/building\/shot\/[^/]+\/thetirerx\?v=/.test(r.photo) && r.w === (r.low ? 256 : 512), `j32 it shows the real launch photo (${r.photo}, ${r.w}px${r.low ? ', phone low' : ''})`);
    if (shots) {
      // Turn to the side wall and close in on the frame for the picture.
      await p.ev('(() => { const v = window.__office.view; const m = v.frameMeshes[0]; v.targetYaw = v.yaw = 1.3; v.targetZoom = v.zoom = 3.2; v.targetPan.set(m.position.x + 3, m.position.z); v.pan.copy(v.targetPan); })()');
      await sleep(2500); await p.shot(`${shots}/r2-j32-frames.jpg`);
    }
    check(!p.errors.length, `j32 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
  if (want('j39')) {
    // r2-j39: a Builder on a running job types with monitor glow; a waiting floor's beans glance at the boss door.
    const boss = await claim(t, 'Busy Bench');
    const p = await openRoom(boss.slug);
    const r = await p.ev(`(() => {
      const v = window.__office.view;
      const b = [...v.actors.values()].find((a) => a.info.role === 'builder');
      if (!b) return { none: true };
      v.updateBoard([...v.tasks, { id: 999001, title: 'Build the page', status: 'doing', agent_id: b.id, plan: '' }]);
      b.applyState('thinking', 'Working on it');
      for (let i = 0; i < 20; i++) v.update(0.1);
      return { anim: b.char.anim, typing: b.char.blend.type, glow: b.seat.glow.visible, detail: v.detailOn, screen: b.seat.screenMat.color.r, fast: b.char.fast };
    })()`);
    check(!r.none && r.anim === 'type' && r.typing > 0.5 && r.fast, `j39 the Builder on a running job types, fast (${r.anim}, ${r.typing?.toFixed(2)})`);
    check(r.screen > 1 && (r.glow || !r.detail), `j39 with the monitor glowing (${r.detail ? `glow ${r.glow}` : 'phone low: the flat bright screen'}, ${r.screen})`);
    const g = await p.ev(`(() => {
      const v = window.__office.view;
      v.updateBoard(v.tasks.filter((t) => t.id !== 999001));
      for (const a of v.actors.values()) a.applyState('idle', null);
      v.setFloorState('waiting');
      const away = new Set();
      for (let i = 0; i < 160; i++) { v.update(0.1); for (const a of v.actors.values()) if (a.action || !a.seated) away.add(a); }
      const free = [...v.actors.values()].filter((a) => !a.isBoss && !away.has(a));
      return { door: !!v.bossDoor, glanced: free.filter((a) => a.glanced !== undefined).length, free: free.length, idle: v.life.wasIdle };
    })()`);
    check(g.door && g.free > 0 && g.glanced === g.free && !g.idle, `j39 on a waiting floor every free bean (${g.glanced} of ${g.free}; the rest were up on a break) glanced at the boss door within 16 s`);
    if (shots) await p.shot(`${shots}/r2-j39-poses.jpg`);
    check(!p.errors.length, `j39 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
  if (want('j40')) {
    // r2-j40: a real launch event triggers one cheer; a failed check triggers one slump.
    const boss = await claim(t, 'Beat Street');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    const builder = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='builder'", f.id);
    const p = await openRoom(boss.slug);
    await sleep(1000);
    publish(t.db, f.id, 'beat-shop', 'Beat Shop', Date.now());
    t.app.engine.emitProject(f.id, 'beat-shop');
    t.app.engine.emitProject(f.id, 'beat-shop');  // one publish can raise two project events
    await p.until('(window.__office.view.played || []).some((b) => b.anim === "cheer")', 'the cheer', 30000);
    await sleep(3000);
    t.app.engine.emit(f.id, 'beat', { kind: 'check', passed: false, agent: builder.id, task: 4242 });
    t.app.engine.emit(f.id, 'beat', { kind: 'check', passed: false, agent: builder.id, task: 4242 });
    await p.until('(window.__office.view.played || []).some((b) => b.anim === "slump")', 'the slump', 30000);
    await sleep(1500);
    const r = await p.ev(`(() => { const v = window.__office.view; const b = v.actors.get(${builder.id}); return { played: v.played.map((x) => [x.anim, x.record.type, x.record.id, x.who.length]), anim: b.char.anim, bad: v.beat({ kind: "launch" }), refused: v.beats.refused }; })()`);
    const cheers = r.played.filter((x) => x[0] === 'cheer'), slumps = r.played.filter((x) => x[0] === 'slump');
    check(cheers.length === 1 && cheers[0][1] === 'launch' && /^beat-shop@\d+$/.test(cheers[0][2]) && cheers[0][3] > 1, `j40 one cheer for the launch, by the room, with its record (${JSON.stringify(cheers)})`);
    check(slumps.length === 1 && slumps[0][1] === 'task' && slumps[0][2] === 4242 && slumps[0][3] === 1, `j40 one slump for the failed check, by the one bean, with its record (${JSON.stringify(slumps)})`);
    check(r.bad === null && r.refused >= 1, 'j40 a beat with no record is refused');
    check(!p.errors.length, `j40 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
  if (want('j41')) {
    // r2-j41: the whiteboard lists the current plan's jobs and ticks one when it is done.
    const boss = await claim(t, 'Plan Board');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    const ids = ['Sketch the page', 'Build the page', 'Write the words'].map((x, i) => Number(run(t.db, 'INSERT INTO tasks (floor_id,title,brief,plan,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', f.id, x, x, 'This week: A tyre page', i ? 'todo' : 'doing', Date.now(), Date.now()).lastInsertRowid));
    run(t.db, "INSERT INTO weekly_plans (floor_id,week,status,goal,jobs,created_at,started_at,task_ids) VALUES (?,?,'started','A tyre page','[]',?,?,?)", f.id, weekOf(Date.now()), Date.now(), Date.now(), JSON.stringify(ids));
    const p = await openRoom(boss.slug);
    const before = await p.ev('JSON.stringify(window.__office.view.whiteboard)');
    run(t.db, "UPDATE tasks SET status='done', updated_at=? WHERE id=?", Date.now(), ids[0]);
    t.app.engine.emitTask(ids[0]);
    await p.until(`window.__office.view.whiteboard?.done === 1`, 'the tick', 20000);
    const after = await p.ev('({ wb: window.__office.view.whiteboard, map: !!window.__office.view.boardMat.map?.image })');
    const b = JSON.parse(before);
    check(b?.title === 'A tyre page' && b.rows.length === 3 && b.done === 0, `j41 the board lists the plan's 3 jobs (${b?.rows.map((r) => r.title).join(', ')})`);
    check(after.wb.rows[0].tick && !after.wb.rows[1].tick && after.map, `j41 the first job ticks the moment its task is done (${after.wb.done} of ${after.wb.total})`);
    if (shots) {
      await p.ev('(() => { const v = window.__office.view; v.targetYaw = v.yaw = 0.2; v.targetZoom = v.zoom = 3.4; v.targetPan.set(v.plan.board, v.plan.boardZ + 4); v.pan.copy(v.targetPan); })()');
      await sleep(2500); await p.shot(`${shots}/r2-j41-whiteboard.jpg`);
    }
    check(!p.errors.length, `j41 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
  if (want('j42')) {
    // r2-j42: a bean with 3 queued jobs has 3 sheets; floor 6 shows the 1,000-visit trophy.
    const six = await claim(t, 'Tyre Trophies', { floor: 7 });
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', six.slug);
    const builder = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='builder'", f.id);
    for (const x of ['One', 'Two', 'Three']) run(t.db, "INSERT INTO tasks (floor_id,title,brief,agent_id,status,created_at,updated_at) VALUES (?,?,?,?,'todo',?,?)", f.id, x, x, builder.id, Date.now(), Date.now());
    publish(t.db, f.id, 'tyres', 'Tyres', Date.now() - 86400000);
    run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'tyres','2026-11-01','/',2241,2241)", f.id);
    const p = await openRoom(six.slug);
    const r = await p.ev(`(() => { const v = window.__office.view; const b = v.actors.get(${builder.id}); const others = [...v.actors.values()].filter((a) => a !== b && !a.isBoss && !a.extra).map((a) => a.pileCount); return { sheets: b.pileCount, shown: b.pile.children.filter((m, i) => i && m.visible).length, others, low: v.low, trophies: v.trophies, cups: v.trophyCups }; })()`);
    check(r.sheets === (r.low ? 1 : 3) && r.shown === r.sheets && r.others.every((n) => n === 0), `j42 the Builder with 3 queued jobs has ${r.shown} sheet${r.shown === 1 ? '' : 's'}${r.low ? ' (phone low: one flat sheet)' : ''}; empty trays elsewhere (${r.others.join(',')})`);
    check(r.trophies.includes('visits-1000') && !r.trophies.includes('visits-10000') && r.cups === 3, `j42 the shelf has the 1,000-visit trophy (${r.trophies.join(', ')})`);
    // With the room at mid detail, the same desk shows all 3 sheets.
    const mid = await p.ev(`(() => { const v = window.__office.view; const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(v), 'low'); Object.defineProperty(v, 'low', { value: false, configurable: true }); const b = v.actors.get(${builder.id}); b.showPile(3); const n = b.pile.children.filter((m, i) => i && m.visible).length; delete v.low; return n; })()`);
    check(mid === 3, `j42 at full detail the same desk shows 3 sheets (${mid})`);
    if (shots) {
      await p.ev(`(() => { const v = window.__office.view; const b = v.actors.get(${builder.id}); v.targetYaw = v.yaw = 0.6; v.targetZoom = v.zoom = 3.6; v.targetPan.set(b.pile.position.x, b.pile.position.z); v.pan.copy(v.targetPan); })()`);
      await sleep(2500); await p.shot(`${shots}/r2-j42-pile.jpg`);
      await p.ev('(() => { const v = window.__office.view; v.targetYaw = v.yaw = 1.35; v.targetZoom = v.zoom = 3.6; const g = v.trophyGroup.position; v.targetPan.set(g.x + 3, g.z); v.pan.copy(v.targetPan); })()');
      await sleep(2500); await p.shot(`${shots}/r2-j42-trophies.jpg`);
    }
    check(!p.errors.length, `j42 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
  if (want('j44')) {
    // r2-j44: the phone room stays under 60,000 triangles and 2 MB of 3D files; 30 fps cap, pixel ratio 1.5, one shadow light.
    const boss = await claim(t, 'Phone Limits');
    const p = await b.newPage({ phone: { width: 390, height: 844 } });
    await p.send('Network.setCacheDisabled', { cacheDisabled: true });
    await p.goto(`${base}/floor/${boss.slug}`);
    await p.room();
    await p.until('!!window.__office?.view?.manager && !!window.__office.view.limits', 'the phone room', 120000);
    await sleep(6000);  // furniture arrives and the limits are fitted again
    const r = await p.ev(`(() => {
      const v = window.__office.view, st = window.__stage;
      let tris = 0; v.scene.traverseVisible((o) => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count / 3 : g.attributes.position.count / 3) * (o.isInstancedMesh ? o.count : 1); } });
      let shadowLights = 0; v.scene.traverse((o) => { if (o.isLight && o.castShadow) shadowLights++; });
      const THREE_D = /three\\.module|addons\\.module|\\/js\\/(stage|stage-start|lobby-scene|tower-nav|office-scene|cast|character|portrait|floor-ui|life|layouts|offices|labels|cutaway|toon|framing|batch|models|textures|room-rules)\\.js|\\.glb|\\/models\\/|\\/assets\\/(3d|tex)\\//;
      const files = performance.getEntriesByType('resource').filter((e) => THREE_D.test(e.name));
      return { tris: Math.round(tris), limits: v.limits, shadowLights, dpr: st.renderer.getPixelRatio(), cap: st.fpsCap, bytes: files.reduce((n, e) => n + (e.decodedBodySize || e.transferSize || 0), 0), files: files.length };
    })()`);
    const f0 = await p.ev('window.__stage.drawn'); await sleep(3000); const f1 = await p.ev('window.__stage.drawn');
    const fps = (f1 - f0) / 3;
    check(r.tris <= 60000, `j44 the phone room is ${r.tris} triangles, under 60,000 (shed ${r.limits.shed.join(', ') || 'nothing'} from ${r.limits.before})`);
    check(r.bytes <= 2 * 1024 * 1024 && r.files > 5, `j44 its 3D files are ${(r.bytes / 1048576).toFixed(2)} MB uncompressed over ${r.files} files, under 2 MB`);
    check(r.cap === 30 && fps <= 31, `j44 it draws at most 30 frames a second (${fps.toFixed(1)} drawn)`);
    check(r.dpr <= 1.5, `j44 pixel ratio ${r.dpr} on a 2x phone, at most 1.5`);
    check(r.shadowLights <= 1, `j44 ${r.shadowLights} shadow light`);
    if (shots) await p.shot(`${shots}/r2-j44-phone.jpg`);
    // A phone the stage would put on its top tier still draws at 1.5, not 2.
    const hi = await b.newPage({ phone: { width: 390, height: 844 } });
    await hi.goto(`${base}/floor/${boss.slug}?q=high`); await hi.room();
    await hi.until('!!window.__office?.view?.manager', 'the room on the top tier', 120000);
    const h = await hi.ev('({ tier: window.__stage.tier, dpr: window.__stage.renderer.getPixelRatio(), cap: window.__stage.fpsCap })');
    check((h.tier !== 'high' || h.dpr === 1.5) && h.cap === 30, `j44 on the top tier a 2x phone still draws at ${h.dpr} (tier ${h.tier}), capped at ${h.cap} fps`);
    check(!p.errors.length, `j44 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
  if (want('j45')) {
    // r2-j45: a slow test phone lands on low and shows no shadows; under 15 fps on low it gets a still picture with a note.
    const boss = await claim(t, 'Slow Phone');
    const p = await b.newPage({ phone: { width: 390, height: 844 } });
    await p.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.goto(`${base}/floor/${boss.slug}`); await p.room();
    await p.until('window.__stage.quality !== undefined', 'the frame test', 120000);
    const r = await p.ev('({ q: window.__stage.quality, fps: window.__stage.qualityFps, tier: window.__stage.tier, shadows: window.__stage.renderer.shadowMap.enabled, sun: !!window.__office?.view?.sun?.castShadow, steps: window.__stage.steps })');
    check(r.q === 'low' && r.tier === 'low' && !r.shadows && !r.sun, `j45 the slow phone's frame test (${r.fps?.toFixed(1)} fps) puts it on low, with no shadows (${r.steps.join(', ')})`);
    await p.until('!!document.querySelector(".room-still img")', 'the still picture', 60000);
    const st = await p.ev('({ note: document.querySelector(".room-still-note")?.textContent, paused: window.__stage.paused, img: document.querySelector(".room-still img").naturalWidth })');
    check(st.paused && st.img > 0 && /too slow for the moving room/.test(st.note), `j45 still too slow on low: a still picture of the room (${st.img}px wide) and the note`);
    if (shots) await p.shot(`${shots}/r2-j45-still.jpg`);
    await p.click('.room-still-note .btn');
    const back = await p.ev('({ still: !!document.querySelector(".room-still"), paused: window.__stage.paused })');
    check(!back.still && !back.paused, 'j45 Try the moving room brings it back');
    check(!p.errors.length, `j45 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
  if (want('j46')) {
    // r2-j46: the desktop camera eases to a real handoff and back, and stops after a drag.
    const boss = await claim(t, 'Camera Floor');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    const [a, m] = [get(t.db, "SELECT id FROM agents WHERE floor_id=? AND role='builder'", f.id).id, get(t.db, "SELECT id FROM agents WHERE floor_id=? AND role='manager'", f.id).id];
    const p = await openRoom(boss.slug);
    await sleep(2500);
    const sw = await p.ev('({ on: document.querySelector(".follow-switch")?.getAttribute("aria-pressed"), text: document.querySelector(".follow-switch")?.textContent })');
    t.app.engine.emit(f.id, 'handoff', { from: a, to: m, kind: 'paper' });
    await p.until('(window.__office.view.followed || []).length === 1', 'the follow', 20000);
    const track = await p.ev(`(() => { const v = window.__office.view; const out = []; const home = v.camera.position.clone(); for (let i = 0; i < 60; i++) { v.update(0.1); out.push([Math.round(v.followK * 100) / 100, Math.round(v.camera.position.distanceTo(home) * 10) / 10]); } return out; })()`);
    const ks = track.map((x) => x[0]), peak = Math.max(...ks);
    check(sw.on === 'true' && /Following the work/.test(sw.text), `j46 the switch reads "${sw.text}"`);
    check(peak === 1 && ks.at(-1) === 0 && Math.max(...track.map((x) => x[1])) > 1, `j46 the camera eases to the real handoff and back (k ${ks.filter((_, i) => i % 6 === 0).join(' ')})`);
    // A drag: the camera is the visitor's, Follow goes off, and the next handoff is not followed.
    await p.drag(700, 500, 900, 520);
    const off = await p.ev('({ on: window.__office.view.follow.on, pressed: document.querySelector(".follow-switch")?.getAttribute("aria-pressed") })');
    await p.ev('window.__office.view.follow.lastAt = -1e9');
    t.app.engine.emit(f.id, 'handoff', { from: a, to: m, kind: 'paper' });
    await sleep(2500);
    const n = await p.ev('(window.__office.view.followed || []).length');
    check(!off.on && off.pressed === 'false' && n === 1, `j46 after a drag Follow is off (switch pressed ${off.pressed}) and the next handoff is not followed (${n})`);
    await p.click('.follow-switch');
    check(await p.ev('window.__office.view.follow.on'), 'j46 the switch turns Follow back on');
    check(!p.errors.length, `j46 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
    // A phone left alone drifts; it never follows.
    const ph = await b.newPage({ phone: { width: 390, height: 844 } });
    await ph.goto(`${base}/floor/${boss.slug}?q=mid`); await ph.room();
    await ph.until('!!window.__office?.view?.manager', 'the phone room', 120000);
    const d = await ph.ev(`(() => { const v = window.__office.view; v.lastInputAt = v.time; const yaws = []; for (let i = 0; i < 160; i++) { v.update(0.1); yaws.push(Math.atan2(v.camera.position.x - v.pan.x, v.camera.position.z - v.pan.y)); } return { follow: v.follow.allowed, drift: v.driftOn, early: Math.abs(yaws[70] - yaws[0]), late: Math.abs(yaws[159] - yaws[90]) * 180 / Math.PI }; })()`);
    check(!d.follow && d.drift && d.early < 0.01 && d.late > 5, `j46 a phone never follows; left alone 8 s it drifts (${d.late.toFixed(1)} degrees in the next 7 s)`);
  }
  if (want('j48')) {
    // r2-j48: an idle floor offers "Replay" and plays its last real job in under 60 s with a visible Replay label.
    const boss = await claim(t, 'Replay Room');
    await boss.post(`/api/floors/${boss.slug}/chat`, { text: 'go build tyre finder' });
    await waitDone(boss);
    await sleep(500);
    const p = await openRoom(boss.slug, {}, '?q=mid');
    await p.until('!!document.querySelector(".replay-offer")', 'the offer', 20000);
    const offer = await p.ev('document.querySelector(".replay-offer").textContent');
    const t0 = Date.now();
    await p.click('.replay-offer');
    await p.until('!!document.querySelector(".replay .replay-label")', 'the replay', 10000);
    const seen = [];
    while (Date.now() - t0 < 70000) {
      const r = await p.ev('({ label: document.querySelector(".replay .replay-label")?.textContent || null, visible: (() => { const el = document.querySelector(".replay-label"); if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== "hidden"; })(), done: document.querySelector(".replay")?.dataset.done === "true" || !window.__office.replay, played: window.__office.replay?.played?.length ?? null, mode: document.querySelector(".replay")?.dataset.mode })');
      seen.push(r);
      if (r.done) break;
      if (seen.length === 6 && shots) await p.shot(`${shots}/r2-j48-replay.jpg`);
      await sleep(1000);
    }
    await p.until('!!window.__office.lastReplay', 'the end of the replay', 30000);
    const lr = await p.ev('window.__office.lastReplay');
    const secs = (Date.now() - t0) / 1000;
    check(offer.includes('Watch how this was made'), `j48 the idle floor offers "${offer}"`);
    check(lr.finished && lr.played === lr.steps && lr.took < 60 && lr.length >= 30, `j48 the replay of the last real job played all ${lr.steps} real steps and finished in ${lr.took.toFixed(1)} s by its own clock (planned ${lr.length.toFixed(1)} s; ${secs.toFixed(0)} s by this slow test machine's)`);
    check(seen.some((x) => x.mode === 'room') && seen.filter((x) => !x.done).every((x) => x.visible && /^Replay · [A-Z][a-z]+day \d\d:\d\d$/.test(x.label)), `j48 the label "${seen[0].label}" was visible at every check (${seen.length})`);
    check(!p.errors.length, `j48 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
    // Phone low: the cards and the photos only, no room.
    const ph = await b.newPage({ phone: { width: 390, height: 844 } });
    await ph.goto(`${base}/floor/${boss.slug}?q=low`); await ph.room();
    await ph.until('!!document.querySelector(".replay-offer")', 'the phone offer', 60000);
    await ph.click('.replay-offer');
    await ph.until('!!document.querySelector(".replay")', 'the phone replay', 10000);
    const mode = await ph.ev('document.querySelector(".replay").dataset.mode');
    check(mode === 'cards', `j48 on phone low it is cards and photos only (${mode})`);
    if (shots) await ph.shot(`${shots}/r2-j48-phone-low.jpg`);
  }
  if (want('j58')) {
    // r2-j58: a launch that passes shows "CHECKED 8 of 8" on its plaque and card.
    const boss = await claim(t, 'Checked Tyres');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    publish(t.db, f.id, 'tyres', 'Tyres', Date.now() - 3600000);
    storeShot(t.db, { floorId: f.id, project: 'tyres', image: REAL_JPEG, url: 'https://tyres.example/' });
    const checks = ['speed', 'fits', 'links', 'form', 'preview', 'icon', 'notfound', 'https'].map((id) => ({ id, ok: true }));
    run(t.db, 'INSERT INTO launch_checklists (floor_id, project, result, checked_at) VALUES (?,?,?,?)', f.id, 'tyres', JSON.stringify({ checks, passed: 8, blocked: [], warnings: [] }), Date.now());
    const p = await openRoom(boss.slug);
    const plaque = await p.ev('window.__office.view.frameMeshes?.[0]?.userData.plaque?.userData.checked || null');
    check(plaque === '8/8', `j58 the frame in the room has its CHECKED 8 of 8 plaque (${plaque})`);
    if (shots) {
      await p.ev('(() => { const v = window.__office.view; const m = v.frameMeshes[0]; v.targetYaw = v.yaw = 1.3; v.targetZoom = v.zoom = 3.4; v.targetPan.set(m.position.x + 3, m.position.z); v.pan.copy(v.targetPan); })()');
      await sleep(2500); await p.shot(`${shots}/r2-j58-plaque.jpg`);
    }
    const w = await b.newPage({});
    await w.goto(`${base}/launched/${boss.slug}`);
    await w.until('!!document.querySelector(".lcard[data-project=tyres]")', 'the card', 60000);
    const stamp = await w.ev('document.querySelector(".lcard[data-project=tyres] .lcard-checked")?.textContent || null');
    check(stamp === 'CHECKED 8 of 8', `j58 the launch card reads "${stamp}"`);
    if (shots) await w.shot(`${shots}/r2-j58-card.jpg`);
    check(!p.errors.length && !w.errors.length, `j58 no page errors ${[...p.errors, ...w.errors].slice(0, 2).join(' | ')}`);
  }
  if (want('j60')) {
    // r2-j60: pasting a floor link into a chat app shows a 1,200 by 630 picture of that floor. Here this browser is the shots browser.
    const { imageSize } = await import('../../server/sharecards.js');
    const boss = await claim(t, 'Card Tyres');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    publish(t.db, f.id, 'tyres', 'Tyres', Date.now() - 3600000);
    storeShot(t.db, { floorId: f.id, project: 'tyres', image: REAL_JPEG, url: 'https://tyres.example/' });
    t.cfg.shotsCdpUrl = `http://127.0.0.1:${b.port}`; t.cfg.shotsOrigin = `http://localhost:${t.port}`;
    const row = await t.app.ext.shareCard(f, 'launch');
    const link = await (await fetch(`${base}/floor/${boss.slug}`)).text();
    const image = link.match(/<meta property="og:image" content="([^"]+)">/)?.[1] || '';
    const got = Buffer.from(await (await fetch(image)).arrayBuffer());
    const size = imageSize(got);
    check(row.type === 'image/jpeg' && size?.width === 1200 && size?.height === 630 && got.length < 200 * 1024, `j60 the floor link's preview picture is a real ${size?.width}x${size?.height} JPEG of the floor, ${Math.round(got.length / 1024)} KB`);
    check(/og:image:width" content="1200"/.test(link) && /og:title" content="Card Tyres: floor/.test(link), 'j60 the link carries the og tags a chat app reads');
    if (shots) { const { writeFileSync } = await import('node:fs'); writeFileSync(`${shots}/r2-j60-sharecard.jpg`, got); }
    t.cfg.shotsCdpUrl = ''; t.cfg.shotsOrigin = '';
  }
  if (want('j67')) {
    // r2-j67: bean cards show jobs finished and launches; the plaque shows launches and visits; no level appears anywhere.
    const boss = await claim(t, 'Count Room');
    await boss.post(`/api/floors/${boss.slug}/chat`, { text: 'go build soup finder' });
    await waitDone(boss);
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    const builder = get(t.db, "SELECT id FROM agents WHERE floor_id=? AND role='builder'", f.id).id;
    const p = await openRoom(boss.slug);
    const plaque = await p.ev('document.querySelector(".floor-counts")?.hidden ? null : document.querySelector(".floor-counts")?.textContent');
    check(/^\d+ launched · \d+ visits?$/.test(plaque || ''), `j67 the plaque reads "${plaque}"`);
    await p.ev(`window.__office.openAgent(window.__office.state.agents.find((a) => a.id === ${builder}))`);
    await p.until('!!document.querySelector(".id-counts")', 'the ID card', 10000);
    const card = await p.ev('({ counts: document.querySelector(".id-counts").textContent, all: document.querySelector(".profile").textContent })');
    check(/\d+ jobs? finished/.test(card.counts) && /\d+ launch(es)? worked on/.test(card.counts), `j67 the Builder's ID card reads "${card.counts}"`);
    check(!/\blevel\b|\blvl\b|\brank\b/i.test(card.all + plaque), 'j67 no level on the card or the plaque');
    if (shots) await p.shot(`${shots}/r2-j67-idcard.jpg`);
    check(!p.errors.length, `j67 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
  if (want('j69')) {
    // r2-j69: Colon approves a waiting library entry with one tap in admin.
    const boss = await claim(t, 'Library Floor');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    const { toolsForRole } = await import('../../server/tools.js');
    const m = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
    await t.app.engine.tools.exec(t.app.engine.toolCtx(f, m, null, toolsForRole('manager')), 'propose_library_entry', JSON.stringify({ title: 'Prices on the first screen', lane: 'website', lesson: 'Write to sales@library.example for the old list. Put prices where a phone sees them first.' }));
    const id = get(t.db, 'SELECT id FROM library_entries WHERE floor_id=?', f.id).id;
    const admin = await adminClient(t);
    const p = await b.newPage({});
    for (const [name, value] of Object.entries(admin.cookies)) await p.send('Network.setCookie', { name, value, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice' });
    await p.goto(`${base}/admin`);
    await p.until(`!!document.querySelector('[data-approve="${id}"]')`, 'the waiting entry', 30000);
    const shown = await p.ev(`document.querySelector('[data-library="${id}"]').textContent`);
    check(!shown.includes('@') && /\[removed\]/.test(shown) && /private detail/.test(shown), 'j69 the admin sees the entry scrubbed, with how much was taken out');
    if (shots) await p.shot(`${shots}/r2-j69-admin.jpg`);
    await p.click(`[data-approve="${id}"]`);
    await p.until(`!document.querySelector('[data-approve="${id}"]')`, 'the tap', 15000);
    check(get(t.db, 'SELECT status FROM library_entries WHERE id=?', id).status === 'approved', 'j69 one tap approves it');
    check(!p.errors.length, `j69 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
} finally {
  b.close(); await t.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
