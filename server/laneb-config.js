// The settings for the redesign's lane B (docs/redesign/LANE-B.md): the worker loop, costs and alerts. A tiny module of its own, like mail-config.js,
// so config.js reads them in one line. Each behaviour change that could hurt a live floor has a switch here; the default is the new behaviour.

const on = (v) => !/^\s*(0|false|no|off)\s*$/i.test(String(v ?? ''));
/** A cap that is on unless set to "off" (as in config.js). A typo keeps the default. */
const onCap = (v, dflt) => { if (/^\s*off\s*$/i.test(String(v ?? ''))) return Infinity; const n = Number(v); return v !== undefined && String(v).trim() !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt; };

/** The settings, from the environment through config.js. Tests override any of them. */
export function laneBSettings(env = process.env) {
  return {
    // j04, re-hold rules. The contractor routing check runs once, when a task is created, never on a status change (CONTRACTOR_ROUTE_ONCE=0 checks
    // again each time a task is picked up, as before). A Tester failure on work the contractor handed back makes one fix task on the floor, and the
    // original is closed as shipped (HANDBACK_FIX=0 leaves it to the manager, as before). Refusing to hold handed-back work again has no switch.
    contractorRouteOnce: on(env.CONTRACTOR_ROUTE_ONCE),
    handbackFix: on(env.HANDBACK_FIX),
    // j05, the budget check inside the server (server/spendcheck.js): a spend record every SPEND_CHECK_EVERY_MIN minutes (default 120). SPEND_CHECK=0 stops it.
    spendCheck: on(env.SPEND_CHECK),
    spendCheckEveryMs: Math.max(1, Number(env.SPEND_CHECK_EVERY_MIN) || 120) * 60000,
    // j06, alerts to the owner (server/owneralerts.js): only the five immediate alerts (OWNER_ALERTS=0 stops them) and one digest a day at DIGEST_AT
    // New York time (OWNER_DIGEST=0 stops it). Both go through the OpenClaw hook (OPENCLAW_HOOK_URL, OPENCLAW_HOOK_TOKEN), delivered to the owner.
    ownerAlerts: on(env.OWNER_ALERTS),
    ownerDigest: on(env.OWNER_DIGEST),
    digestAt: /^\d{2}:\d{2}$/.test(env.DIGEST_AT || '') ? env.DIGEST_AT : '08:05',
    // The night freeze: no new floor work starts from NIGHT_FREEZE_FROM to NIGHT_FREEZE_TO in NIGHT_FREEZE_TZ. NIGHT_FREEZE=0 turns it off;
    // admin.mjs freeze on|off|auto overrides it from the database without a restart. A mock building (AI_MODE=mock) spends nothing, so there it is off
    // unless NIGHT_FREEZE says otherwise: a test or a local run at night would otherwise sit still.
    nightFreeze: env.NIGHT_FREEZE === undefined || env.NIGHT_FREEZE === '' ? env.AI_MODE !== 'mock' : on(env.NIGHT_FREEZE),
    nightFreezeFrom: /^\d{2}:\d{2}$/.test(env.NIGHT_FREEZE_FROM || '') ? env.NIGHT_FREEZE_FROM : '23:00',
    nightFreezeTo: /^\d{2}:\d{2}$/.test(env.NIGHT_FREEZE_TO || '') ? env.NIGHT_FREEZE_TO : '08:00',
    nightFreezeTz: env.NIGHT_FREEZE_TZ || 'America/New_York',
    // j07, the hard cap (TASK_MAX_USD, default 5, in config.js): a task that reaches it is ended and ships or closes. HARD_CAP_ENDS=0 goes back to the old stop.
    hardCapEnds: on(env.HARD_CAP_ENDS),
    // j09, done-means lines (server/donemeans.js): every job has 3 to 5, frozen once work starts; the Tester checks only those and its report lists only
    // those; anything else goes to the project's Later list. DONE_MEANS=0 goes back to the free-form checks.
    doneMeans: on(env.DONE_MEANS),
    // j10, the tight loop (LOOP_MAX_RETESTS and LOOP_MAX_REPLANS, now 1 and 1, are in config.js): one fix round per job (LOOP_MAX_FIX_ROUNDS), at most 5 jobs
    // in a plan (LOOP_MAX_PLAN_JOBS), at most 3 jobs on the team's own next-up list (LOOP_MAX_QUEUED), no new plan while one is open (LOOP_ONE_PLAN=0 lifts
    // it), and 15 steps for an edit (MAX_EDIT_STEPS; builds keep MAX_STAFF_STEPS, 40). "off" lifts a number.
    loopMaxFixRounds: onCap(env.LOOP_MAX_FIX_ROUNDS, 1),
    loopMaxPlanJobs: onCap(env.LOOP_MAX_PLAN_JOBS, 5),
    loopMaxQueued: onCap(env.LOOP_MAX_QUEUED, 3),
    loopOnePlan: on(env.LOOP_ONE_PLAN),
    maxEditSteps: onCap(env.MAX_EDIT_STEPS, 15),
    // j11, the smoke check (server/smoke.js): after each publish a script opens the live page (SMOKE_CHECK=0 stops it), in a real browser when Playwright is
    // on the machine (SMOKE_BROWSER=0 keeps it to plain HTTP). An edit ships on it with no Tester, unless it touches paying, forms or sign-in, which get one
    // Tester pass (EDIT_SKIPS_TESTER=0 lifts the rule). The Tester gets a computer only for games and shops (TESTER_COMPUTER_GAMES_SHOPS=0: always, as before).
    smokeCheck: on(env.SMOKE_CHECK),
    smokeBrowser: on(env.SMOKE_BROWSER),
    editSkipsTester: on(env.EDIT_SKIPS_TESTER),
    testerComputerGamesShops: on(env.TESTER_COMPUTER_GAMES_SHOPS),
    // j17, model tiers (config/models.json "tiers"): each task records its tier (1 Haiku, 2 Sonnet medium, 3 Opus); at most TIER3_PER_FLOOR_WEEK (2) Tier 3
    // tasks a floor a week, each capped at TIER3_CAP_USD ($6). Fable only for a job the owner names (admin.mjs fable). MODEL_TIERS=0 goes back to floorLimits.
    modelTiers: on(env.MODEL_TIERS),
    tier3PerFloorWeek: onCap(env.TIER3_PER_FLOOR_WEEK, 2),
    tier3CapUsd: Number(env.TIER3_CAP_USD) > 0 ? Number(env.TIER3_CAP_USD) : 6,
  };
}
