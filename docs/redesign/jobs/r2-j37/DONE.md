STATUS: GREEN
JOB: r2-j37 Crown billboard
DONE MEANS: "The tower crown cycles the 3 hero screenshots every 6 s." (Q6: 3 launches, 6 s each, 0.6 s fade, one 512 by 320 image each; fed from
  the same list as the hero; not shown on low or a phone, Q9.)
  - public/js/billboard.js: the pictures are the hero list's (billboardImages, 3 at most, the hero's own order), a pure frame function (6 s each,
    a 0.6 s fade in the last 0.6 s), and a 512 x 320 canvas that is repainted only while a picture changes.
  - lobby-scene.js: one billboard on each face of the crown's second step, keeping 512:320; setBillboard(urls) loads the pictures before showing
    them; hidden on the low tier. lobby-ui.js feeds it the hero list it already fetched, so the two can never disagree.
  Proved in test/r2-billboard.test.js (4 tests): 512, 320, 6000, 600, 3; the order and the cap; index and fade at 0, 5.4, 5.7, 6, 12 and 18 s;
  the wiring (hero list, hidden on low, draws only on change).
  Browser (r2-building.mjs at the r2-j50 head, tier mid): the billboard has the 3 hero pictures at 512 x 320, and sampled in the page it moves to
  the next one every 6 s.
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: none.
RISKS: The ticker band (Q6 b) is not built, as the spec says. On a Friday the featured floor's launches replace the hero list (r2-j68).
