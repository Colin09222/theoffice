// The spend watchdog for paid Google ads. Run it from a scheduler every 10 to 15 minutes, inside the container so it has the server's settings:
//   */15 * * * * cd /opt/theoffice && docker compose exec -T theoffice node scripts/ads-watchdog.mjs >> /opt/theoffice/ads-watchdog.log 2>&1
// It reads each campaign's real cost through the API (metrics.cost_micros). If any Office campaign has cost more than its approved amount, or the
// account's cost this month is over AD_MONTHLY_CAP_USD, it pauses every enabled campaign at once. A campaign the Office doesn't know is always
// paused, and one past its end date is paused on schedule. It prints one line, for an alert: exit 0 when all is well, 1 when it paused something
// for being over or unknown, 2 when Google couldn't be read. --dry-run says what it would pause and pauses nothing. It never prints a token.
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { googleAdsFromConfig } from '../server/googleads.js';
import { runWatchdog } from '../server/ads-guard.js';
import { scrub } from '../server/llm.js';

const cfg = loadConfig();
const api = googleAdsFromConfig(cfg);
if (!api) { console.log('ads off: Google Ads is not set up on this server'); process.exit(0); }
const db = openDb(cfg.dataDir);
try {
  const r = await runWatchdog({ db, cfg, api, pause: !process.argv.includes('--dry-run') });
  console.log(r.line);
  process.exitCode = r.alert ? 1 : 0;
} catch (e) {
  console.log(`ads ERROR: Google Ads couldn't be read: ${scrub(e?.message || e, cfg)}`);
  process.exitCode = 2;
} finally { db.close(); }
