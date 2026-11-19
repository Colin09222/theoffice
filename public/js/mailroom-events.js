// The mailroom's events (round 2, r2-j51 to r2-j56; docs/redesign/OFFICE-ANSWERS-2.md, Q18, Q22 and section 3 "Animations and their triggers").
// The page reads /api/mailroom every few seconds and compares it with what it read before: an item that appears is a folder on its way down;
// an item that closes gets its stamp; a contractor job handed back rides the lift. The FIRST reading makes no events at all: a visitor who
// arrives late sees the current state only, and nothing is replayed (Q18).
//
// Every event carries its record type and number (Q22), and the player refuses one without them: the truth test (r2-j56) holds every
// animation to that. No DOM and no three.js here.

export const WALK_S = 4, TUBE_S = 1.5, STAMP_S = 0.6, BUBBLE_S = 2.5, LIFT_S = 8;
const CLOSED = new Set(['answered', 'declined', 'expired', 'bought', 'done']);
const key = (i) => `${i.type}:${i.number}`;

/** Events between two readings of the feed. `prev` null (the first reading) gives none. */
export function diffFeed(prev, next) {
  if (!prev) return [];
  const before = new Map((prev.items || []).map((i) => [key(i), i]));
  const out = [];
  for (const i of next.items || []) {
    const was = before.get(key(i));
    const base = { type: i.type, number: i.number, kind: i.kind, floor: i.floor };
    if (!was && i.state === 'open') out.push({ ...base, event: 'arrive', state: i.state });
    else if (was && !CLOSED.has(was.state) && was.state !== 'picked' && i.state === 'picked') out.push({ ...base, event: 'pickup', state: i.state });
    else if (was && !CLOSED.has(was.state) && CLOSED.has(i.state)) {
      out.push({ ...base, event: 'close', state: i.state, approved: !!i.approved });
      if (i.kind === 'contractor' && i.state === 'done') out.push({ ...base, event: 'handback', state: i.state });
    }
  }
  return out;
}

/** An event may play only with a record type and a real record number. */
export const playable = (ev) => !!ev && typeof ev.type === 'string' && ev.type.length > 0 && Number.isSafeInteger(ev.number) && ev.number > 0;

/**
 * Plays events one at a time through `play(ev)` (which returns how long it takes, in seconds). Anything without a record type and number is
 * refused and counted, never played. `played` keeps what really played, for the tests.
 */
export class EventPlayer {
  constructor(play) { this.play = play; this.queue = []; this.busy = 0; this.played = []; this.refused = 0; }
  push(ev) {
    if (!playable(ev)) { this.refused++; return false; }
    this.queue.push(ev); return true;
  }
  update(dt) {
    if (this.busy > 0) { this.busy -= dt; return; }
    const ev = this.queue.shift();
    if (!ev) return;
    this.played.push(ev);
    this.busy = Math.max(0, Number(this.play(ev)) || 0);
  }
}
