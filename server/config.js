// Environment parsing. Secrets stay on this object and are never logged or sent anywhere but their own API.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
// A spending cap of "off" means no cap.
const cap = (v, d) => (v === 'off' ? Infinity : num(v, d));

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
    ...overrides,
  };
}

export function loadModels(path = resolve(ROOT, 'config/models.json')) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  return { roles: m.roles, hireable: m.hireable, all: { ...m.roles, ...m.hireable } };
}
