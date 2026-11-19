// The floor room's round 2 rules (docs/redesign/OFFICE-ANSWERS-2.md), kept apart from three.js so plain Node can test every one of them with a
// fake clock and fake records. The room (office-scene.js, life.js) asks these what to show; nothing in here draws, fetches or calls a model.

// ---- r2-j31: lived-in idle floors (Q4's idle rule) ----
/** The four idle moves: sit in the lounge, stand at the kettle, read, stretch. Each lasts 4 to 8 s; one bean moves every 10 to 20 s. */
export const IDLE = { MOVES: ['lounge', 'kettle', 'read', 'stretch'], HOLD: [4, 8], GAP: [10, 20], FIRST: [2, 5] };

/**
 * An Idle floor: the server says Idle (or Paused: nobody works on a paused floor either) and nobody in the room is at work right now.
 * Waiting on boss and Working floors are not idle; they get their own poses (r2-j39).
 */
export function floorIsIdle(floorState, people) {
  if (floorState !== 'idle' && floorState !== 'paused') return false;
  for (const p of people) if (p.state && p.state !== 'idle') return false;
  return true;
}

/**
 * The floor's idle rounds: one bean at a time gets one of the four moves, every 10 to 20 s of room time while the floor stays Idle. The clock
 * restarts whenever the floor gets work. The first move after a quiet spell is called 2 to 5 s in, so even after a long walk across the floor (about 13 s) it is playing
 * within 20 s. Pure: the caller acts it out.
 */
export class IdleRounds {
  constructor({ rand = Math.random } = {}) { this.rand = rand; this.nextAt = null; this.last = new Map(); }
  gap() { const [a, b] = IDLE.GAP; return a + this.rand() * (b - a); }
  /**
   * `time` is room time in seconds; `candidates` the beans free to move ({ id, seated }); `kitchen` whether there is a kettle to stand at.
   * Returns { who, move, hold } when it is someone's turn, otherwise null.
   */
  tick(time, idle, candidates, { kitchen = true } = {}) {
    if (!idle) { this.nextAt = null; return null; }
    if (this.nextAt === null) { const [a, b] = IDLE.FIRST; this.nextAt = time + a + this.rand() * (b - a); return null; }
    if (time < this.nextAt) return null;
    this.nextAt = time + this.gap();
    if (!candidates.length) return null;
    const who = candidates[Math.floor(this.rand() * candidates.length)];
    // A stretch is done in the chair, so someone already up picks one of the others. Nobody does the same move twice running.
    const moves = IDLE.MOVES.filter((m) => (kitchen || m !== 'kettle') && (who.seated || m !== 'stretch') && m !== this.last.get(who.id));
    const move = moves[Math.floor(this.rand() * moves.length)] || 'read';
    this.last.set(who.id, move);
    const [lo, hi] = IDLE.HOLD;
    return { who, move, hold: lo + this.rand() * (hi - lo) };
  }
}

// ---- r2-j32: framed launches (Q5a) ----
/** One frame per real launch, newest first, at most 8 on the wall, then a "+N" tag. On phone low: at most 3, small. */
export const FRAMES = { MAX: 8, MAX_LOW: 3, PER_SPOT: 4, BIG: [1.8, 1.125], SMALL: [0.86, 0.54], GAP: 0.14 };

/**
 * Where each frame hangs. `spots` are the wall's picture spots (z along the wall, y the middle height), in the order they fill. With two launches
 * or fewer each gets a spot and hangs big; with more, each spot holds a 2 by 2 cluster of small ones. Returns { frames: [{ spot, dz, dy, w, h,
 * launch }], more } where `more` is how many real launches are not on the wall (shown as a "+N" tag), or 0.
 */
export function frameLayout(launches, { spots = 2, low = false } = {}) {
  const list = (launches || []).filter((l) => l && l.slug);
  const max = Math.min(low ? FRAMES.MAX_LOW : FRAMES.MAX, spots * FRAMES.PER_SPOT);
  const shown = list.slice(0, max);
  const out = [];
  if (!low && shown.length <= spots) {
    const [w, h] = FRAMES.BIG;
    shown.forEach((launch, i) => out.push({ spot: i, dz: 0, dy: 0, w, h, launch }));
  } else {
    const [w, h] = FRAMES.SMALL, g = FRAMES.GAP;
    shown.forEach((launch, i) => {
      const k = i % FRAMES.PER_SPOT, col = k % 2, row = Math.floor(k / 2);
      out.push({ spot: Math.floor(i / FRAMES.PER_SPOT), dz: (col - 0.5) * (w + g), dy: (0.5 - row) * (h + g), w, h, launch });
    });
    // A spot with a single small frame hangs it in the middle.
    for (const f of out) if (out.filter((o) => o.spot === f.spot).length === 1) { f.dz = 0; f.dy = 0; }
  }
  return { frames: out, more: Math.max(0, list.length - shown.length) };
}

// ---- r2-j39: state-true poses (Q4) ----
/** What kind of work each role's desk shows while they are on a job. Roles not here keep the plain poses of their state. */
export const WORK_KIND = { builder: 'building', designer: 'building', illustrator: 'building', researcher: 'researching', analyst: 'researching', writer: 'researching', tester: 'testing' };
export const GLANCE = { EVERY: 15, HOLD: 1.6 };

/**
 * A bean's pose from true things only: their own state, whether a task of theirs is running ('doing'), and the floor. Returns the seated
 * animation, the screen ('code', 'page', 'dim', 'saver' or 'off'), whether the monitor glows, and the desk prop ('papers', 'clipboard' or null).
 * On an Idle floor nobody types and every screen is off (r2-j31). A Builder on a running job types fast with the glow on, even while thinking.
 */
export function poseFor({ role = '', state = 'idle', running = false, floorIdle = false } = {}) {
  if (floorIdle) return { anim: 'sit', screen: 'off', glow: false, prop: null, fast: false };
  const kind = WORK_KIND[role] || null;
  const working = state !== 'idle' || running;
  if (!working) return { anim: 'sit', screen: 'saver', glow: false, prop: null, fast: false };
  if (kind === 'building') return { anim: state === 'talking' ? 'talk' : 'type', screen: 'code', glow: true, prop: null, fast: true };
  const anim = state === 'typing' || state === 'browsing' ? 'type' : state === 'talking' ? 'talk' : 'think';
  const screen = state === 'typing' ? 'code' : state === 'browsing' || state === 'reading' ? 'page' : 'dim';
  if (kind === 'researching') return { anim, screen, glow: screen !== 'dim', prop: 'papers', fast: false };
  if (kind === 'testing') return { anim: anim === 'type' ? 'type' : 'think', screen, glow: screen !== 'dim', prop: 'clipboard', fast: false };
  return { anim, screen, glow: screen !== 'dim', prop: null, fast: false };
}

/**
 * Waiting on boss: every 15 s each free bean glances at the boss's door for a moment. Each bean keeps its own offset so they don't turn as one.
 * True while `id`'s glance is on at room time `time`.
 */
export function glancing(time, id, floorState) {
  if (floorState !== 'waiting') return false;
  let h = 2166136261; for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const t = (time + ((h >>> 0) % 1000) / 1000 * GLANCE.EVERY) % GLANCE.EVERY;
  return t < GLANCE.HOLD;
}

// ---- r2-j40: result beats (Q4), real task events only ----
/** Cheer on a launch (2 s), a high five on a passed check (1.5 s), a slump on a failed one (1.5 s). */
export const BEATS = { launch: { anim: 'cheer', hold: 2 }, pass: { anim: 'five', hold: 1.5 }, fail: { anim: 'slump', hold: 1.5 } };

/**
 * Every animation the room plays for a real event carries its record: a type and a number (spec Q22). This is the one gate: anything without
 * both is refused, and the same record never plays twice. `ev` is { kind: 'launch' | 'check', passed, agent, record: { type, id } }.
 */
export class BeatGate {
  constructor() { this.played = new Set(); this.refused = 0; }
  plan(ev) {
    const r = ev?.record;
    if (!r || !r.type || r.id === undefined || r.id === null || r.id === '') { this.refused++; return null; }
    const key = `${r.type}:${r.id}`;
    if (this.played.has(key)) return null;
    let beat = null;
    if (ev.kind === 'launch') beat = { ...BEATS.launch, who: 'all' };
    else if (ev.kind === 'check' && ev.agent != null) beat = { ...(ev.passed ? BEATS.pass : BEATS.fail), who: ev.agent };
    if (!beat) { this.refused++; return null; }
    this.played.add(key);
    return { ...beat, record: { type: r.type, id: r.id } };
  }
}

// ---- r2-j41: the whiteboard plan (Q5b) ----
/**
 * The meeting room's whiteboard: the current plan's jobs, up to 5, one tick per job done. `board` is the snapshot's room.whiteboard; `tasks` are the
 * live tasks the page keeps, so a job ticks the moment its task is done, before the next snapshot. Null when there is no plan to show.
 */
export function whiteboardRows(board, tasks = []) {
  if (!board?.jobs?.length) return null;
  const live = new Map(tasks.map((t) => [t.id, t]));
  const rows = board.jobs.slice(0, 5).map((j) => {
    const status = live.get(j.id)?.status || j.status;
    return { id: j.id, title: j.title, status, tick: status === 'done', now: status === 'doing' };
  });
  return { title: board.goal || 'The plan', rows, done: rows.filter((r) => r.tick).length, total: rows.length };
}

// ---- r2-j42: paper piles and trophies (Q5c, Q5d) ----
/** One sheet per queued job, at most 5; an empty queue is an empty tray. On phone low: one flat sheet, or none. */
export const PILE_MAX = 5;
export function pileSheets(queued, { low = false } = {}) {
  const n = Math.max(0, Math.floor(queued || 0));
  return low ? Math.min(n, 1) : Math.min(n, PILE_MAX);
}
/** A bean's queue: their own tasks waiting to start ('todo'), from the tasks the page already has. */
export function queuedFor(tasks, id) {
  const me = String(id);
  return (tasks || []).filter((t) => t.status === 'todo' && String(t.agentId ?? t.agent_id) === me).length;
}
/** The four milestones, in order: a first launch, then 100, 1,000 and 10,000 real visits. Never more than these four on the shelf. */
export const MILESTONES = [
  { id: 'first-launch', label: 'First launch', test: (m) => m.launches >= 1 },
  { id: 'visits-100', label: '100 visits', test: (m) => m.visits >= 100 },
  { id: 'visits-1000', label: '1,000 visits', test: (m) => m.visits >= 1000 },
  { id: 'visits-10000', label: '10,000 visits', test: (m) => m.visits >= 10000 },
];
export function trophiesFor(milestones) {
  if (!milestones) return [];
  return MILESTONES.filter((m) => m.test(milestones)).map(({ id, label }) => ({ id, label })).slice(0, 4);
}

// ---- r2-j44: the phone's hard limits (Q9) ----
/** Once 3D loads on a phone: 30 fps cap, pixel ratio 1.5, one shadow light, 60,000 triangles, 2 MB of 3D files. */
export const PHONE_LIMITS = { fps: 30, dpr: 1.5, shadowLights: 1, triangles: 60000, bytes: 2 * 1024 * 1024 };

/**
 * What a phone room sheds to get under its triangle limit, in order, until it fits: `steps` are [name, triangles it saves] in the order they
 * may go (the city around the floor first, the room's own people never). Returns { shed: [names], left: triangles after }.
 */
export function shedPlan(total, steps, limit = PHONE_LIMITS.triangles) {
  const shed = []; let left = total;
  for (const [name, saves] of steps) {
    if (left <= limit) break;
    if (saves > 0) { shed.push(name); left -= saves; }
  }
  return { shed, left };
}
/** Visible triangles under a three.js object, the way the renderer would draw them (instanced meshes count every copy). */
export function trianglesOf(root) {
  let n = 0;
  root?.traverseVisible?.((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry, per = g.index ? g.index.count / 3 : (g.attributes?.position?.count || 0) / 3;
    n += per * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(n);
}
/** The phone's frame cap: whether a frame at `now` (ms) comes too soon after the last one drawn. A 3 ms slack keeps a 60 Hz screen at an even 30. */
export const skipFrame = (now, lastDraw, cap) => !!cap && now - (lastDraw ?? -1e9) < 1000 / cap - 3;
/** The pixel ratio a phone may draw at, under the limits. */
export const phoneDpr = (want, limited = true) => (limited ? Math.min(want, PHONE_LIMITS.dpr) : want);

// ---- r2-j45: auto quality (Q9) ----
/** Frame test 2 s, uncapped: 50 fps or more = high, 30 to 49 = medium, under 30 = low. Drop one level, once, under 24 fps for 5 s. Low still under
 * 15 fps for 5 s: a still picture of the room with a note. */
export const QUALITY = { TEST_MS: 2000, HIGH: 50, MID: 30, DROP_FPS: 24, STILL_FPS: 15, WINDOW_S: 5 };
export const levelFor = (fps) => (fps >= QUALITY.HIGH ? 'high' : fps >= QUALITY.MID ? 'mid' : 'low');
const DOWN = { high: 'mid', mid: 'low', low: 'low' };

/**
 * Watches the frames actually drawn after the frame test. Feed it each drawn frame's time (s); it answers at most one { drop: level } for the visit,
 * and { still: true } once the room is on low and still averaging under 15 fps over 5 s. Averages are over whole 5 s windows, so one slow frame
 * never moves anything.
 */
export class QualityWatch {
  constructor(level) { this.level = level; this.dropped = false; this.stilled = false; this.t0 = null; this.frames = 0; }
  frame(t) {
    if (this.t0 === null) { this.t0 = t; this.frames = 0; return null; }
    this.frames++;
    const span = t - this.t0;
    if (span < QUALITY.WINDOW_S) return null;
    const fps = this.frames / span;
    this.t0 = t; this.frames = 0;
    if (!this.dropped && this.level !== 'low' && fps < QUALITY.DROP_FPS) { this.dropped = true; this.level = DOWN[this.level]; return { drop: this.level, fps }; }
    if (this.level === 'low' && !this.stilled && fps < QUALITY.STILL_FPS) { this.stilled = true; return { still: true, fps }; }
    return null;
  }
  /** After "Try the moving room": watch again from scratch, still allowed once more. */
  reset() { this.stilled = false; this.t0 = null; this.frames = 0; }
}

// ---- r2-j46: camera follow (desktop) and idle drift (phones) (Q3) ----
/** Follow: 1.2 s ease in, 3 s hold, 1.2 s back, at most once every 20 s. Drift: after 8 s without input, 2 degrees a second, 15 degrees each way. */
export const CAMERA = { IN: 1.2, HOLD: 3, OUT: 1.2, EVERY: 20, DRIFT_AFTER: 8, DRIFT_SPEED: 2, DRIFT_SWING: 15 };
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Following the work on a desktop. A real event asks to be followed with its record and a place on the floor; the camera eases there, holds and
 * eases back. Any drag switches it off until the "Follow the work" switch is turned on again. Off entirely under reduce motion or on phone low.
 */
export class CameraFollow {
  constructor({ allowed = true } = {}) { this.allowed = allowed; this.on = true; this.lastAt = -Infinity; this.shot = null; }
  /** A real event at room time `t`. Returns true when the camera goes. */
  ask(t, ev) {
    if (!this.allowed || !this.on || !ev?.record?.type || ev.record.id == null || !ev.at) return false;
    if (this.shot && t < this.shot.t + CAMERA.IN + CAMERA.HOLD + CAMERA.OUT) return false;
    if (t - this.lastAt < CAMERA.EVERY) return false;
    this.lastAt = t; this.shot = { t, at: ev.at, record: ev.record };
    return true;
  }
  /** How far toward the event the camera is at room time `t` (0 home, 1 there), and where. */
  pose(t) {
    const s = this.shot; if (!s) return { k: 0, at: null };
    const u = t - s.t, { IN, HOLD, OUT } = CAMERA;
    if (u >= IN + HOLD + OUT) { this.shot = null; return { k: 0, at: null }; }
    const k = u < IN ? smooth(u / IN) : u < IN + HOLD ? 1 : smooth(1 - (u - IN - HOLD) / OUT);
    return { k, at: s.at, record: s.record };
  }
  /** Someone dragged the room: the camera is theirs, now and until they turn Follow back on. */
  drag() { this.on = false; this.shot = null; }
  set(on) { this.on = !!on; }
}
/**
 * The phone's idle drift: after 8 s with no input the camera swings gently, 2 degrees a second, 15 degrees either side of where it was left.
 * Returns the yaw offset in radians for `idle` seconds without input.
 */
export function driftYaw(idle, { allowed = true } = {}) {
  if (!allowed || idle <= CAMERA.DRIFT_AFTER) return 0;
  const deg = (idle - CAMERA.DRIFT_AFTER) * CAMERA.DRIFT_SPEED, w = CAMERA.DRIFT_SWING;
  const p = deg % (4 * w);  // a triangle wave: out to +15, back through 0 to -15, and home
  const d = p < w ? p : p < 3 * w ? 2 * w - p : p - 4 * w;
  return (d * Math.PI) / 180;
}

// ---- r2-j48: Replay (Q24 idea 1) ----
/** A replay lasts 30 to 60 s (planned at most 55), whatever the real job took. */
export const REPLAY = { MIN: 30, MAX: 55, PER_STEP: 1.6, END_HOLD: 2.5 };  // 55, not 60: a slow device's late timers still finish inside a minute

/**
 * The real events of one job, and its step photos, laid out on a 30 to 60 s replay: real order kept, real gaps squeezed (a long wait reads as a
 * longer pause, never an hour). Returns [{ at (s into the replay), ...item }] and the length. Items are { t (real ms), ... }.
 */
export function replayTimeline(items) {
  const list = [...(items || [])].filter((x) => Number.isFinite(x?.t)).sort((a, b) => a.t - b.t);
  if (!list.length) return { steps: [], length: 0 };
  const w = list.map((x, i) => (i ? 1 + Math.min(1.5, Math.log1p(Math.max(0, x.t - list[i - 1].t) / 1000) / 4) : 0));
  const total = w.reduce((n, x) => n + x, 0);
  const length = Math.min(REPLAY.MAX, Math.max(REPLAY.MIN, list.length * REPLAY.PER_STEP + REPLAY.END_HOLD));
  const span = length - REPLAY.END_HOLD - 1;
  let acc = 0;
  const steps = list.map((x, i) => { acc += w[i]; return { ...x, at: 1 + (total ? (acc / total) * span : 0) }; });
  return { steps, length };
}
/** "Replay · Tuesday 14:10": when the job happened, New York time, like the building's clock. */
export function replayLabel(ms, tz = 'America/New_York') {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(d);
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
  return `Replay · ${day} ${hm}`;
}
