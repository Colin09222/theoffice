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
    // r2-j55: an approval record exists only where Colon pressed Send out on the job (tasks.sent_out_at). Nothing else is ever "approved".
    const base = { type: i.type, number: i.number, kind: i.kind, floor: i.floor, approved: i.kind === 'contractor' && !!i.times?.sentOut };
    if (!was && i.state === 'open') out.push({ ...base, event: 'arrive', state: i.state });
    else if (was && !CLOSED.has(was.state) && was.state !== 'picked' && i.state === 'picked') out.push({ ...base, event: 'pickup', state: i.state });
    else if (was && !CLOSED.has(was.state) && CLOSED.has(i.state)) {
      out.push({ ...base, event: 'close', state: i.state });
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

// r2-j52: stamps and voice lines, section 3's list and nothing else. One bubble per event, 2.5 s. "Item was already finished" is left out: no
// record ever says so (a second decision on a help request or a contractor job is refused with an error and stored nowhere), and "Purchase
// flagged to Colon" has no record either. Asleep and Away are signs, not bubbles (mailroom-state.js SIGN).
export const STAMPS = { answered: 'ANSWERED', bought: 'BOUGHT', done: 'DONE', declined: 'DECLINED', expired: 'EXPIRED' };
export const APPROVED_STAMP = 'COLON APPROVED';
export const VOICE_LINES = ['Answered.', 'Not this one.', 'Bought.', 'Approved.', 'On it.', 'Done.'];
/** The stamp an event brings down, or '' for none. */
export const stampFor = (ev) => (ev?.event === 'close' ? STAMPS[ev.state] || '' : '');
/** The small COLON APPROVED stamp: only on an item with an approval record (Colon's Send out), when it arrives. */
export const approvedStampFor = (ev) => (ev?.event === 'arrive' && ev.approved === true ? APPROVED_STAMP : '');
/** The one line an event may say, or '' (help expired: stamp only). */
export function lineFor(ev) {
  if (!ev) return '';
  if (ev.event === 'close') {
    if (ev.kind === 'help') return ev.state === 'answered' ? 'Answered.' : ev.state === 'declined' ? 'Not this one.' : '';
    if (ev.kind === 'purchase') return ev.state === 'bought' ? 'Bought.' : ev.state === 'declined' ? 'Not this one.' : '';
    if (ev.kind === 'contractor') return ev.state === 'done' ? 'Done.' : '';
  }
  if (ev.event === 'pickup' && ev.kind === 'contractor') return 'On it.';
  if (ev.event === 'arrive' && ev.approved === true) return 'Approved.';
  return '';
}
