STATUS: GREEN
JOB: r2-j56 Truth test
DONE MEANS: "An automated test fails if any played animation has no record number." (Q22; section 7: animations tied to a real record, 100%.)
  test/r2-truth.test.js, 4 tests:
  - by code: the player refuses before anything plays; the 3D mailroom plays only through its player (playEvent has one caller), every stamp and
    line in it is inside playEvent, every stamp and line on a phone comes from its own player, every event the page plays goes through push();
    on the floor every walk and the lift ride start inside carry(), which checks the record first.
  - by fuzzing: ten broken events (no type, no number, 0, -2, 1.5, '7', null...) never play, in the player or on the floor.
  - end to end: arrivals of all three kinds, a Send out, closes of every outcome and a hand-back through the real server feed: every one of the
    11+ mailroom plays and 4+ floor plays names a record type and a number that really exists in that table on that floor; every walk is one of them.
  - and the check itself fails on an untied animation.
TESTS: every test/r2-*.test.js on the r2-j72 head (this lane's whole stack): 84 of 84 pass, and the files this job touches pass on its own branch.
  npm test (full): last complete run at the r2-j50 code head, 1893 of 1895 (domains.test.js IPv6, which fails on office-r2-base too, and an r2
  test line fixed before any push). Not yet a complete full run on this branch when pushed: the container restarted twice mid-run; the result
  goes in docs/redesign/LANE-R2-B-FINISHED.md. Known in this container: onboarding.test.js's 3-minute browser walk takes 170 to 196 s here and
  fails the same on office-r2-base (193.7 s), so it is the machine, not this lane.
  Browser suites run: npm run e2e:r2-building on the r2-j72 head: all 31 checks pass.
DEPLOY NOTES: none.
RISKS: The room's own animations that are lane A's (idle moves, poses, beats) are lane A's to tie to records; this test covers the mailroom and
  the floor's tube hook, which are lane B's.
