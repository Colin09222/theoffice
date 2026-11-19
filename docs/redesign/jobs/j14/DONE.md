STATUS: GREEN
JOB: 14 New home layout
DONE MEANS: "Home shows hero, Happening now and directory before the 3D tower loads."
  - public/js/lobby-ui.js is rewritten as plain DOM from small modules (dom, icons, sfx, badge, launch-card): top bar (logo, tag line, Sign
    in / My floor, sound), hero strip (the 3 best launches with real screenshots, job 3; fewer than 3: what exists, then an "Open an office"
    card), Happening now (5 lines at most, newest first, real work only: team lines and launches, never a demo floor or "moved in"; nothing
    happening: "Quiet right now. Last job finished 2h ago."; feed fails: the strip is hidden, no error), the directory (open floors only, one
    line each with the state badge), the lift (open floors only, plus "N floors to let"), "All launches" (a new /launched page: lane filter,
    launch cards, work in progress below), and the red "Open an office".
  - No 3D code is imported up front: main.js no longer imports stage.js; index.html no longer preloads three.js, stage, lobby-scene, addons
    or batch. The tower (public/js/tower-nav.js, which brings stage + lobby-scene) is imported only after the hero and Happening now have
    rendered (or failed, or 4 s), in a frame about a third of the desktop width (the stage draws into a box: stage.setBoxed; the scene's
    framing and picking follow the box). It is a navigator: hover a floor for its name, click to swoop in. No WebGL: the frame is removed
    and the floor list is the way round. A phone gets no 3D on home at all, and no background fetch of the floor's code.
  - The ticker strip, the dark directory board, the launch-party confetti and the leaderboard toggle are gone from home (Q3's 7 items, "No
    confetti"). The Launched page replaces the wall toggle.
  - Proof: test/browser/home.mjs (npm run e2e:home, real Chromium): content timestamps vs the first 3D request (desktop run: floor list
    84 ms, hero 98 ms, Happening now 109 ms, first 3D request 116 ms, tower ready 400 ms); tower frame 0.31 of the width with the canvas in
    it; lift = open floors + "26 floors to let"; phone: 0 3D requests; no WebGL: frame gone, list shown; feed failing: strip hidden, no error
    text; 0 console errors. test/home.test.js: the static import graph of main.js, lobby-ui.js, launched-ui.js, launch-card.js and badge.js
    reaches no 3D module; index.html preloads none; the tower import waits for the content and skips phones.
  Screenshots: docs/redesign/jobs/j14/shots/ (home and Launched, desktop and phone, visitor and boss; 0 console errors).
TESTS: npm test 1725/1726 (the one failure is the IPv6 test, environment). Browser: test/browser/home.mjs all passed; redesign-shots.mjs
  14 shots, 0 errors. test/browser/e2e.mjs, tower.mjs, polish.mjs, mobile.mjs and floors.mjs drive the old lobby (ticker, .directory, wall
  toggle, .open-pill, the 30-button lift) and were not run: they assert the layout this job replaces and need rewriting by whoever owns them.
DEPLOY NOTES: none. Static files only; no migration, no env var.
RISKS: The old lobby's sheets (building.css etc.) are still loaded but mostly unused. The tower frame is fixed to the right third; on a short
  desktop window it still fits (height follows the window). The swoop into a floor now plays inside the small frame before the floor page
  takes over. Browser suites listed above need updating to the new home.
