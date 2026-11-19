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
