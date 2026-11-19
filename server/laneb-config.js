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
    // j07, the hard cap: dropped by the owner's ruling of 2026-11-19 (no budget rules). Off by default, so a task that reaches the safety net (TASK_MAX_USD,
    // $40 in config.js) gets the old stop. HARD_CAP_ENDS=1 brings back job 7's ending (ships as Work in progress, or closes).
    hardCapEnds: /^\s*(1|true|yes|on)\s*$/i.test(String(env.HARD_CAP_ENDS ?? '')),
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
    // j28: the building's shared headless browser (the `shots` service in docker-compose.yml), spoken to over the DevTools protocol (server/cdp.js), and the
    // origin it opens the Office's own pages at. Unset, checks use a local Playwright if there is one, else plain HTTP.
    shotsCdpUrl: String(env.SHOTS_CDP_URL || '').trim().replace(/\/+$/, ''),
    shotsOrigin: String(env.SHOTS_ORIGIN || '').trim().replace(/\/+$/, ''),
    editSkipsTester: on(env.EDIT_SKIPS_TESTER),
    testerComputerGamesShops: on(env.TESTER_COMPUTER_GAMES_SHOPS),
    // j17, model tiers (config/models.json "tiers"): each task records its tier (1 Haiku, 2 Sonnet medium, 3 Opus); at most TIER3_PER_FLOOR_WEEK (2) Tier 3
    // tasks a floor a week. No per-task dollar cap of their own by default (owner's ruling 2026-11-19: no budget rules); TIER3_CAP_USD=N gives each one.
    // Fable only for a job the owner names (admin.mjs fable). MODEL_TIERS=0 goes back to floorLimits.
    modelTiers: on(env.MODEL_TIERS),
    tier3PerFloorWeek: onCap(env.TIER3_PER_FLOOR_WEEK, 2),
    tier3CapUsd: Number(env.TIER3_CAP_USD) > 0 ? Number(env.TIER3_CAP_USD) : 0,
    // j18, the Builder's context diet: the brief, a file list and only the files it opens. Teammates' papers are listed, not pasted in; its run is trimmed at
    // BUILDER_KEEP_CHARS (240000, about 60,000 tokens) down to half that; a fix round on a computer past BUILDER_FRESH_OVER_TOKENS (80000) starts fresh.
    // BUILDER_DIET=0 goes back to the old sizes. scripts/builder-context.mjs reports the average Builder call.
    builderDiet: on(env.BUILDER_DIET),
    builderKeepChars: Math.max(60000, Number(env.BUILDER_KEEP_CHARS) || 240000),
    builderFreshOverTokens: Math.max(20000, Number(env.BUILDER_FRESH_OVER_TOKENS) || 80000),
    // j19, the contractor by hand only (server/sendout.js): no automatic routing anywhere; the owner's Send out, at most CONTRACTOR_SENDOUT_PER_WEEK (2) a week.
    // CONTRACTOR_MANUAL=0 brings back the floor switch (admin.mjs contractor --floor N on).
    contractorManual: on(env.CONTRACTOR_MANUAL),
    // j27, six working roles: Manager, Researcher, Writer (takes the Marketer's words), Designer (takes the Illustrator's), Builder, Tester. The beans keep their
    // names and desks; only the model calls merge. The Analyst's and the Lawyer's jobs are the manager's and the office's own launch checklist (ROLE_MERGE=0
    // brings the ten roles back). TEAM_MEETINGS=1 brings back the team's model-written huddles, BIZ_DEV_BEAN=1 the Business Development bean, and
    // VIDEO_ADS_ON_REQUEST=0 the two video ads made by default in Business mode.
    roleMerge: on(env.ROLE_MERGE),
    teamMeetings: /^\s*(1|true|yes|on)\s*$/i.test(String(env.TEAM_MEETINGS ?? '')),
    bizDevBean: /^\s*(1|true|yes|on)\s*$/i.test(String(env.BIZ_DEV_BEAN ?? '')),
    videoAdsOnRequest: on(env.VIDEO_ADS_ON_REQUEST),
    contractorSendOutPerWeek: Math.max(0, Number.isFinite(Number(env.CONTRACTOR_SENDOUT_PER_WEEK)) && String(env.CONTRACTOR_SENDOUT_PER_WEEK ?? '').trim() !== '' ? Number(env.CONTRACTOR_SENDOUT_PER_WEEK) : 2),
    // Round 1 rest, j21: each job's estimate, shown to the boss only as "This will cost about $X." (server/estimate.js). Information only: nothing
    // waits on it and nothing stops at any multiple of it. JOB_ESTIMATES=0 hides the line.
    jobEstimates: on(env.JOB_ESTIMATES),
    // Round 1 rest, j20: the Monday plan (server/weekplan.js). WEEKLY_PLAN=0 stops the Monday draft building-wide; a draft nobody approves starts by
    // itself after WEEKLY_PLAN_AUTOSTART_HOURS (24). No plan ever holds a floor idle or stops its spending.
    weeklyPlan: on(env.WEEKLY_PLAN),
    weeklyPlanAutostartHours: Number.isFinite(Number(env.WEEKLY_PLAN_AUTOSTART_HOURS)) && String(env.WEEKLY_PLAN_AUTOSTART_HOURS ?? '').trim() !== '' ? Math.max(0, Number(env.WEEKLY_PLAN_AUTOSTART_HOURS)) : 24,
  };
}
