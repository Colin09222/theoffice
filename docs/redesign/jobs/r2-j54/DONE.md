STATUS: GREEN
JOB: r2-j54 Audience views
DONE MEANS: "A visitor sees kind lines only; a boss sees their own items in full; Colon sees the whole queue." (Section 3 "Who sees what".)
  - /api/mailroom by audience: a visitor gets the public fields only (the page writes one line of kind with the floor number: "Help question from
    floor 6", "Purchase request from floor 3", "Build job from floor 6"). A floor's boss (the app's own viewer rule) also gets "mine": their own
    floor's items in full (question and answer, item, price and why, the job and the contractor's status), read from that floor only, hidden or
    not. The admin (Colon) gets "queue": every item on every floor in full, and "stuck": the stuck jobs, with Send out going through the admin
    page's existing POST /api/admin/tasks/:id/send-out (no new route).
  - The page: the robot button only opens a small card (state and counts by kind); a boss reads their own items; Colon reads the queue and can
    press Send out. Tapping the robot never contacts buddehbot.
  Proved in test/r2-audience.test.js (2 tests): with three floors' records (one hidden), a visitor's reply has no words, prices or names and its
  kind lines are exactly the six public ones; a boss gets their three items in full and nothing of the others; the hidden floor's own boss gets
  theirs; the admin gets all nine and the stuck list; the page calls only /mailroom and the existing Send out route.
TESTS: npm test (full) at the r2-j50 code head (4ff1a4c): 1893 of 1895 pass. The 2 failures: domains.test.js IPv6 (no IPv6 in this container; fails the same on office-r2-base) and test/r2-tower.test.js poll line (fixed in r2-j36 before any push). Since then, every test/r2-*.test.js and the files this job touches, run on this branch: all pass.
DEPLOY NOTES: none.
RISKS: The boss's view finds their floor by checking the session against each active floor (a few dozen at most), using the app's own rule.
