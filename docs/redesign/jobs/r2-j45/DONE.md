STATUS: GREEN
JOB: r2-j45 Auto quality
DONE MEANS: "A slow test phone lands on low and shows no shadows; cutaway.js has been checked and its use noted." Proved:
  - Browser (room-r2.mjs j45): a phone (390x844, 2x, phone user agent) with the CPU slowed 4x on this machine's software renderer: the 2 s frame
    test measured 0.2 fps and put the room on low (stage.steps: test-low); shadows off (renderer.shadowMap.enabled false, the sun casts none). Still
    under 15 fps for 5 s on low: a still picture of the room (the canvas as a JPEG) replaced the moving room, with the note "This phone is too slow
    for the moving room, so here is a still picture of it." and a "Try the moving room" button, which brings it back. Picture: r2-j45-still.jpg.
  - test/r2-room.test.js "the 2 s frame test" (levelFor: 50+ high, 30 to 49 mid, under 30 low); "one drop of one level, once, after 5 s averaging
    under 24 fps; never on a single slow frame; never twice"; "on low, still under 15 fps for 5 s: a still picture, once; try again watches afresh"
    (QualityWatch on a fake clock; mid drops to low, then the still).
cutaway.js, checked: it is not a 2D picture. It patches the room's materials so the walls facing the camera are cut down to the sill (a dither in
  the shaders, from the camera's position) and the far walls come up as the camera goes round. It needs WebGL like everything else in the room, so
  it cannot be the fallback when 3D is too slow. It stays what it is (used by office-scene.js on every tier). The fallback is the still picture
  above, taken from the room's own last frame; with no 3D at all the phone already has the floor's lite page (round 1, job 16).
How it works (stage.js, phones only): on a room's first view a 2 s frame test, uncapped, after the 2 s shader grace; it sets the tier once a visit.
  Then QualityWatch on the frames drawn: one tier down, once, on a 5 s average under 24 fps; on low, a 5 s average under 15 fps shows the still.
  The old step-by-step adapt() is off on phones (desktops keep it). ?q= still pins a tier for testing.
TESTS: node --test test/r2-room.test.js 29/29 at this commit. The full npm test on this stack is reported in LANE-R2-A-FINISHED.md.
  Browser: room-r2.mjs j45 all passed; j44 re-run with the frame test in place: all passed.
DEPLOY NOTES: No migration, no new env (it rides on r2-j44's phone budget; ?budget=0 turns both off for a visit). CSS: .room-still, .room-still-note
  in public/css/app.css.
RISKS: Q9's rules are applied on phones only; desktops keep the existing adapt(). The frame test counts frames drawn in 2 s, so a phone that
  stalls on something else in those 2 s starts lower than it needs to (it never steps back up in a visit, as the spec's "once" asks).
