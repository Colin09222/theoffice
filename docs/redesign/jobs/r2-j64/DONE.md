STATUS: GREEN
JOB: r2-j64 Numbers to actions
DONE MEANS: "Each active floor gets one Monday proposal with a number and a Yes / No tap." (Q10 c: Mondays 08:30, one change, one reason, the
  number behind it; Yes / No; no reply in 7 days drops it; "getting found" first; skip plan-off, demo and paused floors; one short call per floor
  per week.)
  - server/proposals.js: Mondays from 08:30 New York, each active floor (not a demo, not paused, not switched out with round 1's plan off) gets one
    proposal per week (table floor_proposals, claimed before the call so a second tick never makes a second call). The number is picked by code:
    real visits to the floor's most visited public launch, last 7 days against the 7 before ("Nothing launched yet: 0 real visits." when there is
    none). One short manager call (the floor's own keys, no new dollar limit) writes the change and the reason, the number fenced as data; the mock
    model answers in tests. Open proposals older than 7 days are dropped.
  - The boss's status card shows it (change, Why, The number) with Yes and No (POST /api/floors/:slug/proposal/:id, boss only). Yes hands the
    change to the team as one ordinary job (its brief says anything public outside the site needs the boss's own tap); No closes it.
  Proved in test/r2-proposals.test.js (2 tests): nothing at 08:29; at 08:30 the two active floors get one each and the plan-off floor (as TheTireRx
  is), the paused floor and the demo floor none, over three ticks; the exact number line; the boss sees it, a visitor doesn't; another floor's
  boss gets 403; Yes makes the job once, a second answer is 404; the other is dropped after 7 days; the card's words and buttons.
TESTS: every test/r2-*.test.js on the r2-j72 head (this lane's whole stack): 84 of 84 pass, and the files this job touches pass on its own branch.
  npm test (full): last complete run at the r2-j50 code head, 1893 of 1895 (domains.test.js IPv6, which fails on office-r2-base too, and an r2
  test line fixed before any push). Not yet a complete full run on this branch when pushed: the container restarted twice mid-run; the result
  goes in docs/redesign/LANE-R2-B-FINISHED.md. Known in this container: onboarding.test.js's 3-minute browser walk takes 170 to 196 s here and
  fails the same on office-r2-base (193.7 s), so it is the machine, not this lane.
  Browser suites run: npm run e2e:r2-building on the r2-j72 head: all 31 checks pass.
DEPLOY NOTES: New env PROPOSALS (default on; 0 turns it off). Migration: new table floor_proposals. TheTireRx (floor 6, plan off) gets none, as ruled.
RISKS: Which bean gets a Yes job is the builder (the change is usually a page change); the manager can re-route it as with any job.
