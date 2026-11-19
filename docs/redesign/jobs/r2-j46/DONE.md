STATUS: GREEN
JOB: r2-j46 Camera follow and drift
DONE MEANS: "The desktop camera eases to a real handoff and back, and stops after a drag." Proved:
  - Browser (room-r2.mjs j46, desktop 1440x900): a real 'handoff' event from the server (Builder to manager): the room follows it (one entry, the
    event's id as record); stepping the room 6 s, the follow weight runs 0.07, 0.74, 1, 1, 1, 1, 1, 0.93, 0.26, 0 and the camera moves over and comes
    home. A drag on the room: Follow goes off at once, the switch reads not pressed, and the next real handoff is not followed. Clicking the
    switch turns it back on. A phone (?q=mid) never follows; left alone 8 s it drifts (11.8 degrees in the next 7 s). No page errors.
  - test/r2-room.test.js "DONE MEANS (rules)": CameraFollow eases in over 1.2 s, holds 3 s, eases back over 1.2 s; "at most once every 20 s; never
    without a record; a drag turns it off until the switch turns it on"; "idle drift: nothing for 8 s, then 2 degrees a second, swinging 15 degrees
    each way".
How it works: OfficeView.handoff(from, to, id) asks CameraFollow with the event's id as its record and the receiver's position; update() blends the
  camera's pan (and a little zoom) toward it without touching the user's own pan, so it comes back to exactly where they left it. A drag past 8 px
  calls drag(). The "Follow the work" switch sits with the floor's controls (floor-ui.js renderControls), desktop only, and follows the room's state
  through an 'office:follow' event. Drift is a yaw offset after 8 s with no pointer, wheel or touch. Off under prefers-reduced-motion, on phone low
  (setTier turns drift off) and with ROOM_CAMERA=0.
TESTS: node --test test/r2-room.test.js 32/32 at this commit. The full npm test on this stack is reported in LANE-R2-A-FINISHED.md.
  Browser: room-r2.mjs j46 all passed.
DEPLOY NOTES: No migration. New env ROOM_CAMERA (default on; 0 = no follow, no drift).
RISKS: Only handoffs are followed (the spec's "real handoff"); launches and meetings are not. The switch's icon is the existing sparkle (there is no
  camera icon in icons.js).
