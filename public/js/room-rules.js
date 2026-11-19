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
