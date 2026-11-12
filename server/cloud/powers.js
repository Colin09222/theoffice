// What a published project may do beyond keeping data: call AI (office.ai) and fetch public pages (office.fetch, office.scrape).
// The switches, the day's counts and the default limits live here, so the backend and the admin's script read the same thing.
// Everything here is a count or a yes/no. A project with no row is on, so a boss has nothing to set up.
import { get, all, run, tx } from '../db.js';

export const AI_DEFAULTS = {
  maxTokens: 1000, defaultTokens: 600, inputChars: 32000, systemChars: 8000, messages: 40, minOutput: 32, timeoutMs: 60000,
  dayFast: 150000, daySmart: 15000, buildingDayUsd: 2,
};
export const FETCH_DEFAULTS = {
  dayProject: 500, hostDelayMs: 1000, maxWaitMs: 4000, maxBytes: 512 * 1024, timeoutMs: 15000, maxRedirects: 4, urlChars: 2048,
  cacheTtlMs: 300000, cacheBytes: 24 * 1048576, robotsTtlMs: 3600000, robotsRetryMs: 60000, robotsHosts: 2000, robotsBytes: 8 * 1048576, robotsMaxBytes: 512 * 1024, robotsTimeoutMs: 8000,
  maxDelayMs: 30000, textChars: 64000, links: 200, metas: 64,
};
const COLUMNS = { ai: { off: 'ai_off', paused: 'ai_paused', exempt: 'ai_exempt' }, fetch: { off: 'fetch_off', paused: 'fetch_paused', exempt: 'fetch_exempt' } };
const COUNTERS = new Set(['ai_fast', 'ai_smart', 'ai_calls', 'fetches']);
const ZERO = { ai_fast: 0, ai_smart: 0, ai_calls: 0, fetches: 0 };
// The whole building's pause is a row of its own. No floor has id 0.
const BUILDING = [0, '*'];

export function createPowers(db, cfg, now = Date.now) {
  const AI = { ...AI_DEFAULTS, ...(cfg.cloudAiLimits || {}) };
  const WEB = { ...FETCH_DEFAULTS, ...(cfg.cloudFetchLimits || {}) };
  AI.buildingDayUsd = Math.max(0, AI.buildingDayUsd);
  const switchedOn = { ai: cfg.officeAiEnabled !== false, fetch: cfg.officeFetchEnabled !== false };
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const row = (f, p) => get(db, 'SELECT * FROM cloud_powers WHERE floor_id=? AND project=?', f, p);
  function setFlag(f, p, column, value) {
    run(db, `INSERT INTO cloud_powers (floor_id,project,${column}) VALUES (?,?,?) ON CONFLICT(floor_id,project) DO UPDATE SET ${column}=excluded.${column}`, f, p, value ? 1 : 0);
  }
  const buildingPaused = (kind) => !!row(...BUILDING)?.[COLUMNS[kind].paused];
  /** Why this project can't use the power right now: 'building', 'paused', 'off', or null when it can. */
  function blocked(kind, f, p) {
    const c = COLUMNS[kind];
    const r = row(f, p);
    // A project the admin let through stays on while the rest of the building is paused. Switched off in the settings is off for everyone.
    if (!switchedOn[kind] || (buildingPaused(kind) && !r?.[c.exempt])) return 'building';
    if (r?.[c.paused]) return 'paused';
    if (r?.[c.off]) return 'off';
    return null;
  }
  const counts = (f, p) => get(db, 'SELECT * FROM cloud_power_days WHERE floor_id=? AND project=? AND day=?', f, p, today()) || { ...ZERO };
  function add(f, p, deltas) {
    const keys = Object.keys(deltas).filter((k) => COUNTERS.has(k));
    if (!keys.length) return;
    run(db, `INSERT INTO cloud_power_days (floor_id,project,day,${keys.join(',')}) VALUES (?,?,?,${keys.map(() => '?').join(',')})
      ON CONFLICT(floor_id,project,day) DO UPDATE SET ${keys.map((k) => `${k}=${k}+excluded.${k}`).join(',')}`, f, p, today(), ...keys.map((k) => deltas[k]));
  }
  const aiLeft = (c) => ({ fast: Math.max(0, AI.dayFast - c.ai_fast), smart: Math.max(0, AI.daySmart - c.ai_smart) });
  const fetchLeft = (c) => Math.max(0, WEB.dayProject - c.fetches);
  /** What the boss's Backend panel shows: what's on, and how much is left today. */
  function view(f, p) {
    const r = row(f, p), c = counts(f, p), left = aiLeft(c);
    const stopped = (kind) => !!(r?.[COLUMNS[kind].paused] || (buildingPaused(kind) && !r?.[COLUMNS[kind].exempt]) || !switchedOn[kind]);
    return {
      ai: { on: !r?.ai_off, paused: stopped('ai'), callsToday: c.ai_calls, fastLeft: left.fast, smartLeft: left.smart, fastPerDay: AI.dayFast, smartPerDay: AI.daySmart },
      fetch: { on: !r?.fetch_off, paused: stopped('fetch'), fetchedToday: c.fetches, left: fetchLeft(c), perDay: WEB.dayProject },
    };
  }
  const setOff = (f, p, kind, off) => setFlag(f, p, COLUMNS[kind].off, off);
  const setPaused = (f, p, kind, paused) => setFlag(f, p, COLUMNS[kind].paused, paused);
  /** Let one project through a building-wide pause, or take that back. Pausing the project itself still stops it. */
  const setExempt = (f, p, kind, exempt) => setFlag(f, p, COLUMNS[kind].exempt, exempt);
  // Pausing the whole building is the emergency stop, so it takes back every exception as well.
  const setBuildingPaused = (kind, paused) => tx(db, () => {
    setFlag(...BUILDING, COLUMNS[kind].paused, paused);
    if (paused) run(db, `UPDATE cloud_powers SET ${COLUMNS[kind].exempt}=0 WHERE floor_id>0`);
  });
  /** For the admin: every project with a switch set or anything used today, plus the state of the whole building. */
  function status(kind) {
    const rows = all(db, `SELECT floor_id, project FROM cloud_powers WHERE floor_id>0 UNION SELECT floor_id, project FROM cloud_power_days WHERE day=? ORDER BY floor_id, project`, today());
    return { on: switchedOn[kind], buildingPaused: buildingPaused(kind), projects: rows.map((x) => ({ floorId: x.floor_id, project: x.project, ...view(x.floor_id, x.project)[kind], exempt: !!row(x.floor_id, x.project)?.[COLUMNS[kind].exempt] })) };
  }
  // A week of counts is plenty: only today's are ever used.
  const sweep = () => run(db, 'DELETE FROM cloud_power_days WHERE day < ?', new Date(now() - 7 * 86400000).toISOString().slice(0, 10)).changes;
  return { AI, WEB, today, blocked, counts, add, aiLeft, view, setOff, setPaused, setExempt, setBuildingPaused, status, sweep };
}
