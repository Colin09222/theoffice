#!/usr/bin/env node
// Building-manager CLI. The plaintext code goes to this terminal only; the database stores its hash and nothing logs it.
import { loadConfig, loadModels } from '../server/config.js';
import { openDb, all, get, run } from '../server/db.js';
import { issueCode } from '../server/auth.js';
import { seedFillers, removeFiller, listFillers } from '../server/filler.js';
import { helpListing, helpListingText, answerHelp, declineHelp, HelpError, HELP_LIMITS, newFence } from '../server/help.js';
import { budgetReport, budgetReportText } from '../server/budget.js';
import { purchaseListing, purchaseListingText, decidePurchase, PurchaseError } from '../server/purchases.js';
import { readFileSync, statSync } from 'node:fs';

const [cmd, ...rest] = process.argv.slice(2);
const cfg = loadConfig();
const usage = () => {
  console.log(['Usage:',
    '  node scripts/admin.mjs code [--floor N]       issue a one-time office code',
    '  node scripts/admin.mjs floors                 list floors',
    '  node scripts/admin.mjs floors hide|show --floor N   hide floor N from the lobby, directory and lift, or show it again. It still opens by its own link',
    '  node scripts/admin.mjs filler list            list filler (demo) companies and removed ones',
    '  node scripts/admin.mjs filler seed            seed the filler companies, bringing back any that were removed',
    '  node scripts/admin.mjs filler remove --floor N  remove the filler company on floor N (stays removed)',
    '  node scripts/admin.mjs filler free --floor N    same as remove: free floor N so a code can be issued for it',
    '  node scripts/admin.mjs help list [--json]       what floors have asked buddehbot and not had answered. Everything a floor wrote is fenced as untrusted data',
    '  node scripts/admin.mjs help answer --id N --text-file PATH   answer one, as guidance to that floor\'s manager',
    '  node scripts/admin.mjs help answer --id N --decline          decline one',
    '  node scripts/admin.mjs budget [--json]          spent, limit and remaining per provider, what each floor has spent, and a flag at 50%, 80% and 100%',
    '  node scripts/admin.mjs purchases list [--json]  what the staff have asked to buy and nobody has decided. Everything a floor wrote is fenced as untrusted data',
    '  node scripts/admin.mjs purchases mark --id N --status bought|rejected [--note TEXT]   decide one. The floor hears on the server\'s next tick'].join('\n'));
  process.exit(1);
};
if (!cmd) usage();
const floorArg = () => {
  const i = rest.indexOf('--floor');
  const n = i >= 0 ? Number(rest[i + 1]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > cfg.towerFloors) { console.error(`--floor must be 1 to ${cfg.towerFloors}`); process.exit(1); }
  return n;
};
const die = (text) => { console.error(text); process.exit(1); };
const db = openDb(cfg.dataDir);
if (cmd === 'code') {
  let floor = null;
  if (rest.includes('--floor')) {
    floor = floorArg();
    if (get(db, 'SELECT 1 x FROM floors WHERE number=?', floor)) { console.error(`Floor ${floor} is already taken.`); process.exit(1); }
  }
  console.log(issueCode(db, floor));
} else if (cmd === 'floors' && (rest[0] === 'hide' || rest[0] === 'show')) {
  // Works on the database file alone. A running server leaves a hidden floor out of its next lobby reply.
  const n = floorArg();
  const f = get(db, "SELECT id FROM floors WHERE number=? AND status!='killed'", n);
  if (!f) die(`Floor ${n} has no company on it.`);
  run(db, 'UPDATE floors SET hidden=? WHERE id=?', rest[0] === 'hide' ? 1 : 0, f.id);
  console.log(rest[0] === 'hide' ? `Floor ${n} is hidden from the lobby. Its own link still works.` : `Floor ${n} is back in the lobby.`);
} else if (cmd === 'floors') {
  // A name is whatever the floor's boss typed, and a slug is made from it, so both are fenced like every other listing here.
  const fence = newFence();
  console.log(`${fence.notice}\n`);
  for (const f of all(db, 'SELECT number,slug,name,status,filler,hidden FROM floors ORDER BY number')) console.log(`${String(f.number).padStart(3)}  ${f.status.padEnd(10)} ${fence.wrap('floor', `${f.slug}: ${f.name}`)}${f.filler ? '  [filler]' : ''}${f.hidden ? '  [hidden]' : ''}`);
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
} else if (cmd === 'help') {
  // These work on the database file alone. A running server delivers an answer on its next tick, as an ordinary turn for that floor's manager.
  const sub = rest[0];
  const valueOf = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };
  if (sub === 'list') {
    const listing = helpListing(db);
    console.log(rest.includes('--json') ? JSON.stringify(listing, null, 2) : helpListingText(listing));
  } else if (sub === 'answer') {
    const id = Number(valueOf('--id'));
    if (!Number.isSafeInteger(id) || id <= 0) die('--id must be a request number from "help list".');
    const file = valueOf('--text-file'); const decline = rest.includes('--decline');
    if (!!file === decline) die('Give either --text-file PATH or --decline.');
    try {
      if (decline) { declineHelp(db, id); console.log(`Declined #${id}. The manager hears on the server's next tick.`); } else {
        let text;
        try {
          // A little room over the limit, so an overlong answer gets the proper message rather than a read of something huge.
          if (statSync(file).size > HELP_LIMITS.answer * 4 + 1024) die(`${file} is far over the limit of ${HELP_LIMITS.answer} characters.`);
          text = readFileSync(file, 'utf8');
        } catch (e) { die(`Could not read ${file}: ${e.code || 'error'}.`); }
        answerHelp(db, id, text);
        console.log(`Answered #${id}. It reaches the manager as guidance on the server's next tick.`);
      }
    } catch (e) { if (e instanceof HelpError) die(e.message); throw e; }
  } else usage();
} else if (cmd === 'budget') {
  // Read from the database and this process's own BUDGET_ settings, so it needs the same environment as the server. It prints no key.
  const report = budgetReport(db, cfg);
  console.log(rest.includes('--json') ? JSON.stringify(report, null, 2) : budgetReportText(report));
} else if (cmd === 'purchases') {
  const sub = rest[0];
  const valueOf = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };
  if (sub === 'list') {
    const listing = purchaseListing(db);
    console.log(rest.includes('--json') ? JSON.stringify(listing, null, 2) : purchaseListingText(listing));
  } else if (sub === 'mark') {
    const id = Number(valueOf('--id')); const status = valueOf('--status');
    if (!Number.isSafeInteger(id) || id <= 0) die('--id must be a request number from "purchases list".');
    if (status !== 'bought' && status !== 'rejected') die('--status must be bought or rejected.');
    try { decidePurchase(db, id, status, valueOf('--note') ?? ''); } catch (e) { if (e instanceof PurchaseError) die(e.message); throw e; }
    console.log(`Marked #${id} ${status}. The floor hears on the server's next tick.`);
  } else usage();
} else usage();
db.close();
