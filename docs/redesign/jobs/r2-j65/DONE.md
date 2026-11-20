STATUS: GREEN
JOB: r2-j65 "Did it work?" check
DONE MEANS: "Seven days after a change ships, a before-and-after line appears on the timeline." (Q24 idea 2; code only.)
  - server/didit.js: every minute, a job that finished (job card done) on a public, launched project records its target number: that project's
    real visits in the 7 days before it shipped (table change_checks). Seven days after, code counts the 7 days after and writes one line, e.g.
    "New gallery page: visits 649 to 702", once. The line rides on that job's own card in the snapshot (card.didItWork) and lane A's timeline-ui.js
    shows it under the card (one line added there). Private work never gets a line. No model.
  Proved in test/r2-didit.test.js (2 tests, fake clock): recorded at shipping with 649 (an older day left out), nothing at 6 days, "New gallery
  page: visits 649 to 702" at 7 days, once; the card in the floor's snapshot carries it; the private project's job gets no row and no line; the
  timeline draws it; no model call in the module.
TESTS: every test/r2-*.test.js on the r2-j72 head (this lane's whole stack): 84 of 84 pass, and the files this job touches pass on its own branch.
  npm test (full): last complete run at the r2-j50 code head, 1893 of 1895 (domains.test.js IPv6, which fails on office-r2-base too, and an r2
  test line fixed before any push). Not yet a complete full run on this branch when pushed: the container restarted twice mid-run; the result
  goes in docs/redesign/LANE-R2-B-FINISHED.md. Known in this container: onboarding.test.js's 3-minute browser walk takes 170 to 196 s here and
  fails the same on office-r2-base (193.7 s), so it is the machine, not this lane.
  Browser suites run: npm run e2e:r2-building on the r2-j72 head: all 31 checks pass.
DEPLOY NOTES: New env DID_IT_WORK (default on). Migration: new table change_checks. Lane A's public/js/timeline-ui.js: one line added (the result
  under a job card).
RISKS: The target is always real visits (the one number every launched project has); a change whose aim is something else still gets its visits line.
