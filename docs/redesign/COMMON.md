# Office redesign: rules for every build lane

The spec is `docs/redesign/OFFICE-ANSWERS-1.md` (approved by Colon, the owner). Read it all before your first job. `docs/redesign/CLAUDE-BRIEF-OFFICE-1.md` is the brief it answers (facts about today). Section 7 of the spec is the build order; section 8 the targets. Your lane file (`LANE-A.md` or `LANE-B.md`) lists your jobs, in order, with notes from the orchestrator.

## Where you are
- Repo: github.com/Colin09222/theoffice. Node 22, ES modules, SQLite, no framework. `npm install` then `npm test` (node --test, about 1,400 tests, mock mode, no keys needed). Browser suites live in `test/browser/` (`npm run e2e` etc.); run the ones your job touches if a browser is available in your machine; say in DONE.md if one could not run.
- The live site is fakebusiness.io/theoffice (Docker on a server you cannot reach). You have no production access and no API keys. Never add, print or commit keys, codes, card details or `.env` values. Never call the real Anthropic/OpenRouter/Resend/Stripe APIs; use the existing mocks.
- docs/ has the design history (MANAGER.md, EFFICIENCY.md, WORK-MODES.md, WORKERS.md, NUMBERS.md, BUSINESS.md, TOWER3D.md). Read what your job touches.

## One job per branch
- Branch names: `office-jNN-<slug>` (NN two digits, e.g. `office-j04-rehold`). Make each job's branch from the previous job's branch in your lane (the first one from `office-redesign-base`), so your lane is a stack. Push to **exactly that branch name** on origin (not a `claude/...` branch). Push after every green commit.
- Done signal, last commit of the job: `docs/redesign/jobs/jNN/DONE.md`:
  ```
  STATUS: GREEN            (or STATUS: BLOCKED <one line why>)
  JOB: NN <name>
  DONE MEANS: <the spec's line, then how you proved it: test names, numbers>
  TESTS: npm test <pass>/<total>; browser suites run: <names + results or "not available">
  DEPLOY NOTES: migrations, new env vars (name + default, never values), admin commands to run after deploy, anything the orchestrator must do on the live server
  RISKS: <short>
  ```
- Then go straight on to your next job. If a job is blocked, write STATUS: BLOCKED, push, and move to the next job that does not depend on it.
- Keep going through the whole lane without stopping to ask. If a ruling is unclear, pick the reading closest to the spec's words, note it under RISKS, and continue.

## How to build
- Change as little as you need. Match the code around you (comments, naming, idiom). Every new behaviour gets tests. All existing tests must still pass (fix tests only when the spec deliberately changes that behaviour, and say so in DONE.md).
- Every behaviour change that could hurt a live floor gets an env switch (name it, default = the new behaviour) so the orchestrator can turn it off without a deploy.
- Database: changes are additive and idempotent (new tables, `ADD COLUMN` guarded), in `server/db.js`'s existing migration style. Put your lane's migrations in one block marked `// redesign lane A` or `// redesign lane B` so the two lanes merge cleanly. Never drop or rewrite data.
- The other lane works in parallel on the same repo. Lane A owns the look (public/, the lobby, floor page, timeline) and `server/banter`-type talk; lane B owns the worker loop, costs and alerts (engine.js, rounds.js, contractor*, costalert.js, budget.js, llm.js, prompts.js). If you must touch the other lane's files, keep the change small and mention it in DONE.md.
- No model calls for anything the spec marks Tier 0 (status lines, timeline cards, banter, screenshots, smoke checks).
- Visitors never see money, model names, hours, or sign-ups/sales (unless the boss turned them on). Demo floors 1 and 2 never appear in public lists, tickers or launch walls.
- Plain English in the UI, short sentences.
- Respect "reduce motion". Text contrast at least 4.5:1.

## Finish
When your last job is done (or every remaining job is blocked), push, then write `docs/redesign/LANE-<A|B>-FINISHED.md` on your last branch with one line per job (NN, branch, STATUS, head SHA) and stop.
