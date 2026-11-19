STATUS: GREEN
JOB: 09 Done-means lines
DONE MEANS: "Every new job stores 3 to 5 lines before work starts, and the Tester's report lists only those lines."
  server/donemeans.js, proved in test/donemeans.test.js:
  - "every new job stores 3 to 5 lines before work starts; fewer or more is refused": assign_task with 0, 2 or 6 lines is refused and nothing is
    made; 3 lines are stored as data (tasks.checks) and written into the brief as a numbered "Done means:" list; lines typed into the brief count.
  - "frozen once work starts: the manager can't change them, the boss can (an amend on the boss's turn)": tasks.checks_frozen_at is set when work
    starts; amend_task with new lines is refused for the manager after that ("frozen. Only the boss can change them") and accepted on the boss's turn
    (tasks.checks_amended_at).
  - "the Tester checks only the job's lines; its report lists only those; other ideas go to the Later list, never back to the Builder": a Tester's
    job takes the tested job's lines (its own "dark mode" line is dropped), its brief says to check only those and end with "Test report:" and
    "Later:"; the stored report (tasks.result) is "Tested against its 3 done-means lines: 2 PASS, 1 FAIL ..." with one line each and evidence, and
    nothing else; the two extra ideas went to project_later; the manager's state never sees them; a FAIL line counts as a Tester failure (job 4).
  - "reading a report: a line it never reached is NOT CHECKED". "DONE_MEANS=0 goes back to free-form checks".
  The scripted manager in server/mock.js now writes three lines on every job, so mock mode keeps working.
TESTS: npm test 1724/1728 on this branch before its last test fix. The 4: domains.test.js IPv6 (EAFNOSUPPORT ::1; fails the same on office-redesign-base,
  this container has no IPv6); rounds.test.js "the manager's tools refuse the send-back ..." and "a floor whose Tester always fails ..." (they assign
  one-line checks; the next commit runs that file with DONE_MEANS off; rounds.test.js, donemeans.test.js and workers.test.js 54/54 after);
  soak.test.js "50 floors ... no errors or leaks" (heap grew 80 MB while two full suites ran at once on 4 CPUs; passes on its own, 1/1).
  Changed older tests that assign one- or two-line checks (attachments.test.js, llm.test.js stub, manager.test.js, rounds.test.js): they pass three lines
  or run with DONE_MEANS off. Browser suites: not run (no page changed).
DEPLOY NOTES: Migrations (lane B block): tasks.checks_frozen_at, tasks.checks_amended_at, tasks.test_lines; table project_later. New env DONE_MEANS
  (default on; 0 = the old free-form checks). The manager's prompt says "three to five" checks (was three to six) while DONE_MEANS is on.
RISKS: A small edit also needs 3 lines (the spec says every job); a manager that sends fewer gets one refusal and has to call again (one more step).
  The Later list is stored (project_later) but not shown on a page yet: lane A's floor page or job 20's weekly plan can read it. A Tester report
  with no numbered lines reads as all NOT CHECKED (not a failure). The older manager suites (manager.test.js, rounds.test.js) run with DONE_MEANS off
  because they test their own check counts; the new rule is tested in donemeans.test.js. Section 8: Tester share falls as Testers stop
  re-opening new wishes; measurable on live with scripts/manager-report.mjs.
