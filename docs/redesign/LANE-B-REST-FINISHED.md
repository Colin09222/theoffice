# Lane B, round 1 rest: finished

Built on office-nobudget under the owner's no-budget ruling of 2026-11-19 (docs/redesign/ROUND1-REST.md). Mock mode only; no keys.

21, office-j21-estimate, GREEN, f1c604c19405aff69f8bbb6774ce5588b9c7dce3
20, office-j20-weekplan, GREEN, 370ba5f059318674c04f88e2bb2f928f18a57c62
23, office-j23-onboarding, GREEN, e41f7c544674bc59b7f8eb7b4828457a430d4e99
25, office-j25-scorecard, GREEN, (this branch; the commit before this file: f7a743a842d44634b76b11cfec0df0366a3982c4)

The one test failing on every branch is domains.test.js's IPv6 test (this container has no IPv6; it fails the same on office-nobudget).
New switches, all on by default: JOB_ESTIMATES, WEEKLY_PLAN (with WEEKLY_PLAN_AUTOSTART_HOURS, 24), ONBOARDING, IDEA_SCORECARD.
After deploy: node scripts/admin.mjs plan --floor 6 off (TheTireRx, upkeep only until 2026-12-03).
No forbidden spend limit from round 1 is still active (j21 DONE.md, RISKS).
