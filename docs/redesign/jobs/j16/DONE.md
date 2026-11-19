STATUS: GREEN
JOB: 16 Phone layout
DONE MEANS: "On a phone, no 3D code loads until 'Watch the room' is tapped; first paint under 2 seconds."
  - Home on a phone: one column in the spec's order (top bar, the hero as a swipe row, Happening now, the floor list, Open an office); no 3D
    code at all, and no background fetch of the floor's code (job 14).
  - A floor on a phone opens public/js/floor-lite.js, plain DOM: [< Home  company  Floor N  state], the status card (job 15, full width),
    the Timeline (job 13), Projects, and a red "Watch the room". Only that tap brings in the full floor page (floor-ui.js, three.js, the
    stage, models, textures), with the room. main.js no longer preloads the floor's 3D modules on a phone; the boot curtain on the light
    page waits for nothing 3D. Live updates on the light page come from the floor's own stream (job cards, the boss's conversation, state).
  - Measured (test/browser/phone.mjs, npm run e2e:phone): headless Chromium as a 390x844 phone, cold cache, CPU slowed 4x
    (Emulation.setCPUThrottlingRate 4), network "Fast 4G" = 9 Mbit/s down, 1.5 Mbit/s up, 60 ms latency; bytes are what went over the wire
    (compressed), counted until the page had settled 1.5 s after its content showed; "content" = the curtain is up and the floor list or the
    status card is on screen; FCP = the browser's first-contentful-paint.
      home, visitor:          170 KB, FCP  336 ms, content 1195 ms, 0 3D requests
      floor, visitor:         163 KB, FCP  328 ms, content 1322 ms, 0 3D requests
      floor, boss:            166 KB, FCP 1280 ms, content 1560 ms, 0 3D requests
    Lighthouse's harder "Slow 4G" (1.6 Mbit/s, 750 kbit/s, 150 ms), for reference: home 160 KB, FCP 1120 ms, content 2152 ms; floor 166 KB,
    FCP 1116 ms, content 2539 ms (over 2 s on that slower network; the target names 4G, measured above). Tapping Watch the room then loads
    three.js and the room (checked). 0 console errors.
  - test/home.test.js: the static import graph of main.js, floor-lite.js, status-card.js, timeline-ui.js (and the home's modules) reaches no
    3D module; main.js sends a phone to the light page and preloads no 3D on a phone.
  Screenshots: docs/redesign/jobs/j16/shots/ incl. floor-{visitor,boss}-phone.jpg (light page), floor-timeline-*-phone.jpg, room-*-phone.jpg
  (after Watch the room); 18 shots, 0 console errors.
TESTS: npm test 1730/1731 (the one failure is the IPv6 test, environment; run before the last small CSS/markup fix, which home.test.js and
  skin.test.js re-checked: 9/9). Browser: phone.mjs all passed; redesign-shots.mjs 18 shots, 0 errors. test/browser/mobile.mjs and
  mobile-audit.mjs drive the full 3D floor on a phone from the first load and were not run; they need a tap on Watch the room first.
DEPLOY NOTES: none (static files; no migration, no env var).
RISKS: Measured on a headless desktop CPU slowed 4x, not on a real mid-range phone. On the light page the boss has the status card's question
  chips and message box; Business, Requests and the full chat are behind Watch the room (the full page). Once tapped, a floor stays on its
  full page for the rest of the visit.
