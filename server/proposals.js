// Numbers to actions (round 2, r2-j64; docs/redesign/OFFICE-ANSWERS-2.md, Q10 c, with b as its menu). Mondays 08:30 New York, each active floor
// gets one proposal: one change, one reason, and the number behind it. The boss taps Yes or No on the status card; no reply in 7 days drops it.
// The number is picked by code from real records ("getting found" first: real visits to the floor's main launch, this week against last); one
// short manager call per floor per week writes the change and the reason, with the numbers fenced as data. Yes hands the change to the team as
// one ordinary job; No closes it. Anything public outside the site (a business profile, a directory listing) still needs the boss's own tap when
// the team gets there (Q10): the proposal never does it by itself.
// Skipped: floors switched out of weekly plans (round 1's admin.mjs plan --floor N off), demo floors and paused floors. PROPOSALS=0 turns it off.
import { get, all, run } from './db.js';
import { nyParts } from '../public/js/nylight.js';
import { floorOff, weekOf } from './weekplan.js';

const DAY = 86400000;
export const DROP_MS = 7 * DAY;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const one = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const fence = (source, text) => `<untrusted_data source="${source}">${String(text).replace(/<\/?\s*untrusted_data/gi, '[untrusted_data')}</untrusted_data>`;

/** The number behind this week's proposal, by code: real visits to the floor's most visited public launch, last 7 days against the 7 before. */
export function numberFor(db, f, now = Date.now()) {
  const sum = (from, to) => all(db, `SELECT p.slug, p.title, COALESCE(SUM(v.uniques),0) n FROM projects p LEFT JOIN app_visits v ON v.floor_id=p.floor_id AND v.project=p.slug AND v.day >= ? AND v.day < ?
    WHERE p.floor_id=? AND p.private=0 AND p.published_at IS NOT NULL GROUP BY p.slug ORDER BY n DESC, p.published_at DESC`, dayOf(from), dayOf(to), f.id);
  const week = sum(now - 7 * DAY, now), before = new Map(sum(now - 14 * DAY, now - 7 * DAY).map((r) => [r.slug, r.n]));
  const top = week[0];
  if (!top) return { metric: 'launches', project: '', baseline: 0, number: 'Nothing launched yet: 0 real visits.' };
  return { metric: 'visits', project: top.slug, baseline: top.n, title: top.title, number: `${top.title}: ${top.n.toLocaleString('en-US')} real visits in the last 7 days (${(before.get(top.slug) || 0).toLocaleString('en-US')} the week before).` };
}
const isProposalTime = (t) => { const p = nyParts(t); return p.weekday === 1 && p.hour * 60 + p.minute >= 8 * 60 + 30; };

export function installProposals(ext) {
  const { db, cfg, engine, now, log = () => {}, hooks, POST, json, readJson, requireOwner, HttpError } = ext;
  let busy = false;
  const skip = (f) => (f.filler ? 'demo' : f.paused ? 'paused' : floorOff(db, f.id) ? 'plan off' : null);
  async function propose(f, week) {
    const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
    if (!mgr) return null;
    const n = numberFor(db, f, now());
    // Claimed before the call: at most one proposal (and one call) a floor a week, however many ticks run.
    if (!run(db, "INSERT OR IGNORE INTO floor_proposals (floor_id,week,change,reason,number,metric,project,baseline,status,created_at) VALUES (?,?,'','',?,?,?,?,'drafting',?)", f.id, week, n.number, n.metric, n.project, n.baseline, now()).changes) return null;
    const id = get(db, 'SELECT id FROM floor_proposals WHERE floor_id=? AND week=?', f.id, week).id;
    try {
      const system = 'You are the manager of a tiny company. Propose ONE change for this week, with ONE reason, based on the number given. Prefer getting found first (being listed, searchable, shared), then making the main page do its job. One change the team can make in a day or two. No prices, no spending, nothing that goes public outside the site without the boss. Reply with JSON only: {"change": "...", "reason": "..."}, each under 160 characters.';
      const user = `The number: ${fence('numbers', n.number)}\nThe company: ${fence('floor', `${f.name || ''} ${f.tagline || ''}`)}`;
      const res = await engine.callLLM({ floorId: f.id, agent: mgr, project: '', tier: engine.floorTier ? engine.floorTier(f.id) : '' }, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], tools: [], meta: { kind: 'proposal', floorId: f.id, floorSlug: f.slug } });
      let d = null; try { d = JSON.parse(String(res.content).replace(/^```(?:json)?|```$/g, '').trim()); } catch { /* unreadable: no proposal this week */ }
      const change = one(d?.change, 160), reason = one(d?.reason, 200);
      if (!change || !reason) { run(db, "UPDATE floor_proposals SET status='failed' WHERE id=?", id); return null; }
      run(db, "UPDATE floor_proposals SET change=?, reason=?, line=?, status='open' WHERE id=?", change, reason, `${change} (${reason})`, id);
      engine.emit(f.id, 'proposal', { id }, { persist: false, ownerOnly: true });
      return get(db, 'SELECT * FROM floor_proposals WHERE id=?', id);
    } catch (e) {
      run(db, "UPDATE floor_proposals SET status='failed' WHERE id=?", id);
      log('warn', 'proposal failed', { floor: f.number, err: String(e?.message || e).slice(0, 160) });
      return null;
    }
  }
  async function tick() {
    if (busy) return [];
    busy = true;
    const out = [];
    try {
      const t = now();
      // No reply in 7 days drops it.
      run(db, "UPDATE floor_proposals SET status='dropped', decided_at=? WHERE status='open' AND created_at <= ?", t, t - DROP_MS);
      if (cfg.proposals === false || !isProposalTime(t)) return out;
      const week = weekOf(t);
      for (const f of all(db, "SELECT * FROM floors WHERE status='active' ORDER BY number")) {
        if (skip(f)) continue;
        const p = await propose(f, week);
        if (p) out.push({ floor: f.number, id: p.id });
      }
    } finally { busy = false; }
    return out;
  }
  // The boss's Yes or No. Yes: one ordinary job for the team, under the proposal's own plan name. No: closed. Either way, once.
  POST('/api/floors/:slug/proposal/:id', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    const b = await readJson(req, 1024);
    if (!['yes', 'no'].includes(b.answer)) throw new HttpError(400, 'bad_answer', 'Answer yes or no.');
    const pr = /^\d{1,12}$/.test(p.id) ? get(db, "SELECT * FROM floor_proposals WHERE id=? AND floor_id=? AND status='open'", Number(p.id), f.id) : null;
    if (!pr) throw new HttpError(404, 'not_found', 'That proposal is no longer open.');
    let taskId = null;
    if (b.answer === 'yes') {
      const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
      const t = engine.assignTask(f, mgr, { to: 'builder', title: pr.change, brief: `The boss said yes to this week's proposal. ${pr.change} Why: ${pr.reason} The number behind it: ${pr.number} Anything that goes public outside the site (a business profile, a directory listing) needs the boss's own tap first.`, plan: `Proposal: ${pr.change}`.slice(0, 120), project: pr.project || undefined, dependsOn: [], afterPrevious: false });
      taskId = t?.id ?? null;
      engine.kick?.();
    }
    run(db, 'UPDATE floor_proposals SET status=?, decided_at=?, task_id=? WHERE id=?', b.answer, now(), taskId, pr.id);
    json(res, 200, { ok: true, status: b.answer, taskId });
  });
  // The boss's status card carries the open proposal. A visitor's never does.
  hooks.snapshot.push((f, viewer, out) => {
    if (!viewer.owner || !out.status) return;
    const pr = get(db, "SELECT id, change, reason, number, created_at FROM floor_proposals WHERE floor_id=? AND status='open' ORDER BY id DESC LIMIT 1", f.id);
    if (pr) out.status.proposal = { id: pr.id, change: pr.change, reason: pr.reason, number: pr.number, dropsAt: pr.created_at + DROP_MS };
  });
  let timer = null;
  const api = { tick, propose, start() { timer = setInterval(() => { tick().catch(() => {}); }, cfg.proposalsTickMs ?? 60000); timer.unref?.(); }, stop() { clearInterval(timer); } };
  engine.r2b && (engine.r2b.proposals = api);
  return api;
}
