STATUS: GREEN
JOB: 08 Small gaps
DONE MEANS: "Floor 7 has a boss email and a test form alert arrives; 'not allowed' errors are logged with user and action."
  (a) Boss email: there was no admin command to set it (only the boss's own settings form). New: node scripts/admin.mjs mail boss-email --floor N
      reads the address from stdin (so it stays out of the shell history), refuses a malformed one or one in the building's own mail domain, and
      prints it masked; --clear removes it. No address is in code; tests use the reserved boss@home.example.
      Proved: mail.test.js "a boss email set by the building manager (floor 7 had none) makes a form entry send one alert": no address, no alert;
      setBossEmail, then one form entry, one alert; and the admin CLI test sets, masks and clears it.
  (b) Every 403 (not allowed) and 423 (closed) a signed-in boss or the admin gets is kept in denied_requests: user ("boss of floor N (session
      abcd1234)" or "admin"), floor, action (method and route pattern), status and code, time; plus a warn line in the server log. Visitors with no
      session are not logged. No token is kept. Listed by node scripts/admin.mjs denied --since 24h [--json] and GET /api/admin/denied?hours=N.
      Proved: denied.test.js "a boss refused on another floor, or with a stale token, is logged with user, floor, action and time; a visitor is not"
      and "the admin lists them with admin.mjs denied --since".
  What I found for floor 7's "not allowed": the page keeps the CSRF token from /api/me in memory. When the boss signs in again in the same browser
  (another tab, or after a pause), the cookie becomes the new session's but an open tab still sends the old session's token, so every change comes
  back 403 bad_csrf, which the page shows as "That isn't yours to change." The test reproduces exactly that. Fix (public/js/dom.js, lane A's file,
  4 lines): on 403 bad_csrf the page fetches the current token once and retries. If it was something else, the denied log now says what.
TESTS: npm test 1715/1723. The 8: 3 that fail the same on office-redesign-base in this container (domains.test.js IPv6; googleads.test.js and
  business.test.js "ends within 7 days", date-dependent) and 5 from job 7's $5 default in unlimited.test.js, fixed on the job 7 branch (this branch
  is rebased on it; unlimited.test.js 69/69). Browser suites: not run (the dom.js retry is 3 lines; no browser suite covers a second sign-in).
DEPLOY NOTES: Migration (lane B block): table denied_requests (capped at the last 5,000 rows). After deploy, set floor 7's boss email on live:
  echo '<her address>' | docker compose exec -T theoffice node scripts/admin.mjs mail boss-email --floor 7
  then node scripts/admin.mjs mail form-alerts --floor 7 to see it masked. Read refusals with node scripts/admin.mjs denied --since 7d.
RISKS: The CSRF cause is the most likely one, not proven on live; the log will show it if it happens again. public/js/dom.js is lane A's file
  (a 4-line change in api()). Section 8: no measure moves directly.
