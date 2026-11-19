STATUS: GREEN
JOB: 19 Contractor to manual
DONE MEANS: "No task reaches the queue unless Colon presses Send out."
  server/sendout.js, proved in test/sendout.test.js:
  - "no task reaches the queue unless the owner presses Send out, even on a floor whose old switch is on": Builder, Designer and Researcher jobs on a
    floor with floors.contractor=1 all ran on the floor's own staff; contractor_jobs stayed empty.
  - "Send out on a stuck job holds it for the contractor with one ping; it comes back and the floor carries on": GET /api/admin/stuck lists it,
    POST /api/admin/tasks/:id/send-out sends it, the engine holds it on its next tick, one ping ("Colon sent this job out himself"), the handback
    finishes it; handed-back work can't be sent out again.
  - "at most two a week across the building; a running job, a Writer's job or a cancelled one can't go".
  - "the admin CLI lists stuck jobs and sends one out" (admin.mjs contractor stuck, contractor send-out --task N; the old floor switch prints that
    it does nothing now).
  The admin page has a "Stuck jobs" section with a Send out button on each (public/js/admin-ui.js, lane A's file, one section).
TESTS: npm test 1747/1750 on this branch before the job 10 and 11 test fixes beneath it. The 3: domains.test.js IPv6 (EAFNOSUPPORT ::1;
  fails the same on office-redesign-base, this container has no IPv6) and the two workers.test.js tests fixed on jobs 10 and 11 (42/42 after).
  Changed older tests: contractor.test.js, rehold.test.js, manager.test.js and efficiency.test.js drive the hold through the old floor switch
  (CONTRACTOR_MANUAL off there). Browser suites: not run; the admin page gained one section (Stuck jobs with Send out), checked through its API.
DEPLOY NOTES: Migration (lane B block): tasks.sent_out_at. New env: CONTRACTOR_MANUAL (on; 0 brings back the floor switch),
  CONTRACTOR_SENDOUT_PER_WEEK (2). Floors 3, 6 and 7 keep floors.contractor=1 in the database, which no longer does anything; to tidy:
  node scripts/admin.mjs contractor --floor 3 off (and 6, 7). Jobs already held at deploy stay held until handed back or cancelled.
  Stuck jobs: node scripts/admin.mjs contractor stuck; Send out: node scripts/admin.mjs contractor send-out --task N, or the admin page button.
RISKS: "Stuck" means open and not moved for 6 hours, or failed in the last two days. A running job can't be sent out (pause the floor first). The
  week starts Monday 00:00 New York. The older contractor and re-hold suites run with CONTRACTOR_MANUAL off, since they test the hold machinery
  through the floor switch. Section 8: contractor jobs go from automatic on 3 floors to 2 a week at most (tested).
