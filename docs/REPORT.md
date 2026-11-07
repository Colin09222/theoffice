# The Office: build report

The code is finished and passes every gate that could run on the build machine. See the status section for what was still unproven at build time.

## What's built
- **Lobby:** procedural daylight harbour city and tower (drag to turn, scroll to ride), with a real sun shadow map, distance haze, streets, parks, trees, balconies and traffic; glass directory with search, lift buttons, "Open an office". All original assets and wording. The office floor sits on top of the same city at its real height. Rendering adapts in three quality tiers (shadows, post-processing, density, pixel ratio) and steps down if frames drop; `?q=high|mid|low` forces a tier for testing.
- **Codes:** `node scripts/admin.mjs code [--floor N]` issues one-time hashed codes. Claiming sets company, colours, boss and character, and gives a one-year cookie plus a rotating recovery code.
- **Customising:** company, boss, staff names and looks, decor.
- **Chain of command:** streamed chat with the manager, who brainstorms, then plans, assigns, reviews and reports, and can hire within a cap. Staff can ask the boss a question. The boss can pause, resume, stop or redirect.
- **Live view:** SSE drives status, feed, task board, spend and the characters. Runs continue server-side and viewers catch up on return.
- **Outputs:** sanitised docs, research with sources, and static sites at `/theoffice/f/<slug>/<project>/`, with a per-floor gallery.
- **Visitors:** read-only, with private work redacted. Reading the chat is opt-in per floor.
- **Purchase requests:** recorded only; no payment code exists.
- **Admin:** all floors and spend, issue codes, suspend, reset, kill, global pause.

Stack: Node 22, `@anthropic-ai/sdk` as the only dependency, `node:sqlite`. Agent workspaces are database rows, so agent paths never touch the real filesystem.

## Tests
Node 22, mock mode. Run with `npm test`, `npm run e2e` and `npm run e2e:apps`.
- Node tests: 271 of 271, including the adversarial security suites.
- App-origin browser test in real Chrome: 26 of 26.
- Soak: 50 floors, 4 rounds, 688 tasks, no errors, heap flat at about 12 MB, RSS 212 MB.
- Browser: 48 of 48 at 1440x900 and 390x844. Lobby about 30 draw calls, busy office about 285, under 30k triangles.
- An independent review found 10 bugs, all fixed with regression tests. It was not rerun after the fixes.

## Status at build time
- No real OpenRouter call.
- Docker image never built.
- Brave search never called for real.
- Not deployed.
- Not tested on a real phone, Safari or Firefox.

## Real builds (branch `real-builds`, not deployed)
Both parts are off until switched on. See `docs/DEPLOY-REALBUILDS.md`.

- **A real computer:** the Builder and hired Tester work in Anthropic-hosted containers through Claude Managed Agents, with Node 22, npm, a build step, tests and a headless browser. Nothing they run touches this server. Each task gets its own container, holding one project's files and none of our secrets. Results sync back through a hostile-input tar parser and a three-way merge. A session has a hard dollar budget, 40 model requests and 30 minutes.
- **App-grade publishing:** with `APPS_BASE_DOMAIN` set, each project has its own origin, so localStorage, service workers and PWA install really work. Without it, sandbox mode is unchanged.
- **Project backend:** per-player saves, leaderboards and shared state on each project's own origin, with `_office/client.js` as the client. It is not available in sandbox mode, where every site shares one opaque origin and could not be isolated.

Measured with real sessions on Claude Opus 5.5 at effort high (a small Vite game with a PWA and Playwright tests, on list prices):

| Job | Cost | Time | Model requests |
|---|---|---|---|
| Builder, first run | $0.85 | 5m 42s | 15 |
| Builder, second run | $0.71 | 4m 19s | 17 |
| Tester | $0.48 | 2m 34s | 14 |

The Tester runs on Claude when it has a computer, because Managed Agents runs only Claude, so the second-lab opinion only applies with computers off.

Known limits:
- A container can reach npm, PyPI and GitHub (`allow_package_managers` opens more than registries). A prompt-injected agent on a task could send that one project's files there, private projects included.
- The container has platform variables named `ANTHROPIC_COMMIT_TOKEN` and `ANTHROPIC_COMMIT_SIGN_URL`. They aren't ours and no key of ours is present, but their reach is untested.
- With the apps domain under iscolinfree.com, published pages can plant cookies on the main site. See section 0 of the deploy doc.
- A service worker outlives a killed floor in visitors' browsers. The origin is never reissued to anyone else, which contains it.
- Sessions stay in the Anthropic Console, with project files and transcripts, until someone deletes them.
- The manager and other roles still have no computer.

## Known limits
- An interrupted task resumes from its last completed step, and the aborted call is charged as an estimate.
- Spend caps reset at midnight UTC.
- Rate limits and SSE are in-process, so a restart resets limits and drops streams; browsers reconnect.
- Signed links to private projects work for anyone holding them, for up to an hour.
- Public chat hides private names and titles, but not paraphrases.
- A prompt-injected agent on a public task can still damage that floor's public projects, but can't escape the sandbox, spend past the caps, or read private projects or other floors.

## Models
Most roles run on Claude Opus 5.5 through the Claude API (`$4` in, `$20` out, `$0.20` cache reads per million tokens), with effort set per role in `config/models.json`: manager high, researcher/writer/analyst/marketer medium, builder xhigh, designer/illustrator high. The hireable Tester runs on `google/gemini-3.1-pro-preview` through OpenRouter (`$2`/`$12`) for a second opinion from another lab. Assistant turns replay Claude's own content verbatim so history stays append-only; prompt caching and server-side refusal fallbacks are on.

Floor agents must not use the Claude CLI or a Claude subscription.

Spending caps are off on the live server at the owner's request (`FLOOR_DAILY_USD`, `GLOBAL_DAILY_USD` and `TASK_MAX_USD` set to `off`; defaults are 10, 25 and 3). The limits of 14 steps per staff task and 60 tasks per floor per day still apply.
