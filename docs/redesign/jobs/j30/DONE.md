STATUS: GREEN
JOB: 30 Happening now from job cards
DONE MEANS: "The home's Happening now shows real work only: at most 5 lines, newest first, one line per job from job 12's job cards
  (updated in place), old events only as a fallback and only when they are real work, never the same line twice, no status pings, and
  nothing older than 24 hours; with nothing happening it says 'Quiet right now. Last job finished 2h ago.' with the real time. The same
  rule for the status card's Now and the visitor ticker if it still exists. Tests with fixtures matching the live case."
  The live defect: after job 14 went live the strip showed "TheTireRx · Tess picked the next job to work on" five times, 14 to 24 hours
  old. It read the building ticker, which carries every feed line (work mode's ping "picked the next job to work on" included), with no
  age limit and no check for repeats. A launch could also fall out of it: the ticker pins a launch, but the strip's newest-first sort put
  it behind newer chatter.
  - New GET /api/building/now (server/building.js, happeningNow): public, no cookie, the same floor rules as the ticker (active, not
    hidden, no demo floors unless DEMO_FLOORS_PUBLIC=1, no private project or private floor).
    Lines come from three sources:
      - Job cards: one line per job, keyed job:<card id>, so a job that moves on changes its own line. Cancelled jobs are left out.
      - Launches: a line of their own.
      - Old feed lines: only for a floor with no job card in the window, and only when isRealWork() says a piece of work moved
        (started, finished, could not finish, published, a task given out, approved, sent back, the brief changed, handed to the
        contractor, legal pages, a domain bought or pointed). Anything else is a ping and never shows: "picked the next job to work
        on", "looked over the day's work", round reports, "nothing new", retries, pauses, the staff going home, people joining.
    Nothing older than 24 hours counts. The same words from the same floor show once, newest first, five at most.
    lastFinished is when the last job really finished: a finished job card's done_at, else a real "finished" feed line, else a launch.
    Pings never move it.
  - The home page (public/js/lobby-ui.js) reads /api/building/now instead of the ticker. It keeps one row per line id and changes it in
    place on each 15 s refresh. With no lines it shows "Quiet right now. Last job finished 3h ago." from lastFinished, or "Quiet right
    now." when nothing has ever finished. It no longer uses the directory's lastActive, which pings moved too.
  - The status card's Now (server/jobcards.js statusFor, and public/js/status-card.js for the page's live copy) takes only an open job
    touched in the last 24 hours; an older one shows as "Nothing under way". The same for the boss and visitors.
  - The visitor ticker: no page draws one any more (job 14 replaced it with Happening now). /api/building/ticker is unchanged, because
    its own tests and the launch parties (server/life.js) read it as it is; nothing on screen shows its raw lines.
TESTS: test/happening.test.js, 9 tests, all pass:
    - The live case: TheTireRx, manager Tess, five "picked the next job to work on" lines 14 to 24 hours old and a last real job 30
      hours ago give no line, the quiet strip, and lastFinished from that job.
    - The same pings an hour old (plus "looked over the day's work" and a pause notice) still give no line.
    - One line per job, newest first, the line updated in place as the job moves on (Step 2 of 3 to Step 3 of 3, same id).
    - Five lines at most, a job untouched for 25 hours left out.
    - Private work, a private floor and demo floors left out.
    - The feed fallback: real work only, a repeated line once, and a 30-hour-old line left out.
    - A launch beside the job that made it.
    - What isRealWork accepts and refuses.
    - The status card's Now: empty for a job untouched for 26 hours (boss and visitor), back once it moves.
  Also run: building, help, review (the route sweep now lists /api/building/now as public), life, look, statuscard, jobcards, home and
  portfolio tests, all passing. Browser: test/browser/home.mjs 10/10 (its "feed fails" step now fails /api/building/now, the strip's new
  source). A browser check of the live case on a 390x844 phone: five old pings and a job done 26 hours ago show "Quiet right now. Last job
  finished 1d ago."; a job starting shows its one line, "1 TheTireRx · Step 1 of 1: Write the price list · just now".
  npm test 1742/1744 (9 new). The 2 failures are the same two as jobs 24 and 29: the IPv6 test (no IPv6 on the box) and
  test/launch.test.js "launch_check can't wipe what publishing recorded" with "claim failed 408" (a timeout while a browser run shared the
  CPU; the file passes 71/71 on its own).
DEPLOY NOTES: none (no migration, no env var). After deploy the home's strip on live should show the quiet line or real job lines; the
  five TheTireRx pings go at once (they are pings and over a day old).
RISKS: The real-work list is an allow-list of the feed's own phrasings (server/building.js REAL_WORK). A new kind of feed line counts only
  once it is added there, so a new ping can't slip in, but new real work shows only through its job card until it is listed. Job
  cards cover every task the manager hands out, so in practice the fallback matters only for floors from before job 12.
  /api/building/ticker still carries pings for anything that reads it directly; nothing on screen does.
