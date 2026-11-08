# Work modes and model routing

## Models: Opus only where it shows

Everything lives in `config/models.json`. A role names its model and effort; what a model costs is in `prices`, so changing a model changes its ledger price with it.

| Job | Who | Model | Effort |
|---|---|---|---|
| Asked for by the boss | Builder (and its computer), Designer, Illustrator | `claude-opus-5-5` | xhigh, medium, high; computer medium |
| Asked for by the boss | Manager, Researcher, Writer, Analyst, Marketer, the Tester's computer | `claude-sonnet-5-5` | high |
| Picked by the team in a work mode | every Claude role, computer sessions included | `claude-sonnet-5-5` | high |
| Unchanged | talk and banter `claude-haiku-5-5` low; search `claude-sonnet-5-5` low; the Tester's review on Gemini through OpenRouter (`autonomous.keepOwnModel`) | | |

Prices (USD per million tokens): Opus 5.5 4 / 20, cache reads 0.20; Sonnet 5.5 2 / 10, cache reads 0.20; Haiku 5.5 0.10 / 0.50.

`routeFor(models, role, { autonomous, computer })` in `server/config.js` picks the route. A task carries `auto=1` when the manager assigned it during a job the team picked for itself, and its staff calls and its computer session follow. A computer's autonomous variant is its own Managed Agents agent (`theoffice-<role>-auto`), so switching never rewrites the other and each keeps a stable prompt; when both settle on the same model they share one.

`buildRequest()` in `server/anthropic.js` shapes every Claude call for its model: adaptive thinking (never `disabled` on Opus 5.5 or Sonnet 5.5; Sonnet's thinking-off is `between_tools` at high or below), no forced `tool_choice` on either (it becomes `auto`), and the server-side fallback only as `fallbacks: "default"` under `server-side-fallback-2026-07-01`. Haiku gets no fallback. The search tool goes through it too. Per-mode instructions go after the cached prefix (a note in the manager's conversation, a line after a staff brief), so each model's cache holds.

Proof of the shape against the live API: `ANTHROPIC_KEY_FILE=... node scripts/proof-sonnet.mjs` (output in `docs/proof-modes/sonnet-live-call.txt`).

## Work modes

Per floor, set under Customise, Hours, or by chat ("work nonstop", "work 9 to 5 on weekdays", "only when I ask", through the manager's `set_work_mode` tool, which only works on the boss's own turn):

- **When I ask** (default, "On call" on the sign): as before.
- **Set hours** ("Open 9–5"): days of the week, start and end in the boss's time zone (learnt from their browser until they pick one). Hours that end before they start run overnight and belong to the day they start on. Outside the hours the floor shows Closed and the staff go home; the boss can still call the manager and the team comes in for it.
- **Nonstop** ("Open 24/7").

In set hours (inside them) and nonstop, whenever the floor has nothing that can go ahead, `server/modes.js` starts a job: a "Work mode:" note to the manager with the goal and the next-up list, then the ordinary engine and staff. The manager keeps the list with `update_backlog`; the boss sees the goal in the Work tab, above the next-up list. A task waiting on the boss's answer, anything queued behind it, and a request waiting for a Buy click don't count as work going ahead, so the team moves on. A due standing order goes first.

### A clear goal first

Set hours and nonstop need a concrete goal, one you can tell has been reached ("get the game to 1,000 plays", "launch the shop with 10 products"). No job starts on its own until the floor has one.

- The boss can type it under Customise, Hours, or say it with the mode ("work nonstop, our goal is ..."; `set_work_mode` takes a `goal`).
- With no goal, the manager asks once, in the chat: it either asks for one or proposes 2-3 that fit the company and asks the boss to pick. Turned on by chat, it asks in its reply; turned on from the form, the runner wakes it with a "Goal needed:" note as soon as the floor is quiet, open or not. Taking the goal away asks again.
- The goal comes from the boss's own words: their turn in the chat, or their answer to the manager's question. On any other turn `update_backlog` won't set or change it, and says why.
- When the goal is reached, the manager calls `update_backlog` with `goal_reached` and the next goal it proposes. The chat gets "**Goal reached:** ... Next goal: ... The team keeps going on it, ... as before. Tell me if you'd rather aim for something else." The mode stays as it was, the next job works toward the new goal, and the Work tab lists the last few goals reached.
- The Work tab says when it's waiting for a goal, and whether the manager has asked yet.

After each job the manager posts a line or two in the chat ("On our own: ..."), and once a day (at closing time, or at midnight in the boss's zone) a recap for the boss alone. No figures about money anywhere.

Pace and safety:

- `AUTOPILOT_GAP_MIN` (default 5): minutes between the end of one job and the start of the next.
- `AUTOPILOT_MAX_FAILS` (default 3): failed jobs in a row before the mode pauses and the boss is told. Setting the mode again starts it afresh.
- `AUTOPILOT_RUN_TIMEOUT_MIN` (default 180), `MODES_TICK_MS` (default 5000).
- There is no money cap per floor: the building's own limits stop it, as they stop everything else.

Routes (boss only): `GET/POST /api/floors/:slug/work-mode`, `POST /api/floors/:slug/work-mode/zone`. Visitors get `floor.workMode` (the sign and whether it's closed); the boss also gets `workPlan`.

Proof in mock mode: `AI_MODE=mock AUTOPILOT_GAP_MIN=0.05 node scripts/proof-modes.mjs` (output in `docs/proof-modes/mock-nonstop-3-jobs.txt`). Browser check: `node test/browser/modes.mjs`, `MODES_SHOTS=dir` for pictures.
