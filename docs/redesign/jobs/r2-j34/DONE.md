STATUS: GREEN
JOB: r2-j34 Sound off by default
DONE MEANS: "A first-time visitor hears nothing until they turn sound on." (Q7: off by default, the choice is remembered, silent when the tab is hidden.)
  - public/js/sound-state.js holds the rules; public/js/sfx.js uses them. The page starts muted before it reads anything; only a stored "on"
    ('0' under the old key office.muted, so an earlier choice still holds) starts with sound. No storage or a storage error: off.
  - Every sound goes through sfx(), which plays nothing while muted or while document.hidden; a hidden tab also suspends the AudioContext,
    resumed when the tab is seen again and only if sound is on. Turning sound on stores '0' and wakes the sound system.
  Proved in test/r2-sound.test.js (3 tests): a first visit (nothing stored, '' , '1', junk, private mode) starts off; the choice is stored and a
  stored "on" starts on; nothing plays muted or hidden; no file other than sfx.js makes a sound.
  Browser (r2-building.mjs at the r2-j50 head): a first-time visitor's sound button is pressed = off (aria-pressed true).
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: none. No env switch: this changes nothing a floor does, only what a visitor's browser plays.
RISKS: Visitors who never pressed the button before (the old default was on) now start with sound off, as the spec asks.
