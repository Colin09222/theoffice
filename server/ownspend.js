// A boss's own spend, behind a tap (docs/redesign/ROUND1-REST.md, job 34; spec section 9: "bosses see their own floor's spend, behind a tap").
// Their floor's dollars only: this week, last week and since the floor opened, split Claude / OpenRouter, and the latest few jobs with what
// each cost. Read straight from the ledger with job 5's week (Monday 00:00 New York). No gauge, no budget, nothing "left", no limits, no
// building totals and no model names: this only informs. The floor's snapshot and stream still carry no money; this is fetched on the tap.
// OWN_SPEND=0 takes the route away (the card's link goes with it).
import { get, all } from './db.js';
import { weekStart } from './spendcheck.js';

const JOBS = 5;
const usd = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The floor's own figures. `at` is now; weeks are the owner's (Monday 00:00 America/New_York), as in the spend record. */
export function ownSpend(db, floorId, at = Date.now()) {
  const thisWeek = weekStart(at), lastWeek = weekStart(thisWeek - 1);
  const sum = (from, to, provider = null) => get(db, `SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND created_at>=? AND created_at<?${provider ? ' AND provider=?' : ''}`,
    floorId, from, to, ...(provider ? [provider] : [])).n;
  const span = (from, to) => ({ totalUsd: usd(sum(from, to)), claudeUsd: usd(sum(from, to, 'anthropic')), openrouterUsd: usd(sum(from, to, 'openrouter')) });
  // The latest jobs, newest first, each with what its tasks cost (the ledger rows that name them).
  const jobs = all(db, 'SELECT id, title, state, task_ids, updated_at FROM job_cards WHERE floor_id=? ORDER BY updated_at DESC, id DESC LIMIT ?', floorId, JOBS).map((c) => {
    let ids = []; try { ids = JSON.parse(c.task_ids).map(Number).filter(Number.isFinite); } catch { /* none */ }
    const cost = ids.length ? get(db, `SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND task_id IN (${ids.map(() => '?').join(',')})`, floorId, ...ids).n : 0;
    return { title: c.title, state: c.state, costUsd: usd(cost), at: c.updated_at };
  });
  return { thisWeek: span(thisWeek, at + 1), lastWeek: span(lastWeek, thisWeek), sinceOpened: span(0, at + 1), weekStart: thisWeek, jobs };
}

export function installOwnSpend(ext) {
  const { db, cfg, now, GET, json, requireOwner, HttpError } = ext;
  GET('/api/floors/:slug/spend', async ({ req, res, p }) => {
    if (cfg.ownSpend === false) throw new HttpError(404, 'not_found');
    const f = requireOwner(req, p.slug);
    json(res, 200, ownSpend(db, f.id, now()));
  });
}
