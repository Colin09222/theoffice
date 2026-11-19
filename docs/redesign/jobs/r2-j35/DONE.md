STATUS: GREEN
JOB: r2-j35 Real New York light
DONE MEANS: "With the clock set to 23:30 New York, all room lights are off and the crown sign is lit." (Q2: New York time for everyone; sunrise and
  sunset by formula, no feed; dawn, day, golden hour = the last 60 minutes before sunset, night; 20-minute blends; read once a minute; 23:00 to
  08:00 room lights and desk lamps off on every floor; the crown sign, billboard, street lights and visit sign lights stay on.)
  - public/js/nylight.js: New York wall time by Intl (America/New_York), sunrise and sunset by the almanac formula for City Hall (within 3 minutes
    of published times), the 4 looks with 20-minute blends (10 either side of each boundary), the colour palette per look, lightsOnAt 08:00-23:00,
    and a clock that re-reads once a minute.
  - Tower (lobby-scene.js): one shared sky tint (sky, water and the glass's reflections), sun, hemisphere and fill lights and the exposure follow the
    look; one shared ROOM_LIGHTS uniform turns every floor's window lights off 23:00-08:00 (the floor's own colour stays on its spandrel). The crown
    sign is an unlit material on no switch. New street lights round the plaza (there were none) glow with the dark and stay on all night.
    Low tier: colour change only, no lamp glow (Q9).
  - Room: lane B's one hook in lane A's office-scene.js, setRoomLights(on, look) (hemisphere light and exposure down when off, sun scaled to the
    hour), called once a minute by lane B's public/js/room-light.js. Lane A's file changed in 4 small places (one import, the hemisphere light kept
    as this.hemi, one line in update(), the hook itself); nothing else.
  Proved in test/r2-light.test.js (8 tests): 23:30 New York (EST and EDT) lights off, 08:00 on, 22:59 on; sunrise/sunset for 21 June, 21 December
  and 19 November within 3 minutes; the phase at each time of day; blends halfway at a boundary and whole 10 minutes either side, weights summing
  to 1 all day; read once a minute; the tower's switch, the unswitched crown sign and street lights; the room hook.
  Browser (r2-building.mjs at the r2-j50 head): with the page clock at 23:30 New York, lightsOn false, crown sign lit, night; at noon, day, lights on.
TESTS: npm test (full) at the r2-j37 head, before the stack was rebuilt: 1877 of 1881 pass. The 4 failures, each dealt with:
  domains.test.js IPv6 (this container has no IPv6; it fails the same on office-r2-base); launch.test.js claim 408 (a timeout while a browser suite
  ran alongside; passes alone); test/review.test.js route sweep (my new public addresses were not yet listed as open: fixed in r2-j36 and r2-j49);
  test/skin.test.js "skin.css last" (fixed in r2-j33: r2b.css now loads just before skin.css). Then, on the rebuilt stack: review, skin, launch,
  home, happening, shots and every test/r2-*.test.js: 168 run, all pass after the r2-j36 test line was loosened for r2-j50's extra poll.
  The full run on the rebuilt r2-j50 head was still running when this was pushed; its result goes in docs/redesign/LANE-R2-B-FINISHED.md.
  Browser suites run: npm run e2e:r2-building (test/browser/r2-building.mjs, new), at the r2-j50 head: every check passes.
DEPLOY NOTES: none. No migration, no env.
RISKS: The room's warm light pools under the desk lamps are painted into the floor texture by lane A's code; at night the room is darker
  (hemisphere light and exposure) but those painted pools stay. Repainting them is a lane A change, left alone. The visit sign lights (r2-j36) and
  the billboard (r2-j37) are on no switch either.
