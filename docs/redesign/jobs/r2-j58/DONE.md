STATUS: GREEN
JOB: r2-j58 CHECKED mark
DONE MEANS: "A launch that passes shows "CHECKED 8 of 8" on its plaque and card." Proved:
  - test/r2-launch.test.js "DONE MEANS: a launch that passes shows "CHECKED 8 of 8" on its card and its plaque; 7 of 8 shows nothing": a launch
    whose kept checklist passed all 8 carries checked { passed: 8, of: 8 } on the public Launched wall's card and on its frame in the room's
    snapshot; one that passed 7 (a warning) and one never checked carry nothing; nothing on the wall says buddehbot.
  - Browser (room-r2.mjs j58): in the room the launch's frame has a small "CHECKED 8 of 8" plaque under it; on /launched/<floor> the launch card
    reads "CHECKED 8 of 8" (a green rubber-stamp style label). Pictures: r2-j58-plaque.jpg, r2-j58-card.jpg.
How it works: server/checklist.js checkedMark() reads r2-j57's kept result (launch_checklists). server/shots.js launches() carries it on each
  launch (so the home hero, the Launched wall and a floor's portfolio all get it through server/building.js's card), and server/room.js puts it on
  the room's frames. public/js/launch-card.js shows the stamp; office-scene.js hangs the plaque under the frame. It is the code checklist's own
  stamp, not a character's: never buddehbot's (spec Q23).
TESTS: node --test test/r2-launch.test.js 8/8; shots 6/6, portfolio 3/3, home 4/4, building 14/14. Full npm test: see LANE-R2-A-FINISHED.md.
  Browser: room-r2.mjs j58 all passed.
DEPLOY NOTES: No migration, no new env (it follows LAUNCH_CHECKLIST's kept results and ROOM_FRAMES). Lane B's file touched: server/building.js,
  one line (the card passes `checked` through when present). CSS: .lcard-checked in skin.css.
RISKS: The mark shows only at 8 of 8 (the spec's words); a launch with a warning shows no mark rather than "7 of 8". Launches from before r2-j57
  have no kept checklist, so no mark until they are checked again (the boss's checklist route, or the next Launch).
