STATUS: GREEN
JOB: 32 Empty states for floors with a past
DONE MEANS: "'Just moved in' is only for a floor that is genuinely new (no launches, no finished tasks ever). An established floor with no
  job cards yet shows its last real work, e.g. 'Last job finished 8d ago' (the same lastFinished logic as job 30), or 'Nothing on the
  timeline yet' when there is nothing. The same for the phone page's Timeline, the desktop Timeline tab and the status card's empty states."
  The live defect: LabStackr (floor 3, open for weeks, with launches) said "Just moved in. First job starts soon." on its phone Timeline.
  Job cards (job 12) only start with tasks changed after the deploy, and the empty Timeline always said "Just moved in".
  - server/jobcards.js floorHistory(): whether a floor is genuinely new and when its last job finished. A floor is new when it has no
    launch, no finished task and no finished job card, ever. lastFinished is the latest of a finished job card, a finished task and a
    launch. Tasks are read too, so work from before job cards counts. A visitor's copy leaves out private projects (and project-less
    work on a private floor); whether the floor is new is a fact about the floor. The floor's status now carries isNew and
    lastFinished, for the boss and visitors.
  - public/js/timeline-ui.js emptyLine(), the one empty line for every place. It says "Just moved in. First job starts soon." for a new
    floor, "Last job finished 8d ago." when there is a time, and "Nothing on the timeline yet." otherwise. The Timeline uses it (the
    phone's floor-lite page and the desktop Timeline tab draw the same renderTimeline), and so does the status card's empty state.
  - Home's Happening now (job 30) takes its "Last job finished" from the same floorHistory, so finished tasks from before job cards
    count there too. Its "latest of" replaces job 30's "first found" order.
TESTS: test/emptystate.test.js, 7 tests, all pass:
    - The live case: LabStackr on floor 3, two launches 20 and 12 days ago, tasks finished 9 and 8 days ago, no job cards. For the
      visitor and the boss: isNew false, lastFinished 8 days ago, the line "Last job finished 8d ago."
    - A brand-new floor is "Just moved in".
    - One launch alone, or one finished task alone, makes a floor established.
    - A visitor of a floor whose only work is private reads "Nothing on the timeline yet." while the boss reads "Last job finished 2d ago."
    - The line's four cases.
    - The Timeline and the status card share the one line, and the words live in one place.
    - Happening now's lastFinished equals the floor's.
  Changed: test/statuscard.test.js now checks that the card uses emptyLine. test/happening.test.js's fixture ages a job's tasks along
  with its card.
  Also run: statuscard, timeline, happening, home, jobcards, building and review, all passing.
  Browser check, LabStackr as on live:
    - Phone (390x844), floor-lite: Timeline "Last job finished 8d ago.", and the status card shows Now "Nothing under way" with Last
      shipped.
    - A new floor on the same phone: "Just moved in. First job starts soon." on both.
    - Desktop Timeline tab: "Last job finished 8d ago."
  npm test 1749/1751 (7 new). The 2 failures are the same two as jobs 24, 29 and 30: the IPv6 test (no IPv6 on the box) and
  test/launch.test.js "launch_check can't wipe what publishing recorded" with "claim failed 408" (a timeout while a browser check shared
  the CPU; the file passes 71/71 on its own).
DEPLOY NOTES: none (no migration, no env var). LabStackr and every floor like it change on the next page load.
RISKS: "Finished" for an old task is its updated_at with status done. A task touched after it was done (by a later edit) would read as
  finished later than it was; nothing in the app edits done tasks today.
