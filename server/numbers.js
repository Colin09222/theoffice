// The company dashboard: what the boss sees under Numbers, and the same figures for the manager's private prompt and the daily report.
// It only reads what is already on record: visits (launch.js), form sign-ups, Office Cloud accounts, the ads ledger (business.js) and, once that
// module is in, sales (cloud/pay.js). Boss-only: one owner-only route, and nothing here goes in a snapshot, an event, the feed, the tower,
// the ticker or a leaderboard. Days are UTC, because that is how visits are counted. See docs/NUMBERS.md.
import { get, all } from './db.js';
import { ensureAdSpend } from './business.js';
import { slugPattern } from './workspace.js';

const DAY = 86400000, SERIES_DAYS = 30, TOP = 8;
export const WINDOWS = { today: 1, week: 7, month: 30 };
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const of = (project) => (project ? ' AND project=?' : '');
const arg = (project) => (project ? [project] : []);
const sum = (rows, key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
const whole = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** A module another worker is building: its function once it is there, and null until then. Nothing else waits on it. */
export async function softFn(load, names, log) {
  try {
    const m = await load();
    for (const name of names) if (typeof m[name] === 'function') return m[name];
    return null;
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') log?.('warn', 'optional module would not load', { err: String(e?.message || e).slice(0, 160) });
    return null;
  }
}

/** Checks the shape of salesSummary's answer: { currency, grossCents, refundsCents, orders, activeSubs, byDay }. */
export function normalSales(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const byDay = (Array.isArray(raw.byDay) ? raw.byDay : []).map((d) => ({ day: String(d?.day ?? '').slice(0, 10), grossCents: whole(d?.grossCents), orders: whole(d?.orders) })).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day));
  return { currency: String(raw.currency || 'usd').toLowerCase().replace(/[^a-z]/g, '').slice(0, 8) || 'usd', grossCents: whole(raw.grossCents), refundsCents: whole(raw.refundsCents), orders: whole(raw.orders), activeSubs: whole(raw.activeSubs), byDay };
}

const usdSign = { usd: '$', gbp: '£', eur: '€' };
/** Money as a boss reads it. A currency we have no sign for is spelt out. */
export function money(cents, currency = 'usd') {
  const c = String(currency || 'usd').toLowerCase();
  const n = (whole(cents) / 100).toFixed(2);
  return usdSign[c] ? `${usdSign[c]}${n}` : `${n} ${c.toUpperCase()}`;
}

/** The figures for one company, or one of its projects. Pure: `sales` is salesSummary's checked answer, or null. */
export function companyNumbers(db, floor, { now = Date.now(), project = '', sales = null, salesFailed = false } = {}) {
  const floorId = floor.id;
  const days = Array.from({ length: SERIES_DAYS }, (_, i) => dayOf(now - (SERIES_DAYS - 1 - i) * DAY));
  const from = days[0], fromMs = Date.parse(`${from}T00:00:00Z`);
  const series = new Map(days.map((day) => [day, { day, visitors: 0, views: 0, signups: 0, accounts: 0, grossCents: 0, orders: 0 }]));
  for (const v of all(db, `SELECT day, SUM(views) views, SUM(uniques) uniques FROM app_visits WHERE floor_id=?${of(project)} AND day>=? GROUP BY day`, floorId, ...arg(project), from)) {
    const r = series.get(v.day); if (r) { r.views = v.views; r.visitors = v.uniques; }
  }
  const counted = (table, key) => {
    for (const v of all(db, `SELECT date(created_at/1000,'unixepoch') day, COUNT(*) n FROM ${table} WHERE floor_id=?${of(project)} AND created_at>=? GROUP BY day`, floorId, ...arg(project), fromMs)) {
      const r = series.get(v.day); if (r) r[key] = v.n;
    }
  };
  counted('app_forms', 'signups');
  counted('cloud_users', 'accounts');
  for (const d of sales?.byDay || []) { const r = series.get(d.day); if (r) { r.grossCents = d.grossCents; r.orders = d.orders; } }
  const list = days.map((d) => series.get(d));
  const windows = {};
  for (const [name, n] of Object.entries(WINDOWS)) {
    const rows = list.slice(-n), since = days[days.length - n];
    windows[name] = {
      days: n, visitors: sum(rows, 'visitors'), views: sum(rows, 'views'), signups: sum(rows, 'signups'), accounts: sum(rows, 'accounts'), grossCents: sum(rows, 'grossCents'), orders: sum(rows, 'orders'),
      pages: all(db, `SELECT path, SUM(views) views FROM app_visits WHERE floor_id=?${of(project)} AND day>=? GROUP BY path ORDER BY views DESC, path LIMIT ${TOP}`, floorId, ...arg(project), since),
      sources: all(db, `SELECT ref, SUM(n) n FROM app_visit_refs WHERE floor_id=?${of(project)} AND day>=? GROUP BY ref ORDER BY n DESC, ref LIMIT ${TOP}`, floorId, ...arg(project), since),
    };
  }
  // Campaigns that ran in the same 30 days, so what they cost and what the company earned cover about the same stretch.
  const ads = all(db, `SELECT amount, spent_micros, synced_at, clicks, impressions FROM ad_spend WHERE floor_id=?${of(project)} AND status IN ('approved','running','paused','ended') AND (COALESCE(decided_at, created_at) >= ? OR COALESCE(ends_at, 0) >= ?)`, floorId, ...arg(project), fromMs, fromMs);
  const earned = windows.month.grossCents;
  const currency = sales?.currency || 'usd';
  const spentCents = Math.round(sum(ads, 'spent_micros') / 1e4);
  const adsView = ads.length ? { campaigns: ads.length, spentCents, approvedCents: sum(ads, 'amount') * 100, reported: ads.some((r) => r.synced_at), clicks: sum(ads, 'clicks'), impressions: sum(ads, 'impressions'), earnedCents: earned, currency, leftCents: currency === 'usd' ? earned - spentCents : null } : null;
  const usage = get(db, `SELECT COALESCE(SUM(users),0) accounts, COALESCE(SUM(docs),0) docs, COALESCE(SUM(saves),0) saves, COALESCE(SUM(scores),0) scores FROM cloud_usage WHERE floor_id=?${of(project)}`, floorId, ...arg(project));
  const signupsTotal = get(db, `SELECT COUNT(*) n FROM app_forms WHERE floor_id=?${of(project)}`, floorId, ...arg(project)).n;
  // Every project the company has with something to show. The drive's working folders stay out.
  const seen = new Set(all(db, 'SELECT DISTINCT project FROM app_visits WHERE floor_id=? AND day>=? UNION SELECT DISTINCT project FROM app_forms WHERE floor_id=? UNION SELECT DISTINCT project FROM cloud_users WHERE floor_id=?', floorId, from, floorId, floorId).map((r) => r.project));
  const projects = all(db, 'SELECT slug, title, kind, private, published_at FROM projects WHERE floor_id=? ORDER BY COALESCE(published_at,0) DESC, created_at DESC LIMIT 60', floorId).filter((p) => p.slug !== 'brand' && (p.published_at || seen.has(p.slug))).map((p) => ({ slug: p.slug, title: p.title, kind: p.kind, live: !!p.published_at, private: !!p.private }));
  return {
    at: now, timezone: 'UTC', project, projects, windows, series: list,
    sales: { state: salesFailed ? 'error' : sales && (sales.orders || sales.grossCents || sales.activeSubs) ? 'ok' : 'none', currency, activeSubs: sales?.activeSubs || 0, refundsCents: sales?.refundsCents || 0, wholeCompany: !!project },
    ads: adsView, usage, signupsTotal,
  };
}

/** The handful of figures the manager and the daily report work from. */
export function factsFrom(view) {
  const week = (rows) => ({ visitors: sum(rows, 'visitors'), views: sum(rows, 'views'), signups: sum(rows, 'signups'), accounts: sum(rows, 'accounts'), orders: sum(rows, 'orders'), grossCents: sum(rows, 'grossCents') });
  const last7 = week(view.series.slice(-7)), prev7 = week(view.series.slice(-14, -7));
  const any = (w) => w.visitors + w.views + w.signups + w.accounts + w.orders + w.grossCents > 0;
  return { last7, prev7, today: week(view.series.slice(-1)), hasData: any(last7) || !!view.sales.activeSubs, hasPrev: any(prev7), sales: view.sales, ads: view.ads, accountsTotal: view.usage.accounts, pages: view.windows.week.pages, sources: view.windows.week.sources };
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** One line of counts, real figures only, leaving out what isn't there yet. */
export function weekLine(w, sales) {
  return [plural(w.visitors, 'visitor'), plural(w.views, 'page view'), plural(w.signups, 'form sign-up'), plural(w.accounts, 'new account'), sales.state === 'ok' || w.orders ? `${plural(w.orders, 'order')} worth ${money(w.grossCents, sales.currency)}` : 'no sales yet'].join(', ');
}
const fence = (source, text) => `<untrusted_data source="${source}">${String(text).replace(/<\/?\s*untrusted_data/gi, '[untrusted_data')}</untrusted_data>`;
/** The numbers as the manager reads them, in its private prompt only. What the outside world can type (page paths, where visitors came from) is fenced as data. */
export function managerFigures(f) {
  const parts = ['PRIVATE company numbers, from the server\'s own records (UTC days). Use them to decide; never repeat them or say anything about visitors, sign-ups, sales or ad spend in chat, task titles, briefs, review notes or on any page: visitors can watch this floor.'];
  if (!f.hasData) parts.push('Not enough data yet: nothing on record in the last 7 days. Do not guess at numbers.');
  else {
    parts.push(`Last 7 days: ${weekLine(f.last7, f.sales)}.`, f.hasPrev ? `The 7 days before: ${weekLine(f.prev7, f.sales)}.` : 'No earlier week to compare with yet.', `Today so far: ${weekLine(f.today, f.sales)}.`);
    if (f.sales.activeSubs) parts.push(`Active subscribers: ${f.sales.activeSubs}.`);
    if (f.accountsTotal) parts.push(`Accounts so far: ${f.accountsTotal}.`);
    if (f.ads) parts.push(`Ads in the last 30 days: ${plural(f.ads.campaigns, 'campaign')}, ${f.ads.reported ? `${money(f.ads.spentCents)} spent` : 'spend not reported yet'}, against ${money(f.ads.earnedCents, f.ads.currency)} earned in the same 30 days.`);
    if (f.pages.length) parts.push(`Top pages: ${fence('page paths', f.pages.map((p) => `${p.path} (${p.views})`).join(', '))}.`);
    if (f.sources.length) parts.push(`Where visitors came from: ${fence('referrers', f.sources.map((s) => `${s.ref} (${s.n})`).join(', '))}.`);
  }
  return parts.join(' ');
}
/** "What the numbers did", for the boss. Real figures only, and it says so when there are too few to say anything. */
export function reportFigures(f) {
  if (!f.hasData) return 'Not enough data yet to say how things moved: no visitors, sign-ups or sales on record in the last 7 days.';
  const lines = [`Last 7 days: ${weekLine(f.last7, f.sales)}.`];
  if (f.hasPrev) lines.push(`The 7 days before: ${weekLine(f.prev7, f.sales)}.`);
  else lines.push('There is no earlier week to compare it with yet, so I can\'t say whether that is up or down.');
  if (f.ads) lines.push(`Ads, last 30 days: ${f.ads.reported ? `${money(f.ads.spentCents)} spent` : 'spend not reported yet'}, against ${money(f.ads.earnedCents, f.ads.currency)} earned.`);
  return lines.join(' ');
}

export function createNumbers({ db, cfg = {}, log, now = Date.now }) {
  ensureAdSpend(db);
  const sales = cfg.salesSummaryFn ? Promise.resolve(cfg.salesSummaryFn) : softFn(() => import('./cloud/pay.js'), ['salesSummary'], log);
  async function view(floor, { project = '' } = {}) {
    const fn = await sales;
    let answer = null, salesFailed = false;
    if (fn) {
      try { answer = normalSales(await fn(db, floor.id, { days: SERIES_DAYS })); } catch (e) { salesFailed = true; log?.('warn', 'sales summary failed', { floorId: floor.id, err: String(e?.message || e).slice(0, 160) }); }
    }
    return companyNumbers(db, floor, { now: now(), project, sales: answer, salesFailed });
  }
  return { view };
}

export function installNumbers(ext) {
  const { db, cfg, log, now, GET, json, requireOwner, HttpError, engine } = ext;
  const numbers = createNumbers({ db, cfg, log, now });
  engine.numbers = numbers;
  GET('/api/floors/:slug/numbers', async ({ req, res, p, url }) => {
    const f = requireOwner(req, p.slug);
    const q = url?.searchParams || new URL(req.url, 'http://x').searchParams;
    const project = q.get('project') || '';
    if (project && (!slugPattern.test(project) || !get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', f.id, project))) throw new HttpError(404, 'not_found');
    json(res, 200, await numbers.view(f, { project }));
  });
  return {};
}
