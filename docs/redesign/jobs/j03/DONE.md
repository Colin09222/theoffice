STATUS: GREEN
JOB: 03 Real launch cards
DONE MEANS: "All 6 launches show a real screenshot on the Launched page and 3 show on the home hero."
  - Tier 0, no model: server/shooter.js drives a headless Chromium over the DevTools protocol (no npm package), opens a launch's public live
    page at 1280x800, waits for load + 1.5 s, and keeps a 640x400 JPEG (16:10, quality 72; 3 to 60 KB in tests). It never starts a process
    itself (test/security.test.js forbids child_process in server/): it talks to a running Chromium at SHOTS_CDP_URL. scripts/chrome.mjs
    starts one for the command-line script and the tests.
  - Stored with the project: table launch_shots (redesign lane A block in server/db.js). server/shots.js: launches() lists public launches
    (published, not private, active listed non-demo floors), marks work in progress (a maker job or business journey for it, not launched and
    not stopped), counts visits as the Numbers tab does (app_visits uniques, last 7 days). dueShots(): missing or older than 7 days; a failed
    page waits 6 h. A server timer (SHOTS_EVERY_MS, hourly) takes what is due when it can reach a browser.
  - /api/building/launched: every card's thumb is the real screenshot (/api/building/shot/<floor>/<project>?v=<taken_at>) when there is one,
    else the old og:image or coloured initial card; plus visits, wip, madeDays, shot. /api/building/hero: the 3 best (most visits/plays in 7
    days, ties to the newest, never WIP, never demo). The Launched wall and the home hero use one launch card component (public/js/launch-card.js):
    16:10 screenshot, name, one line, "N plays/visits this week", "Made by floor N in X days", one button (Play/Visit).
  - Proof: test/shots.test.js "a real Chromium photographs all six launches, the wall shows six photos and the hero three" (six fixture
    launches on six floors, real headless Chromium, 640x400 JPEG checked from its SOF marker); "the hero: most real visits or plays in the
    last 7 days, ties to the newest, three at most"; "the wall: ... work in progress marked; demo floors, private work and drafts left out";
    "due when missing or 7 days old; a failure waits; ..."; "the server timer takes what is due by itself when it can reach a browser".
  - Visits: bots (existing UA filter: bot, crawl, headless, curl...), the floor's own boss and the admin are not counted on the office's own
    origin (/theoffice/f/...). The photographer's HeadlessChrome is never counted. NOT excluded: the boss or Colon visiting the project on its
    own origin or own domain (no office cookie is sent there by design), and bots with an ordinary browser user agent.
  Screenshots: docs/redesign/jobs/j03/shots/ (home with the hero of 3 real screenshots, the Launched wall, floors; 0 console errors).
TESTS: npm test 1710/1713. Failures: test/domains.test.js IPv6 (no IPv6 in this container, as before); test/googleads.test.js and
  test/business.test.js date-window tests ("ends within 7 days", run at 00:00 UTC): both files pass 34/34 on re-run at 05:03 UTC, a
  midnight-boundary flake in code this job does not touch. Changed tests: building.test.js (launch card fields), review.test.js (two new
  open routes in the route sweep). Browser: test/browser/redesign-shots.mjs (10 shots, 0 console errors).
DEPLOY NOTES:
  - Migration: new table launch_shots (CREATE TABLE IF NOT EXISTS, runs on start). No data changed.
  - New env vars (all optional): SHOTS (default on; 0 stops the timer), SHOTS_EVERY_MS (3600000), SHOTS_CDP_URL (unset: the timer does nothing),
    SHOTS_CHROME (script only), SHOTS_ORIGIN (default http://127.0.0.1:PORT, for /theoffice/f/... paths; live launches use their own origins).
  - Run once after deploy, from the folder with docker-compose.yml and data/ (the office image has no browser; the runner's browser image does):
      docker run --rm --network host --user "$(stat -c %u:%g data/office.db)" -e HOME=/tmp -e DATA_DIR=/data \
        -e APPS_BASE_DOMAIN="$(sed -n 's/^APPS_BASE_DOMAIN=//p' .env)" -e PUBLIC_ORIGIN="$(sed -n 's/^PUBLIC_ORIGIN=//p' .env)" \
        -v "$PWD/data:/data" -v "$PWD:/app:ro" -w /app office-runner/browser:pw1.65.0 node scripts/launch-shots.mjs --all
    then `... node scripts/launch-shots.mjs --list` shows each launch, visits, and its photo time. Expect 6 "ok" lines.
  - For the 7-day refresh, either put the same command (without --all) in the host's crontab daily, or give the server a browser: a second
    compose service from office-runner/browser:pw1.65.0 running headless_shell with --remote-debugging-address=0.0.0.0
    --remote-debugging-port=9222 --no-sandbox on the compose network (no published port), and SHOTS_CDP_URL=http://<that service>:9222 in .env.
    Not set up here: the orchestrator's choice.
RISKS: Work-in-progress detection uses maker_jobs / business_journeys rows; a live launch with an open, never-launched maker job would be
  marked WIP and kept off the hero (check `launch-shots.mjs --list` after deploy: it prints launched vs work in progress). A page that needs
  more than ~1.5 s after load to draw (big games) may be photographed half drawn; the next 7-day refresh retakes it. Visits from the boss on
  a project's own origin still count (see above). The docker command was not run here (no Docker in this container); the script itself was
  run against a scratch database and a real Chromium.
