// The floor room's round 2 data (docs/redesign/OFFICE-ANSWERS-2.md, lane A): what the room shows besides its people, from rows the server already
// keeps. Every value here is a real record; nothing calls a model. The snapshot carries it as `room`, for the boss and visitors alike, so it must
// never hold money, private work or anything a visitor may not see.

/** The room's part of a floor's snapshot. Later jobs add their pieces here. */
export function roomView(db, cfg, f, viewer) {
  return { idleLife: cfg.idleLife !== false };
}

export function installRoom(ext) {
  const { db, cfg, hooks } = ext;
  hooks.snapshot.push((f, viewer, out) => { out.room = roomView(db, cfg, f, viewer); });
  return null;
}
