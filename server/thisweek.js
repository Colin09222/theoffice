// "What we made this week" (round 2, r2-j66; docs/redesign/OFFICE-ANSWERS-2.md, Q12 a). A public page, built every Monday at 08:10 New York time for
// the week just ended (Monday to Sunday), from real records only: the launches, the changes shipped (each job that finished on a public launched
// project), their first and last real screenshots (before and after), and the real visits. A week where nothing shipped says so: "Quiet week.
// Nothing shipped. 2,241 visits to things made earlier." No model writes any of it. 12 weeks are kept. Demo floors, hidden floors and private
// work are left out, and there is no money in it. THIS_WEEK=0 turns it off.
import { get, all, run } from './db.js';
import { nyParts, nyOffsetMin } from '../public/js/nylight.js';

export const KEEP_WEEKS = 12;
const DAY = 86400000;
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
/** The Monday (New York) that starts the week holding `at`, and that Monday's 00:00 as an instant. */
export function weekStartOf(at) {
  const p = nyParts(at), back = (p.weekday + 6) % 7;
  const monday = iso(p.year, p.month, p.day - back);
  const [y, m, d] = monday.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 5);
  return { week: monday, at: Date.UTC(y, m - 1, d) - nyOffsetMin(guess) * 60000 };
}
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
export const quietLine = (visits) => `Quiet week. Nothing shipped. ${plural(visits, 'visit', 'visits')} to things made earlier.`;

/** The page for the week starting at `from` (an instant, Monday 00:00 New York). */
export function buildWeek(db, cfg, { from, base = '/theoffice', liveUrl = () => '' }) {
  const to = from + 7 * DAY;
  const floorOk = `f.status='active' AND f.hidden=0 AND (f.filler=0 OR ${cfg.demoFloorsPublic ? 1 : 0})`;
  const launches = all(db, `SELECT p.slug, p.title, p.kind, p.published_at, f.number, f.slug fslug, f.name, s.taken_at shot FROM projects p JOIN floors f ON f.id=p.floor_id
    LEFT JOIN launch_shots s ON s.floor_id=p.floor_id AND s.project=p.slug AND s.image IS NOT NULL
    WHERE ${floorOk} AND p.private=0 AND p.published_at >= ? AND p.published_at < ? ORDER BY p.published_at`, from, to)
    .map((r) => ({ title: r.title, kind: r.kind, at: r.published_at, floor: { number: r.number, slug: r.fslug, name: r.name }, url: liveUrl(r), shot: r.shot ? `${base}/api/building/shot/${r.fslug}/${r.slug}?v=${r.shot}` : null }));
  const changes = all(db, `SELECT c.id, c.title, c.done_at, c.project, f.number, f.slug fslug, f.name FROM job_cards c JOIN floors f ON f.id=c.floor_id JOIN projects p ON p.floor_id=c.floor_id AND p.slug=c.project
    WHERE ${floorOk} AND c.state='done' AND c.done_at >= ? AND c.done_at < ? AND p.private=0 AND p.published_at IS NOT NULL ORDER BY c.done_at`, from, to)
    .map((c) => {
      const shots = all(db, 'SELECT id FROM job_shots WHERE card_id=? AND image IS NOT NULL ORDER BY taken_at, id', c.id);
      const url = (s) => (s ? `${base}/api/floors/${c.fslug}/jobshot/${s.id}` : null);
      const line = get(db, "SELECT line FROM change_checks WHERE card_id=? AND posted_at IS NOT NULL AND line != ''", c.id)?.line || '';
      return { title: c.title, at: c.done_at, floor: { number: c.number, slug: c.fslug, name: c.name }, before: shots.length > 1 ? url(shots[0]) : null, after: url(shots.at(-1)), result: line };
    });
  const visits = get(db, `SELECT COALESCE(SUM(v.uniques),0) n FROM app_visits v JOIN projects p ON p.floor_id=v.floor_id AND p.slug=v.project JOIN floors f ON f.id=v.floor_id
    WHERE ${floorOk} AND p.private=0 AND v.day >= ? AND v.day < ?`, dayOf(from), dayOf(to)).n;
  const quiet = !launches.length && !changes.length;
  return { from, to, launches, changes, visits, quiet, line: quiet ? quietLine(visits) : `${plural(launches.length, 'launch', 'launches')}, ${plural(changes.length, 'change', 'changes')} shipped, ${plural(visits, 'real visit', 'real visits')}.` };
}

export function installThisWeek(ext) {
  const { db, cfg, engine, now, GET, json, HttpError } = ext;
  const liveUrl = (r) => engine.liveUrl({ id: get(db, 'SELECT id FROM floors WHERE slug=?', r.fslug)?.id, slug: r.fslug }, r.slug);
  /** Build the page for the week just ended, if it is Monday 08:10 New York or later and it isn't built yet; keep 12 weeks. */
  function tick() {
    if (cfg.thisWeek === false) return null;
    const t = now(), p = nyParts(t);
    const { at: thisMonday } = weekStartOf(t);
    if (t < thisMonday + (8 * 60 + 10) * 60000) return null;  // Monday 08:10 New York, then any time that week
    const last = weekStartOf(thisMonday - DAY);
    if (get(db, 'SELECT 1 x FROM week_pages WHERE week=?', last.week)) return null;
    const data = buildWeek(db, cfg, { from: last.at, liveUrl });
    run(db, 'INSERT OR IGNORE INTO week_pages (week,data,built_at) VALUES (?,?,?)', last.week, JSON.stringify(data), t);
    run(db, `DELETE FROM week_pages WHERE week NOT IN (SELECT week FROM week_pages ORDER BY week DESC LIMIT ${KEEP_WEEKS})`);
    void p;
    return last.week;
  }
  GET('/api/building/thisweek', async ({ res, url }) => {
    if (cfg.thisWeek === false) throw new HttpError(404, 'not_found');
    const weeks = all(db, 'SELECT week FROM week_pages ORDER BY week DESC').map((r) => r.week);
    const want = url.searchParams.get('week');
    const week = want && weeks.includes(want) ? want : weeks[0];
    const row = week ? get(db, 'SELECT data FROM week_pages WHERE week=?', week) : null;
    json(res, 200, { weeks, week: week || null, page: row ? JSON.parse(row.data) : null, ts: now() });
  });
  let timer = null;
  const api = { tick, start() { tick(); timer = setInterval(tick, cfg.thisWeekTickMs ?? 60000); timer.unref?.(); }, stop() { clearInterval(timer); } };
  if (engine.r2b) engine.r2b.thisweek = api;
  return api;
}
