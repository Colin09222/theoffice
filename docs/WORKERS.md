# Making the staff good at their jobs

Branch `ultra-workers`, from `lanes` at d4fd32c. Not merged and not deployed. No new env vars, tables or credentials.

Every number here comes from real runs of the real app on real models: Claude for the staff and the manager, OpenRouter for pictures and design reviews, real Managed Agents computers, real web search. The boss in those runs types the way people type: `make me a game`, `need a website for my moms bakery`, `dog walking biz in austin, can u figure it out`. Reproduce with `scripts/proof-workers.mjs`, which reads the keys from its environment and pauses the building at a spending limit counted across every run.

## What changed

**The manager reads a vague boss.** A request to make something is now the go-ahead, and it starts in that same turn. It asks one question at most, and only when it can't tell what the thing even is. Facts only the boss knows never hold up the work: they are left out, and asked for at the end. "idk", "u pick" and "sure" mean it chooses and starts. It talks like a capable friend: short, plain, no process talk, no praise as an opener.

**Handoffs.** Each person now starts with what the people before them reported, and their working papers and documents, inside their first message and marked as untrusted data. A public task is never handed private work. A computer isn't handed its own project, which it already has as files.

**A change to something live is an edit.** When a task's project is already published, the person gets a change brief instead of their part of the playbook: look first, change only what was asked, publish again. Before this, a game Builder asked to "add a level" was told "do not publish: the Tester plays it next".

**Jobs end live.** The manager's state lists anything finished but not live, comparing what's on the drive with what's published, including builds in a folder. A manager who closes a turn with reviewed work not live gets one reminder and no more.

**Nothing goes quiet, nothing gets stuck.**
- The chat gets a line, with no model call, when work moves from one person to the next or someone can't finish.
- A manager turn that runs out of steps or comes back empty tells the boss.
- A boss who answers a question by typing in the chat unblocks whoever asked.
- After a failure, whoever depends on that task waits for the manager to decide, and then goes ahead with what was saved unless cancelled.
- A stopped computer task reports what it last said and whether the work was saved.
- Staff get a warning before they run out of steps, and computers before they run out of money.
- Two computers never work on one project at once.
- Review notes reach the manager whole. Before, a Tester's verdict at the end of its report was cut off at 600 characters.
- The manager is told plainly when a fix round has been refused, rather than told it was approved.

**Output.**
- *Sites:* designers and builders get a brief naming what the default AI page looks like (cream and serif, terracotta button, centred hero over three cards, numbered how-it-works steps, pill badges, emoji icons) and start from one idea only this subject could have. Real typefaces come from `@fontsource` on npm, vendored into the project. The design reviewer is asked whether the page looks like a generic template.
- *Writers:* a story counts as a fact. No "has always", no "by hand in small batches", no invented product list. Anything assumed goes in a section headed "Assumed, please check".
- *Pictures:* a generated picture must not pass for a photo of the real business. Very large pictures are flagged by the checklist.
- *Games:* the Builder's brief is about feel: nobody loses in the first ten seconds, then it ramps; feedback on everything, sound made in code with a mute button; art that looks made on purpose; keyboard and touch each playable alone; rotating a phone never kills the player. The Tester plays in a real touch context with no keyboard, looks at a mid-play screenshot, and says whether it is fun.
- *Research:* competitors must really operate where the business would, and it ends with three lines on what this means. Publishing a research doc or plan refuses any link nobody on the floor opened or found in a search. Opening it lets it through; a stated reason goes in front of the boss.

**The final word.** The chat gets the link first, then the manager's words and next steps, plus anything the boss must check themselves. The full checklist is one click away under Report on the project card, and it no longer names models or lists empty rows in the chat.

**Cost.**
- Effort drops on routine turns, on the same model: manager high to medium, Designer high to medium, Builder on a computer high to medium, Tester on a computer medium to low.
- Only the search summary changes model: Opus to Sonnet 5.5, because it only reports what pages said. That is the one model change here, and it is one line in `config/models.json` if the owner wants it back.
- Platform docs go only to people who make pages. The Designer writes exact values rather than a stylesheet the Builder then rewrites.
- Small computer jobs are told to wrap up at 22 steps (16 for a Tester, 12 for a change), so they don't polish for 40.

## Measured, before and after

All costs are from the office's own ledger. "Before" is `lanes` at d4fd32c; the game and business numbers are from the last real runs on that branch, with a clear boss.

| Job | Before | After | What improved |
|---|---|---|---|
| Vague request, until work starts | 2 turns, first reply 122 to 224 words, $0.12 to $0.13 | 1 turn, 59 to 93 words, $0.07 to $0.08 | Every "make me X" starts at once. Only "ideas?" takes two turns, and the buttons on a new floor do too (three ideas or one question, then "u pick" starts). |
| Game | $3.11, 27 min. Builder $1.97 and it ran out of steps; Tester $0.83 reported bugs instead of fixing | **$0.99, 9 min** (Floppy Ears, final prompts). Builder $0.63, Tester $0.22, manager $0.15. The first run this session, before the wrap-up rule: $1.94, 32 min (Snack Stack) | Real art, sound and feedback where there was a line on a black screen. The Tester played 5 full runs, 2 on a touch-only phone context. |
| Website | about $2 (an earlier launch run, not the same job) | **$0.91** (Rosa's, final prompts). Builder $0.50, Designer $0.18, manager $0.14, Writer $0.09. First pass: $1.31 | A designed page rather than the cream template. No invented backstory in the words. |
| Business | $2.00. Researcher $1.00 (searches $0.41) | **$1.62, 10 min** (Good Boy Walks). Researcher $0.60 (searches $0.16), Builder $0.68, Writer $0.18, manager $0.15 | Local competitors with prices from their own pages, a named gap, honest "Unverified" marks. 13 sources, no false refusals from the link check. |
| Change after publish | not measured; the Builder would have got the game brief, which says not to publish | $0.24 (rename, location, focus on cakes; 1 file; 1.5 min). $0.41 on a game | Edits one file, goes live at the same link. |
| "u pick" on a finished job | started $0.47 of work nobody asked for (seen during this work, on earlier prompts) | $0.05, asks what's next | |
| Pause, resume, add-on, redirect, stop on a live computer | | $0.25, 7 of 7 checks pass (`docs/workers-evidence/midjob.txt`) | Spending stops; same computer resumes; redirect makes a new plan. |

Three floors ran at once on one server with no failed tasks and nothing crossing between them. Other runs going at the same time used separate servers.

Screenshots: `media/workers-*.jpg`, with `workers-before-*.jpg` for comparison. Transcripts and documents: `docs/workers-evidence/`.

## Still weak

- **One sample each.** Costs vary from run to run. The final-prompt game is one run, and the final-prompt website is one run with its Builder started later. The business job ran on prompts slightly older than the final ones and was not rerun, so its landing page has an AI photo that the newer picture rule should now prevent.
- **"10 to 20 minutes"** is what the manager promises. Three first jobs took about 10 minutes and one took 32, before the wrap-up rule. The "few minutes for a small change" wording was added after the last change test, so it has not been seen in a run.
- **Fun is judged by a Tester and by me playing briefly.** No person has played these, and the Tester's bot isn't a person. Phone checks are emulated touch in Chrome, not a real phone.
- **The live leaderboard:** the Tester can't reach it from a computer, so the manager tells the boss to try it. It does work: I posted a score through the live page on both games.
- **Follow-up tasks aren't replayed** unless the change is big, and the manager says so. A follow-up that breaks something reaches the boss first.
- **A late add-on starts a second computer** after the first finishes, because a running computer can't be handed a new instruction. It works, but costs more than it needs to.
- **The link check only proves a page was seen,** not that the fact is on it.
- **Not run for real:** a building with computers off, sandbox mode with no apps domain, and anything on the production server. Those paths are covered by mock tests only.
