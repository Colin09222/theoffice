// The floor plans. Pure data and a walking grid, with no three.js, so the tests can prove in plain Node that every desk, meeting
// spot and errand in every plan can be reached on foot. x runs left to right, z runs from the back wall (-6.8) to the camera (+6.8).
// A desk is [x, z, ry]: the sitter is 0.84 in front of it and faces it. ry is a quarter turn, so footprints stay axis-aligned:
// 0 faces the back wall, PI faces the camera, PI/2 faces the left wall, -PI/2 faces the right.
export const ROOM_W = 22, ROOM_D = 13.6, CELL = 0.5, WALL_H = 4.6;
const Q = Math.PI / 2, HALF = Math.PI;

export const PLANS = {
  // The original room, unchanged, so a floor saved before there were plans looks just as it did.
  open: {
    label: 'Open plan', blurb: 'Rows of desks and a glass meeting room.',
    windows: [[-7.6, -3.1], [3.5, 8.7]],
    desks: [[-6.6, 0.6, 0], [-2.2, 0.6, 0], [2.2, 0.6, 0], [6.6, 0.6, 0], [-6.6, 4.5, 0], [-2.2, 4.5, 0], [2.2, 4.5, 0], [6.6, 4.5, 0]],
    manager: [-6.9, -3.9, 0], boss: [7.0, -3.9, 0],
    board: -0.4,
    meet: { table: [-0.4, -4.75], glass: { x0: -3.4, x1: 2.6, z0: -6.8, z1: -3.0, door: [-1.6, 0.8] }, size: [1.5, 1.5], block: [3.4, 1.3],
      chairs: [[-2.45, -4.75, Q], [1.65, -4.75, -Q], [-1.4, -3.95, HALF], [0.4, -3.95, HALF]], stand: [-0.7, -5.95],
      spots: [[-2.7, -3.5], [-0.35, -3.45], [1.9, -3.5], [-1.7, -2.35], [0.9, -2.35], [-0.4, -1.6], [-2.9, -2.4], [2.1, -2.4]] },
    console: -2.3, shelf: [-10.3, 2.4], coffee: [10.2, 1.7], fridge: [10.2, -1.5], arcade: [-9.8, 6.0], printer: [-9.9, 4.5], coat: [-10.1, -1.2],
    sofa: [6.9, 5.1], sofaUntil: 8, hang: [0.5, -2.3, 0], pet: [2, -1.6],
    plants: [[-10.1, -6.0, 0.8, 0.8], [10.2, -5.9, -0.8, 0.9], [-4.0, -2.5, 0.9, 0.6], [3.4, -2.5, -0.9, 0.6], [10.3, 5.9, 0, -1.0], [-4.4, 6.2, 0, -0.9], [-0.2, 6.2, 0, -0.9], [-10.2, -0.3, 0.9, 0]],
    rugs: [[7.0, -3.3, 5, 3.6, 'boss']],
    art: [[4.9, 2.5, 1.4, 1.75], [-5.6, 2.6, 1.5, 1.15]],
  },
  // A big shared table in the middle, desks around the walls looking out and in, easels and a gallery wall.
  studio: {
    label: 'Studio', blurb: 'A big shared table, with desks around the walls.',
    windows: [[-8.8, -3.2], [2.4, 8.8]],
    desks: [[-7.9, -5.3, 0], [-4.6, -5.3, 0], [3.6, -5.3, 0], [7.0, -5.3, 0], [-6.4, 5.4, HALF], [-2.1, 5.4, HALF], [2.2, 5.4, HALF], [6.5, 5.4, HALF]],
    manager: [-7.0, 0.3, -Q], boss: [6.4, 0.3, Q],
    board: -0.4,
    meet: { table: [-0.3, -0.5], glass: null, size: [2.6, 1.5, 2.2], block: [7.6, 3.5],
      chairs: [[-3.65, -0.5, Q], [3.05, -0.5, -Q], [-1.8, -1.75, 0], [-0.3, -1.75, 0], [1.2, -1.75, 0], [-1.8, 0.75, HALF], [-0.3, 0.75, HALF], [1.2, 0.75, HALF]], stand: [-0.4, -3.3],
      spots: [[-2.6, -2.75], [-0.4, -2.75], [1.8, -2.75], [-4.7, -0.5], [4.1, -0.5], [-2.4, 1.75], [-0.3, 1.75], [1.8, 1.75]] },
    console: -2.3, shelf: [-10.3, 1.9], coffee: [10.2, 2.8], fridge: [10.2, -1.6], arcade: [-9.8, 6.0], printer: [-9.9, 4.2], coat: [-10.1, -0.5],
    sofa: null, hang: [4.6, -2.8, 0], pet: [4, 3],
    plants: [[-10.3, -6.1, 0, 1.0], [10.3, -6.1, -0.9, 0.7], [-4.7, 3.0, 0.9, 0], [4.1, 3.0, -0.9, 0], [10.3, 6.2, -0.9, -0.5], [-0.1, 3.3, 0, -0.9], [1.8, -5.3, 0, 1.1], [-2.7, -5.3, 0, 1.1]],
    rugs: [[-0.3, -0.5, 9.4, 5.2, 'plain']],
    art: [[5.6, 2.6, 1.3, 1.6], [3.9, 2.9, 1.2, 1.2]],
    easels: [[4.7, -3.2, -0.5], [-4.9, -3.2, 0.5], [-2.2, 3.3, 0.2]],
    props: [{ m: 'lampRoundFloor', x: 8.9, z: 5.2, tint: 'lamp' }, { m: 'lampRoundFloor', x: -8.9, z: 3.0, tint: 'lamp' }, { m: 'bookcaseOpen', x: 1.0, z: 3.3, ry: HALF, b: [1.4, 0.7] }],
  },
  // Benches against the walls, a roller door, boxes, an old sofa and a meeting round some crates.
  garage: {
    label: 'Garage', blurb: 'Workbenches, boxes and a roller door.',
    windows: [[-8.9, -4.7]],
    desks: [[-4.7, -5.3, 0], [3.0, -5.3, 0], [-9.5, -1.6, Q], [-9.5, 1.5, Q], [3.2, 1.0, HALF], [3.2, 2.7, 0], [6.3, 1.0, HALF], [6.3, 2.7, 0]],
    manager: [-8.5, -5.1, 0], boss: [9.1, 2.6, Q],
    board: -0.4,
    meet: { table: [-2.9, -1.3], glass: null, kind: 'crates', size: [1.5, 1.5], block: [2.4, 1.9], chairs: [], stand: [-0.4, -3.8],
      spots: [[-4.9, -2.9], [-2.9, -3.0], [-1.0, -2.9], [-5.1, -0.9], [-0.7, -0.9], [-4.1, 0.6], [-1.7, 0.6], [-2.9, 1.3]] },
    console: null, shelf: [-10.3, 5.1], coffee: [10.2, -2.4], fridge: [10.2, -5.9], arcade: [-8.1, 6.0], printer: [-6.3, 6.0], coat: [-6.8, -2.6],
    sofa: [-2.1, 5.2], hang: [1.0, -1.8, 0], pet: [0.8, -1.6],
    plants: [[-10.4, 3.3, 0.9, 0], [10.4, 6.2, -0.9, -0.5], [0.9, 4.4, 0.0, -0.9], [1.0, 6.2, 0.9, 0], [-10.4, -3.8, 0.9, 0], [-6.9, 1.6, 1.0, 0], [-6.7, 0.4, 0.8, 0], [5.0, 6.2, 0, -0.9]],
    rugs: [[-2.1, 4.6, 6.2, 3.8, 'worn']],
    art: [[-3.6, 2.7, 1.3, 1.7], [-1.8, 2.9, 1.1, 1.1]],
    roller: [4.7, 9.9], pegboard: [-0.2, 2.6],
    props: [
      { m: 'cardboardBoxOpen', x: 6.2, z: -4.9, ry: 0.3, s: 1.6, b: [1.5, 1.4] }, { m: 'cardboardBoxOpen', x: 7.7, z: -5.1, ry: -0.2, s: 1.4, b: [1.3, 1.2] }, { m: 'cardboardBoxOpen', x: 6.9, z: -3.8, ry: 1.1, s: 1.2, b: [1.1, 1.0] },
      { m: 'cardboardBoxOpen', x: 6.2, z: -4.9, y: 0.9, ry: 1.0, s: 1.2 }, { m: 'cardboardBoxOpen', x: -7.2, z: 3.3, ry: 0.6, s: 1.3, b: [1.2, 1.1] }, { m: 'speaker', x: 0.9, z: 2.2, s: 1.5, b: [0.6, 0.6] }, { m: 'lampRoundFloor', x: 2.0, z: 6.0, tint: 'lamp' },
    ],
    bulbs: true,
  },
  // Most of the room is sofas and rugs. The desks hug the edges and the meeting happens round the coffee table.
  lounge: {
    label: 'Lounge', blurb: 'Sofas in the middle, desks round the edge.',
    windows: [[-9.2, -3.1], [2.3, 9.4]],
    desks: [[-8.5, -5.3, 0], [-5.1, -5.3, 0], [3.6, -5.3, 0], [7.0, -5.3, 0], [-9.5, -0.4, Q], [-9.5, 2.6, Q], [-2.2, 5.6, HALF], [2.8, 5.6, HALF]],
    manager: [-6.4, 5.4, HALF], boss: [6.6, 5.4, HALF],
    board: -0.4,
    meet: { table: [0.5, 0.8], glass: null, kind: 'lounge', size: [1, 1], block: [2.2, 1.5], chairs: [], stand: [0.5, -2.75],
      spots: [[-4.4, -1.6], [-1.6, -2.65], [2.6, -2.65], [5.4, -1.6], [-4.7, 0.8], [5.7, 0.8], [-3.6, 3.95], [4.6, 3.95]] },
    console: null, shelf: [-10.3, -3.2], coffee: [10.2, -0.6], fridge: [10.2, -3.7], arcade: [-9.7, 5.9], printer: [-9.9, 4.5], coat: [-7.3, -3.3],
    sofa: null, hang: [-0.4, 3.75, 0], pet: [0.5, 3.8],
    plants: [[10.3, 6.2, -1.0, -1.0], [-6.8, -6.2, 0, 1.2], [-4.8, -3.0, 0.8, 0.3], [5.8, -3.0, -1.0, 0.3], [10.4, 4.9, -1.0, 0], [-4.3, 5.8, 0, -1.0], [0.3, 5.8, 0, -1.0], [4.5, 5.9, 0, -1.0]],
    rugs: [[0.5, 0.8, 9.2, 6.2, 'big']],
    art: [[6.0, 2.6, 1.3, 1.6], [-1.4, 2.8, 1.5, 1.15]],
    props: [
      { m: 'loungeDesignSofa', x: 0.5, z: -1.5, ry: 0, s: 1.25, tint: 'primary', b: [4.6, 1.5] },
      { m: 'loungeSofa', x: 0.5, z: 3.05, ry: HALF, s: 1.0, tint: 'primary', b: [4.0, 1.1] },
      { m: 'loungeChair', x: -3.3, z: 0.8, ry: Q, s: 1.05, tint: 'accent', b: [1.3, 1.3] }, { m: 'loungeChair', x: 4.3, z: 0.8, ry: -Q, s: 1.05, tint: 'accent', b: [1.3, 1.3] },
      { m: 'tableCoffee', x: 0.5, z: 0.8, s: 1.3 }, { m: 'lampRoundFloor', x: -3.3, z: -1.6, tint: 'lamp', b: [0.6, 0.6] }, { m: 'lampRoundFloor', x: 4.4, z: -1.6, tint: 'lamp', b: [0.6, 0.6] },
      { m: 'speaker', x: -3.4, z: 2.9, s: 1.1, b: [0.6, 0.6] }, { m: 'speaker', x: 4.4, z: 2.9, s: 1.1, b: [0.6, 0.6] },
      { m: 'pillow', x: -0.7, y: 0.55, z: -1.55, ry: 0.2, s: 1.0, tint: 'accent' }, { m: 'pillowBlue', x: 1.7, y: 0.55, z: -1.55, ry: -0.2, s: 1.0, tint: 'cream' },
      { m: 'stoolBar', x: 8.6, z: 2.6, tint: 'accent' }, { m: 'stoolBar', x: 8.6, z: 3.6, tint: 'accent' },
    ],
    bar: [9.6, 3.1],
  },
  // Team pods on their own carpets, with a glass room in the corner and two offices of sorts.
  pods: {
    label: 'Pods', blurb: 'Teams of four, back to back, with a corner glass room.',
    windows: [[-9.8, -6.0], [-4.9, 2.1]],
    // Filled pod by pod in turn, so a small team doesn't all sit at one end of the room.
    desks: [[-4.95, 1.95, HALF], [2.05, 1.95, HALF], [-2.25, 3.65, 0], [4.75, 3.65, 0], [-2.25, 1.95, HALF], [4.75, 1.95, HALF], [-4.95, 3.65, 0], [2.05, 3.65, 0]],
    manager: [-7.9, -3.9, 0], boss: [-1.4, -3.9, 0],
    board: 6.2,
    meet: { table: [6.2, -4.75], glass: { x0: 3.2, x1: 9.2, z0: -6.8, z1: -3.0, door: [5.0, 7.4] }, size: [1.5, 1.5], block: [3.4, 1.3],
      chairs: [[4.15, -4.75, Q], [8.25, -4.75, -Q], [5.2, -3.95, HALF], [7.0, -3.95, HALF]], stand: [5.9, -5.95],
      spots: [[3.9, -3.5], [6.25, -3.45], [8.5, -3.5], [4.9, -2.35], [7.5, -2.35], [6.2, -1.6], [3.7, -2.4], [8.7, -2.4]] },
    console: -2.3, shelf: [-10.3, 2.4], coffee: [10.2, 2.2], fridge: [10.2, -1.5], arcade: [-9.8, 6.0], printer: [-9.9, 4.5], coat: [-10.1, -1.0],
    sofa: [7.9, 5.3], hang: [0, -1.6, 0], pet: [-0.2, 0.2],
    plants: [[-10.4, -6.1, 0.9, 0.7], [1.9, -6.1, 0.0, 0.9], [-0.1, 2.8, 0, -1.6], [-7.4, 2.8, -0.9, 0], [-5.0, -6.1, 0, 0.9], [-7.2, 6.2, 0.9, -0.3], [-0.1, 6.2, 0.9, -0.3], [10.3, -6.1, 0, 1.0]],
    rugs: [],
    pods: [[-3.6, 2.8], [3.4, 2.8]],
    art: [[5.6, 2.5, 1.4, 1.75], [-5.6, 2.6, 1.5, 1.15]],
  },
};
export const planFor = (id) => PLANS[id] || PLANS.open;

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
export const hasSofa = (plan, staffCount) => !!plan.sofa && staffCount < (plan.sofaUntil ?? Infinity);

/** Every rectangle a person can't walk through, apart from the staff desks, which arrive one at a time. Each is [x, z, w, d, bake]. */
export function planBlocks(plan, { coffee = true, arcade = false, plants = 0, staffCount = 0, neon = true } = {}) {
  const out = [];
  const m = plan.meet; const wallZ = -ROOM_D / 2, wallX = -ROOM_W / 2;
  const [tx, tz] = m.table;
  if (m.glass) {
    const g = m.glass;
    for (const x of [g.x0, g.x1]) out.push([x, (g.z0 + g.z1) / 2, 0.3, g.z1 - g.z0, false]);
    for (const [a, b] of [[g.x0, g.door[0]], [g.door[1], g.x1]]) out.push([(a + b) / 2, g.z1, b - a, 0.3, false]);
  }
  out.push([tx, tz, m.block[0], m.block[1], true]);
  out.push([plan.board, wallZ + 0.12, 4.6, 0.2, false]);
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
  if (hasSofa(plan, staffCount)) add('sofa', plan.sofa[0] - 2.9, plan.sofa[1] + 0.2); else add('hang', plan.hang[0], plan.hang[1]);
  return spots;
}
