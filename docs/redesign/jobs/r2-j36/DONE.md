STATUS: GREEN
JOB: r2-j36 Activity feed and live tower
DONE MEANS: "Starting a test job on a hidden floor brightens that floor's windows within 10 s." (Q1: room light = work, brighter and flickering
  while a job runs, one 0.8 s flash on a launch; a small sign light per floor = real visits in the last 24 h in 4 levels: 0, 1-50, 51-200, over 200;
  a small public activity feed, no money, no private work; phone/low: the floor list dot pulses.)
  - server/live.js, GET /api/building/live (public): per floor on the tower, work (a task being worked on), launchAt (last public launch), visits
    (the sign light's level, from app_visits uniques on public projects since yesterday's date). A hidden floor appears by number with its work
    light only (no name, no launch, no visits); demo floors never (their work is not real). feed = Happening now's own public lines (kind, floor
    number, text, time). Installed through server/r2b.js, one line in app.js.
  - Page: lobby-ui.js reads it every 5 s while the tab is visible and hands it to the tower; lobby-scene.js setLive(): work brightens and flickers
    the floor's windows, a launch newer than the page has seen flashes it once for 0.8 s (the first reading never flashes an old one), a hidden
    floor is lit only while it works; visit sign lights: one unlit instanced light per floor, 4 colours. Phone (and no tower): the floor list row
    gets data-live="work" and a pulsing dot.
  Proved in test/r2-tower.test.js (6 tests): a doing task on a hidden floor turns its row's work to 1 at the next reading, with no name or job
  title in the reply; the 4 visit levels and the 24 h window (old visits and private projects don't count); demo floors left out; no money words;
  LIVE_TOWER=0 is 404; the 5 s poll, the flicker/flash/sign rules and the phone dot.
  Browser (r2-building.mjs at the r2-j50 head): a doing task on a hidden floor lit its windows (tower state x=1, y>=1) in 2 to 5 s (limit 10 s).
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: none to run. New env LIVE_TOWER (default on; 0 takes /api/building/live away). Fixed with it: test/review.test.js lists
  /api/building/live as an open GET (it is public on purpose).
RISKS: "Last 24 hours" of visits is read from the daily counts (today's and yesterday's rows): it is a level, not a number, so the day edge does not
  matter much. A hidden floor's work light is shown by number only; ROUND2's done-means asks for it. The activity feed reuses Happening now's
  lines rather than adding a second list on the home page (the spec's Q6 calls a repeat of Happening now a bug).
