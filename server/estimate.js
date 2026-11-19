// Estimates, shown only (docs/redesign/ROUND1-REST.md, job 21; the owner's no-budget ruling of 2026-11-19). A job's estimate is the median cost of
// the last 10 finished jobs of the same kind on the building (game, website, local service site with a form, business or shop, or an edit), from
// each job's own task costs (tasks.cost_usd, the sum of its ledger rows). Until there are 10, the spec's Q7 starting prices. Code only: no model.
// The boss sees one plain line, "This will cost about $X.", on the job's card and under Now. It never asks for a click, never holds a job, never
// stops one at any multiple, and never reaches a prompt, a tool result or anything a bot reads. Visitors never see it. JOB_ESTIMATES=0 hides it.
import { get, all, run } from './db.js';

export const SAMPLE = 10;
/** The spec's Q7 starting prices, used until a kind has 10 finished jobs. A range is shown by its middle. */
export const STARTING = {
  edit: { usd: 0.4, words: 'an edit' },
  game: { usd: 2, low: 1, high: 3, words: 'an arcade game' },
  website: { usd: 1, words: 'a one-page website' },
  service: { usd: 2, words: 'a local service site with a booking form' },
  business: { usd: 3, low: 2, high: 4, words: 'a business or shop, first pass' },
};
const FORMISH = /\b(booking|book a|appointment|reserv|contact form|sign[- ]?up form|enquir|inquir|quote form|form)\b/i;

/** What kind of job the tasks make: an edit when every step is a small change, else by lane (and a website with a form is a service site). */
export function kindOf(tasks) {
  if (tasks.length && tasks.every((t) => t.size === 'small')) return 'edit';
  const lane = tasks.map((t) => t.lane).find(Boolean) || '';
  if (lane === 'game') return 'game';
  if (['business', 'shop', 'app'].includes(lane)) return 'business';
  if (tasks.some((t) => FORMISH.test(`${t.title || ''} ${t.brief || ''}`))) return 'service';
  return 'website';
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const tasksOfCard = (db, ids) => { let list = []; try { list = JSON.parse(ids || '[]'); } catch { /* none */ } return list.length ? all(db, `SELECT id, lane, size, title, brief, cost_usd, status FROM tasks WHERE id IN (${list.map(() => '?').join(',')})`, ...list) : []; };

/** The estimate for a kind of job: { usd, basis: 'median' | 'starting', n }. */
export function estimateFor(db, kind) {
  const done = all(db, "SELECT task_ids FROM job_cards WHERE state='done' ORDER BY done_at DESC, id DESC LIMIT 400");
  const costs = [];
  for (const c of done) {
    const tasks = tasksOfCard(db, c.task_ids).filter((t) => t.status !== 'cancelled');
    if (!tasks.length || kindOf(tasks) !== kind) continue;
    const usd = tasks.reduce((s, t) => s + (t.cost_usd || 0), 0);
    if (usd > 0) costs.push(usd);
    if (costs.length >= SAMPLE) break;
  }
  if (costs.length >= SAMPLE) return { usd: Math.round(median(costs) * 100) / 100, basis: 'median', n: costs.length };
  return { usd: (STARTING[kind] || STARTING.website).usd, basis: 'starting', n: costs.length };
}

/** The line the boss reads. Under a dollar in cents; otherwise whole dollars. */
export function estimateLine(usd) {
  const n = Number(usd);
  if (!(n > 0)) return '';
  return `This will cost about $${n < 1 ? n.toFixed(2) : String(Math.max(1, Math.round(n)))}.`;
}

/** The tasks of the job a task belongs to (the plan and project it was handed out under, like server/jobcards.js), oldest first. */
function jobTasks(db, t) {
  return t.plan
    ? all(db, "SELECT id, lane, size, title, brief, status, transcript, cost_usd FROM tasks WHERE floor_id=? AND plan=? AND project=? AND status!='cancelled' ORDER BY id", t.floor_id, t.plan, t.project || '')
    : all(db, 'SELECT id, lane, size, title, brief, status, transcript, cost_usd FROM tasks WHERE id=?', t.id);
}
/**
 * Puts the job's estimate on every one of its tasks (tasks.job_est_usd, job_est_kind, job_est_basis) when a task is handed out. While no step has
 * started it is worked out again as steps are added; once one has, it stays as it was, so it can be compared with what the job really cost.
 */
export function recordJobEstimate(db, taskId) {
  const t = get(db, 'SELECT id, floor_id, plan, project FROM tasks WHERE id=?', taskId);
  if (!t) return null;
  const tasks = jobTasks(db, t);
  const started = tasks.some((x) => x.status !== 'todo' || x.transcript || x.cost_usd > 0);
  const had = get(db, `SELECT job_est_usd usd, job_est_kind kind, job_est_basis basis FROM tasks WHERE id IN (${tasks.map(() => '?').join(',')}) AND job_est_usd IS NOT NULL ORDER BY id LIMIT 1`, ...tasks.map((x) => x.id));
  const est = started && had ? had : (() => { const kind = kindOf(tasks); const e = estimateFor(db, kind); return { usd: e.usd, kind, basis: e.basis }; })();
  for (const x of tasks) run(db, 'UPDATE tasks SET job_est_usd=?, job_est_kind=?, job_est_basis=? WHERE id=?', est.usd, est.kind, est.basis, x.id);
  return est;
}

/** The estimate the boss sees on a job card (from its tasks), or null. */
export function cardEstimate(db, card) {
  let ids = []; try { ids = JSON.parse(card?.task_ids || '[]'); } catch { /* none */ }
  if (!ids.length) return null;
  const r = get(db, `SELECT job_est_usd usd, job_est_kind kind FROM tasks WHERE id IN (${ids.map(() => '?').join(',')}) AND job_est_usd IS NOT NULL ORDER BY id LIMIT 1`, ...ids);
  return r ? { usd: r.usd, kind: r.kind, line: estimateLine(r.usd) } : null;
}

/**
 * Hooks the estimate onto what the boss sees, and only that: the boss's snapshot (job cards and Now) and the boss-only job card events. A visitor's
 * snapshot and the public card events are left alone; nothing is added to a task view, a prompt or a tool result.
 */
export function installEstimates({ db, cfg, engine, hooks }) {
  if (!engine) return null;
  const decorate = (card) => { if (!card || !card.id) return card; const r = get(db, 'SELECT task_ids FROM job_cards WHERE id=?', card.id); const e = r && cardEstimate(db, r); return e ? { ...card, estimate: e } : card; };
  hooks.snapshot.push((f, viewer, out) => {
    if (cfg.jobEstimates === false || !viewer.owner) return;
    if (Array.isArray(out.jobs)) out.jobs = out.jobs.map(decorate);
    if (out.status?.now) {
      const open = get(db, "SELECT * FROM job_cards WHERE floor_id=? AND state NOT IN ('done','failed','cancelled') ORDER BY updated_at DESC, id DESC LIMIT 1", f.id);
      const e = open && cardEstimate(db, open);
      if (e) out.status = { ...out.status, now: { ...out.status.now, estimate: e } };
    }
  });
  const emit = engine.emit.bind(engine);
  engine.emit = (floorId, type, data, opts = {}) => emit(floorId, type, type === 'jobcard' && opts.ownerOnly && cfg.jobEstimates !== false ? decorate(data) : data, opts);
  return null;
}
