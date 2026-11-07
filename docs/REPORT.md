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
- **Purchase requests:** recorded, and relayed to the owner's assistant through the admin API. Domains are the one exception. See the launch kit section.
- **Admin:** all floors and spend, issue codes, suspend, reset, kill, global pause.

Stack: Node 22, `@anthropic-ai/sdk` as the only dependency, `node:sqlite`. Agent workspaces are database rows, so agent paths never touch the real filesystem.

## Tests
Node 22, mock mode. Run with `npm test`, `npm run e2e` and `npm run e2e:apps`.
- Node tests: 403 of 403, including the adversarial security suites.
- App-origin browser test in real Chrome: 26 of 26. Launch flow in real Chrome (`npm run e2e:launch`), on desktop and phone: 18 of 18.
- Soak: 50 floors, 4 rounds, 688 tasks, no errors, heap flat at about 12 MB, RSS 212 MB.
- Browser: 48 of 48 at 1440x900 and 390x844, run alone. Under heavy machine load two phone steps timed out, then passed when rerun alone, so that suite can be flaky under load. Lobby about 30 draw calls, busy office about 285, under 30k triangles.
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
- On the launch-kit branch a container can reach only npm and PyPI, plus `api.anthropic.com`, which can't be closed. See the launch kit section.
- The container has platform variables named `ANTHROPIC_COMMIT_TOKEN` and `ANTHROPIC_COMMIT_SIGN_URL`. They aren't ours and no key of ours is present. What the launch-kit work found is in that section.
- With the apps domain under iscolinfree.com, published pages can plant cookies on the main site. See section 0 of the deploy doc.
- A service worker outlives a killed floor in visitors' browsers. The origin is never reissued to anyone else, which contains it.
- Sessions stay in the Anthropic Console, with project files and transcripts, until someone deletes them.
- The manager and other roles still have no computer.

## Launch kit (branch `launch-kit`, not deployed)
Steps and rollback are in `docs/DEPLOY-LAUNCH.md`.

**Spending.** Bots can look and ask. They hold no tool that approves anything.
- **Domains:** the Manager checks a name and price and asks. The floor's boss gets a Buy button; that one click is the only way to spend. It takes ordinary names only, up to $25 a year and 2 a day per floor, paid from the Namecheap balance, with WHOIS privacy on and the registrant read from an existing domain for each purchase and never stored. A retry can't buy twice: the intent is flushed to disk before the create call, and an unclear answer is settled only from the account's own domain list. An order that never settles stays blocked for a person to resolve.
- **A bought domain** gets DNS pointed at the server and the same isolation as an app origin, and the TLS check approves it.
- **Everything else** stays a request with item, price, link and reason. `GET /api/admin/purchases` lists them for the owner's assistant, which marks them bought or rejected.
- **The card number** is not read or used anywhere in this code.

**Launch kit.** Visitor counts with no cookies or third party. Waitlists the boss reads and models never see. Search and social metadata, robots and sitemap. A checklist that runs at publish and refuses off-site assets, card fields and other people's payment links, and refuses possible invented claims unless a reason is given, which the boss then sees. Stripe Payment Links through `_office/pay`, so a bot can't swap the link for its own. A launch report filled in by the server from its own records.

**OpenRouter, where Claude falls short.** `generate_image` uses `google/gemini-nano-banana-2.1` ($0.037 an image in testing, against $0.138 for `google/gemini-3-pro-image`, with text just as clean). `review_design` uses `openai/gpt-6.1-sol` (about $0.009 a review). Both run on the server, as custom tools on a computer, so no key enters a container. Pictures reach the container as a mid-session file mount. Screenshots come back through the session's outputs folder, about 5 seconds after they are written.

**Web search** for the Researcher and Manager runs Anthropic's server tool in a separate short call that holds only the query.

**iOS** is an off-by-default foundation, tested with mocks only.

### Measured on real models (Namecheap stubbed)
| Job | Cost |
|---|---|
| Brainstorm, no work started | $0.035 |
| Full product launch: research with a real search, a site with a generated hero, Tester, launch report (Tiny Teacups, about 10 minutes) | about $2 |
| Dodge game with a shared leaderboard, Builder and manager | $0.79 |
| Flocking simulation, Builder and manager | about $0.48 to $0.62 |
| One web search call | $0.15, mostly the model at low effort, which is more than expected |
| Pause, resume, redirect on a live computer | $0.12 |

The real launch needed no correcting on honesty: the site said it wasn't open yet and made no invented claims, and the Tester flagged on its own that the AI-generated hero looked like a photo of real stock. A caption was added.

### Gaps from real builds
- **Network:** `allow_package_managers` is replaced by an explicit list of `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org`. On a real session npm, pip, Vite and Playwright all work, and GitHub, raw.githubusercontent.com and example.com are unreachable.
- **`ANTHROPIC_COMMIT_TOKEN` and `ANTHROPIC_COMMIT_SIGN_URL`:** partly answered. Both are set. They belong to the platform's git commit signing: the git config uses `commit-signer-anthropic` and `git-credential-anthropic`, and the sign URL's host is `api.anthropic.com`. A plain unauthenticated GET to that host from the container returned 403, so it is reachable through our network list, and that can't be switched off from here. The token itself was deliberately not decoded or used, so what it can do is **still unknown**. A first, broader probing script was declined by the session's own model, which called it credential reconnaissance; I narrowed the request rather than pushing. Since `api.anthropic.com` is reachable, a hijacked agent holding someone else's Anthropic key could in principle send that one project's files to that account. Not tested. No secret of ours is in the container.

### Independent review
A separate review of this branch found 16 bugs, including a path to a second create call after an unclear registrar reply, and a page that could freeze the server through the checklist. All 16 are fixed with regression tests, and the suspected items that were cheap to close are closed too. It was not rerun after the fixes.

### Limits
- **The private-name guard is a denylist.** It catches slugs, titles, task titles, names run together, encoded URLs and lifted phrases. It can't catch a paraphrase or a deliberate encoding such as base64 from a hijacked manager, and the owner's request gives the manager search. The query goes to a search provider rather than to an attacker's server, and what was searched for is off the public feed.
- **The checklist's claim detection is a pattern match.** It catches common shapes, and a determined bot can phrase around it or give a reason, which the boss sees. Prompts and the second-lab review are the other layers.
- **The checklist can hold the server's single thread** for up to about 1.5 seconds on a hostile project at the size limits (525 ms measured on a worst-case page; up to three pages' worth is read).
- **Visitor counts** don't see pages served from a service worker's cache, and can be inflated by anyone.
- **A private project's screenshot or image prompt** goes to OpenRouter when a private task asks for one.
- **Certificates** make a project's label, which contains its slug, visible in public certificate logs. This was already the case with on-demand TLS.
- **A hijacked agent in an approved iOS build session** could use the Expo token to submit that build to TestFlight. See the deploy doc.

### Not proven
Namecheap's real API (only a stub built from their published shapes), real DNS and certificates on middistance.com or a bought domain, these Caddy lines, Docker on hz, anything on a real phone, Safari or Firefox, and all of iOS, which can't be proven without the owner's Apple and Expo accounts.

### Decisions for the owner
1. **Whose name are domains in?** They are registered with the contact details on `DOMAIN_CONTACT_SOURCE`, so any friend's click puts a domain in the owner's name, and trademark or abuse complaints go to the owner. I block obvious brand names, but that is only a short list. If that isn't acceptable, keep domain buying off or lower `DOMAINS_PER_FLOOR_DAY`.
2. **Renewals.** Domains are bought for one year and nothing renews them. Decide whether they should auto-renew from the balance or lapse.
3. **Search engines on `middistance.com`:** project origins stay noindex unless the boss switches a project on, and bought domains are indexable. Keep that, or tell me otherwise.

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
