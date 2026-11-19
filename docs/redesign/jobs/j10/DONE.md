STATUS: GREEN
JOB: 10 Tight loop
DONE MEANS: "No job has more than 1 fix round or 1 plan rewrite; a plan has at most 5 jobs."
  Proved in test/loop.test.js:
  - "the defaults": LOOP_MAX_RETESTS 1 (was 2), LOOP_MAX_REPLANS 1 (was 3), LOOP_MAX_FIX_ROUNDS 1, LOOP_MAX_PLAN_JOBS 5, LOOP_MAX_QUEUED 3,
    LOOP_ONE_PLAN on, MAX_EDIT_STEPS 15, MAX_STAFF_STEPS 40 (builds kept).
  - "one fix round per job": the first send-back goes; the second ships the job as it stands (status done, wip=1, revisions stays 1) with the
    failed done-means line under "Not done yet" (tasks.not_done), and the manager is told to publish it and ask the boss one plain question.
  - "one plan rewrite per project: a third plan is refused" (rounds.js through LOOP_MAX_REPLANS).
  - "at most 5 jobs in a plan, and no new plan while one is open": the sixth job of a plan is refused; a job under a new plan name is refused while
    the open plan has jobs waiting, running or in review; once it is closed the new plan starts.
  - "an edit has 15 steps; a build keeps 40". "at most 3 jobs queued ahead on the team's own next-up list".
TESTS: npm test 1732/1734 on this branch before its last test fix. The 2: domains.test.js IPv6 (EAFNOSUPPORT ::1; fails the same on
  office-redesign-base, this container has no IPv6) and workers.test.js "fix rounds end when a limit is set ..." (it expected MAX_REVISIONS's own words;
  the next commit lifts the fix-round cap there; workers.test.js 42/42 after). Browser suites: not run (no page changed).
DEPLOY NOTES: New env (default = new behaviour): LOOP_MAX_FIX_ROUNDS (1), LOOP_MAX_PLAN_JOBS (5), LOOP_MAX_QUEUED (3), LOOP_ONE_PLAN (on),
  MAX_EDIT_STEPS (15); "off" lifts a number. Changed defaults: LOOP_MAX_RETESTS 2 to 1, LOOP_MAX_REPLANS 3 to 1 (set them on live to go back).
  No migration.
RISKS: "Max 3 jobs queued ahead" is read as the team's own next-up list (the backlog a work mode draws from), because a plan may hold 5 jobs and
  the manager hands a plan out at once; capping waiting jobs at 3 would have contradicted "5 jobs per plan". "One plan open" counts plans by name;
  a job with no plan name is not refused. The question to the boss after the fix round is asked by the manager (its instructions say so); code
  records the "Not done yet" list. Changed older tests where the spec changes the behaviour: rounds.test.js runs its mechanics at the old caps;
  modes.test.js's "three failed jobs" test keeps the old re-test cap; unlimited.test.js reads the new defaults; rehold.test.js's replay, costalert.test.js,
  workers.test.js and unlimited.test.js's MAX_REVISIONS tests lift the fix-round cap; manager.test.js and orders.test.js (a standing order is a plan a day)
  set the counts they were written for. A plan's five jobs are counted since the boss last had a say (or a day), so a standing order's next day is a new plan. Section 8: fix rounds per job go from up to 2 to 1 at most (tested).
