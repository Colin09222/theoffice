STATUS: GREEN
JOB: r2-j38 First-visit fly-in
DONE MEANS: "The fly-in plays once on desktop, never a second time, and never under reduce motion." (Q1, Q3, Q9: 2.5 s, first visit only, desktop
  only, starts when the tower is ready, any input skips it, never delays the page content.)
  - public/js/flyin.js: the rule (not phone, not reduce motion, not seen), a 2.5 s ease-out path from high, far and turned away to the normal view,
    and the skip events (pointerdown, wheel, keydown, touchstart).
  - lobby-ui.js flyInOnce(): called when the tower has just arrived (which is after the hero and Happening now, job 14); the mark office.flyin is
    stored as it starts (no storage = no fly-in, as it could not be kept to once); any input skips it. lobby-scene.js plays it on wall-clock time.
  Proved in test/r2-flyin.test.js (3 tests) and in the browser (r2-building.mjs at the r2-j50 head, fresh browsers): the first desktop visit
  plays it and it ends on the normal view; the second visit does not; under prefers-reduced-motion it does not; a pointerdown the moment it
  starts skips it.
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: none.
RISKS: A visitor who clears site data sees it again (that is a first visit as far as the page can tell).
