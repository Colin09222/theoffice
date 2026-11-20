// Boss alerts (round 2, r2-j61; docs/redesign/OFFICE-ANSWERS-2.md, Q13). Email to a floor's boss for three events only: a question waiting for them,
// a launch ready for their Launch tap, and something shipped. At most 3 emails a day per boss (New York days); one reminder after 24 hours for a
// question still open. Sent through the building's existing mail sender (engine.mail.send, the same path as the form alerts), to the boss's own
// address (mail_floor.boss_email; floor 7 needs one set first). No money, no model call.
//
// BOSS_ALERTS ships OFF (ROUND2.md: it reaches people outside the building). With it off, nothing is sent, nothing is recorded and nothing is queued
// to send later: the first time it is switched on, it starts from that moment, so nothing that happened while it was off is mailed afterwards.
// With it on, an event past the day's cap is recorded as capped and never sent later either.
import { get, all, run } from './db.js';
import { nyParts } from '../public/js/nylight.js';

export const MAX_A_DAY = 3;
export const REMIND_MS = 24 * 3600000;
const SINCE_KEY = 'boss_alerts_since';
const nyDay = (ms) => { const p = nyParts(ms); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
const short = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The events waiting to be mailed for one floor, oldest first, each with a key that makes it happen once. Only events since `since`. */
export function dueAlerts(db, f, { now, since }) {
  const out = [];
  for (const q of all(db, 'SELECT id, text, created_at FROM questions WHERE floor_id=? AND answer IS NULL AND created_at >= ? ORDER BY id', f.id, since)) {
    out.push({ key: `q:${q.id}`, kind: 'question', at: q.created_at, subject: 'A question is waiting for you', line: `Your team asked: "${short(q.text, 240)}"` });
    if (now - q.created_at >= REMIND_MS) out.push({ key: `q24:${q.id}`, kind: 'reminder', at: q.created_at + REMIND_MS, after: `q:${q.id}`, subject: 'Still waiting: a question from your team', line: `Your team is still waiting on: "${short(q.text, 240)}"` });
  }
  const hasMakers = !!get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name='maker_jobs'");
  if (hasMakers) for (const j of all(db, "SELECT id, title, updated_at FROM maker_jobs WHERE floor_id=? AND stage='ready' AND launched_at IS NULL AND updated_at >= ? ORDER BY id", f.id, since)) {
    out.push({ key: `ready:${j.id}`, kind: 'launch_ready', at: j.updated_at, subject: `Ready to launch: ${short(j.title, 60)}`, line: `"${short(j.title, 80)}" is ready. It goes live when you tap Launch.` });
  }
  for (const p of all(db, 'SELECT slug, title, published_at FROM projects WHERE floor_id=? AND private=0 AND published_at IS NOT NULL AND published_at >= ? ORDER BY published_at', f.id, since)) {
    out.push({ key: `ship:${p.slug}:${p.published_at}`, kind: 'shipped', at: p.published_at, subject: `Shipped: ${short(p.title, 60)}`, line: `Your team put "${short(p.title, 80)}" live.` });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function bossAlerts({ db, cfg, engine, now = () => Date.now(), log = () => {} }) {
  let busy = false;
  /** One look at every floor. Returns what it did, for the tests: [{ floor, key, status }]. */
  async function tick() {
    if (!cfg.bossAlerts || busy) return [];
    busy = true;
    const done = [];
    try {
      const t = now();
      let since = Number(get(db, 'SELECT value FROM settings WHERE key=?', SINCE_KEY)?.value);
      if (!Number.isFinite(since)) { since = t; run(db, 'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', SINCE_KEY, String(t)); }
      const mail = engine.mail;
      if (!mail?.send) return done;
      const day = nyDay(t);
      for (const f of all(db, "SELECT * FROM floors WHERE status='active' AND filler=0")) {
        const to = get(db, 'SELECT boss_email FROM mail_floor WHERE floor_id=?', f.id)?.boss_email || '';
        if (!to) continue;  // floor 7 had none: nothing to send to until one is set
        for (const a of dueAlerts(db, f, { now: t, since })) {
          if (a.at > t || get(db, 'SELECT 1 x FROM boss_alerts WHERE key=?', `${f.id}:${a.key}`)) continue;
          if (a.after && !get(db, "SELECT 1 x FROM boss_alerts WHERE key=? AND status='sent'", `${f.id}:${a.after}`)) continue;  // a reminder follows a sent first email
          const sentToday = get(db, "SELECT COUNT(*) n FROM boss_alerts WHERE floor_id=? AND day=? AND status='sent'", f.id, day).n;
          if (sentToday >= MAX_A_DAY) { run(db, 'INSERT INTO boss_alerts (key,floor_id,kind,day,status,subject,created_at) VALUES (?,?,?,?,?,?,?)', `${f.id}:${a.key}`, f.id, a.kind, day, 'capped', a.subject, t); done.push({ floor: f.number, key: a.key, status: 'capped' }); continue; }
          run(db, 'INSERT INTO boss_alerts (key,floor_id,kind,day,status,subject,created_at) VALUES (?,?,?,?,?,?,?)', `${f.id}:${a.key}`, f.id, a.kind, day, 'sending', a.subject, t);
          const link = `${String(cfg.mailPublicUrl || cfg.publicOrigin || '').replace(/\/+$/, '')}/floor/${encodeURIComponent(f.slug)}`;
          const text = [a.line, '', `Open your floor: ${link}`, '', 'You get at most three of these a day. They are only about a question waiting for you, a launch ready for you, or something shipped.'].join('\n');
          let status = 'failed';
          try { const r = await mail.send(f, { to: [to], subject: a.subject, text, by: 'app' }); status = ['sent', 'queued', 'sending'].includes(r.status) ? 'sent' : r.status || 'failed'; } catch (e) { log('warn', 'boss_alert_failed', { floor: f.number, err: String(e?.message || e).slice(0, 120) }); }
          run(db, 'UPDATE boss_alerts SET status=? WHERE key=?', status, `${f.id}:${a.key}`);
          done.push({ floor: f.number, key: a.key, status });
        }
      }
    } finally { busy = false; }
    return done;
  }
  let timer = null;
  return {
    tick,
    start() { timer = setInterval(() => { tick().catch(() => {}); }, cfg.bossAlertsTickMs ?? 60000); timer.unref?.(); },
    stop() { clearInterval(timer); timer = null; },
  };
}
