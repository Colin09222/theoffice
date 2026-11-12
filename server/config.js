// Environment parsing. Secrets stay on this object and are never logged or sent anywhere but their own API.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mailSettings } from './mail-config.js';
import { paySettings } from './cloud/pay-config.js';

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
/** A cap that is on unless set to "off". A typo keeps the default rather than switching it off. */
const onCap = (v, dflt) => { if (/^\s*off\s*$/i.test(String(v ?? ''))) return Infinity; const n = Number(v); return v !== undefined && String(v).trim() !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt; };
/** How a work cap looks in JSON, where Infinity would silently turn into null anyway. Code that reads this has to treat null as "no cap", and `n >= null` is true, so check first. */
export const capOrNull = (n) => (Number.isFinite(n) ? n : null);

// The building's old address. It moved to fakebusiness.io, but the owner's other sites still live here, so the staff and published apps keep the same distance from it.
const FORMER_HOME = 'iscolinfree.com';

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
    // The contractor ping (server/contractorping.js): the owner's assistant hears at once when a job is held. Off unless both are set.
    hookUrl: env.OPENCLAW_HOOK_URL || '',
    hookToken: env.OPENCLAW_HOOK_TOKEN || '',
    hookAgentId: env.OPENCLAW_HOOK_AGENT || 'main',
    hookChannel: env.OPENCLAW_HOOK_CHANNEL || 'telegram',
    hookTo: env.OPENCLAW_HOOK_TO || '8032772165',
    hookRetryMs: num(env.OPENCLAW_HOOK_RETRY_MS, 2000),
    // The cost alert (server/costalert.js), through the same hook and silent: a line in the owner's log when one task passes the first figure, a floor's day
    // passes the second, or a task is sent back this many times, and a word to the owner only when one task passes the last. COST_ALERTS=0 turns it off.
    costAlerts: env.COST_ALERTS !== '0',
    costAlertTaskUsd: num(env.COST_ALERT_TASK_USD, 5),
    costAlertFloorDayUsd: num(env.COST_ALERT_FLOOR_DAY_USD, 10),
    costAlertSentBack: num(env.COST_ALERT_SENT_BACK, 3),
    costAlertTellUsd: num(env.COST_ALERT_TELL_USD, 20),
    costAlertsPerHour: num(env.COST_ALERTS_PER_HOUR, 6),
    adminPassword: env.ADMIN_PASSWORD || '',
    publicOrigin,
    runnerSocket: env.RUNNER_SOCKET ?? '/run/office-runner/api/runner.sock',
    runnerTokenFile: env.RUNNER_TOKEN_FILE ?? '/opt/office-runner/shared/api.token',
    runnerTickMs: num(env.RUNNER_TICK_MS, 5000),
    runnerPollMs: num(env.RUNNER_POLL_MS, 1500),
    runnerBuildWaitMs: num(env.RUNNER_BUILD_WAIT_MS, 90000),
    runnerCheckTimeoutMs: num(env.RUNNER_CHECK_TIMEOUT_MS, 60000),
    trustProxy: env.TRUST_PROXY === '1',
    // Off unless set: what stops the money is the building's lifetime limit below. Each of these would stop a job long before that.
    floorDailyUsd: cap(env.FLOOR_DAILY_USD, Infinity),
    globalDailyUsd: cap(env.GLOBAL_DAILY_USD, Infinity),
    // The exception, a safety net and not a budget: one task can't eat the building if it gets stuck. Normal work never reaches it, no bot is told it exists, and the boss hears plainly if it ever bites. "off" turns it off.
    taskMaxUsd: cap(env.TASK_MAX_USD, 40),
    // What the whole building may ever spend with each provider. Counted over the whole ledger, for the admin's eyes only. Raising one and restarting starts the work again.
    budgetAnthropicUsd: lifetime(env.BUDGET_ANTHROPIC_USD, 120),
    budgetOpenrouterUsd: lifetime(env.BUDGET_OPENROUTER_USD, 120),
    maxCallsFloor: num(env.MAX_CALLS_FLOOR, 3),
    maxCallsGlobal: num(env.MAX_CALLS_GLOBAL, 6),
    maxStaff: workCap(env.MAX_STAFF),
    // On by default since 11-10: a job that needs more than this is stuck, and it is told to save and report a few steps before. "off" turns it off.
    maxStaffSteps: onCap(env.MAX_STAFF_STEPS, 40),
    maxManagerSteps: workCap(env.MAX_MANAGER_STEPS),
    maxOpenTasks: workCap(env.MAX_OPEN_TASKS),
    maxTasksPerDay: workCap(env.MAX_TASKS_PER_DAY),
    maxRevisions: workCap(env.MAX_REVISIONS),
    // Loop caps (server/rounds.js), on by default: how many times one project may fail its test and go back, and be planned again, before the manager stops and asks the boss. "off" turns one off.
    loopMaxRetests: onCap(env.LOOP_MAX_RETESTS, 2),
    loopMaxReplans: onCap(env.LOOP_MAX_REPLANS, 3),
    towerFloors: num(env.TOWER_FLOORS, 10),
    quotaBytes: num(env.FLOOR_QUOTA_MB, 100) * 1024 * 1024,
    mockDelayMs: num(env.MOCK_DELAY_MS, 400),
    retryBaseMs: num(env.RETRY_BASE_MS, 1000),
    rateScale: 1, // only tests raise this, through overrides; there is deliberately no env switch
    // How long a request may take to arrive in full; the boss's upload gets longer, for a big photo on a slow phone line. Tests shorten these through overrides.
    requestTimeoutMs: 30000,
    uploadTimeoutMs: 120000,
    fetchDenyHosts: [...(env.FETCH_DENY_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean), FORMER_HOME],
    // What published apps may do through Office Cloud: call AI and fetch public pages. Both on unless switched off here. See docs/OFFICE-CLOUD.md.
    officeAiEnabled: !/^(0|false|no|off)$/i.test(String(env.OFFICE_AI_ENABLED ?? '').trim()),
    officeChatEnabled: !/^(0|false|no|off)$/i.test(String(env.OFFICE_CHAT_ENABLED ?? '').trim()),
    officeFetchEnabled: !/^(0|false|no|off)$/i.test(String(env.OFFICE_FETCH_ENABLED ?? '').trim()),
    // The defaults are in server/cloud/powers.js; a setting here replaces one. The building's daily ceiling is for the admin's eyes only.
    cloudAiLimits: numbersOnly({ maxTokens: env.OFFICE_AI_MAX_TOKENS, dayFast: env.OFFICE_AI_DAY_FAST, daySmart: env.OFFICE_AI_DAY_SMART, buildingDayUsd: env.OFFICE_AI_BUILDING_DAY_USD }),
    // Account emails (welcome, password reset) one published project may send a day, on top of the floor's and building's mail caps.
    appMailDaily: Number.isFinite(Number(env.OFFICE_APP_MAIL_DAY)) && String(env.OFFICE_APP_MAIL_DAY ?? '').trim() !== '' ? Math.max(0, Number(env.OFFICE_APP_MAIL_DAY)) : 30,
    cloudFetchLimits: numbersOnly({ dayProject: env.OFFICE_FETCH_DAY, hostDelayMs: env.OFFICE_FETCH_HOST_DELAY_MS, cacheTtlMs: env.OFFICE_FETCH_CACHE_MS }),
    // A real computer for the Builder and Tester: Claude Managed Agents, one Anthropic-hosted container per task. Off until the deploy turns it on.
    computerEnabled: env.COMPUTER_ENABLED === '1',
    sessionMaxUsd: cap(env.SESSION_MAX_USD, Infinity),  // platform budget per session when set; otherwise a session is promised a slice at a time, as below
    // Not a cap: how much of the building's money one session is promised at a time. It always gets the next slice while there is money, but no session can hold everything that is left and keep the rest of the building waiting.
    sessionSliceUsd: num(env.SESSION_SLICE_USD, 2) > 0.1 ? num(env.SESSION_SLICE_USD, 2) : 2,
    sessionMaxSteps: workCap(env.SESSION_MAX_STEPS),    // model requests per session
    // Work sent back to a computer whose conversation has grown past this many tokens starts on a fresh computer, with its saved files, its last report and the
    // notes: every step on the old one would pay to re-read all of it (server/computer.js). SESSION_FRESH_OVER_TOKENS=off always goes back to the same computer.
    sessionFreshOverTokens: onCap(env.SESSION_FRESH_OVER_TOKENS, 250000),
    sessionMaxMinutes: workCap(env.SESSION_MAX_MINUTES),
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
    // A round that hands out no work makes the next one wait three times as long, up to this many minutes, unless something on the floor changes first
    // (server/modes.js). AUTOPILOT_IDLE_BACKOFF=0 goes back to a manager turn every gap, whatever it found.
    autopilotIdleBackoff: env.AUTOPILOT_IDLE_BACKOFF !== '0',
    autopilotIdleMaxMin: Math.max(1, num(env.AUTOPILOT_IDLE_MAX_MIN, 360)),
    modesTickMs: num(env.MODES_TICK_MS, 5000),
    // The daily run (docs/NUMBERS.md): off per floor until its boss turns it on. These limit it across the building and per run.
    dailyMaxFloors: Math.max(0, num(env.DAILY_MAX_FLOORS, 5)),
    dailyTokenCap: Math.max(1, num(env.DAILY_TOKEN_CAP, 5000000)),
    dailyRunTimeoutMin: num(env.DAILY_RUN_TIMEOUT_MIN, 180),
    dailyTickMs: num(env.DAILY_TICK_MS, 30000),
    // Filler companies (floors-plus): scripted floors that look busy and never call a model. Off unless asked for.
    fillerCompanies: env.FILLER_COMPANIES === '1',
    fillerTickMs: num(env.FILLER_TICK_MS, 9000),
    // What people say to each other. Each of these is a real, cheap model call, so each has its limit. Work questions get a generous one, since they feed real work.
    // Off only where a test counts every cent of the work itself. Everything still works without it, in plain words.
    peopleTalk: env.PEOPLE_TALK !== '0',
    // The last look before a first publish (server/shipcheck.js). SHIP_CHECK=0 switches it off.
    shipCheck: env.SHIP_CHECK !== '0',
    // While a long reply is still being written, the prompt cache behind it is kept from expiring (server/anthropic.js). CACHE_KEEP_WARM=0 turns that off.
    cacheKeepWarm: env.CACHE_KEEP_WARM !== '0',
    // The Office Manager's tools and instructions stay in the prompt cache for an hour, so a wake ten minutes after the last one reads them instead of
    // paying to write them again. MANAGER_CACHE_TTL=5m goes back to the five-minute cache everyone else uses.
    managerCacheTtl: env.MANAGER_CACHE_TTL === '5m' ? '5m' : '1h',
    // How long a run on a model with a prompt cache may grow before its oldest steps are dropped, and how much is kept then (server/engine.js, trimSteps).
    // Every cut makes the provider write the whole conversation to its cache again, so cuts are few and large. STEPS_KEEP_CHARS=240000 is the old, smaller window.
    stepsKeepChars: Math.max(60000, num(env.STEPS_KEEP_CHARS, 400000)),
    stepsCutToChars: Math.max(30000, num(env.STEPS_CUT_TO_CHARS, 150000)),
    // The manager reads its last thirty messages every turn. An office note that repeats the same standing instructions (a work-mode round, the daily run)
    // is kept whole only where it is newest. MANAGER_DEDUPE_NOTES=0 sends every copy in full again.
    managerDedupeNotes: env.MANAGER_DEDUPE_NOTES !== '0',
    // How the manager handles what the boss says (docs/MANAGER.md). Each is on unless set to 0.
    // A small request goes straight to one right-sized job: no playbook, no Tester behind it, no plan meeting (server/tools.js, server/prompts.js).
    managerFastPath: env.MANAGER_FAST_PATH !== '0',
    // The boss's request goes with the job in one line, the boss gets one question at a time, and only when it is really unclear or risky.
    managerIntentCheck: env.MANAGER_INTENT_CHECK !== '0',
    // One plan up front: each job with its acceptance checks and an estimate (admin only), a waiting job changed with amend_task rather than cancelled and written again.
    managerPlanFirst: env.MANAGER_PLAN_FIRST !== '0',
    // Whoever does a job ticks its acceptance checks off with evidence before handing in, and is asked once if the reply came without it.
    staffSelfCheck: env.STAFF_SELF_CHECK !== '0',
    // A work-mode round that found nothing to do says so once, then stays out of the boss's chat until something changes. ROUND_REPORTS=all says every one.
    quietRoundReports: env.ROUND_REPORTS !== 'all',
    // The most a file listing hands back before it says to ask for one folder. LIST_FILES_MAX_CHARS=off lists everything, however long.
    listFilesMaxChars: cap(env.LIST_FILES_MAX_CHARS, 12000),
    talkGapMs: num(env.TALK_GAP_MS, env.AI_MODE === 'mock' ? 1 : 2200),
    meetingGapMs: num(env.MEETING_GAP_MS, env.AI_MODE === 'mock' ? 0 : 45000), meetingsPerFloorDay: num(env.MEETINGS_PER_FLOOR_DAY, 40),
    // Small talk only runs while someone has the floor open: one exchange about every BANTER_EVERY_MS, sooner (BANTER_BUSY_EVERY_MS) once two or more are watching.
    banterEveryMs: num(env.BANTER_EVERY_MS, 75000), banterBusyEveryMs: num(env.BANTER_BUSY_EVERY_MS, 45000), banterTickMs: num(env.BANTER_TICK_MS, 15000), banterPerFloorDay: num(env.BANTER_PER_FLOOR_DAY, 600),
    // Small talk building-wide (BANTER=0 stops it), whether it may rib the boss (BANTER_SASS=0, and each boss's own setting), and the hard cap on what one floor's banter may cost in a day.
    // BANTER_PACE=0 lets a floor spend its whole day's allowance at once; by default it may only be a quarter ahead of the clock (UTC day), so an evening still has some left.
    banter: env.BANTER !== '0', banterSass: env.BANTER_SASS !== '0', banterUsdPerFloorDay: num(env.BANTER_USD_PER_FLOOR_DAY, 2), banterPace: env.BANTER_PACE !== '0',
    asksPerTask: num(env.ASKS_PER_TASK, 4), asksPerFloorDay: num(env.ASKS_PER_FLOOR_DAY, 80),
    // The help line: a manager can ask the owner's assistant for guidance. No credential is involved: the assistant answers through scripts/admin.mjs or the admin view.
    helpEnabled: env.HELP_ENABLED !== '0',
    helpTimeoutMin: num(env.HELP_TIMEOUT_MIN, 30),
    helpPerFloorDay: num(env.HELP_PER_FLOOR_DAY, 5),
    helpTickMs: num(env.HELP_TICK_MS, 5000),
    ...mailSettings(env),  // email: RESEND_API_KEY, RESEND_WEBHOOK_SECRET, MAIL_DOMAIN and the caps (docs/MAIL.md)
    ...paySettings(env),  // payments: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (docs/PAYMENTS.md)
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
  return { roles, hireable, all: { ...roles, ...hireable }, tools: each(m.tools), prices, autonomous: m.autonomous || null, appAi: m.appAi || null, floorLimits: m.floorLimits || null };
}

/**
 * The model one call runs on. A job the boss asked for runs on the role's own model; a job the team picked for itself in a work mode
 * runs on the autonomous model, computer sessions included. Returns { provider, model, effort, maxTokens, pricing }, or null for a role
 * that has no computer when one is asked for.
 */
export function routeFor(models, roleKey, { autonomous = false, computer = false, tier = '', floorRoute = null } = {}) {
  // A floor moved onto OpenRouter has no computer: Managed Agents is the Claude API only.
  if (computer && floorRoute) return null;
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
  // The floor's allowance moves the roles that shape the work between models. 'opus' and '' leave a role on its own, and everyone else stays where they are.
  const fl = models.floorLimits;
  const moved = fl && (fl.roles || []).includes(roleKey) ? (tier === 'fable' ? { model: fl.fableModel } : tier === 'sonnet' ? { model: fl.sonnetModel, effort: fl.sonnetEffort } : null) : null;
  if (moved) r = { ...r, provider: 'anthropic', model: moved.model, effort: moved.effort ?? r.effort, pricing: price(moved.model, null) };
  const auto = models.autonomous;
  if (!autonomous || !auto?.model || (!computer && (auto.keepOwnModel || []).includes(roleKey))) return overFloor(r, floorRoute, models.prices);
  return overFloor({ ...r, provider: auto.provider || 'anthropic', model: auto.model, effort: auto.effort ?? r.effort, pricing: price(auto.model, null) }, floorRoute, models.prices);
}

/** OpenRouter's name for a Claude model: claude-sonnet-5-5 is anthropic/claude-sonnet-5.5. */
export const openrouterName = (model) => (String(model).startsWith('claude-') ? `anthropic/${String(model).replace(/-(\d+)-(\d+)$/, '-$1.$2')}` : model);
/**
 * One call's route on a floor that was moved onto OpenRouter (budget.floorRoute). A Claude call goes to OpenRouter on the floor's model and effort instead;
 * anything already on OpenRouter stays as it is. `sameModel` keeps the call's own model under its OpenRouter name (app AI, small talk); `keepEffort` keeps the call's own effort.
 */
export function overFloor(r, floorRoute, prices = {}, { sameModel = false, keepEffort = false } = {}) {
  if (!r || !floorRoute || r.provider !== 'anthropic') return r;
  const model = sameModel ? openrouterName(r.model) : floorRoute.model;
  return { ...r, provider: 'openrouter', model, effort: sameModel || keepEffort ? r.effort : floorRoute.effort ?? r.effort, pricing: prices?.[model] || r.pricing };
}
