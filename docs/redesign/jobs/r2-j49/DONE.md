STATUS: GREEN
JOB: r2-j49 buddehbot public feed
DONE MEANS: "One read-only address returns open items as number, kind, floor, state and times, with no text or prices."
  - server/mailroom.js, GET /api/mailroom (public, read-only): help requests, purchase requests and contractor jobs that are open, or closed in
    the last 15 minutes (so the page can stamp them), on public floors (hidden and demo floors left out). Each item: kind, record type, number,
    floor number, state (open, or its outcome), times. Counts by kind. Nothing else. MAILROOM=0 takes it away.
  CHECKED in the code (spec section 3 "Data it reads" asked for it):
  - Help requests: table help_requests. id, floor_id, created_at, status pending -> answered | declined | expired, decided_at, delivered_at
    (when the floor got the answer). There is NO picked-up time.
  - Purchase requests: table purchases. id, floor_id, created_at, status pending -> bought | rejected (decided from the admin CLI, decided_at);
    the floor's boss can also set declined or bought-myself (withdrawn by the floor). There is NO "flagged to Colon" outcome and NO
    Colon-approved time. bought shows as bought, rejected as declined; the boss's own withdrawals are not buddehbot's and are not shown.
  - Contractor jobs: table contractor_jobs. id, floor_id, task_id, created_at (held), done_at (handed back), closed_at; status held -> done ->
    closed. The task's sent_out_at (job 19) is when Colon pressed Send out, the only way in. There is NO picked-up time.
  - Domain buying: buddehbot does no part of it. The server's own broker (server/domains.js) checks and buys after the floor boss's click,
    through the registrar; an "uncertain" order waits for the building manager in admin. So no domain folder is shown (no record is buddehbot's).
  - So no item is ever "picked up" today: the robot is never Busy and "On it." never plays until a record says so (none does).
  Proved in test/r2-mailroom-feed.test.js (3 tests): the three kinds with words, prices and names in them come back as exactly kind, type,
  number, floor, state, times (no SECRET text, no 29.5, no floor name, no link); a POST is refused; closed items show bought / answered / done
  and leave after 15 minutes; hidden and demo floors never show; MAILROOM=0 is 404.
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: none to run. New env MAILROOM (default on). test/review.test.js lists /api/mailroom as an open GET (public on purpose).
RISKS: "Picked up" has no record anywhere, so the Busy state and the picked-up animation (section 3, #4) can't show today. Adding one would need
  buddehbot's side to write it, which the spec rules out for this round (no Mac script, no new path).
