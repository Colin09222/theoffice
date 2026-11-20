STATUS: GREEN
JOB: r2-j61 Boss alerts
DONE MEANS: "A waiting question emails the boss once, and again once after 24 hours." (Q13: three events only (question waiting, launch ready,
  something shipped), max 3 a day per boss, one 24 h reminder; floor 7 needs its boss email first.)
  - server/bossalerts.js: every minute, per active non-demo floor with a boss address (mail_floor.boss_email): an unanswered row in questions (and
    its one reminder 24 h later, only after the first was sent), a maker job at stage "ready" not yet launched, a public project newly published.
    Each event is keyed so it happens once (table boss_alerts, lane B's r2 block in db.js). At most 3 sent a New York day per boss; one over the
    cap is recorded "capped" and never sent later. Sent through the building's existing sender, engine.mail.send(..., by: 'app'), the form alerts'
    path. No money, no model.
  - BOSS_ALERTS ships OFF. Off: nothing is sent, recorded or queued. Turned on: it starts from that moment (a settings row), so nothing that
    happened while it was off is mailed afterwards.
  Proved in test/r2-alerts.test.js (4 tests, with the mock Resend and a fake clock, BOSS_ALERTS on): one email, none at 23 h, the reminder at 24 h,
  never a third; answered questions never; 4 events in one day give 3 sent and 1 capped, never sent the next day; only the three kinds; no money;
  a launch ready and a shipped project each email once; off: nothing sent or recorded, and switched on later nothing from before is sent;
  loadConfig gives off by default and on for BOSS_ALERTS=1.
TESTS: every test/r2-*.test.js on the r2-j72 head (this lane's whole stack): 84 of 84 pass, and the files this job touches pass on its own branch.
  npm test (full): last complete run at the r2-j50 code head, 1893 of 1895 (domains.test.js IPv6, which fails on office-r2-base too, and an r2
  test line fixed before any push). Not yet a complete full run on this branch when pushed: the container restarted twice mid-run; the result
  goes in docs/redesign/LANE-R2-B-FINISHED.md. Known in this container: onboarding.test.js's 3-minute browser walk takes 170 to 196 s here and
  fails the same on office-r2-base (193.7 s), so it is the machine, not this lane.
  Browser suites run: npm run e2e:r2-building on the r2-j72 head: all 31 checks pass.
DEPLOY NOTES: New env BOSS_ALERTS, DEFAULT 0 (off). The orchestrator turns it on (BOSS_ALERTS=1) only after Colon says yes. Floor 7 needs a boss
  address first: node scripts/admin.mjs mail boss-email (round 1, job 8). Migration: new table boss_alerts (redesign r2 lane B block).
RISKS: "Launch ready" is a maker job waiting for the boss's Launch tap; a business journey ready for launch is not counted (no single record says so).
