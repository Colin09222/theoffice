STATUS: GREEN
JOB: 17 Model tiers
DONE MEANS: "Each task records its tier; edits run on Tier 1 or 2; only tagged hard builds use Tier 3."
  config/models.json "tiers" + Engine.decideTier, proved in test/tiers.test.js:
  - "each task records its tier": a small Writer edit runs on Tier 1 (claude-haiku-5-5), a small code edit and an untagged first build on Tier 2
    (claude-sonnet-5-5 at medium effort), the Tester on its own model; tasks.tier, tier_why and tier_at are set when work starts.
  - "only a build tagged hard uses Tier 3, capped at $6, at most two a floor a week": assign_task takes hard: true; the first two run on
    claude-opus-5-5 with tasks.cap_usd 6 (job 7's per-task cap); the third that week runs on Tier 2 and says why.
  - "a fix task for handed-back work, and new work on a project whose fix round is used up, are Tier 3" (job 4's fix task, job 10's shipped job).
  - "Fable is off for floors ... and on only for a job the owner names": a floor that the old allowance would put on Fable runs its manager on
    Tier 2; node scripts/admin.mjs fable --task N on lets that one job run on claude-fable-5-2.
  - "MODEL_TIERS=0 goes back to the floor allowance".
  The manager and a colleague's work answer run on Tier 2. Per-floor stops and the building caps are untouched (they count dollars, not models).
TESTS: npm test 1741/1744 on this branch before the job 10 and 11 test fixes beneath it. The 3: domains.test.js IPv6 (EAFNOSUPPORT ::1;
  fails the same on office-redesign-base, this container has no IPv6) and the two workers.test.js tests fixed on jobs 10 and 11 (42/42 after). Changed
  older tests: floor-limits.test.js runs without the tiers it predates; manager.test.js's switched-off tool list turns MODEL_TIERS off too.
  Browser suites: not run (no page changed).
DEPLOY NOTES: Migration (lane B block): tasks.tier, tier_why, tier_at, hard, fable_ok. config/models.json gains a "tiers" block (deployed with the
  code). New env: MODEL_TIERS (on), TIER3_PER_FLOOR_WEEK (2), TIER3_CAP_USD (6). Admin: node scripts/admin.mjs fable --task N on|off; node
  scripts/admin.mjs tiers [--floor N] [--since 7d] for tasks and cost by tier and this week's Tier 3 jobs. A computer on a new tier is its own
  Managed Agents agent (theoffice-builder-sonnet, -opus), made on first use.
RISKS: Tier 1 for "routing a boss message" was not added as a separate call: the manager's own turn (Tier 2) still reads and sorts the boss's
  message. Tier 1 covers small Writer and Researcher jobs (text edits, summaries). The week for the Tier 3 count starts Monday 00:00 New York.
  Tests boot with the tiers off (like floorLimits) so other suites' prices stay put; tiers.test.js and floor-limits.test.js cover both paths.
  Section 8: cost per edit should fall (Haiku/Sonnet in place of Opus for the roles that moved).
