# The Office: build report

The code is finished and passes every gate that could run on the build machine. See the status section for what was still unproven at build time.

## What's built
- **Lobby:** procedural dusk city and tower (drag to turn, scroll to ride), glass directory with search, lift buttons, "Open an office". All original assets and wording.
- **Codes:** `node scripts/admin.mjs code [--floor N]` issues one-time hashed codes. Claiming sets company, colours, boss and character, and gives a one-year cookie plus a rotating recovery code.
- **Customising:** company, boss, staff names and looks, decor.
- **Chain of command:** streamed chat with the manager, who brainstorms, then plans, assigns, reviews and reports, and can hire within a cap. Staff can ask the boss a question. The boss can pause, resume, stop or redirect.
- **Live view:** SSE drives status, feed, task board, spend and the characters. Runs continue server-side and viewers catch up on return.
- **Outputs:** sanitised docs, research with sources, and static sites at `/theoffice/f/<slug>/<project>/`, with a per-floor gallery.
- **Visitors:** read-only, with private work redacted. Reading the chat is opt-in per floor.
- **Purchase requests:** recorded only; no payment code exists.
- **Admin:** all floors and spend, issue codes, suspend, reset, kill, global pause.

Stack: Node 22, zero npm dependencies, `node:sqlite`. Agent workspaces are database rows, so agent paths never touch the real filesystem.

## Tests
Node 22.23.4, mock mode. Run with `npm test` and `npm run e2e`.
- Node tests: 156 of 156, including the adversarial security suite.
- Soak: 50 floors, 4 rounds, 688 tasks, no errors, heap flat at about 12 MB, RSS 212 MB.
- Browser: 48 of 48 at 1440x900 and 390x844. Lobby about 30 draw calls, busy office about 285, under 30k triangles.
- An independent review found 10 bugs, all fixed with regression tests. It was not rerun after the fixes.

## Status at build time
- No real OpenRouter call.
- Docker image never built.
- Brave search never called for real.
- Not deployed.
- Not tested on a real phone, Safari or Firefox.

## Known limits
- An interrupted task resumes from its last completed step, and the aborted call is charged as an estimate.
- Spend caps reset at midnight UTC.
- Rate limits and SSE are in-process, so a restart resets limits and drops streams; browsers reconnect.
- Signed links to private projects work for anyone holding them, for up to an hour.
- Public chat hides private names and titles, but not paraphrases.
- A prompt-injected agent on a public task can still damage that floor's public projects, but can't escape the sandbox, spend past the caps, or read private projects or other floors.

## Models and live prices
From OpenRouter `GET /models` on 2026-11-06; all support tools. Prices are per million tokens.

| Role | Model | In | Out |
|---|---|---|---|
| Office Manager | `anthropic/claude-sonnet-5.5` | $2.00 | $10.00 |
| Researcher, Writer, Analyst, Marketer | `anthropic/claude-haiku-5.5` | $0.10 | $0.50 |
| Builder, Tester | `qwen/qwen3.7-plus` | $0.32 | $1.28 |
| Designer, Illustrator | `google/gemini-3.1-flash-lite` | $0.25 | $1.50 |

## Cost per typical task
Estimated from token arithmetic, not measured. "Make a small site about X" with four staff tasks comes to about $0.09; plan on $0.10 to $0.25. The $2 floor cap buys roughly 8 to 20 such tasks a day. Each task also stops at $0.60 or 14 steps, and a floor can create at most 60 tasks a day.
