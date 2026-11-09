#!/usr/bin/env node
// Third Party Rising — real-world data pipeline.
//
//   node tools/data/build.mjs            # all 50 states + data/us.json
//   node tools/data/build.mjs OH TX      # only these packs (us.json is still rewritten)
//
// Downloads are cached in tools/data/cache/ (gitignored). Every source used is
// documented in ../../SOURCES.md. Nothing in the output is invented: fields that
// cannot be sourced are null and explained in the pack's `estimates` array.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import mapshaper from 'mapshaper';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CACHE = path.join(HERE, 'cache');
const PACKS = path.join(ROOT, 'data/packs');

// ---------------------------------------------------------------- vintages
const CB_YEAR = 2025;      // cartographic boundary files (counties, states, SLDL, SLDU)
const CB_YEAR_CT = 2021;   // last vintage with Connecticut's 8 historical counties
const GAZ_YEAR = 2025;     // Gazetteer (places, counties)
const GAZ_YEAR_CT = 2021;
const ACS_YEAR = 2024;     // ACS 5-year table-based summary file (2020-2024)
const ACS_YEAR_CT = 2021;  // last ACS 5-year published for the 8 old CT counties (2017-2021)
const ACS_TABLES = ['b01003', 'b19013', 'b01002', 'b15003', 'b03002'];
const PRES_YEARS = [2016, 2020, 2024];
const GEO_BUDGET = 380 * 1024; // target ceiling for one state's .geo.json, bytes

const URLS = {
  cbCounty: (y) => `https://www2.census.gov/geo/tiger/GENZ${y}/shp/cb_${y}_us_county_500k.zip`,
  cbState: (y) => `https://www2.census.gov/geo/tiger/GENZ${y}/shp/cb_${y}_us_state_5m.zip`,
  cbSld: (y, fips, ch) => `https://www2.census.gov/geo/tiger/GENZ${y}/shp/cb_${y}_${fips}_sld${ch}_500k.zip`,
  gazPlace: (y) => `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${y}_Gazetteer/${y}_Gaz_place_national.zip`,
  gazCounty: (y) => `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${y}_Gazetteer/${y}_Gaz_counties_national.zip`,
  acs: (y, t) => `https://www2.census.gov/programs-surveys/acs/summary_file/${y}/table-based-SF/data/5YRData/acsdt5y${y}-${t}.dat`,
  // Preferred election source (CC0) — currently behind a Dataverse guestbook, so not fetchable unattended.
  medsl: 'https://dataverse.harvard.edu/api/access/datafile/13573089',
  // Fallback election source actually used (MIT).
  tonmcg: (y) => `https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/${y}_US_County_Level_Presidential_Results.csv`,
  openstates: (usps) => `https://data.openstates.org/people/current/${usps.toLowerCase()}.csv`,
};

// ---------------------------------------------------------------- helpers
const log = (...a) => console.error(...a);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r1 = (x) => Math.round(x * 10) / 10;

/** Download `url` into cache/<rel> (if not already there). Returns the path, or null on failure. */
function fetchCached(url, rel, { optional = false } = {}) {
  const dest = path.join(CACHE, rel);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  if (fs.existsSync(dest + '.missing')) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  try {
    execFileSync('curl', ['-sSL', '--fail', '--retry', '3', '--retry-delay', '2', '-o', tmp, url], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.renameSync(tmp, dest);
    log(`  fetched ${url}`);
    return dest;
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    const msg = String(e.stderr || e.message).trim().split('\n').pop();
    if (!optional) throw new Error(`download failed: ${url}: ${msg}`);
    log(`  NOT fetched ${url}: ${msg}`);
    if (/error: 40[34]/.test(msg)) fs.writeFileSync(dest + '.missing', msg);
    return null;
  }
}

/** Read all entries of a zip into {name: Buffer}. */
function unzip(file) {
  const out = {};
  for (const e of new AdmZip(file).getEntries()) if (!e.isDirectory) out[path.basename(e.entryName)] = e.getData();
  return out;
}

/** Shapefile zip -> GeoJSON FeatureCollection (unsimplified), via mapshaper. */
async function shpZipToGeoJSON(file, extraCmd = '') {
  const z = unzip(file);
  const shp = Object.keys(z).find((n) => n.endsWith('.shp'));
  const base = shp.slice(0, -4);
  const input = {};
  for (const ext of ['.shp', '.dbf', '.prj', '.cpg']) if (z[base + ext]) input['in' + ext] = z[base + ext];
  const res = await mapshaper.applyCommands(`-i in.shp ${extraCmd} -o out.json format=geojson`, input);
  return JSON.parse(res['out.json'].toString());
}

/** Topologically simplify a FeatureCollection (shared borders stay shared within the layer). */
async function simplify(fc, intervalM) {
  if (!fc.features.length) return fc;
  const minIsland = Math.round(intervalM * intervalM * 6); // m^2
  const cmd = `-i in.json -simplify interval=${intervalM} keep-shapes -filter-islands min-area=${minIsland} -o out.json format=geojson precision=0.0001`;
  const res = await mapshaper.applyCommands(cmd, { 'in.json': JSON.stringify(fc) });
  const out = JSON.parse(res['out.json'].toString());
  if (out.features.length !== fc.features.length) throw new Error('simplify changed feature count');
  return out;
}

function polysOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  if (geom.type === 'GeometryCollection') return geom.geometries.flatMap(polysOf);
  return [];
}

/** GeoJSON geometry -> pack MultiPolygon encoding (flat rings, 4 dp, unclosed). */
function encodeGeom(geom) {
  const encRing = (ring) => {
    const flat = [];
    for (const [x0, y0] of ring) {
      const x = r4(x0), y = r4(y0);
      const n = flat.length;
      if (n >= 2 && flat[n - 2] === x && flat[n - 1] === y) continue;
      flat.push(x, y);
    }
    while (flat.length >= 4 && flat[0] === flat[flat.length - 2] && flat[1] === flat[flat.length - 1]) flat.length -= 2;
    return flat;
  };
  const all = polysOf(geom).map((poly) => poly.map(encRing));
  const good = all.map((poly) => (poly[0].length >= 6 ? poly.filter((r) => r.length >= 6) : null)).filter(Boolean);
  if (good.length) return good;
  // every polygon degenerated at 4 dp: keep the biggest raw outer ring rather than emit nothing
  const biggest = all.sort((a, b) => b[0].length - a[0].length)[0];
  return biggest ? [[biggest[0]]] : [];
}

function ringArea(flat) { // signed, planar
  let a = 0;
  for (let i = 0, n = flat.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += flat[i] * flat[j + 1] - flat[j] * flat[i + 1];
  }
  return a / 2;
}
function ringCentroid(flat) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = flat.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const f = flat[i] * flat[j + 1] - flat[j] * flat[i + 1];
    a += f; cx += (flat[i] + flat[j]) * f; cy += (flat[i + 1] + flat[j + 1]) * f;
  }
  if (Math.abs(a) < 1e-12) return [flat[0], flat[1]];
  return [cx / (3 * a), cy / (3 * a)];
}
/** Centroid of the largest polygon (outer ring) of an encoded MultiPolygon. */
function centroid(mp) {
  let best = null, bestA = -1;
  for (const poly of mp) {
    const a = Math.abs(ringArea(poly[0]));
    if (a > bestA) { bestA = a; best = poly[0]; }
  }
  return best ? ringCentroid(best) : [0, 0];
}
function inRing(flat, x, y) {
  let inside = false;
  for (let i = 0, n = flat.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = flat[i], yi = flat[i + 1], xj = flat[j], yj = flat[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inMulti(mp, x, y) {
  for (const poly of mp) {
    if (!inRing(poly[0], x, y)) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(poly[h], x, y)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
/** Full-precision GeoJSON geometry -> flat-ring MultiPolygon without rounding (for point-in-polygon). */
function flatGeom(geom) {
  return polysOf(geom).map((poly) => poly.map((ring) => ring.slice(0, -1).flat()));
}
function bboxOfMulti(mp, bb = [Infinity, Infinity, -Infinity, -Infinity]) {
  for (const poly of mp) {
    const r = poly[0];
    for (let i = 0; i < r.length; i += 2) {
      if (r[i] < bb[0]) bb[0] = r[i]; if (r[i] > bb[2]) bb[2] = r[i];
      if (r[i + 1] < bb[1]) bb[1] = r[i + 1]; if (r[i + 1] > bb[3]) bb[3] = r[i + 1];
    }
  }
  return bb;
}
/** Index of the shape containing (lon,lat); nearest centre if none. Returns [index, wasInside]. */
function locate(shapes, bboxes, centres, lon, lat) {
  for (let i = 0; i < shapes.length; i++) {
    const b = bboxes[i];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (inMulti(shapes[i], lon, lat)) return [i, true];
  }
  let best = -1, bd = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < centres.length; i++) {
    const dx = (centres[i][0] - lon) * k, dy = centres[i][1] - lat;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return [best, false];
}

function parseDelimited(text) { // Gazetteer files: tab-delimited up to 2023, pipe-delimited since
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const sep = lines[0].includes('|') ? '|' : '\t';
  const head = lines[0].split(sep).map((s) => s.trim());
  return lines.slice(1).map((l) => {
    const c = l.split(sep);
    const o = {};
    head.forEach((h, i) => (o[h] = (c[i] ?? '').trim()));
    return o;
  });
}
function parseCSV(text) { // RFC-4180-ish
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  const head = rows[0];
  return rows.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// ---------------------------------------------------------------- ACS
/** Extract state (040), county (050) and place (160) rows of the tables we need. Cached as JSON. */
async function loadACS(year) {
  const cacheFile = path.join(CACHE, `acs/acs5y${year}-extract.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const want = {
    b01003: ['B01003_E001'],
    b19013: ['B19013_E001'],
    b01002: ['B01002_E001'],
    b15003: ['B15003_E001', 'B15003_E022', 'B15003_E023', 'B15003_E024', 'B15003_E025'],
    b03002: ['B03002_E001', 'B03002_E003', 'B03002_E004', 'B03002_E006', 'B03002_E012'],
  };
  const out = {};
  for (const t of ACS_TABLES) {
    const file = fetchCached(URLS.acs(year, t), `acs/acsdt5y${year}-${t}.dat`);
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    let idx = null;
    for await (const line of rl) {
      if (!idx) {
        const head = line.split('|');
        idx = want[t].map((c) => head.indexOf(c));
        if (idx.includes(-1)) throw new Error(`ACS ${year} ${t}: missing columns`);
        continue;
      }
      const p = line.slice(0, 9);
      if (p !== '0400000US' && p !== '0500000US' && p !== '1600000US') continue;
      const c = line.split('|');
      const key = c[0].slice(0, 3) + ':' + c[0].slice(9);
      const rec = (out[key] ??= {});
      want[t].forEach((col, i) => {
        const v = Number(c[idx[i]]);
        rec[col] = c[idx[i]] === '' || !Number.isFinite(v) || v < 0 ? null : v; // negative = Census jam value (suppressed)
      });
    }
    log(`  parsed ACS ${year} ${t}`);
  }
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}
function demo(rec) {
  const d = { pop: null, income: null, age: null, bach: null, white: null, black: null, hisp: null, asian: null };
  if (!rec) return d;
  d.pop = rec.B01003_E001 ?? null;
  d.income = rec.B19013_E001 ?? null;
  d.age = rec.B01002_E001 ?? null;
  const e = rec.B15003_E001;
  if (e > 0 && [22, 23, 24, 25].every((n) => rec[`B15003_E0${n}`] != null)) {
    d.bach = r4((rec.B15003_E022 + rec.B15003_E023 + rec.B15003_E024 + rec.B15003_E025) / e);
  }
  const t = rec.B03002_E001;
  if (t > 0) {
    const sh = (k) => (rec[k] == null ? null : r4(rec[k] / t));
    d.white = sh('B03002_E003'); d.black = sh('B03002_E004'); d.asian = sh('B03002_E006'); d.hisp = sh('B03002_E012');
  }
  return d;
}

// ---------------------------------------------------------------- elections
/** -> { year: { fips5: [dem, rep, other] } } plus Alaska statewide totals. Source: tonmcg (MIT). */
function loadElections() {
  // Preferred source: MIT Election Data + Science Lab county returns (CC0). The file sits behind a
  // Dataverse guestbook; we try it so that the log shows the state of play, but do not parse it.
  const medsl = fetchCached(URLS.medsl, 'medsl/countypres_2000-2024.tab', { optional: true });
  if (medsl) log('  NOTE: MEDSL county returns downloaded to cache but this build still uses the tonmcg fallback; switch loadElections() over and re-verify.');

  const byYear = {}, akState = {};
  for (const y of PRES_YEARS) {
    const file = fetchCached(URLS.tonmcg(y), `tonmcg/${y}.csv`);
    const rows = parseCSV(fs.readFileSync(file, 'utf8'));
    const m = (byYear[y] = {});
    const ak = [0, 0, 0];
    let akSeen = false;
    for (const r of rows) {
      const fips = String(r.county_fips ?? r.combined_fips).padStart(5, '0');
      const dem = Math.round(Number(r.votes_dem)), rep = Math.round(Number(r.votes_gop)), tot = Math.round(Number(r.total_votes));
      if (![dem, rep, tot].every(Number.isFinite)) continue;
      const v = [dem, rep, Math.max(0, tot - dem - rep)];
      if (fips.startsWith('02')) {
        // 2016 file repeats the statewide total on every Alaska row; 2020/2024 list the 40 state house districts.
        if (y === 2016) { if (!akSeen) { ak[0] = v[0]; ak[1] = v[1]; ak[2] = v[2]; akSeen = true; } }
        else { ak[0] += v[0]; ak[1] += v[1]; ak[2] += v[2]; }
        continue;
      }
      if (m[fips]) { m[fips][0] += v[0]; m[fips][1] += v[1]; m[fips][2] += v[2]; } else m[fips] = v;
    }
    akState[y] = ak;
    // FIPS code changes: Shannon County SD -> Oglala Lakota County (46113 -> 46102).
    if (m['46113'] && !m['46102']) m['46102'] = m['46113'];
  }
  return { byYear, akState };
}

// ---------------------------------------------------------------- legislators (OpenStates)
const PARTY = (p) => {
  const s = p.toLowerCase();
  if (s.startsWith('democrat')) return 'D'; // Democratic, Democratic-Farmer-Labor, Democratic-NPL, Democratic/Progressive
  if (s.startsWith('republican')) return 'R';
  if (s.startsWith('libertarian')) return 'L';
  if (s.startsWith('green')) return 'G';
  if (s.startsWith('independent') || s === 'nonpartisan' || s === 'unenrolled' || s === 'no party preference' || s === 'unaffiliated') return 'I';
  return 'O';
};
function loadLegislators(usps) {
  const file = fetchCached(URLS.openstates(usps), `openstates/${usps.toLowerCase()}.csv`, { optional: true });
  if (!file) return null;
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  const out = { lower: [], upper: [] };
  for (const r of rows) {
    const ch = r.current_chamber === 'legislature' ? 'upper' : r.current_chamber; // Nebraska unicameral
    if (!out[ch] || !r.name || !r.current_district) continue;
    out[ch].push({ name: r.name.trim(), party: PARTY(r.current_party || ''), district: r.current_district.trim() });
  }
  return out;
}

const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const TENS = { twenty: 20, thirty: 30, forty: 40 };
/** Normalise a district label / code / name to a comparable key. */
function normDistrict(s) {
  let t = String(s).toLowerCase().replace(/&/g, ' and ').replace(/\bst\.?\s/g, 'saint ');
  t = t.replace(/\b(twenty|thirty|forty)[- ](first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g, (_, a, b) => String(TENS[a] + ORD[b]));
  t = t.replace(/\b[a-z]+\b/g, (w) => (ORD[w] ? String(ORD[w]) : w));
  t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
  t = t.replace(/\b(state|house|senate|senatorial|representative|legislative|assembly|general|districts?|subdistrict|county|counties|no|of|the|and)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.split(' ').map((w) => w.replace(/^0+(?=[0-9a-z])/, '')).join('');
  return t;
}

/**
 * Build one seat entry per official seat.
 * shapes: [{code, namelsad, lat, lon, landKm2, county}], legs: [{name, party, district}] | null
 */
function buildSeats(shapes, legs, nSeats, chamberWord, stats, opts = {}) {
  if (nSeats === 0) return [];
  if (!shapes.length) throw new Error(`no ${chamberWord} shapes but ${nSeats} seats`);
  const perShape = shapes.map(() => []);
  let matched = 0, floterial = 0, unmatched = [];
  if (legs && legs.length) {
    const key = new Map();
    const add = (k, i) => { if (k && !key.has(k)) key.set(k, i); };
    shapes.forEach((s, i) => add(normDistrict(s.code), i));
    shapes.forEach((s, i) => add(normDistrict(s.namelsad), i));
    shapes.forEach((s, i) => add(normDistrict(s.name), i));
    for (const l of legs) {
      const k = normDistrict(l.district);
      let i = key.get(k);
      if (i === undefined) i = key.get(k.replace(/(?<=\d)[a-z]$/, '')); // "1A"/"1B" seats of district 1 (ID, WA positions, ...)
      if (i === undefined) { unmatched.push(l); continue; }
      perShape[i].push({ name: l.name, party: l.party });
      matched++;
    }
    if (opts.floterialByCounty && matched) {
      // New Hampshire floterial districts overlay several base districts of one county and have no
      // Census shape. Seat their members on the base district of the same county holding the fewest seats.
      const rest = [];
      for (const l of unmatched) {
        const county = l.district.replace(/\s*\d+$/, '').toLowerCase();
        let bi = -1;
        shapes.forEach((s, i) => {
          if (!s.name.toLowerCase().startsWith(county + ' ')) return;
          if (bi < 0 || perShape[i].length < perShape[bi].length) bi = i;
        });
        if (bi < 0 || !county) { rest.push(l); continue; }
        perShape[bi].push({ name: l.name, party: l.party });
        floterial++;
      }
      unmatched = rest;
    }
    unmatched = unmatched.map((l) => l.district);
  }
  const useLegs = matched > 0;
  if (!useLegs) perShape.forEach((a) => (a.length = 0));
  let total = perShape.reduce((n, a) => n + a.length, 0);
  let trimmed = 0;
  // Too many (data lag around special elections): trim from the fullest shapes, last first.
  while (total > nSeats) {
    let bi = 0;
    perShape.forEach((a, i) => { if (a.length >= perShape[bi].length) bi = i; });
    perShape[bi].pop(); total--; trimmed++;
  }
  // Too few (vacancies / unmatched / no data): add empty seats to the emptiest shapes, in shape order.
  let added = 0;
  while (total < nSeats) {
    let bi = 0;
    perShape.forEach((a, i) => { if (a.length < perShape[bi].length) bi = i; });
    perShape[bi].push(null); total++; added++;
  }
  const seats = [];
  shapes.forEach((s, i) => {
    const list = perShape[i];
    const baseName = s.namelsad.replace(/^State /, '').replace(/\s+/g, ' ').trim() || `${chamberWord} District ${s.id}`;
    list.forEach((inc, k) => {
      const multi = list.length > 1;
      seats.push({
        id: multi ? `${s.id}/${k + 1}` : s.id,
        name: multi ? `${baseName} (Seat ${k + 1})` : baseName,
        shape: i, lat: s.lat, lon: s.lon, landKm2: s.landKm2, county: s.county,
        inc: inc ? { name: inc.name, party: inc.party } : null,
      });
    });
  });
  Object.assign(stats, {
    legislators: legs ? legs.length : null, matched: useLegs ? matched : 0, floterial, unmatched, trimmed, vacant: added,
    shapes: shapes.length, seats: nSeats, emptyShapes: perShape.filter((a) => !a.length).length, usedOpenStates: useLegs,
  });
  return seats;
}

// ---------------------------------------------------------------- place names
function splitPlaceName(full) {
  let name = full.replace(/\s*\(balance\)\s*$/i, '').trim();
  // Legal/statistical suffix = trailing all-lowercase words ("city", "town", "city and borough", "unified government", ...)
  const m = name.match(/^(.*?[^a-z\s].*?)\s+((?:[a-z]+\s?)+)$/);
  if (m && /^[A-Z0-9]/.test(m[1].trim().split(/\s+/).pop() ?? '') ) return { name: m[1].trim(), kind: m[2].trim() };
  if (m) return { name: m[1].trim(), kind: m[2].trim() };
  return { name, kind: 'city' === name.toLowerCase().split(' ').pop() ? 'city' : 'place' };
}

// ---------------------------------------------------------------- main
async function main() {
  const statesMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/states.json'), 'utf8'));
  const col = Object.fromEntries(statesMeta.columns.map((c, i) => [c, i]));
  const seatCount = Object.fromEntries(statesMeta.rows.map((r) => [r[col.usps], { name: r[col.name], house: r[col.house], senate: r[col.senate] }]));
  const ALL = statesMeta.rows.map((r) => r[col.usps]);
  const args = process.argv.slice(2).map((s) => s.toUpperCase());
  for (const a of args) if (!seatCount[a]) throw new Error(`unknown state ${a}`);
  const todo = args.length ? args : ALL;
  fs.mkdirSync(PACKS, { recursive: true });

  log('== national inputs');
  const stateFC = await shpZipToGeoJSON(fetchCached(URLS.cbState(CB_YEAR), `cb/cb_${CB_YEAR}_us_state_5m.zip`));
  const fipsOf = {}, stateFeat = {};
  for (const f of stateFC.features) { fipsOf[f.properties.STUSPS] = f.properties.STATEFP; stateFeat[f.properties.STUSPS] = f; }

  const countyFC = await shpZipToGeoJSON(fetchCached(URLS.cbCounty(CB_YEAR), `cb/cb_${CB_YEAR}_us_county_500k.zip`));
  const countyFCct = await shpZipToGeoJSON(fetchCached(URLS.cbCounty(CB_YEAR_CT), `cb/cb_${CB_YEAR_CT}_us_county_500k.zip`), `-filter 'STATEFP=="09"'`);
  const countiesByState = {};
  for (const f of countyFC.features) if (f.properties.STATEFP !== '09') (countiesByState[f.properties.STATEFP] ??= []).push(f);
  countiesByState['09'] = countyFCct.features;

  const gazTxt = (file) => { const z = unzip(file); return z[Object.keys(z).find((n) => n.endsWith('.txt'))].toString('utf8'); };
  const gazCounty = {};
  for (const r of parseDelimited(gazTxt(fetchCached(URLS.gazCounty(GAZ_YEAR), `gaz/${GAZ_YEAR}_Gaz_counties_national.zip`)))) if (r.USPS !== 'CT') gazCounty[r.GEOID] = r;
  for (const r of parseDelimited(gazTxt(fetchCached(URLS.gazCounty(GAZ_YEAR_CT), `gaz/${GAZ_YEAR_CT}_Gaz_counties_national.zip`)))) if (r.USPS === 'CT') gazCounty[r.GEOID] = r;
  const gazPlaces = {};
  for (const r of parseDelimited(gazTxt(fetchCached(URLS.gazPlace(GAZ_YEAR), `gaz/${GAZ_YEAR}_Gaz_place_national.zip`)))) (gazPlaces[r.USPS] ??= []).push(r);

  const acs = await loadACS(ACS_YEAR);
  const acsCT = await loadACS(ACS_YEAR_CT);
  const { byYear: pres, akState } = loadElections();

  const summary = [];
  for (const usps of todo) {
    log(`== ${usps}`);
    const fips = fipsOf[usps];
    const meta = seatCount[usps];
    const estimates = [];
    const isCT = usps === 'CT', isAK = usps === 'AK';

    // ---- counties
    const cFeats = countiesByState[fips].slice().sort((a, b) => (a.properties.GEOID < b.properties.GEOID ? -1 : 1));
    const stateLandKm2 = cFeats.reduce((s, f) => s + Number(f.properties.ALAND), 0) / 1e6;
    // Simplification tolerance scales with the state's linear size (~0.6 m per km of sqrt(land area)).
    // Coast- and river-heavy states get a coarser pass until the geo file fits the size budget.
    let interval = Math.max(15, Math.round(Math.sqrt(stateLandKm2) * 0.6));
    const sld = {};
    for (const [chamber, ch] of [['house', 'l'], ['senate', 'u']]) {
      if (meta[chamber] === 0) continue;
      const fc = await shpZipToGeoJSON(fetchCached(URLS.cbSld(CB_YEAR, fips, ch), `cb/cb_${CB_YEAR}_${fips}_sld${ch}_500k.zip`));
      const codeField = ch === 'l' ? 'SLDLST' : 'SLDUST';
      fc.features = fc.features.filter((f) => !/^ZZ/.test(f.properties[codeField])).sort((a, b) => (a.properties[codeField] < b.properties[codeField] ? -1 : 1));
      sld[chamber] = { fc, codeField };
    }
    let geoCounties, geoSld;
    for (let pass = 0; ; pass++) {
      const cSimp = await simplify({ type: 'FeatureCollection', features: cFeats }, interval);
      geoCounties = cSimp.features.map((f) => encodeGeom(f.geometry));
      geoSld = {};
      for (const chamber of Object.keys(sld)) geoSld[chamber] = (await simplify(sld[chamber].fc, interval)).features.map((f) => encodeGeom(f.geometry));
      const bytes = JSON.stringify([geoCounties, geoSld]).length;
      if (bytes <= GEO_BUDGET || pass >= 8) break;
      interval = Math.round(interval * Math.max(1.2, Math.min(2, (bytes / GEO_BUDGET) ** 1.5)));
    }
    const cFull = cFeats.map((f) => flatGeom(f.geometry));
    const cBoxes = cFull.map((mp) => bboxOfMulti(mp));

    const counties = cFeats.map((f, i) => {
      const p = f.properties, g = gazCounty[p.GEOID];
      const d = demo((isCT ? acsCT : acs)['050:' + p.GEOID]);
      let lat, lon;
      if (g && g.INTPTLAT) { lat = Number(g.INTPTLAT); lon = Number(g.INTPTLONG); }
      else { [lon, lat] = centroid(geoCounties[i]); estimates.push(`${p.NAMELSAD}: no Gazetteer internal point; lat/lon is the polygon centroid.`); }
      const c = {
        fips: p.GEOID, name: p.NAMELSAD || p.NAME, pop: d.pop, lat: r4(lat), lon: r4(lon), landKm2: r1(Number(p.ALAND) / 1e6),
        income: d.income, age: d.age, bach: d.bach, white: d.white, black: d.black, hisp: d.hisp, asian: d.asian, pres: {},
      };
      return c;
    });
    const cCentres = counties.map((c) => [c.lon, c.lat]);
    const statePop = acs['040:' + fips]?.B01003_E001 ?? null;

    // ---- presidential returns
    if (isAK) {
      const tot = counties.reduce((s, c) => s + c.pop, 0);
      for (const y of PRES_YEARS) {
        const st = akState[y];
        if (!st || st[0] + st[1] === 0) continue;
        for (const c of counties) c.pres[y] = st.map((v) => Math.round((v * c.pop) / tot));
      }
      estimates.push('Alaska does not report presidential returns by borough/census area. pres for every borough is the STATEWIDE total (2016: statewide row; 2020/2024: sum of the 40 state house districts) apportioned by borough population, so every borough has identical vote shares. Derived, not observed.');
    } else {
      const missing = {};
      for (const y of PRES_YEARS) for (const c of counties) {
        const v = pres[y][c.fips];
        if (v) c.pres[y] = v; else (missing[y] ??= []).push(c.name);
      }
      for (const [y, names] of Object.entries(missing)) {
        if (isCT && y === '2024') estimates.push('pres 2024 omitted for all Connecticut counties: the source reports 2024 by the 9 planning regions, which do not nest in the 8 historical counties used here.');
        else estimates.push(`pres ${y} unavailable in source for: ${names.join(', ')} (year omitted for these counties).`);
      }
    }
    estimates.push('Presidential returns are from the tonmcg/US_County_Level_Election_Results_08-24 compilation (scraped from media result pages: Townhall 2016, Fox/Politico/NYT 2020, Fox 2024). They are close to but not the certified canvass; 2016 in particular is an election-week count and undercounts late-tallied ballots. "other" = total - dem - rep.');

    if (isCT) estimates.push(`Connecticut uses its 8 historical counties (Census replaced them with 9 planning regions in 2022). County shapes: ${CB_YEAR_CT} cartographic boundary file; county demographics: ACS ${ACS_YEAR_CT - 4}-${ACS_YEAR_CT} 5-year (the last published for the old counties), so county pops do not sum exactly to the state pop, which is ACS ${ACS_YEAR - 4}-${ACS_YEAR}. Places use ACS ${ACS_YEAR - 4}-${ACS_YEAR}.`);
    for (const c of counties) {
      const nulls = ['income', 'age', 'bach', 'white', 'black', 'hisp', 'asian'].filter((k) => c[k] == null);
      if (nulls.length) estimates.push(`${c.name}: ${nulls.join('/')} null (suppressed or missing in ACS).`);
    }

    // ---- places
    const places = [];
    let nNoPop = 0, nNearest = 0, nNullDemo = 0;
    const includeCDP = usps === 'HI'; // Hawaii has no incorporated places at all
    for (const g of gazPlaces[usps] ?? []) {
      const isCDP = /\sCDP$/.test(g.NAME);
      if (includeCDP ? !isCDP && g.FUNCSTAT !== 'A' : g.FUNCSTAT !== 'A' || isCDP) continue;
      const d = demo(acs['160:' + g.GEOID]);
      if (d.pop == null || d.pop <= 0) { nNoPop++; continue; }
      const lat = Number(g.INTPTLAT), lon = Number(g.INTPTLONG);
      const [ci, inside] = locate(cFull, cBoxes, cCentres, lon, lat);
      if (!inside) nNearest++;
      const nk = isCDP ? { name: g.NAME.replace(/\sCDP$/, ''), kind: 'cdp' } : splitPlaceName(g.NAME);
      if (d.income == null || d.age == null || d.bach == null) nNullDemo++;
      places.push({ geoid: g.GEOID, name: nk.name, kind: nk.kind, pop: d.pop, lat: r4(lat), lon: r4(lon), landKm2: r1(Number(g.ALAND) / 1e6), county: ci, income: d.income, age: d.age, bach: d.bach });
    }
    places.sort((a, b) => b.pop - a.pop || (a.geoid < b.geoid ? -1 : 1));
    if (['CT', 'ME', 'MA', 'NH', 'RI', 'VT'].includes(usps)) estimates.push('New England towns are county subdivisions, not Census "places", so places[] holds only the incorporated cities/boroughs/villages and covers a minority of the population.');
    if (includeCDP) estimates.push('Hawaii has no incorporated places; places[] lists census-designated places instead (kind "cdp"), which deviates from the incorporated-only rule used for every other state.');
    if (nNoPop) estimates.push(`${nNoPop} incorporated place(s) dropped: no ACS population row, or population 0.`);
    if (nNearest) estimates.push(`${nNearest} place(s) whose internal point is outside every county polygon were assigned to the nearest county internal point.`);
    if (nNullDemo) estimates.push(`${nNullDemo} place(s) have at least one null demographic (income/age/bach suppressed in ACS for small populations).`);
    estimates.push('For places spanning several counties, "county" is the county containing the Gazetteer internal point. Place pop for consolidated city-counties is the "(balance)" figure where Census publishes one.');

    // ---- legislative districts
    const legs = loadLegislators(usps);
    const geo = { schema: 1, usps, bbox: null, counties: geoCounties, house: [], senate: [] };
    const pack = { schema: 1, usps, fips, name: meta.name, pop: statePop, estimates, counties, places, house: [], senate: [] };
    const cSimpBoxes = geoCounties.map((mp) => bboxOfMulti(mp));
    const st = { usps };
    for (const [chamber, ch, word, lk] of [['house', 'l', 'House', 'lower'], ['senate', 'u', 'Senate', 'upper']]) {
      const n = meta[chamber];
      const stats = (st[chamber] = {});
      if (n === 0) { stats.seats = 0; continue; }
      const { fc, codeField } = sld[chamber];
      geo[chamber] = geoSld[chamber];
      const shapes = fc.features.map((f, i) => {
        const p = f.properties;
        const [lon, lat] = centroid(geo[chamber][i]);
        const [ci] = locate(geoCounties, cSimpBoxes, cCentres, lon, lat);
        const code = p[codeField];
        return { code, id: code.replace(/^0+(?=.)/, ''), name: p.NAME ?? '', namelsad: p.NAMELSAD ?? '', lat: r4(lat), lon: r4(lon), landKm2: r1(Number(p.ALAND) / 1e6), county: ci };
      });
      pack[chamber] = buildSeats(shapes, legs ? legs[lk] : null, n, word, stats, { floterialByCounty: usps === 'NH' && chamber === 'house' });
      if (stats.floterial) estimates.push(`${chamber}: ${stats.floterial} members sit for floterial districts, which overlay several base districts and have no Census shape. Each was seated on the base district of the same county that held the fewest seats — the person and party are real, the exact district placement is an approximation.`);
      if (!stats.usedOpenStates) estimates.push(`${chamber}: no OpenStates legislators could be matched to district shapes; the ${n} seats are spread as evenly as possible over the ${shapes.length} district shapes in shape order and every inc is null.`);
      else {
        if (stats.unmatched.length) estimates.push(`${chamber}: ${stats.unmatched.length} OpenStates legislator(s) could not be matched to a district shape (labels: ${[...new Set(stats.unmatched)].slice(0, 12).join(', ')}${new Set(stats.unmatched).size > 12 ? ', ...' : ''}) and were left out.`);
        if (stats.vacant) estimates.push(`${chamber}: ${stats.vacant} seat(s) have inc null (vacant in OpenStates or unmatched); they were placed on the district shapes holding the fewest seats, which for multi-member chambers is an approximation of where the vacancy really is.`);
        if (stats.trimmed) estimates.push(`${chamber}: OpenStates listed ${stats.trimmed} more legislator(s) than the official seat count; surplus entries were dropped from the fullest districts.`);
        if (shapes.length !== n) estimates.push(`${chamber}: ${n} seats over ${shapes.length} district shapes (multi-member districts); seats per district follow the number of OpenStates legislators matched to each shape. Multi-member seat ids are "<district>/<n>".`);
      }
    }
    if (meta.house === 0) estimates.push('Unicameral legislature: house is empty; the single chamber is modelled as the senate (Census SLDU shapes).');
    if (usps === 'NE') estimates.push('Nebraska legislators are officially nonpartisan; inc.party is "I" where OpenStates lists "Nonpartisan".');
    estimates.push(`District shapes are Census ${CB_YEAR} cartographic boundary files (SLDL/SLDU, 1:500k), i.e. the districts Census held as of that vintage; inc is the office-holder in the OpenStates "current" export on the build date, name and party only. District lat/lon is the centroid of the largest polygon of the simplified shape.`);
    estimates.push(`Demographics: ACS ${ACS_YEAR - 4}-${ACS_YEAR} 5-year estimates (sample survey, subject to margin of error). white/black/asian are non-Hispanic single-race shares; hisp is Hispanic of any race. Income is top-coded by Census at 250,001.`);
    estimates.push(`Geometry simplified with mapshaper (interval ${interval} m, topology-preserving per layer; tiny islands dropped), coordinates rounded to 4 decimals. County, house and senate layers are simplified separately, so their borders can differ by up to the tolerance.`);

    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    geoCounties.forEach((mp) => bboxOfMulti(mp, bb));
    geo.bbox = bb.map(r4);
    if (isAK) estimates.push('Alaska geometry is left as published: the western Aleutians have positive longitudes (across the antimeridian), so bbox spans about -180..180.');

    fs.writeFileSync(path.join(PACKS, `${usps}.json`), JSON.stringify(pack));
    fs.writeFileSync(path.join(PACKS, `${usps}.geo.json`), JSON.stringify(geo));
    st.geoKB = Math.round(fs.statSync(path.join(PACKS, `${usps}.geo.json`)).size / 1024);
    st.packKB = Math.round(fs.statSync(path.join(PACKS, `${usps}.json`)).size / 1024);
    st.counties = counties.length; st.places = places.length;
    summary.push(st);
  }

  // ---- us.json
  log('== us.json');
  const usFC = { type: 'FeatureCollection', features: ALL.map((u) => stateFeat[u]) };
  const usSimp = await simplify(usFC, 1500);
  const us = {
    schema: 1,
    states: ALL.map((u, i) => {
      const polys = encodeGeom(usSimp.features[i].geometry);
      const [lon, lat] = centroid(polys);
      return { usps: u, fips: fipsOf[u], name: seatCount[u].name, pop: acs['040:' + fipsOf[u]]?.B01003_E001 ?? null, lat: r4(lat), lon: r4(lon), polys };
    }),
  };
  fs.writeFileSync(path.join(ROOT, 'data/us.json'), JSON.stringify(us));

  // ---- summary
  console.log('\nstate  counties places  geoKB packKB | house: seats shapes legs matched vacant | senate: seats shapes legs matched vacant');
  const f = (s) => (s && s.seats ? `${String(s.seats).padStart(5)} ${String(s.shapes).padStart(6)} ${String(s.legislators ?? '-').padStart(4)} ${String(s.matched).padStart(7)} ${String(s.vacant).padStart(6)}` : '    0      -    -       -      -');
  let tl = 0, tm = 0, ts = 0, tf = 0;
  for (const s of summary) {
    console.log(`${s.usps}     ${String(s.counties).padStart(8)} ${String(s.places).padStart(6)} ${String(s.geoKB).padStart(6)} ${String(s.packKB).padStart(6)} | ${f(s.house).padStart(40)} | ${f(s.senate).padStart(41)}`);
    for (const c of [s.house, s.senate]) if (c && c.seats) { tl += c.legislators ?? 0; tm += c.matched; ts += c.seats; tf += c.seats - c.vacant; }
    for (const [k, c] of [['house', s.house], ['senate', s.senate]]) if (c?.unmatched?.length) console.log(`   ${s.usps} ${k} unmatched labels: ${[...new Set(c.unmatched)].slice(0, 15).join(' | ')}`);
  }
  console.log(`\nOpenStates: ${tm}/${tl} legislators matched to a district shape (${tl ? ((100 * tm) / tl).toFixed(1) : 0}%); ${tf}/${ts} seats have an incumbent.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
