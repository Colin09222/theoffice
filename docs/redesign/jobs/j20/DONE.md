STATUS: GREEN
JOB: 20 Weekly plan, with no budget
DONE MEANS: "In a test at a fake Monday 08:05, a floor gets one draft; the boss approves or edits it; a floor whose boss does nothing runs the draft after
  the wait; no floor is ever set Idle or held at $0 by the plan."
  server/weekplan.js, proved in test/weekplan.test.js:
  - "at a fake Monday 08:05 a floor with a goal or recent work gets one draft, with done-means lines and estimates; others get none": at 08:04 New York
    nothing; at 08:05 one manager call (meta.kind 'weekplan') per eligible floor, a second tick makes none; demo floors (filler), paused floors, a
    floor switched off and a floor with no goal and no work in 14 days get none. The boss's snapshot has weekPlan (goal, up to 5 jobs, each with 3 to 5
    done-means lines and "This will cost about $X."); a visitor's has none; the manager's prompt carries no money.
  - "the boss approves": the jobs go to the staff in order (each after the last) under one plan, "This week: <goal>", through engine.assignTask.
  - "the boss edits": a new goal, a job reworded, one removed and one added; then it starts as edited.
  - "a boss who does nothing": after WEEKLY_PLAN_AUTOSTART_HOURS (24) the draft starts exactly as if approved; the floor is never paused, its work
    mode never set to Idle, and nothing waits on money.
  - "a floor switched out of weekly plans gets no draft and nothing starts, even a draft made before; admin.mjs plan shows, switches and asks for one".
  - "WEEKLY_PLAN=0: no Monday draft; a manager answer that isn't a plan is dropped".
  The status card shows "This week's plan" with Approve and Edit for the boss (public/js/status-card.js, in the slot j15 left for it).
TESTS: npm test 1830/1831; the 1: domains.test.js IPv6 (EAFNOSUPPORT ::1; this container has no IPv6, fails the same on office-nobudget). No older test changed
  (j21's leak-test change already lets the boss's estimates through, which covers the plan's). Browser suites: not run (the plan box on the status card
  is checked through the snapshot and its API).
DEPLOY NOTES: Migration (lane B block): tables weekly_plans (UNIQUE floor_id+week) and weekly_plan_floors. New env: WEEKLY_PLAN (on; 0 stops the
  Monday draft building-wide; plans already drafted still start), WEEKLY_PLAN_AUTOSTART_HOURS (24). The draft uses the digest's clock (DIGEST_AT,
  08:05 New York). After deploy, TheTireRx upkeep until 2026-12-03: node scripts/admin.mjs plan --floor 6 off (no draft, nothing starts; check with
  node scripts/admin.mjs plan --floor 6). Back on after: node scripts/admin.mjs plan --floor 6 on. Force a draft now:
  node scripts/admin.mjs plan --floor N --draft-now (the server picks it up within a minute).
RISKS: The plan's jobs are handed out by code once (no manager turn), so a Monday costs one manager call per floor. "Floors whose team is paused at a $0
  stop" = floors with budget_out set or a provider stopped by the existing daily per-floor stops (floorLimits, unchanged). Job 10's one-open-plan rule:
  a week's plan that comes due while another plan still has open jobs waits its turn (it is never dropped, and nothing stops meanwhile); its jobs are
  at most 5; the 3-queued limit is the team's own next-up list, which the plan doesn't use. The floor's goal follows the week's only when it has none.
  The live 'weekplan' event isn't drawn by the page yet; the card updates on the next snapshot (refresh or any floor event). Lane A files touched,
  small: public/js/status-card.js (the plan box in the reserved slot) and public/css/skin.css. Forbidden spend limits from round 1: none still active
  (see j21).
