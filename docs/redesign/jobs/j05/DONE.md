STATUS: GREEN
JOB: 05 Budget check in the server
DONE MEANS: "The server writes a spend record every 2 hours without any outside session."
  server/spendcheck.js: a timer inside the Node server (started with the engine like daily.js's tick) wakes every minute and writes a row to
  spend_records when the last one is 2 hours old. It reads SQLite directly (the ledger) and calls nothing outside the process.
  Each record: per pot (anthropic, openrouter) spentUsd / capUsd / leftUsd / percent; per floor weekUsd (since Monday 00:00 New York), yesterdayUsd
  (the New York calendar day before), and the week split by pot. Demo floors that spent nothing are left out; domains count towards neither pot.
  Proved in test/spendcheck.test.js:
  - "a record has both pots and each floor's week and yesterday, counted in New York time" (Sunday-night, Monday, yesterday and today boundaries).
  - "the timer writes one record every two hours, and a restart neither skips one nor writes two"; SPEND_CHECK=0 writes nothing.
  - "the admin sees the records and when the last was written; past 3 hours it shows as stale" ("Costs last updated 3h ago ... STALE").
  - "the running server writes a record with no outside session, and the admin reads it over HTTP and the CLI".
TESTS: npm test 1705/1706. The 1 failure is domains.test.js "the key only travels over TLS, in the body, and over IPv4" (EAFNOSUPPORT ::1:
  this container has no IPv6; fails the same on office-redesign-base). Browser suites: none touch this job; not run.
DEPLOY NOTES: Migration (lane B block in db.js): table spend_records. New env: SPEND_CHECK (default on; 0 stops the timer),
  SPEND_CHECK_EVERY_MIN (default 120). The server writes the first record within a minute of starting.
  Admin: node scripts/admin.mjs spend [--last N] [--json] lists the records and says "Costs last updated Nh ago" (STALE past 3 hours);
  node scripts/admin.mjs spend write writes one now; GET /api/admin/spend (admin cookie) returns the same, with stale and ageMinutes.
  The outside scheduled budget check can be retired once job 6 is deployed too (job 6's DONE.md lists exactly what the server does).
RISKS: "This week" starts Monday 00:00 America/New_York and "yesterday" is the New York calendar day, to match the Monday plan and the 08:05
  digest; the old ledger "day" column is UTC and is not used here. The record lists every floor that has spent anything ever (so a floor with
  $0 this week still shows). Section 8: no measure moves directly; it feeds job 6's alerts and digest.
