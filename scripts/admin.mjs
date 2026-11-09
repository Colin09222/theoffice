#!/usr/bin/env node
// Building-manager CLI. The plaintext code goes to this terminal only; the database stores its hash and nothing logs it.
import { loadConfig, loadModels } from '../server/config.js';
import { openDb, all, get, run } from '../server/db.js';
import { payMode } from '../server/cloud/pay.js';
import { issueCode, createSession, sha256 } from '../server/auth.js';
import { seedFillers, removeFiller, listFillers } from '../server/filler.js';
import { parkHiddenFloors, moveFloor, holdFloorForCode, RenumberError } from '../server/renumber.js';
import { createStore } from '../server/cloud/store.js';
import { createPowers } from '../server/cloud/powers.js';
import { lookupLabel } from '../server/apps.js';
import { slugPattern } from '../server/workspace.js';
import { writeFileSync } from 'node:fs';
import { helpListing, helpListingText, answerHelp, declineHelp, HelpError, HELP_LIMITS, newFence } from '../server/help.js';
import { budgetReport, budgetReportText, createBudget } from '../server/budget.js';
import { purchaseListing, purchaseListingText, decidePurchase, PurchaseError } from '../server/purchases.js';
import { readFileSync, statSync } from 'node:fs';
import { googleAdsFromConfig } from '../server/googleads.js';
import { adsListing, adsListingText, pauseAll } from '../server/ads-guard.js';
import { ensureAdSpend, resumeAds } from '../server/business.js';
import { scrub } from '../server/llm.js';
import { createRunnerClient, runnerConfigured } from '../server/runner.js';
import { ensureServerSchema } from '../server/servers.js';
import { mailStatus, mailStatusText, ensureMailSchema, setFloorPause, setBuildingPause, suppressAddress, MailError } from '../server/mail.js';
import { dailyStatus, dailyStatusText, requestDailyRun, setDailyPaused, ensureDailySchema } from '../server/daily.js';
import { chatAdminCommand } from '../server/cloud/chat.js';

const [cmd, ...rest] = process.argv.slice(2);
const cfg = loadConfig();
const usage = () => {
  console.log(['Usage:',
    '  node scripts/admin.mjs code [--floor N]       issue a one-time office code',
    '  node scripts/admin.mjs cloud ai lock PROJECT --model ID --day-usd N [--only HOSTS] [--effort E]   give a project a locked AI (its own prompt, one model, a hard daily stop)',
    '  node scripts/admin.mjs cloud ai unlock PROJECT | locks                                            remove a lock | list locks and today\'s spend',
    '  node scripts/admin.mjs code hold --issued-at MS --floor N   make the one unused code issued at that moment hold floor N. Prints no code',
    '  node scripts/admin.mjs mail status [--json]   email: sending and receiving, today\'s counts, each floor\'s address, pauses and alerts. No message text',
    '  node scripts/admin.mjs mail pause|resume [--floor N]   stop or restart sending for one floor, or for the whole building. Receiving carries on',
    '  node scripts/admin.mjs mail suppress <address>   never send to this address again, from any floor',
    '  node scripts/admin.mjs login --floor N [--minutes M]   a short boss login to check floor N by hand (default 60 minutes, at most 240): the office_s cookie value, to this terminal only',
    '  node scripts/admin.mjs login revoke           end such a login now: give its cookie value on stdin',
    '  node scripts/admin.mjs floors                 list floors',
    '  node scripts/admin.mjs floors hide|show --floor N   hide floor N from the lobby, directory and lift, or show it again. It still opens by its own link',
    '  node scripts/admin.mjs floors park --from A --to B --at N   move the hidden floors numbered A to B up out of the building, to N upward, in order. Safe to run again',
    '  node scripts/admin.mjs floors move --slug SLUG --to N   move a company to an empty floor N inside the building. Safe to run again',
    '  node scripts/admin.mjs backend usage [--json]   every project\'s Office Cloud backend: accounts, documents, saves, scores, files and storage. Counts only',
    '  node scripts/admin.mjs backend export --floor N --project SLUG [--files] [--out FILE]   everything one project keeps, as JSON. Accounts leave without their passwords',
    '  node scripts/admin.mjs backend wipe --floor N --project SLUG --yes   delete everything one project keeps: accounts, documents, saves, scores and files',
    '  node scripts/admin.mjs cloud ai status [PROJECT] [--floor N] [--json]   published apps\' AI: what is on, requests today and what is left. PROJECT is a subdomain label, or a slug with --floor',
    '  node scripts/admin.mjs cloud ai pause|resume PROJECT|--all [--floor N]   stop or restart AI for one project, or for the whole building',
    '  node scripts/admin.mjs cloud fetch status|pause|resume ...   the same, for fetching and scraping web pages',
    '  node scripts/admin.mjs runner status [--json]   server slots: how full the building is, and each server with its floor, project and state. Run it in the container',
    '  node scripts/admin.mjs runner stop <label>     stop one server. It keeps its slot and answers 503 until it is started again',
    '  node scripts/admin.mjs runner remove <label>   delete one server, its data and token, freeing its slot',
    '  node scripts/admin.mjs runner kill-all         stop every app and build at once. New starts are refused until release',
    '  node scripts/admin.mjs runner release          lift the kill switch',
    '  node scripts/admin.mjs pay status <floor>       a floor\'s Stripe account as the building sees it: connected, what is missing, product and order counts. No sales figures',
    '  node scripts/admin.mjs pay disconnect <floor>   stop new sales on a floor. Its Stripe account stays the boss\'s own, and their existing customers are theirs to manage',
    '  node scripts/admin.mjs chat status [PROJECT] [--floor N] [--json]   the website chat: what is on, conversations and questions waiting. Counts only, never what anyone said',
    '  node scripts/admin.mjs chat pause|resume PROJECT|--all [--floor N]   stop or restart the website chat for one project, or for the whole building',
    '  node scripts/admin.mjs filler list            list filler (demo) companies and removed ones',
    '  node scripts/admin.mjs filler seed            seed the filler companies, bringing back any that were removed',
    '  node scripts/admin.mjs filler remove --floor N  remove the filler company on floor N (stays removed)',
    '  node scripts/admin.mjs filler free --floor N    same as remove: free floor N so a code can be issued for it',
    '  node scripts/admin.mjs help list [--json]       what floors have asked buddehbot and not had answered. Everything a floor wrote is fenced as untrusted data',
    '  node scripts/admin.mjs help answer --id N --text-file PATH   answer one, as guidance to that floor\'s manager',
    '  node scripts/admin.mjs help answer --id N --decline          decline one',
    '  node scripts/admin.mjs floor-limit --floor N [--claude USD] [--openrouter USD] [--fable USD] [--opus USD] [--clear]   top one floor up: raises its stops or moves where its models switch, then shows where it stands (admin only, and it takes effect on the server\'s next tick)',
    '  node scripts/admin.mjs budget [--json]          spent, limit and remaining per provider, what each floor has spent, and a flag at 50%, 80% and 100%',
    '  node scripts/admin.mjs purchases list [--json]  what the staff have asked to buy and nobody has decided. Everything a floor wrote is fenced as untrusted data',
    '  node scripts/admin.mjs purchases mark --id N --status bought|rejected [--note TEXT]   decide one. The floor hears on the server\'s next tick',
    '  node scripts/admin.mjs ads list [--json]        paid Google ads: approved against spent per campaign (Google\'s own figures), and this month against the cap',
    '  node scripts/admin.mjs ads pause-all            emergency stop: pause every enabled campaign in the Google Ads account now; no new paid campaign starts until ads resume',
    '  node scripts/admin.mjs ads resume               lift the stop left by pause-all, the watchdog or the server\'s spend check, once you\'ve looked (paused campaigns stay paused)',
    '  node scripts/admin.mjs daily status [--json]    the daily run: which floors have it on, when they run next, and how the last run went. No figures from a floor',
    '  node scripts/admin.mjs daily run <floor>        force one run on that floor, to test it, on the server\'s next tick. The goal still comes first, and it counts as that day\'s run',
    '  node scripts/admin.mjs daily pause|resume       stop or restart new daily runs across the building. A run under way finishes'].join('\n'));
  process.exit(1);
};
if (!cmd) usage();
// Naming a floor that exists takes any number, because hidden floors can sit above the building. Reserving one needs it to be inside.
const floorArg = ({ inBuilding = false } = {}) => {
  const i = rest.indexOf('--floor');
  const n = i >= 0 ? Number(rest[i + 1]) : NaN;
  if (!Number.isInteger(n) || n < 1 || (inBuilding && n > cfg.towerFloors)) { console.error(inBuilding ? `--floor must be 1 to ${cfg.towerFloors}` : '--floor must be a floor number'); process.exit(1); }
  return n;
};
const die = (text) => { console.error(text); process.exit(1); };
const db = openDb(cfg.dataDir);
if (cmd === 'code' && rest[0] === 'hold') {
  // The code is known only by when it was issued. Neither it nor its hash is printed.
  const i = rest.indexOf('--issued-at');
  try {
    const r = holdFloorForCode(db, cfg, { issuedAt: i >= 0 ? Number(rest[i + 1]) : NaN, floor: floorArg({ inBuilding: true }) });
    console.log(r.changed ? `That code now holds floor ${r.floor}.` : `That code already holds floor ${r.floor}.`);
  } catch (e) { if (e instanceof RenumberError) die(e.message); throw e; }
} else if (cmd === 'code') {
  let floor = null;
  if (rest.includes('--floor')) {
    floor = floorArg({ inBuilding: true });
    if (get(db, 'SELECT 1 x FROM floors WHERE number=?', floor)) { console.error(`Floor ${floor} is already taken.`); process.exit(1); }
  }
  console.log(issueCode(db, floor));
} else if (cmd === 'login') {
  // For checking a floor as its boss: a boss session like the one a claim or a recovery code gives, but short. Its value goes to this terminal only.
  if (rest[0] === 'revoke') {
    const token = readFileSync(0, 'utf8').trim();
    const r = token ? run(db, "DELETE FROM sessions WHERE hash=? AND kind='owner'", sha256(token)) : { changes: 0 };
    console.log(r.changes ? 'That login has ended.' : 'No such login.');
  } else {
    const n = floorArg();
    const f = get(db, "SELECT id FROM floors WHERE number=? AND status!='killed'", n);
    if (!f) die(`Floor ${n} has no company on it.`);
    const i = rest.indexOf('--minutes');
    const minutes = i >= 0 ? Number(rest[i + 1]) : 60;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) die('--minutes must be 1 to 240');
    console.log(createSession(db, 'owner', f.id, minutes * 60).token);
  }
} else if (cmd === 'floors' && (rest[0] === 'park' || rest[0] === 'move')) {
  // Works on the database file alone. The floor's id, links, published apps, mail and data don't change: only the number it sits at.
  const valueOf = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (rest[0] === 'park') {
      const moved = parkHiddenFloors(db, cfg, { from: Number(valueOf('--from')), to: Number(valueOf('--to')), at: Number(valueOf('--at')) });
      if (!moved.length) console.log('Nothing to move: no hidden floor in that range.');
      for (const m of moved) console.log(`Floor ${m.from} is now floor ${m.to}.`);
    } else {
      const r = moveFloor(db, cfg, { slug: String(valueOf('--slug') ?? ''), to: Number(valueOf('--to')) });
      console.log(r.moved ? `Floor ${r.from} is now floor ${r.to}.` : `Already on floor ${r.to}.`);
    }
  } catch (e) { if (e instanceof RenumberError) die(e.message); throw e; }
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
} else if (cmd === 'backend') {
  // Office Cloud, the backend published projects use. Counts, an export, or a wipe. Run it in the container, beside the live database.
  const store = createStore(db);
  const projectArg = () => {
    const i = rest.indexOf('--project'); const p = i >= 0 ? String(rest[i + 1] || '') : '';
    if (!slugPattern.test(p)) die('--project must be a project slug, such as space-game');
    return p;
  };
  const floorRow = () => { const n = floorArg(); const f = get(db, 'SELECT * FROM floors WHERE number=?', n); if (!f) die(`There is no company on floor ${n}.`); return f; };
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
  if (rest[0] === 'usage') {
    const rows = store.projects().map((x) => ({ floor: get(db, 'SELECT number FROM floors WHERE id=?', x.floor_id)?.number ?? null, project: x.project, ...store.summary(x.floor_id, x.project) }));
    if (rest.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else if (!rows.length) console.log('No project has used Office Cloud yet.');
    else for (const r of rows) console.log(`floor ${r.floor ?? '(closed)'} ${r.project}: ${r.users} accounts, ${r.docs} documents in ${r.collections} collections, ${r.saves} saves, ${r.scores} scores on ${r.boards} boards, ${r.files} files; data ${kb(r.bytes)} of ${kb(r.limits.bytes)}, files ${kb(r.fileBytes)} of ${kb(r.limits.fileBytes)}; ${r.requestsToday} requests today`);
  } else if (rest[0] === 'export') {
    const f = floorRow(); const p = projectArg();
    const out = JSON.stringify(store.exportProject(f.id, p, { withFiles: rest.includes('--files') }), null, 2);
    const i = rest.indexOf('--out');
    if (i >= 0 && rest[i + 1]) { writeFileSync(rest[i + 1], out, { mode: 0o600 }); console.log(`Wrote ${rest[i + 1]} (${kb(Buffer.byteLength(out))}).`); } else console.log(out);
  } else if (rest[0] === 'wipe') {
    const f = floorRow(); const p = projectArg();
    if (!rest.includes('--yes')) die(`This deletes every account, document, save, score and file of ${p} on floor ${f.number}. Add --yes to do it.`);
    console.log(`Wiped ${p} on floor ${f.number}: ${store.wipeProject(f.id, p)} rows removed. Anyone in one of its rooms right now stays until they leave; their accounts are gone.`);
  } else usage();
} else if (cmd === 'pay') {
  // A floor's Stripe account as the building sees it, and a stop for new sales. Database only: no Stripe key or call, and no sales figures.
  const [sub, target] = rest;
  if ((sub !== 'status' && sub !== 'disconnect') || !target) usage();
  const f = get(db, 'SELECT id, number, slug, name FROM floors WHERE number=? OR slug=?', Number(target) || -1, target);
  if (!f) die(`There is no company on floor ${target}.`);
  const accounts = all(db, 'SELECT * FROM pay_accounts WHERE floor_id=? ORDER BY livemode DESC', f.id);
  if (sub === 'status') {
    console.log(`Floor ${f.number} (${f.slug}). The building's Stripe mode: ${payMode(db) || 'off, no Stripe key yet'}.`);
    if (!accounts.length) console.log('No Stripe account connected.');
    for (const a of accounts) {
      const missing = JSON.parse(a.missing || '[]');
      console.log(`${a.livemode ? 'LIVE' : 'TEST'} ${a.account}: ${a.disconnected_at ? 'disconnected' : a.charges_enabled ? 'taking payments' : a.details_submitted ? 'waiting on Stripe' : 'onboarding'}, payouts ${a.payouts_enabled ? 'on' : 'off'}, ${missing.length} field${missing.length === 1 ? '' : 's'} still due${missing.length ? ` (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''})` : ''}.`);
      const products = get(db, "SELECT COUNT(*) n FROM pay_products WHERE floor_id=? AND livemode=? AND status='live'", f.id, a.livemode).n;
      const waiting = get(db, "SELECT COUNT(*) n FROM pay_products WHERE floor_id=? AND livemode=? AND status='proposed'", f.id, a.livemode).n;
      const orders = get(db, "SELECT COUNT(*) n FROM pay_orders WHERE floor_id=? AND livemode=? AND status!='open'", f.id, a.livemode).n;
      console.log(`  ${products} on sale, ${waiting} waiting for the boss, ${orders} orders.`);
    }
  } else {
    const n = run(db, 'UPDATE pay_accounts SET disconnected_at=COALESCE(disconnected_at,?), updated_at=? WHERE floor_id=?', Date.now(), Date.now(), f.id).changes;
    if (!n) die(`Floor ${f.number} has no connected Stripe account.`);
    console.log(`Floor ${f.number} can no longer start new sales. Its Stripe account stays the boss's own: any subscriptions keep billing there until the boss cancels them in Stripe, and webhooks still keep access correct. The boss can reconnect from the Payments tab.`);
  }
} else if (cmd === 'chat') {
  // The website chat (docs/CHAT.md). On the database file alone: a running server sees a pause on its next message.
  if (!chatAdminCommand(db, cfg, rest, { die, floorArg, lookupLabel })) usage();
} else if (cmd === 'cloud' && (rest[0] === 'ai' || rest[0] === 'fetch')) {
  // AI and web fetching for published apps. Works on the database file alone: a running server sees a pause on its next call. Counts only.
  const [kind, sub] = rest;
  const name = kind === 'ai' ? 'AI' : 'Web fetching';
  const powers = createPowers(db, cfg);
  const given = rest[2] && !rest[2].startsWith('--') ? rest[2] : null;
  const floorRowOf = (id) => get(db, 'SELECT number, name FROM floors WHERE id=?', id);
  /** A project by the label it publishes under, or by slug (with --floor when two floors share one). */
  const findProject = () => {
    const entry = lookupLabel(db, given);
    if (entry) return { floorId: entry.floor_id, project: entry.project };
    if (!slugPattern.test(given)) die('Give the project\'s subdomain label or its slug.');
    let rows = all(db, 'SELECT floor_id, slug FROM projects WHERE slug=?', given);
    if (rest.includes('--floor')) { const n = floorArg(); rows = rows.filter((r) => floorRowOf(r.floor_id)?.number === n); }
    if (!rows.length) die(`No project called ${given}.`);
    if (rows.length > 1) die(`More than one floor has a project called ${given}: floors ${rows.map((r) => floorRowOf(r.floor_id)?.number).join(', ')}. Add --floor N.`);
    return { floorId: rows[0].floor_id, project: rows[0].slug };
  };
  const nameOf = (p) => `floor ${floorRowOf(p.floorId)?.number ?? '(closed)'} ${p.project}`;
  if (sub === 'status') {
    const report = powers.status(kind);
    if (given) { const p = findProject(); report.projects = [{ ...p, ...powers.view(p.floorId, p.project)[kind] }]; }
    if (kind === 'ai') {
      const used = get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE day=? AND kind='app_ai'", powers.today()).n;
      report.ceilingUsedPercent = powers.AI.buildingDayUsd > 0 ? Math.round(used / powers.AI.buildingDayUsd * 1000) / 10 : 100;
    }
    if (rest.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${name} for published apps: ${report.on && !report.buildingPaused ? 'on' : report.buildingPaused ? 'paused for the whole building' : 'switched off in the settings'}${kind === 'ai' ? `. All app AI today: ${report.ceilingUsedPercent}% of the building's daily ceiling` : ''}`);
      if (!report.projects.length) console.log('No project has used it today or has a switch set.');
      for (const x of report.projects) console.log(`${nameOf(x)}: ${x.paused ? 'PAUSED' : x.on ? 'on' : 'off (by its boss)'}, ${kind === 'ai' ? `${x.callsToday} requests today, ${x.fastLeft} fast and ${x.smartLeft} smart tokens left` : `${x.fetchedToday} pages today, ${x.left} left`}`);
    }
  } else if (kind === 'ai' && sub === 'lock') {
    // A project whose AI uses only its own published prompt, one OpenRouter model and a hard stop per day. Off for every project unless switched on here.
    if (!given) die('Name a project.');
    const p = findProject();
    const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
    const model = flag('--model'), dayUsd = Number(flag('--day-usd')), only = flag('--only') || '', effort = flag('--effort') || 'low';
    if (!model || !loadModels().prices?.[model]) die('Give --model with a model that has a price in config/models.json.');
    if (!(dayUsd > 0 && dayUsd <= 25)) die('Give --day-usd between 0 and 25.');
    run(db, 'INSERT INTO cloud_ai_locks (floor_id,project,model,day_usd,only_provider,effort,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(floor_id,project) DO UPDATE SET model=excluded.model, day_usd=excluded.day_usd, only_provider=excluded.only_provider, effort=excluded.effort', p.floorId, p.project, model, dayUsd, only, effort, Date.now());
    console.log(`AI locked for ${nameOf(p)}: ${model}, stop at ${dayUsd} a day${only ? `, hosts: ${only}` : ''}.`);
  } else if (kind === 'ai' && sub === 'unlock') {
    if (!given) die('Name a project.');
    const p = findProject();
    run(db, 'DELETE FROM cloud_ai_locks WHERE floor_id=? AND project=?', p.floorId, p.project);
    console.log(`AI lock removed for ${nameOf(p)}.`);
  } else if (kind === 'ai' && sub === 'locks') {
    const rows = all(db, 'SELECT * FROM cloud_ai_locks ORDER BY floor_id, project');
    if (!rows.length) console.log('No project has a locked AI.');
    for (const x of rows) console.log(`${nameOf({ floorId: x.floor_id, project: x.project })}: ${x.model}, stop ${x.day_usd} a day, spent today ${get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND day=? AND kind=?', x.floor_id, powers.today(), `app_ai_locked:${x.project}`).n.toFixed(4)}, calls today ${powers.counts(x.floor_id, x.project).ai_calls}.`);
  } else if (sub === 'pause' || sub === 'resume') {
    const on = sub === 'pause';
    if (rest.includes('--all')) { powers.setBuildingPaused(kind, on); console.log(`${name} ${on ? 'paused' : 'back on'} for the whole building.`); } else {
      if (!given) die('Name a project, or use --all for the whole building.');
      const p = findProject();
      powers.setPaused(p.floorId, p.project, kind, on);
      console.log(`${name} ${on ? 'paused' : 'back on'} for ${nameOf(p)}.`);
    }
  } else usage();
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
} else if (cmd === 'floor-limit') {
  const usd = (name) => { const i = rest.indexOf(name); if (i < 0) return undefined; const v = Number(rest[i + 1]); if (!Number.isFinite(v) || v < 0) die(`${name} needs a dollar amount.`); return v; };
  const floor = get(db, 'SELECT id,number,name FROM floors WHERE number=?', floorArg());
  if (!floor) die('No floor with that number.');
  const budget = createBudget(db, cfg, Date.now, loadModels().floorLimits);
  if (rest.includes('--clear')) budget.setFloorOverride(floor.id, null);
  else {
    const over = Object.fromEntries(Object.entries({ claudeStopUsd: usd('--claude'), openrouterStopUsd: usd('--openrouter'), fableUntilUsd: usd('--fable'), opusUntilUsd: usd('--opus') }).filter(([, v]) => v !== undefined));
    if (Object.keys(over).length) budget.setFloorOverride(floor.id, over);
  }
  console.log(JSON.stringify({ floor: floor.number, ...budget.floorStatus(floor.id) }));
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
} else if (cmd === 'runner') {
  ensureServerSchema(db);
  if (!runnerConfigured(cfg)) die('No runner socket or token here. Run this in the theoffice container, once office-runner is installed.');
  const runner = createRunnerClient(cfg);
  const ownerOf = (label) => get(db, 'SELECT s.project, s.status, f.number FROM server_apps s LEFT JOIN floors f ON f.id=s.floor_id WHERE s.label=?', label);
  try {
    const [sub, label] = rest;
    if (sub === 'status') {
      const h = await runner.health(), { apps } = await runner.list();
      const rows = apps.map((a) => { const o = ownerOf(a.label); return { label: a.label, status: a.status, tier: a.tier, floor: o?.number ?? null, project: o?.project ?? null, build: a.build?.status ?? null, jobs: (a.cron || []).length, known: !!o }; });
      if (rest.includes('--json')) console.log(JSON.stringify({ health: h, apps: rows }, null, 2));
      else {
        console.log(`runner: ${h.apps} of ${h.maxApps} slots used (${h.browserApps} of ${h.maxBrowserApps} browser), kill switch ${h.killed ? 'ON' : 'off'}`);
        for (const r of rows) console.log(`${r.label}  ${r.status}  ${r.tier}  ${r.known ? `floor ${r.floor ?? '?'} ${r.project}` : 'not one of the Office\'s'}  build: ${r.build ?? 'none'}  jobs: ${r.jobs}`);
        if (!rows.length) console.log('No servers.');
      }
    } else if (sub === 'stop' && label) { await runner.stop(label); console.log(`${label} stopped. It keeps its slot.`); }
    else if (sub === 'remove' && label) {
      await runner.remove(label).catch((e) => { if (e.status !== 404) throw e; });
      run(db, "UPDATE server_apps SET status='removed', building=0, token_hash=NULL, env_ok=0, updated_at=? WHERE label=?", Date.now(), label);
      console.log(`${label} removed. Its slot is free and its token no longer works.`);
    } else if (sub === 'kill-all') { const r = await runner.killAll(); console.log(`Kill switch on: ${r.killed} containers stopped. New starts are refused until "runner release".`); }
    else if (sub === 'release') { await runner.release(); console.log('Kill switch off: servers can start again.'); }
    else usage();
  } catch (e) { die(`runner: ${String(e?.message || e).slice(0, 300)}`); }
} else if (cmd === 'ads') {
  // Needs the server's environment (GOOGLE_ADS_*, AD_MONTHLY_CAP_USD), so run it in the container. It prints no token.
  const api = googleAdsFromConfig(cfg);
  try {
    if (rest[0] === 'list') {
      const listing = await adsListing({ db, cfg, api });
      console.log(rest.includes('--json') ? JSON.stringify(listing, null, 2) : adsListingText(listing));
    } else if (rest[0] === 'pause-all') {
      if (!api) die('Google Ads is not set up on this server (GOOGLE_ADS_* settings), so there is nothing to pause.');
      console.log((await pauseAll({ db, api })).line);
    } else if (rest[0] === 'resume') {
      ensureAdSpend(db);
      console.log(resumeAds(db) ? 'ads resume: new paid campaigns can start again. Paused campaigns stay paused.' : 'ads resume: there was no stop to lift.');
    } else usage();
  } catch (e) { die(`Google Ads: ${scrub(e?.message || e, cfg)}`); }
} else if (cmd === 'mail') {
  // Reads and writes the database only; the server sees a pause or a suppression on its next send. It prints no key or secret.
  ensureMailSchema(db);
  const sub = rest[0];
  const fl = rest.indexOf('--floor') >= 0 ? Number(rest[rest.indexOf('--floor') + 1]) : null;
  const floorRow = () => { const f = get(db, 'SELECT id, number, name FROM floors WHERE number=?', fl); if (!f) die(`There is no floor ${fl}.`); return f; };
  if (sub === 'status') {
    const s = mailStatus(db, cfg);
    console.log(rest.includes('--json') ? JSON.stringify(s, null, 2) : mailStatusText(s));
  } else if (sub === 'pause' || sub === 'resume') {
    const on = sub === 'pause';
    if (fl !== null) { const f = floorRow(); setFloorPause(db, f.id, on, 'building manager'); console.log(`Email sending ${on ? 'paused' : 'back on'} for floor ${f.number} ${f.name}.`); } else { setBuildingPause(db, on); console.log(`Email sending ${on ? 'paused' : 'back on'} for the whole building.`); }
  } else if (sub === 'suppress') {
    try { console.log(`${suppressAddress(db, rest[1], 'building manager')} will get no more email from the building.`); } catch (e) { if (e instanceof MailError) die(e.message); throw e; }
  } else usage();
} else if (cmd === 'daily') {
  // Works on the database file alone. A running server sees a pause, or a run asked for here, on its next tick.
  ensureDailySchema(db);
  const sub = rest[0];
  if (sub === 'status') {
    const s = dailyStatus(db, cfg);
    console.log(rest.includes('--json') ? JSON.stringify(s, null, 2) : dailyStatusText(s));
  } else if (sub === 'run') {
    const given = rest.indexOf('--floor') >= 0 ? rest[rest.indexOf('--floor') + 1] : rest[1];
    const n = Number(given);
    if (!Number.isInteger(n) || n < 1) die('Give a floor number.');
    const f = get(db, "SELECT id FROM floors WHERE number=? AND status!='killed'", n);
    if (!f) die(`Floor ${n} has no company on it.`);
    requestDailyRun(db, f.id);
    console.log(`Asked for a run on floor ${n}. The server starts it on its next tick, once the floor is free. A floor with no goal has its manager ask for one first.`);
  } else if (sub === 'pause' || sub === 'resume') {
    setDailyPaused(db, sub === 'pause');
    console.log(sub === 'pause' ? 'Daily runs paused across the building. A run under way finishes.' : 'Daily runs back on.');
  } else usage();
} else usage();
db.close();
