#!/usr/bin/env node
// Launch card photos, by hand or from cron (docs/redesign, job 3). Tier 0: a headless Chromium and the database, no model, no key.
// Takes a 16:10 screenshot of every launched project's live page that has none or one older than 7 days (--all: every one), and stores it
// with the project, card sized (640x400 JPEG). The server shows it at once; nothing needs a restart.
//
//   node scripts/launch-shots.mjs [--all] [--list]
//
// The office image has no browser. On the live server, run it in the office-runner browser image, next to the same data folder:
//   docker run --rm --network host --user "$(stat -c %u:%g data/office.db)" -e HOME=/tmp -e DATA_DIR=/data \
//     -e APPS_BASE_DOMAIN="$(sed -n 's/^APPS_BASE_DOMAIN=//p' .env)" -e PUBLIC_ORIGIN="$(sed -n 's/^PUBLIC_ORIGIN=//p' .env)" \
//     -v "$PWD/data:/data" -v "$PWD:/app:ro" -w /app office-runner/browser:pw1.65.0 node scripts/launch-shots.mjs --all
// (run from the folder holding docker-compose.yml). SHOTS_CHROME=/path/to/chrome picks a browser; SHOTS_CDP_URL=http://host:9222 uses a running one.
// It finds the image's Chromium (/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell) by itself.
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { localShooter } from './chrome.mjs';
import { takeDue, dueShots, launches } from '../server/shots.js';

const args = new Set(process.argv.slice(2));
const cfg = loadConfig();
const db = openDb(cfg.dataDir);
if (args.has('--list')) {
  const due = new Set(dueShots(db, {}).map((l) => `${l.floor_id}/${l.slug}`));
  for (const l of launches(db, {})) console.log(`floor ${l.number}  ${l.slug.padEnd(28)} ${l.wip ? 'work in progress' : 'launched        '}  visits(7d) ${String(l.visits).padStart(5)}  ${l.shot_at ? `photo ${new Date(l.shot_at).toISOString().slice(0, 16)}` : 'no photo'}${due.has(`${l.floor_id}/${l.slug}`) ? '  (due)' : ''}`);
  db.close(); process.exit(0);
}
const shooter = await localShooter({ chrome: cfg.shotsChrome, cdpUrl: cfg.shotsCdpUrl });
if (!shooter) { console.error('No browser found. Set SHOTS_CHROME to a Chromium, or run this in the office-runner/browser image.'); db.close(); process.exit(2); }
try {
  const r = await takeDue(db, cfg, { shooter, origin: cfg.shotsOrigin || cfg.publicOrigin || `http://127.0.0.1:${cfg.port}`, force: args.has('--all'), limit: 200, log: () => {} });
  for (const x of r.taken) console.log(`ok      floor ${x.floor} ${x.project} (${Math.round(x.bytes / 1024)} KB)`);
  for (const x of r.failed) console.log(`failed  floor ${x.floor} ${x.project}: ${x.error}`);
  console.log(`${r.taken.length} taken, ${r.failed.length} failed${r.skipped ? `, ${r.skipped} left for next time` : ''}.`);
  process.exitCode = r.failed.length ? 1 : 0;
} finally { shooter.close(); db.close(); }
