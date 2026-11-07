#!/usr/bin/env node
// Building-manager CLI. The plaintext code goes to this terminal only; the database stores its hash and nothing logs it.
import { loadConfig, loadModels } from '../server/config.js';
import { openDb, all, get } from '../server/db.js';
import { issueCode } from '../server/auth.js';
import { seedFillers, removeFiller, listFillers } from '../server/filler.js';

const [cmd, ...rest] = process.argv.slice(2);
const cfg = loadConfig();
const usage = () => {
  console.log(['Usage:',
    '  node scripts/admin.mjs code [--floor N]       issue a one-time office code',
    '  node scripts/admin.mjs floors                 list floors',
    '  node scripts/admin.mjs filler list            list filler (demo) companies and removed ones',
    '  node scripts/admin.mjs filler seed            seed the filler companies, bringing back any that were removed',
    '  node scripts/admin.mjs filler remove --floor N  remove the filler company on floor N (stays removed)',
    '  node scripts/admin.mjs filler free --floor N    same as remove: free floor N so a code can be issued for it'].join('\n'));
  process.exit(1);
};
if (!cmd) usage();
const floorArg = () => {
  const i = rest.indexOf('--floor');
  const n = i >= 0 ? Number(rest[i + 1]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > cfg.towerFloors) { console.error(`--floor must be 1 to ${cfg.towerFloors}`); process.exit(1); }
  return n;
};
const db = openDb(cfg.dataDir);
if (cmd === 'code') {
  let floor = null;
  if (rest.includes('--floor')) {
    floor = floorArg();
    if (get(db, 'SELECT 1 x FROM floors WHERE number=?', floor)) { console.error(`Floor ${floor} is already taken.`); process.exit(1); }
  }
  console.log(issueCode(db, floor));
} else if (cmd === 'floors') {
  for (const f of all(db, 'SELECT number,slug,name,status,filler FROM floors ORDER BY number')) console.log(`${String(f.number).padStart(3)}  ${f.slug.padEnd(28)} ${f.status.padEnd(10)} ${f.name}${f.filler ? '  (filler)' : ''}`);
} else if (cmd === 'filler') {
  // These work on the database file alone. A running server notices a removal on its next tick.
  const sub = rest[0];
  if (sub === 'list') {
    const { floors, removed } = listFillers(db);
    if (!floors.length) console.log('No filler companies in the building.');
    for (const f of floors) console.log(`${String(f.number).padStart(3)}  ${f.slug.padEnd(28)} ${f.status.padEnd(10)} ${f.name}`);
    if (removed.length) console.log(`Removed (seed brings them back): ${removed.map((r) => r.key).join(', ')}`);
  } else if (sub === 'seed') {
    const r = seedFillers(db, { cfg, models: loadModels(), revive: true });
    for (const s of r.seeded) console.log(`Seeded ${s.key} on floor ${s.number}.`);
    for (const s of r.skipped) console.log(`Skipped ${s.key}: ${s.why === 'exists' ? 'already in the building' : s.why === 'no_floor' ? 'no free floor' : s.why}.`);
  } else if (sub === 'remove' || sub === 'free') {
    const n = floorArg();
    const r = removeFiller(db, { number: n });
    if (!r) { console.error(`Floor ${n} has no filler company on it.`); process.exit(1); }
    console.log(`Removed ${r.name} from floor ${r.number}. The floor is free; it will not be reseeded unless you run "filler seed".`);
  } else usage();
} else usage();
db.close();
