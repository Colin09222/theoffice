STATUS: GREEN
JOB: r2-j62 Weekly floor report
DONE MEANS: "Each boss gets one Monday email with what shipped, visits and one suggestion." (Q13: Mondays 09:00.)
  - server/weeklyreport.js: on Mondays from 09:00 New York, once per floor per week (table weekly_reports): what shipped (projects published in the
    last 7 days, jobs finished), the real visits (Numbers' unique visitors, last 7 days, per launch), and one suggestion: the floor's open proposal
    (r2-j64) if there is one, else a rule from the same numbers (nothing shipped / a launch nobody visited / the most visited). Built by code, no
    model, no money. Sent through engine.mail.send like the alerts.
  - WEEKLY_REPORT_EMAIL ships OFF: nothing built, sent or recorded. It sends only on a Monday for that Monday, so switching it on mid-week sends
    nothing late.
  Proved in test/r2-report.test.js (3 tests, mock Resend, fake clock): nothing at 08:59; at 09:00 each of two bosses gets exactly one email
  (one with "Shipped: Tire finder.", "649 real visits", the most-visited suggestion; one with "nothing new" and the nothing-shipped suggestion);
  none again that day; one the next Monday; none on Tuesday; off sends and records nothing and a Tuesday switch-on sends nothing late; the
  report is built from the records only.
TESTS: every test/r2-*.test.js on the r2-j72 head (this lane's whole stack): 84 of 84 pass, and the files this job touches pass on its own branch.
  npm test (full): last complete run at the r2-j50 code head, 1893 of 1895 (domains.test.js IPv6, which fails on office-r2-base too, and an r2
  test line fixed before any push). Not yet a complete full run on this branch when pushed: the container restarted twice mid-run; the result
  goes in docs/redesign/LANE-R2-B-FINISHED.md. Known in this container: onboarding.test.js's 3-minute browser walk takes 170 to 196 s here and
  fails the same on office-r2-base (193.7 s), so it is the machine, not this lane.
  Browser suites run: npm run e2e:r2-building on the r2-j72 head: all 31 checks pass.
DEPLOY NOTES: New env WEEKLY_REPORT_EMAIL, DEFAULT 0 (off); the orchestrator turns it on after Colon says yes. Migration: new table weekly_reports.
RISKS: A floor with no boss address gets no report (floor 7 until its address is set).
