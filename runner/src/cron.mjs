// Five-field cron (minute hour day-of-month month day-of-week), evaluated in UTC.
// Supports *, numbers, a-b ranges, lists and /steps, plus @hourly, @daily, @weekly and @monthly.
const FIELDS = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day', 1, 31],
  ['month', 1, 12],
  ['weekday', 0, 7],
];
const ALIASES = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *' };
export const MIN_GAP_MINUTES = 5;

export function parseCron(input) {
  const expr = ALIASES[String(input).trim()] ?? String(input).trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) throw new Error('cron needs 5 fields: minute hour day month weekday');
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]));
  const mins = [...sets[0]].sort((a, b) => a - b);
  for (let i = 0; i < mins.length; i++) {
    const gap = i + 1 < mins.length ? mins[i + 1] - mins[i] : mins[0] + 60 - mins[i];
    if (mins.length > 1 && gap < MIN_GAP_MINUTES) throw new Error(`jobs may run at most every ${MIN_GAP_MINUTES} minutes`);
  }
  return { expr, sets, dayStar: parts[2] === '*', weekdayStar: parts[4] === '*' };
}

function parseField(text, [name, lo, hi]) {
  const set = new Set();
  for (const item of text.split(',')) {
    const m = /^(\*|(\d{1,2})(?:-(\d{1,2}))?)(?:\/(\d{1,2}))?$/.exec(item);
    if (!m) throw new Error(`bad cron ${name}: ${item}`);
    let a = lo;
    let b = hi;
    if (m[2] !== undefined) {
      a = Number(m[2]);
      b = m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a;
    }
    const step = m[4] ? Number(m[4]) : 1;
    if (step < 1 || a < lo || b > hi || a > b) throw new Error(`bad cron ${name}: ${item}`);
    for (let v = a; v <= b; v += step) set.add(name === 'weekday' && v === 7 ? 0 : v);
  }
  return set;
}

export function cronMatches(c, date) {
  const [min, hour, day, month, weekday] = c.sets;
  if (!min.has(date.getUTCMinutes()) || !hour.has(date.getUTCHours()) || !month.has(date.getUTCMonth() + 1)) return false;
  const dayOk = day.has(date.getUTCDate());
  const weekdayOk = weekday.has(date.getUTCDay());
  if (c.dayStar && c.weekdayStar) return true;
  if (c.dayStar) return weekdayOk;
  if (c.weekdayStar) return dayOk;
  return dayOk || weekdayOk; // classic cron: either restricted field may match
}
