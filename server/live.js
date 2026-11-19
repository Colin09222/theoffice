// The live tower and the activity feed (round 2, r2-j36; docs/redesign/OFFICE-ANSWERS-2.md, Q1). Three true signals for the tower on the home
// page, public and cheap, polled every few seconds by the page:
//   - work: a floor's room light. 1 while a job runs (a task being worked on), else 0. Brighter and flickering on the tower.
//   - launchAt: when the floor last put something public live. A newer one than the page has seen flashes that floor's windows once (0.8 s).
//   - visits: the floor's small sign light, real visits in the last 24 hours in 4 levels: 0, 1 to 50, 51 to 200, over 200.
// Plus a small public activity feed: Happening now's own lines (jobcards and launches, already free of money and private work), as kind, floor
// number and time, with the line's words only where Happening now already shows them.
//
// A hidden floor still lights its own windows when a job runs there (only its number and the light: no name, no line, no visits). A demo floor
// lights nothing, because its work is not real. No model, no money, no names of hidden floors. LIVE_TOWER=0 turns the address off.
import { all, get } from './db.js';

const DAY = 86400000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
/** The visit sign light's level for a count of real visits in 24 hours: 0, 1 to 50, 51 to 200, over 200. */
export const visitLevel = (n) => (n > 200 ? 3 : n > 50 ? 2 : n > 0 ? 1 : 0);

/** The tower's signals for every floor that shows on it (1 to towerFloors). */
export function liveFloors(db, cfg, { now = Date.now() } = {}) {
  const rows = all(db, "SELECT id, number, hidden, filler, status FROM floors WHERE status = 'active' AND number <= ?", cfg.towerFloors ?? 10);
  const from = dayOf(now - DAY);
  const out = [];
  for (const f of rows) {
    if (f.filler && !cfg.demoFloorsPublic) continue;
    const work = get(db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='doing'", f.id).n > 0 ? 1 : 0;
    if (f.hidden) { out.push({ number: f.number, work, launchAt: null, visits: 0 }); continue; }
    const launchAt = get(db, 'SELECT MAX(published_at) t FROM projects WHERE floor_id=? AND private=0 AND published_at IS NOT NULL', f.id).t ?? null;
    // Real visits (the Numbers tab's own count: unique visitors a day, bots left out) to the floor's public work, over the last 24 hours. The
    // count is kept by day, so "the last 24 hours" is today and yesterday's rows (New York days are not needed: it is a level, not a number).
    const visits = get(db, `SELECT COALESCE(SUM(v.uniques),0) n FROM app_visits v JOIN projects p ON p.floor_id = v.floor_id AND p.slug = v.project
      WHERE v.floor_id=? AND v.day >= ? AND p.private = 0`, f.id, from).n;
    out.push({ number: f.number, work, launchAt, visits: visitLevel(visits) });
  }
  return out.sort((a, b) => a.number - b.number);
}

export function installLive(ext) {
  const { db, cfg, now, GET, json, HttpError } = ext;
  GET('/api/building/live', async ({ res }) => {
    if (cfg.liveTower === false) throw new HttpError(404, 'not_found');
    const t = now();
    // The feed: Happening now's lines, the same rules (real work only, one line per job, a day at most, no private work, no demo floors).
    const feed = (ext.happeningNow?.().items || []).slice(0, 5).map((i) => ({ id: i.id, kind: i.kind, floor: i.floor.number, text: i.text, ts: i.ts }));
    json(res, 200, { floors: liveFloors(db, cfg, { now: t }), feed, ts: t });
  });
  return null;
}
