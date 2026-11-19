STATUS: GREEN
JOB: r2-j31 Lived-in idle floors
DONE MEANS: "On an Idle floor no bean types and at least one idle move plays within 20 s." Proved:
  - test/r2-room.test.js "DONE MEANS: on an Idle floor no bean types and at least one idle move plays within 20 s": 20 runs of the real FloorLife
    (life.js) with stand-ins for a manager, two staff and the boss, on a fake clock: every run has an idle move within 20 s, no step is 'type', no
    step says a word, and the boss is never moved.
  - "the rounds": IdleRounds (public/js/room-rules.js) over 2,000 fake seconds: one bean every 10 to 20 s, each move 4 to 8 s, all four moves
    (lounge, kettle, read, stretch) played, never the same move twice running for one bean. No kettle without a kitchen; no stretch once out of the chair.
  - "the team drifts off": after a walk-away move the bean stays there resting until picked again or the floor gets work (then back to the desk).
  - "a Working or Waiting floor gets no idle rounds, and someone at work stops them at once"; "going Idle re-poses everyone" (screens go dark);
    IDLE_LIFE off leaves the old breaks. "the snapshot carries the room switches".
  - Browser (test/browser/room-r2.mjs, npm run e2e:room2, headless Chromium): a fresh Idle floor, the room's own update() stepped through 20 s of room
    time: an idle move played, no bean typed (anim or blend), no monitor glow visible, no page errors. Picture: r2-j31-idle.jpg (desk view before the moves).
How it works: the room learns the server's state word (floor-ui.js renderHeader -> view.setFloorState; at build from state.floor.state). An Idle (or
  Paused) floor with nobody at work turns off each bean's own break timer and runs one floor-wide round instead; screens show the dark screensaver
  at #2e2e33 with no glow. Working and Waiting floors are untouched (r2-j39 gives them poses).
TESTS: npm test 1858/1860 on this branch. The 2: domains.test.js "...over IPv4" (no IPv6 on this machine; fails the same on office-r2-base, which
  was 1851/1852), and ownspend.test.js "the boss's own figures", a time flake unrelated to this job (it bans the text "99" and a millisecond timestamp
  in the payload happened to contain 99; passes 3/3 on rerun).
  Browser: test/browser/room-r2.mjs j31: all passed.
DEPLOY NOTES: No migration. New env IDLE_LIFE (default on; 0 = old breaks), in .env.example. New files: server/lanea2-config.js (lane A round 2
  switches, spread into config.js in one line), server/room.js (the snapshot's `room` object; installed with one line in app.js after the
  extensions list), public/js/room-rules.js (pure room rules). Nothing to run after deploy.
RISKS: There is no sofa-sitting pose in cast.js, so "sit in the lounge" is the lounge move standing easy by the sofa with the phone pose, then
  standing. The first move after a floor goes Idle is called 2 to 5 s in (not 10 to 20) so that a long walk (about 13 s across the open plan) still
  has it playing within 20 s; after that one bean every 10 to 20 s. Headless software rendering runs the room clock at about 7% of real time, so the
  browser check steps the room's own update() by hand instead of waiting on the wall clock. The boss keeps their old in-office errands.
