# Where the floors' money went, and what was changed (2026-11-11)

Measured on the live building, read-only, from `/data/office.db`: every ledger row from 2026-11-08 15:50 UTC to 2026-11-11 15:50 UTC (three days), the task
table, the saved transcripts, and the event history of four computer sessions read back from the platform. Prices are the ones in `config/models.json`.
A ledger row is one model call. It holds prompt tokens (fresh, cache-written and cache-read added together), completion tokens and the cost, so the
split between cache writes and cache reads below is worked out from the cost of each call and is an estimate; everything else is counted.

## The three days in one table

6,661 ledger rows, **$436.15**: $411.59 of AI, and $24.56 for two domain names.

| Who | Calls | Spent | Share of AI | What a call looks like |
|---|---|---|---|---|
| Builder, on a computer (Opus 5.5 and Fable 5.2) | 1,353 | $145.72 | 35% | 211,000 prompt tokens on average, nearly all read from cache |
| Tester, on a computer (Opus 5.5) | 1,413 | $72.91 | 18% | 124,000 prompt tokens on average |
| Researcher (Opus 5.5, or Sonnet 5.5 through OpenRouter on floor 6) | 826 | $64.90 | 16% | 65,000 to 87,000 prompt tokens |
| Researcher's web searches (Sonnet 5.5) | 304 | $21.35 | 5% | $0.07 a search |
| Marketer (Opus 5.5) | 364 | $39.84 | 10% | one task |
| Office Manager, all floors | 853 | $36.15 | 9% | 290 wakes, $0.11 to $0.29 each |
| Designer, Writer, Lawyer | 273 | $23.40 | 6% | |
| Tester without a computer (Gemini, floor 6) | 119 | $3.99 | 1% | |
| Everything else: design reviews, pictures, small talk, notebooks, colleague answers, ship check, the site chat | 1,090 | $3.33 | 1% | |

By floor: 6 TheTireRx $182.36, 7 Cailyn Aungst Photography $102.31, 3 LabStackr $63.40, 5 Tiny Arcade Works $45.31, hidden test floors $42.75.

By what became of the task (217 tasks touched, $374 charged to tasks): done $307.48, **failed $43.10**, **cancelled $21.14**. One failed task was $40.05 of that.

Small talk, notebooks, meetings, colleague answers and the ship check are not where the money is: $0.95 together. The daily run woke a manager twice, for $0.16.

## What was wasted

### 1. A long research or writing job rewrote its whole prompt cache every five or six steps: about $30 of $128

Staff without a computer (Researcher, Marketer, Writer, Designer, Lawyer) run a tool loop that this server drives. To keep a run from outgrowing the
model, `trimSteps` dropped the oldest steps once the conversation passed 240,000 characters, cutting it to 150,000. A page fetched is up to 20,000
characters and a file read up to 40,000, so a research run crossed the line again five or six steps after each cut. Every cut changes the start of the
conversation, and the provider then writes everything that is left to its cache again at 1.25 times the input price, where reading it would have cost
a twentieth.

- 18 of the 38 such tasks hit at least one cut, and those 18 were $144.14 of the $154.18 spent on such tasks.
- Task 2558 (Marketer, "SEO and site-improvement plan", floor 3): 364 calls in 32 minutes, **76 cuts, 82 calls that missed the cache, $19.96 of its $39.84**. It hit the $40 ceiling and failed.
- Task 2695 (Researcher, floor 6): 339 calls, 49 cuts, $12.40 of $27.71 in calls that missed the cache, plus 144 searches at $10.25.
- Task 3037 (Researcher on Sonnet through OpenRouter): 212 calls, 50 cuts, $10.68 of $19.91.
- Across the three days the calls that missed the cache cost $20.93 for the Researcher on Opus, $19.25 for the Marketer, $7.89 for the Researcher on OpenRouter and $4.49 for the Designer, Writer and Lawyer.

Replaying the real call sequences through a model of both windows (it lands 15% above the real bill for the old one): the old window cut 301 times and
the new one 94, and the model's bill goes from $147.26 to $113.19, **23% less**. On the real $128.13 that is about $30.

### 2. A manager round every five minutes that found nothing to do: 109 of 115 rounds, $9.51, and still running

Floor 6 is in "Set hours" work mode, and its Builder and Designer jobs are with the outside contractor. Every five minutes inside its hours the office
woke the manager with a "Work mode:" note. The manager looked, found everything was with the contractor, said so ("Quiet round: rechecked search and the
inbox. #3643 still with the contractor") and stopped; five minutes later the same again.

- 115 rounds in the three days, 109 of them handed out no work. $9.51 on Sonnet through OpenRouter, $0.087 a round.
- In the last 24 hours the manager was the floor's biggest model cost: 457 calls, $16.53. About $1 an hour whenever the floor is open and quiet.
- The boss's chat got one "On our own: nothing new" line per round: 115 of them.
- On a Claude floor the same loop would cost two to four times as much a round.

### 3. A small change to a live site ran the whole routine for a first build

The computer's instructions say that before anything is published the Builder takes screenshots at two sizes, gets an outside design review, fixes
what it flags, and gets a second review. That is right for a first build. It also ran for one-line changes:

- Task 2617, "Add Cailyn's Instagram link to the site": **51 model calls, 45 screenshots read, 3 outside design reviews, $6.55.**
- Task 2602, a rename of the site everywhere: $8.11. Task 1912, taking one sentence out: 49 calls, $2.16.

### 4. A fix round went back to a computer whose conversation had reached half a million tokens

A computer session only grows: nothing is dropped until the platform's own limit near a million tokens, and no session in the sample was ever
compacted. Each step re-reads the lot. The median Builder call carried 196,000 tokens, one in ten carried 387,000 or more, and the largest 604,000.

- Task 1910 (Loopling, floor 5, sent back once, $31.35): the fix round started with one request that wrote **491,043 tokens** to the cache again ($2.46),
  because the cache had gone cold while the Tester and the manager had their turns, and then every one of about sixty more steps re-read 500,000 to
  600,000 tokens. Roughly $9 for the round.
- Inside a session the context is about half the model's own output (thinking, and scripts typed into shell commands: 114,000 characters of inline
  Playwright scripts in task 2683), a fifth screenshots (64 in task 2683, 95 in task 1910) and the rest tool results.

### 5. The manager's prompt: the same twelve thousand tokens written to the cache at almost every wake, and the same note read eight times

- 290 manager wakes. The manager's tools and instructions are about 12,000 tokens and never change, but the cache holding them lasts five minutes,
  and most wakes come later than that: on floor 3, 30 of 31 wakes started cold.
- The manager reads its last thirty messages. On floor 6, 8 of those 30 were "Work mode:" notes carrying the same standing instructions: 12,371 of
  23,808 characters.

### 6. Smaller things

- A file listing with no folder named returns every file on the floor: 38,597 characters on floor 7 (421 files), 19,730 on floor 6, and it stays in
  the conversation for every later step. One Tester session took a 28,591-character listing.
- Send-backs: 8 tasks were sent back at least once in the three days, costing $58.54 in all. The loop caps from 11-10 already stop the long ones.
- "Ran out of steps" since the 40-step cap went on (11-10): 3 tasks, $3.93.
- Retries after a provider error: none that cost anything worth counting.

## What was not wasted, and was left alone

- **Computer sessions are 53% of the bill and most of that is the work itself.** Of the $218.63: about 34% is output (thinking and writing at high
  and xhigh effort), 42% is re-reading the conversation from cache, 24% is writing new steps to it. Their prompt cache works: 98% of prompt tokens were
  cache reads. The models and efforts for building and testing are the owner's choice and were not touched.
- The Tester on Opus at high effort, Fable for the first $35 of a floor's Claude spend, the ship check on Fable: kept.
- Searches at $0.07 each: the search model (Sonnet at low effort) reads about 27,000 tokens of results per call. Left as it is.
- Billing caps, floor limits, the contractor hold, the loop caps, privacy rules and the live-site protection from 278367e: not changed.

## What was changed

Each has a switch. Set it in `.env` and restart; nothing else needs undoing.

| # | Change | Where | Switch off with |
|---|---|---|---|
| 1 | **Quiet rounds back off.** A work-mode round that hands out no work makes the next one wait three times as long (15 minutes, 45, 2 h 15, then 6 hours), and no model is called meanwhile. The moment anything changes on the floor (the boss says something, a job comes back or changes state, a question is answered, something is bought, published or signed up for, the goal changes), the wait is over. | `server/modes.js` | `AUTOPILOT_IDLE_BACKOFF=0` (ceiling: `AUTOPILOT_IDLE_MAX_MIN`, default 360) |
| 2 | **A cached run is cut rarely.** On a model with a prompt cache a run now grows to 400,000 characters before its oldest steps are dropped (to 150,000, as before). A model with no cache price (the Tester's Gemini) keeps the old 240,000 window, because there every character is paid in full on every step. | `server/engine.js` `trimWindow`, `trimSteps` | `STEPS_KEEP_CHARS=240000` (and `STEPS_CUT_TO_CHARS`) |
| 3 | **The manager's tools and instructions are cached for an hour**, not five minutes, on the Claude API. | `server/anthropic.js` `buildRequest`, `server/engine.js` `callLLM` | `MANAGER_CACHE_TTL=5m` |
| 4 | **A repeated round note is read once.** Of the "Work mode:", "Daily run:" and "Goal needed:" notes in the manager's last thirty messages, only the newest of each kind is sent whole; earlier ones are one line. | `server/engine.js` `managerContext` | `MANAGER_DEDUPE_NOTES=0` |
| 5 | **A long file listing comes back as folder totals** and the first files, with how to list one folder, once it passes 12,000 characters. | `server/tools.js` `list_files` | `LIST_FILES_MAX_CHARS=off` |
| 6 | **A fix round on a huge computer starts on a fresh one.** When work is sent back to a computer whose conversation has passed 250,000 tokens, the round runs on a new computer holding the saved project, the original brief, the last round's report and the notes. Only a send-back does this (its turn has ended and its files are on the drive); a pause, an answer from the boss or a restart always goes back to the same computer. | `server/computer.js` `freshStart`, `attach` | `SESSION_FRESH_OVER_TOKENS=off` |
| 7 | **The check fits the change.** A Builder changing something already live is told: for a small change, one script at both sizes, one look at each screenshot, the checklist, publish; no outside design review unless the look as a whole changes; anything else it notices goes in its reply, not into the page. A first build keeps the whole routine. | `server/prompts.js` `changeBrief` | prompt text; revert the commit |
| 8 | **One job, one brief.** The manager is told to put everything in the one brief (what to change, what to leave, which files and where, the boss's words, then the "Done means:" checks), not to split one person's job across tasks, to put several small changes in one task, to mark a small one "Small change:", and never to add a Tester for a small one. | `server/prompts.js` `managerPrompt` | prompt text; revert the commit |
| 9 | **Habits on a computer.** Keep a check as a file and run it again rather than typing a new script into every command; look at each screenshot once; read a file once and change it with a small edit. | `server/prompts.js` `computerPrompt` | prompt text; revert the commit |

Changes 7 to 9 alter the computers' shared instructions, so the platform's stored agents get a new version on the next task; a session already running keeps the one it started with.

## What it should save

At the three days' workload ($411.59 of AI):

| | Before | After | How sure |
|---|---|---|---|
| Research, marketing and writing runs (change 2) | $128.13 | about $98 | Replayed on the real call sequences: 23% |
| Quiet work-mode rounds (change 1) | $9.51, and about $1 an hour while a floor idles in its hours | about $0.35 for an eight-hour quiet day (4 rounds, not 96) | Counted; the mechanism is tested |
| Manager wakes on Claude floors (changes 3 and 4) | $0.06 to write its instructions on each cold wake | $0.002 to read them within the hour; about $1 a day at this rate of wakes | Worked out from the wake gaps; first seen live when Claude floors run again |
| A small change to a live site (changes 7, 8) | $2.16 to $8.11 | perhaps $1 to $3 | A guess from the step counts, until one runs |
| A fix round on a big build (change 6) | about $9 (task 1910) | about $3 | Worked out from that session's own numbers |
| Computer work in general (change 9) | $218.63 | a few per cent less | A guess |

Together: roughly **$45 to $65 of the $411 (11% to 16%)** at the same workload, and nearly all of what an idle work-mode floor was costing. The largest
part of the bill, a strong model building and testing in a real browser, is unchanged on purpose.

Per typical task:

| Task | Measured | Expected now |
|---|---|---|
| A forty-step research job (the cap) | $3.15 ($0.079 a step on average) | about $2.45 |
| A long research job like task 2695, model calls only | $27.71 | about $21.70 |
| A first website build on a computer (tasks 2572, 2612; Fable) | $17 | about the same |
| A Tester pass on a computer | $2.90 on average | about the same |
| A small change to a live site | $2 to $8 | $1 to $3 |
| A fix round on a build past 250,000 tokens | about $9 | about $3 |
| A manager wake on a Claude floor | $0.15 to $0.29 | $0.06 to $0.10 less when it comes within the hour |
| A quiet work-mode hour | $1.04 | $0.26 in the first hour, then almost nothing |

## Things seen and not done

- **Claude through OpenRouter has no cache breakpoint on the system prompt.** The manager on floor 6 started 185 of its 208 wakes cold. With change 1
  most of those wakes are gone. An explicit breakpoint would need a paid test against OpenRouter to be sure of.
- **No compaction inside a computer session.** The platform only compacts near its own limit, and stopping a session part way to start another risks
  the work. Requests above 400,000 tokens were $18.50 in the three days.
- **No step cap on computers.** The owner removed those on purpose (11-07), and a cap that bites fails the task after the money is spent.
- **Cheaper models.** Work-mode rounds already run on Sonnet, small talk and notebooks on Haiku. Building, testing, reviewing and research stay where they are.
- **Shorter page fetches or file reads.** A Researcher that cannot see the bottom of a price page does worse work.

## A thing the owner should know

On 2026-11-11 the building's lifetime Claude total stood at **$395.01 against a limit of $395** (`BUDGET_ANTHROPIC_USD`). Every floor that works on
Claude has stopped until that is raised; floor 7 is marked as stopped for it. Floor 6 carries on, on OpenRouter ($42.05 of $140).

## Second pass (2026-11-11, 35 minutes after the first went live)

Too soon to judge the first pass on money: $0.27 was spent in those 35 minutes, all on floor 6, and every Claude floor is still stopped at the building's
Claude limit. What could be seen: floor 6's quiet rounds went from one every 5 minutes to 15 and then 45 minutes apart, as change 1 intends.

So this pass looked at whether the work finishes, which the first did not. Over the three days to 2026-11-11 17:10 UTC:

| Who | Jobs that ran | Finished | Failed | Cancelled after money was spent | Finished without being sent back |
|---|---|---|---|---|---|
| Tester on floor 6 (Gemini, no computer) | 8 | 3 | 3 | 2 | 3 of 3 |
| Tester on floor 7 (Opus, on a computer) | 13 | 12 | 0 | 0 (one still open) | 12 of 12 |
| Builder, every floor | 39 | 39 | 0 | 0 | 36 of 39 |
| Researcher on floor 6 | 11 | 8 | 0 | 3 | 8 of 8 |

Send-backs are rare everywhere (8 tasks in three days). The one role that does not finish is the Tester with no computer, and its transcripts say why:

- **It has no way to find a line in a file.** Task 3114 read the same 23,599-character page five times; task 3653 read one of 29,105 characters four
  times. On a model with no prompt cache each of those is paid for again on every later step: 30,000 to 38,000 prompt tokens a step, forty steps.
- **It could not see the end of a long page.** `read_file` stopped at 40,000 characters and said nothing. The three pages task 3111 was asked to
  check are 43,000 bytes each.
- **It wrote scripts nothing could run.** Task 3653 spent 25 of its 40 steps writing `check.js`, `check2.js`, `run_tests.js` into the live project's
  folder, then ran out of steps having tested nothing.
- **It was briefed as if it had a browser.** "Test https://thetirerx.com/ as a stranger at phone (390px) and desktop (1280px)", to someone who can open
  neither a browser nor, from where it works, its own floor's live site.

All three "ran out of steps" failures since the 40-step cap went on are this one role on this one floor: $3.93, and nothing to show for it.

| # | Change | Where | Switch off with |
|---|---|---|---|
| 10 | **`search_files`.** Staff without a computer, the manager and the Lawyer can find a word, link or phrase across the drive and get `file:line: text` back: a few hundred characters where reading the page was 40,000. Private projects stay out of it, as with reading. Computers are untouched (they have grep). | `server/tools.js` | take `search_files` out of `STAFF_TOOLS`, `MANAGER_TOOLS` and `LAWYER_TOOLS` |
| 11 | **A long file can be read to the end.** `read_file` now ends a part on a whole line, says "Lines 1 to 812 of 2,340. Read on with from_line: 813", and takes `from_line`. A file under 40,000 characters comes back exactly as before. | `server/tools.js` `readPart` | revert the commit |
| 12 | **Said plainly: nothing runs there.** Staff without a computer are told there is no shell, Node or browser, that a script written to check something never runs, that their own floor's live pages can't be opened from there, and to check by searching and reading. The manager of such a floor is told to brief a Tester with the files and the exact words to look for, never "at phone and desktop size". | `server/prompts.js` `NOTHING_RUNS`, `managerPrompt` | prompt text; revert the commit |

Expected: a reading Tester's job at about half the prompt tokens (one search and one part of a page, not the page five times), and jobs that end with
a report. To be checked at the next pass with `scripts/efficiency-report.mjs`, which now prints, by floor and role, how many jobs finished, failed,
were dropped after money was spent, what a finished one cost and how many finished first time, and counts jobs that ran out of steps.

### The cost alert

`server/costalert.js`. The owner's assistant gets one line, silently, through the gateway hook the contractor ping already uses
(`OPENCLAW_HOOK_URL`, `OPENCLAW_HOOK_TOKEN`), sent with `deliver: false`:

| When | Told |
|---|---|
| One task passes $5 | once; and once more when it passes $20, which is the only alert that asks the assistant to tell the owner |
| A floor's day (UTC) passes $10 | once, then again at $25, $50, $100, $200 and $400 |
| A task is sent back for the third time | once |
| A Builder starts the first build of a project that has never been live | once per project |

Each message asks for exactly one line appended to `~/.openclaw/workspace/memory/office-cost-alerts.md` and nothing else. The floor's name and the task's
title are fenced as untrusted data. Each thing is told once (the `cost_alerts` table), six an hour at most across the building (one that is held goes
when the hour has passed; the $20 one is never held), in the background, and a dead gateway never fails a charge. Demo floors are left out.
`COST_ALERTS=0` turns it off; `COST_ALERT_TASK_USD`, `COST_ALERT_FLOOR_DAY_USD`, `COST_ALERT_SENT_BACK`, `COST_ALERT_TELL_USD` and
`COST_ALERTS_PER_HOUR` move the lines.

## How to measure it again

The scripts used are read-only and take the database path as it is inside the container. The useful queries:

```sql
-- by role, three days
SELECT COALESCE(a.role,'-') role, l.kind, l.model, COUNT(*) n, ROUND(SUM(l.cost_usd),2) usd, ROUND(AVG(l.prompt_tokens)) avg_prompt
FROM ledger l LEFT JOIN agents a ON a.id=l.agent_id WHERE l.created_at >= (strftime('%s','now')-259200)*1000 GROUP BY 1,2,3 ORDER BY usd DESC;
-- quiet rounds
SELECT floor_id, day, COUNT(*) rounds, SUM(tasks_done=0 AND tasks_failed=0 AND published='[]') quiet FROM mode_runs GROUP BY 1,2;
-- how big each computer's conversation got
SELECT id, title, session_ctx, revisions, ROUND(cost_usd,2) usd FROM tasks WHERE session_ctx > 0 ORDER BY session_ctx DESC LIMIT 20;
```

A call missed the cache when `(cost_usd - completion_tokens * completion_price / 1e6) / prompt_tokens` is near 1.25 times the input price, and hit it when near the cache-read price.
The server log says `work mode quiet round` each time change 1 holds a floor back, and `fix round on a fresh computer` each time change 6 acts.
