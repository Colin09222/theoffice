// The budget check, inside the server (docs/redesign/OFFICE-ANSWERS-1.md, Q8; job 5). It used to run as a scheduled session outside the building with
// no shell, which often couldn't reach the server and reported "budget check failed" instead of numbers. Now a timer in this process reads SQLite and,
// every two hours, writes one spend record: each pot (Anthropic, OpenRouter) with what is spent, the cap and what is left, and each floor with what it
// spent this week and yesterday. No model is called and nothing leaves the process. The admin lists the records (`admin.mjs spend`, /api/admin/spend)
// and sees when the last one was written; older than 3 hours, that shows as stale. SPEND_CHECK=0 stops the timer.
import { get, all, run } from './db.js';
import { PROVIDERS } from './budget.js';
import { wallClock } from './modes.js';
import { wallToUtc } from './orders.js';
import { newFence } from './help.js';

export const OWNER_TZ = 'America/New_York';
const HOUR = 3600000, DAY = 86400000;
export const STALE_MS = 3 * HOUR;
const LIMIT = { anthropic: 'budgetAnthropicUsd', openrouter: 'budgetOpenrouterUsd' };
const money = (n) => Math.round(n * 1e4) / 1e4;

/** Midnight at the start of the owner's day holding `ms`, `back` days earlier. */
export function dayStart(ms, back = 0, tz = OWNER_TZ) { const w = wallClock(tz, ms); return wallToUtc(tz, w.y, w.m, w.d - back, 0, 0); }
/** The owner's week starts Monday 00:00 (the weekly plan and budgets refill on Monday). */
export function weekStart(ms, tz = OWNER_TZ) { const w = wallClock(tz, ms); return wallToUtc(tz, w.y, w.m, w.d - ((w.weekday + 6) % 7), 0, 0); }

/** One record's numbers, read straight from the ledger. Domains come out of the registrar balance and count towards neither pot. */
export function spendSnapshot(db, cfg, at = Date.now()) {
  const pots = {};
  for (const p of PROVIDERS) {
    const cap = cfg[LIMIT[p]];
    const spent = get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE provider=?', p).n;
    const finite = Number.isFinite(cap);
    pots[p] = { spentUsd: money(spent), capUsd: finite ? cap : null, leftUsd: finite ? money(Math.max(0, cap - spent)) : null, percent: finite && cap > 0 ? Math.round(spent / cap * 1000) / 10 : null };
  }
  const week = weekStart(at), today = dayStart(at), yesterday = dayStart(at, 1);
  const floors = all(db, `SELECT f.id, f.number, f.name, f.filler,
      COALESCE(SUM(CASE WHEN l.created_at>=? AND l.created_at<=? THEN l.cost_usd END),0) week,
      COALESCE(SUM(CASE WHEN l.created_at>=? AND l.created_at<? THEN l.cost_usd END),0) yesterday,
      COALESCE(SUM(CASE WHEN l.created_at>=? AND l.created_at<=? AND l.provider='anthropic' THEN l.cost_usd END),0) week_a,
      COALESCE(SUM(CASE WHEN l.created_at>=? AND l.created_at<=? AND l.provider='openrouter' THEN l.cost_usd END),0) week_o
    FROM floors f LEFT JOIN ledger l ON l.floor_id=f.id AND l.provider!='' GROUP BY f.id ORDER BY f.number`, week, at, yesterday, today, week, at, week, at)
    .filter((f) => !f.filler || f.week || f.yesterday)
    .map((f) => ({ floorId: f.id, floorNumber: f.number, floorName: f.name, weekUsd: money(f.week), yesterdayUsd: money(f.yesterday), weekAnthropicUsd: money(f.week_a), weekOpenrouterUsd: money(f.week_o) }));
  return { at, weekStart: week, yesterdayStart: yesterday, pots, floors };
}

/** Writes one record now and returns it. */
export function writeSpendRecord(db, cfg, at = Date.now()) {
  const snap = spendSnapshot(db, cfg, at);
  const id = Number(run(db, 'INSERT INTO spend_records (created_at,data) VALUES (?,?)', at, JSON.stringify(snap)).lastInsertRowid);
  return { id, ...snap };
}

export const lastSpendRecord = (db) => { const r = get(db, 'SELECT * FROM spend_records ORDER BY id DESC LIMIT 1'); return r ? { id: r.id, ...JSON.parse(r.data) } : null; };

/** The last records and how fresh they are, for the admin. Floor names are fenced when the reader may be an agent. */
export function spendListing(db, { last = 12, now = Date.now(), fenced = true } = {}) {
  const fence = fenced ? newFence() : null;
  const rows = all(db, 'SELECT * FROM spend_records ORDER BY id DESC LIMIT ?', Math.max(1, Math.min(500, last))).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
  const latest = rows[0]?.at ?? null;
  for (const r of rows) for (const f of r.floors) if (fence) f.floorName = fence.wrap('floor name', f.floorName);
  return {
    ...(fence ? { notice: fence.notice } : {}),
    lastWrittenAt: latest === null ? null : new Date(latest).toISOString(),
    ageMinutes: latest === null ? null : Math.floor((now - latest) / 60000),
    stale: latest === null || now - latest > STALE_MS,
    records: rows.map((r) => ({ ...r, at: new Date(r.at).toISOString(), weekStart: new Date(r.weekStart).toISOString(), yesterdayStart: new Date(r.yesterdayStart).toISOString() })),
  };
}
const usd = (n) => (n === null ? 'no cap' : `$${n.toFixed(2)}`);
export function freshnessLine(l) {
  if (l.lastWrittenAt === null) return 'No spend record has been written yet.';
  const age = l.ageMinutes >= 120 ? `${Math.floor(l.ageMinutes / 60)}h ago` : `${l.ageMinutes} min ago`;
  return l.stale ? `Costs last updated ${age} (${l.lastWrittenAt}). STALE: older than 3 hours.` : `Costs last updated ${age} (${l.lastWrittenAt}).`;
}
export function spendListingText(l) {
  const lines = [];
  if (l.notice) lines.push(l.notice, '');
  lines.push(freshnessLine(l), '');
  for (const r of l.records) {
    lines.push(`#${r.id}  ${r.at}`);
    for (const p of PROVIDERS) { const x = r.pots[p]; lines.push(`  ${p.padEnd(11)} spent ${usd(x.spentUsd)} of ${usd(x.capUsd)}, ${usd(x.leftUsd)} left${x.percent === null ? '' : ` (${x.percent}%)`}`); }
    for (const f of r.floors) lines.push(`  floor ${String(f.floorNumber).padStart(3)}  week ${usd(f.weekUsd).padStart(8)}  yesterday ${usd(f.yesterdayUsd).padStart(8)}  ${f.floorName}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The timer. It wakes every minute and writes a record when the last one is older than the interval, so a restart neither skips one nor writes two.
 * `onRecord` lets the alerts (job 6) read each new record. Never throws into the server.
 */
export function installSpendCheck({ db, cfg, log = () => {}, now = Date.now, onRecord = [] }) {
  const every = () => Math.max(60000, Number(cfg.spendCheckEveryMs ?? 2 * HOUR));
  let timer = null;
  function tick() {
    if (!cfg.spendCheck) return null;
    try {
      const t = now();
      const last = get(db, 'SELECT MAX(created_at) t FROM spend_records')?.t || 0;
      if (t - last < every()) return null;
      const rec = writeSpendRecord(db, cfg, t);
      log('info', 'spend record written', { id: rec.id });
      for (const fn of onRecord) { try { fn(rec); } catch (e) { log('warn', 'after the spend record', { err: String(e?.message || e) }); } }
      return rec;
    } catch (e) { log('error', 'spend check failed', { err: String(e?.message || e) }); return null; }
  }
  return {
    tick,
    start() { if (timer) return; tick(); timer = setInterval(tick, Math.min(60000, every())); timer.unref?.(); },
    stop() { clearInterval(timer); timer = null; },
  };
}
export { DAY };
