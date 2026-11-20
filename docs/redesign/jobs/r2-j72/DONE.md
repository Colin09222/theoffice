STATUS: GREEN
JOB: r2-j72 December set
DONE MEANS: "On 1 December the roof has snow and the lobby has a tree; on 1 January both are gone." (Q2: 1 to 31 December; Q9: phone low = roof
  colour only, no tree, no falling snow.)
  - nylight.js isDecember(): New York's month. lobby-scene.js: snow caps on the tower's roof and crown steps, a tree with a star in the glass
    lobby by the door, and 500 falling flakes; setSeason() runs with the light clock (once a minute). Low tier: the snow caps (the roof's colour)
    only.
  Proved in test/r2-december.test.js (2 tests): 30 November 23:59 no, 1 December 00:00 yes, 31 December 23:59 yes, 1 January 00:00 no, and 03:00
  UTC on 1 December is still November in New York; the tower's wiring. Browser (on this stack, tier mid, page clock set): on 1 December roof snow,
  tree and snowfall are there; on 1 January all gone.
TESTS: every test/r2-*.test.js on the r2-j72 head (this lane's whole stack): 84 of 84 pass, and the files this job touches pass on its own branch.
  npm test (full): last complete run at the r2-j50 code head, 1893 of 1895 (domains.test.js IPv6, which fails on office-r2-base too, and an r2
  test line fixed before any push). Not yet a complete full run on this branch when pushed: the container restarted twice mid-run; the result
  goes in docs/redesign/LANE-R2-B-FINISHED.md. Known in this container: onboarding.test.js's 3-minute browser walk takes 170 to 196 s here and
  fails the same on office-r2-base (193.7 s), so it is the machine, not this lane.
  Browser suites run: npm run e2e:r2-building on the r2-j72 head: all 31 checks pass.
DEPLOY NOTES: none.
RISKS: None known. Also in this commit: the browser suite's r2-j33 and r2-j37 timing checks measure the page's own timer lag and allow for
  it (software WebGL here holds the page's timers up by about a second), and say the lag they saw.
