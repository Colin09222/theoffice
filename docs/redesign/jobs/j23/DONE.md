STATUS: GREEN
JOB: 23 Onboarding
DONE MEANS: "A new code holder reaches a started plan in under 3 minutes in a test (mock mode), on desktop and phone widths."
  server/onboarding.js and public/js/onboard-ui.js, proved in test/onboarding.test.js:
  - "in a real browser, a new code holder reaches a started plan in under 3 minutes, at desktop and phone widths": headless Chrome (test/browser/cdp.mjs)
    against the real server in mock mode, 1280x800 and a phone (390x844): home page, Open an office, the code, the keys, "This is your floor" with three
    lane cards (Game, Website, Business) and Something else, Website, "Local service site with a booking form" with "About $2 to start", the three
    questions, the plan (3 jobs, their done-means lines, "This will cost about $2.", one primary button: Start), Start; then the status card reads
    "Step N of 3" and the first timeline card is there. In the full run: desktop 71.8s, phone 35.0s (75.2s and 34.8s on j25; 123 to 135s when run beside other test runs). No page errors; nothing wider than the screen.
  - "one manager call makes the plan ... Start starts it and the status card reads Step 1 of 3": one call (meta.kind 'onboarding'), no money in its
    prompt; goal, up to 5 jobs, 3 to 5 done-means lines each; nothing starts before Start; Start hands the jobs out in order under one plan and
    project (one timeline card), the job keeps the $2 estimate, the company takes the name from the answers, a second tap starts nothing more.
  - "the boss of a new floor is offered three lanes, Q7 templates with prices and three questions each; a visitor is offered nothing": Arcade game
    About $1 to $3, One-page website About $1, Local service site with a booking form About $2 to start, Business or shop first pass About $2 to $4;
    no price-compare directory.
  - "a bad code, unknown or used, gets 'That code didn't work. Check with Colon.'" (both /api/claim/check and /api/claim).
  - "a manager answer that can't be read gives the template's own plan; Business and Game work the same way; ONBOARDING=0 turns it off".
TESTS: npm test 1835/1836 (onboarding.test.js's browser test included); the 1: domains.test.js IPv6 (EAFNOSUPPORT ::1; this container
  has no IPv6). Browser suites: test/browser/setup.mjs (old Setup, ONBOARDING off) on a phone 33/35; the same 2 fail the same way on office-j20-weekplan
  without this job ("the floor again" after a reload, 20s timeout on this machine). e2e, makers, makers2, mobile, stack: not run (only their boot
  line and one expected message changed).
DEPLOY NOTES: Migration (lane B block): table onboarding_plans. New env: ONBOARDING (on; 0 brings back the old Setup screen). Nothing to run after
  deploy. Only floors with no tasks yet get it; floors already working are unaffected.
RISKS: Start is not a price approval: the estimate line is information only, and nothing waits on it. "Something else" goes to the manager chat (the
  plain message box) and the floor carries on as before. The plan is drafted by one manager call; if it fails or can't be read, a plan from the
  template is used so a new floor is never stuck. At most 6 drafts a floor while it is being set up (going back and changing answers is fine).
  The spec's "Hides: work modes (default: When I ask)": the floor's work mode is left as it is; the plan starts because Start started it. The bad-code
  words name Colon, as the spec has them. The older browser suites (e2e, setup, makers, makers2, mobile, stack) test the old Setup screen, so they boot
  with ONBOARDING off; e2e's bad-code check now looks for the new words. Lane A files touched: public/js/setup-ui.js (5 lines: hand a new floor to
  onboarding), a new public/js/onboard-ui.js on Setup's screen and styles, public/css/extras.css (a few rules), server/app.js (the bad-code words).
