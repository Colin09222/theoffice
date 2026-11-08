# Makers: three taps to a team that builds, tests and launches

A fresh floor shows **What are we making?** with four big buttons: **Game**, **App / SaaS**, **Website** and **Business**.

1. **Tap a type.** Then pick one of three idea cards, tap **Surprise me**, or type the idea in your own words.
2. **Tap the idea.** Name, goal and plan come filled in, and all of them stay editable.
3. **Tap Go.** The chat says the team is on it, and the maker card shows **Team is building** with every step.

The team runs its passes on its own. When the Tester passes a version, the card shows a big **Launch** button. That publishes the tested version and gives a share link (the system share sheet on a phone, the clipboard elsewhere). The .com offer stays optional: the manager offers to find one, and the boss approves it through the existing domain flow.

**Business** hands off to Business mode (`/business/start`) with the chosen idea, so that journey is unchanged.

## How it works

The flow upgrades the existing pipeline rather than running beside it.

- **Ordinary tasks for ordinary staff.** Every step is an ordinary task, so it uses the same engine, tools, ledger, computers and Tester as before.
- **No model call to start.** The plan is fixed, so the boss's pick goes in the chat as their words, the manager's reply is a template, and the tasks go straight onto the board.
- **No manager in the loop.** `server/makers.js` owns the loop. The engine calls `makers.afterTask` from `finishTask`; when it returns true, the manager isn't woken. That saves a manager call per step and stops the manager rearranging the passes.

### What happens to a job

1. **Starter.** It is copied into `projects/<slug>/`, so the Builder starts from code that already works:
   - games: `game-kit` plus `game-2d` or `game-3d`;
   - apps: `app`;
   - websites: `website`.
2. **Design doc** (`notes/design.md`). Written by the Designer for a game, or a spec by the Writer for an app or site. A game's doc has fixed headings:
   - core loop and controls;
   - progression past 10 minutes;
   - at least 3 mechanics or enemies, with when each appears;
   - a table of 8+ waves or levels;
   - 5+ upgrades or unlocks;
   - scoring, win and lose;
   - juice and audio;
   - phone controls;
   - the look;
   - what each pass adds.
3. **The first playable version**, built by the Builder. Then the **Tester** plays it.
4. **Up to 3 depth passes** (`passes.depth` in config). Each pass is a Builder task followed by a Tester task:
   - the Tester's bug list goes into the next Builder brief, along with any regressions and the done-rules not yet met;
   - regressions are listed first, as blockers.
5. **Decisions after every test.** `decide()` in `server/makers.js` is a pure function, unit-tested.

   | Situation | What happens |
   |---|---|
   | The Tester passes a version (no blockers, no failing browser rule, no regression) | It becomes **launchable** and is snapshotted |
   | Every done-rule passes | It stops early (**ready**) |
   | A regression | Blocks: not passing, and the snapshot stays at the last good version |
   | A pass fails twice in a row (`passes.failsBeforeAsking`) | It **asks the boss** instead of looping: Try again, Launch what works, or Stop. Also used when a Builder or Tester task fails twice |
   | Out of passes, or past `passes.maxJobTokens` model tokens since the start | Ready if something passed, otherwise ask the boss |

6. **Launch** publishes the snapshot (`maker_snapshots`), never a pass still being built, through the same pre-publish checklist and gate as `publish_project`. After launch, each later pass that passes the Tester updates the live version, and the chat says so.

Tables: `maker_jobs`, `maker_tasks` and `maker_snapshots`, made at boot. Routes are for the boss only, with CSRF and rate limits:
- `GET /api/floors/:slug/makers/ideas?type=`
- `POST .../makers/words`
- `POST .../makers/start`
- `POST .../makers/launch`
- `POST .../makers/decide`

The floor snapshot carries `makers` for the owner, and each step sends an owner-only `maker` event.

## Done-rules and quality bars

These are in `config/makers.json`, per type.

- Each rule has an id, its text, and `check` set to `browser` (machine-checked) or `judge` (judged by the Tester against the design doc).
- The bars are numbers the Tester and the Builder both see: `softlockSeconds 60`, `frozenSeconds 12`, `minFps 30` (`headlessMinFps 18`), `minMechanics 3`, `minPlayMinutes 10`, `phoneWidth 390`, and a page-weight budget.
- The Builder's and Tester's briefs are built from this file, so a change there reaches both.
- The review loop reads the Tester's `office-verdict` block from `TEST-REPORT.md`. That file never goes live.

## The Tester's browser half

`server/playtest.js` needs no model. It runs on the Tester's computer as `.office/playtest.mjs`, under Playwright, and in this repo's tests under CDP.

- **Games** are played at desktop and phone size:
  - menu, settings and back, then start;
  - keyboard, gamepad and touch must each move the player (a fake gamepad is injected before the page loads);
  - pause and resume;
  - 60 s of scripted plus random input;
  - soft-locks: play frozen for 12 s, game over that won't restart, or stuck on a choice or settings screen;
  - the frame rate;
  - game over on purpose, the saved best and a posted score through Office Cloud, then restart;
  - screenshots of the menu, pause, play and game over, for the model to judge.
- **Apps:** sign up, create, reload, sign out and back in, through the starter's `data-office` hooks; plus the phone layout. On a computer's local preview, Office Cloud isn't live, so those rules are reported as unknown rather than as passed.
- **Sites:** the phone layout, every link and in-page anchor, the meta tags, and a real form submission that must thank the visitor.

Results go to `playtest.json`, one value per browser rule. The Tester adds the judged rules and writes the verdict.

## Starters (`server/app-client/starters/`)

| Starter | What it is |
|---|---|
| `game-kit` (shared) | Boot, menu, play, pause, settings, help, leaderboard, game over, and a mid-run choice screen. Keyboard, touch (stick and A/B) and gamepad as one set of actions, with fast taps latched. Synthesised sound with mute and music. Saves and a shared leaderboard on Office Cloud. Juice: shake, hit-stop, tweens, easing. The `window.officeGame` test hook |
| `game-2d` | Phaser 3.90 (vendored, MIT, served as `_office/phaser.min.js`). An arena with waves, chasers, dashers that telegraph, splitters, shooters, gems, a pulse, upgrades between waves, and a win at wave 10. Particles, shake, hit-stop and flashes |
| `game-3d` | three.js (vendored). A floating arena with the same loop, pooled particle points, shadows and fog |
| `app` | A landing page, sign-up and sign-in on Office Cloud accounts, a private list with create, edit, done and delete, empty, loading and error states, settings on the account, and a "coming soon" payments hook |
| `website` | Sections, a skip link, full SEO and OG meta, and a contact form posting to Office Cloud with a spam trap. `COMPANY_EMAIL.notify` in `site.js` is the one-line hook for company mail |

All starters pass the pre-publish checklist with no errors or claims (unit-tested). Licences are in `NOTICE`.

## Cost sense

- **Models.** Opus only where `config/models.json` says: Builder, Designer, Illustrator. The Writer and Tester are on Sonnet. Starting a job costs no model call.
- **Prompt caching.** Prompt caching is on for every Claude call (`buildRequest` in `server/anthropic.js`). The per-type playbook text sits in the cached system prompt (`laneBrief`, now with an `app` lane). Only the per-task brief changes between calls.
- **Caps.** Passes are capped by `passes.depth` and `passes.max`, and model tokens by `passes.maxJobTokens`. Each task keeps the existing per-task limits. A pass that fails twice asks the boss.

## Tests

- `test/makers.test.js`, in the node suite:
  - ideas, tailoring, Surprise me and own words;
  - parsing the verdict;
  - every branch of the loop: pass, stop early, bug list, regression, fails twice, caps;
  - every starter against the checklist;
  - the routes' owner checks;
  - a full mock run from three taps to Launch;
  - a failing job that asks the boss and is stopped.
- `node test/browser/makers.mjs`, in real Chrome, mock mode:
  - the 3-tap launch on a phone and on a desktop, through Launch and a share link that opens;
  - each starter published to its own origin and put through the playtest: both games for 60 s at both sizes, saving and posting to Office Cloud;
  - the app end to end;
  - the site's layout, links, meta and form.
- `MAKERS_SECONDS` shortens the runs, and `MAKERS_OUT=dir` saves four pictures.

## Deploy

Nothing new to set. The tables are made at boot, Phaser is served from `public/vendor/phaser/`, and computers get `.office/playtest.mjs` (Tester) and `.office/phaser.min.js` (game jobs). The old lane buttons are replaced by the launcher; typing in the chat still works as before.

## Not done

- The playtest's model half (judging screenshots) is the Tester's own model call; it was not run against a real model here.
- On a computer, app accounts can't be checked before publishing, because Office Cloud runs only on the project's origin.
