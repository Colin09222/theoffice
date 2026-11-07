// Who walks where, and what they say when they get there. Real talk events from the server become little scenes: the speaker walks over
// through the doors, says the real line in a bubble, and goes back to their own room. Idle people take breaks in the kitchen and the lounge.
// No three.js in here, so the rules can be run in plain Node with stand-ins for the people.
import { roomOfKind, roomAt } from './layouts.js';

const READ_MIN = 2.6, READ_MAX = 8, CHARS_PER_SEC = 15;   // long enough to read, short enough to keep up with a busy floor
const QUEUE_MAX = 3;    // lines someone can have waiting to act out; beyond that the oldest stays in the Talk tab only
const HOLD_ASSIGN = 0.9;  // a batch of assignments waits this long, in room time, for the meeting that usually follows it
const CARRIES = new Set(['assign', 'handoff', 'findings', 'review']);

export const readingTime = (text) => Math.max(READ_MIN, Math.min(READ_MAX, String(text).length / CHARS_PER_SEC));

/**
 * Real progress for a task pill: how many tasks in the run of neighbouring tasks on this plan are finished. Nothing is estimated; a task with
 * no plan to count against, or the only one on it, shows no number. A task with the manager counts, since the staff member has finished it.
 */
export function planProgress(tasks, task) {
  if (!task?.plan) return null;
  const i = tasks.findIndex((t) => t.id === task.id);
  if (i < 0) return null;
  let a = i, b = i;
  while (a > 0 && tasks[a - 1].plan === task.plan) a--;
  while (b < tasks.length - 1 && tasks[b + 1].plan === task.plan) b++;
  const run = tasks.slice(a, b + 1).filter((t) => t.status !== 'cancelled');
  if (run.length < 2) return null;
  return { done: run.filter((t) => t.status === 'done' || t.status === 'review').length, total: run.length };
}

// Small talk between two idle people. It costs nothing, comes from nothing, and never claims any work happened: the test keeps it that way.
export const SMALL_TALK = [
  ['Coffee?', 'Always.'], ['Is it Friday yet?', 'Sadly not.'], ['Who keeps moving my mug?', 'Not me.'], ['Nice view today.', 'You can see the harbour.'],
  ['Biscuit?', 'Go on then.'], ['Weekend plans?', 'Sleep, mostly.'], ['Is this the good milk?', 'There is only one milk.'], ['Did you water that plant?', 'I thought you did.'],
  ['Crossword?', 'Seven across beat me.'], ['Lift working again?', 'It took me the long way.'], ['Is it cold in here?', 'Just this corner.'], ['Tea or coffee?', 'Whichever is hot.'],
];

export class FloorLife {
  constructor(view, { onSmallTalk = null } = {}) {
    this.view = view; this.onSmallTalk = onSmallTalk;
    this.held = []; this.holdUntil = 0;
    this.queues = new Map();  // speaker -> events waiting to be acted out
    this.seen = new Set();    // pairs that spoke a moment ago, so a paper handoff doesn't play a second time
  }
  get people() { return this.view.actors; }

  /** A fresh talk event from the server. Assignments wait a beat in case a meeting claims them. */
  line(ev) {
    const speaker = this.people.get(ev.from);
    if (!speaker) return;
    this.seen.add(`${ev.from}>${ev.to}`);
    if (ev.kind === 'assign' || ev.kind === 'plan') { this.held.push(ev); this.holdUntil = this.view.time + HOLD_ASSIGN; return; }
    this.enqueue(ev);
  }
  enqueue(ev) {
    const q = this.queues.get(ev.from) || [];
    q.push(ev);
    while (q.length > QUEUE_MAX) q.shift();
    this.queues.set(ev.from, q);
    // Whatever they are doing now, they have the paper in their hand until they get to hand it over.
    const paper = CARRIES.has(ev.kind) && this.people.get(ev.from)?.char?.paper;
    if (paper) paper.visible = true;
  }
  /** Someone finished a scene or a step list and is free for the next line. */
  release(actor) { this.view.claims.delete(actor); }
  update() {
    if (this.held.length && this.view.time >= this.holdUntil) { for (const ev of this.held) if (ev.to || ev.kind === 'plan') this.enqueue(ev); this.held = []; }
    for (const [id, q] of this.queues) {
      if (!q.length) { this.queues.delete(id); continue; }
      const a = this.people.get(id);
      if (!a) { this.queues.delete(id); continue; }
      if (a.scene) continue;
      this.playLine(a, q.shift(), q.length);
    }
  }
  /** One line: over to the listener and said to their face, or said from here when there is a real backlog to get through. */
  playLine(a, ev, backlog) {
    const to = ev.to ? this.people.get(ev.to) : null;
    const steps = [];
    const hold = readingTime(ev.text);
    if (to && to !== a && backlog < 2) {
      const near = to.seated ? to.seat : { at: [to.group.position.x, to.group.position.z] };
      const spot = this.view.visitSpot(near, a);
      this.view.claims.set(a, spot.at);
      if (CARRIES.has(ev.kind)) steps.push({ anim: 'stand', hold: 0.15, paper: true });
      steps.push({ walk: spot.at });
      steps.push({ anim: 'talk', say: ev.text, to: ev.to, hold, paper: false, small: ev.kind === 'small' });
      steps.push({ anim: 'stand', hold: 0.5 });
    } else {
      steps.push({ say: ev.text, to: ev.to, hold, paper: false, small: ev.kind === 'small' });
    }
    a.perform(steps, { scene: true });
  }
  /** A paper handed over with no words attached: filler floors and old events. Skipped when the words already covered it. */
  handoff(fromId, toId) {
    const key = `${fromId}>${toId}`;
    if (this.seen.delete(key)) return;
    const a = this.people.get(fromId), b = this.people.get(toId);
    if (!a || !b || a === b) return;
    const near = b.seated ? b.seat : { at: [b.group.position.x, b.group.position.z] };
    const v = this.view.visitSpot(near, a);
    this.view.claims.set(a, v.at);
    a.perform([{ anim: 'stand', hold: 0.1, paper: true }, { walk: v.at }, { anim: 'talk', hold: 1.2, paper: false, face: v.face }], { scene: true });
  }
  /**
   * The whole batch in the meeting room. Everyone walks in, the manager waits at the board until they're there, reads out the real plan and
   * assignments that arrived with this meeting, and then everyone goes back to their own room. With no lines to read, it's a short talk.
   */
  meeting(managerId, staffIds) {
    const { stand, spots } = this.view.plan.meet;
    const m = this.people.get(managerId);
    const lines = this.held.filter((e) => e.from === managerId).sort((a, b) => (b.kind === 'plan') - (a.kind === 'plan')); this.held = this.held.filter((e) => e.from !== managerId);
    const crew = staffIds.map((id) => this.people.get(id)).filter(Boolean);
    const cx = spots.reduce((n, p) => n + p[0], 0) / spots.length, cz = spots.reduce((n, p) => n + p[1], 0) / spots.length;
    const toTeam = Math.atan2(cx - stand[0], cz - stand[1]);
    const toBoard = Math.atan2(this.view.plan.board - stand[0], -6.8 - stand[1]);
    let over = false;
    const here = (a, at) => a.dead || (!a.path.length && Math.hypot(a.group.position.x - at[0], a.group.position.z - at[1]) < 1.2);
    const places = crew.map((a, i) => [a, spots[i % spots.length]]);
    const gathered = () => places.every(([a, at]) => here(a, at)) && (!m || here(m, stand));
    const talkTime = lines.reduce((n, e) => n + readingTime(e.text), 0) || 6;
    const finish = { run: () => { over = true; } };
    if (m) {
      const steps = [{ walk: stand }, { anim: 'stand', hold: 14, until: gathered, face: toTeam }];
      if (lines.length) for (const e of lines) steps.push({ anim: 'talk', say: e.text, to: e.to, hold: readingTime(e.text), face: toTeam });
      else steps.push({ anim: 'talk', hold: 2.4, face: toTeam }, { anim: 'talk', hold: 1.6, face: toBoard }, { anim: 'talk', hold: 2.0, face: toTeam });
      steps.push(finish);
      m.perform(steps, { scene: true });
    } else over = true;
    for (const [a, sp] of places) {
      const face = Math.atan2(stand[0] - sp[0], stand[1] - sp[1]);
      a.perform([{ walk: sp }, { anim: 'listen', hold: 16 + talkTime, until: () => over, face }], { scene: true });
    }
  }

  // ---- breaks ----
  /** An open place to stand in a room, not on top of anyone. */
  openSpot(kind, actor) {
    const room = roomOfKind(this.view.plan, kind);
    const spots = room?.spots || [];
    const taken = [...this.view.claims.entries()].filter(([who]) => who !== actor).map(([, c]) => c);
    const free = spots.filter(([x, z]) => taken.every((c) => Math.hypot(c[0] - x, c[1] - z) > 0.8));
    const from = free.length ? free : spots;
    return from.length ? from[Math.floor(Math.random() * from.length)] : null;
  }
  /** Off to a break, an errand, or a word with a colleague who's also free. The odd stretch at the desk keeps it from being a procession. */
  errand(a) {
    const d = this.view.decor; const L = this.view.plan; const v = this.view;
    const kitchen = d.coffee ? this.openSpot('kitchen', a) : null;
    const lounge = this.openSpot('lounge', a);
    const options = [];
    if (kitchen) options.push(() => this.go(a, kitchen, 'sip', 5 + Math.random() * 6));
    if (lounge) options.push(() => this.go(a, lounge, 'phone', 7 + Math.random() * 9));
    if (d.arcade) options.push(() => a.perform([{ walk: [L.arcade[0] + 1.0, L.arcade[1]] }, { anim: 'phone', hold: 3, face: -Math.PI / 2 }], { offDuty: true }));
    const plant = v.plantSpots[Math.floor(Math.random() * v.plantSpots.length)];
    if (plant) options.push(() => a.perform([{ walk: [plant[0] + plant[2], plant[1] + plant[3]] }, { anim: 'pour', hold: 3, face: Math.atan2(-plant[2], -plant[3]) }], { offDuty: true }));
    options.push(() => a.perform([{ walk: [L.shelf[0] + 1.0, L.shelf[1] + (Math.random() - 0.5) * 1.5] }, { anim: 'listen', hold: 2.5, face: -Math.PI / 2 }], { offDuty: true }));
    options.push(() => this.chat(a) || this.go(a, kitchen || lounge, kitchen ? 'sip' : 'phone', 6));
    options.push(() => a.perform([{ anim: 'stretch', hold: 2.4 }]));
    const pick = options[Math.floor(Math.random() * options.length)];
    pick();
  }
  go(a, spot, anim, hold) {
    if (!spot) { a.perform([{ anim: 'stretch', hold: 2.4 }]); return; }
    this.view.claims.set(a, [spot[0], spot[1]]);
    a.perform([{ walk: [spot[0], spot[1]] }, { anim, hold, face: spot[2] ?? 0 }], { offDuty: true });
  }
  /** Two free people meet in the kitchen or the lounge for a word. Returns false when nobody is free to talk to. */
  chat(a) {
    if (a.isBoss) return false;
    const free = [...this.people.values()].filter((o) => o !== a && !o.isBoss && o.state === 'idle' && o.seated && !o.action && !o.scene);
    const b = free[Math.floor(Math.random() * free.length)];
    if (!b) return false;
    const kind = this.view.decor.coffee && Math.random() < 0.6 ? 'kitchen' : 'lounge';
    const sa = this.openSpot(kind, a);
    if (!sa) return false;
    this.view.claims.set(a, [sa[0], sa[1]]);
    const sb = this.openSpot(kind, b);
    if (!sb || sb === sa) { this.view.claims.delete(a); return false; }
    this.view.claims.set(b, [sb[0], sb[1]]);
    const [one, two] = SMALL_TALK[Math.floor(Math.random() * SMALL_TALK.length)];
    const there = (who, at) => !who.path.length && Math.hypot(who.group.position.x - at[0], who.group.position.z - at[1]) < 0.6;
    let together = false;
    const met = () => { together ||= there(a, sa) && there(b, sb); return together; };
    const alone = () => !together;  // called back to work before they met: nobody is left talking to thin air
    const facing = (p, q) => Math.atan2(q[0] - p[0], q[1] - p[1]);
    const log = (who, to, text) => ({ unless: alone, run: () => this.onSmallTalk?.({ from: who.id, to: to.id, fromName: who.info.name, toName: to.info.name, text, kind: 'small', ts: Date.now() }) });
    const wait = 14;
    a.perform([{ walk: [sa[0], sa[1]] }, { anim: 'stand', hold: wait, until: met, face: facing(sa, sb) }, log(a, b, one), { unless: alone, anim: 'talk', say: one, to: b.id, small: true, hold: readingTime(one), face: facing(sa, sb) }, { unless: alone, anim: 'sip', hold: readingTime(two) + 1.5, face: facing(sa, sb) }], { offDuty: true });
    b.perform([{ walk: [sb[0], sb[1]] }, { anim: 'stand', hold: wait, until: met, face: facing(sb, sa) }, { unless: alone, anim: 'sip', hold: readingTime(one), face: facing(sb, sa) }, log(b, a, two), { unless: alone, anim: 'talk', say: two, to: a.id, small: true, hold: readingTime(two), face: facing(sb, sa) }, { unless: alone, anim: 'stand', hold: 1.2, face: facing(sb, sa) }], { offDuty: true });
    return true;
  }
  /** Which room someone is standing in, by id. Read by the tests and handy when debugging a stuck person. */
  roomOf(actor) { return roomAt(this.view.plan, actor.group.position.x, actor.group.position.z)?.id || null; }
}
