STATUS: GREEN
JOB: r2-j40 Result beats
DONE MEANS: "A real launch event triggers one cheer; a failed check triggers one slump." Proved:
  - test/r2-room.test.js "DONE MEANS (rules)": BeatGate gives one cheer (2 s, the whole room) for a launch record, one slump (1.5 s) for a failed
    check, one high five (1.5 s) for a passed one; the same record never plays twice. "the gate refuses anything without a record type and
    number" (7 refusals). "a Tester's finished check sends one beat event": engine.finishTask for a Tester sends { kind: 'check', passed, agent,
    task } for PASS and FAIL reports, nothing for a Builder's task, nothing with RESULT_BEATS=0.
  - Browser (room-r2.mjs j40): a project published and its 'project' event raised twice (as one publish can) gives exactly one cheer, by the room,
    with record launch beat-shop@<publishedAt>; a 'beat' check event sent twice for task 4242 gives exactly one slump, by the one bean, with
    record task 4242; a beat with no record is refused.
How it works: floor-ui.js no longer cheers on every 'project' event; launchParty() (fresh real launches only) calls view.beat() once, whether or
  not the confetti may play. The 'beat' event from the server plays the high five or the slump. New poses 'slump' (sag, eyes half shut) and 'five'
  (one hand up high) in cast.js/character.js.
TESTS: node --test test/r2-room.test.js 18/18 at this commit. The full npm test was run on the r2-j41 tree, which stacks this job; its result is in LANE-R2-A-FINISHED.md (still running when this
  branch was first pushed). r2-j31's full run: 1858/1860, the IPv6 test and a timestamp flake.
  Browser: room-r2.mjs j40 all passed.
DEPLOY NOTES: No migration. New env RESULT_BEATS (default on; 0 = no 'beat' event from the server). Lane B's file touched: server/engine.js,
  finishTask, 3 lines (the check outcome is kept in a variable and one emit added after testerFailedOn).
RISKS: The high five is one bean's raised hand (there is no second bean on the other side of it). A check is a Tester's finished task with a PASS
  or FAIL verdict (or the done-means report's verdict); the beat event follows the task's project privacy like other events.
