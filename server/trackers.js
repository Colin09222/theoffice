// Sales and website traffic trackers on each floor (owner-approved 2026-11-25). See docs/TRACKERS.md.
//
// Sales: entered by hand only, by the owner's assistant when the owner sends a sale (scripts/admin.mjs sales add, or the admin-only route
// below). There is no public or boss write path. Days and times are New York's, because that is how the owner says them.
//
// Traffic: the Office serves every published site itself and already counts real visits (launch.js recordVisit: unique visitors a day and
// pageviews, bots left out, UTC days). This card reads those rows. A floor with no counted site can have days entered by hand
// (admin.mjs traffic set); a hand-entered day replaces the counted one for that day.
//
// The test offset: a per-floor setting that adds N visitors (and N pageviews) to every shown day from a start date. It lives in its own row
// and is never written into the visit rows, so turning it off brings the real numbers back. The card marks an offset floor "test".
//
// Who sees it: the floor's boss and the admin. Visitors get nothing (no money and no figures leave through the public snapshot).
// TRACKERS=0 hides the cards.
import { get, all, run } from './db.js';

export const TRACKER_SCHEMA = `
CREATE TABLE IF NOT EXISTS floor_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual', day TEXT NOT NULL, sold_at INTEGER NOT NULL, timed INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, undone_at INTEGER
);
CREATE INDEX IF NOT EXISTS floor_sales_floor ON floor_sales(floor_id, day);
CREATE TABLE IF NOT EXISTS floor_traffic_manual (
  floor_id INTEGER NOT NULL, day TEXT NOT NULL, visits INTEGER NOT NULL, pageviews INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, day)
);
CREATE TABLE IF NOT EXISTS floor_traffic_offset (floor_id INTEGER PRIMARY KEY, per_day INTEGER NOT NULL, from_day TEXT NOT NULL, set_at INTEGER NOT NULL);
`;
export const ensureTrackerSchema = (db) => db.exec(TRACKER_SCHEMA);

export class TrackerError extends Error {}
const DAY = 86400000, SERIES_DAYS = 30, RECENT = 10, NOTE_MAX = 200;
export const TZ = 'America/New_York';
const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** The New York date of a moment, as YYYY-MM-DD. */
export const etDay = (ms) => etFmt.format(new Date(ms));
/** The UTC date of a moment: how visits are counted. */
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** A YYYY-MM-DD date moved by n calendar days (no clock involved, so no daylight-saving gaps). */
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;
const whole = (v) => Math.round(Number(v) || 0);

// ---- sales ----

/** One sale, entered by hand. amountUsd is the sale's total. date (YYYY-MM-DD, New York) is for a sale on an earlier day; it gets no time. */
export function addSale(db, floorId, { amountUsd, qty = 1, note = '', date = '', now = Date.now() }) {
  const usd = Number(amountUsd);
  if (!Number.isFinite(usd) || usd <= 0 || usd > 1e7) throw new TrackerError('--amount must be a positive number of dollars, such as 49.99.');
  const q = Number(qty);
  if (!Number.isInteger(q) || q < 1 || q > 100000) throw new TrackerError('--qty must be a whole number of 1 or more.');
  const today = etDay(now);
  let day = today, at = now, timed = 1;
  if (date) {
    if (!isDay(date)) throw new TrackerError('--date must be YYYY-MM-DD.');
    if (date > today) throw new TrackerError('--date cannot be in the future.');
    // Noon in New York is 16:00 or 17:00 UTC; 17:00 UTC is on that date either way.
    if (date !== today) { day = date; at = Date.parse(`${date}T17:00:00Z`); timed = 0; }
  }
  const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  const id = Number(run(db, "INSERT INTO floor_sales (floor_id,amount_cents,qty,note,source,day,sold_at,timed,created_at) VALUES (?,?,?,?,'manual',?,?,?,?)",
    floorId, Math.round(usd * 100), q, text, day, at, timed, now).lastInsertRowid);
  return saleRow(get(db, 'SELECT * FROM floor_sales WHERE id=?', id));
}

/** Take one sale back out of the totals. The row stays, marked undone, so the record shows it was entered. */
export function undoSale(db, id, { floorId = null, now = Date.now() } = {}) {
  const r = get(db, 'SELECT * FROM floor_sales WHERE id=?', Number(id));
  if (!r || (floorId && r.floor_id !== floorId)) throw new TrackerError(`No sale with id ${id}${floorId ? ' on that floor' : ''}.`);
  if (r.undone_at) throw new TrackerError(`Sale ${id} was already undone.`);
  run(db, 'UPDATE floor_sales SET undone_at=? WHERE id=?', now, r.id);
  return saleRow({ ...r, undone_at: now });
}

const saleRow = (r) => ({ id: r.id, day: r.day, at: r.sold_at, timed: !!r.timed, amountCents: r.amount_cents, qty: r.qty, note: r.note, source: r.source, ...(r.undone_at ? { undoneAt: r.undone_at } : {}) });

export function listSales(db, floorId, { limit = 20, withUndone = true } = {}) {
  return all(db, `SELECT * FROM floor_sales WHERE floor_id=?${withUndone ? '' : ' AND undone_at IS NULL'} ORDER BY sold_at DESC, id DESC LIMIT ?`, floorId, limit).map(saleRow);
}

/** Today, the last 7 days (today and the 6 before), this calendar month and all time, New York days; plus the latest entries. */
export function salesView(db, floorId, now = Date.now()) {
  const today = etDay(now);
  const total = (from) => {
    const r = get(db, `SELECT COUNT(*) entries, COALESCE(SUM(qty),0) count, COALESCE(SUM(amount_cents),0) cents FROM floor_sales WHERE floor_id=? AND undone_at IS NULL${from ? ' AND day>=? AND day<=?' : ''}`, floorId, ...(from ? [from, today] : []));
    return { count: r.count, cents: r.cents, entries: r.entries };
  };
  return {
    currency: 'usd', today: total(today), week: total(addDays(today, -6)), month: total(`${today.slice(0, 7)}-01`), all: total(''),
    recent: listSales(db, floorId, { limit: RECENT, withUndone: false }),
  };
}

// ---- traffic ----

export function setTrafficDay(db, floorId, { date, visits, pageviews = null, now = Date.now() }) {
  if (!isDay(date)) throw new TrackerError('--date must be YYYY-MM-DD.');
  if (date > utcDay(now) && date > etDay(now)) throw new TrackerError('--date cannot be in the future.');
  const v = Number(visits), pv = pageviews === null || pageviews === undefined || pageviews === '' ? null : Number(pageviews);
  if (!Number.isInteger(v) || v < 0) throw new TrackerError('--visits must be a whole number, 0 or more.');
  if (pv !== null && (!Number.isInteger(pv) || pv < 0)) throw new TrackerError('--pageviews must be a whole number, 0 or more.');
  run(db, 'INSERT INTO floor_traffic_manual (floor_id,day,visits,pageviews,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(floor_id,day) DO UPDATE SET visits=excluded.visits, pageviews=excluded.pageviews, updated_at=excluded.updated_at', floorId, date, v, pv, now);
  return { day: date, visits: v, pageviews: pv };
}
export const clearTrafficDay = (db, floorId, date) => run(db, 'DELETE FROM floor_traffic_manual WHERE floor_id=? AND day=?', floorId, date).changes;

/** The test offset: perDay added to every shown day from `from` on. null (or perDay 0) turns it off. */
export function setTrafficOffset(db, floorId, { perDay, from, now = Date.now() } = {}) {
  if (perDay === null || perDay === undefined || Number(perDay) === 0) { run(db, 'DELETE FROM floor_traffic_offset WHERE floor_id=?', floorId); return null; }
  const n = Number(perDay);
  if (!Number.isInteger(n) || n < 0 || n > 1e6) throw new TrackerError('--per-day must be a whole number of 1 or more.');
  if (!isDay(from)) throw new TrackerError('--from must be YYYY-MM-DD.');
  run(db, 'INSERT INTO floor_traffic_offset (floor_id,per_day,from_day,set_at) VALUES (?,?,?,?) ON CONFLICT(floor_id) DO UPDATE SET per_day=excluded.per_day, from_day=excluded.from_day, set_at=excluded.set_at', floorId, n, from, now);
  return trafficOffset(db, floorId);
}
export const trafficOffset = (db, floorId) => { const r = get(db, 'SELECT per_day, from_day FROM floor_traffic_offset WHERE floor_id=?', floorId); return r ? { perDay: r.per_day, from: r.from_day } : null; };

/** The offset a shown day gets. Pure, so the sums are easy to test. */
export const offsetFor = (offset, day, today) => (offset && offset.perDay > 0 && day >= offset.from && day <= today ? offset.perDay : 0);

/**
 * The last 30 days of visits, UTC days as they are counted. Each day: counted visits (app_visits), or the hand-entered figure if there is
 * one, then the test offset on top. `real` keeps the numbers without the offset, for the admin's "test" tag.
 */
export function trafficView(db, floorId, now = Date.now()) {
  const today = utcDay(now), from = addDays(today, -(SERIES_DAYS - 1));
  const counted = new Map(all(db, 'SELECT day, SUM(uniques) visits, SUM(views) views FROM app_visits WHERE floor_id=? AND day>=? AND day<=? GROUP BY day', floorId, from, today).map((r) => [r.day, r]));
  const manual = new Map(all(db, 'SELECT day, visits, pageviews FROM floor_traffic_manual WHERE floor_id=? AND day>=? AND day<=?', floorId, from, today).map((r) => [r.day, r]));
  const offset = trafficOffset(db, floorId);
  const days = Array.from({ length: SERIES_DAYS }, (_, i) => {
    const day = addDays(from, i);
    const m = manual.get(day), c = counted.get(day);
    const real = m ? { visits: m.visits, views: m.pageviews ?? m.visits } : { visits: whole(c?.visits), views: whole(c?.views) };
    const plus = offsetFor(offset, day, today);
    return { day, visits: real.visits + plus, views: real.views + plus, real, manual: !!m, offset: plus };
  });
  const sum = (n, key, realOnly = false) => days.slice(-n).reduce((t, d) => t + (realOnly ? d.real[key] : d[key]), 0);
  const window = (n) => ({ days: n, visits: sum(n, 'visits'), views: sum(n, 'views'), real: { visits: sum(n, 'visits', true), views: sum(n, 'views', true) } });
  // Counted: a published public site, or visits already on record (a site taken down still has its last 30 days).
  const site = counted.size > 0 || get(db, "SELECT COUNT(*) n FROM projects WHERE floor_id=? AND published_at IS NOT NULL AND private=0 AND kind IN ('site','app','game','simulation')", floorId).n > 0;
  const anyManual = !!get(db, 'SELECT 1 x FROM floor_traffic_manual WHERE floor_id=? LIMIT 1', floorId);
  return {
    source: site ? (anyManual ? 'counted+manual' : 'counted') : anyManual ? 'manual' : 'none',
    shown: site || anyManual || !!offset,
    today: window(1), week: window(7), month: window(30),
    series: days.map((d) => ({ day: d.day, visits: d.visits, views: d.views, manual: d.manual || undefined })),
    ...(offset ? { test: { perDay: offset.perDay, from: offset.from } } : {}),
  };
}

export const trackersView = (db, floorId, now = Date.now()) => ({ sales: salesView(db, floorId, now), traffic: trafficView(db, floorId, now) });

/** A floor by number or slug (old slugs too). */
export function floorFor(db, which) {
  const s = String(which ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return get(db, "SELECT id, number, slug, name FROM floors WHERE number=? AND status!='killed'", Number(s));
  return get(db, "SELECT id, number, slug, name FROM floors WHERE slug=? AND status!='killed'", s)
    || get(db, "SELECT f.id, f.number, f.slug, f.name FROM floors f JOIN floor_old_slugs o ON o.floor_id=f.id WHERE o.slug=? AND f.status!='killed'", s);
}

const usd = (cents) => `$${(whole(cents) / 100).toFixed(2)}`;
/** The CLI's plain-text view of one floor. */
export function trackersText(f, v, { sales = true, traffic = true } = {}) {
  const s = v.sales, t = v.traffic;
  const line = (label, x) => `  ${label.padEnd(10)} ${String(x.count).padStart(5)} sold  ${usd(x.cents).padStart(12)}`;
  const tw = (label, x) => `  ${label.padEnd(10)} ${String(x.visits).padStart(7)} visitors ${String(x.views).padStart(8)} pageviews${t.test ? `   (real ${x.real.visits} / ${x.real.views})` : ''}`;
  return [`Floor ${f.number} (${f.slug})`,
    ...(sales ? ['Sales (New York days)', line('today', s.today), line('7 days', s.week), line('this month', s.month), line('all time', s.all)] : []),
    ...(sales && s.recent.length ? ['  recent:', ...s.recent.map((r) => `    #${r.id}  ${r.day}${r.timed ? ` ${new Date(r.at).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })}` : ''}  ${usd(r.amountCents)}  x${r.qty}  ${r.note}`)] : []),
    ...(traffic ? [`Traffic (UTC days; source: ${t.source})${t.test ? `  TEST OFFSET +${t.test.perDay}/day from ${t.test.from}` : ''}`, tw('today', t.today), tw('7 days', t.week), tw('30 days', t.month)] : [])].join('\n');
}

export function installTrackers(ext) {
  const { db, cfg, now, hooks, GET, POST, json, readJson, limit, requireAdmin, HttpError } = ext;
  ensureTrackerSchema(db);
  const on = () => cfg.trackers !== false;
  hooks.snapshot.push((f, viewer, out) => { if (on() && (viewer?.owner || viewer?.admin)) out.trackers = trackersView(db, f.id, now()); });
  const floorOr404 = (n) => { const f = floorFor(db, n); if (!f) throw new HttpError(404, 'not_found'); return f; };
  const bad = (e) => { if (e instanceof TrackerError) throw new HttpError(400, 'bad_input', e.message); throw e; };
  // Admin only: the same as the CLI, for a tool that would rather speak HTTP. No boss or visitor route writes here.
  GET('/api/admin/trackers/:floor', async ({ req, res, p }) => {
    requireAdmin(req);
    const f = floorOr404(p.floor);
    json(res, 200, { floor: f.number, slug: f.slug, ...trackersView(db, f.id, now()), sales: { ...salesView(db, f.id, now()), entries: listSales(db, f.id, { limit: 50 }) } });
  });
  POST('/api/admin/trackers/:floor/sales', async ({ req, res, p, ip }) => {
    requireAdmin(req); limit('mutate', ip);
    const f = floorOr404(p.floor);
    const b = await readJson(req, 2048);
    let sale; try { sale = addSale(db, f.id, { amountUsd: b.amount, qty: b.qty ?? 1, note: b.note || '', date: b.date || '', now: now() }); } catch (e) { bad(e); }
    json(res, 201, { sale });
  });
  POST('/api/admin/trackers/:floor/sales/:id/undo', async ({ req, res, p, ip }) => {
    requireAdmin(req); limit('mutate', ip);
    const f = floorOr404(p.floor);
    let sale; try { sale = undoSale(db, p.id, { floorId: f.id, now: now() }); } catch (e) { bad(e); }
    json(res, 200, { sale });
  });
  return {};
}
