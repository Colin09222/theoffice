STATUS: GREEN
JOB: r2-j42 Paper piles and trophies
DONE MEANS: "A bean with 3 queued jobs has 3 sheets; floor 6 shows the 1,000-visit trophy." Proved:
  - test/r2-room.test.js "one sheet per queued job...": queuedFor() counts a bean's own 'todo' tasks; 3 queued = 3 sheets; max 5; phone low = one
    flat sheet or none; empty queue = empty tray.
  - "trophies: first launch, 100, 1,000, 10,000 real visits; never more than 4; none for nothing".
  - "DONE MEANS: floor 6 shows the 1,000-visit trophy, from the launch cards' own visit counts": floor 6 (TheTireRx) with two public launches and
    2,241 real visits (app_visits.uniques, as the launch cards count them): room.milestones = { launches: 2, visits: 2241 }, trophies include
    1,000 and not 10,000; private work and unlaunched pages count for nothing; ROOM_PROPS=0 sends none.
  - Browser (room-r2.mjs j42): the Builder with 3 queued jobs shows 1 sheet on this machine's low tier (Q9: one flat sheet) and 3 sheets at full
    detail; every other tray is empty; the shelf holds 3 cups (first launch, 100, 1,000). Pictures: r2-j42-pile.jpg, r2-j42-trophies.jpg.
How it works: server/room.js roomMilestones(); office-scene.js Actor.showPile() (a tray on each desk) and setTrophies() (a shelf on the reception
  wall under the sign, cups growing with each milestone, a star on the first).
TESTS: node --test test/r2-room.test.js 23/23 at this commit. The full npm test on the r2-j41 tree (this job stacks on it) is in
  LANE-R2-A-FINISHED.md. Browser: room-r2.mjs j42 all passed.
DEPLOY NOTES: No migration. New env ROOM_PROPS (default on; 0 = no piles or trophies).
RISKS: The browser check used floor 7 (floor 6 was taken by the j32 check in the same run); the node test is on floor 6. Trophies sit under the
  neon sign's position (plan.console / signZ) whether or not the floor has the sign on.
