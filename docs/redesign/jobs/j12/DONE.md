STATUS: GREEN
JOB: 12 Status from code
DONE MEANS: "One timeline card per job, updated in place, with zero model calls for status."
  - server/jobcards.js: a job is the tasks the manager handed out together under one plan for one project (tasks.plan + tasks.project); a
    task with no plan is a job of one step. Every task change already goes through engine.emitTask; jobcards wraps it (no change to how
    tasks run) and rebuilds that job's card from the task rows: state (todo, working, review, waiting, done, failed, cancelled), step N of M
    (called-off steps don't count), who (agent name), one line ("Step 2 of 3: Mina is on Write the copy", "Done, all 3 steps. ...",
    "Step 2 of 2: Mina could not finish ...", "Step 1 of 3: up next for Arlo, ..."), created/updated/done times, thumbnail slot.
    Stored in job_cards (lane A block, UNIQUE floor+key): one row per job, updated in place, written only when something changed.
    Sent live as 'jobcard' (the boss's, ownerOnly) and 'jobcard_public' (a visitor's: private work reads "Working on something private",
    private names redacted). Every floor snapshot carries `jobs` (newest 30) for jobs 13 and 15.
  - Zero model calls for status lines: (1) the planning huddle (people.meeting, the talk model writing "who is doing what" lines when a plan
    starts or a job ends) no longer runs: the job card says it. (2) A round the team runs on its own (work mode or daily run): the
    manager's words after the round are kept in its own history, exactly as before, so its decisions and the loop are unchanged, but are
    marked quiet (table quiet_messages) and never shown in the chat; the code-built "On our own: ..." digest and the job card are the
    status. One small edit in server/engine.js (lane B's file): managerSays(floorId, text, { quiet }) and the one call that passes it.
    Banter was already code (job 2). STATUS_FROM_CODE=0 restores both old behaviours; JOB_CARDS=0 stops the cards.
  - Proof: test/jobcards.test.js: "step N of M, who and what, from the task rows alone"; "one card per job, made with the job and updated
    in place; zero model calls for status; the boss and a visitor both get it" (real mock floor building a thing: cards == distinct jobs,
    several versions of the same card id on the stream, 0 'meeting' model calls); "private work: a visitor reads only that it is
    private"; "refreshing a card with nothing changed writes nothing"; "a round the team runs on its own reports by its job card: the
    manager's words stay in its memory, not the chat" and its STATUS_FROM_CODE=0 twin.
TESTS: npm test 1718/1719 (the one failure is the IPv6 test, environment). Changed tests: people.test.js runs its planning-huddle tests with
  STATUS_FROM_CODE=0 (the old behaviour behind its switch). Browser suites: none touched by this job (no UI change; job 13 shows the cards).
DEPLOY NOTES: Migration: new tables job_cards, quiet_messages (CREATE IF NOT EXISTS). New env: STATUS_FROM_CODE (default on; 0 = old way),
  JOB_CARDS (default on; 0 = no cards). Cards start with the next task change after deploy; old jobs get no card. Nothing to run.
RISKS: Touches lane B's engine.js in two small places (managerSays's quiet option and its one caller); a merge with lane B's engine changes
  should keep both. A plan the manager rewrites with new plan text becomes a new job card (the key is the plan text). The manager's quiet
  round words are still in its history, so a model that relied on the boss having read them will not know the boss didn't; the job card and
  the code digest carry the same facts.
