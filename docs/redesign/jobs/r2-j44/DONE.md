STATUS: GREEN
JOB: r2-j44 Phone hard budget
DONE MEANS: "The phone room stays under 60,000 triangles and 2 MB of 3D files." Proved:
  - Browser (room-r2.mjs j44, a 390x844 phone at 2x with a phone user agent and touch, cache off): the phone room after "Watch the room" and its
    furniture: 58,765 visible triangles (it was 107,823 before this job: the city around the floor was 48k of it); the budget fitter shed the city,
    the land and shore, and the water and tower stub under the room. 3D files: 1.81 MB uncompressed (decodedBodySize) over 70 files (three.js, the
    addons, the room's scripts, furniture models), under 2 MB. At most 30 frames drawn a second; pixel ratio 1 on this machine's low tier, and on the
    top tier (?q=high) the same 2x phone draws at 1.5, not 2; 0 shadow-casting lights on low (the room's one sun on mid/high). No page errors.
    Picture: r2-j44-phone.jpg.
  - test/r2-room.test.js "the numbers are the spec's" (PHONE_BUDGET = 30 fps, 1.5, 1 shadow light, 60,000, 2 MB); "the frame cap holds a 60 Hz and
    a 120 Hz screen to 30 frames a second" (skipFrame on a fake clock: 295 to 301 frames in 10 s; no cap lets all 61 through; phoneDpr caps 2 to 1.5);
    "shedding goes in order and stops as soon as the room fits" (shedPlan).
How it works: stage.js (phones only) caps drawing at 30 fps and the pixel ratio at 1.5 on every tier (?budget=0 lifts both, for comparing).
  office-scene.js fitBudget(), on entering the room and again when the furniture arrives: puts every sheddable part back, counts visible triangles,
  then sheds in order until under 60,000: city blocks with traffic and boats; land and far shore; water and the tower stub under the room; small
  props; the offices' furniture models. Desks, people and the room never go. The shared city is restored on leaving.
TESTS: node --test test/r2-room.test.js 26/26 at this commit. The full npm test on this stack is reported in LANE-R2-A-FINISHED.md.
  Browser: room-r2.mjs j44 all passed.
DEPLOY NOTES: No migration. New env PHONE_BUDGET (default on; 0 = no shedding). The fps and pixel-ratio caps are client-side and lift with ?budget=0.
RISKS: The 2 MB is measured uncompressed; over the wire it is about 0.6 MB. The furniture models are the last thing shed, so a floor with many more
  staff than today's seven may lose its office furniture on a phone. Frame rate here is a software renderer's (about 3 fps), so the 30 fps cap is
  proved by the fake-clock test, not by this machine's frame rate.
