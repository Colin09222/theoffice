// The floor room's round 2 data (docs/redesign/OFFICE-ANSWERS-2.md, lane A): what the room shows besides its people, from rows the server already
// keeps. Every value here is a real record; nothing calls a model. The snapshot carries it as `room`, for the boss and visitors alike, so it must
// never hold money, private work or anything a visitor may not see.

import { all } from './db.js';

const BASE = '/theoffice';
const FRAMES_MAX = 8;

/**
 * r2-j32: the framed launches on the wall. Every public launch of this floor, newest first, at most 8, with how many there are in all for the
 * "+N" tag. A frame carries the real launch photo (server/shots.js) when there is one; otherwise the room paints a plain card with the title.
 * A demo floor's made-up launches never hang (launch walls are for real work), and a hidden floor's photos are not served, so it hangs cards.
 */
export function roomFrames(db, f) {
  if (f.filler) return { list: [], total: 0 };
  const rows = all(db, `SELECT p.slug, p.title, p.published_at, s.taken_at shot_at FROM projects p
    LEFT JOIN launch_shots s ON s.floor_id = p.floor_id AND s.project = p.slug AND s.image IS NOT NULL
    WHERE p.floor_id = ? AND p.published_at IS NOT NULL AND p.private = 0 ORDER BY p.published_at DESC, p.slug`, f.id);
  const list = rows.slice(0, FRAMES_MAX).map((r) => ({
    slug: r.slug, title: r.title || r.slug, at: r.published_at,
    shot: r.shot_at && !f.hidden && f.status === 'active' ? `${BASE}/api/building/shot/${f.slug}/${r.slug}?v=${r.shot_at}` : null,
  }));
  return { list, total: rows.length };
}

/** The room's part of a floor's snapshot. Later jobs add their pieces here. */
export function roomView(db, cfg, f, viewer) {
  return { idleLife: cfg.idleLife !== false, frames: cfg.roomFrames === false ? null : roomFrames(db, f) };
}

export function installRoom(ext) {
  const { db, cfg, hooks } = ext;
  hooks.snapshot.push((f, viewer, out) => { out.room = roomView(db, cfg, f, viewer); });
  return null;
}
