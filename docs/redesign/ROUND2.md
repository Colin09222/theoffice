# Office redesign, round 2: jobs r2-j31 to r2-j72

The spec is `docs/redesign/OFFICE-ANSWERS-2.md` (approved by Colon, the owner). Read it all, then this file, then `docs/redesign/COMMON.md`:
every rule in COMMON.md still applies except where this file changes it. `docs/redesign/r2/office-now-*.png` are screenshots of the live
site before round 2 (home on desktop, floor 6's room, home on a phone). Start from branch **`office-r2-base`** (live main after round 1).

## Names (changed from COMMON.md)
- Round 1 already used j31 and j32, so round 2 jobs are **r2-jNN**: branch `office-r2-jNN-<slug>` (e.g. `office-r2-j31-idle`), done file
  `docs/redesign/jobs/r2-jNN/DONE.md` (same format as COMMON.md; `JOB: r2-jNN <name>`).
- Stack every job on the previous job of your lane (the first on `office-r2-base`). Push to exactly that branch name after each green commit.
- Lane migrations: one block in `server/db.js` marked `// redesign r2 lane A` or `// redesign r2 lane B`. Additive and idempotent only.
- Finish: `docs/redesign/LANE-R2-<A|B>-FINISHED.md` on your last branch, one line per job (r2-jNN, branch, STATUS, head SHA).
- Keep going through your whole list without stopping to ask. Unclear: take the reading closest to the spec's words, note it under RISKS.

## Owner decisions (spec section 8: every recommendation is taken)
Replay is built and shipped before the buddehbot mailroom. Visits are a light on the tower. Milestones, not levels. The Friday feature is praise
only, no ranked list anywhere. buddehbot is the boxy robot in Ink and Slate with a name plate reading "buddehbot". Sound is off by default.
Colon approves library entries himself: build the approval step, never auto-publish. The heartbeat reuses the existing Mac heartbeat (below).

**There are still no budget rules anywhere.** No spend limits, gates, budgets, reserves, fuel gauges or price approvals, and no change to caps or
`floorLimits`. Model calls the spec asks for (fresh-eyes, upkeep fixes, proposals) run with no new dollar limit. Recording cost is fine.

## Things that must ship switched OFF (they reach people outside the building; the orchestrator turns them on after Colon says yes)
- r2-j61 boss alert emails and r2-j62 weekly report emails: `BOSS_ALERTS` and `WEEKLY_REPORT_EMAIL`, **default 0**. With 0, nothing is sent and
  nothing is queued to send later; with 1 they work as the spec says. Tests run with them on.
- r2-j70 feedback button on launched sites (it changes what the public sees on real customer sites, e.g. TheTireRx): `FEEDBACK_BUTTON`, **default 0**.
- r2-j69 library: nothing enters the library without Colon's tap in admin, including the seed entries (seed them as waiting entries).
- Everything else follows COMMON.md (env switch, default = the new behaviour).

## The lanes
Lane A owns **the floor room** (`public/js/office-scene.js`, `cast.js`, `life.js`, `stage.js`, `character.js`, `floor-ui.js`, the timeline,
`cutaway.js`) plus launch quality and the library on the server. Lane B owns **the building and home** (`public/js/lobby-scene.js`,
`lobby-ui.js`, `main.js`, `sfx.js`, the status card) plus the mailroom, alerts and reports on the server. Touch the other lane's files only
when you must, keep it small, and say so in DONE.md. Lighting (r2-j35) belongs to lane B but has to switch the room's lamps too: lane B adds
one small exported hook in the room (`setRoomLights(on)` or similar) and lane A leaves it alone.

Every job's DONE MEANS is the spec's section 6 line, proved by a test (fake clock, fake records, mock mode). Visual jobs: a node test of the
state logic plus, if a browser is available, a browser run; say in DONE.md if none could run. Reduce motion and phone "low" follow spec Q9's table.
Part A and C visuals make **no model calls** (spec section 7).

### Lane A, in this order
1. **r2-j31 idle** Lived-in idle floors (Q4 idle rule).
2. **r2-j32 frames** Framed launches (Q5a). Real screenshots from the screenshot service; floor 6 shows TheTireRx.
3. **r2-j39 poses** State-true poses (Q4).
4. **r2-j40 beats** Result beats, real task events only.
5. **r2-j41 whiteboard** The current weekly plan (round 1 job 20, `weekly_plans`) or the current goal's jobs, up to 5, one tick per job done.
6. **r2-j42 piles** Paper piles and trophies (Q5c, d): milestones are first launch, 100, 1,000 and 10,000 real visits (the counts the launch cards use).
7. **r2-j44 budget** Phone hard budget (Q9 numbers).
8. **r2-j45 quality** Auto quality: frame test, levels, drop once; **check `cutaway.js`** and write what it does and whether it is the fallback.
9. **r2-j46 camera** Camera follow (desktop) and idle drift (phone), with the Follow the work switch.
10. **r2-j47 eventlog** Job event log: every job keeps its events with times (job cards, task events, handoffs, checks, launch) for at least 30 days.
11. **r2-j48 replay** Replay (Q24 idea 1): an idle floor offers "Watch how this was made", plays its last real job in 30 to 60 s from the j47
    log with the real timeline cards and screenshots, label "Replay · <weekday> <HH:MM>" always visible; phone low = cards and screenshots only.
12. **r2-j57 checklist** Launch checklist (Q11 a): 8 checks by code; 3 block the Launch tap; work in progress still publishes.
13. **r2-j58 checked** CHECKED 8 of 8 mark on the launch plaque and card (a stamp, not a character; never a buddehbot stamp).
14. **r2-j59 fresheyes** Fresh-eyes: exactly one call per launch on the review model already used for reviews (not Fable), desktop + phone
    screenshot + done-means lines, score 1 to 5 shown to the boss only; under 3 makes exactly one fix job; never a second score.
15. **r2-j60 sharecards** Share cards (Q8 b): 1,200 x 630 under 200 KB, remade on each launch and weekly, served as the floor link's preview image.
16. **r2-j63 upkeep** Upkeep rounds (Q10 a): Tuesdays 09:00 New York time, code checks; a model only when a check fails; max 3 fixes per site
    per week; renewal warning 30 days ahead. Respect the floor's paused state and round 1's per-floor `plan off` switch only as the spec says
    (TheTireRx, floor 6, is on upkeep only, so upkeep must run there). Anything public outside the site always needs a boss tap.
17. **r2-j67 counts** Milestones and real counts (Q15): bean ID cards show jobs finished and launches worked on; plaque shows launches and visits.
18. **r2-j69 library** Building library (Q14 b, all 7 rules). Admin approval with one tap per entry; scrub by code; read-only and fenced for bots.
19. **r2-j70 feedback** Feedback button (Q24 idea 3), **FEEDBACK_BUTTON default 0** (above). Results in the Numbers tab, fenced before any bot reads.
20. **r2-j71 photo** Photo button: 1,920 x 1,080 PNG, no UI, floor name and date in the corner; hidden on phone low.

### Lane B, in this order
1. **r2-j33 hero** Hero card crossfade (up to 3 real screenshots, 4 s, 0.6 s fade, only the card in view) and the pulsing dot for Working floors on phones.
2. **r2-j34 sound** Sound off by default; the choice is remembered; silent when the tab is hidden.
3. **r2-j35 light** Real New York light (Q2): dawn, day, golden hour, night by a sunrise/sunset formula, 20 min blends, 23:00 to 08:00 room lights
   and desk lamps off on every floor with the crown sign, billboard, street lights and visit sign lights still on. Desktop and phone low per Q9.
4. **r2-j36 tower** Activity feed and live tower (Q1): room light = work (brighter while a job runs, 0.8 s flash on a launch), visit sign light =
   real visits in the last 24 h in 4 levels; a small public activity feed (no money, no private work). Phone/low: the floor list dot pulses.
5. **r2-j37 billboard** Crown billboard: the 3 hero launches, 6 s each, 0.6 s fade, 512 x 320 each. Feed it from the same list as Happening now / heroes.
6. **r2-j38 flyin** First-visit fly-in (2.5 s, desktop only, once, any input skips, never under reduce motion, never delays content).
7. **r2-j43 sounds** Event sounds (launch bell, paper thunk, stamp, lift ding), 15% room tone, 40% events, at most one every 2 s.
8. **r2-j49 feed** buddehbot public feed: one read-only address with open items as number, kind, floor, state, times. No text, items or prices.
   **Check** the real tables and outcomes for help requests, purchase requests and contractor jobs, and which part of domain buying buddehbot does;
   write what you found in DONE.md. Show a kind only when a real record exists.
9. **r2-j50 mailroom** Mailroom and robot (section 3 look, under 1,500 triangles, name plate "buddehbot"): basement on the tower panel and **B** on the lift.
10. **r2-j51 folders** Folders, tube and tray (Q18), from the j49 feed; a late visitor sees the current state, nothing replayed.
11. **r2-j52 stamps** Stamps and voice lines: only the section 3 list, one bubble per event, 2.5 s. **Check** whether an "already done" outcome exists; if not, leave that line out.
12. **r2-j53 heartbeat** Heartbeat, asleep, away. **Reuse the existing Mac heartbeat; add no Mac script and nothing that calls a model.** On the
    server (hz), a Mac LaunchAgent already pushes every 5 minutes into `/var/lib/macbeat/last`, one line like
    `recv_ts=<unix s> v=1 mac_ts=<unix s> gw=ok disk_gb=48 pc=ok`. Add a read-only bind mount of the directory `/var/lib/macbeat` to the theoffice
    service in `docker-compose.yml` (e.g. `/var/lib/macbeat:/run/macbeat:ro`) and read `MACBEAT_FILE` (default `/run/macbeat/last`). Fresh = `recv_ts`
    within 15 minutes. Missing file or unreadable = Away (never crash). Use only the timestamp; never show the other fields. States in section 3's order.
13. **r2-j54 audience** Audience views (section 3 "Who sees what"). Boss sees own floor's items in full; Colon (admin) everything; visitor kind lines only. API tests for each.
14. **r2-j55 delivery** Contractor delivery (one lift ride on hand-back) and the COLON APPROVED stamp only where an approval record exists.
    The contractor stays manual: only Colon's Send out fills the queue. Tapping the robot never contacts buddehbot.
15. **r2-j56 truth** Truth test: an automated test fails if any played mailroom or room animation has no record type and number.
16. **r2-j61 alerts** Boss alerts, **BOSS_ALERTS default 0**. Three events only, max 3 a day per boss, one 24 h reminder. Use the existing mail sender (mocked in tests).
17. **r2-j62 report** Weekly floor report email Mondays 09:00, **WEEKLY_REPORT_EMAIL default 0**.
18. **r2-j64 proposals** Numbers to actions: Mondays 08:30, one proposal per active floor (one change, one reason, the number), Yes / No tap, dropped after 7 days.
    Skip floors with round 1's `plan off` switch, demo floors and paused floors. One short call per floor per week.
19. **r2-j65 didit** "Did it work?" check: each shipped change records its target number; 7 days later a before-and-after line on the timeline. Code only.
20. **r2-j66 thisweek** This week page (Q12 a): Mondays 08:10, real records only, quiet-week line, 12 weeks of history. No model.
21. **r2-j68 friday** Friday feature (Q16): Fridays 16:00 to 23:00, only if something shipped that week; praise only, no ranked list.
22. **r2-j72 december** December set: 1 to 31 December, snow on the roof, a tree in the lobby; phone low = roof colour only.

## Section 3's "never" list applies to every job
Never show an item without a real record number. Never invent busywork. Never show question text, item names or money to visitors. No banter,
jokes or speech outside the voice-line list. Never stamp a launch with buddehbot. Never give bots a new way to reach buddehbot (no tool, no
prompt change, no "ring buddehbot" button). Never send anything to the Mac from a tap or an animation. Never move floor work onto Colon's
personal subscription; floor work stays on The Office's own keys.
