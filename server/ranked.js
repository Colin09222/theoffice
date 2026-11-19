// Colon's ranked view (docs/redesign/ROUND1-REST.md, job 26). Admin only: every real floor ranked by real use per $100 spent, over the last 7
// and the last 28 days, with its spend, its real-use figure and its last launch. Real use is what the Numbers tab counts for the floor's boss
// (unique visitors, which leave bots out; form sign-ups; Office Cloud accounts; orders) plus tapped calls once job 33 records them. Spend is the
// ledger's. Three buttons, each behind a confirm and each logged with who and when:
//   Double down  marks the floor a priority, here and in the owner's digest. It changes no cap and no budget.
//   Pause        the existing floor pause (the boss's own Resume undoes it too).
//   Kill         pauses the team and takes the floor off the public lists (hidden); "Bring back" puts both back as they were.
// Nothing here sets a budget or a limit (the owner's ruling of 2026-11-19).
import { get, all, run } from './db.js';
import { tapsSince } from './taps.js';

const DAY = 86400000;
const WINDOW_DAYS = [7, 28];
const usd = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sumOf = (rows, key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);


/** The ranked list. `numbers` is the engine's Numbers reader (server/numbers.js), so the counts are the Numbers tab's own. */
export async function rankedFloors(db, { numbers, now = Date.now() } = {}) {
  const marks = new Map(all(db, 'SELECT * FROM floor_marks').map((m) => [m.floor_id, m]));
  const floors = all(db, "SELECT * FROM floors WHERE filler=0 AND status IN ('active','suspended') ORDER BY number");
  const out = [];
  for (const f of floors) {
    const view = numbers ? await numbers.view(f) : null;
    const series = view?.series || [];
    const row = { id: f.id, number: f.number, slug: f.slug, name: f.name, status: f.status, paused: !!f.paused, hidden: !!f.hidden,
      priority: !!marks.get(f.id)?.priority, killed: !!marks.get(f.id)?.killed, windows: {} };
    for (const days of WINDOW_DAYS) {
      const rows = series.slice(-days);
      const from = now - days * DAY;
      const spent = get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND created_at>=?', f.id, from).n;
      const parts = { visitors: sumOf(rows, 'visitors'), signups: sumOf(rows, 'signups'), accounts: sumOf(rows, 'accounts'), orders: sumOf(rows, 'orders'), taps: tapsSince(db, f.id, from) };
      const realUse = parts.visitors + parts.signups + parts.accounts + parts.orders + parts.taps;
      row.windows[days] = { days, spendUsd: usd(spent), realUse, parts, perHundred: usd(spent) > 0 ? Math.round(realUse / spent * 100 * 10) / 10 : null };  // under half a cent counts as nothing spent
    }
    const launch = get(db, 'SELECT slug, title, published_at FROM projects WHERE floor_id=? AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1', f.id);
    row.lastLaunch = launch ? { slug: launch.slug, title: launch.title, at: launch.published_at } : null;
    out.push(row);
  }
  // Best first by the 28-day figure, then the 7-day one. A floor with real use and nothing spent leads; nothing spent and no use goes last.
  const key = (w) => (w.spendUsd > 0 ? w.perHundred : w.realUse > 0 ? Infinity : -1);
  out.sort((a, b) => key(b.windows[28]) - key(a.windows[28]) || key(b.windows[7]) - key(a.windows[7]) || a.number - b.number);
  return out;
}

const ACTIONS = new Set(['double-down', 'undo-double-down', 'pause', 'resume', 'kill', 'unkill']);
/** Carry out one press and log it. Returns the floor's marks afterwards. */
export function pressRanked(db, engine, floorId, action, who, now = Date.now()) {
  const f = get(db, 'SELECT * FROM floors WHERE id=?', floorId);
  if (!f) return null;
  run(db, 'INSERT OR IGNORE INTO floor_marks (floor_id, updated_at) VALUES (?, ?)', f.id, now);
  const m = get(db, 'SELECT * FROM floor_marks WHERE floor_id=?', f.id);
  if (action === 'double-down' || action === 'undo-double-down') run(db, 'UPDATE floor_marks SET priority=?, updated_at=? WHERE floor_id=?', action === 'double-down' ? 1 : 0, now, f.id);
  else if (action === 'pause') { if (!f.paused) engine.pauseFloor(f.id, 'Paused by the building manager'); }
  else if (action === 'resume') { if (f.paused) engine.resumeFloor(f.id); }
  else if (action === 'kill' && !m.killed) {
    // What it was before, so "Bring back" undoes exactly this and nothing the boss or the admin did apart from it.
    run(db, 'UPDATE floor_marks SET killed=1, was_hidden=?, was_paused=?, updated_at=? WHERE floor_id=?', f.hidden ? 1 : 0, f.paused ? 1 : 0, now, f.id);
    run(db, 'UPDATE floors SET hidden=1 WHERE id=?', f.id);
    if (!f.paused) engine.pauseFloor(f.id, 'Paused by the building manager');
  } else if (action === 'unkill' && m.killed) {
    run(db, 'UPDATE floor_marks SET killed=0, updated_at=? WHERE floor_id=?', now, f.id);
    run(db, 'UPDATE floors SET hidden=? WHERE id=?', m.was_hidden ? 1 : 0, f.id);
    if (!m.was_paused && get(db, 'SELECT paused FROM floors WHERE id=?', f.id).paused) engine.resumeFloor(f.id);
  }
  run(db, 'INSERT INTO rank_log (floor_id, floor_number, action, who, created_at) VALUES (?,?,?,?,?)', f.id, f.number, action, who, now);
  return get(db, 'SELECT * FROM floor_marks WHERE floor_id=?', f.id);
}

export function installRanked(ext) {
  const { db, engine, now, GET, POST, json, readJson, limit, requireAdmin, HttpError } = ext;
  // Admin only, and a 403 for anyone else (a boss included): the page is Colon's.
  const admin = (req) => { try { return requireAdmin(req); } catch (e) { if (e.status === 401) throw new HttpError(403, 'admin_only'); throw e; } };
  GET('/api/admin/ranked', async ({ req, res }) => {
    admin(req);
    const log = all(db, 'SELECT floor_number, action, who, created_at FROM rank_log ORDER BY id DESC LIMIT 30').map((r) => ({ floorNumber: r.floor_number, action: r.action, who: r.who, at: r.created_at }));
    json(res, 200, { floors: await rankedFloors(db, { numbers: engine.numbers, now: now() }), log, windows: WINDOW_DAYS });
  });
  POST('/api/admin/ranked/:id/:action', async ({ req, res, p, ip }) => {
    const s = admin(req); limit('mutate', ip);
    if (!ACTIONS.has(p.action)) throw new HttpError(400, 'bad_action');
    const b = await readJson(req, 256);
    // The confirm step is the page's dialog; the server takes a press only with it said.
    if (b.confirm !== true) throw new HttpError(400, 'confirm_first', 'Confirm the press first.');
    const marks = pressRanked(db, engine, Number(p.id), p.action, `admin ${String(s.hash).slice(0, 8)}`, now());
    if (!marks) throw new HttpError(404, 'not_found');
    json(res, 200, { ok: true, priority: !!marks.priority, killed: !!marks.killed });
  });
}
