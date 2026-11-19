STATUS: GREEN
JOB: 15 Status card
DONE MEANS: "A visitor sees state, goal, now, last shipped and next on every open floor."
  - The floor plaque is now the status card (public/js/status-card.js, drawn into the existing card slot): company and floor number (header),
    "Run by <boss>", the lane (Game / Website / Business), the state badge (job 2), Goal (the work-mode goal, else the current job's name),
    Now ("Step 2 of 3: Mina is on Make the second level", the live job card, job 12), Last shipped (screenshot thumbnail, name, how long ago),
    Next (the next step waiting to start), Visit website and Share. The boss's copy adds the one open question with reply chips (Yes / No /
    You decide, posted as the answer) and a message box to the manager. The weekly fuel gauge and Approve plan (jobs 20 and 21, on hold) have
    marked, empty, boss-only places (data-slot="fuel-gauge", data-slot="approve-plan"); nothing is drawn there.
  - The server adds `status` to every floor snapshot (server/jobcards.js statusFor): lane, goal, now, next, lastShipped, from task, job card,
    work mode and project rows only, no model call; a visitor's copy has private work taken out (redactor; a private project is never "last
    shipped"; private jobs read "Working on something private").
  - Visitors never see Numbers (boss-only tab), money, hours (job 2) or questions (not in a visitor snapshot; the card's question block is
    the boss's only). A floor with nothing yet: "Just moved in. First job starts soon."
  - Proof: test/statuscard.test.js: "a visitor gets state, goal, now, last shipped and next on an open floor; never a question, money or
    hours" (fixture job of 3 steps: lane Game, goal, "Step 2 of 3: ...", next, last shipped with thumbnail; a work-mode goal wins), "private
    work stays private on the card", "a new floor has nothing yet", and the page source check (fields, boss extras, empty state, the two
    marked slots, reply chips).
  Screenshots: docs/redesign/jobs/j15/shots/ (floor visitor and boss, desktop and phone; 0 console errors).
TESTS: npm test 1729/1730 (the one failure is the IPv6 test, environment). Browser: redesign-shots.mjs 14 shots, 0 console errors.
DEPLOY NOTES: none (no migration, no env var).
RISKS: Lane comes from the newest task with a lane (or an active business journey); a floor whose tasks have no lane shows none. Goal falls
  back to the current job's name when the floor has no work-mode goal. The reply chips send the chip's word as the answer; a question that
  needs more goes through the message box or the chat. On a phone the full floor page keeps the card in its About sheet; job 16 gives
  phones a card-first page.
