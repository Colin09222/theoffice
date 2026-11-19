# OFFICE-ANSWERS-1: The Office, redesigned

Written 18 November 2026 from CLAUDE BRIEF OFFICE-1. I have not seen the code or the server.

**How to read the numbers.** "Measured" means the figure comes from the brief. "Start at" means it is my starting value; tune it after one week of real use. "Check" means the build bot must confirm it in the code before acting.

---

## 1. The ruling in one paragraph

**Results first, tower second, ship always.** The home page leads with what got made: real screenshots, real plays and visits. The tower shrinks to a small navigator. Each floor opens on a status card that says what the team is doing, what it last shipped and whether it needs the boss. Chat becomes a work timeline. Under the surface, every job gets 3 to 5 "done means" lines, one review, one fix round, then it ships. Cheap models do edits, a strong model does first builds and hard bugs, and the outside contractor becomes a rare, manual last resort. **Visitors** see what was made in 10 seconds. **Bosses** approve one short weekly plan, see a fuel gauge, and get a price before any job over $2. **Colon** gets one digest a day, at most 2 alerts, and a ranked list of floors by result per dollar with three buttons: double down, pause, kill.

---

## 2. Rulings, Q1 to Q14

### Q1. Overall visual concept
- **Ruling: b, with one change.** On desktop the small tower stays real 3D but loads after the content. On phones the home page has no 3D at all (see Q12).
- **Why:** The brief's own read is that the toy hides the point. Launches are the proof, so they go first. The tower is still the hook and the way to move around. Loading 3D last fixes the slow first view.
- **Numbers:** Home shows content before any 3D code loads. Tower frame is about one third of the desktop width. One palette, two fonts, one card style (section 3).
- **Cost effect:** Neutral on AI spend. Lowers page weight.

### Q2. Building and floor metaphor
- **Ruling: b.** Agree with the recommendation.
- **Why:** Floors, lift and "To let" explain the product in one glance. "Closed, everyone has gone home" makes a good floor look dead. Hours stay as a boss setting; visitors never see them.
- **Numbers:** Visitors see one of four states: **Working**, **Waiting on boss**, **Idle** (with "last active 2h ago"), **Paused**. Never "Closed".
- **Cost effect:** Neutral.

### Q3. Home dashboard
- **Ruling: a.** Agree.
- **Why:** It answers "what was made" and "what is happening now" in the first screen. A feed (c) would bring the noise back.
- **Numbers, the 7 items:**
  1. Top bar: logo, tag line, Sign in.
  2. Hero strip: the 3 best recent launches. Screenshot, one line, **Play** or **Visit**.
  3. Happening now: max 5 lines, real work only, newest first.
  4. Small tower navigator (desktop) or floor list (phone).
  5. Directory: open floors only, one line each, with state badge.
  6. "All launches" link to the Launched page.
  7. **Open an office** button.
- **Phone:** one column in the same order. Hero strip becomes a swipe row. No 3D. Floor list replaces the tower.
- **"Best" launch rule:** most real visits or plays in the last 7 days; ties go to the newest. Work-in-progress never appears in the hero.
- **Cost effect:** Neutral. Screenshots are taken by a script, not a model.

### Q4. Floor page
- **Ruling: a.** Agree.
- **Why:** The status card answers "is my floor stuck?" without reading chat. The room stays as the fun part.
- **Numbers, status card fields (visitor):**
  1. Company, floor number, boss name, lane.
  2. State badge.
  3. Goal, one line.
  4. Now: current job and step ("Step 2 of 5: building the booking form").
  5. Last shipped: thumbnail, name, how long ago.
  6. Next: one line.
  7. Buttons: Visit website, Share.
- **Boss sees the same card plus:** fuel gauge, the one open question (if any) with reply chips, **Approve plan**, and the message box. Nothing else is added to the card.
- **Cost effect:** Neutral. All fields come from task data, no model call.

### Q5. Watching bots work
- **Ruling: a, with c's screenshots inside the timeline.** Agree. **Cut model-written banter entirely.**
- **Why:** 218 of 405 chat lines on floor 6 were status noise (measured). Visitors want steps and pictures. Banter costs up to $2 per floor per day (the cap) and adds nothing a visitor can use.
- **Numbers:**
  - One timeline card per job, updated in place. Not one line per round.
  - Card text is built by code from task state changes. No model call.
  - Max 1 screenshot per job step, max 4 per job.
  - Banter becomes a fixed list of 200 pre-written lines, shown only as speech bubbles in the 3D room. Picked at random. Zero model calls.
- **Cost effect:** Lowers. Saves up to $2 per floor per day, plus the Haiku calls behind status lines.

### Q6. Results and launches
- **Ruling: a plus c, plus a small piece of b.** The piece of b: one "Launched" card in the timeline and a plaque on the floor. No confetti.
- **Why:** Real screenshots make launches look like real things. A share page per floor gives friends something to send. The plaque is a cheap reward.
- **Where I differ:** Public numbers are **visits and plays only**. Sign-ups and sales stay boss-only unless the boss turns them on. A friend's sales count is their business.
- **Numbers:**
  - Screenshot taken by script at launch, then refreshed every 7 days.
  - Card shows: screenshot, name, one line, visits or plays (last 7 days), "Made by floor 6 in 3 days".
  - Anything not launched by the boss is marked **Work in progress** and stays off the hero strip.
  - Demo floors never post to the ticker or the Launched page.
- **Cost effect:** Neutral.

### Q7. Onboarding friends
- **Ruling: a plus c.** Agree, with one template removed.
- **Why:** Lanes and templates give the manager a known good brief and a known cost. Talk-first stays as a "Something else" option.
- **Where I differ:** No "Price-compare directory" template for friends yet. Directories are where the building burned the most (TireRx about $210, LabStackr about $65, measured). Offer it later, with Colon's OK per floor.
- **Numbers, templates and prices shown:**
  - Arcade game: about $1 to $3 (measured).
  - One-page website: about $1 (measured $0.90).
  - Local service site with a booking form: start at about $2.
  - Business or shop, first pass: about $2 to $4 (measured $1.60 for the first pass; start higher to be safe).
- **First 5 minutes:**
  1. Minute 0: friend enters their code. They see "This is your floor" and three big cards: Game, Website, Business.
  2. Minute 1: they pick a lane, then a template or "Something else".
  3. Minute 2: three short questions (for a website: who is it for, what should a visitor do, any name or colours).
  4. Minute 3: the manager shows the plan: goal, up to 5 jobs, the done-means lines, the price. One button: **Start**.
  5. Minutes 3 to 5: the status card shows "Step 1 of 4". The first timeline card and screenshot appear.
  6. About minute 10 to 15: a live link arrives, marked Work in progress.
- **Cost effect:** Lowers. Fewer vague first jobs, fewer rewrites.

### Q8. Cost visibility
- **Ruling: b for jobs over $2, a for the gauge, c's digest for Colon.** One change: the gauge is **weekly**, and the boss can tap it to see their own dollars.
- **Why:** A boss who sees a price makes sensible trade-offs, and Colon stops being the police. Hiding weekly dollars while showing job dollars would be confusing.
- **Numbers:**
  - Gauge: 5 segments, "About 60% of this week's budget left".
  - Estimate shown before any job expected to cost over $2: "About $3. Go?"
  - Estimate = middle cost of the last 10 jobs of that lane and size. Until 10 exist, use the Q7 prices.
  - A job stops at 1.5 times its estimate and asks one question.
  - Hard stop per task: $5. The task is ended, not just flagged.
- **Alerts to Colon, fixed:**
  - **One digest a day at 08:05**, right after the night freeze lifts. It has: spend yesterday by floor, both pots left, weeks of runway, launches, stuck jobs, decisions waiting.
  - **Immediate alerts, only these five:** building pot passes 80%; building pot passes 95%; a floor hits its stop; a task is ended at the $5 cap; a purchase request arrives.
  - Each alert fires **once** and does not repeat until the state changes. The 50% flag is retired (the building is already at 58%).
  - The budget check moves **inside the Node server** as a timer. It reads SQLite directly. It no longer depends on a scheduled session with no shell.
- **Cost effect:** Lowers. Start target: under 2 alerts a day plus the digest.

### Q9. Worker quality loops
- **Ruling: a plus b plus d.** Agree. This is the core job.
- **Why:** Floor 6 cancelled 44 of 86 tasks and hit its stop before publishing (measured). The Tester kept inventing new wishes. Done-means lines stop that. Ship-first ends the loop.
- **Numbers, loop limits:**
  - 3 to 5 done-means lines per job, written before work. Frozen once work starts. Only the boss can change them.
  - The Tester checks only those lines. New ideas go to a "Later" list, never back to the Builder.
  - Max **1 fix round** per job (today: 2 failed re-tests). Then ship the best honest version and ask one question.
  - Max **1 plan rewrite** per project (today: 3).
  - Max 5 jobs per plan. Max 3 jobs queued ahead. No new plan while one is open.
  - Steps per task: 40 for builds (kept), 15 for edits.
- **Numbers, model tiers:**
  - **Tier 0, no model:** smoke check (page loads, no errors, screenshot), status lines, timeline cards, banter, screenshots.
  - **Tier 1, Haiku:** routing a boss message, small text edits, summaries.
  - **Tier 2, Sonnet 5.5 medium:** plans, done-means lines, research cards, simple first builds, code edits.
  - **Tier 3, Opus:** first builds marked hard, and any bug that failed its one fix round. Max 2 Tier 3 tasks per floor per week. Cap $6 each.
  - Fable only when Colon switches it on for a named job.
- **Tester rules:**
  - Edits skip the Tester. They get the Tier 0 smoke check only.
  - Exception: edits that touch checkout, forms or sign-in get one Tester pass.
  - Tester gets a computer only for games and shops.
- **Builder context diet:** A Builder call averages 211,000 tokens (measured). Start target: 80,000. Send the brief, a file list, and only the files it opens. Turn on prompt caching if it is off (**Check**).
- **Never re-held after handback:** see section 5, "Re-hold rules".
- **Cost effect:** Lowers, the most of any ruling. Rough estimate: Tester share falls from 18% to under 10%. Builder spend falls by up to half if cost tracks context size.

### Q10. Picking which businesses to run
- **Ruling: a for new ideas, c for Colon.** Agree.
- **Why:** The Researcher already pins idea cards with sources. Four scores on each card is a small add. Colon needs one ranked list, not seven floors to inspect.
- **Numbers, scorecard:** four lines, each 0 to 3.
  1. Who pays: a named kind of buyer.
  2. Days to first dollar.
  3. Cost to build (3 = under $3, 2 = $3 to $10, 1 = $10 to $30, 0 = over $30).
  4. Cost to run per week.
  - Bar: **8 of 12**, and "Who pays" cannot be 0. Below the bar, the boss can still build with Colon's OK.
- **Today's floors:**

| Floor | Ruling | Weekly budget (Claude / OpenRouter) | Reason |
|---|---|---|---|
| 1 Pigeon Logistics | Hide from public | $0 | Fake launches confuse visitors. |
| 2 Mildly Haunted Candles | Hide from public | $0 | Same. |
| 3 LabStackr | **Double down** | $12 / $3 | Clear use, works on a small budget. No more open "plan" jobs; only jobs with done-means lines. |
| 4 Third Party Rising | **Pause team** | $0 | Game is built elsewhere. Site stays live. |
| 5 Tiny Arcade Works | **Keep, steady** | $6 / $3 | Cheapest launches in the building (about $1 a game). One new game a week. |
| 6 TheTireRx | **Pause and measure** | $5 / $2 | About $210 spent, results unknown. Upkeep only for 2 weeks. Count tapped calls. |
| 7 Cailyn Photography | **Keep, small** | $4 / $2 | Finished site. Edits are about $0.40. Fix the boss email first. |

- New friend floors: start at $8 / $3 a week.
- **Runway:** Keep $60 Claude and $30 OpenRouter as a reserve Colon alone can release. Five floors spend $27 a week on Claude: about 9 weeks. With two new friends, $43 a week: about 6 weeks. OpenRouter lasts longer in both cases.
- **Cost effect:** Lowers. Weekly spend becomes a known number.

### Q11. Automation vs approvals
- **Ruling: c.** Agree.
- **Why:** One decision a week per floor is the smallest amount of steering that still keeps a human in charge. It reuses work modes and goals.
- **Numbers:**
  - The manager drafts the plan Monday at 08:05: one goal, up to 5 jobs, one budget.
  - The boss taps **Approve** or edits it. No approval in 48 hours means the floor goes Idle and spends nothing.
  - Unspent budget does not roll over.
  - Inside the plan, jobs publish to the floor's own address without asking, marked Work in progress.
  - Still needs a boss tap: **Launch** (wall and domain), any purchase, any ad spend, any job over $2 outside the plan.
- **The contractor: shrink now, fold in later.**
  - Turn off automatic contractor routing on floors 3, 6 and 7.
  - Hard jobs go to Tier 3 on the floor.
  - The queue stays, but only Colon can fill it, with a **Send out** button on a stuck job. Max 2 a week across the building.
  - If Tier 3 holds up for 4 weeks, remove the queue.
- **Cost effect:** Moves cost from Colon's credits and attention to the building pot. Roughly neutral in dollars; much lower in babysitting.

### Q12. Mobile
- **Ruling: c.** Agree.
- **Why:** Friends check in from phones. They need status, timeline and launches. The room is a treat, not the tool.
- **Numbers:** No 3D code loads on a phone until the user taps **Watch the room**. Page weight before that: under 300 KB. First paint: under 2 seconds on a mid-range phone on 4G.
- **Cost effect:** Neutral on AI. Parks the speech-bubble overlap and two-finger twist fixes; they matter less now.

### Q13. What to cut
- **Ruling: c now, a after 4 weeks.** Agree. My full lists are in section 6.
- **Why:** Cut what costs money or confuses visitors today. Remove dead code only once the new design has run for a month.
- **Numbers:** 10 roles become 6 working roles. Beans keep their names and desks; only the model calls merge.
- **Cost effect:** Lowers. Fewer roles means fewer calls per job.

### Q14. One measure of success
- **Ruling: b, with c as a guard.** Agree.
- **Why:** Launches per $100 rewards shipping junk. Real use rewards shipping things people touch. Colon's minutes keep the building honest about babysitting.
- **Numbers, start at (there is no baseline in the brief; week 1 sets it):**
  - Headline: **500 real visits and plays per $100 spent**, building-wide.
  - Business floors: 1 sign-up, sale or tapped call per $10 spent.
  - Guard: under 10 minutes of Colon's time per launch, under 15 minutes a week on the whole building.
  - Bots, the boss and Colon do not count as visits.
- **Cost effect:** Neutral. It reuses the Numbers tab.

---

## 3. Visual style guide

### Colour palette
| Name | Hex | Used for |
|---|---|---|
| Paper | #F6F1E7 | Page background |
| Card | #FFFDF8 | Card surface |
| Ink | #1F2430 | Text, dark ticker |
| Tower Red | #C93A24 | Brand, primary button, "Waiting on boss" |
| Sunset Amber | #F2A33A | "Working" badge, live dot (Ink text on top) |
| Sea Teal | #17766F | Links, "Shipped", success |
| Slate | #5B6270 | Labels, secondary text, "Idle" |
| Line | #E3DBCB | Borders and dividers |

The 3D scene keeps its sunset colours. The dark wood, the red badge and the cream card all become the one Card style. The build bot should check text contrast is at least 4.5 to 1.

### Type
- **Headings:** Bricolage Grotesque (free, Google Fonts). 40 px desktop, 28 px phone for page titles. 24 / 20 px for section titles.
- **Body and labels:** DM Sans (free, Google Fonts). Body 16 px. Labels 13 px, medium weight. Numbers use tabular figures.
- Two families only. The same two on the lobby and the floor.

### Components
- **Card:** Card colour, 1 px Line border, 14 px corners, 16 px padding, one soft shadow.
- **Button:** Tower Red fill with white text for the one main action per screen; all others are outlined in Ink.
- **Status badge:** pill, 13 px label, one of four: Working (Amber), Waiting on boss (Red), Idle (Slate outline), Paused (Slate fill).
- **Timeline item:** small bean face, one line of what happened, time, optional thumbnail, and it updates in place per job.
- **Launch card:** 16:10 screenshot on top, name, one line, visits or plays, "Made by floor N in X days", one button.

### Motion
- **Animates:** the camera swoop into a floor; a new timeline card sliding in; the live dot pulsing; the gauge filling; beans in the room.
- **Does not animate:** cards, text, tabs, numbers, page loads. No confetti. Respect the "reduce motion" setting.

### Layout sketches

Home, desktop:
```
[Logo  Clock in. Someone else does the work.        Sign in]
+----------------------------------------+---------------+
| LAUNCH 1     | LAUNCH 2  | LAUNCH 3    |               |
| [screenshot] | [shot]    | [shot]      |    small 3D   |
| Play         | Visit     | Visit       |     tower     |
+----------------------------------------+   (loads      |
| Happening now (max 5 lines)            |     last)     |
+----------------------------------------+---------------+
| Directory: 3 LabStackr [Working]  5 Tiny Arcade [Idle] |
| All launches >                      [ Open an office ] |
+--------------------------------------------------------+
```

Home, phone:
```
[Logo            Sign in]
[Launch 1] > swipe > 2, 3
Happening now (3 lines, "more")
Floors: 3 LabStackr  [Working]
        5 Tiny Arcade [Idle] ...
[ Open an office ]
```

Floor, desktop:
```
+----------------------+---------------------------------+
| STATUS CARD          |                                 |
| TheTireRx - Floor 6  |          3D room                |
| [Working]            |                                 |
| Goal: ...            |                                 |
| Now: Step 2 of 5     |                                 |
| Last shipped [thumb] |                                 |
| Next: ...            |                                 |
| Visit   Share        |                                 |
+----------------------+---------------------------------+
| Timeline | Projects | Team                             |
+--------------------------------------------------------+
```

Floor, phone:
```
[< Home   TheTireRx   Floor 6]
STATUS CARD (full width)
Timeline (cards)
Projects
[ Watch the room ]   <- loads 3D on tap
```

---

## 4. Page-by-page spec

### Home
- **Purpose:** show what was made and what is happening, in 10 seconds.
- **On it:** the 7 items in Q3.
- **Hides:** banter, demo floors, "To let" floors (one line: "23 floors to let"), all money.
- **Empty:** fewer than 3 launches: show what exists, then an "Open an office" card. Nothing happening: "Quiet right now. Last job finished 2h ago."
- **Error:** if 3D fails, the floor list shows instead. If the feed fails, hide the strip; do not show an error to visitors.

### Launched and floor portfolio
- **Purpose:** one shareable page of real results, for the building and for each floor.
- **On it:** (1) title, (2) filter by lane, (3) launch cards, (4) Work-in-progress section below, (5) floor header on a floor's page, (6) Share button, (7) "Visit floor".
- **Hides:** sign-ups, sales, money, demo launches.
- **Empty:** "Nothing launched yet. The team is on step 2 of 4."
- **Error:** missing screenshot: show the coloured initial card used today.

### Floor (visitor)
- **Purpose:** see what this team is doing and what it shipped.
- **On it:** (1) status card, (2) 3D room, (3) Timeline, (4) Projects, (5) Team (ID cards), (6) Visit website, (7) Share.
- **Hides:** Numbers, Business tab, questions to the boss, money, hours.
- **Empty:** new floor: "Just moved in. First job starts soon."
- **Error:** floor paused: badge says Paused, nothing else. No reason shown to visitors.

### Floor (boss)
- **Purpose:** steer the floor in under 1 minute.
- **On it:** (1) status card with gauge, (2) the one open question with reply chips, (3) weekly plan with Approve, (4) message box, (5) Timeline, (6) **Business** tab (Numbers, Orders, Payments, Inbox, Launch checks merged), (7) Settings (look, hours, work mode).
- **Hides:** other floors' costs, building totals, model names.
- **Empty:** no plan: "No plan this week. Tell the manager what you want."
- **Error:** budget used up: "This week's budget is used. It refills Monday. Ask Colon for more." A "not allowed" error must log the user, floor, action and time for Colon (**Check**: the Cailyn cause is still unknown).

### Onboarding
- **Purpose:** from code to a working team in 3 minutes.
- **On it:** (1) code box, (2) three lane cards, (3) templates with prices, (4) three questions, (5) the plan with done-means lines, (6) price, (7) Start.
- **Hides:** roles, model tiers, work modes (default: When I ask).
- **Empty:** "Something else" opens the plain message box.
- **Error:** bad code: "That code didn't work. Check with Colon."

### Admin (Colon)
- **Purpose:** run the building in 15 minutes a week.
- **On it:** (1) both pots, with weeks of runway, (2) floors ranked by real use per $100, with **Double down / Pause / Kill**, (3) today's digest, (4) decisions waiting (purchases, stuck jobs with **Send out**), (5) alert log, (6) budgets and caps, (7) freeze switch.
- **Hides:** raw logs (one link away).
- **Empty:** "Nothing needs you."
- **Error:** if the cost data is older than 3 hours, show "Costs last updated 3h ago" in Tower Red.

---

## 5. The worker loop

**Reused:** work modes and goals, Business journey, loop caps, per-floor stops, cost alerts, launch checks, the contractor queue, the Numbers tab.

1. **Boss asks.** Tier 1 reads the message and sorts it: edit, build, or question.
2. **One question at most.** Then the manager starts (existing rule).
3. **Plan.** Tier 2 writes the goal, up to 5 jobs, and 3 to 5 done-means lines per job. Each job is tagged: edit, build or hard build.
4. **Price.** Code looks up the estimate. Over $2 and outside the weekly plan: show the boss "About $3. Go?"
5. **Budget check.** Code checks the floor's weekly budget and the floor stop. Not enough: the job waits and the boss is told.
6. **Work.** Edit: Tier 1 or 2, 15 steps. Build: Tier 2, 40 steps. Hard build: Tier 3, 40 steps, $6 cap.
7. **Smoke check.** Tier 0. Page loads, no errors, screenshot saved to the timeline.
8. **Review.** Edits stop here. Builds get one Tester pass against the done-means lines only.
9. **One fix round.** If a line fails, the Builder fixes it once. A hard failure moves the fix to Tier 3.
10. **Ship.** The job publishes to the floor's address, marked Work in progress. If a line still fails, it ships anyway with that line listed under "Not done yet", and the manager asks the boss one plain question.
11. **Launch.** The boss taps Launch. Launch checks run. The card joins the wall and the plaque appears.
12. **Record.** Code writes the cost, the time and the result to the job. This feeds estimates, the digest and the ranking.

### Re-hold rules (fixes pain point 1)
- **Likely cause (Check):** the "send Builder tasks to the contractor" rule runs every time a task returns to the Builder, including after the Tester sends it back.
- **Rule 1:** the contractor routing check runs **once, when a task is created**. Never on a status change.
- **Rule 2:** a task has a `handed_back_at` time. Once set, the task can never enter "held for the contractor" again. The server refuses the change and logs it.
- **Rule 3:** if the Tester fails handed-back work, the server makes **one new fix task** on the floor at Tier 3. The original task is closed as shipped.
- **Rule 4:** one ping per task, ever. Pings are keyed by task ID.
- **Rule 5:** "sent back" counts only Tester failures, not holds.

### When the contractor is used
Only when Colon presses **Send out** on a stuck job. Max 2 a week. Never automatically.

---

## 6. Keep / Change / Cut

### Keep
- The tower, floors, beans, names and desks.
- The 3D floor room as the "watch them work" view.
- Three lanes: Game, Website, Business.
- Work modes and goals.
- Business journey: Idea, Build, Customers, Launch.
- Shop, checkout, company email, domain buying with a boss click.
- Per-floor stops and the building caps.
- Night freeze 23:00 to 08:00, moved into a server setting.
- Nightly backups and the help line for purchases.

### Change
- Home: launches first, tower small.
- Directory: light list of open floors, not dark wood.
- Lift: open floors only, plus "23 floors to let".
- Chat: becomes the work timeline.
- "Closed, gone home": becomes "Idle, last active 2h ago".
- Banter: fixed list of 200 lines, room bubbles only.
- Orders, Payments, Inbox, Numbers, Launch: one Business tab.
- Roles: 6 working roles. Manager, Researcher, Writer (takes Marketer's words), Designer (takes Illustrator), Builder, Tester.
- Lawyer: becomes a launch checklist run by code and the manager.
- Analyst: becomes the manager reading the Numbers tab on the daily run.
- Contractor: manual, rare, Colon only.
- Budget check: runs inside the server.
- Test floors: one hidden test floor, $5 a week.

### Cut
- Fake launches in the public ticker.
- Demo floors 1 and 2 from public view.
- Model-written banter.
- The Business Development bean.
- The optimizer loop (the digest and the rules replace it).
- The team planning meeting (done-means lines replace it).
- Video ads by default; on request only, with a price.
- Look scores and "one test business" (parked; revisit after 4 weeks).
- The 50% building flag and all repeating alerts.

---

## 7. Build order

Jobs 1 to 3 change the look and feel in one evening. Jobs 4 to 8 stop the bleeding. The rest build the new product.

| # | Name | Changes | Depends on | Done means | Size | Cost effect |
|---|---|---|---|---|---|---|
| 1 | One skin | Look | None | Lobby and floor use the same 8 colours, 2 fonts and 1 card style. | Medium | Neutral |
| 2 | Quiet the noise | Look, server | None | A visitor sees no demo launches, no small talk in Talk, and no "gone home" text anywhere. | Small | Lowers (banter off) |
| 3 | Real launch cards | Look, data | 1 | All 6 launches show a real screenshot on the Launched page and 3 show on the home hero. | Medium | Neutral |
| 4 | Stop re-holds | Server | None | A handed-back task cannot return to "held"; a test that tries is refused and logged. | Small | Lowers pings to zero |
| 5 | Budget check in the server | Server | None | The server writes a spend record every 2 hours without any outside session. | Small | Neutral |
| 6 | Digest and quiet alerts | Server | 5 | Colon gets one digest at 08:05 and no alert repeats within the same state. | Small | Lowers attention |
| 7 | Hard caps | Server | None | A task that reaches $5 is ended and shipped or closed, in a test with a fake cost. | Small | Lowers |
| 8 | Small gaps | Data, server | None | Floor 7 has a boss email and a test form alert arrives; "not allowed" errors are logged with user and action. | Small | Neutral |
| 9 | Done-means lines | Prompts, data | None | Every new job stores 3 to 5 lines before work starts, and the Tester's report lists only those lines. | Medium | Lowers |
| 10 | Tight loop | Server, prompts | 9 | No job has more than 1 fix round or 1 plan rewrite; a plan has at most 5 jobs. | Small | Lowers |
| 11 | Smoke check, Tester skip | Server | 9 | An edit to a live site ships with a script check and no Tester call. | Medium | Lowers (Tester share under 10%) |
| 12 | Status from code | Server, look | None | One timeline card per job, updated in place, with zero model calls for status. | Medium | Lowers |
| 13 | Timeline with screenshots | Look | 12 | The floor's Timeline tab shows job cards with thumbnails and replaces Talk. | Medium | Neutral |
| 14 | New home layout | Look | 1, 3, 12 | Home shows hero, Happening now and directory before the 3D tower loads. | Medium | Neutral |
| 15 | Status card | Look, data | 12 | A visitor sees state, goal, now, last shipped and next on every open floor. | Medium | Neutral |
| 16 | Phone layout | Look | 14, 15 | On a phone, no 3D code loads until "Watch the room" is tapped; first paint under 2 seconds. | Medium | Neutral |
| 17 | Model tiers | Server, prompts | 9 | Each task records its tier; edits run on Tier 1 or 2; only tagged hard builds use Tier 3. | Medium | Lowers |
| 18 | Builder context diet | Server, prompts | 17 | Average Builder call is under 80,000 tokens across 20 real tasks. | Large | Lowers the most |
| 19 | Contractor to manual | Server, look | 4, 17 | No task reaches the queue unless Colon presses Send out. | Small | Shifts cost to the pot |
| 20 | Weekly plan and budget | Server, look, prompts | 9 | A floor with no approved plan spends $0; an approved floor stops at its weekly budget. | Large | Lowers, makes spend known |
| 21 | Fuel gauge and estimates | Look, data | 20 | A boss sees the gauge and gets "About $X. Go?" before any job over $2. | Medium | Lowers |
| 22 | Business tab | Look | 1 | Numbers, Orders, Payments, Inbox and Launch live under one tab. | Small | Neutral |
| 23 | Onboarding | Look, prompts | 9, 21 | A new code holder reaches a started plan in under 3 minutes in a test. | Medium | Lowers |
| 24 | Floor portfolio page | Look | 3 | Each floor has a public share page listing its launches. | Small | Neutral |
| 25 | Idea scorecard | Prompts, data | None | Every idea card shows 4 scores, and ideas under 8 need Colon's OK. | Small | Lowers |
| 26 | Colon's ranked view | Look, data | 5, 20 | Admin lists floors by real use per $100 with three working buttons. | Medium | Lowers attention |
| 27 | Role merge and cleanup | Prompts, server | 17 | A job calls at most 6 roles; BD bean and optimizer loop are off. | Medium | Lowers |

---

## 8. Test targets

| Measure | Today (measured) | Target |
|---|---|---|
| Cost per launch, game | $1 to $3 | $2 or less |
| Cost per launch, website | $0.90 | $1.50 or less |
| Cost per launch, business first pass | $1.60 | $3 or less |
| Cost per edit | $0.40 | $0.50 or less |
| Jobs that end live | Not known | 80% or more |
| Fix rounds per job | Up to 2 | 1 at most |
| Cancelled-task share | 51% on floor 6 | 10% or less |
| Timeline lines that are real work | 46% on floor 6 | 90% or more |
| Tester share of spend | 18% | 10% or less |
| Average Builder call | 211,000 tokens | 80,000 or less |
| Re-holds after handback | 4 to 5 on one task | 0 |
| Contractor jobs | Automatic on 3 floors | 2 a week at most |
| First paint on a phone | Not known | Under 2 seconds |
| Alerts to Colon | Repeating daily | 2 a day at most, plus 1 digest |
| Real visits and plays per $100 | Not known | 500 (reset after week 1) |
| Colon's time | Daily babysitting | Under 15 minutes a week |
| Weekly building spend, Claude | Up to about $137 a day at peak | $27 to $43 a week |

---

## 9. What Colon must decide

1. **Weekly budgets by floor.** Recommend the table in Q10: $27 a week Claude across five floors.
2. **The reserve.** Recommend holding back $60 Claude and $30 OpenRouter that only you can release.
3. **TheTireRx.** Recommend pause and measure for 2 weeks, then double down only if people tap to call. This one needs a word with Justin first.
4. **Third Party Rising's floor.** Recommend pausing the team and keeping the site live.
5. **Demo floors.** Recommend hiding both. The launch wall fills the gap.
6. **The two waiting friends.** Recommend opening their floors only after jobs 9, 20 and 23 are live, at $8 a week each. That shortens runway from about 9 weeks to about 6.
7. **Bosses seeing dollars.** Recommend yes: their own floor only, behind a tap on the gauge.
8. **Who builds the redesign.** Recommend your assistant builds it outside the building pots. If it must come from the pots, set aside $40 and drop one new friend floor for now.
9. **The contractor.** Recommend manual only from job 19, and removal after 4 clean weeks.
10. **The $5 Google ad test.** Recommend holding it until LabStackr has 2 weeks of visit numbers to compare against.
11. **Fable.** Recommend off for floors. On by your hand for a named job only.
