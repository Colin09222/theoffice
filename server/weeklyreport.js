// The weekly floor report email (round 2, r2-j62; docs/redesign/OFFICE-ANSWERS-2.md, Q13). Mondays 09:00 New York time, one email to each boss
// with an address: what shipped last week, the real visits, and one suggestion. Built by code from real records: no model, no money. Sent through
// the building's existing mail sender (engine.mail.send), like the boss alerts.
//
// WEEKLY_REPORT_EMAIL ships OFF (ROUND2.md). With it off nothing is built, recorded or queued. It sends only on a Monday from 09:00 for that
// Monday's week, so turning it on mid-week sends nothing until the next Monday: no report is ever sent late.
import { get, all, run } from './db.js';
import { nyParts } from '../public/js/nylight.js';

const DAY = 86400000;
const iso = (p) => `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The report for one floor for the 7 days before `now`: shipped, visits, one suggestion. Pure reading of records. */
export function buildReport(db, f, { now = Date.now() } = {}) {
  const from = now - 7 * DAY;
  const shipped = all(db, 'SELECT slug, title, published_at FROM projects WHERE floor_id=? AND published_at IS NOT NULL AND published_at >= ? AND published_at < ? ORDER BY published_at', f.id, from, now);
  const changes = all(db, "SELECT title FROM job_cards WHERE floor_id=? AND state='done' AND done_at >= ? AND done_at < ? ORDER BY done_at", f.id, from, now);
  const byProject = all(db, `SELECT p.slug, p.title, COALESCE(SUM(v.uniques), 0) n FROM projects p LEFT JOIN app_visits v ON v.floor_id = p.floor_id AND v.project = p.slug AND v.day >= ? AND v.day < ?
    WHERE p.floor_id=? AND p.published_at IS NOT NULL GROUP BY p.slug ORDER BY n DESC, p.slug`, dayOf(from), dayOf(now), f.id);
  const visits = byProject.reduce((s, r) => s + r.n, 0);
  // One suggestion, by rule, from the same numbers (r2-j64 replaces it with the floor's own proposal when there is one this week).
  const proposal = get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name='floor_proposals'") ? get(db, "SELECT line FROM floor_proposals WHERE floor_id=? AND status='open' ORDER BY id DESC LIMIT 1", f.id)?.line : null;
  const quiet = byProject.find((r) => r.n === 0);
  const suggestion = proposal || (!shipped.length && !changes.length ? 'Nothing shipped last week. Pick one small change for this week and tell your manager.'
    : quiet ? `Nobody visited "${quiet.title}" last week. Share its link once, somewhere your customers already are.`
    : byProject[0] ? `"${byProject[0].title}" had the most visits (${plural(byProject[0].n, 'visit', 'visits')}). Ask your team for one change that helps it.` : 'Ask your team for one small change this week.');
  return { shipped: shipped.map((p) => p.title), changes: changes.map((c) => c.title), visits, byProject: byProject.slice(0, 5).map((r) => ({ title: r.title, visits: r.n })), suggestion };
}
export function reportText(f, r, link) {
  const lines = [`Your floor's week${f.name ? `, ${f.name}` : ''}.`, ''];
  lines.push(r.shipped.length ? `Shipped: ${r.shipped.join(', ')}.` : 'Shipped: nothing new last week.');
  if (r.changes.length) lines.push(`Jobs finished: ${r.changes.slice(0, 6).join('; ')}${r.changes.length > 6 ? ` and ${r.changes.length - 6} more` : ''}.`);
  lines.push(`Visits: ${plural(r.visits, 'real visit', 'real visits')} in the last 7 days${r.byProject.length ? ` (${r.byProject.map((p) => `${p.title} ${p.visits}`).join(', ')})` : ''}.`);
  lines.push('', `One suggestion: ${r.suggestion}`, '', `Open your floor: ${link}`);
  return lines.join('\n');
}

export function weeklyReports({ db, cfg, engine, now = () => Date.now(), log = () => {} }) {
  let busy = false;
  async function tick() {
    if (!cfg.weeklyReportEmail || busy) return [];
    const t = now(), p = nyParts(t);
    if (p.weekday !== 1 || p.hour < 9) return [];  // Mondays from 09:00 New York, that day only
    busy = true;
    const done = [];
    try {
      const week = iso(p);
      for (const f of all(db, "SELECT * FROM floors WHERE status='active' AND filler=0")) {
        const to = get(db, 'SELECT boss_email FROM mail_floor WHERE floor_id=?', f.id)?.boss_email || '';
        if (!to || get(db, 'SELECT 1 x FROM weekly_reports WHERE floor_id=? AND week=?', f.id, week)) continue;
        const r = buildReport(db, f, { now: t });
        const link = `${String(cfg.mailPublicUrl || cfg.publicOrigin || '').replace(/\/+$/, '')}/floor/${encodeURIComponent(f.slug)}`;
        const subject = `Your week on floor ${f.number}`, text = reportText(f, r, link);
        run(db, "INSERT INTO weekly_reports (floor_id,week,status,subject,text,created_at) VALUES (?,?,'sending',?,?,?)", f.id, week, subject, text, t);
        let status = 'failed';
        try { const s = await engine.mail.send(f, { to: [to], subject, text, by: 'app' }); status = ['sent', 'queued', 'sending'].includes(s.status) ? 'sent' : s.status || 'failed'; } catch (e) { log('warn', 'weekly_report_failed', { floor: f.number, err: String(e?.message || e).slice(0, 120) }); }
        run(db, 'UPDATE weekly_reports SET status=? WHERE floor_id=? AND week=?', status, f.id, week);
        done.push({ floor: f.number, week, status });
      }
    } finally { busy = false; }
    return done;
  }
  let timer = null;
  return { tick, start() { timer = setInterval(() => { tick().catch(() => {}); }, cfg.weeklyReportTickMs ?? 60000); timer.unref?.(); }, stop() { clearInterval(timer); } };
}
