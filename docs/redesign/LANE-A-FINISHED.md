# Lane A finished

One line per job: NN, branch, STATUS, head SHA (the job's DONE.md commit). Each branch is stacked on the one above it, the first on
office-redesign-base. Full details, deploy notes and risks are in docs/redesign/jobs/jNN/DONE.md.

| NN | Branch | Status | Head SHA |
|---|---|---|---|
| 01 | office-j01-skin | GREEN | 7abb70891e08824473b58dd9fc9eacc94d75eef4 |
| 02 | office-j02-quiet | GREEN | 9dade158d7cfb437e105cde42f91430613361e43 |
| 03 | office-j03-shots | GREEN | adc3ec34e111a717bad5613ff1fe6ae16eb9fa0e |
| 12 | office-j12-status | GREEN | 40f2b52b75042abc4f99e3dc553b0454c3b8fab4 |
| 13 | office-j13-timeline | GREEN | 32f392a544cbedf8ee52f470bcd06bb8d54aef0e |
| 14 | office-j14-home | GREEN | d2dd608b688257234210eba6ce2f03799d618ede |
| 15 | office-j15-card | GREEN | 7b7fef358362ee4bd9f94deed1e0b121da1995e5 |
| 16 | office-j16-phone | GREEN | d600084c71650d869cb451273d0b3b2ce892777b |
| 22 | office-j22-biztab | GREEN | af0370c623bb40d713bfd86dc6e6c2d84f9a8096 |
| 24 | office-j24-portfolio | GREEN | b5241e0e72a72734cee5c085879ff2a0589aef71 |

Across the lane (for the orchestrator):
- npm test on every branch: all pass except test/domains.test.js "...over IPv4" (this build machine has no IPv6; it fails the same on
  office-redesign-base). j03 and j24 each saw one load-related flake that passes on re-run (noted in their DONE.md).
- Migrations (one `// redesign lane A` block in server/db.js, CREATE TABLE IF NOT EXISTS only): launch_shots (j03), job_cards and
  quiet_messages (j12), job_shots (j13).
- Env switches, default = the redesign: DEMO_FLOORS_PUBLIC, PUBLIC_HOURS, BANTER_LINES (j02); SHOTS, SHOTS_EVERY_MS, SHOTS_CDP_URL,
  SHOTS_CHROME, SHOTS_ORIGIN (j03), SHOTS_NUDGE_MS (j13); STATUS_FROM_CODE, JOB_CARDS (j12). All listed in .env.example.
- After deploy: run scripts/launch-shots.mjs --all once in the office-runner/browser image (exact command in jobs/j03/DONE.md), and give the
  server a browser at SHOTS_CDP_URL (or a daily cron of the same command) for the 7-day refresh and the timeline's step photos.
- Lane B's files touched: server/engine.js, two small places (managerSays's quiet option and its one caller, j12); server/people.js (banter,
  meeting) is lane A's talk. config.js / app.js / .env.example got additive lines.
- Browser suites that assert the old look (e2e.mjs lobby steps, tower.mjs, polish.mjs, mobile.mjs, modes.mjs, chat.mjs, floors.mjs) were not
  run and need updating to the redesign; the new ones are test/browser/redesign-shots.mjs, home.mjs (e2e:home), phone.mjs (e2e:phone),
  biztab.mjs (e2e:biztab).
- Screenshots committed with jobs 1 to 13 took their phone "visitor" pictures with the boss's cookie still in the browser (fixed in the
  harness from job 14 on; jobs 14 to 24 have true visitor pictures).
