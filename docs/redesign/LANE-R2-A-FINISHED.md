# Lane A, round 2: finished

One line per job: job, branch, status, head SHA. Each branch is stacked on the one above it, the first on office-r2-base, and ends on that job's DONE
commit (docs/redesign/jobs/r2-jNN/DONE.md has the proof, deploy notes and risks). The head of this lane, with every fix below, is this file's commit
on office-r2-j71-photo (also claude/office-redesign-r2-lane-a-a7s9se).

| Job | Branch | Status | Head SHA |
|---|---|---|---|
| r2-j31 Lived-in idle floors | office-r2-j31-idle | GREEN | e24ce0307b4ec52b3f6706b211b4e0e82c859845 |
| r2-j32 Framed launches | office-r2-j32-frames | GREEN | a6b874ed0ffbe6a50ee0a775730507e636cb0ba1 |
| r2-j39 State-true poses | office-r2-j39-poses | GREEN | 9aa2da55f10251a5a38804afcc041cd5f05d3d12 |
| r2-j40 Result beats | office-r2-j40-beats | GREEN | d9a530586064c30e27d058526c67bba5a1e24238 |
| r2-j41 Whiteboard plan | office-r2-j41-whiteboard | GREEN | 558cbebab5aa0ccffb164b6a47f03072b7b53fd4 |
| r2-j42 Paper piles and trophies | office-r2-j42-piles | GREEN | 840bc4c2198c04df95c3b610f286ccb49de3cc21 |
| r2-j44 Phone hard budget | office-r2-j44-budget | GREEN | f0c24c7e539fafbc3a841b10ff3fc26de3a376a1 |
| r2-j45 Auto quality | office-r2-j45-quality | GREEN | df7928e46679a04c69b2f3b6843556e57561e1b6 |
| r2-j46 Camera follow and drift | office-r2-j46-camera | GREEN | dc106434bf76a19c17ce5bea5582c4a9adda0e79 |
| r2-j47 Job event log | office-r2-j47-eventlog | GREEN | 935979b60c68fb0cf995523705f9085a0a56fd93 |
| r2-j48 Replay | office-r2-j48-replay | GREEN | 367a9346a903f7c4600dfbc8dca9dc20cbd8ba66 |
| r2-j57 Launch checklist | office-r2-j57-checklist | GREEN | 7c14518986b142b89012875e4ddc4bfee318d050 |
| r2-j58 CHECKED mark | office-r2-j58-checked | GREEN | 537afd8bf0aba3a74b5ef2f78002002edcd57776 |
| r2-j59 Fresh-eyes review | office-r2-j59-fresheyes | GREEN | 39b4f573973378492c026b824e492387b158c233 |
| r2-j60 Share cards | office-r2-j60-sharecards | GREEN | 1ff29b16e169b6ea32e7370fb405eee07797cb45 (the DONE commit a6..., then the first naming fix) |
| r2-j63 Upkeep rounds | office-r2-j63-upkeep | GREEN | 7500870b31fe899c0cf8181d70efc9dae069ec8b |
| r2-j67 Milestones and real counts | office-r2-j67-counts | GREEN | b8e0a71944c20f1ab6f418c869b80cdbffc39afa |
| r2-j69 Building library | office-r2-j69-library | GREEN | a6f7803b4f3dcb67b77c8f1168c11c05530fc2e4 |
| r2-j70 Feedback button (OFF by default) | office-r2-j70-feedback | GREEN | 3feef475141d6f055d4d5f6ad9b08f70ed2d3ccb |
| r2-j71 Photo button | office-r2-j71-photo | GREEN | see the head below |

## Fixes after the jobs (on the head; earlier branches do not have them)
- 1ff29b1 and 95204ca (the orchestrator's names): the phone limits never put "budget" in a snapshot key or a page literal: room.phoneFit (cfg.phoneBudget,
  env PHONE_BUDGET and ?budget=0 unchanged), view.fit, fitPhone(); and test/review.test.js lists the deliberately public routes
  /api/floors/:slug/replay, /api/floors/:slug/sharecard and /api/floors/:slug/sharecard.html in OPEN_GET (at the end of the list here, since this
  branch has no /api/building/live line: a one-line merge there). Branches r2-j44 to r2-j59 still have the old names.
- 32f8013: the launch checklist no longer holds a form the page handles itself (an app's input, a search box); r2-j57 to r2-j71's branches had it
  holding real maker launches (live-check.test.js, short-labels.test.js). The CHECKED stamp uses the palette's teal (skin.test.js).
- This commit: the r2-j42 browser check pauses its floor so its queued jobs stay queued while it looks.

## Tests
- npm test on the head (32f8013 plus this file and a browser-check fix): 1916/1918. The 2: domains.test.js "...over IPv4" (no IPv6 on this
  machine; fails the same on office-r2-base) and shop.test.js "the manager hears there was a sale" (it bans the digits 38 in the note and that run's
  random order number was CC16-7385; 18/18 on two reruns). Earlier full runs: r2-j31 tree 1858/1860, r2-j41 tree 1871/1872 (only IPv6).
- Browser: test/browser/room-r2.mjs (npm run e2e:room2), headless Chromium, one check group per job. Every check passed for its own job; run again
  in groups at the end: 64 ok across j31 to j46, j48, j58, j60, j67, j69, j70, j71; j40 and j42 passed in a separate run (the first group ran out of
  its 20 minutes on this software renderer; the j42 check was then made race-free). Software rendering here runs the room at a few frames a second,
  so several checks step the room's own update() by hand; DONE files say where.

## For the orchestrator
- Migrations: one `// redesign r2 lane A` block in server/db.js (LANE_A2_SCHEMA): job_events, launch_checklists, fresh_eyes, share_cards,
  upkeep_runs, upkeep_fixes, upkeep_notices, library_entries, app_feedback. CREATE ... IF NOT EXISTS only.
- Env (server/lanea2-config.js, all in .env.example), default on unless said: IDLE_LIFE, ROOM_FRAMES, RESULT_BEATS, ROOM_WHITEBOARD, ROOM_PROPS,
  PHONE_BUDGET, ROOM_CAMERA, JOB_EVENTS, JOB_EVENTS_DAYS (35, min 30), REPLAY, LAUNCH_CHECKLIST, FRESH_EYES, SHARE_CARDS, UPKEEP, REAL_COUNTS, LIBRARY,
  LIBRARY_SEED_FLOORS (empty; set to Colon's floors, e.g. 6, before the first start), ROOM_PHOTO, and FEEDBACK_BUTTON = 0 (OFF until Colon says yes).
- After deploy: Colon approves the library's seed entries in admin (nothing is readable until he does). Share cards and fresh eyes need the shots
  browser (SHOTS_CDP_URL, SHOTS_ORIGIN); without it share cards are a plain card and there is no fresh-eyes review. Replay plays only jobs run after
  r2-j47 is live. The first Tuesday 09:00 New York after deploy runs upkeep on every live site.
- Other lanes' files touched, briefly: server/engine.js (the check event, r2-j40), server/building.js (one line, r2-j58), server/media.js
  (freshEyes, r2-j59), server/tools.js (two library tools), public/js/admin-ui.js (library section), server/numbers.js and numbers-ui.js (feedback),
  server/app.js (installs, the floor-link preview, the feedback route and script), test/review.test.js (OPEN_GET).
- No budget rules anywhere; model calls the spec asks for (fresh eyes, upkeep fixes) go on the ledger with no limit.
