# Round 1, the rest: jobs 20, 21, 23, 25, 26 plus 33 and 34 (owner rulings of 2026-11-19)

Read `docs/redesign/COMMON.md` first; every rule in it still applies. Start from branch **`office-nobudget`** (this file's branch). It is live main plus batch 4 plus the
budget back-out below. Stack your jobs on it in the order given for your lane.

## The owner's ruling, which overrides the spec wherever they disagree
Colon has ruled: **no budget rules at all.** Do not build any of these, even where the spec asks for them:
- weekly per-floor budgets, a reserve, a "budget used up" state, or any refill on Monday;
- a $5 per-task hard stop, or a stop at 1.5 times an estimate (job 7 is dropped and is now opt-in only, `HARD_CAP_ENDS=1`; `TASK_MAX_USD` is back at 40);
- "no approved plan means $0 / Idle": a floor never goes Idle and never stops spending because nobody approved a plan;
- a fuel gauge;
- an "About $X. Go?" gate, or any approval click before a job starts because of its price;
- any change to the building's caps or the per-floor stops (`floorLimits`, `floor_limit_N` settings, `BUDGET_*`, `TASK_MAX_USD`).

These are fine, because they only inform: recording cost per job, the 08:05 digest with spend, quiet alerts that don't repeat, the in-server spend
reading (job 5), a ranked view for Colon, an estimate **shown** as information, and a boss seeing their own floor's dollars behind a tap.
If you find any code from round 1 that limits spend in one of the forbidden ways, don't remove it yourself: list it under RISKS in your DONE.md.

The spec's section 9 decisions that touch your jobs:
- TheTireRx (floor 6) is on "pause and measure" for 2 weeks: upkeep only, and count tapped calls. **No dollar cap.**
- Bosses see their own floor's spend, behind a tap (their floor only; never another floor's figures, building totals or model names).
- Ideas below the scorecard bar get a **warning, not a block**.
- Fable is off for floors (already done; don't turn it back on).

## Lane B (loop), in this order

### j21 Estimates, shown only (`office-j21-estimate`)
- `server/estimate.js`: an estimate for a job = the median cost of the last 10 finished jobs of that lane and size on the building (cost from the task's own
  ledger rows). Until 10 exist, the spec's Q7 starting prices: arcade game about $1 to $3, one-page website about $1, local service site with a booking form
  about $2, business or shop first pass about $2 to $4; an edit about $0.40. Code only, no model call. Export a function the other jobs can call.
- Where a boss sees a job before or as it starts (the plan, the job's timeline card, the manager's confirmation), the boss sees one plain line:
  "This will cost about $X." Boss only; visitors never see it. It never asks for a click and never holds a job.
- The line is added by code to what the boss sees; it never goes into a prompt, a tool result or anything a bot reads (test/leak tests must stay green).
- Record each job's estimate on the task (additive column) so the digest and ranked view can compare estimate with actual later. Nothing stops at any multiple.
- DONE MEANS: a boss sees "This will cost about $X" on a new job; a visitor sees no money; a test shows a job estimated far below its real cost still runs to the end.

### j20 Weekly plan, with no budget (`office-j20-weekplan`)
- Every Monday at 08:05 New York time (after the night freeze lifts; reuse the digest timer's clock), the manager drafts a plan for each open floor that has
  a goal or recent work: one goal, up to 5 jobs, each with its done-means lines (job 9) and its estimate (j21) shown as information. One manager call per floor
  per week at most; skip demo floors 1 and 2, paused floors, and floors whose team is paused at a $0 stop.
- The boss sees it on the status card ("This week's plan") with **Approve** and **Edit** (edit the goal, remove or reword jobs, add one). Approving marks it
  approved. **If nobody approves, the manager carries on with the draft** after a set time (`WEEKLY_PLAN_AUTOSTART_HOURS`, default 24) exactly as if
  approved. Nothing ever goes Idle or stops spending because of the plan.
- This applies to every floor that got a draft, whatever its work mode: the owner's words are "with no approval the manager carries on with the draft".
  The plan's jobs run through the ordinary engine and staff (reuse the work-mode/goal machinery where it fits). Respect job 10's limits (5 jobs, 3 queued, one open plan).
- A per-floor admin switch keeps one floor out of weekly plans altogether (no draft, nothing starts): `admin.mjs plan --floor N off|on`. TheTireRx (floor 6) is
  on upkeep only until 2026-12-03, so the orchestrator will set it off after deploy; make sure "off" really means no draft and no start.
- Switch: `WEEKLY_PLAN=0` turns the Monday draft off building-wide. Admin: `admin.mjs plan --floor N [--draft-now]` to show or force a draft.
- DONE MEANS: in a test at a fake Monday 08:05, a floor gets one draft; the boss approves or edits it; a floor whose boss does nothing runs the draft after the
  wait; no floor is ever set Idle or held at $0 by the plan.

### j23 Onboarding (`office-j23-onboarding`)
- The spec's Q7 first five minutes and section 4 "Onboarding": code box, "This is your floor", three lane cards (Game, Website, Business), templates with prices
  shown as information (Q7 list; **no** price-compare directory template for friends), three short questions per lane, then the manager shows the plan (goal, up to
  5 jobs, done-means lines, "This will cost about $X") with one button: **Start**. Start means start, not a price approval. "Something else" opens the plain
  message box. Bad code: "That code didn't work. Check with Colon."
- After Start, the status card shows "Step 1 of N" and the first timeline card appears (jobs 12 and 15).
- DONE MEANS: a new code holder reaches a started plan in under 3 minutes in a test (mock mode), on desktop and phone widths.

### j25 Idea scorecard (`office-j25-scorecard`)
- Each Business idea card from the Researcher shows four scores, 0 to 3: Who pays, Days to first dollar, Cost to build (3 = under $3, 2 = $3 to $10,
  1 = $10 to $30, 0 = over $30), Cost to run per week. The Researcher fills them in the same call it already makes (no extra model call).
- Bar: 8 of 12, and Who pays above 0. **Below the bar the boss sees a plain warning** ("This idea scores 6 of 12: nobody clear pays for it yet.") and can still pick it.
  Nothing needs Colon's OK and nothing is blocked. The score is boss-only.
- DONE MEANS: every new idea card shows 4 scores; a test idea under 8 shows the warning and can still be picked.

## Lane A (look), in this order

### j34 Own spend behind a tap (`office-j34-ownspend`)
- On the boss's status card, a small "Spend" link. Tapping it shows that floor's own dollars only: this week, last week and since the floor opened, split
  Claude / OpenRouter if that is easy, and the latest few jobs with what each cost. No gauge, no budget, no "left", no limits, no building totals, no model names.
  Visitors never see the link. Use the in-server spend reading (job 5) and the ledger; no model call.
- DONE MEANS: a boss taps Spend and sees their floor's own figures; another floor's boss and a visitor can't fetch them (test the API too).

### j26 Colon's ranked view (`office-j26-ranked`)
- Admin only. Floors ranked by real use per $100 (real visits and plays, plus sign-ups, sales and tapped calls on business floors, per $100 spent, last 7 and
  last 28 days; bots, bosses and Colon don't count; job 5's figures and the Numbers tab's counts). Show spend, the real-use figure and the last launch for each.
- Three buttons with a confirm step: **Double down** (marks the floor as a priority in the list and the digest; it changes no cap), **Pause** (the existing
  floor pause), **Kill** (pauses the team and takes the floor off public lists; reversible from the same view). Every press is logged with who and when.
  Nothing here sets a budget.
- DONE MEANS: admin lists floors by real use per $100 with the three buttons working in a test; non-admins get 403.

### j33 Tapped calls (`office-j33-taps`)
- For the TireRx pause-and-measure (section 9, item 3): count real taps on `tel:` links on every floor's published sites, the same way real visits are counted
  (bots, the floor's boss and Colon excluded; no third-party script; no personal data kept, just floor, project, page path, number tapped, time). A tiny
  first-party beacon added when the Office serves a published page is fine; it must not break pages that have their own scripts, or work offline.
- Show the count in the boss's Numbers tab ("Calls tapped: N this week") and in the owner's digest line for each business floor. Feed j26's real-use figure.
- DONE MEANS: in a test, a tap on a `tel:` link on a published page is counted once; a boss's own tap and a bot's are not; the digest shows the count.

## Finish
Same as COMMON.md, but the done file is `docs/redesign/LANE-<A|B>-REST-FINISHED.md`.
