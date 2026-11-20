STATUS: GREEN
JOB: r2-j55 Contractor delivery and Colon stamp
DONE MEANS: "A handed-back job triggers one lift ride; COLON APPROVED appears only on items with an approval record." (Section 3 animations 3 and 7,
  Q22: the contractor stays manual, only Colon's Send out fills the queue; tapping the robot never contacts buddehbot.)
  - The approval record is the task's sent_out_at (Colon's Send out, job 19: the only way in). mailroom-events.js marks an event approved only for
    a contractor item with that time; approvedStampFor() gives the small COLON APPROVED stamp only then, with the line "Approved.".
  - Hand-back (contractor_jobs.done_at): in the mailroom the robot takes a box to the lift door, is gone up the tower and comes back (8 s); on the
    floor (mailroom-floor.js) a small buddehbot rides out of the lift with the box, sets it at the Builder's desk (the manager's if none) and
    rides back, 8 s, one ride per hand-back. The box stays at the desk for a minute.
  - Nothing here writes a record or calls anything but the feed: the contractor queue is still filled only by Send out.
  Proved in test/r2-delivery.test.js (3 tests): with the real feed and a fake room, a hand-back makes exactly one 8 s ride to the Builder's desk
  over five readings, and leaves the box; of a Send-out job, a plain held job, a purchase and a help question, only the Send-out job gets COLON
  APPROVED (and "Approved."); the mailroom's server code writes nothing and the page calls only the feed (and Colon's existing Send out route).
  Browser (npm run e2e:r2-building, on this stack): a job Colon sent out showed the small COLON APPROVED stamp; handed back, one lift ride.
TESTS: every test/r2-*.test.js on the r2-j72 head (this lane's whole stack): 84 of 84 pass, and the files this job touches pass on its own branch.
  npm test (full): last complete run at the r2-j50 code head, 1893 of 1895 (domains.test.js IPv6, which fails on office-r2-base too, and an r2
  test line fixed before any push). Not yet a complete full run on this branch when pushed: the container restarted twice mid-run; the result
  goes in docs/redesign/LANE-R2-B-FINISHED.md. Known in this container: onboarding.test.js's 3-minute browser walk takes 170 to 196 s here and
  fails the same on office-r2-base (193.7 s), so it is the machine, not this lane.
  Browser suites run: npm run e2e:r2-building on the r2-j72 head: all 31 checks pass.
DEPLOY NOTES: none.
RISKS: The ride is drawn with the robot at 0.6 scale on a floor (beans and rooms are a different scale from the basement).
