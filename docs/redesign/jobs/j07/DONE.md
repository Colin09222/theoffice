STATUS: GREEN
JOB: 07 Hard caps
DONE MEANS: "A task that reaches $5 is ended and shipped or closed, in a test with a fake cost."
  test/hardcap.test.js (each model call reports a fake cost):
  - "a task that reaches $5 with work saved is ended and ships as Work in progress; the boss hears one plain line; the owner one alert":
    three $2 calls, stopped at the first look past $5 (no fourth call), status done, tasks.wip=1, tasks.capped_at set, tasks.not_done lists the
    done-means lines not ticked PASS; the manager says one line with no figure ("Boss, I stopped ... it ships as it stands, marked Work in progress.
    Not done yet: ..."); one owner alert (job 6's taskCapped) delivered.
  - "with nothing usable saved it closes": status failed, "nothing usable was saved, so I closed it".
  - "a task with its own cap (Tier 3's $6) goes on past $5 and stops at its own": tasks.cap_usd overrides the building's cap (room left for job 17).
  - "TASK_MAX_USD sets the cap; HARD_CAP_ENDS=0 goes back to the old stop".
  The same stop applies on a computer (the session's room is the task's own cap; the computer gets its one last save first), and to paid tool calls.
TESTS: npm test 1720/1723 on this branch before the last test fix. Failures: computer.test.js "no session starts when nothing is left of the task
  cap" expected the old "Stopped by the building" words (updated in the next commit to the new "Ended by the building ... closed"; passes);
  domains.test.js IPv6 (EAFNOSUPPORT, this container has no IPv6) and googleads.test.js "a total budget of exactly the approved amount ..." (date-
  dependent; fails the same on office-redesign-base at this hour). Changed tests (spec changes the behaviour): buildwell.test.js now expects the $5
  default and the ship/close outcome. Browser suites: none touch this job; not run.
DEPLOY NOTES: TASK_MAX_USD default changes from 40 to 5 (set it on live only to override; "off" turns it off). New env HARD_CAP_ENDS (default on;
  0 = the old stop: failed and the boss told). Migration (lane B block): tasks.cap_usd, tasks.capped_at, tasks.wip, tasks.not_done.
  The owner alert needs OPENCLAW_HOOK_URL / OPENCLAW_HOOK_TOKEN (already set for the contractor ping).
RISKS: A task that "ships" is marked done with wip=1; the manager is told to publish what is saved as it stands if it isn't live yet (no code
  publish, since a publish runs the ship check and gate). "Usable" means files are saved under the task's project; a research task with no project
  closes. At $5 a long first build on a computer will now stop where the old $40 net never did: that is the spec's ruling (Tier 3 gets $6 in job 17).
  Section 8: no task can pass its cap by more than one call (tested).
