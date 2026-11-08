// Environment parsing. Secrets stay on this object and are never logged or sent anywhere but their own API.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mailSettings } from './mail-config.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
const numbersOnly = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
// A spending cap of "off" means no cap.
const cap = (v, d) => (v === 'off' ? Infinity : num(v, d));
// A lifetime limit can't go below nothing, and a typo falls back to the default rather than to no limit at all.
const lifetime = (v, d) => Math.max(0, cap(v, d));
// A cap on how much work gets done is off unless someone sets one, and only a positive number sets one. It stays Infinity in here, which every comparison copes with.
// Anything that leaves this process has to go through capOrNull first. See "Work caps" in docs/DEPLOY-NEXT.md.
const workCap = (v) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : Infinity; };
/** How a work cap looks in JSON, where Infinity would silently turn into null anyway. Code that reads this has to treat null as "no cap", and `n >= null` is true, so check first. */
export const capOrNull = (n) => (Number.isFinite(n) ? n : null);

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
    // Off unless set: what stops the money is the building's lifetime limit below. Each of these would stop a job long before that.
    floorDailyUsd: cap(env.FLOOR_DAILY_USD, Infinity),
    globalDailyUsd: cap(env.GLOBAL_DAILY_USD, Infinity),
    taskMaxUsd: cap(env.TASK_MAX_USD, Infinity),
    // What the whole building may ever spend with each provider. Counted over the whole ledger, for the admin's eyes only. Raising one and restarting starts the work again.
    budgetAnthropicUsd: lifetime(env.BUDGET_ANTHROPIC_USD, 120),
    budgetOpenrouterUsd: lifetime(env.BUDGET_OPENROUTER_USD, 120),
    maxCallsFloor: num(env.MAX_CALLS_FLOOR, 3),
    maxCallsGlobal: num(env.MAX_CALLS_GLOBAL, 6),
    maxStaff: workCap(env.MAX_STAFF),
    maxStaffSteps: workCap(env.MAX_STAFF_STEPS),
    maxManagerSteps: workCap(env.MAX_MANAGER_STEPS),
    maxOpenTasks: workCap(env.MAX_OPEN_TASKS),
    maxTasksPerDay: workCap(env.MAX_TASKS_PER_DAY),
    maxRevisions: workCap(env.MAX_REVISIONS),
    towerFloors: num(env.TOWER_FLOORS, 40),
    quotaBytes: num(env.FLOOR_QUOTA_MB, 100) * 1024 * 1024,
    mockDelayMs: num(env.MOCK_DELAY_MS, 400),
    retryBaseMs: num(env.RETRY_BASE_MS, 1000),
    rateScale: 1, // only tests raise this, through overrides; there is deliberately no env switch
    // How long a request may take to arrive in full; the boss's upload gets longer, for a big photo on a slow phone line. Tests shorten these through overrides.
    requestTimeoutMs: 30000,
    uploadTimeoutMs: 120000,
    fetchDenyHosts: (env.FETCH_DENY_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // What published apps may do through Office Cloud: call AI and fetch public pages. Both on unless switched off here. See docs/OFFICE-CLOUD.md.
    officeAiEnabled: !/^(0|false|no|off)$/i.test(String(env.OFFICE_AI_ENABLED ?? '').trim()),
    officeFetchEnabled: !/^(0|false|no|off)$/i.test(String(env.OFFICE_FETCH_ENABLED ?? '').trim()),
    // The defaults are in server/cloud/powers.js; a setting here replaces one. The building's daily ceiling is for the admin's eyes only.
    cloudAiLimits: numbersOnly({ maxTokens: env.OFFICE_AI_MAX_TOKENS, dayFast: env.OFFICE_AI_DAY_FAST, daySmart: env.OFFICE_AI_DAY_SMART, buildingDayUsd: env.OFFICE_AI_BUILDING_DAY_USD }),
    cloudFetchLimits: numbersOnly({ dayProject: env.OFFICE_FETCH_DAY, hostDelayMs: env.OFFICE_FETCH_HOST_DELAY_MS, cacheTtlMs: env.OFFICE_FETCH_CACHE_MS }),
    // A real computer for the Builder and Tester: Claude Managed Agents, one Anthropic-hosted container per task. Off until the deploy turns it on.
    computerEnabled: env.COMPUTER_ENABLED === '1',
    sessionMaxUsd: cap(env.SESSION_MAX_USD, Infinity),  // platform budget per session when set; otherwise a session is promised a slice at a time, as below
    // Not a cap: how much of the building's money one session is promised at a time. It always gets the next slice while there is money, but no session can hold everything that is left and keep the rest of the building waiting.
    sessionSliceUsd: num(env.SESSION_SLICE_USD, 2) > 0.1 ? num(env.SESSION_SLICE_USD, 2) : 2,
    sessionMaxSteps: workCap(env.SESSION_MAX_STEPS),    // model requests per session
    sessionMaxMinutes: workCap(env.SESSION_MAX_MINUTES),
    sessionWrapUp: env.SESSION_WRAP_UP === '1',         // tells a lane job to stop polishing at the step count it ought to take
    maxFixTurns: workCap(env.MAX_FIX_TURNS),            // times a computer is told its save or publish didn't go through before the task fails
    maxSessionsFloor: workCap(env.MAX_SESSIONS_FLOOR),
    maxSessionsGlobal: workCap(env.MAX_SESSIONS_GLOBAL),
    outputLagMs: num(env.OUTPUT_LAG_MS, 3000),
    // App-grade publishing: each project on its own origin under this domain. Empty means today's sandbox mode.
    appsBaseDomain: appsBase(env.APPS_BASE_DOMAIN, publicOrigin),
    appsScheme: env.APPS_SCHEME === 'http' ? 'http' : 'https',
    // Domain buying. Every credential stays in this process: nothing here ever reaches a prompt, a container, a tool result, a log or the database.
    namecheapUser: env.NAMECHEAP_API_USER || '',
    namecheapKey: env.NAMECHEAP_API_KEY || '',
    namecheapClientIp: env.NAMECHEAP_CLIENT_IP || '',
    namecheapBase: (env.NAMECHEAP_BASE_URL || 'https://api.namecheap.com/xml.response').replace(/\/+$/, ''),
    // Paid ads on Google Search (Business mode). Off unless ADS_PAID_ENABLED=1: then only the free path exists. The monthly cap is the building's,
    // for the admin only. The Google credentials stay in this process like Namecheap's; the access token is bought from the refresh token in memory.
    adsPaidEnabled: /^(1|true|yes|on)$/i.test(String(env.ADS_PAID_ENABLED || '').trim()),
    adMonthlyCapUsd: Math.max(0, num(env.AD_MONTHLY_CAP_USD, 50)),
    adCpcCeilingUsd: num(env.AD_CPC_CEILING_USD, 0.5),
    adsTickMs: num(env.ADS_TICK_MS, 60000),
    adsSyncMs: num(env.ADS_SYNC_MS, 15 * 60000),
    googleAds: {
      customerId: String(env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, ''),
      clientId: env.GOOGLE_ADS_CLIENT_ID || '', clientSecret: env.GOOGLE_ADS_CLIENT_SECRET || '', refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN || '',
      developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || '', loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '',
      apiBase: (env.GOOGLE_ADS_API_BASE || 'https://googleads.googleapis.com').replace(/\/+$/, ''),
      tokenUrl: env.GOOGLE_ADS_TOKEN_URL || 'https://oauth2.googleapis.com/token',
      timeZone: env.GOOGLE_ADS_TIME_ZONE || 'America/New_York',
    },
    domainContactSource: String(env.DOMAIN_CONTACT_SOURCE || '').trim().toLowerCase(),
    domainMaxUsd: num(env.DOMAIN_MAX_USD, 25),
    domainsPerFloorDay: num(env.DOMAINS_PER_FLOOR_DAY, 2),
    domainsGlobalDay: num(env.DOMAINS_GLOBAL_DAY, 6),
    domainTlds: String(env.DOMAIN_TLDS || 'com,net,org,io,co,app,dev,xyz,site,online,store,tech,club,live,studio').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    serverIp: /^\d{1,3}(\.\d{1,3}){3}$/.test(env.SERVER_IP || '') ? env.SERVER_IP : '',
    serverIp6: env.SERVER_IP6 || '',
    // OpenRouter tools: images, and a second lab's eye on the design. The key never goes near a container.
    imagesPerFloorDay: workCap(env.IMAGES_PER_FLOOR_DAY),
    imagesPerTask: workCap(env.IMAGES_PER_TASK),
    reviewsPerFloorDay: workCap(env.REVIEWS_PER_FLOOR_DAY),
    searchesPerFloorDay: workCap(env.SEARCHES_PER_FLOOR_DAY),
    // The iOS foundation is off until the owner's Apple and Expo accounts exist. The token itself lives in a Managed Agents vault, never here.
    iosEnabled: env.IOS_ENABLED === '1',
    iosVaultId: env.IOS_VAULT_ID || '',
    // Standing orders (floors-plus): recurring jobs the boss sets. They run through the ordinary engine and its caps; these only shape the schedule.
    ordersPerFloor: workCap(env.ORDERS_PER_FLOOR),
    ordersMinHours: num(env.ORDERS_MIN_HOURS, 24),
    ordersIdleDays: num(env.ORDERS_IDLE_DAYS, 14),
    ordersMaxFails: workCap(env.ORDERS_MAX_FAILS),
    ordersRunTimeoutMin: num(env.ORDERS_RUN_TIMEOUT_MIN, 180),
    ordersTickMs: num(env.ORDERS_TICK_MS, 30000),
    ordersEstimateUsd: num(env.ORDERS_ESTIMATE_USD, 0.6),
    // Work modes: in Set hours or Nonstop the team picks its own next job whenever the floor is quiet, this many minutes after the last one finished.
    // There is no money cap per floor: the building's own limits stop it, and three failed jobs in a row pause it. See docs/WORK-MODES.md.
    autopilotGapMin: Math.max(0, num(env.AUTOPILOT_GAP_MIN, 5)),
    autopilotMaxFails: Math.max(1, num(env.AUTOPILOT_MAX_FAILS, 3)),
    autopilotRunTimeoutMin: num(env.AUTOPILOT_RUN_TIMEOUT_MIN, 180),
    modesTickMs: num(env.MODES_TICK_MS, 5000),
    // Filler companies (floors-plus): scripted floors that look busy and never call a model. Off unless asked for.
    fillerCompanies: env.FILLER_COMPANIES === '1',
    fillerTickMs: num(env.FILLER_TICK_MS, 9000),
    // What people say to each other. Each of these is a real, cheap model call, so each has its limit. Work questions get a generous one, since they feed real work.
    // Off only where a test counts every cent of the work itself. Everything still works without it, in plain words.
    peopleTalk: env.PEOPLE_TALK !== '0',
    talkGapMs: num(env.TALK_GAP_MS, env.AI_MODE === 'mock' ? 1 : 2200),
    meetingGapMs: num(env.MEETING_GAP_MS, env.AI_MODE === 'mock' ? 0 : 45000), meetingsPerFloorDay: num(env.MEETINGS_PER_FLOOR_DAY, 40),
    banterEveryMs: num(env.BANTER_EVERY_MS, 180000), banterTickMs: num(env.BANTER_TICK_MS, 20000), banterPerFloorDay: num(env.BANTER_PER_FLOOR_DAY, 60),
    asksPerTask: num(env.ASKS_PER_TASK, 4), asksPerFloorDay: num(env.ASKS_PER_FLOOR_DAY, 80),
    // The help line: a manager can ask the owner's assistant for guidance. No credential is involved: the assistant answers through scripts/admin.mjs or the admin view.
    helpEnabled: env.HELP_ENABLED !== '0',
    helpTimeoutMin: num(env.HELP_TIMEOUT_MIN, 30),
    helpPerFloorDay: num(env.HELP_PER_FLOOR_DAY, 5),
    helpTickMs: num(env.HELP_TICK_MS, 5000),
    ...mailSettings(env),  // email: RESEND_API_KEY, RESEND_WEBHOOK_SECRET, MAIL_DOMAIN and the caps (docs/MAIL.md)
    ...overrides,
  };
}

export function loadModels(path = resolve(ROOT, 'config/models.json')) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  const prices = Object.fromEntries(Object.entries(m.prices || {}).filter(([k]) => !k.startsWith('_')));
  // A price written on the role itself wins; otherwise it is whatever its model costs.
  const priced = (x) => (x && !x.pricing && prices[x.model] ? { ...x, pricing: prices[x.model] } : x);
  const each = (group) => Object.fromEntries(Object.entries(group || {}).map(([k, r]) => [k, priced(r)]));
  const roles = each(m.roles), hireable = each(m.hireable);
  return { roles, hireable, all: { ...roles, ...hireable }, tools: each(m.tools), prices, autonomous: m.autonomous || null, appAi: m.appAi || null };
}

/**
 * The model one call runs on. A job the boss asked for runs on the role's own model; a job the team picked for itself in a work mode
 * runs on the autonomous model, computer sessions included. Returns { provider, model, effort, maxTokens, pricing }, or null for a role
 * that has no computer when one is asked for.
 */
export function routeFor(models, roleKey, { autonomous = false, computer = false } = {}) {
  const role = models.all[roleKey] || models.all.researcher;
  const price = (model, own) => own || models.prices?.[model] || { prompt: 0, completion: 0 };
  let r;
  if (computer) {
    if (!role.computer) return null;
    const over = role.computer === true ? {} : role.computer;
    const model = over.model || role.model;
    // Managed Agents runs Claude only, so a role on another provider names its Claude model under computer.
    r = { provider: 'anthropic', model, effort: over.effort ?? role.effort, maxTokens: role.maxTokens, pricing: price(model, over.pricing || (model === role.model ? role.pricing : null)) };
  } else r = { provider: role.provider === 'anthropic' ? 'anthropic' : (role.provider || 'openrouter'), model: role.model, effort: role.effort, maxTokens: role.maxTokens, pricing: price(role.model, role.pricing) };
  const auto = models.autonomous;
  if (!autonomous || !auto?.model) return r;
  if (!computer && (auto.keepOwnModel || []).includes(roleKey)) return r;
  return { ...r, provider: auto.provider || 'anthropic', model: auto.model, effort: auto.effort ?? r.effort, pricing: price(auto.model, null) };
}
