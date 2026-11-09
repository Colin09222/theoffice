// Post-step of the data build: records, for every county, which state house and state senate
// district SHAPE contains the county's internal point (`counties[].house`, `counties[].senate`,
// indices into geo.house / geo.senate; null where the chamber does not exist). The simulation uses
// this to build each district's electorate from the counties it covers.
// Derived from the same Census geometry as the packs; nearest district centroid is used if the
// point falls in a gap left by simplification.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const PACKS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/packs");
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c; return c; };
const inMulti = (mp, x, y) => mp.some((poly) => inRing(poly[0], x, y) && !poly.slice(1).some((h) => inRing(h, x, y)));
const centre = (mp) => { let x = 0, y = 0, n = 0; for (const poly of mp) for (let i = 0; i < poly[0].length; i += 2) { x += poly[0][i]; y += poly[0][i + 1]; n++; } return [x / n, y / n]; };
let fallbacks = 0;
for (const f of fs.readdirSync(PACKS).filter((f) => /^[A-Z]{2}\.json$/.test(f))) {
  const pack = JSON.parse(fs.readFileSync(path.join(PACKS, f), "utf8"));
  const geo = JSON.parse(fs.readFileSync(path.join(PACKS, f.replace(".json", ".geo.json")), "utf8"));
  for (const ch of ["house", "senate"]) {
    const shapes = geo[ch] || [];
    const cs = shapes.map(centre);
    for (const c of pack.counties) {
      if (!shapes.length) { c[ch] = null; continue; }
      let hit = shapes.findIndex((mp) => inMulti(mp, c.lon, c.lat));
      if (hit < 0) { fallbacks++; let best = Infinity; cs.forEach(([x, y], i) => { const d = (x - c.lon) ** 2 + (y - c.lat) ** 2; if (d < best) { best = d; hit = i; } }); }
      c[ch] = hit;
    }
  }
  fs.writeFileSync(path.join(PACKS, f), JSON.stringify(pack));
}
console.log(`linked counties to districts (${fallbacks} nearest-centroid fallbacks)`);
