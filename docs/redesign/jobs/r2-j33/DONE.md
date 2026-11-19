STATUS: GREEN
JOB: r2-j33 Hero crossfade and live dot
DONE MEANS: "A hero card with 3 screenshots fades between them; a Working floor's badge pulses on a phone." (spec Q1: up to 3 real screenshots,
  4 s each, 0.6 s fade, only the card in view animates; phone home: a pulsing dot on the badge of any floor that is Working.)
  - server: /api/building/hero gives each card `shots`, up to 3 real screenshots: the launch photo first (launch_shots), then the newest step
    photos of the same project (job_shots, served by the existing /api/floors/:slug/jobshot/:id). Only photos really taken (server/shots.js heroShots).
  - page: public/js/hero-fade.js. A second <img> layer per hero card, swapped by opacity with a 0.6 s CSS transition; the card's own clock runs
    only while an IntersectionObserver says the card is in view and the tab is visible; never under reduce motion or with fewer than 2 pictures.
    Phone "low" keeps it (Q9).
  - phone dot: public/css/r2b.css pulses the existing Working dot (.badge[data-state=working]::before) at phone width; off under reduce motion.
  Proved in test/r2-hero.test.js (8 tests): the API gives exactly 3 (launch photo first, then the newest step photo) and each address serves a
  picture to a visitor; HERO_FADE=0 gives none; on a fake clock a card in view shows frames 1, 2, 0 at 4, 8, 12 s and holds still out of view;
  reduce motion and a single picture never move; the page wiring and the phone pulse rule.
  Browser (test/browser/r2-building.mjs, run at the r2-j50 head): the Loopling hero card has 3 screenshots and the next one has faded in after
  4 s; on a 390 px phone a Working floor's badge dot runs the r2-pulse animation.
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: no migration. New env HERO_FADE (default on; 0 sends no extra screenshots). New stylesheet public/css/r2b.css (lane B, round 2),
  loaded just before skin.css, which stays last.
RISKS: A launch whose project has no step photos fades between fewer pictures (or none), as the spec says "up to 3". Step photos are of the
  public page only (job 13), so nothing private reaches the hero.
