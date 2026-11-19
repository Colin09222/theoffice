// The Friday feature (round 2, r2-j68; docs/redesign/OFFICE-ANSWERS-2.md, Q16). Fridays 16:00 to 23:00 New York time, and only if something
// shipped in the building that week: the floor with the most real visits this week is featured. Its crown is lit, its launches go on the
// billboard, and one cheer plays when a visitor opens its room. Praise only: one floor, never a ranked list, never another floor's numbers. In a
// week where nothing shipped there is no party, and the billboard runs as normal. Demo and hidden floors take no part. FRIDAY=0 turns it off.
import { get, all } from './db.js';
import { nyParts } from '../public/js/nylight.js';
import { weekStartOf } from './thisweek.js';

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const isFridayEvening = (t) => { const p = nyParts(t); return p.weekday === 5 && p.hour >= 16 && p.hour < 23; };

/** The featured floor now, or null. */
export function featured(db, cfg, t) {
  if (cfg.friday === false || !isFridayEvening(t)) return null;
  const from = weekStartOf(t).at;
  const ok = `f.status='active' AND f.hidden=0 AND (f.filler=0 OR ${cfg.demoFloorsPublic ? 1 : 0})`;
  // Something shipped this week: a public launch, or a job done on a public launched project.
  const shipped = get(db, `SELECT 1 x FROM projects p JOIN floors f ON f.id=p.floor_id WHERE ${ok} AND p.private=0 AND p.published_at >= ? AND p.published_at <= ? LIMIT 1`, from, t)
    || get(db, `SELECT 1 x FROM job_cards c JOIN floors f ON f.id=c.floor_id JOIN projects p ON p.floor_id=c.floor_id AND p.slug=c.project
      WHERE ${ok} AND c.state='done' AND c.done_at >= ? AND c.done_at <= ? AND p.private=0 AND p.published_at IS NOT NULL LIMIT 1`, from, t);
  if (!shipped) return null;
  const top = get(db, `SELECT f.id, f.number, f.slug, f.name, SUM(v.uniques) n FROM app_visits v JOIN projects p ON p.floor_id=v.floor_id AND p.slug=v.project JOIN floors f ON f.id=v.floor_id
    WHERE ${ok} AND p.private=0 AND v.day >= ? GROUP BY f.id HAVING n > 0 ORDER BY n DESC, f.number LIMIT 1`, dayOf(from));
  return top ? { id: top.id, number: top.number, slug: top.slug, name: top.name } : null;
}

export function installFriday(ext) {
  const { db, cfg, now, GET, json, BASE } = ext;
  GET('/api/building/friday', async ({ res }) => {
    const f = featured(db, cfg, now());
    if (!f) return json(res, 200, { on: false, ts: now() });
    // Its launches for the billboard (screenshots only), newest first, 3 at most. No counts: praise, not a table.
    const launches = all(db, `SELECT p.slug, s.taken_at FROM projects p JOIN launch_shots s ON s.floor_id=p.floor_id AND s.project=p.slug AND s.image IS NOT NULL
      WHERE p.floor_id=? AND p.private=0 AND p.published_at IS NOT NULL ORDER BY p.published_at DESC LIMIT 3`, f.id).map((r) => ({ thumb: `${BASE}/api/building/shot/${f.slug}/${r.slug}?v=${r.taken_at}` }));
    json(res, 200, { on: true, floor: { number: f.number, slug: f.slug, name: f.name }, launches, line: `This week's busiest floor: ${f.name || `floor ${f.number}`}. Well done.`, ts: now() });
  });
  return null;
}
