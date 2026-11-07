// Environment parsing. Secrets stay on this object and are never logged or sent anywhere but their own API.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
// A spending cap of "off" means no cap.
const cap = (v, d) => (v === 'off' ? Infinity : num(v, d));

// May carry a port for local testing (apps.localhost:8083). A domain that contains the main site would hand it to published code, so it is refused.
function appsBase(v, publicOrigin) {
  const base = String(v || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!/^[a-z0-9.-]+\.[a-z0-9-]+(:\d+)?$/.test(base) && !/^[a-z0-9-]+\.localhost(:\d+)?$/.test(base)) return '';
  if (publicOrigin) {
    let main = ''; try { main = new URL(publicOrigin).hostname.toLowerCase(); } catch { /* unset */ }
    const host = base.split(':')[0];
    if (main && (main === host || main.endsWith(`.${host}`))) return '';
  }
  return base;
}

export function loadConfig(env = process.env, overrides = {}) {
  const publicOrigin = (env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  return {
    port: num(env.PORT, 8083),
    host: env.HOST || '127.0.0.1',
    dataDir: env.DATA_DIR || resolve(ROOT, 'data'),
    aiMode: env.AI_MODE === 'mock' ? 'mock' : 'live',
    openrouterKey: env.OPENROUTER_API_KEY || '',
    openrouterBase: (env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    anthropicBase: (env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, ''),
    webSearchKey: env.WEB_SEARCH_API_KEY || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    publicOrigin,
    trustProxy: env.TRUST_PROXY === '1',
    floorDailyUsd: cap(env.FLOOR_DAILY_USD, 10),
    globalDailyUsd: cap(env.GLOBAL_DAILY_USD, 25),
    taskMaxUsd: cap(env.TASK_MAX_USD, 3),
    maxCallsFloor: num(env.MAX_CALLS_FLOOR, 3),
    maxCallsGlobal: num(env.MAX_CALLS_GLOBAL, 6),
    maxStaff: num(env.MAX_STAFF, 8),
    towerFloors: num(env.TOWER_FLOORS, 40),
    quotaBytes: num(env.FLOOR_QUOTA_MB, 25) * 1024 * 1024,
    mockDelayMs: num(env.MOCK_DELAY_MS, 400),
    retryBaseMs: num(env.RETRY_BASE_MS, 1000),
    rateScale: 1, // only tests raise this, through overrides; there is deliberately no env switch
    fetchDenyHosts: (env.FETCH_DENY_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // A real computer for the Builder and Tester: Claude Managed Agents, one Anthropic-hosted container per task. Off until the deploy turns it on.
    computerEnabled: env.COMPUTER_ENABLED === '1',
    sessionMaxUsd: num(env.SESSION_MAX_USD, 5),         // hard platform budget per session, whatever the daily caps say
    sessionMaxSteps: num(env.SESSION_MAX_STEPS, 40),    // model requests per session: the computer's version of the 14-step limit
    sessionMaxMinutes: num(env.SESSION_MAX_MINUTES, 30),
    maxSessionsFloor: num(env.MAX_SESSIONS_FLOOR, 2),
    maxSessionsGlobal: num(env.MAX_SESSIONS_GLOBAL, 4),
    outputLagMs: num(env.OUTPUT_LAG_MS, 3000),
    // App-grade publishing: each project on its own origin under this domain. Empty means today's sandbox mode.
    appsBaseDomain: appsBase(env.APPS_BASE_DOMAIN, publicOrigin),
    appsScheme: env.APPS_SCHEME === 'http' ? 'http' : 'https',
    ...overrides,
  };
}

export function loadModels(path = resolve(ROOT, 'config/models.json')) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  return { roles: m.roles, hireable: m.hireable, all: { ...m.roles, ...m.hireable } };
}
