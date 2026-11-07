// What makes an office someone's own. Pure data with no three.js: a role gives a room its floor, its paint and its furniture, and words in a
// person's persona or quirk add a touch more. Pieces named `m` are models from the furniture kit; `p` are drawn by the scene (see officeThing).
// Each piece goes in a named slot along the walls, from officeSlots in layouts.js. A slot the room doesn't have is simply skipped.
const T = {
  manager: { floor: 'parquet', wall: '#2f4258', things: [{ m: 'bookcaseClosedWide', slot: 'behindA' }, { m: 'loungeChairRelax', slot: 'sideA', s: 0.9 }, { m: 'sideTable', slot: 'nearA' }, { m: 'lampSquareFloor', slot: 'sideB' }, { p: 'orgchart' }, { m: 'rugRectangle', rug: true }] },
  boss: { floor: 'darkwood', wall: '#3a2c3f', things: [{ m: 'bookcaseClosed', slot: 'behindB' }, { m: 'loungeDesignChair', slot: 'sideA' }, { m: 'loungeDesignChair', slot: 'sideB' }, { m: 'televisionModern', slot: 'nearA', s: 0.8 }, { m: 'rugRound', rug: true }, { p: 'trophy' }] },
  builder: { floor: 'concrete', wall: '#3b4048', things: [{ p: 'rack', slot: 'behindA' }, { m: 'cardboardBoxClosed', slot: 'sideA', s: 1.2 }, { m: 'bookcaseOpenLow', slot: 'sideB' }, { m: 'radio', slot: 'nearA' }, { p: 'pegboard' }, { p: 'second-screen' }] },
  writer: { floor: 'darkwood', wall: '#8a6b4e', things: [{ m: 'bookcaseClosedWide', slot: 'behindA' }, { m: 'bookcaseClosedWide', slot: 'behindB' }, { m: 'loungeChairRelax', slot: 'sideA', s: 0.9 }, { m: 'lampSquareFloor', slot: 'nearA' }, { m: 'rugRound', rug: true }, { p: 'manuscript' }] },
  researcher: { floor: 'carpet', wall: '#2f6068', things: [{ m: 'bookcaseOpenLow', slot: 'behindA' }, { p: 'globe', slot: 'behindB' }, { m: 'sideTable', slot: 'sideA' }, { m: 'lampRoundFloor', slot: 'sideB' }, { p: 'scribbles' }] },
  designer: { floor: 'wood', wall: '#b5787c', things: [{ p: 'easel', slot: 'behindA' }, { m: 'plantSmall2', slot: 'behindB', s: 2 }, { m: 'chairRounded', slot: 'sideA' }, { m: 'lampSquareFloor', slot: 'sideB' }, { m: 'rugRounded', rug: true }, { p: 'moodboard' }] },
  analyst: { floor: 'carpet', wall: '#28406a', things: [{ m: 'sideTableDrawers', slot: 'behindA' }, { m: 'bookcaseOpenLow', slot: 'behindB' }, { m: 'tableRound', slot: 'sideA', s: 0.7 }, { m: 'pottedPlant', slot: 'nearB', s: 1.2 }, { p: 'charts' }, { p: 'second-screen' }] },
  marketer: { floor: 'terrazzo', wall: '#c96a4a', things: [{ m: 'televisionModern', slot: 'behindA', s: 0.8 }, { m: 'speakerSmall', slot: 'behindB', s: 1.4 }, { m: 'chairRounded', slot: 'sideA' }, { m: 'pottedPlant', slot: 'sideB', s: 1.3 }, { m: 'rugSquare', rug: true }, { p: 'posters' }] },
  tester: { floor: 'tile', wall: '#3f6b4f', things: [{ m: 'televisionVintage', slot: 'behindA', s: 0.9 }, { m: 'cardboardBoxClosed', slot: 'behindB', s: 1.1 }, { m: 'sideTableDrawers', slot: 'sideA' }, { m: 'bear', slot: 'nearA', s: 0.9 }, { p: 'bugboard' }] },
  illustrator: { floor: 'parquet', wall: '#5d4a7d', things: [{ p: 'easel', slot: 'behindA' }, { p: 'easel', slot: 'sideB' }, { m: 'tableRound', slot: 'sideA', s: 0.7 }, { m: 'plantSmall1', slot: 'nearA', s: 2 }, { m: 'rugRounded', rug: true }, { p: 'moodboard' }] },
  // A room nobody has yet: a bare desk, a box of someone's things on the way, and a doormat.
  vacant: { floor: 'carpet', wall: '#8d9299', things: [{ m: 'cardboardBoxClosed', slot: 'nearA', s: 1.1 }, { m: 'rugDoormat', rug: true }] },
};
const SPARE = ['researcher', 'analyst', 'designer', 'tester', 'marketer'];
// Words in someone's persona or quirk that add one more thing to the room, in the first free slot.
const TOUCHES = [
  [/\b(plants?|gardener|green|botan)/i, { m: 'pottedPlant', s: 1.2 }], [/\b(music|vinyl|band|guitar|playlist)/i, { m: 'speakerSmall', s: 1.4 }], [/\b(books?|reader|reads|novel|library)/i, { m: 'bookcaseOpenLow' }],
  [/\b(coffee|espresso|caffeine)/i, { m: 'tableRound', s: 0.6 }], [/\b(radio|news)/i, { m: 'radio' }], [/\b(hoard|messy|clutter|boxes)/i, { m: 'cardboardBoxClosed', s: 1.2 }], [/\b(teddy|bear|soft)/i, { m: 'bear', s: 0.9 }],
  [/\b(film|movie|tv|telly)/i, { m: 'televisionVintage', s: 0.9 }], [/\b(nap|lazy|comfy|sofa)/i, { m: 'loungeChairRelax', s: 0.9 }],
];
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const text = (info) => [info.persona, info.quirk, info.bio].filter((v) => typeof v === 'string').join(' ');

/** The room a person gets: the look of their role, or of a role picked from their id when it's one we have no look for. */
export function officeTheme(info) {
  const base = T[info.role] || T[SPARE[hash(info.id ?? info.name ?? '') % SPARE.length]];
  const things = [...base.things];
  const words = text(info); const used = new Set(things.map((t) => t.slot).filter(Boolean));
  for (const [re, piece] of TOUCHES) {
    if (!re.test(words)) continue;
    const slot = ['nearA', 'nearB', 'sideA', 'sideB', 'behindA', 'behindB'].find((s) => !used.has(s));
    if (!slot) break;
    used.add(slot); things.push({ ...piece, slot });
  }
  return { floor: base.floor, wall: base.wall, things };
}
/** How someone moves, the same every time for the same person: a gait, a walking pace and a way of standing about. */
export function manner(id) {
  const h = hash(id);
  return { pace: 2.3 + ((h % 9) / 8) * 0.6, sway: (h >> 4) % 3, lean: (((h >> 7) % 5) - 2) * 0.012, shift: 0.6 + ((h >> 10) % 5) * 0.12, stance: (h >> 13) % 4 };
}
/**
 * Picks everyone's room. A person keeps the room the server names when this plan has it; otherwise rooms go out in order. The ids are the
 * plan's own, since the server's `office-<role>` is about the person and not about any one layout.
 */
export function assignRooms(plan, agents, taken = new Map()) {
  const rooms = plan.rooms.filter((r) => r.kind === 'staff');
  const owners = new Map(taken); const held = new Set(owners.values());
  for (const a of agents) { if (owners.has(a.id)) continue; const r = rooms.find((x) => x.id === a.office); if (r && !held.has(r.id)) { owners.set(a.id, r.id); held.add(r.id); } }
  for (const a of agents) { if (owners.has(a.id)) continue; const r = rooms.find((x) => !held.has(x.id)); if (!r) continue; owners.set(a.id, r.id); held.add(r.id); }
  return owners;
}
