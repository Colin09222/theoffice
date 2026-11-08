// The lift with no doors. The floors either side of the one on screen are fetched ahead while it is looked at, and a floor the lift has
// just left is kept as it is, room and people and all, for a minute or so: going back is instant, and going on starts from data already here.
// Each floor's live stream replays from where its data left off, so nothing held here goes stale on screen.
import { api } from './dom.js';

const ahead = new Map();   // slug -> { at, state: Promise }
const parked = new Map();  // slug -> { view, at }
const FRESH = 30000, KEEP = 90000;

/** Fetches a floor's data ahead of a visit, once in a while at most. */
export function prefetchFloor(slug) {
  const a = ahead.get(slug);
  if (a && performance.now() - a.at < FRESH / 2) return;
  ahead.set(slug, { at: performance.now(), state: api(`/floors/${slug}`).catch(() => null) });
  if (ahead.size > 6) ahead.delete(ahead.keys().next().value);
}
/** A floor's data fetched ahead, without taking it: for building its room ahead. */
export function peekAhead(slug) { const a = ahead.get(slug); return a && performance.now() - a.at < FRESH ? a.state : Promise.resolve(null); }
export const isParked = (slug) => parked.has(slug);
/** Which way the lift went last: the floor that way is the one a phone builds ahead. */
export const lift = { dir: 1 };
/** A floor's data fetched ahead and still fresh, or null. Taken once. */
export async function aheadState(slug) {
  const a = ahead.get(slug); ahead.delete(slug);
  return a && performance.now() - a.at < FRESH ? a.state : null;
}
/** Keeps a floor's room for a quick way back. Its input is unbound, its tags taken off the page; the stage lets it go with the next view. */
export function park(slug, view, max = 2, keep = '') {
  const old = parked.get(slug); if (old && old.view !== view) old.view.destroy();
  view.unbind?.(); view.unbind = null;
  for (const a of view.actors.values()) a.tag.remove();
  parked.delete(slug); parked.set(slug, { view, at: performance.now() });
  // Over the limit, the longest kept goes first, but never the floor the lift is on its way to.
  while (parked.size > max) {
    const k = [...parked.keys()].find((x) => x !== keep && x !== slug); if (!k) break;
    const p = parked.get(k); parked.delete(k); p.view.destroy();
  }
}
/** A floor's parked room if it is still there and recent enough, else null (and anything stale is thrown away). */
export function unpark(slug) {
  for (const [k, p] of parked) if (performance.now() - p.at > KEEP) { parked.delete(k); p.view.destroy(); }
  const p = parked.get(slug); parked.delete(slug);
  return p && !p.view.dead ? p.view : null;
}
