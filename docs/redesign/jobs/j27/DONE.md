STATUS: GREEN
JOB: 27 Role merge and cleanup
DONE MEANS: "A job calls at most 6 roles; BD bean and optimizer loop are off."
  Proved in test/roles.test.js:
  - "a Marketer's job goes to the Writer and an Illustrator's to the Designer; the beans keep their desks": the model calls are the Writer's and the
    Designer's only; the Marketer and Illustrator rows (names, desks) are untouched.
  - "the Analyst's and the Lawyer's jobs are refused with where the work went; every role lands on one of six": for every role in
    config/models.json, the job runs as Manager, Researcher, Writer, Designer, Builder or Tester (MERGED_ROLES in server/engine.js).
  - "the team planning meeting is off: a plan makes no huddle model call; TEAM_MEETINGS=1 brings it back" (no talk-meeting ledger row; on, there is).
  - "the Business Development bean is off unless BIZ_DEV_BEAN=1" (snapshot bizDev; the room draws him only then).
  Also: Business mode's Customers step gives the ad words to the Writer (no Marketer is hired for them) and makes no video ads unless the boss asked
  for video in their notes (VIDEO_ADS_ON_REQUEST); the Lawyer's pages stay the office's own code checklist (server/legal.js drafts them from templates,
  no model) and the manager runs launch_check; the Analyst's reading of the numbers is the manager's on the daily run (server/daily.js already does it).
  The optimizer loop: there is no code for it in this repository (it ran outside, stopped since 11 November), so there is nothing to switch off here.
TESTS: npm test 1751/1754 on this branch before the job 10 and 11 test fixes beneath it. The 3: domains.test.js IPv6 (EAFNOSUPPORT ::1;
  fails the same on office-redesign-base, this container has no IPv6) and the two workers.test.js tests fixed on jobs 10 and 11 (42/42 after).
  Changed older tests: api.test.js's hiring test and customise.test.js's word-routing test run with ROLE_MERGE off (they give the Analyst and the
  Marketer jobs); people.test.js runs with TEAM_MEETINGS on (it tests the huddles). Browser suites: not run; the room's one-line change (the bean) is
  driven by the snapshot field tested here.
DEPLOY NOTES: New env (default = new behaviour, nothing deleted): ROLE_MERGE (on; 0 brings the ten roles back), TEAM_MEETINGS (off; 1 brings the
  huddles back), BIZ_DEV_BEAN (off; 1 shows the bean), VIDEO_ADS_ON_REQUEST (on; 0 makes two video ads by default again). No migration. The
  orchestrator should make sure the outside optimizer loop stays stopped.
RISKS: "Video ads only on request with a price": made only when the boss's notes ask for video; showing the boss the price before is job 21's
  estimate (on hold), so no dollar figure is shown yet. The old code (meetings, the Marketer's hire, the bean) is kept behind switches for the 4-week
  removal. public/js/office-scene.js (lane A's file) changed one line to draw the bean only when the snapshot says so. api.test.js's hiring test
  runs with ROLE_MERGE off, since it gives the Analyst a job. Section 8: fewer roles per job, fewer calls (no huddle calls at all).
