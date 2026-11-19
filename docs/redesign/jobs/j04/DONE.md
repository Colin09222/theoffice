STATUS: GREEN
JOB: 04 Stop re-holds
DONE MEANS: "A handed-back task cannot return to 'held'; a test that tries is refused and logged."
  Proved in test/rehold.test.js:
  - "the 16 November loop: handed back, then sent back by the manager, the task is never held again and goes to the floor's own Builder":
    three send-backs after a handback, 0 re-holds, 1 contractor job, 1 ping, the floor's own Builder did each round.
  - "a try to hold a handed-back task is refused, logged, and listed for the admin": holdForContractor() on a handed-back task returns null,
    the task stays todo, a hold_refusals row is written, a warn line goes to the server log; it stays refused with the old routing switched back on.
  - "the routing is decided once, when a task is made, never on a status change" (Rule 1).
  - "a Tester failure on handed-back work makes one fix task on the floor and closes the original as shipped" (Rule 3): one fix task (fix_of set,
    never routed to the contractor, same role, brief carries the Tester's report fenced, model_tier recorded), original status done; a second
    failure makes no second fix task.
  - "one ping per task, ever, even when the old routing holds it a second time" (Rule 4): pings are keyed by task id (idempotency key
    theoffice-contractor-task-<task id>, contractor_pings table).
  - Rule 5: test/costalert.test.js "a task a Tester fails three times is told once; the manager's own send-backs don't count".
  - Admin: "the admin lists refused re-holds" (node scripts/admin.mjs contractor refusals --since 24h [--json]).
  Cause found: server/engine.js tickFloor held every 'todo' Builder/Designer/Researcher task on a floor with floors.contractor=1, every time
  one was picked up. After a handback the task finished to 'review'; when the manager sent it back (review_task revise) it went back to 'todo'
  and tickFloor held it again, with a new contractor_jobs row and a new ping (pings were keyed by job id, so each one was "new"). Each lap also
  bumped tasks.revisions, which the cost alert read as "sent back N times".
TESTS: npm test 1700/1702 on this branch's first commit (46a2ffc). The 2 failures: computer.test.js "a database from before these features is
  brought up to date at boot" (my one-time fill read a column a very old database lacks; fixed in the next commit, computer.test.js 62/62 after);
  domains.test.js "the key only travels over TLS, in the body, and over IPv4" fails with EAFNOSUPPORT ::1 because this container has no IPv6;
  it fails the same way on office-redesign-base. Browser suites: none touch this job (server only); not run.
DEPLOY NOTES: Migrations (additive, in db.js's "redesign lane B" block): tasks.contractor_route, tasks.handed_back_at, tasks.tester_fails,
  tasks.fix_of; tables hold_refusals, contractor_pings. A one-time fill at first boot (settings key laneb_j04_route_v1): every task whose
  contractor job was handed back ('closed') gets handed_back_at (so the floor 6 task can never be re-held again); waiting Builder/Designer/
  Researcher tasks on contractor floors keep contractor_route=1; every task already pinged is recorded so it is never pinged again.
  New env switches (default = new behaviour): CONTRACTOR_ROUTE_ONCE (default on; 0 = check the floor switch at each pickup, as before) and
  HANDBACK_FIX (default on; 0 = no automatic fix task). Refusing a re-hold of handed-back work has no switch.
  Admin command after deploy: node scripts/admin.mjs contractor refusals --since 7d (should stay empty; a row means something tried to re-hold).
  The contractor ping's idempotency key changed from theoffice-contractor-job-<job> to theoffice-contractor-task-<task>.
RISKS: The fix task runs on the floor's strongest model its own limits allow (budget.tier: on today's floors that is the Sonnet floor tier)
  until job 17 adds Tier 3. A Tester's verdict is read from its report (office-verdict block, else first line, else any FAIL in capitals);
  a report that fails without the word FAIL is not counted (job 9 makes the report structured). A manager send-back of handed-back work is
  allowed and goes to the floor's own staff (never the contractor), so it is not refused; only a hold is. The cost alert's "sent back" line now
  counts Tester failures only. Section 8: "Re-holds after handback: 0" (tested); contractor pings for one task: 1.
