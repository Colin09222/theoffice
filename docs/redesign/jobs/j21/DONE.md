STATUS: GREEN
JOB: 21 Estimates, shown only
DONE MEANS: "A boss sees 'This will cost about $X' on a new job; a visitor sees no money; a test shows a job estimated far below its real cost still
  runs to the end."
  server/estimate.js (code only, no model call), proved in test/estimate.test.js:
  - "the starting prices until a kind has 10 finished jobs, then the median of the last 10": kinds are edit (every step small), game, business (business,
    shop, app), service (a website with a booking/contact form) and website. Starting prices from Q7: edit $0.40, game $2 (shown as the middle of $1 to $3),
    one-page website $1, service site $2, business/shop $3 (middle of $2 to $4). After 10 finished jobs of a kind: their median cost (sum of each job's
    tasks.cost_usd, i.e. its ledger rows). Nine is not enough. Lines: under $1 in cents ("This will cost about $0.40."), else whole dollars.
  - "the boss sees 'This will cost about $X.' on a new job and under Now; a visitor sees no money; no bot reads it": the boss's snapshot has
    jobs[].estimate and status.now.estimate; the timeline card and the status card's Now row show the line (public/js/timeline-ui.js, status-card.js).
    A visitor's snapshot has no estimate, no job_est field and no "$"; the manager's assign_task tool result, the manager's context and the Builder's
    messages carry no figure.
  - "a job estimated far below what it really costs still runs to the end": estimated $0.01, it ran 4 calls costing $8 (800 times) to review, capped_at
    stays null.
  - "a job's estimate is worked out again as steps are added before it starts, then kept; JOB_ESTIMATES=0 hides the line".
  Each task records its job's estimate (tasks.job_est_usd, job_est_kind, job_est_basis), set in engine.assignTask; kept once a step has started, so the
  digest and ranked view can compare it with the real cost later.
TESTS: npm test 1822/1825 on a2bc78e; the 3: test/budget.test.js owner leak test (fixed in 408f0e4, below), launch.test.js "launch_check can't wipe what
  publishing recorded" (a claim timed out at 30s while another test run shared the machine; passes alone: budget.test.js + launch.test.js 112/112 on
  408f0e4) and domains.test.js IPv6 (EAFNOSUPPORT ::1; this container has no IPv6, fails the same on office-nobudget). Changed older test, as the
  ruling changes the behaviour: budget.test.js's owner leak test now takes the boss's job estimates out of the view and checks them apart (each must be
  exactly "This will cost about $N."), like the purchase price it already allowed; the visitor scans are unchanged. Browser suites: not run (two small
  additions to the boss's card and timeline; checked through the snapshot).
DEPLOY NOTES: Migration (lane B block): tasks.job_est_usd REAL, tasks.job_est_kind TEXT, tasks.job_est_basis TEXT (additive). New env: JOB_ESTIMATES (on;
  0 hides the line; tasks still record their estimate). Nothing to run after deploy. Jobs started before the deploy have no estimate (no line).
RISKS: The spec says "median of the last 10 finished jobs of that lane and size"; jobs are grouped into the five Q7 kinds instead (edit = all small steps;
  game; website; service site = website with a form; business/shop), because lane alone has no "edit" and size alone has no price. A job = the tasks
  under one plan and project (as server/jobcards.js). The "manager's confirmation" in the chat gets no line: chat messages go back into the manager's
  context and can be public, and the line must never reach a prompt or a visitor; the boss sees it on the job's card and under Now instead. Lane A
  files touched, small: public/js/timeline-ui.js (one line), public/js/status-card.js (the Now row), public/css/skin.css (two rules).
  Forbidden spend limits found from round 1: none still active. The back-out already made job 7's hard cap opt-in (HARD_CAP_ENDS) and Tier 3's own cap
  0 by default; the per-floor daily stops (floorLimits, budget_out, daily.js's halt on a stopped floor) are the building's existing caps, unchanged.
  server/spendcheck.js:20's comment still says "budgets refill on Monday" (a comment only).
