STATUS: GREEN
JOB: r2-j41 Whiteboard plan
DONE MEANS: "The whiteboard lists the current plan's jobs and ticks one when it is done." Proved:
  - test/r2-room.test.js "DONE MEANS: the whiteboard lists the current plan's jobs and ticks one when it is done": a started weekly plan
    (weekly_plans, round 1 job 20) with 6 tasks: the snapshot's room.whiteboard lists the first 5 with the goal; one task set done gives exactly one
    tick; the page's live task list ticks the next one before any reload; a job in review is not ticked.
  - "with no started week plan: the newest open plan; a visitor never sees a private job; nothing to show is null; ROOM_WHITEBOARD=0".
  - Browser (room-r2.mjs j41): the real meeting room's board shows "A tyre page" with its 3 jobs, 0 of 3 done; the server marks the first task done
    and sends its task event; the board ticks it (1 of 3) without a reload. Picture: r2-j41-whiteboard.jpg.
How it works: server/room.js roomWhiteboard(): this week's started plan's task_ids, else the newest open plan's tasks, up to 5, redacted for
  visitors like the snapshot's tasks. office-scene.js updateBoard() draws planTexture() (goal, tick boxes, "N of M done") when there is a plan, else
  the old board.
TESTS: node --test test/r2-room.test.js 20/20 at this commit. The full npm test was run on the r2-j41 tree, which stacks this job; its result is in LANE-R2-A-FINISHED.md (still running when this
  branch was first pushed). r2-j31's full run: 1858/1860, the IPv6 test and a timestamp flake.
  Browser: room-r2.mjs j41 all passed.
DEPLOY NOTES: No migration. New env ROOM_WHITEBOARD (default on; 0 = the old board of open tasks).
RISKS: A job counts as done at status 'done' only (not 'review'). Draft and approved plans that have not started don't show; the newest plan's
  jobs do until the week's plan starts.
