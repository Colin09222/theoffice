STATUS: GREEN
JOB: 34 Own spend behind a tap
DONE MEANS: "On the boss's status card, a small 'Spend' link. Tapping it shows that floor's own dollars only: this week, last week and since
  the floor opened, split Claude / OpenRouter, and the latest few jobs with what each cost. No gauge, no budget, no 'left', no limits, no
  building totals, no model names. Visitors never see the link. DONE MEANS: a boss taps Spend and sees their floor's own figures; another
  floor's boss and a visitor can't fetch them (test the API too)."
  - server/ownspend.js: GET /api/floors/:slug/spend, boss only (requireOwner: 401 for a visitor, 403 for another floor's boss). It reads
    the ledger directly, with no model call. Weeks are job 5's (spendcheck.js weekStart, Monday 00:00 America/New_York).
    The reply holds:
      - thisWeek, lastWeek and sinceOpened, each { totalUsd, claudeUsd, openrouterUsd }; the total also counts domains.
      - The latest 5 jobs (job cards), each { title, state, costUsd, at }. A job's cost is the ledger rows for its tasks.
    No model name, cap, budget, "left" or building figure is in it.
  - The floor snapshot carries only status.figuresTap: true for the boss (never for a visitor). The figures themselves are never in the
    snapshot or the stream; the existing "no money in a boss's snapshot" tests (test/budget.test.js) pass unchanged.
  - public/js/status-card.js: a small "Spend" link at the end of the card's actions, boss only. It opens a dialog: "What your floor has
    spent. Your floor only." A table holds This week, Last week and Since you opened by Total, Claude and OpenRouter, then "Latest jobs"
    with each job's cost and when.
  - Switch: OWN_SPEND=0 takes the route (404) and the link away.
  Proved in test/ownspend.test.js, 3 tests:
    - "this week, last week and since opened, split Claude and OpenRouter, and the latest jobs with their cost": ledger rows in this
      week, last week and a month back, plus another floor's $99. Exact figures. Nothing in the reply matches
      budget|limit|cap|left|gauge|remaining|model, or the other floor's 99.
    - "another floor's boss and a visitor can't fetch them; OWN_SPEND=0 takes the route away": 403, 401 and 404.
    - "the boss's card offers the link; a visitor's never does, and the snapshot carries no figures either way": figuresTap for the
      boss only, no 3.5 in either snapshot, and the link and the dialog's labels in the page code.
TESTS: npm test 1823/1824 (3 new). The 1 failure is domains.test.js "the key only travels over TLS, in the body, and over IPv4" (EAFNOSUPPORT ::1: the box has no IPv6; it fails the same on office-nobudget). Browser suites: none run for this job (a link and a dialog on the status card; the API and the
  page code are covered by the tests above).
DEPLOY NOTES: none to run. New env OWN_SPEND (default on; 0 turns the link and route off). No migration.
RISKS: Round 1 code that limits spend in a forbidden way: none found in lane A's code. The status card still has the two empty, hidden
  places job 15 marked for the fuel gauge and Approve plan (data-slot fuel-gauge, approve-plan). Nothing is drawn in them. The fuel gauge
  is now ruled out, so they can be removed at any time. The pre-existing building caps (floorDailyUsd, globalDailyUsd and the provider
  pots) are not round 1 work and are left as they are, per the ruling. "This week" is the owner's week (Monday, New York time), not the
  boss's own time zone, so that it matches the spend record and the digest.
