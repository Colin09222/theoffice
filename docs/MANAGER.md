# How the floors handled what the boss said, and what was changed (2026-11-11)

Measured on the live building, read-only, from `/data/office.db`: every boss message on floor 6 (TheTireRx) and floor 7 (Cailyn Aungst Photography)
since each opened on 2026-11-10, with the manager's replies, the tasks each message led to, the ledger, the questions and the work-mode rounds.
Both floors have their Builder (and on 6 the Designer and Researcher too) with the outside contractor, and both are stopped at a limit now, so
nothing here could be run again live: the numbers are what happened, and the changes below are proved in tests with scripted model calls.

## The two floors in one table

| | Floor 6, TheTireRx | Floor 7, Cailyn Aungst Photography |
|---|---|---|
| Boss messages | 91 (11-10 02:03 to 11-11 18:37 UTC) | 40 (11-10 03:14 to 11-11 14:09 UTC) |
| Spent on AI | $173.04 ($1.90 a boss message) | $90.03 ($2.25 a boss message) |
| Manager's own model calls | 600, $23.48 | 129, $6.48 |
| First reply after a boss message | median 9 s, nine in ten within 81 s | median 13 s, nine in ten within 44 s |
| Boss messages that led to new tasks | 36 | 19 |
| First task after one of those | median 45 s | median 39 s |
| Tasks created | 86 | 39 |
| Tasks cancelled | **44 (39 before anyone started them)** | 6 (all before anyone started) |
| Tasks failed | 3 ($3.93, the Tester with no computer) | 0 |
| Sent back by the manager | 4 tasks, 6 times | 1 task, once |
| Lines the boss got in the chat | **405** (250 from the manager, 150 office notices, 5 reports) | 81 |
| Manager's messages, length | median 82 words, one in ten over 136 | median 68 words, one in ten over 130 |
| Questions put to the boss with ask_boss | 2, the same question twice in four minutes | 1 |

Speed is not the problem. The manager answers in seconds and hands out the first task in under a minute. What goes wrong is what it hands out,
how often it does it again, and how much it says.

## What went wrong

### 1. A new plan for every message while the boss was still thinking: 29 tasks made, 26 cancelled, in 37 minutes

On floor 6 between 05:08 and 05:45 on 11-10 the boss sent 13 messages working out a change of direction ("we might need to pivot our whole idea",
"start in that state", "yes let's target those three states", "it would also be great to delineate between private passenger and commercial").
The manager answered each with a whole pipeline (Researcher, Writer, Designer, Builder, Tester), cancelling the last one first: 5 tasks, then 5,
4, 1, 1, 9 and 4. Of those 29 tasks 26 were cancelled, nearly all before anyone had started.

Over the floor's two days 44 of 86 tasks were cancelled. Five of them had already cost money ($20.97, of which $14.91 was one research job sent
back twice and then dropped). The same Builder and Tester pair ("Second seller column, privacy page and the legal fixes") was created three times
in eight minutes. The manager has no way to change a job that is waiting: it can only cancel it and write it again.

### 2. "Nothing new started this round", every five minutes: 218 of the 405 chat lines

Floor 6 ran 122 work-mode rounds; 117 handed out nothing. Each one still put two lines in the boss's chat: the manager's own ("Right, so, Justin,
nothing new started this round. The button (#3074) is still with the outside contractor...") and the office's ("**On our own:** Looked over where
things stand."). That is 96 "nothing new" messages from the manager and 122 "On our own" notices. Between 19:55 and 22:48 on 11-10 one pair
arrived every five minutes. The rounds now back off (docs/EFFICIENCY.md, change 1), but each round that does run still says both lines.

Inside those repeats the manager asked the boss the same thing again and again: "The office records still list the site as private. Is that on
purpose?" appeared in five rounds in a row, and it was put to the boss twice through ask_boss within four minutes.

### 3. The site went private, and the manager then explained it wrongly

"Words only" tasks marked private flipped the live directory private (fixed in 278367e). The boss found out by typing the address: "its saying
not found" (20:28). From there to a public site with everything on it took until 22:50, two hours and twenty-two minutes, and 29 manager messages
talked about it. After the boss said it should be public (22:13), the manager told them four times that "the office locks the site while the
contractor has it", which is not a rule anywhere: a tool had refused for another reason, and the manager made one up.

### 4. Guessing instead of asking one question, and answers to nobody

- Floor 7, 03:24: "please fix that layout". The manager guessed the phone header, wrote the plan and queued a Tester. "nah i mean like the
  portfolio." Two Tester tasks made and cancelled.
- Floor 7, 02:14: "it didnt change also can you make the header photo change?" The reply was "It's a CSS aspect ratio, not a rating." The boss:
  "huh?" (The first half was true: the new bio had been saved and never put live, waiting for a Tester to check a text swap.)
- Floor 6, 02:41 to 02:59: getting the name right ("TIRErX", "*TireRx", "How about TheTireRx.com", "lets make sure its TheTireRx", "Yes please
  update") took five messages and three tasks (two cancelled), and the rename itself was $8.11 and 75 minutes.

### 5. Small changes got the big routine, and a Tester each

| What the boss asked | What it became | Until it was live | Cost |
|---|---|---|---|
| "my insta is @cailynaungst" | one Builder task behind the first build | almost 22 hours | $6.55 (51 model calls) |
| the site is called TheTireRx | 3 tasks, two cancelled | 93 minutes | $8.11 |
| "Reply time 5 days", then 20 seconds later "data retention 12 months" | two separate Builder tasks | 96 minutes each (with the contractor) | no model |
| a new bio, pasted in | Writer, Builder, then a Tester before it could go live | saved after 23 minutes, live only when the boss said "it didnt change" | $1.04 |
| "the email should be hello@thetirerx.com" | queued for "one republish" | 127 minutes | no model |

On floor 7 the Builder's work is done by the contractor, so the Tester was the whole cost of a change: seven tests of changes at $1.83 to $7.65,
$23.09 of the floor's $35.91 of testing. "Check the new bio on phone and desktop" was a browser test of a paragraph. (The manager was told on
11-11 never to add a Tester for a small change, c7674fa; every one of these is from before that, and the floors have been stopped since.)

### 6. The Tester found what the Builder could have

Of floor 7's 12 finished tests, 5 began PASS. Three began FAIL and four were lists of problems ("The new version still...", "Booking reached
the inbox, but..."). 79 of 86 briefs on floor 6 and 26 of 39 on floor 7 already end with a "Done means:" list, but nobody doing a job was asked
to tick it off with proof before handing in, so the list was first checked by the next person, a whole task later.

### 7. Status questions answered with paragraphs

"whats status", "when are we live", "is everyone working?", "GIVE ME STATUS UPDATE": 10 of floor 6's 91 messages. The answers ran to 80 to 130
words, opened with "Right, so, Justin," and repeated the whole queue. When the floor was stopped at the building's limit (14:26 to 17:59 on 11-10)
the boss asked five times why nobody was working and got the same line five times. That last part is as designed (no bot is told about limits)
and was left alone.

## What was changed

Five changes, each with a switch. Set it in `.env` and restart; nothing else needs undoing. With all five off, the manager's instructions and tools are
byte for byte what they were at 297f14e (checked), and the new columns on a task are simply left empty.

| # | Change | Where | Switch off with |
|---|---|---|---|
| 1 | **The fast path.** The manager sizes a request first. A small one (a link, a few words, a name, a number, a picture, one fix) is one `assign_task` with `size: "small"`. Whoever gets it is given a few lines ("do exactly this, check it where it changed, publish it again") in place of their part of a playbook or the routine for a live change, nobody gathers at the whiteboard, and no Tester can be queued behind it: the tool refuses one that waits on it, comes after it, or is handed out for the same project in the same turn, and refuses one the manager thinks of once the change is back (for a day, and never when it is the boss who asks for the test). | `server/tools.js` `assign_task`, `server/engine.js` `smallBefore`, `server/prompts.js` `smallBrief`, `FAST_PATH` | `MANAGER_FAST_PATH=0` |
| 2 | **The intent check.** The manager says back what it understood in one line and puts that line on the job (`intent`), where whoever does the work, the Tester and the outside contractor all read it as "What the boss asked for". If the manager hands out work on the boss's turn and writes nothing, the office says "On it: (that line)". It acts unless the request could mean two different jobs or is hard to undo (money, taking something down, public or private, sending something out), and then asks one short question. A second `ask_boss` while one is unanswered is refused. A question from the boss gets an answer, not a job. A tool's refusal is passed on as it was said, never explained with an invented rule. | `server/tools.js` `ask_boss`, `server/engine.js` `bossAsked`, `runManager`, `server/prompts.js` `INTENT_CHECK` | `MANAGER_INTENT_CHECK=0` |
| 3 | **One plan up front.** Each job carries its acceptance checks as a field (`checks`); the office writes them into the brief as a numbered "Done means:" list, or reads them out of one the manager typed. Each job gets an estimate: the median of what the last finished jobs of that kind and size cost on that floor, then in the building, then a typical figure. A job that hasn't started is changed in place with the new `amend_task` (a line added, a new brief, new checks, a new size). A second copy of a job already waiting for the same person on the same project is refused, with the number of the one to amend, and a cancel of a waiting job says the same. The manager's state message now shows each open job's plan and what it waits on, so a plan can be read back and left alone. It is told to plan again only when something failed or the boss changed direction, and to talk an idea through while the boss is still working it out. | `server/tools.js` `amend_task`, `assign_task`, `server/engine.js` `amendTask`, `managerContext`, `server/brain.js`, `server/prompts.js` `PLAN_FIRST` | `MANAGER_PLAN_FIRST=0` |
| 4 | **The self-check.** Whoever does a job with acceptance checks is given them numbered and asked to end the reply with "Self-check:" and one line for each: PASS, FAIL or NOT CHECKED, with what they opened, ran or read and what they saw. A reply without it is asked once, in the same run (on a computer: in the same session, before anything is collected or published). The self-check is kept beside the report, so cutting the report to length can't lose it. The manager sees it with the report, marked as the doer's word and not proof, and is told when work came back with none; a Tester is handed it and told to start with what was marked FAIL or NOT CHECKED. The contractor's job sheet asks for the same, and it is read out of the summary they hand back. A Tester is not asked to check itself. | `server/brain.js`, `server/engine.js` `runStaff`, `keepSelfCheck`, `handoffFor`, `server/computer.js` `owesSelfCheck`, `server/contractor.js` `jobFor`, `server/prompts.js` `SELF_CHECK_REVIEW` | `STAFF_SELF_CHECK=0` |
| 5 | **Plain reporting.** A work-mode round that follows a quiet one, with nothing new on the floor since, stays out of the chat: the manager's words are held, and reach the boss only if the round changed something (a job handed out, a question, a request, something published, the goal); the "On our own" line is not repeated either. The first quiet round still says so, and so does the first after anything changes. The manager is told: one message per finished request (what changed, the link, what the boss must do), a status question answered in a line or two, and nothing said when nothing has changed. | `server/engine.js` `runManager`, `server/modes.js` `finishRun`, `stillQuiet`, `server/prompts.js` `PLAIN_REPORTS` | `ROUND_REPORTS=all` |

### What the server makes sure of, and what the model is only asked

It matters which is which, because no floor could run on a real model while this was built.

| Made sure of by the server (tested) | Asked of the model (instructions only) |
|---|---|
| No Tester queued behind a job marked small | Marking a small request small in the first place |
| A small job gets the short guide, not a playbook | Writing a brief of a few lines for it |
| One unanswered manager question at a time | Asking only when it is really unclear or risky, and acting otherwise |
| The request line reaches the doer, the Tester's handoff and the contractor | Writing a request line that is what the boss meant |
| "On it: ..." when work is handed out without a word | Answering a question without handing out work |
| A waiting job can be changed in place; an identical waiting job is refused | Using amend_task and not cancel-and-rewrite; not planning while the boss is still deciding |
| Checks stored, numbered and handed over; one ask when the self-check is missing | A self-check that is honest. It is the doer's word, and is labelled as that everywhere it is shown |
| Repeat quiet rounds kept out of the chat | Short messages, and one message per finished request |

Nothing here spends on its own. The self-check ask costs one more step only when a reply came without it. The manager's instructions are longer by
4,471 characters (about 1,100 tokens, 15%): on a Claude floor that is read from the hour-long cache; on floor 6, whose manager runs through OpenRouter
with no cache point, it is about a fifth of a cent more for each manager call.

### Kept as they were

Billing caps and the building's limits; floor limits; the contractor hold (a small Builder job is held like any other, with no model call, and what
is held is never handed out twice or amended from the floor); the privacy rules; the live-site protection from 278367e (a small private job into a
live public site is refused exactly as before); the loop caps. Each has a test in `test/manager.test.js` under "what was kept", beside their own suites.
No dollar figure reaches a boss, a visitor or a bot: the estimate lives in the database, the server log and the admin's report.

## What it should change, on the two floors' own numbers

| | Measured | With the changes | How sure |
|---|---|---|---|
| Round lines in the boss's chat, floor 6 | 218 (117 quiet rounds, two lines each) | 64: replayed on the real sequence, 85 of the 117 were repeats with nothing new on the floor, and those say nothing | Counted from the real rounds; the mechanism is tested |
| A Tester behind a small change, floor 7 | 7 tests, $23.09 | none, when the manager marks the change small | The refusal is tested; the marking is the model's |
| Tasks cancelled before anyone started, floor 6 | 39 of 86 | most of them become an amended job or no job at all | A guess until a floor runs: it depends on the manager using amend_task |
| The same question put to the boss twice | once, four minutes apart | refused the second time | Tested |
| Two small changes sent 20 seconds apart | two tasks | one, if the first is still waiting (amend_task) | The model's choice |
| What the Tester finds that the Builder could have | 7 of 12 tests on floor 7 came back with problems | fewer; the Builder ticks the same list first and says what it couldn't check | A guess until a floor runs |

## What to watch when the floors are unpaused

Run `scripts/manager-report.mjs` (below) after the first day and compare with the first table in this file.

1. **Small jobs.** "small jobs N" should be above zero on any floor whose boss asks for changes, and "Tester jobs" should fall. If small jobs stay at
   zero the manager is not sizing: read a few of its turns. If a small job broke a live page, that is the price of no Tester: look at its self-check.
2. **Cancelled before anyone started** should fall well below the 39 of 86 it was, and "waiting jobs changed in place" should be above zero.
   If cancels stay high and amends stay at zero, the instruction is not landing and wants rewording.
3. **Self-check.** "N of M jobs with acceptance checks came back with one" should be nearly all. Watch the server log for how often the ask had to
   be sent (`is checking the work against its brief` in a floor's feed is the computer's one). Every PASS with no evidence is flagged to the manager;
   a floor where the Tester keeps failing what the Builder marked PASS has a Builder that is not really checking.
4. **Estimates.** "cost more than twice their estimate" names the jobs to look at. The estimate learns from each floor's own finished jobs, so the
   first few on a floor are the typical figures and can be far off.
5. **The chat.** "lines for each thing the boss said" was 4.4 on floor 6 and 2.0 on floor 7. The log line `quiet round kept out of the chat` says
   each time a round was held back. If a boss says the team went silent, `ROUND_REPORTS=all` brings every line back.
6. **Questions.** "questions the manager put to the boss" should stay low. A manager that now asks about everything has read "risky" too widely.
7. **The manager's own cost.** Its instructions are 15% longer. On floor 6 (OpenRouter, no cache point) watch "the manager's own calls" against
   $23.48 for 600 calls: fewer rounds and fewer re-plans should more than pay for the longer prompt.

Not seen live: all of it. Floor 6 is stopped at its OpenRouter limit and floor 7 at the building's Claude limit, and this job was told not to touch
either or spend on a model. Every change is proved against scripted model calls in `test/manager.test.js` (37 tests) and the full suite (1,665 tests).

## Things seen and not done

- **A boss who sends three messages in a minute gets three manager turns.** 35 of floor 6's 91 messages came within 90 seconds of the one before
  ("TIRErX", then "*TireRx"). Waiting a few seconds for the boss to finish would fold them into one turn, at the price of every reply being that
  much slower. Not done without the owner's say.
- **The manager's messages are long** (median 82 words against "under 50" in its instructions) and open the same way every time on floor 6
  ("Right, so, Justin,"), which comes from the character the boss gave it. Left to the instructions.
- **The "Heads up, boss: ... is with the outside contractor" line** comes once per held batch (27 on the two floors). It is part of the hold and was
  left alone.
- **A stopped floor answers every question with the same line.** By design no bot is told about limits, so it can say nothing else.
- **The self-check is not shown to the boss.** It goes to the manager and the Tester. Showing it on the task card would be a small change to the page.

## How to measure it again

```
ssh hz 'cd /opt/theoffice && docker compose exec -T theoffice node scripts/manager-report.mjs 3 </dev/null'
```

For each floor whose boss said anything in the last three days it prints: boss messages and cost per message; how fast the first reply and the first
task came; tasks made, cancelled before anyone started, and changed in place; small jobs against their estimate; Tester jobs; estimate against cost
and the jobs that ran over; self-checks handed in and how many owned up to a FAIL; questions; rounds and round lines; and lines per boss message.
It prints counts and dollar figures for the admin's terminal, and never anything anyone said.
