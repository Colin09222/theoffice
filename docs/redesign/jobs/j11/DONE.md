STATUS: GREEN
JOB: 11 Smoke check, Tester skip
DONE MEANS: "An edit to a live site ships with a script check and no Tester call."
  server/smoke.js, proved in test/smoke.test.js:
  - "an edit to a live site ships with a script check and no Tester call": a small Builder job on a live site publishes; the smoke check runs after
    the publish (smoke_checks row: ok, 200, no errors; tasks.smoke_id points to it); the manager's Tester behind it is refused; zero Tester calls.
  - "in a real browser it catches a console error and saves a 16:10 screenshot to the job" (Playwright's Chromium, 1280x800 JPEG at
    projects/<slug>/notes/shots/smoke-<task>.jpg on the floor's drive; the manager gets a note and is woken when it fails). Ran here.
  - "without a browser: a missing script fails, a fine page passes" (the HTTP fallback). The check sends a bot user agent (Headless Chrome says so
    itself), so it is never counted as a visit. Private projects are not checked, and the result event is the boss's only.
  - "an edit that touches a form gets one Tester pass, and only one" (paying, basket, cart, payments, forms, booking, sign-in, sign-up, account, password).
  - "the Tester gets a computer only for games and shops" (lane game or shop, a game project, or a project with shop products).
TESTS: npm test 1736/1739 on this branch before its last test fixes. The 3: domains.test.js IPv6 (EAFNOSUPPORT ::1; fails the same on
  office-redesign-base, this container has no IPv6) and two workers.test.js tests fixed in the commits after it (job 10's fix-round cap lifted in a
  MAX_REVISIONS test; a Tester given a computer as before in the two-computers test; workers.test.js 42/42 after). Changed older tests where the Tester
  needs a computer for what they test (computer.test.js, budget.test.js, unlimited.test.js, workers.test.js: TESTER_COMPUTER_GAMES_SHOPS=0 there).
  Browser: smoke.test.js's browser case ran here with Playwright's Chromium (pass). No browser suite in test/browser covers this job; not run.
DEPLOY NOTES: Migration (lane B block): table smoke_checks, tasks.smoke_id. New env (default on): SMOKE_CHECK, SMOKE_BROWSER, EDIT_SKIPS_TESTER,
  TESTER_COMPUTER_GAMES_SHOPS. The browser check needs Playwright and Chromium where the server runs; the Office's Docker image has neither today,
  so on live it runs the HTTP check (page loads with 200, its own scripts and styles load) with no screenshot until
  Playwright is added to the image (or lane A's job 3 screenshot runner is reused). Where it runs, the check opens PUBLIC_ORIGIN + the site's path
  (or the domain / app origin).
RISKS: Without a browser there is no console and no screenshot, so runtime errors are not caught on live until Playwright is in the image (above).
  "Touches checkout, forms or sign-in" is read from the edit's own title, brief and request line. Section 8: Tester share of spend falls because
  edits (most of floor 7's $23 of testing) no longer get a Tester.
