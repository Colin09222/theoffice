STATUS: GREEN
JOB: 26 Colon's ranked view
DONE MEANS: "Admin only. Floors ranked by real use per $100 (real visits and plays, plus sign-ups, sales and tapped calls on business floors,
  per $100 spent, last 7 and last 28 days; bots, bosses and Colon don't count; job 5's figures and the Numbers tab's counts). Show spend, the
  real-use figure and the last launch for each. Three buttons with a confirm step: Double down (marks the floor as a priority in the list
  and the digest; it changes no cap), Pause (the existing floor pause), Kill (pauses the team and takes the floor off public lists;
  reversible from the same view). Every press is logged with who and when. Nothing here sets a budget. DONE MEANS: admin lists floors by
  real use per $100 with the three buttons working in a test; non-admins get 403."
  - server/ranked.js: GET /api/admin/ranked lists every real floor (demo floors left out; active or suspended).
    For the last 7 and the last 28 days each floor gets:
      - spendUsd: the ledger, the same rows as job 5's record.
      - realUse: unique visitors + form sign-ups + Office Cloud accounts + orders, from the Numbers tab's own 30-day series (engine.numbers,
        so the counts are the ones the boss sees), plus tapped calls once job 33 records them (tapsSince reads its table).
      - perHundred: real use per $100 spent.
    Each floor also shows its last launch, its priority mark and whether it is killed. Best first by the 28-day figure, then the 7-day
    one. A floor with real use and less than half a cent spent leads ("no spend"); no use and no spend goes last. The last 30 presses
    come back as a log.
  - POST /api/admin/ranked/:id/:action. The action is one of double-down, undo-double-down, pause, resume, kill or unkill. The page's
    confirm dialog sends { confirm: true }, and a press without it is refused (400).
      - Double down sets floor_marks.priority. The list shows a "Priority" badge, and the owner's digest gets a first line, "Priority
        floors (double down): floor N <name>". No cap, setting or budget changes.
      - Pause and Resume are engine.pauseFloor and resumeFloor (the existing pause).
      - Kill records whether the floor was hidden or paused, then sets hidden=1 (off the directory, lift, ticker, Happening now,
        Launched wall and portfolio, which already leave hidden floors out) and pauses the team. "Bring back" restores exactly what it
        recorded, so a floor that was already paused stays paused.
    Every press goes into rank_log with the action, the floor, who ("admin" and the first 8 characters of the admin session's hash; the
    admin has one shared password, so there is no name to record) and when.
  - Non-admins get 403 on both routes, a visitor and a floor's boss alike, as the job asks. The rest of the admin answers 401.
  - The admin page (public/js/admin-ui.js) has a "Ranked by real use per $100" table under Floors. Its columns are spent, real use and
    per $100 for 7 and 28 days, then the last launch and the three buttons, each through the page's existing confirm dialog, and a line
    with the last presses.
  - Found and fixed while checking the page in a browser: a direct load of /theoffice/admin was blank on office-nobudget. showAdmin
    called stage.setView(null), and since job 14 no 3D stage is started on a page load, so it threw ("reading 'shadowMap'"). It now
    drops the stage's view only when a stage is running. The same error shows on office-nobudget before this job.
  Proved in test/ranked.test.js, 4 tests:
    - "floors ranked by real use per $100 over 7 and 28 days, with spend, real use and the last launch; bots don't count":
        - three floors with set visits, sign-ups and spend, ranked in the right order;
        - Cheap Hit $2 / 41 / about 2050, and Pricey Flop's 28 days $40 / 15 / about 37.5;
        - a Googlebot visit not counted and a person's counted;
        - the last launch named, no demo floor listed.
    - "each asks first, does its one thing, is logged with who and when, and none of them touches a cap":
        - 400 without the confirm;
        - priority in the list and in the digest's text;
        - pause, then resume;
        - kill takes the floor off /api/floors and its portfolio, and Bring back restores both;
        - the log reads double-down, pause, resume, kill, unkill, with who and when;
        - the caps, TASK_MAX_USD and the settings table are unchanged.
    - "a boss killed while already paused stays paused when brought back".
    - "non-admins get 403": a visitor and a boss, for the list and a press (the floor stays unhidden). The page code has the
      buttons, the confirm and the stage guard.
  Browser check, desktop 1440: log in, the ranked table lists both floors, Double down, confirm, then the Priority badge and "Last
  presses: double-down on floor 1 by admin cb36085b, ...". No console errors.
TESTS: npm test 1827/1828 (4 new). The 1 failure is domains.test.js's IPv6 test (EAFNOSUPPORT ::1: no IPv6 on the box; it fails the same on office-nobudget). Browser: the admin page check above. Changed: test/review.test.js's route sweep expects 403 instead of 401 for these two admin routes only
  (the job asks for 403).
DEPLOY NOTES: Migration (lane A block in db.js): tables floor_marks and rank_log. No env var. Nothing to run after deploy.
RISKS:
  - "Bosses and Colon don't count": visits on published sites are counted on the project's own origin, which never knows who is logged
    in, so a boss's or Colon's own visits can't be told apart there. They count once a day each at most (unique visitors), the same as
    on the boss's Numbers tab. Bots are left out, as before. Job 33's tapped calls do leave the boss and Colon out.
  - Sign-ups, accounts and orders count on every floor, not only business floors: they are zero where a floor has none, and adding them
    everywhere can't make a business floor look worse.
  - Kill uses the existing hidden flag. If the admin unhides a killed floor by other means (admin.mjs floors show), Bring back still
    restores what was there before Kill.
  - Lane B file touched: server/owneralerts.js gets the priority line in the digest (a few lines, no change to anything else in it).
  - Nothing found in round 1 code that limits spend in a forbidden way.
