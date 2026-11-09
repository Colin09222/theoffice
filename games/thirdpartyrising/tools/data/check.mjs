#!/usr/bin/env node
// Validates data/packs/*.json, *.geo.json and data/us.json against the schema the game expects.
//   node tools/data/check.mjs        (exit code 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKS = path.join(ROOT, 'data/packs');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/states.json'), 'utf8'));
const col = Object.fromEntries(meta.columns.map((c, i) => [c, i]));

let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL ' + msg); };
const ok = (cond, msg) => { if (!cond) fail(msg); };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const nullableNum = (x) => x === null || isNum(x);
const share = (x) => x === null || (isNum(x) && x >= 0 && x <= 1);
const PARTIES = new Set(['D', 'R', 'L', 'G', 'I', 'O']);

function checkMulti(mp, where) {
  if (!Array.isArray(mp) || mp.length === 0) return fail(`${where}: empty multipolygon`);
  let pts = 0;
  for (const poly of mp) {
    if (!Array.isArray(poly) || poly.length === 0) return fail(`${where}: empty polygon`);
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2) return fail(`${where}: bad ring length ${ring?.length}`);
      for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i], y = ring[i + 1];
        if (!isNum(x) || !isNum(y) || x < -180 || x > 180 || y < 15 || y > 72) return fail(`${where}: coordinate out of range ${x},${y}`);
        if (Math.abs(x * 1e4 - Math.round(x * 1e4)) > 1e-6) return fail(`${where}: not rounded to 4 dp`);
      }
      if (ring[0] === ring[ring.length - 2] && ring[1] === ring[ring.length - 1]) return fail(`${where}: ring is closed`);
      pts += ring.length / 2;
    }
  }
  return pts;
}

const files = fs.readdirSync(PACKS);
ok(files.filter((f) => /^[A-Z]{2}\.json$/.test(f)).length === 50, `expected 50 packs, found ${files.filter((f) => /^[A-Z]{2}\.json$/.test(f)).length}`);
ok(files.filter((f) => /^[A-Z]{2}\.geo\.json$/.test(f)).length === 50, 'expected 50 geo packs');

let totPack = 0, totGeo = 0, totSeats = 0, totInc = 0, totCounties = 0, totPlaces = 0, usPop = 0;
const rows = [];
const packs = {};
for (const r of meta.rows) {
  const usps = r[col.usps];
  const pf = path.join(PACKS, `${usps}.json`), gf = path.join(PACKS, `${usps}.geo.json`);
  if (!fs.existsSync(pf) || !fs.existsSync(gf)) { fail(`${usps}: missing pack or geo file`); continue; }
  const p = JSON.parse(fs.readFileSync(pf, 'utf8')), g = JSON.parse(fs.readFileSync(gf, 'utf8'));
  packs[usps] = p;
  const sp = fs.statSync(pf).size, sg = fs.statSync(gf).size;
  totPack += sp; totGeo += sg;
  const W = usps;

  ok(p.schema === 1 && g.schema === 1, `${W}: schema`);
  ok(p.usps === usps && g.usps === usps, `${W}: usps`);
  ok(/^\d{2}$/.test(p.fips), `${W}: fips`);
  ok(p.name === r[col.name], `${W}: name ${p.name}`);
  ok(isNum(p.pop) && p.pop > 0, `${W}: pop`);
  ok(Array.isArray(p.estimates) && p.estimates.every((s) => typeof s === 'string'), `${W}: estimates`);
  ok(Object.keys(p).join() === 'schema,usps,fips,name,pop,estimates,counties,places,house,senate', `${W}: pack keys ${Object.keys(p)}`);
  ok(Object.keys(g).join() === 'schema,usps,bbox,counties,house,senate', `${W}: geo keys`);

  // counties
  const nC = p.counties.length;
  ok(nC > 0, `${W}: no counties`);
  let nullDemo = 0, sumPop = 0;
  const missPres = { 2016: 0, 2020: 0, 2024: 0 };
  p.counties.forEach((c, i) => {
    const w = `${W} county ${c.fips}`;
    ok(Object.keys(c).join() === 'fips,name,pop,lat,lon,landKm2,income,age,bach,white,black,hisp,asian,pres', `${w}: keys`);
    ok(/^\d{5}$/.test(c.fips) && c.fips.startsWith(p.fips), `${w}: fips`);
    if (i) ok(p.counties[i - 1].fips < c.fips, `${w}: not sorted`);
    ok(typeof c.name === 'string' && c.name.length > 0, `${w}: name`);
    ok(Number.isInteger(c.pop) && c.pop > 0, `${w}: pop ${c.pop}`);
    ok(isNum(c.lat) && isNum(c.lon) && isNum(c.landKm2) && c.landKm2 > 0, `${w}: lat/lon/land`);
    ok(nullableNum(c.income) && nullableNum(c.age), `${w}: income/age`);
    for (const k of ['bach', 'white', 'black', 'hisp', 'asian']) ok(share(c[k]), `${w}: ${k}=${c[k]}`);
    if (['income', 'age', 'bach', 'white', 'black', 'hisp', 'asian'].some((k) => c[k] === null)) nullDemo++;
    for (const y of Object.keys(c.pres)) {
      ok(['2016', '2020', '2024'].includes(y), `${w}: pres year ${y}`);
      const v = c.pres[y];
      ok(Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0), `${w}: pres ${y} ${JSON.stringify(v)}`);
      ok(v[0] + v[1] > 0, `${w}: pres ${y} has no major-party votes`);
    }
    for (const y of [2016, 2020, 2024]) if (!c.pres[y]) missPres[y]++;
    sumPop += c.pop;
  });
  if (usps !== 'CT') ok(sumPop === p.pop, `${W}: county pops sum to ${sumPop}, state pop ${p.pop}`);
  else ok(Math.abs(sumPop - p.pop) / p.pop < 0.05, `${W}: county pops far from state pop`);

  // places
  let nullPlace = 0;
  p.places.forEach((pl, i) => {
    const w = `${W} place ${pl.geoid}`;
    ok(Object.keys(pl).join() === 'geoid,name,kind,pop,lat,lon,landKm2,county,income,age,bach', `${w}: keys`);
    ok(/^\d{7}$/.test(pl.geoid) && pl.geoid.startsWith(p.fips), `${w}: geoid`);
    ok(typeof pl.name === 'string' && pl.name.length > 0 && typeof pl.kind === 'string' && /^[a-z ]+$/.test(pl.kind), `${w}: name/kind "${pl.name}"/"${pl.kind}"`);
    ok(Number.isInteger(pl.pop) && pl.pop > 0, `${w}: pop`);
    if (i) ok(p.places[i - 1].pop >= pl.pop, `${w}: not sorted by pop`);
    ok(isNum(pl.lat) && isNum(pl.lon) && isNum(pl.landKm2), `${w}: lat/lon/land`);
    ok(Number.isInteger(pl.county) && pl.county >= 0 && pl.county < nC, `${w}: county index ${pl.county}`);
    ok(nullableNum(pl.income) && nullableNum(pl.age) && share(pl.bach), `${w}: demographics`);
    if (pl.income === null || pl.age === null || pl.bach === null) nullPlace++;
  });
  ok(p.places.length > 0, `${W}: no places`);

  // chambers
  let inc = 0;
  for (const ch of ['house', 'senate']) {
    const want = r[col[ch]];
    ok(p[ch].length === want, `${W}: ${ch} has ${p[ch].length} seats, states.json says ${want}`);
    const ids = new Set(), used = new Set();
    for (const s of p[ch]) {
      const w = `${W} ${ch} ${s.id}`;
      ok(Object.keys(s).join() === 'id,name,shape,lat,lon,landKm2,county,inc', `${w}: keys`);
      ok(typeof s.id === 'string' && s.id.length > 0 && !ids.has(s.id), `${w}: id missing or duplicated`);
      ids.add(s.id);
      ok(typeof s.name === 'string' && s.name.length > 0, `${w}: name`);
      ok(Number.isInteger(s.shape) && s.shape >= 0 && s.shape < g[ch].length, `${w}: shape index ${s.shape}`);
      used.add(s.shape);
      ok(isNum(s.lat) && isNum(s.lon) && isNum(s.landKm2), `${w}: lat/lon/land`);
      ok(Number.isInteger(s.county) && s.county >= 0 && s.county < nC, `${w}: county index`);
      if (s.inc !== null) {
        ok(Object.keys(s.inc).join() === 'name,party' && typeof s.inc.name === 'string' && s.inc.name.length > 1 && PARTIES.has(s.inc.party), `${w}: inc ${JSON.stringify(s.inc)}`);
        inc++;
      }
    }
    ok(used.size === g[ch].length, `${W}: ${ch} has ${g[ch].length - used.size} district shape(s) with no seat`);
    totSeats += want;
  }
  totInc += inc;

  // geometry
  ok(Array.isArray(g.bbox) && g.bbox.length === 4 && g.bbox.every(isNum) && g.bbox[0] < g.bbox[2] && g.bbox[1] < g.bbox[3], `${W}: bbox`);
  ok(g.counties.length === nC, `${W}: geo.counties ${g.counties.length} != counties ${nC}`);
  let pts = 0;
  for (const layer of ['counties', 'house', 'senate']) g[layer].forEach((mp, i) => { pts += checkMulti(mp, `${W} geo.${layer}[${i}]`) || 0; });

  totCounties += nC; totPlaces += p.places.length; usPop += p.pop;
  rows.push({ usps, counties: nC, places: p.places.length, house: p.house.length, senate: p.senate.length, inc, nullCountyDemo: nullDemo, nullPlaceDemo: nullPlace, noPres16: missPres[2016], noPres20: missPres[2020], noPres24: missPres[2024], packKB: Math.round(sp / 1024), geoKB: Math.round(sg / 1024), geoPts: pts });
}

// us.json
const usFile = path.join(ROOT, 'data/us.json');
const us = JSON.parse(fs.readFileSync(usFile, 'utf8'));
ok(us.schema === 1 && us.states.length === 50, 'us.json: 50 states');
for (const s of us.states) {
  ok(Object.keys(s).join() === 'usps,fips,name,pop,lat,lon,polys', `us.json ${s.usps}: keys`);
  ok(packs[s.usps] && packs[s.usps].pop === s.pop && packs[s.usps].fips === s.fips, `us.json ${s.usps}: pop/fips disagree with pack`);
  ok(isNum(s.lat) && isNum(s.lon), `us.json ${s.usps}: lat/lon`);
  checkMulti(s.polys, `us.json ${s.usps}`);
}

// known values
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected about ${b}`);
const cnt = (u) => packs[u]?.counties.length;
ok(cnt('OH') === 88, `Ohio counties ${cnt('OH')}`);
ok(cnt('TX') === 254, `Texas counties ${cnt('TX')}`);
ok(cnt('CT') === 8, `Connecticut counties ${cnt('CT')}`);
ok(cnt('VA') === 133, `Virginia counties+cities ${cnt('VA')}`);
ok(cnt('LA') === 64, `Louisiana parishes ${cnt('LA')}`);
ok(cnt('DE') === 3, `Delaware counties ${cnt('DE')}`);
ok(totCounties === 3142, `total counties ${totCounties} (expected 3142 = 3144 county-equivalents minus DC, with CT's 9 planning regions replaced by its 8 counties)`);
near(usPop, 335e6, 8e6, 'sum of state pops');
if (packs.OH) {
  const col0 = packs.OH.places[0];
  ok(col0.name === 'Columbus' && col0.kind === 'city', `largest OH place is ${col0.name}`);
  near(col0.pop, 905000, 40000, 'Columbus pop');
  ok(packs.OH.counties[col0.county].name === 'Franklin County', 'Columbus is in Franklin County');
  const fr = packs.OH.counties.find((c) => c.fips === '39049').pres['2020'];
  near(fr[0] / (fr[0] + fr[1] + fr[2]), 0.648, 0.01, 'Franklin County OH 2020 Dem share');
}
if (packs.TX) { ok(packs.TX.places[0].name === 'Houston', 'largest TX place'); near(packs.TX.places[0].pop, 2.3e6, 1.5e5, 'Houston pop'); }
if (packs.CA) { const la = packs.CA.counties.find((c) => c.fips === '06037'); near(la.pop, 9.8e6, 4e5, 'Los Angeles County pop'); const v = la.pres['2020']; near(v[0] / (v[0] + v[1] + v[2]), 0.71, 0.015, 'LA County 2020 Dem share'); }
if (packs.WY) { const v = packs.WY.counties.reduce((a, c) => a.map((x, i) => x + c.pres['2020'][i]), [0, 0, 0]); near(v[1] / (v[0] + v[1] + v[2]), 0.699, 0.01, 'Wyoming 2020 Rep share'); }
if (packs.NE) ok(packs.NE.house.length === 0 && packs.NE.senate.length === 49, 'Nebraska unicameral');
// national two-party totals per year should be near the certified results (millions)
for (const [y, d, r] of [[2016, 65.85, 62.98], [2020, 81.28, 74.22], [2024, 75.02, 77.30]]) {
  let D = 0, R = 0;
  for (const p of Object.values(packs)) for (const c of p.counties) if (c.pres[y]) { D += c.pres[y][0]; R += c.pres[y][1]; }
  console.log(`pres ${y}: packs total D ${(D / 1e6).toFixed(2)}M R ${(R / 1e6).toFixed(2)}M  (certified incl. DC: D ${d}M R ${r}M)`);
  near(D / 1e6, d, 4.5, `national Dem votes ${y}`); near(R / 1e6, r, 4.5, `national Rep votes ${y}`);
}

console.table(rows);
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`counties ${totCounties}, places ${totPlaces}, seats ${totSeats} (${totInc} with inc, ${totSeats - totInc} null)`);
console.log(`null county demographics: ${sum('nullCountyDemo')}; places with a null demographic: ${sum('nullPlaceDemo')}; counties missing pres 2016/2020/2024: ${sum('noPres16')}/${sum('noPres20')}/${sum('noPres24')}`);
console.log(`sizes: packs ${(totPack / 1048576).toFixed(2)} MB + geo ${(totGeo / 1048576).toFixed(2)} MB = ${((totPack + totGeo) / 1048576).toFixed(2)} MB; us.json ${(fs.statSync(usFile).size / 1024).toFixed(0)} KB; largest geo ${Math.max(...rows.map((r) => r.geoKB))} KB`);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
