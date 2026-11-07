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
