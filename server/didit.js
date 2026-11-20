// "Did it work?" (round 2, r2-j65; docs/redesign/OFFICE-ANSWERS-2.md, Q24 idea 2). Every shipped change records the number it aims at when it
// ships: a job that finished on a public, launched project aims at that project's real visits, and its number is the visits in the 7 days before
// it shipped. Seven days later, code compares the 7 days after and puts one line on that job's timeline card: "New gallery page: visits 649 to
// 702". Code only: no model, no money. The weekly proposal (r2-j64) reads these lines. DID_IT_WORK=0 turns it off.
import { get, all, run } from './db.js';

const DAY = 86400000;
export const AFTER_MS = 7 * DAY;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Real visits (unique visitors a day, bots left out: the Numbers tab's count) to one project over [from, to). */
export const visitsBetween = (db, floorId, project, from, to) => get(db, 'SELECT COALESCE(SUM(uniques),0) n FROM app_visits WHERE floor_id=? AND project=? AND day >= ? AND day < ?', floorId, project, dayOf(from), dayOf(to)).n;
export const resultLine = (title, before, after) => `${title}: visits ${before.toLocaleString('en-US')} to ${after.toLocaleString('en-US')}`;

export function installDidIt(ext) {
  const { db, cfg, now, hooks, engine } = ext;
  /** Record what shipped (done job cards on public launched projects, done in the last day) and post what is due. Returns what it did. */
  function tick() {
    if (cfg.didItWork === false) return { recorded: 0, posted: [] };
    const t = now();
    let recorded = 0;
    for (const c of all(db, `SELECT c.id, c.floor_id, c.project, c.title, c.done_at FROM job_cards c JOIN projects p ON p.floor_id = c.floor_id AND p.slug = c.project
        WHERE c.state='done' AND c.done_at IS NOT NULL AND c.done_at >= ? AND c.done_at <= ? AND p.private = 0 AND p.published_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM change_checks k WHERE k.card_id = c.id)`, t - DAY, t)) {
      const before = visitsBetween(db, c.floor_id, c.project, c.done_at - AFTER_MS, c.done_at);
      recorded += run(db, "INSERT OR IGNORE INTO change_checks (card_id,floor_id,project,title,metric,before_n,shipped_at,due_at) VALUES (?,?,?,?,'visits',?,?,?)", c.id, c.floor_id, c.project, c.title, before, c.done_at, c.done_at + AFTER_MS).changes;
    }
    const posted = [];
    for (const k of all(db, 'SELECT * FROM change_checks WHERE posted_at IS NULL AND due_at <= ?', t)) {
      const after = visitsBetween(db, k.floor_id, k.project, k.shipped_at, k.shipped_at + AFTER_MS);
      const line = resultLine(k.title, k.before_n, after);
      run(db, 'UPDATE change_checks SET after_n=?, line=?, posted_at=? WHERE card_id=?', after, line, t, k.card_id);
      posted.push({ card: k.card_id, line });
      engine.emit?.(k.floor_id, 'didit', { card: k.card_id, line }, { persist: false });
    }
    return { recorded, posted };
  }
  // The line rides on the job's own timeline card, for everyone who may see that card (a private job's card has no project, so no line).
  hooks.snapshot.push((f, viewer, out) => {
    if (!Array.isArray(out.jobs) || !out.jobs.length) return;
    const lines = new Map(all(db, "SELECT card_id, line FROM change_checks WHERE floor_id=? AND posted_at IS NOT NULL AND line != ''", f.id).map((r) => [r.card_id, r.line]));
    for (const c of out.jobs) if (lines.has(c.id) && c.project) c.didItWork = lines.get(c.id);
  });
  let timer = null;
  const api = { tick, start() { timer = setInterval(tick, cfg.didItWorkTickMs ?? 60000); timer.unref?.(); }, stop() { clearInterval(timer); } };
  if (engine.r2b) engine.r2b.didit = api;
  return api;
}
