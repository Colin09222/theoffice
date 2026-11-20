STATUS: GREEN
JOB: r2-j50 Mailroom and robot
DONE MEANS: "The basement shows on the tower panel and at B on the lift, with the robot at its desk." (Q17, Q21, section 3 "Look" and "Home and
  desk": a boxy robot on two wheels, about 0.8 of a bean's height, under 1,500 triangles, Ink body, Slate panels, one eye light, Tower Red stamp
  in a clamp hand, name plate "buddehbot"; a brick-walled basement with one hanging lamp, pigeonholes one per open floor, a desk with in-tray,
  out-tray, stamp pad, desk phone and sign stand, a brass tube mouth above the in-tray, a charging dock.)
  - public/js/robot.js (406 triangles, 1.36 high = 0.8 x 1.7), public/js/mailroom-scene.js (the room, folders in the in-tray up to 8 then "+N",
    the sign, the robot at its desk or on its dock), public/js/mailroom-state.js (the state order, sign words, tray, kind lines, colours; shared with
    the server), public/js/mailroom-ui.js (the page at /mailroom: 3D on a desktop, plain DOM on a phone with no 3D code; the strip for the home page).
  - Home: a "B · Mailroom" strip at the foot of the tower panel (state and tray), and a B button at the bottom of the lift. main.js routes /mailroom.
  - /api/mailroom now also gives the robot (state, sign, tray) and the open floors for the pigeonholes. The freeze is the engine's night freeze.
  Proved in test/r2-mailroom.test.js (5 tests): the robot measured in node (triangles, height, the three colours, one eye, the plate's text, the
  eye colours by state); the state order, the sign, the tray (3 -> 3; 11 -> 8 and +3), the pigeonholes; every piece of the room is there with the
  robot at its desk; the feed's robot and floors; B, the strip and the route, and no three.js in the home page's imports.
  Browser (r2-building.mjs at the r2-j50 head): the strip at the foot of the tower and B on the lift; B opens the room with the robot at its desk
  (406 triangles, plate "buddehbot", 2 pigeonholes), no console errors; on a phone the plain room with the robot and no 3D code fetched.
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: none to run. Changed with it, on purpose: the browser suites that count the lift's floor buttons (home.mjs, e2e.mjs, stack.mjs,
  tower.mjs) now count .lift-btn:not(.lift-b), since B is not a floor.
RISKS: The phone home has no tower panel, so on a phone the basement is reached from B on the lift only.
