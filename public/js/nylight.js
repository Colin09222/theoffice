// Real New York light (round 2, r2-j35; docs/redesign/OFFICE-ANSWERS-2.md, Q2). New York time for everyone. Sunrise and sunset are worked out
// from the date by formula (no data feed); the day has 4 looks (dawn, day, golden hour = the last 60 minutes before sunset, night), each change
// blended over 20 minutes, read once a minute. From 23:00 to 08:00 the room lights and desk lamps are off on every floor; the crown sign, the
// billboard, the street lights and the visit sign lights stay on. No DOM and no three.js here, so a node test reads it with a fake clock.

export const TZ = 'America/New_York';
const LAT = 40.7128, LON = -74.006;         // City Hall, New York
export const BLEND_MIN = 20;                // each change of look takes 20 minutes
export const LIGHTS_OFF_FROM = 23 * 60, LIGHTS_ON_AT = 8 * 60;   // 23:00 to 08:00, New York time
export const UPDATE_MS = 60000;             // read once a minute

let fmt = null;
/** The New York wall clock for an instant: year, month (1 to 12), day, hour, minute, second, weekday (0 = Sunday). */
export function nyParts(ms) {
  fmt ||= new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour % 24, minute: +o.minute, second: +o.second, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}
/** New York's offset from UTC in minutes at an instant (-300 in winter, -240 in summer). */
export function nyOffsetMin(ms) {
  const p = nyParts(ms);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

const rad = Math.PI / 180;
/** Sunrise or sunset in UTC hours for a date, by the almanac formula (accurate to a couple of minutes). */
function sunUtcHours(y, m, d, rising) {
  const N = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const lngHour = LON / 15;
  const t = N + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634; L = ((L % 360) + 360) % 360;
  let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad; RA = ((RA % 360) + 360) % 360;
  RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
  const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(LAT * rad)) / (cosDec * Math.cos(LAT * rad));
  const H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  return (((T - lngHour) % 24) + 24) % 24;
}
/** Sunrise and sunset for a New York date, as minutes after New York midnight. */
export function sunTimes(y, m, d) {
  const off = nyOffsetMin(Date.UTC(y, m - 1, d, 17));
  const local = (h) => (((Math.round(h * 60) + off) % 1440) + 1440) % 1440;
  return { rise: local(sunUtcHours(y, m, d, true)), set: local(sunUtcHours(y, m, d, false)) };
}

export const LOOKS = ['dawn', 'day', 'golden', 'night'];
/**
 * The light at an instant: how much of each look (weights add to 1), the main one, sunrise and sunset, and whether room lights are on.
 * Dawn runs from 30 minutes before sunrise to an hour after it, golden hour is the last 60 minutes before sunset, night is after sunset until
 * dawn. Each boundary blends over 20 minutes (10 either side).
 */
export function lightAt(ms) {
  const p = nyParts(ms);
  const t = p.hour * 60 + p.minute + p.second / 60;
  const { rise, set } = sunTimes(p.year, p.month, p.day);
  const marks = [[rise - 30, 'dawn'], [rise + 60, 'day'], [set - 60, 'golden'], [set, 'night']];
  const weights = { dawn: 0, day: 0, golden: 0, night: 0 };
  // The look before the first mark is night; find the segment t is in, then the blend with its neighbour at the nearest boundary.
  let i = marks.findLastIndex(([at]) => t >= at);
  const cur = i < 0 ? 'night' : marks[i][1];
  const prevOf = (k) => (k <= 0 ? 'night' : marks[k - 1][1]);
  const half = BLEND_MIN / 2;
  weights[cur] = 1;
  // Near the boundary we just crossed: still partly the look before it.
  if (i >= 0 && t < marks[i][0] + half) { const w = (t - (marks[i][0] - half)) / BLEND_MIN; weights[cur] = w; weights[prevOf(i)] += 1 - w; }
  // Near the next boundary: already partly the look after it.
  const next = marks[i + 1];
  if (next && t > next[0] - half) { const w = (t - (next[0] - half)) / BLEND_MIN; weights[cur] -= w; weights[next[1]] += w; }
  const phase = LOOKS.reduce((a, b) => (weights[b] > weights[a] ? b : a));
  return { weights, phase, rise, set, minutes: t, lightsOn: lightsOnAt(t), month: p.month, day: p.day, weekday: p.weekday, hour: p.hour };
}
/** Room lights and desk lamps: on from 08:00, off from 23:00 (minutes after New York midnight). */
export const lightsOnAt = (minutes) => minutes >= LIGHTS_ON_AT && minutes < LIGHTS_OFF_FROM;

// What each look does to the scene. Colours are 0 to 1 sRGB. Golden is the look the building always had before round 2.
export const PALETTE = {
  dawn:   { sky: [1.0, 0.80, 0.86], sun: [1.0, 0.70, 0.62], sunI: 2.4, hemiSky: [0.76, 0.74, 0.86], hemiGround: [0.70, 0.56, 0.52], hemiI: 0.5, fillI: 0.42, exposure: 0.88, street: 0.5 },
  day:    { sky: [0.96, 1.0, 1.06], sun: [1.0, 0.93, 0.84], sunI: 4.2, hemiSky: [0.80, 0.84, 0.93], hemiGround: [0.80, 0.70, 0.56], hemiI: 0.72, fillI: 0.45, exposure: 0.94, street: 0 },
  golden: { sky: [1.0, 1.0, 1.0], sun: [1.0, 0.75, 0.53], sunI: 4.5, hemiSky: [0.73, 0.75, 0.85], hemiGround: [0.81, 0.62, 0.44], hemiI: 0.6, fillI: 0.5, exposure: 0.92, street: 0.15 },
  night:  { sky: [0.12, 0.15, 0.30], sun: [0.55, 0.62, 0.86], sunI: 0.35, hemiSky: [0.30, 0.34, 0.52], hemiGround: [0.18, 0.16, 0.22], hemiI: 0.3, fillI: 0.18, exposure: 0.84, street: 1 },
};
/** The blended numbers for a set of weights. */
export function mixLook(weights) {
  const out = {};
  for (const k of Object.keys(PALETTE.day)) {
    const v = PALETTE.day[k];
    out[k] = Array.isArray(v) ? v.map((_, j) => LOOKS.reduce((s, l) => s + weights[l] * PALETTE[l][k][j], 0)) : LOOKS.reduce((s, l) => s + weights[l] * PALETTE[l][k], 0);
  }
  return out;
}

/** Round 2, r2-j72: the December set runs from 1 to 31 December, New York time. */
export const isDecember = (ms) => nyParts(ms).month === 12;

/** A clock that reads the light once a minute (and at once the first time). `now` is passed in so a test can move it. */
export function lightClock({ now = () => Date.now(), apply }) {
  let last = -Infinity, cur = null;
  return {
    get current() { return cur; },
    tick(force = false) {
      const t = now();
      if (!force && t - last < UPDATE_MS) return false;
      last = t; cur = lightAt(t); apply(cur, mixLook(cur.weights));
      return true;
    },
  };
}
