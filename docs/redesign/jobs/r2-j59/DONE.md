STATUS: GREEN
JOB: r2-j59 Fresh-eyes review
DONE MEANS: "A launch gets exactly one score, and a score under 3 creates exactly one fix job." Proved:
  - test/r2-launch.test.js "DONE MEANS: a launch gets exactly one score, on the review model, with desktop and phone pictures and the done-means
    lines; boss only": a real maker job launched (mock mode, media mock): one fresh_eyes row with score 4, exactly one call, given a desktop and a
    phone picture and the job's done-means lines, on media.review.model (never Fable); no fix job for a 4; the boss's snapshot has it, a visitor's
    does not; tapping Launch again on the same launch makes no second call and no second row; the call's cost is on the ledger (kind review).
  - "a score under 3 makes exactly one fix job; asking again for the same launch makes neither a call nor a job": a reply "SCORE: 2 ..." gives
    score 2 and one Builder task "Fix what a fresh look found on <project>" with the review as its brief; asking again for that launch returns
    nothing and makes no call and no task.
  - "the score is read from the first line; FRESH_EYES=0 makes no call".
How it works: server/fresheyes.js wraps engine.makers.launch: after a Launch that went through, in the background, it claims one fresh_eyes row for
  that launch (project + launched_at; INSERT OR IGNORE, so a second claim fails and nothing is called), takes a desktop (1280x800) and a phone
  (390x844, added to server/shooter.js as PHONE_SHOT) picture of the live page through the shots browser, and makes one call to media.freshEyes
  (server/media.js, the review model's own endpoint, a short prompt: "SCORE: n" first, at most three problems). Under 3: one assignTask to the
  Builder. The boss sees "Fresh look: n of 5" and the notes on the Launch tab (launch-ui.js); visitors never do.
TESTS: node --test test/r2-launch.test.js 11/11; makers 32/32, launch 71/71. Full npm test: see LANE-R2-A-FINISHED.md. Browser: not run for this
  job (server and prompt; the Launch tab line is a plain element shown from the boss's snapshot).
DEPLOY NOTES: Migration in the `// redesign r2 lane A` block: CREATE TABLE IF NOT EXISTS fresh_eyes (one row per launch, UNIQUE floor+project+launch).
  New env FRESH_EYES (default on). It needs the shots browser (SHOTS_CDP_URL) for its pictures: with none reachable the row says "No pictures could
  be taken, so there was no review" and no call is made. Files touched outside lane A's list: server/media.js (one new method, real and mock).
RISKS: The review model is OpenRouter's (media.review.model), so the call needs the OpenRouter key; without it media is off and there is no review.
  The score is read from "SCORE: n" on the first line (or "n/5"); a reply with no score keeps its notes and makes no fix job.
