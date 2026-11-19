STATUS: GREEN
JOB: r2-j43 Event sounds
DONE MEANS: "With sound on, a launch rings one bell and no two sounds play within 2 s." (Q7: room tone at 15%, event sounds at 40%, at most one
  event sound every 2 s, silent when hidden; launch bell, paper thunk, stamp, lift ding.)
  - sound-state.js: the 4 event sounds, each from the building's own small sound set (ring, tab, stamp, ding at their own rates), 40% and 15%,
    and one gate for all event sounds. sfx.js eventSound(kind) plays through the gate; the lift's ding now goes through it too. A room tone (soft
    filtered noise, made in the page, no file) at 15% while a floor's room is open, sound is on and the tab is visible.
  - lobby-ui.js: a launch newer than the page has seen (from the live tower's reading) rings the bell once. The paper thunk and the stamp are
    used by the mailroom (r2-j51, r2-j52).
  Proved in test/r2-sounds.test.js (3 tests): the 4 sounds and the two volumes; the gate passes 0, 2000, 4000, 9000 and drops 500, 1999, 2100,
  3999; the bell's wiring and the hidden/muted rule.
  Browser (r2-building.mjs at the r2-j50 head): with sound on, publishing a launch rang exactly one bell; eventSound at t, t+1.5 s, t+2 s
  played, refused, played.
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: none.
RISKS: "No two sounds within 2 s" is read as event sounds: the small click when someone presses a button (their own tap, as before) is not
  gated. test/r2-sound.test.js's visibilitychange check was updated for the room tone line.
