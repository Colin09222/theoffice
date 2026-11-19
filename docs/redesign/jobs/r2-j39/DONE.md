STATUS: GREEN
JOB: r2-j39 State-true poses
DONE MEANS: "A Builder on a running job types with monitor glow; a waiting floor's beans glance at the boss door." Proved:
  - test/r2-room.test.js "DONE MEANS (rules): a Builder on a running job types fast with the monitor glow, even between keystrokes": poseFor()
    (public/js/room-rules.js) gives type, code screen, glow and fast typing for a Builder whose task is 'doing', whatever their momentary state;
    no running job, no typing.
  - "researching spreads papers, testing holds a clipboard, others keep their state; an Idle floor never types".
  - "a waiting floor's beans glance at the boss door once every 15 s, each on its own beat; never on other floors": 4 to 5 glances a minute,
    1.6 s each, offsets differ per bean, none on Working, Idle or Paused floors.
  - Browser (room-r2.mjs j39): in the real room a Builder given a running task, with their state 'thinking', types (type blend 1.00, fast) with the
    screen lit past white (1.3; on this machine's low tier the glow is that flat bright screen, per Q9; on mid/high the glow mesh shows too). The
    floor set to Waiting: every free bean (3 of 3; the others were up on a break) glanced at the boss's door within 16 s of room time. Picture:
    r2-j39-poses.jpg.
How it works: Actor.applyStatePose() asks poseFor() with the bean's role, state, whether a task of theirs is 'doing' (from the page's live tasks),
  and the Idle floor flag. A task starting or stopping re-poses the desk at once (updateBoard). Research papers are three sheets on the desk; the
  Tester's clipboard is the paper prop in hand while seated. Character typing runs a third faster with shorter pauses for such a Builder. Glances turn
  the seated bean up to 0.8 rad toward the boss room's door (plan.rooms boss.door).
TESTS: node --test test/r2-room.test.js 15/15 at this commit. The full npm test was run on the r2-j41 tree, which stacks this job; its result is in LANE-R2-A-FINISHED.md (still running when this
  branch was first pushed). r2-j31's full run: 1858/1860, the IPv6 test and a timestamp flake.
  Browser: room-r2.mjs j39 all passed.
DEPLOY NOTES: No migration, no new env (it sits under the same room code as r2-j31; IDLE_LIFE does not affect it). Files: office-scene.js,
  character.js (typing pace), room-rules.js.
RISKS: "Waiting on boss" glances apply only to free seated beans (someone mid-errand doesn't turn). Roles other than builder/designer/illustrator,
  researcher/analyst/writer and tester keep the plain poses of their state. Fixed on the way: the room's running-task lookup reads taskView's
  agentId (the snapshot's field) as well as agent_id.
