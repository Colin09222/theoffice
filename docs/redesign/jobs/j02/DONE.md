STATUS: GREEN
JOB: 02 Quiet the noise
DONE MEANS: "A visitor sees no demo launches, no small talk in Talk, and no 'gone home' text anywhere."
  (a) Demo floors (floors.filler=1, the scripted companies; live floors 1 Pigeon Logistics and 2 Mildly Haunted Candles) are left out of
      /api/floors (directory, lift, 3D tower lights, the no-WebGL stack), /api/building/ticker, /api/building/staff, and were already out of
      the Launched wall and launch parties. The admin overview still lists them and their own /floor/<slug> link still opens.
      DEMO_FLOORS_PUBLIC=1 shows them again. Their floor numbers stay taken (never offered as "to let").
      Proof: test/look.test.js "directory, lift, ticker, stack and launched wall leave them out; the admin and their own link still have them",
      "DEMO_FLOORS_PUBLIC=1 shows them again"; test/building.test.js "filler floors are never on the ticker or the wall"; test/filler.test.js.
  (b) Banter makes zero model calls: config/banter-lines.json holds 200 fixed lines (light office small talk; no names, no boss quotes,
      no money: checked by a test), server/banter.js picks 2 or 3 at random (no repeat among a floor's last 40), and server/people.js says
      them between two people as speech bubbles: a live 'talk' event with kind 'banter' and bubble:true that is never stored, so it never
      reaches Talk, the timeline, the ticker or a reload. The floor page shows it only over the speakers' heads. Old stored banter lines are
      filtered out of every snapshot's talk list. BANTER_LINES=0 restores the old model-written kettle (all its old tests still run behind
      that switch). Proof: test/look.test.js "a watched floor hears bubbles; no model is called, nothing is stored, and Talk never shows it"
      (llm call count 0, no talk event stored, no ledger row), "the list: 200 different short lines...".
  (c) Four states, from server/look.js floorStateOf: Paused (floor paused, suspended or at its money stop; no reason shown, pauseReason
      removed from a visitor's snapshot), Waiting on boss (an unanswered question), Working (anyone not idle or a task doing), Idle
      ("last active 2h ago", from the latest task or log line). Every floor card and floor snapshot carries state + lastActive. The lobby
      directory row shows the badge (and "last active ..." for an idle floor), the stack strips say the state, the floor plaque shows the
      badge. Visitors never get the hours: the lobby card has no workMode, the visitor snapshot gets mode 'ask', closed:false, opensAt:null,
      so no "Closed", no "Open 9-5" sign (hidden for visitors), no "gone home" banner, and the 3D staff never go home for a visitor.
      The boss keeps their hours sign and a plain "Outside your set hours" line. PUBLIC_HOURS=1 shows visitors the old sign.
      Proof: test/look.test.js "Working, Waiting on boss, Idle with when, Paused with no reason", "outside set hours a visitor sees a quiet
      floor, not a closed one; the boss still has the hours", "no Closed, gone home or hours sign in anything a visitor's page draws".
  (d) The public ticker shows feed lines and launches only (never talk), and never a demo floor's.
  Screenshots: docs/redesign/jobs/j02/shots/ (8, 0 console errors): directory with Idle badges, no demo floors, floor plaque with the badge.
TESTS: npm test 1706/1707. The one failure is test/domains.test.js "...over IPv4" (listen EAFNOSUPPORT ::1: no IPv6 in this container,
  fails the same before this job). Tests changed because the spec changes the behaviour: building.test.js (demo floors no longer in the
  ticker), filler.test.js (demo floors no longer in the directory; still listed and marked with DEMO_FLOORS_PUBLIC=1), modes.test.js (the
  visitor-sign test now runs with PUBLIC_HOURS=1), banter.test.js and people.test.js (model banter tests run with BANTER_LINES=0; the
  demo floor's scripted small talk is said but not in Talk). Browser suites run: test/browser/redesign-shots.mjs (8 shots, 0 console errors).
  test/browser/modes.mjs (which waits for a "Closed" pill and the "gone home" banner) was not run; it asserts the old visitor text.
DEPLOY NOTES: no migration. New env switches, all off by default (default = the redesign): DEMO_FLOORS_PUBLIC (unset), PUBLIC_HOURS (unset),
  BANTER_LINES (unset = fixed lines; 0 = old model banter). New data file config/banter-lines.json (copied by the Dockerfile's COPY config).
  Nothing to run after deploy. Check: live floors 1 and 2 must have floors.filler=1 (they are the seeded filler companies); if one is a
  hand-made demo floor instead, set filler=1 on it or hide it with the admin's existing hide command.
RISKS: The lift still draws numbers 1 and 2 as plain, unlit, disabled buttons (their numbers are taken); job 14 makes the lift open floors
  only. The night freeze (global pause) reads Idle, not Paused, because it is not the floor's doing. The state comes from the snapshot and
  refreshes with it; a floor that starts work shows Working at once from its staff's state. test/browser/modes.mjs needs updating to the
  new visitor text before it is run again (lane owner's call).
