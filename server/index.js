// Entry point. Logs are one JSON line per event and never include keys, codes, cookies or request bodies.
import { loadConfig, loadModels } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { scrub } from './llm.js';

const cfg = loadConfig();
const log = (level, msg, extra = {}) => { if (level === 'error' || msg !== 'api') console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra })); };
const db = openDb(cfg.dataDir);
const app = createApp({ db, cfg, models: loadModels(), log });
if (cfg.aiMode === 'live' && !cfg.openrouterKey) log('warn', 'OPENROUTER_API_KEY is not set: floors will pause when an agent tries to think');
if (cfg.appsBaseDomain && cfg.publicOrigin) {
  const site = (h) => h.split(':')[0].split('.').slice(-2).join('.');
  try { if (site(cfg.appsBaseDomain) === site(new URL(cfg.publicOrigin).hostname)) log('warn', 'APPS_BASE_DOMAIN shares a site with PUBLIC_ORIGIN: published pages can plant cookies on the main site. See docs/DEPLOY-REALBUILDS.md'); } catch { /* unset */ }
}
if (!cfg.adminPassword) log('warn', 'ADMIN_PASSWORD is not set: the admin view is locked');
app.engine.start();
app.server.listen(cfg.port, cfg.host, () => { log('info', 'the office is open', { port: cfg.port, aiMode: cfg.aiMode }); app.warmStatics(); });

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await app.close().catch(() => {}); db.close(); process.exit(0); });
process.on('uncaughtException', (e) => { log('error', 'uncaught', { err: scrub(e?.message, cfg) }); });
process.on('unhandledRejection', (e) => { log('error', 'rejection', { err: scrub(e?.message, cfg) }); });
