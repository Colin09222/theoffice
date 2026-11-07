// The floor plans. Pure data and a walking grid, with no three.js, so the tests can prove in plain Node that every desk, meeting
// spot and errand in every plan can be reached on foot. x runs left to right, z runs from the back wall (-10) to the camera (+10).
// A desk is [x, z, ry]: the sitter is 0.84 in front of it and faces it. ry is a quarter turn, so footprints stay axis-aligned:
// 0 faces the back wall, PI faces the camera, PI/2 faces the left wall, -PI/2 faces the right.
export const ROOM_W = 32, ROOM_D = 20, CELL = 0.5, WALL_H = 4.6;
const Q = Math.PI / 2, HALF = Math.PI;
const DOOR_W = 1.6;
const SIDES = { n: { n: [0, 1], t: [1, 0] }, s: { n: [0, -1], t: [1, 0] }, w: { n: [1, 0], t: [0, 1] }, e: { n: [-1, 0], t: [0, 1] } };
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
const RY = { n: 0, s: HALF, w: Q, e: -Q };

// One line per room. Staff: S(x0, z0, x1, z1, door side, optional spot along that wall, optional wall the desk stands against).
const S = (x0, z0, x1, z1, door, at, wall) => ({ kind: 'staff', rect: [x0, z0, x1, z1], door, at, wall });
const O = (id, x0, z0, x1, z1, door, at, wall) => ({ kind: 'office', id, rect: [x0, z0, x1, z1], door, at, wall });
const M = (x0, z0, x1, z1, doors, opts = {}) => ({ kind: 'meeting', rect: [x0, z0, x1, z1], doors, ...opts });
const K = (x0, z0, x1, z1, door, at) => ({ kind: 'kitchen', rect: [x0, z0, x1, z1], door, at });
const L = (x0, z0, x1, z1, door, at, opts = {}) => ({ kind: 'lounge', rect: [x0, z0, x1, z1], door, at, ...opts });
const H = (x0, z0, x1, z1, label = 'Corridor') => ({ kind: 'corridor', rect: [x0, z0, x1, z1], label });

/** Where a door or a desk's wall lies on a room's rectangle. */
function edge([x0, z0, x1, z1], side) {
  if (side === 'n') return { line: `h${z0}`, c: z0, a: x0, b: x1 };
  if (side === 's') return { line: `h${z1}`, c: z1, a: x0, b: x1 };
  if (side === 'w') return { line: `v${x0}`, c: x0, a: z0, b: z1 };
  return { line: `v${x1}`, c: x1, a: z0, b: z1 };
}
const OUTER = new Set([`h${-ROOM_D / 2}`, `h${ROOM_D / 2}`, `v${-ROOM_W / 2}`, `v${ROOM_W / 2}`]);

function deskIn(rect, wall, big) {
  const [x0, z0, x1, z1] = rect; const inset = big ? 1.15 : 1.0; const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (wall === 'n') return [cx, z0 + inset, 0];
  if (wall === 's') return [cx, z1 - inset, HALF];
  if (wall === 'w') return [x0 + inset, cz, Q];
  return [x1 - inset, cz, -Q];
}

function meetingFor(rect, opts) {
  const [x0, z0, x1, z1] = rect; const w = x1 - x0;
  const tx = (x0 + x1) / 2, tz = (z0 + z1) / 2;
  if (opts.crates) return { table: [tx, tz], kind: 'crates', size: [1.5, 1.5], block: [2.6, 1.5], chairs: [], stand: [tx, tz - 1.45], spots: [[tx - 1.7, tz + 1.5], [tx - 0.5, tz + 1.5], [tx + 0.7, tz + 1.5], [tx + 1.9, tz + 1.5], [tx - 2.1, tz], [tx + 2.1, tz], [tx - 2.0, tz - 1.4], [tx + 2.0, tz - 1.4]] };
  if (w >= 9) return { table: [tx, tz], size: [2.2, 1.5, 2.0], block: [6.4, 3.2],
    chairs: [[tx - 2.85, tz, Q], [tx + 2.85, tz, -Q], [tx - 1.3, tz - 1.15, 0], [tx, tz - 1.15, 0], [tx + 1.3, tz - 1.15, 0], [tx - 1.3, tz + 1.15, HALF], [tx, tz + 1.15, HALF], [tx + 1.3, tz + 1.15, HALF]], stand: [tx, tz - 2.25],
    spots: [[tx - 2.7, tz + 2.15], [tx - 1.3, tz + 2.15], [tx + 1.3, tz + 2.15], [tx + 2.7, tz + 2.15], [tx - 3.95, tz], [tx + 3.95, tz], [tx - 2.4, tz - 2.15], [tx + 2.4, tz - 2.15]] };
  return { table: [tx, tz], size: [1.5, 1.5], block: [3.4, 1.3],
    chairs: [[tx - 2.05, tz, Q], [tx + 2.05, tz, -Q], [tx - 0.9, tz + 0.8, HALF], [tx + 0.9, tz + 0.8, HALF]], stand: [tx - 0.3, tz - 1.2],
    spots: [[tx - 2.2, tz + 1.55], [tx - 0.8, tz + 1.55], [tx + 0.5, tz + 1.55], [tx + 2.1, tz + 1.55], [tx - 2.75, tz], [tx + 2.75, tz], [tx - 2.75, tz - 1.2], [tx + 2.75, tz - 1.2]] };
}

/** Turns one line per room into a whole plan: the walls with their doors, each person's desk, the meeting table, kitchen spots and sofa. */
function make(def) {
  const rooms = []; const spans = new Map(); const doors = new Map(); const out = { ...def };
  const names = def.names || {};
  let staff = 0, corridors = 0;
  const plan = out; plan.desks = []; plan.windows = def.windows || [];
  for (const spec of def.rooms) {
    const { kind, rect } = spec;
    const id = spec.id || (kind === 'staff' ? `office-${++staff}` : kind === 'corridor' ? `corridor-${++corridors}` : kind);
    const room = { id, kind, rect, label: spec.label || names[id] || { manager: 'Manager\'s office', boss: 'Boss\'s office', meeting: 'Meeting room', kitchen: 'Kitchen', lounge: 'Lounge' }[id] || (kind === 'staff' ? 'Office' : 'Corridor') };
    rooms.push(room);
    if (kind === 'corridor') continue;
    const [x0, z0, x1, z1] = rect;
    if (!spec.open) for (const side of ['n', 's', 'w', 'e']) {
      const e = edge(rect, side);
      if (OUTER.has(e.line)) continue;
      if (!spans.has(e.line)) spans.set(e.line, []);
      spans.get(e.line).push([e.a, e.b]);
    }
    const sides = spec.doors ? Object.entries(spec.doors) : spec.door ? [[spec.door, spec.at]] : [];
    for (const [side, at] of sides) {
      const e = edge(rect, side); const c = at ?? (e.a + e.b) / 2;
      if (!doors.has(e.line)) doors.set(e.line, []);
      doors.get(e.line).push([c - DOOR_W / 2, c + DOOR_W / 2]);
      room.door = room.door || { side, at: c, x: e.line[0] === 'h' ? c : e.c, z: e.line[0] === 'h' ? e.c : c };
    }
    if (kind === 'staff' || kind === 'office') {
      room.wall = spec.wall || OPPOSITE[spec.door];
      const d = deskIn(rect, room.wall, kind === 'office');
      room.desk = d;
      if (kind === 'staff') { plan.desks.push(d); plan.shared ||= []; const half = (SIDES[room.wall].n[0] ? z1 - z0 : x1 - x0) / 2; if (half >= 2) plan.shared.push(sharedDesk(room)); } else plan[id] = d;
    }
    if (kind === 'meeting') { plan.meet = meetingFor(rect, spec); plan.board = plan.meet.table[0]; plan.boardZ = z0 + 0.12; }
    if (kind === 'kitchen') {
      const cz = z0 + 4.5; plan.coffee = [x1 - 0.8, cz]; plan.fridge = [x1 - 0.8, z0 + 0.9];
      room.spots = [[x1 - 2.6, cz - 1.4, Q], [x1 - 2.6, cz, Q], [x1 - 2.6, cz + 1.4, Q], [x1 - 2.6, z0 + 1.4, Q]];
    }
    if (kind === 'lounge') {
      if (spec.sofa !== false) {
        const sx = (x0 + x1) / 2, sz = z1 - 1.9;
        plan.sofa = [sx, sz]; plan.hang = [sx, sz - 2.2, 0];
        room.spots = [[sx - 2.4, sz - 1.5, 1], [sx + 2.4, sz - 1.5, -1], [sx, sz - 2.2, 0], [sx - 2.4, sz - 2.6, 0.8], [sx + 2.4, sz - 2.6, -0.8]];
      } else { plan.sofa = null; plan.hang = spec.hang; room.spots = spec.spots; }
    }
  }
  plan.rooms = rooms;
  plan.walls = [];
  for (const [line, list] of spans) {
    const c = Number(line.slice(1)); const along = line[0] === 'h';
    const merged = []; for (const [a, b] of [...list].sort((p, q) => p[0] - q[0])) { const last = merged.at(-1); if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b); else merged.push([a, b]); }
    for (const [a, b] of merged) {
      const gaps = (doors.get(line) || []).filter(([p, q]) => p >= a - 1e-6 && q <= b + 1e-6).filter((g, i, all) => all.findIndex((o) => Math.abs(o[0] - g[0]) < 1e-6) === i);
      plan.walls.push(along ? [a, c, b, c, gaps] : [c, a, c, b, gaps]);
    }
  }
  plan.console = null;
  plan.rugs ||= []; plan.art ||= [[-7.5, 3.4, 1.5, 1.15], [7, 3.4, 1.4, 1.1]];
  delete plan.names;
  return plan;
}
/** The second desk in an office, for when a floor has hired more people than it has rooms. It stands against a side wall, past the first. */
function sharedDesk(room) {
  const [x0, z0, x1, z1] = room.rect; const f = SIDES[room.wall];
  const depth = f.n[0] ? x1 - x0 : z1 - z0; const half = (f.n[0] ? z1 - z0 : x1 - x0) / 2; const a = depth - 1.4;
  const base = room.wall === 'n' ? [(x0 + x1) / 2, z0] : room.wall === 's' ? [(x0 + x1) / 2, z1] : room.wall === 'w' ? [x0, (z0 + z1) / 2] : [x1, (z0 + z1) / 2];
  // On whichever side is further from the door, so it never stands in the way in.
  const doorAlong = room.door ? (f.t[0] ? room.door.x - base[0] : room.door.z - base[1]) : 0; const sign = doorAlong > 0.1 ? -1 : 1;
  return [base[0] + f.n[0] * a + f.t[0] * sign * (half - 1.0), base[1] + f.n[1] * a + f.t[1] * sign * (half - 1.0), f.t[0] ? -Q * sign : (sign > 0 ? HALF : 0)];
}

// A plan's `rooms` make its walls, glass over a low solid dado, with a gap for each door. Each person has an office of their own; there is
// always a boss's office, a manager's office, a meeting room, a kitchen and a lounge, and people walk between them along the corridors.
export const PLANS = {
  // Three rows of offices on two long corridors, and the meeting room in the middle of it all.
  open: make({
    label: 'Corridors', blurb: 'Offices down two long corridors, with a meeting room in the middle.',
    windows: [[-9.6, -7.2], [-5.2, -2.8], [-0.8, 1.6], [3.6, 6]],
    rooms: [
      O('manager', -16, -10, -10.6, -4.6, 's'), S(-10.6, -10, -6.2, -4.6, 's'), S(-6.2, -10, -1.8, -4.6, 's'), S(-1.8, -10, 2.6, -4.6, 's'), S(2.6, -10, 7, -4.6, 's'), O('boss', 7, -10, 11.4, -4.6, 's'),
      K(11.4, -10, 16, -2.4, 'w', -3.5),
      H(-16, -4.6, 11.4, -2.4),
      S(-16, -2.4, -11.6, 3, 'n'), S(-11.6, -2.4, -7.2, 3, 's'), M(-7.2, -2.4, 2.2, 3, { n: 0.9, s: undefined }), H(2.2, -2.4, 4.2, 3, 'The cut-through'), S(4.2, -2.4, 8.1, 3, 'n'), S(8.1, -2.4, 12, 3, 's'), S(12, -2.4, 16, 3, 's'),
      H(-16, 3, 16, 5.2),
      S(-16, 5.2, -11.6, 10, 'n'), S(-11.6, 5.2, -7.2, 10, 'n'), S(-7.2, 5.2, -2.8, 10, 'n'), H(-2.8, 5.2, 3, 10, 'The print room'), L(3, 5.2, 16, 10, 'n', 6),
    ],
    shelf: [-2.1, 7.6], printer: [2.2, 9.1], arcade: [-1.6, 9.3], coat: [-15.4, -3.6], pet: [0, -3.6],
    plants: [[15.2, 5.9, -0.9, 0], [3.6, 5.9, 0.9, 0], [-15.4, 3.7, 0.9, 0], [-15.4, -3.9, 0.9, 0], [9.6, -4.1, 0, 0.9], [15.3, 9.3, -0.9, -0.3], [-2.2, 5.8, 0.9, 0], [3.7, 9.4, 0.9, -0.2]],
    rugs: [],
  }),
  // A big shared table in a glass box in the middle of the floor, with a ring of corridor and offices all round it.
  studio: make({
    label: 'Studio', blurb: 'A big shared table in a glass box, with offices all round it.',
    windows: [[-15, -12], [-11, -8], [3.3, 6.7], [7.7, 10.9]],
    rooms: [
      S(-16, -10, -11.6, -5.2, 's'), S(-11.6, -10, -7.2, -5.2, 's'), O('manager', -7.2, -10, -2.2, -5.2, 's'), O('boss', -2.2, -10, 2.8, -5.2, 's'), S(2.8, -10, 7.2, -5.2, 's'), S(7.2, -10, 11.4, -5.2, 's'),
      K(11.4, -10, 16, -3, 'w', -4.1),
      H(-16, -5.2, 11.4, -3),
      S(-16, -3, -11.4, 3.2, 'n'), S(-11.4, -3, -6.8, 3.2, 's'), M(-6.8, -3, 4.8, 3.2, { n: 2.4, s: undefined }, { label: 'The big table' }), H(4.8, -3, 6.8, 3.2, 'The cut-through'), S(6.8, -3, 11.4, 3.2, 's'), S(11.4, -3, 16, 3.2, 's'),
      H(-16, 3.2, 16, 5.4),
      S(-16, 5.4, -11.6, 10, 'n'), S(-11.6, 5.4, -7.2, 10, 'n'), S(-7.2, 5.4, -2.8, 10, 'n'), S(-2.8, 5.4, 1.6, 10, 'n'), L(1.6, 5.4, 16, 10, 'n', 5),
    ],
    shelf: [2.3, 7.8], printer: [15.2, 6.1], arcade: [12.6, 9.3], coat: [-15.4, -4.2], pet: [0, 4.3],
    plants: [[15.3, 9.3, -0.9, 0], [2.3, 5.95, 0.9, 0.3], [-15.4, 4.2, 0.9, 0], [-2.2, -4.7, 0, 0.9], [-15.4, -4.5, 0.9, 0.5], [15.4, 3.8, -0.9, 0], [2.4, 9.4, 0.9, -0.2], [12.2, 6.0, 0, 0.9]],
    easels: [[14.6, 7.6, 0.3], [4.3, 6.1, -0.2]],
    props: [{ m: 'lampRoundFloor', x: 15.3, z: 7.9, tint: 'lamp', b: [0.6, 0.6] }],
  }),
  // Sheds round a loading bay with a roller door, a table made of crates and a tea corner: the company that started in a garage.
  garage: make({
    label: 'Garage', blurb: 'Workshops round a loading bay, a roller door and a table on crates.',
    frame: '#6a4b30',
    windows: [[-15.2, -12.4], [-10.8, -8]],
    names: { manager: 'Site office', boss: 'Boss\'s cabin', meeting: 'Crate room', kitchen: 'Tea corner', lounge: 'The old sofa' },
    rooms: [
      S(-16, -10, -11.6, -4.8, 's'), S(-11.6, -10, -7.2, -4.8, 's'), S(-7.2, -10, -2.8, -4.8, 's'), H(-2.8, -10, 2.8, -4.8, 'The loading bay'), S(2.8, -10, 7.2, -4.8, 's'), S(7.2, -10, 11.6, -4.8, 's'), O('manager', 11.6, -10, 16, -4.8, 's'),
      H(-16, -4.8, 16, -2.6),
      S(-16, -2.6, -11.6, 2.4, 'n'), S(-11.6, -2.6, -7.2, 2.4, 's'), M(-7.2, -2.6, 1.8, 2.4, { n: 0.7, s: undefined }, { crates: true }), H(1.8, -2.6, 3.8, 2.4, 'The cut-through'), S(3.8, -2.6, 7.6, 2.4, 'n'), S(7.6, -2.6, 11.4, 2.4, 's'), O('boss', 11.4, -2.6, 16, 2.4, 'n'),
      H(-16, 2.4, 11.2, 4.6),
      S(-16, 4.6, -11.6, 10, 'n'), S(-11.6, 4.6, -7.2, 10, 'n'), S(-7.2, 4.6, -2.8, 10, 'n'), L(-2.8, 4.6, 11.2, 10, 'n', 0),
      K(11.2, 2.4, 16, 10, 'w', 3.5),
    ],
    shelf: [-2.1, 7.7], printer: [10.2, 5.4], arcade: [8.2, 9.2], coat: [15.4, -3.3], pet: [0, -6.5],
    plants: [[-2.1, 5.3, 0.9, 0], [10.5, 9.3, -0.9, 0], [-15.4, -3.9, 0.9, 0], [-15.4, 3.5, 0.9, 0], [2.3, -8.9, -0.9, 0.2], [-2.3, -8.9, 0.9, 0.2], [7.6, 4.1, 0, -0.9], [-2.2, 9.3, 0.9, -0.2]],
    roller: [-2, 2], bulbs: true,
    props: [
      { m: 'cardboardBoxOpen', x: 1.9, z: -7.4, ry: 0.3, s: 1.6, b: [1.5, 1.4] }, { m: 'cardboardBoxOpen', x: 2.1, z: -6.0, ry: -0.2, s: 1.2, b: [1.1, 1.0] }, { m: 'cardboardBoxOpen', x: 1.9, z: -7.4, y: 0.9, ry: 1.0, s: 1.2 },
      { m: 'cardboardBoxOpen', x: -1.9, z: -5.8, ry: 0.6, s: 1.3, b: [1.2, 1.1] }, { m: 'speaker', x: 10.6, z: 7.4, s: 1.5, b: [0.6, 0.6] }, { m: 'lampRoundFloor', x: 0.6, z: 9.4, tint: 'lamp', b: [0.5, 0.5] },
    ],
  }),
  // The middle of the floor is sofas and rugs, open on all sides, with the offices around the edge of it.
  lounge: make({
    label: 'Lounge', blurb: 'Sofas in the middle of the floor, with offices round the edge.',
    windows: [[-15, -11.2], [-9.3, -5.4], [5.4, 9.3], [11.2, 15]],
    rooms: [
      S(-16, -10, -10.25, -4, 's', -11.1), S(-10.25, -10, -4.5, -4, 's'), M(-4.5, -10, 4.5, -4, { s: undefined }), S(4.5, -10, 10.25, -4, 's'), S(10.25, -10, 16, -4, 's', 11.1),
      S(-16, -4, -12, -0.2, 'e'), S(-16, -0.2, -12, 3.6, 'e'),
      L(-12, -4, 12, 2.8, null, undefined, { open: true, sofa: false, hang: [-5.2, 2.4, 0], spots: [[-5.6, 0.4, 1.4], [6, 0.4, -1.4], [-4.6, -2.8, 0.6], [5.2, -2.8, -0.6], [4.9, 2.5, -1.0]] }), H(-12, 2.8, 12, 3.6, 'The walkway'),
      K(12, -4, 16, 3.6, 'w', 0),
      O('manager', -16, 3.6, -10.2, 10, 'n', -11.1), S(-10.2, 3.6, -6.8, 10, 'n'), S(-6.8, 3.6, -3.4, 10, 'n'), S(-3.4, 3.6, 0, 10, 'n'), S(0, 3.6, 3.4, 10, 'n'), S(3.4, 3.6, 6.8, 10, 'n'), S(6.8, 3.6, 10.2, 10, 'n'), O('boss', 10.2, 3.6, 16, 10, 'n', 11.1),
    ],
    shelf: [-9, 0.4], printer: [-9.2, 2.8], arcade: [9.8, 2.8], coat: [11.3, -3.4], pet: [-2.2, 3.0],
    plants: [[9.8, -3.4, -0.9, 0.2], [-8.3, -3.4, 0, 0.9], [6.8, 3.1, 0, -0.9], [-6.8, 3.1, 0, -0.9], [-5, -3.5, 0, 0.9], [5, -3.5, 0, 0.9], [-6.9, -1.8, 0.9, 0], [8.3, 0.3, -0.9, 0]],
    rugs: [[0.3, 0.4, 11.2, 5.4, 'big']],
    props: [
      { m: 'loungeDesignSofa', x: 0.3, z: -1.15, ry: 0, s: 1.25, tint: 'primary', b: [4.6, 1.5] },
      { m: 'loungeSofa', x: 0.3, z: 2.05, ry: HALF, s: 1.0, tint: 'primary', b: [4.0, 1.1] },
      { m: 'loungeChair', x: -3.6, z: 0.4, ry: Q, s: 1.05, tint: 'accent', b: [1.3, 1.3] }, { m: 'loungeChair', x: 4.1, z: 0.4, ry: -Q, s: 1.05, tint: 'accent', b: [1.3, 1.3] },
      { m: 'tableCoffee', x: 0.3, z: 0.45, s: 1.3, b: [2.2, 1.1] }, { m: 'lampRoundFloor', x: -3.3, z: 2.3, tint: 'lamp', b: [0.6, 0.6] }, { m: 'lampRoundFloor', x: 3.9, z: 2.3, tint: 'lamp', b: [0.6, 0.6] },
      { m: 'pillow', x: -0.9, y: 0.55, z: -1.2, ry: 0.2, s: 1.0, tint: 'accent' }, { m: 'pillowBlue', x: 1.5, y: 0.55, z: -1.2, ry: -0.2, s: 1.0, tint: 'cream' },
    ],
  }),
  // Two wings of offices either side of a north-south corridor, and the shared rooms down the middle and along the front.
  pods: make({
    label: 'Wings', blurb: 'Two wings of offices, with the shared rooms in the middle.',
    windows: [[-15.2, -11.8], [-8.2, -4.8], [4.8, 8.2], [11.8, 15.2]],
    rooms: [
      S(-16, -10, -11, -5.83, 'e'), S(-16, -5.83, -11, -1.67, 'e'), S(-16, -1.67, -11, 2.5, 'e'),
      H(-11, -10, -9, 2.5, 'West wing'),
      S(-9, -10, -4, -5.83, 'w'), S(-9, -5.83, -4, -1.67, 'w'), S(-9, -1.67, -4, 2.5, 'w'),
      M(-4, -10, 4, -4, { s: -2 }), H(-4, -4, 0, 2.5, 'The hall'), K(0, -4, 4, 2.5, 'w', 1.5),
      S(4, -10, 9, -5.83, 'e'), S(4, -5.83, 9, -1.67, 'e'), S(4, -1.67, 9, 2.5, 'e'),
      H(9, -10, 11, 2.5, 'East wing'),
      S(11, -10, 16, -5.83, 'w'), S(11, -5.83, 16, -1.67, 'w'), S(11, -1.67, 16, 2.5, 'w'),
      H(-16, 2.5, 16, 4.7),
      O('manager', -16, 4.7, -10.6, 10, 'n'), O('boss', -10.6, 4.7, -5.2, 10, 'n'), L(-5.2, 4.7, 10.4, 10, 'n', 0), H(10.4, 4.7, 16, 10, 'The print room'),
    ],
    shelf: [11.1, 7.6], printer: [15.1, 9.1], arcade: [13.4, 6.0], coat: [-3.5, -3.4], pet: [-2, -1],
    plants: [[-3.5, 2.0, 0.9, -0.2], [-0.5, -3.5, -0.9, 0.2], [-15.4, 3.1, 0.9, 0.2], [15.4, 3.1, -0.9, 0.2], [-4.6, 5.4, 0.9, 0], [9.8, 9.4, -0.9, -0.1], [13, 9.4, 0, -0.9], [-4.6, 9.4, 0.9, -0.1]],
  }),
};
export const planFor = (id) => PLANS[id] || PLANS.open;

/**
 * The places along an office's walls where its owner's own things can go, worked out from where the desk and the door are. Slots too close
 * to the door are left out, so nothing ever blocks the way in. Each is { x, z, ry, along }: ry turns a piece's front into the room, and
 * `along` says whether its long side can lie on the wall. Also returns `rug`, the middle of the open floor, and `back`, the desk's own wall.
 */
export function officeSlots(room) {
  const [x0, z0, x1, z1] = room.rect; const f = SIDES[room.wall];
  const depth = f.n[0] ? x1 - x0 : z1 - z0, half = (f.n[0] ? z1 - z0 : x1 - x0) / 2;
  const base = room.wall === 'n' ? [(x0 + x1) / 2, z0] : room.wall === 's' ? [(x0 + x1) / 2, z1] : room.wall === 'w' ? [x0, (z0 + z1) / 2] : [x1, (z0 + z1) / 2];
  const at = (a, b) => [base[0] + f.n[0] * a + f.t[0] * b, base[1] + f.n[1] * a + f.t[1] * b];
  const face = ([dx, dz]) => Math.atan2(dx, dz);
  const out = {};
  const put = (name, a, b, inward) => {
    const [x, z] = at(a, b);
    if (room.door && Math.hypot(x - room.door.x, z - room.door.z) < 1.45) return;
    out[name] = { x, z, ry: face(inward) };
  };
  if (half >= 2.15) { put('behindA', 0.5, -(half - 0.42), f.n); put('behindB', 0.5, half - 0.42, f.n); }
  const sideAt = Math.min(depth - 1.15, 2.95);
  const minusT = [-f.t[0], -f.t[1]];
  put('sideA', sideAt, -(half - 0.42), f.t); put('sideB', sideAt, half - 0.42, minusT);
  put('nearA', depth - 0.5, -(half - 0.5), [-f.n[0], -f.n[1]]); put('nearB', depth - 0.5, half - 0.5, [-f.n[0], -f.n[1]]);
  const r = at((1.9 + depth) / 2 + 0.2, 0);
  return { slots: out, rug: { x: r[0], z: r[1], w: f.n[0] ? depth - 2.6 : half * 2 - 1.2, d: f.n[0] ? half * 2 - 1.2 : depth - 2.6 }, wall: room.wall, front: f.n, base, half, depth, ry: RY[room.wall] };
}
/** Every place a person might sit on a plan, in the order they're given out: an office each, then a second desk in each office. */
export const seatSpot = (plan, i) => (i < plan.desks.length ? plan.desks[i] : plan.shared[(i - plan.desks.length) % plan.shared.length]);
export const staffRooms = (plan) => (plan.rooms || []).filter((r) => r.kind === 'staff');

// ---- what stands where ----
/** The turned footprint of a rectangle centred (lx, lz) from a point with a quarter turn ry. Returns [x, z, w, d]. */
export function turned(x, z, ry, lx, lz, w, d) {
  const s = Math.sin(ry), c = Math.cos(ry);
  const sideways = Math.abs(s) > 0.5;
  return [x + lx * c + lz * s, z - lx * s + lz * c, sideways ? d : w, sideways ? w : d];
}
/** Where someone sits at a desk, and which way they look. */
export function seatOf([x, z, ry = 0]) { return { at: [x + 0.84 * Math.sin(ry), z + 0.84 * Math.cos(ry)], face: ry + Math.PI }; }
export const bigDeskRect = ([x, z, ry = 0]) => turned(x, z, ry, 0, -0.2, 3.2, 1.6);
export const deskRect = ([x, z, ry = 0]) => turned(x, z, ry, 0, -0.2, 2.5, 1.3);
export const hasSofa = (plan) => !!plan.sofa;

/** The straight runs of wall a plan's lines make once their doors are cut out. `low` marks a waist-high screen. */
export function wallLines(plan) {
  const out = [];
  const cut = (line, low) => {
    const [x0, z0, x1, z1, doors = []] = line;
    const along = x0 !== x1;
    const [from, to] = along ? [x0, x1] : [z0, z1];
    let at = from;
    const run = (a, b) => { if (b > a) out.push(along ? { x0: a, z0, x1: b, z1, low } : { x0, z0: a, x1, z1: b, low }); };
    for (const [a, b] of [...doors].sort((p, q) => p[0] - q[0])) { run(at, a); at = b; }
    run(at, to);
  };
  for (const l of plan.walls || []) cut(l, false);
  for (const l of plan.screens || []) cut(l, true);
  return out;
}
/** Every door as { x, z, along, width }, where `along` says whether its wall runs along x. */
export function doorways(plan) {
  const out = [];
  for (const [x0, z0, x1, z1, doors = []] of plan.walls || []) for (const [a, b] of doors) out.push(x0 !== x1 ? { x: (a + b) / 2, z: z0, along: true, width: b - a } : { x: x0, z: (a + b) / 2, along: false, width: b - a });
  return out;
}
const inRect = ([x0, z0, x1, z1], x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
const area = ([x0, z0, x1, z1]) => (x1 - x0) * (z1 - z0);
/** The room a point is in: the smallest one holding it, since a pod's rectangle may reach round an office. */
export function roomAt(plan, x, z) {
  let best = null;
  for (const r of plan.rooms || []) if (inRect(r.rect, x, z) && (!best || area(r.rect) < area(best.rect))) best = r;
  return best;
}
export const roomOfKind = (plan, kind) => (plan.rooms || []).find((r) => r.kind === kind) || null;
/** Where a room's own furniture and people are: the middle of its rectangle, for pins and labels. */
export const roomCentre = (r) => [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];

/** Every rectangle a person can't walk through, apart from the staff desks, which arrive one at a time. Each is [x, z, w, d, bake]. */
export function planBlocks(plan, { coffee = true, arcade = false, plants = 0, staffCount = 0 } = {}) {
  const out = [];
  const m = plan.meet; const wallZ = -ROOM_D / 2, wallX = -ROOM_W / 2;
  const [tx, tz] = m.table;
  for (const w of wallLines(plan)) out.push([(w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2, Math.max(0.1, Math.abs(w.x1 - w.x0)), Math.max(0.1, Math.abs(w.z1 - w.z0)), false]);
  out.push([tx, tz, m.block[0], m.block[1], true]);
  out.push([plan.board, plan.boardZ ?? wallZ + 0.12, 4.6, 0.2, false]);
  if (plan.console !== null) out.push([wallX + 0.3, plan.console, 0.7, 2.6, true]);
  out.push([plan.shelf[0], plan.shelf[1], 0.9, 2.8, true]);
  if (coffee) { out.push([plan.coffee[0], plan.coffee[1], 1.2, 3.8, true]); out.push([plan.fridge[0], plan.fridge[1] + 0.5, 1.1, 2.0, true]); }
  if (plan.bar) out.push([plan.bar[0], plan.bar[1], 1.0, 2.6, true]);
  if (arcade) out.push([plan.arcade[0], plan.arcade[1], 1.1, 1.2, true]);
  if (hasSofa(plan, staffCount)) { const [sx, sz] = plan.sofa; out.push([sx, sz + 0.6, 4.4, 2.0, true], [sx, sz - 0.6, 1.8, 1.0, true], [sx + 2.4, sz - 0.6, 0.6, 0.6, true]); }
  out.push([plan.printer[0], plan.printer[1], 1.2, 1.2, true]);
  for (let i = 0; i < plants; i++) { const [x, z] = plan.plants[i]; out.push([x, z, 0.8, 0.8, true]); }
  out.push([...bigDeskRect(plan.manager), true], [...bigDeskRect(plan.boss), true]);
  for (const e of plan.easels || []) out.push([e[0], e[1], 0.9, 0.7, true]);
  for (const p of plan.props || []) if (p.b) out.push([p.x, p.z, p.b[0], p.b[1], true]);
  return out;
}

// ---- walking ----
export function makeNav() {
  const cols = Math.round(ROOM_W / CELL), rows = Math.round(ROOM_D / CELL);
  const blocked = new Uint8Array(cols * rows);
  const toCell = (x, z) => [Math.max(0, Math.min(cols - 1, Math.floor((x + ROOM_W / 2) / CELL))), Math.max(0, Math.min(rows - 1, Math.floor((z + ROOM_D / 2) / CELL)))];
  const toWorld = (cx, cz) => [(cx + 0.5) * CELL - ROOM_W / 2, (cz + 0.5) * CELL - ROOM_D / 2];
  const footprints = [];
  const block = (x, z, w, d, { bake = true } = {}) => {
    const [a, b] = toCell(x - w / 2, z - d / 2), [c, e] = toCell(x + w / 2, z + d / 2);
    for (let i = a; i <= c; i++) for (let j = b; j <= e; j++) blocked[j * cols + i] = 1;
    if (bake) footprints.push([x, z, w, d]);
  };
  const isBlocked = (x, z) => { const [cx, cz] = toCell(x, z); return !!blocked[cz * cols + cx]; };
  // True when the straight line between two points crosses no furniture.
  const clear = (a, b) => { const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5)); for (let i = 1; i < steps; i++) { const t = i / steps; const [cx, cz] = toCell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); if (blocked[cz * cols + cx]) return false; } return true; };
  const search = (fx, fz, tx, tz) => {
    const [sx, sz] = toCell(fx, fz), [gx, gz] = toCell(tx, tz);
    const start = sz * cols + sx, goal = gz * cols + gx;
    const prev = new Int32Array(cols * rows).fill(-1); prev[start] = start;
    const q = [start];
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      if (cur === goal) break;
      const cx = cur % cols, cz = (cur / cols) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const n = nz * cols + nx;
        if (prev[n] !== -1) continue;
        // Goals may sit inside furniture (a chair), but paths never cut corners through it.
        if (blocked[n] && n !== goal) continue;
        if (dx && dz && (blocked[cz * cols + nx] || blocked[nz * cols + cx])) continue;
        prev[n] = cur; q.push(n);
      }
    }
    return { prev, start, goal };
  };
  /** True when there is a real route, rather than the straight-line fallback path() gives up to. */
  const reachable = (fx, fz, tx, tz) => { const { prev, goal } = search(fx, fz, tx, tz); return prev[goal] !== -1; };
  const path = (fx, fz, tx, tz) => {
    const { prev, start, goal } = search(fx, fz, tx, tz);
    if (prev[goal] === -1) return [[tx, tz]];
    const out = [];
    for (let c = goal; c !== start; c = prev[c]) out.push(toWorld(c % cols, (c / cols) | 0));
    out.reverse();
    // String-pulling: keep only the corners that matter.
    const smooth = []; let anchor = [fx, fz];
    for (let i = 0; i < out.length; i++) {
      const next = out[i + 1];
      if (!next || !clear(anchor, next)) { smooth.push(out[i]); anchor = out[i]; }
    }
    // The last leg goes to the exact spot, not the middle of its cell, as long as that doesn't clip a corner on the way.
    if (smooth.length && clear(smooth.length > 1 ? smooth[smooth.length - 2] : [fx, fz], [tx, tz])) smooth[smooth.length - 1] = [tx, tz]; else smooth.push([tx, tz]);
    return smooth;
  };
  /** The nearest open spot, spiralling out, so an errand aimed at furniture ends beside it instead of inside it. */
  const freeNear = (x, z) => {
    if (!isBlocked(x, z)) return [x, z];
    for (let r = 1; r < 14; r++) for (let i = 0; i < 8 * r; i++) {
      const a = (i / (8 * r)) * Math.PI * 2; const px = x + Math.cos(a) * r * CELL, pz = z + Math.sin(a) * r * CELL;
      if (Math.abs(px) < ROOM_W / 2 - 0.3 && Math.abs(pz) < ROOM_D / 2 - 0.3 && !isBlocked(px, pz)) return [px, pz];
    }
    return [x, z];
  };
  return { block, path, clear, footprints, isBlocked, freeNear, reachable, cols, rows, blocked };
}

/** The spots a plan promises: chairs, the meeting, the errands. The tests walk to all of these, and so do the people. */
export function planSpots(plan, { coffee = true, arcade = false, plants = 0, staffCount = 8 } = {}) {
  const spots = [];
  const add = (label, x, z) => spots.push({ label, at: [x, z] });
  add('stand', ...plan.meet.stand);
  plan.meet.spots.forEach(([x, z], i) => add(`meeting ${i}`, x, z));
  add('shelf', plan.shelf[0] + 1.0, plan.shelf[1]);
  if (coffee) add('coffee', plan.coffee[0] - 1.0, plan.coffee[1]);
  if (arcade) add('arcade', plan.arcade[0] + 1.0, plan.arcade[1]);
  for (let i = 0; i < plants; i++) { const [x, z, dx, dz] = plan.plants[i]; add(`plant ${i}`, x + dx, z + dz); }
  add('hang', plan.hang[0], plan.hang[1]);
  for (const r of plan.rooms || []) for (const [i, [x, z]] of (r.spots || []).entries()) if (r.kind !== 'kitchen' || coffee) add(`${r.kind} ${i}`, x, z);
  return spots;
}
