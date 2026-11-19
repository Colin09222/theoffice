STATUS: GREEN
JOB: 06 Digest and quiet alerts
DONE MEANS: "Colon gets one digest at 08:05 and no alert repeats within the same state."
  server/owneralerts.js, proved in test/owneralerts.test.js:
  - "sent once a day at 08:05 New York time with yesterday's spend by floor, both pots, runway, launches, stuck jobs and decisions": nothing at 08:04,
    one at 08:05 (idempotency key theoffice-owner-alert-digest:<day>), none again that day, the next one the next day.
  - "the building pot passing 80% and 95% is told once each ... and never repeats in the same state": 58% and 68% say nothing (the 50% flag is retired),
    80% once, 95% once, more spend says nothing; a raised cap moves the state down quietly and the next rise is told again.
  - "a floor hitting its stop is told once ..."; "a task ended at its cap and a purchase request are each told once" (job 7 calls taskCapped);
    "a running server alerts the owner once when a purchase request arrives".
  - "a busy day reaches the owner at most twice plus the digest" ($80 of spend over a day plus a capped task: digest, one pot alert, one cap alert).
  - "OWNER_ALERTS=0 tells nothing, and the old silent cost log never tells the owner while these are on".
  - Night freeze: "23:00 to 08:00 New York time; a settings row wins over NIGHT_FREEZE" and "while frozen no new floor work starts; work starts when it lifts".
TESTS: npm test 1715/1716 (the 1 failure is domains.test.js IPv6, EAFNOSUPPORT ::1, which fails the same on office-redesign-base: this container has
  no IPv6). Changed tests, because the spec retires the behaviour: budget.test.js no longer expects a '50%' flag; costalert.test.js runs with
  ownerAlerts off to keep testing the silent log's old $20 word on its own. Browser suites: none touch this job; not run.
DEPLOY NOTES:
  What the server now does, so the outside scheduled budget check can be retired:
  1. Every 2 hours it writes a spend record (job 5): both pots spent/cap/left, each floor this week and yesterday. admin.mjs spend shows them and
     "Costs last updated Nh ago" (STALE past 3 hours).
  2. Every day at 08:05 America/New_York it builds the digest (spend yesterday by floor, both pots left, weeks of runway at the last 7 days' pace,
     what went live yesterday, stuck jobs, decisions waiting) and POSTs it to OPENCLAW_HOOK_URL with deliver:true to OPENCLAW_HOOK_CHANNEL /
     OPENCLAW_HOOK_TO, the same hook and chat the contractor ping uses. Kept in owner_digests; admin.mjs digest shows today's as it would read now.
  3. At once, and only these five, each once per change of state: Anthropic or OpenRouter pot passes 80%; passes 95%; a floor hits its own stop
     (floor-limit); a task is ended at its cap (job 7); a purchase request is filed. Kept in owner_alerts; admin.mjs alerts [--since 7d] lists them,
     GET /api/admin/alerts returns them with the latest digest, the freeze state and the cost freshness line.
  4. Retired: the 50% flag (admin.mjs budget and /api/admin/budget now flag only 80% and 100%), and the silent cost log's "tell Colon" past $20
     (the log stays silent: deliver:false, never tells the owner while OWNER_ALERTS is on). The daily repeat of the 50% message came from the outside
     check reading that flag; once it is retired, nothing repeats.
  5. Night freeze 23:00 to 08:00 America/New_York is a server setting now: no new floor work starts (staff jobs, manager turns, work-mode rounds,
     standing orders, daily runs); work already running finishes. It replaces the outside freeze/restore scripts, which can be retired too.
  Migrations (lane B block): tables owner_alerts, owner_alert_state, owner_digests. New env (default = new behaviour): OWNER_ALERTS (on),
  OWNER_DIGEST (on), DIGEST_AT (08:05), NIGHT_FREEZE (on; off by default only when AI_MODE=mock), NIGHT_FREEZE_FROM (23:00), NIGHT_FREEZE_TO (08:00),
  NIGHT_FREEZE_TZ (America/New_York). Admin: admin.mjs freeze [on|off|auto] (a settings row; wins over NIGHT_FREEZE without a restart),
  POST /api/admin/freeze {mode}. OPENCLAW_HOOK_URL and OPENCLAW_HOOK_TOKEN must stay set on live for the digest and alerts to arrive.
  First boot: the pot states start from where the pots are, so a building already at 58% sends nothing; one already past 80% sends one 80% alert.
RISKS: The contractor ping still reaches the owner's chat through the assistant (it is a work hand-off, not an alert); job 19 makes it the owner's
  own action. Bean talk in people.js (lane A's file) was not frozen: banter becomes model-free in lane A's job 2. "Stuck" in the digest means an open
  task not updated for 6 hours, or one that failed yesterday. Section 8: alerts to Colon go from repeating daily to at most the five kinds once per
  change, plus one digest (tested: a busy day is 2 alerts plus the digest).
