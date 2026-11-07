// Draws a floor plan's walking grid as text and lists anything unreachable. `node scripts/plan-map.mjs [plan]`
import { PLANS, planBlocks, planSpots, makeNav, deskRect, bigDeskRect, seatOf, roomAt, doorways } from '../public/js/layouts.js';

const only = process.argv[2];
for (const [id, plan] of Object.entries(PLANS)) {
  if (only && only !== id) continue;
  const f = { coffee: true, arcade: true, plants: 8, staffCount: 8 };
  const nav = makeNav();
  for (const b of planBlocks(plan, f)) nav.block(b[0], b[1], b[2], b[3], { bake: b[4] });
  for (const d of plan.desks) nav.block(...deskRect(d));
  const rows = [];
  for (let z = 0; z < nav.rows; z++) { let line = ''; for (let x = 0; x < nav.cols; x++) line += nav.blocked[z * nav.cols + x] ? '#' : '.'; rows.push(line.split('')); }
  const mark = (x, z, c) => { const cx = Math.floor((x + 11) / 0.5), cz = Math.floor((z + 6.8) / 0.5); if (rows[cz]?.[cx] !== undefined) rows[cz][cx] = rows[cz][cx] === '#' && c !== 'S' ? '!' : c; };
  const seats = [seatOf(plan.manager), seatOf(plan.boss), ...plan.desks.map(seatOf)];
  for (const s of seats) mark(s.at[0], s.at[1], 'S');
  const spots = planSpots(plan, f);
  for (const s of spots) mark(s.at[0], s.at[1], 'o');
  for (const d of doorways(plan)) mark(d.x, d.z, 'D');
  console.log(`\n${id}\n${rows.map((r) => r.join('')).join('\n')}`);
  const problems = [];
  for (const s of spots) if (nav.isBlocked(s.at[0], s.at[1])) problems.push(`spot in furniture: ${s.label} ${s.at}`);
  for (const a of seats) for (const b of spots) if (!nav.reachable(a.at[0], a.at[1], b.at[0], b.at[1])) { problems.push(`no route ${a.at} -> ${b.label}`); break; }
  for (const a of seats) if (!roomAt(plan, a.at[0], a.at[1])) problems.push(`seat in no room ${a.at}`);
  const rects = [bigDeskRect(plan.manager), bigDeskRect(plan.boss), ...plan.desks.map((d) => deskRect(d))];
  for (const [i, r] of rects.entries()) for (const w of planBlocks(plan, f).filter((b) => !b[4])) if (Math.abs(r[0] - w[0]) < (r[2] + w[2]) / 2 && Math.abs(r[1] - w[1]) < (r[3] + w[3]) / 2) problems.push(`desk ${i} hits a wall at ${w[0]},${w[1]}`);
  console.log(problems.length ? problems.slice(0, 14).join('\n') : 'ok');
}
