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
4. **Depth passes, at least `minDepthPasses` for the type** (game 3, app 1, website 1, per `passes.depth` and each type's `minDepthPasses` in config). A job runs them even when every done-rule already passes. Each game pass has its own job (`passJobs`): more mechanics and content, then progression and meta, then balance, onboarding, juice and audio. Each pass is a Builder task followed by a Tester task, and the Tester re-checks the late game (final boss, win screen) on a debug copy that never ships:
   - the Tester's bug list goes into the next Builder brief, along with any regressions and the done-rules not yet met;
   - regressions are listed first, as blockers.
5. **Decisions after every test.** `decide()` in `server/makers.js` is a pure function, unit-tested.

   | Situation | What happens |
   |---|---|
   | The Tester passes a version (no blockers, no failing browser rule, no regression) | It becomes **launchable** and is snapshotted |
   | Every done-rule passes and the minimum depth passes ran | It stops (**ready**), and the passes left over show as skipped |
   | An open major or blocker bug (or a cheat left in the build) | Launch is **held**, the team goes straight to a **fix pass** (no depth pass used), and after two failed fixes the boss chooses: keep trying, or launch anyway with a clear warning |
   | A regression | Blocks: not passing, and the snapshot stays at the last good version |
   | A pass with no serious bug fails twice in a row (`passes.failsBeforeAsking`) | It **asks the boss** instead of looping: Try again, Launch what works, or Stop. Also used when a Builder or Tester task fails twice |
   | Out of passes, or past `passes.maxJobTokens` model tokens since the start | Ready if something passed and nothing serious is open (any skipped passes say so on the card), otherwise ask the boss |

6. **Before Launch**, nobody else publishes the project: the manager's "still not live" nudge skips it (`makers.holds`). A report counts only if it was written during that test, so a stale `TEST-REPORT.md` can't pass a new version.
7. **Launch** publishes the snapshot (`maker_snapshots`), never a pass still being built, through the same pre-publish checklist and gate as `publish_project`. After launch, each later pass that passes the Tester updates the live version, and the chat says so.

Tables: `maker_jobs`, `maker_tasks` and `maker_snapshots`, made at boot. Routes are for the boss only, with CSRF and rate limits:
- `GET /api/floors/:slug/makers/ideas?type=`
- `POST .../makers/words`
- `POST .../makers/start`
- `POST .../makers/launch`
- `POST .../makers/decide`

The floor snapshot carries `makers` for the owner, and each step sends an owner-only `maker` event.

## Setup: the first run of a fresh floor

A floor with no company name (`floor.setup`) gets a full-screen Setup instead of the launcher in the chat: `public/js/setup-ui.js` and `public/css/setup.css`, opened by the single hook in `floor-ui.js`'s `mount()`. It shows the one-time recovery code first (when the boss has just claimed the floor), then the launcher's three questions: What are we making, Which one, Ready. It uses the launcher's endpoints through helpers exported from `launch-ui.js`. The only additions are optional `company` fields on `POST /makers/start` and `POST /business/start`: on a nameless floor the server saves that name through the manager's own `set_company` (`engine.company.setCompany`) before the work starts.

- Only the boss of a nameless floor sees it, and only while they haven't spoken to the manager and nothing has started. Named floors keep the launcher in the chat.
- "I'd rather just tell the manager" closes it for good on that device, and the chat shows a note in place of the launcher.
- The boss's place is kept in `localStorage` per floor, so leaving (lobby, reload, the phone's Back) and returning lands on the same step with what they typed. The recovery code is never stored.
- Back is on screen; the phone's own Back gesture leaves the floor like any page and returning restores the step.
- "Make something new" on a maker card opens the same flow, full screen, with Back returning to the card.

## Done-rules and quality bars

These are in `config/makers.json`, per type.

- Each rule has an id, its text, and `check` set to `browser` (machine-checked) or `judge` (judged by the Tester against the design doc).
- The bars are numbers the Tester and the Builder both see: `softlockSeconds 60`, `frozenSeconds 12`, `idleHurtSeconds 30`, `idleLoseSeconds 60`, `idleSafeSeconds 10`, `minFps 30` (`headlessMinFps 18`), `minMechanics 3`, `minPlayMinutes 10`, `phoneWidth 390`, and a page-weight budget.
- **`pressure`** is the games' browser rule for an opening that is too gentle: a player who does nothing is hurt within `idleHurtSeconds` and has lost within `idleLoseSeconds`, and nobody loses in the first `idleSafeSeconds`. It is measured, not judged (see the idle run below). The Tester's verdict carries the two numbers in an `idle` field, and `decide()` goes by them whatever the Tester ticked: past a bar is a failing browser rule, so Launch is held and a fix pass follows with the numbers in the Builder's list.
- The Builder's and Tester's briefs are built from this file, so a change there reaches both.
- The review loop reads the Tester's `office-verdict` block from `TEST-REPORT.md`. That file never goes live.

## The Tester's browser half

`server/playtest.js` needs no model. It runs on the Tester's computer as `.office/playtest.mjs`, under Playwright, and in this repo's tests under CDP.

- **Games** are played at desktop and phone size:
  - menu, settings and back, then start;
  - keyboard, gamepad and touch must each move the player (a fake gamepad is injected before the page loads). Each check starts from play and gets a second go, because a game can pause itself on a focus change;
  - **the idle run**, first, on a fresh run: no input at all, timed until the player is first hurt and until game over. It fills the `pressure` rule (`idleVerdict`). Time is counted only in play, so a choice screen costs nothing (its first option is picked), and in the game's own clock (the hook's `t`) when it has one, so a slow machine doesn't make a game look gentler. It stops at game over or at `idleLoseSeconds`. A run cut short is reported as unknown, not as failed;
  - pause and resume;
  - scripted plus random input for the rest of the 60 s, and never less than 30 s, so the idle run adds at most half a minute a size;
  - soft-locks: play frozen for 12 s, game over that won't restart, or stuck on a choice or settings screen;
  - the frame rate;
  - a hook that has no `lives`, `health`, `hp` or `hurts` can't say when the player was hurt, so then only the time to game over is judged, and the notes say so;
  - game over on purpose, the saved best and a posted score through Office Cloud, then restart;
  - screenshots of the menu, pause, play and game over, for the model to judge.
- **Apps:** sign up, create, reload, sign out and back in, through the starter's `data-office` hooks; plus the phone layout. On a computer's local preview, Office Cloud isn't live, so those rules are reported as unknown rather than as passed.
- **Sites:** the phone layout, every link and in-page anchor, the meta tags, and a real form submission that must thank the visitor.

Results go to `playtest.json`, one value per browser rule, plus `idle` for a game: the two numbers (the slower size for each) and each size's own. The Tester adds the judged rules and writes the verdict.

A game's Builder gets the same `.office/playtest.mjs` in its box and is told to run it before handing over, so a failing browser rule is found in the build task rather than by a Tester round, a fix pass and a re-test.

## Starters (`server/app-client/starters/`)

| Starter | What it is |
|---|---|
| `game-kit` (shared) | Boot, menu, play, pause, settings, help, leaderboard, game over, and a mid-run choice screen. Keyboard, touch (stick and A/B) and gamepad as one set of actions, with fast taps latched. Synthesised sound with mute and music. Saves and a shared leaderboard on Office Cloud. Juice: shake, hit-stop, tweens, easing. The `window.officeGame` test hook: `state()` carries `lives` from the game, and `hurts` (counted by `playerHurt()`) and `won` from the kit, which is what the idle run reads |
| `game-2d` | Phaser 3.90 (vendored, MIT, served as `_office/phaser.min.js`). An arena with waves, chasers, dashers that telegraph, splitters, shooters, strikes that land where the player stands (from 11 s, so standing still is never safe), gems, a pulse, upgrades between waves, and a win at wave 10. Particles, shake, hit-stop and flashes |
| `game-3d` | three.js (vendored). A floating arena with the same loop and the same strikes, pooled particle points, shadows and fog |
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
  - a failing job that asks the boss and is stopped;
  - "Stop all" mid-job becoming a question, and Try again starting over from the design doc;
  - the manager never being nudged to publish a maker project before Launch.
- `test/pressure.test.js`, in the node suite: the `pressure` rule and its bars in the config and in `server/playtest.js`; the verdict from an idle run's numbers; the idle run itself against a made-up game on a made-up clock (lives, health, hurts, an older hook, choice screens, a slow machine, a win); `decide()` acting on the rule and on the numbers; the briefs and the game playbook naming the bars.
- `node test/browser/makers.mjs`, in real Chrome, mock mode:
  - the 3-tap launch on a phone and on a desktop, through Launch and a share link that opens;
  - each starter published to its own origin and put through the playtest: both games for 60 s at both sizes, idle run included, saving and posting to Office Cloud;
  - the app end to end;
  - the site's layout, links, meta and form.
- `MAKERS_SECONDS` shortens the runs (the idle run is always timed in full), and `MAKERS_OUT=dir` saves four pictures.

## Deploy

Nothing new to set. The tables are made at boot, Phaser is served from `public/vendor/phaser/`, and computers get `.office/playtest.mjs` (Tester) and `.office/phaser.min.js` (game jobs). The old lane buttons are replaced by the launcher; typing in the chat still works as before.

## Not done

- The playtest's model half (judging screenshots) is the Tester's own model call; it was not run against a real model here.
- On a computer, app accounts can't be checked before publishing, because Office Cloud runs only on the project's origin.
- The kit's `fps` is worked out from frame times capped at 50 ms, so it never reads under 20 and the `headlessMinFps 18` bar can't fail. It was left alone here: making it honest would start failing games on slow test machines, which needs trying on a real one first.

## Proof (Node 22, `AI_MODE=mock`, no model calls)

- **Node suite:** 1501/1502 (`npm test`, with `test/pressure.test.js` at 28/28). The one failure is `test/domains.test.js` listening on `::1` on a machine with no IPv6; nothing here touches it.
- **`node test/browser/makers.mjs`, full 60 s runs:** 56/56.
  - The 3-tap launch passes on a phone and on a desktop, through Launch to a share link that opens.
  - Both games pass every browser rule at desktop and phone size, `pressure` included, with a saved best and a posted score on the server.
  - The app passes sign up, create, reload, and sign out and back in, at both sizes.
  - The site passes the phone layout, links, meta and the form.
- **The idle run on the starters,** seconds of play, before and after the strikes went in:

  | Starter | Before: first hurt / game over | After: first hurt / game over |
  |---|---|---|
  | `game-2d` desktop | 32 to 39 / 38 to 43 (fails the hurt bar) | 11.5 to 12.4 / 21.7 to 26.7 |
  | `game-2d` phone | 28.7 to 28.9 / 32 to 36 | 11.6 to 12.2 / 21.1 to 29.2 |
  | `game-3d` desktop | 33 or never / not in 59 to 67 s watched | 12.1 to 13 / 21.6 to 26.5 |
  | `game-3d` phone | 31.5 or never / 34 or not in 60 s | 12.2 to 12.7 / 22 to 26.4 |

  Before, an idle player in `game-3d` also won the whole game once in real time (wave 8 cleared by the auto-fire, 135 s in) and was still alive after 150 s in another run.
- **The copy on a computer** (`playtest.js` plus `playtest-box.mjs` as one file) was run under real Playwright against `game-2d` laid out as a Tester's box: every browser rule true, `idle: { hurt: 11.6, lose: 25.7 }` in `playtest.json`.
- The test machine was shared and slow (games ran at 30% to 90% of real speed), which is why the idle run uses the game's own clock. Frame rates from this run mean nothing and are left out.
- Found on the way and fixed: `STATE?.scene === 'play'` in `playtest.js` was always true (the conditional swallowed the test), so "restart works" and "pause is reachable" were never really checked; they are now, and the starters pass. The 3D starter's particles never showed (colours never uploaded, `NaN` heights); they do now.
- **Screenshots:** four, in `media/out/office-makers/` (from before the strikes).

## After Launch

Right after Launch, and after every automatic update of a launched job, the server goes to the live link and checks it the way a player's browser would (`server/live-check.js`): the page, a save written and read back, a score on a hidden board, and that the shipped game really calls saves and the leaderboard. Office Cloud can't run on the Tester's local preview, so this is where it is proved. A failure goes to the team as a major bug and starts a fix pass, at most twice; if the link can't be reached at all, nothing is reported, because the team couldn't fix that.

A launched project gets the short address `<project>.middistance.com` when that name is free and not reserved (`RESERVED_LABELS` in `server/apps.js`); otherwise it stays on `<project>--<floor>`. Both keep working for good.
