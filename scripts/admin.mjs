#!/usr/bin/env node
// Building-manager CLI. The plaintext code goes to this terminal only; the database stores its hash and nothing logs it.
import { loadConfig } from '../server/config.js';
import { openDb, all, get } from '../server/db.js';
import { issueCode } from '../server/auth.js';

const [cmd, ...rest] = process.argv.slice(2);
const cfg = loadConfig();
const usage = () => { console.log('Usage:\n  node scripts/admin.mjs code [--floor N]   issue a one-time office code\n  node scripts/admin.mjs floors             list floors'); process.exit(1); };
if (!cmd) usage();
const db = openDb(cfg.dataDir);
if (cmd === 'code') {
  let floor = null;
  const i = rest.indexOf('--floor');
  if (i >= 0) {
    floor = Number(rest[i + 1]);
    if (!Number.isInteger(floor) || floor < 1 || floor > cfg.towerFloors) { console.error(`--floor must be 1 to ${cfg.towerFloors}`); process.exit(1); }
    if (get(db, 'SELECT 1 x FROM floors WHERE number=?', floor)) { console.error(`Floor ${floor} is already taken.`); process.exit(1); }
  }
  console.log(issueCode(db, floor));
} else if (cmd === 'floors') {
  for (const f of all(db, 'SELECT number,slug,name,status FROM floors ORDER BY number')) console.log(`${String(f.number).padStart(3)}  ${f.slug.padEnd(28)} ${f.status.padEnd(10)} ${f.name}`);
} else usage();
db.close();
