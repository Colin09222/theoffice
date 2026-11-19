STATUS: GREEN
JOB: r2-j67 Milestones and real counts
DONE MEANS: "Bean cards show jobs finished and launches; no level appears anywhere." Proved:
  - test/r2-room.test.js "DONE MEANS: bean cards show jobs finished and launches; the plaque shows launches and visits; no level appears
    anywhere": after a real mock job the visitor's snapshot gives the Builder's jobs finished (exactly their tasks marked done) and launches
    worked on (1); the floor's milestones count launches and real visits (7 visits added, 7 shown); a launch made private stops counting for a
    visitor; no level, rank, xp or badge field anywhere in the floor's snapshot; REAL_COUNTS=0 sends none. "no level is shown anywhere: no page
    script says Level N" (every string in public/js).
  - Browser (room-r2.mjs j67): the floor plaque reads "3 launched · 0 visits"; the Builder's ID card reads "1 job finished · 1 launch worked on";
    no level, lvl or rank on the card or the plaque. Picture: r2-j67-idcard.jpg.
How it works: server/room.js roomPeople() counts per person (done tasks; distinct public launches they finished a task for) and roomMilestones()
  (r2-j42) gives launches and visits; both ride on the snapshot's room. floor-ui.js puts the two counts on the ID card (openAgent) and the floor's
  counts next to the state badge on the plaque (renderHeader), only once there is a launch. Trophies (r2-j42) are the milestones.
TESTS: node --test test/r2-room.test.js 41/41 (one r2-j42 assertion changed on purpose: with ROOM_PROPS=0 the counts stay for the plaque; the
  piles and trophies still go, `props: false`). Full npm test: see LANE-R2-A-FINISHED.md. Browser: room-r2.mjs j67 all passed.
DEPLOY NOTES: No migration. New env REAL_COUNTS (default on).
RISKS: "Launches worked on" counts public launches the person finished a task for (done or handed in), so a manager who only reviews counts none.
