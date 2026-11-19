STATUS: GREEN
JOB: r2-j32 Framed launches
DONE MEANS: "Floor 6's wall shows one frame with the real TheTireRx screenshot." Proved:
  - test/r2-room.test.js "DONE MEANS: floor 6's wall shows one frame with the real TheTireRx photo": floor 6 named TheTireRx, one launched project
    with a stored launch photo (a real JPEG): the snapshot's room.frames has exactly that one launch, its photo address answers 200 image/jpeg with
    the very bytes stored, and frameLayout hangs one frame.
  - "one or two launches hang big...", "phone low: at most 3, small...": newest first, max 8 then +N, 2 by 2 clusters past two, low = max 3 small.
  - "newest first, private work and demo floors never hang, a launch with no photo hangs a card, ROOM_FRAMES=0 hangs none".
  - Browser (test/browser/room-r2.mjs j32): the real room on floor 6 hangs one frame, for thetirerx, and its texture is the launch photo from
    /api/building/shot/<floor>/thetirerx (256 px wide on this machine's low tier, 512 on mid/high). Picture: r2-j32-frames.jpg.
How it works: server/room.js roomFrames() reads the floor's public launches and their launch_shots row (no new table); office-scene.js setFrames()
  hangs them over the side wall's two picture spots on a dark board that covers the art there; a launch with no photo yet is a plain card in the
  floor's colour with its title. Updated on every snapshot reload (floor-ui.js -> view.setRoom).
TESTS: node --test test/r2-room.test.js 12/12 at this commit, test/talk.test.js 21/21. The full npm test was run on r2-j31 (1858/1860, see there) and
  on the r2-j41 tree, which stacks this job (its result is in LANE-R2-A-FINISHED.md; still running when this branch was first pushed).
  Browser: room-r2.mjs j32 all passed.
DEPLOY NOTES: No migration. New env ROOM_FRAMES (default on; 0 = old art only), in .env.example. The photos come from the launch shots already
  taken (scripts/launch-shots.mjs / SHOTS_CDP_URL); a launch with no photo hangs its card until one is taken.
RISKS: Only a floor's public launches hang (private ones never, a demo floor's never). A hidden floor's photo address answers 404 by design, so a
  hidden floor hangs cards. The frames live on the two picture spots of each plan (plan.art); a plan with one spot holds at most 4.
