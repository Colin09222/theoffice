// The stack's cutaways. Each occupied floor is drawn side-on with its front wall off, like a dollhouse: a back wall in the company's
// colours, a floor, desks with monitors, a meeting table, a plant and a door. The staff are little figures, their own ID-badge faces on
// simple bodies. No WebGL and no canvas: a room is a few DOM nodes painted once, the figures walk on CSS transitions so a phone's
// compositor does the moving, and the brain that says where they go next ticks a few times a second, for rooms on screen only.
// What they do comes from public floor data: who is at it, meetings, and the lines said out loud, shown now and then as bubbles.
import { h } from './dom.js';
import { portrait } from './portrait.js';

export const MEETING_MS = 70_000;  // how long a meeting holds the room in the lobby's telling of it
const PACE = 42;                   // walking, in px a second at phone scale
const SIT_MS = 260;                // getting up from a chair, or sitting down on one

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** A hex colour mixed toward black (f < 0) or white (f > 0). Anything that isn't a hex colour comes back as it was. */
export function shade(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = Number.parseInt(m[1], 16);
  const ch = (s) => { const c = (n >> s) & 255; return Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f); };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Where everything goes in a room `w` px wide inside its walls, at scale k (1 on a phone). Desks fill the left, then the meeting
 * table under its whiteboard, a plant, and the door. Every x is the middle of a thing; every y is up from the front edge of the floor.
 */
export function plan(w, k, staffCount) {
  const s = (v) => Math.round(v * k);
  const doorW = s(28), doorX = w - s(12) - doorW / 2;
  const plantX = doorX - doorW / 2 - s(17);
  const tableW = Math.round(Math.max(s(92), Math.min(s(160), w * 0.25)));
  const tableX = Math.round(plantX - s(20) - tableW / 2);
  const deskW = s(50), gap = s(13);
  const left = s(12), right = tableX - tableW / 2 - s(30);
  const fit = Math.max(1, Math.floor((right - left + gap) / (deskW + gap)));
  const n = Math.min(fit, Math.max(2, staffCount - 1));  // the manager's place is at the head of the table
  const desks = Array.from({ length: n }, (_, i) => ({ x: left + deskW / 2 + i * (deskW + gap), w: deskW }));
  const nSeats = Math.max(2, Math.min(5, Math.floor((tableW - s(10)) / s(30))));
  const seats = Array.from({ length: nSeats }, (_, i) => ({ x: Math.round(tableX - tableW / 2 + (tableW / nSeats) * (i + 0.5)) }));
  const windows = [{ x: Math.round((plantX + doorX) / 2) - s(4), w: s(46) }];
  if (w > 520) windows.push({ x: Math.round(desks[desks.length - 1].x), w: s(58) });
  return {
    w, k, s,
    floor: s(20), lane: s(3), back: s(15), deskY: s(13), deskH: s(26), tableH: s(24), seatY: s(21),
    door: { x: doorX, w: doorW }, plant: { x: plantX }, table: { x: tableX, w: tableW }, head: { x: Math.round(tableX - tableW / 2 - s(13)) },
    desks, seats, windows, lamps: [Math.round((left + right) / 2), tableX],
  };
}

const px = (v) => `${Math.round(v)}px`;
function at(el, { x, y, w, hgt }) {
  if (x !== undefined) el.style.left = px(x);
  if (y !== undefined) el.style.bottom = px(y);
  if (w !== undefined) el.style.width = px(w);
  if (hgt !== undefined) el.style.height = px(hgt);
  return el;
}

/**
 * One floor's room and the people in it. `staff` is the floor's list from /building/staff; `say` is a shared budget so the whole
 * building never has more than a few bubbles up at once. think(now) moves things along, and only gets called while the room is on screen.
 */
export class Room {
  constructor({ card, staff, width, k, max, budget, moving = false, reduced = false }) {
    this.card = card; this.k = k; this.budget = budget; this.reduced = reduced; this.moving = moving;
    this.people = []; this.queue = []; this.meeting = null; this.saying = null; this.nextSay = 0;
    const brand = card.colors?.primary || '#d9774a', accent = card.colors?.accent || brand;
    this.accent = accent;
    const shown = staff.slice(0, max);
    this.extra = Math.max(0, staff.length - shown.length);
    const P = this.p = plan(width, k, shown.length);
    const s = P.s;
    this.el = h('span.dh-room', { 'aria-hidden': 'true' });
    this.el.append(h('span.dh-wall'), h('span.dh-floorband'));
    for (const x of P.lamps) this.el.append(at(h('span.dh-lamp'), { x: x - s(9) }));
    for (const wdw of P.windows) this.el.append(at(h('span.dh-window', {}, h('i')), { x: wdw.x - wdw.w / 2, y: P.floor + s(70), w: wdw.w, hgt: s(46) }));
    this.el.append(at(h('span.dh-door', {}, h('i')), { x: P.door.x - P.door.w / 2, y: P.floor - s(3), w: P.door.w, hgt: s(64) }));
    this.el.append(at(h('span.dh-plant', {}, h('i'), h('b')), { x: P.plant.x - s(11), y: P.back - s(2) }));
    if (moving) {
      // Moving in: boxes where the desks will go, and nobody at a desk yet.
      for (const d of P.desks) this.el.append(at(h('span.dh-box'), { x: d.x - s(16), y: P.deskY }), at(h('span.dh-box.small'), { x: d.x + s(6), y: P.deskY }));
    } else {
      this.board = at(h('span.dh-board', {}, h('i')), { x: P.table.x - P.table.w * 0.36, y: P.floor + s(66), w: P.table.w * 0.72, hgt: s(30) });
      this.el.append(this.board);
      this.desks = P.desks.map((d) => {
        const chair = at(h('span.dh-chair'), { x: d.x + s(6) - s(12), y: P.deskY + P.deskH - s(4) });
        const scr = h('span.dh-scr', {}, h('i'));
        const hands = h('span.dh-hands', {}, h('i'), h('i'));
        const desk = at(h('span.dh-desk', {}, at(h('span.dh-mon', {}, scr), { x: s(2) }), at(h('span.dh-kb'), { x: d.w / 2 + s(6) - s(8) }), hands), { x: d.x - d.w / 2, y: P.deskY, w: d.w, hgt: P.deskH });
        this.el.append(chair, desk);
        return { ...d, el: desk, chair, hands, kind: 'desk', y: P.seatY, sit: true, sx: d.x + s(6), who: null };
      });
      this.seats = P.seats.map((t) => {
        const chair = at(h('span.dh-chair'), { x: t.x - s(12), y: P.deskY + P.tableH - s(4) });
        this.el.append(chair);
        return { ...t, chair, kind: 'seat', y: P.seatY - s(1), sit: true, sx: t.x, who: null };
      });
      this.el.append(at(h('span.dh-table'), { x: P.table.x - P.table.w / 2, y: P.deskY, w: P.table.w, hgt: P.tableH }));
    }
    this.head = { x: P.head.x, sx: P.head.x, y: P.back, kind: 'head', sit: false };
    this.spots = [
      { sx: P.plant.x - s(20), y: P.back, sit: false, kind: 'plant' },
      { sx: P.door.x - s(2), y: P.back, sit: false, kind: 'door' },
      ...P.windows.map((wdw) => ({ sx: wdw.x, y: P.lane, sit: false, kind: 'window' })),
    ];
    for (const st of shown) this.add(st);
    this.home();
    for (const p of this.people) this.place(p, p.home, { now: true });
  }

  add(st) {
    const look = st.look || {};
    const outfit = look.outfitColor || '#2f4a6b';
    const say = h('span.dh-say', {}, h('span'));
    const el = h('span.dh-person', { css: { '--outfit': outfit, '--outfit-d': shade(outfit, -0.25), '--skin': look.skin || '#e8b98f' } },
      h('span.dh-fig', {},
        h('span.dh-legs'), h('span.dh-torso'),
        h('span.dh-head', {}, portrait(st.look, { accent: this.accent, name: '', develop: false }))),
      say);
    this.el.append(el);
    this.people.push({ id: st.id, name: st.name, title: st.title || '', role: st.role || '', manager: st.role === 'manager', busy: !!st.busy, el, say,
      x: 0, y: 0, spot: null, home: null, until: 0, steps: [], pose: '' });
  }

  /** Everyone's own place: the manager at the head of the table, the rest at a desk each, and then round the table. */
  home() {
    const free = [...(this.desks || []), ...(this.seats || [])];
    for (const p of this.people) {
      if (p.manager || this.moving) { p.home = this.moving ? pick(this.spots) : this.head; continue; }
      p.home = free.shift() || { sx: rnd(this.p.s(30), this.p.w - this.p.s(60)), y: this.p.lane, sit: false, kind: 'lane' };
    }
  }

  /** Puts someone straight on a spot (now) or sets off a walk there: up out of the chair, along the front, and down into the next. */
  place(p, spot, { now = false } = {}) {
    const t = performance.now();
    if (p.spot && p.spot !== spot) this.leave(p);
    if (spot.who !== undefined) spot.who = p;
    p.spot = spot;
    if (now || this.reduced) { this.pose(p, spot.sit ? 'sit' : 'stand'); this.move(p, spot.sx, spot.y, 0); p.steps = []; this.settle(p); return; }
    const lane = this.p.lane, steps = [];
    if (p.y !== lane) steps.push({ at: t, fn: () => { this.pose(p, 'walk'); this.move(p, p.x, lane, SIT_MS); } });
    const go = (p.y !== lane ? SIT_MS : 0);
    const dur = Math.abs(spot.sx - p.x) / (PACE * this.k) * 1000;
    steps.push({ at: t + go, fn: () => { this.pose(p, 'walk'); p.el.classList.toggle('left', spot.sx < p.x); this.move(p, spot.sx, lane, dur); } });
    steps.push({ at: t + go + dur, fn: () => { this.pose(p, spot.sit ? 'sit' : 'stand'); this.move(p, spot.sx, spot.y, spot.y === lane ? 0 : SIT_MS); } });
    steps.push({ at: t + go + dur + SIT_MS, fn: () => this.settle(p) });
    p.steps = steps;
  }
  leave(p) {
    const sp = p.spot;
    if (sp && sp.who === p) sp.who = null;
    if (sp?.kind === 'desk') { sp.el.classList.remove('typing', 'taken'); }
    p.el.classList.remove('typing');
  }
  /** Arrived. At their own desk, a busy one types. */
  settle(p) {
    const sp = p.spot;
    p.el.dataset.at = sp?.kind || '';
    if (sp?.kind === 'desk') {
      sp.el.classList.add('taken');
      sp.hands.style.setProperty('--skin', p.el.style.getPropertyValue('--skin'));
      sp.el.classList.toggle('typing', p.busy && sp === p.home);
    }
    p.el.classList.toggle('typing', !!(p.busy && sp === p.home && sp.sit));
  }
  pose(p, pose) {
    if (p.pose === pose) return;
    p.el.classList.remove('sit', 'stand', 'walk');
    p.el.classList.add(pose);
    p.el.classList.toggle('front', pose !== 'sit');
    p.pose = pose;
  }
  move(p, x, y, ms) {
    p.x = x; p.y = y;
    p.el.style.transitionDuration = `${Math.max(0, Math.round(ms))}ms`;
    p.el.style.transform = `translate3d(${Math.round(x - this.p.s(14))}px, ${-Math.round(y)}px, 0)`;
  }

  /** The next thing to do for someone who has finished what they were doing. */
  decide(p, now) {
    const m = this.meeting;
    if (m && now < m.until && (m.ids.has(p.id) || !m.ids.size)) {
      const spot = p.id === m.lead ? this.head : (this.seats || []).find((t) => t.who === p) || (this.seats || []).find((t) => !t.who);
      if (spot && p.spot !== spot) this.place(p, spot);
      p.until = m.until + rnd(200, 2500);
      return;
    }
    if (p.busy) {
      if (p.spot !== p.home && (!p.home.who || p.home.who === p)) { this.place(p, p.home); p.until = now + rnd(9000, 20000); return; }
      if (Math.random() < 0.12 && !this.moving) { this.wander(p); p.until = now + rnd(5000, 9000); return; }
      this.settle(p); p.until = now + rnd(8000, 16000);
      return;
    }
    const r = Math.random();
    if (r < 0.4 && (!p.home.who || p.home.who === p)) this.place(p, p.home);
    else if (r < 0.72) this.wander(p);
    else this.visit(p);
    p.until = now + rnd(5000, 12000);
  }
  wander(p) {
    const open = this.spots.filter((sp) => !this.people.some((q) => q !== p && q.spot === sp));
    if (open.length) this.place(p, pick(open));
    else this.place(p, { sx: rnd(this.p.s(24), this.p.w - this.p.s(70)), y: this.p.lane, sit: false, kind: 'lane' });
  }
  /** Over to a colleague for a word: stand in front of wherever they are. */
  visit(p) {
    const q = pick(this.people.filter((o) => o !== p));
    if (!q) { this.wander(p); return; }
    const side = q.x > this.p.w / 2 ? -1 : 1;
    this.place(p, { sx: Math.max(this.p.s(16), Math.min(this.p.w - this.p.s(50), q.x + side * this.p.s(22))), y: this.p.lane, sit: false, kind: 'lane' });
  }

  think(now) {
    for (const p of this.people) {
      while (p.steps.length && p.steps[0].at <= now) p.steps.shift().fn();
      if (!p.steps.length && now >= p.until) this.decide(p, now);
    }
    if (this.saying && now >= this.saying.until) this.hush();
    if (!this.saying && this.queue.length && now >= this.nextSay && this.budget.up < this.budget.max) this.speak(now);
  }

  /** New lines from the floor, oldest first. They come out one at a time, a few seconds apart, never all at once. */
  hear(lines, now) {
    for (const l of lines) if (this.people.some((p) => p.id === l.from)) this.queue.push(l);
    if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 3);
    if (this.nextSay < now) this.nextSay = now + rnd(600, 2600);
  }
  speak(now) {
    const l = this.queue.shift();
    const p = this.people.find((x) => x.id === l.from);
    if (!p) return;
    const text = l.text.length > 90 ? `${l.text.slice(0, 88).trimEnd()}…` : l.text;
    p.say.firstChild.textContent = text;
    // Kept inside the room: a bubble near either wall hangs off its speaker's far side.
    const edge = this.p.s(70);
    p.say.classList.toggle('lean-r', p.x < edge);
    p.say.classList.toggle('lean-l', p.x > this.p.w - edge);
    p.say.classList.add('up');
    this.budget.up++;
    this.saying = { p, until: now + Math.min(7000, Math.max(3800, 2400 + text.length * 50)) };
  }
  /** Off the screen: whatever was being said is left unsaid, so the bubbles left up are only ones someone can see. */
  quiet() { if (this.saying) this.hush(); }
  hush() {
    const { p } = this.saying;
    p.say.classList.remove('up');
    this.saying = null; this.budget.up = Math.max(0, this.budget.up - 1);
    this.nextSay = performance.now() + rnd(2500, 6000);
  }

  setBusy(ids, now) {
    for (const p of this.people) {
      const b = ids.has(p.id);
      if (b === p.busy) continue;
      p.busy = b;
      if (!p.steps.length) p.until = Math.min(p.until, now + rnd(400, 2600));
      if (!b) this.settle(p);
    }
  }
  /** A meeting: its people make for the table, the one running it to the head, the whiteboard fills up, and it breaks up after a while. */
  setMeeting(m, now) {
    const was = this.meeting;
    if (!m) { if (was && now >= was.until) this.meeting = null; this.board?.classList.toggle('on', !!this.meeting); return; }
    if (was && was.at === m.at) return;
    this.meeting = { at: m.at, lead: m.ids[0], ids: new Set(m.ids), until: now + m.left };
    this.board?.classList.add('on');
    for (const p of this.people) if (this.meeting.ids.has(p.id) && !p.steps.length) p.until = Math.min(p.until, now + rnd(200, 2200));
  }

  /** Who is under this point on screen, if anyone. */
  personAt(x, y) {
    let best = null, bestD = Infinity;
    for (const p of this.people) {
      const r = p.el.firstChild.getBoundingClientRect();
      if (x < r.left - 4 || x > r.right + 4 || y < r.top - 4 || y > r.bottom + 2) continue;
      const d = Math.abs(x - (r.left + r.right) / 2);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  destroy() {
    if (this.saying) { this.budget.up = Math.max(0, this.budget.up - 1); this.saying = null; }
    this.el.remove();
  }
}
