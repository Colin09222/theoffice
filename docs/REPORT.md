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
- **Lanes and help line:** Game, Website and Business buttons on a new floor, a playbook per lane, and a manager's tool for asking the owner's assistant for guidance. See that section.
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

## Floors plus (branch `floors-plus`, not merged, not deployed)
Owner's request: a better-looking floor, filler companies that look busy, and two more things that make the building better: standing orders and a live building. Steps and rollback are in `docs/DEPLOY-PLUS.md`.

**The floor.** The room is rebuilt: baked wall gradients, skirting, cornice, four-pane windows with mullions and the city through them, a glass-walled meeting room in the company's own colour around the whiteboard, a kitchen corner (counter, sink, coffee machine, kettle, mugs, fridge), a lounge (sofa, rug, lamp, cushions), three kinds of plant (two sway), a bookshelf, a printer with a status light, the neon sign, art, and a wall clock that shows the real time. The floor texture is baked once per floor from the tile pattern, wall ambient occlusion, contact shadows under every piece of furniture and warm light pools from the windows, so the phone tier (no shadow map) still reads as a room. Characters are bigger (scale 1.45, longer proportions), with eye whites, eyebrows, a smile and outfit detail, and animate from the real agent states only: walk (arm swing, hip sway, lean), type (hands on the keyboard, head bob), talk, think (hand on chin), listen (in meetings, facing the speaker, nodding), carry, cheer, and when a floor is idle: a stretch, a sip at the kitchen, a plant watered, a phone at the lounge. Monitors show brighter code and page textures with a glow and an accent progress bar while typing or browsing, and a screensaver when idle. The whiteboard shows the real plan with ticked boxes for done tasks. Labels are name pills above the head and side bubbles with a tail, never over a face; `.char-tag`, `.char-name` and `.char-bubble` are unchanged for the tests. Decor and colours now change far more: floor style, wall colour, chairs, rug, sofa, glass tint, sign.

Draw calls and triangles in headless Chrome (`__stage.renderer.info`), before and after:

| Scene | Before | After |
|---|---|---|
| Lobby, high, 1440x900 | 61 calls, 238k tris | 61 calls, 238k tris |
| Office quiet / busy, high | 327 / 328 calls, 256k / 255k tris | 212 / 203 calls, 290k / 283k tris |
| Lobby, low (`?q=low`), 390x844 | 34 calls, 46k tris | 36 calls, 46k tris |
| Office quiet / busy, low | 190 / 189 calls, 56k / 55k tris | 131 / 122 calls, 74k / 71k tris |

The triangle totals are mostly the shared city under the floor (238k at high, 46k at low). The room itself went from about 17k to 45k triangles at high and 10k to 24k at low, while draw calls fell by about a third, because every rigid piece of furniture is baked into vertex-coloured batches. `node scripts/shots-plus.mjs` reproduces the numbers and the `media/plus-office-*.jpg` screenshots; `media/before-*.jpg` are the same shots from the old code. `node test/browser/floors.mjs` checks the view API, meeting spots, label placement, the budgets (under 350 calls at high, 200 at low) and tier step-down: 14 of 14.

**Filler companies.** `FILLER_COMPANIES=1` seeds four fictional companies on free high floors, walking down from the top and never taking floor 1, a floor with an unclaimed code, or a real floor: Mildly Haunted Candles, Soup Opinions Ltd, The Committee for Slightly Longer Weekends, and Pigeon Logistics. Each has its own colours, boss, decor, five named staff, 18 task titles, progress lines, three publishable notes and cheer lines, all invented, with no real brand, person or link anywhere. They are rows in `floors` with `filler=1`, no owner (the recovery hash is of random bytes that are thrown away, so no login can ever succeed), no chat and no purchases. One timer advances a small state machine per floor: plan, assign, work, review, publish a note (always carrying the line "A fictional demo company inside The Office. Nothing here is real."), cheer, quiet. It writes tasks, events and agent states through the engine's own emit path, so a visitor sees exactly what a real floor looks like over SSE, but the engine never schedules a filler floor, nothing reaches a model, and the ledger stays at $0. Floors nobody is watching advance four times slower. The directory marks them "demo", the floor page says "A demo company: scripted, fictional, nobody's", the admin table shows a "filler" badge with a one-click "Remove filler", and `node scripts/admin.mjs filler list|seed|remove --floor N|free --floor N` does the same from a shell. A removed company stays removed; `seed` with revive puts it back. The seed is idempotent and off in every test unless asked (`npm run e2e` with `FILLER_COMPANIES=1` runs the whole browser suite with them seeded).

**Standing orders.** A boss sets a recurring job in the Orders tab, or asks the manager ("every morning, check X"), who uses `set_standing_order`. Schedules are every day or every week at a time, in UTC or an IANA zone; the shortest interval is a day (`ORDERS_MIN_HOURS`), a floor holds at most three (`ORDERS_PER_FLOOR`). A run posts "Standing order #N: …" to the manager, who plans through the ordinary engine with the same 14 steps a task, 60 tasks a day, caps and purchase rules; a domain still needs the boss's click. The runner fires an order once per slot inside one transaction (the next slot is advanced before the run starts, and a partial unique index allows one running run per order), so a restart or a second tick can never double-fire; a run in flight after a restart is simply picked up again. It waits while the floor is busy, paused, suspended, out of budget or the building is paused, and after six hours of waiting records the slot as skipped. When the floor goes idle again the run is marked done or failed (a failed task, a provider pause, or a `ORDERS_RUN_TIMEOUT_MIN` overrun), the cost is read from the ledger, and a short owner-only report (what ran, tasks done, links to anything published, estimated against actual cost) goes to the chat and the order's history. Three failed runs in a row pause the order with a reason and a notice. If the boss has not opened the floor in 14 days (`ORDERS_IDLE_DAYS`; owner snapshots stamp `floors.last_opened_at`) the orders pause themselves, and opening the floor resumes those. The estimate shown is the average of the last five runs, or `ORDERS_ESTIMATE_USD` (0.60) before that. `test/orders.test.js` covers schedule maths across summer time, the routes and their limits, visitor and cross-floor refusal, the manager tool path, a run through the real engine with a report the owner sees and a visitor's SSE never carries, exact advancement by one period, deferral, filler and suspended floors, the failure streak, the timeout, the idle pause, and restart safety on one database with two app instances: 16 of 16.

**The building, alive.** `GET /api/building/ticker` is the newest public happenings across all active floors: feed and publish events, each passed through the same `viewEvent` rules a visitor's floor stream uses, and then re-checked at reply time against the live projects and floors tables, so a project made private a moment ago never shows, whatever the five-second cache holds. Chat, tokens, questions, purchases and domains never enter it. The lobby shows it as a scrolling strip ("The building, live") with a coloured floor chip per line, refreshed every ten seconds with `?since=`, still under reduced motion. `GET /api/building/launched` is the launched wall: published, public projects on active real floors (filler floors are chatter in the ticker but never on the wall), each with a thumbnail: the project's own `og:image` if it names one of its own published image files, otherwise an SVG card drawn from the floor's colours and the title, every string escaped. A "Launched" toggle in the directory switches the panel to a card grid with Open and Visit floor; it is a two-column grid on phones. `test/building.test.js` proves a private project, a default-private floor's work and a suspended floor leak nothing through either surface, and that privating a project drops it at once: 12 of 12.

**Tests on this branch** (Node 22, mock mode): `npm test` 440 of 440 across 55 suites, including the adversarial security suites and the three new ones (filler 9, orders 16, building 12). `npm run e2e` in real Chrome at 1440x900 and 390x844, now 54 steps with the ticker, wall and standing-order steps (the Orders tab is driven for real: set, run now through the engine, report in the chat, pause, delete): 54 of 54 with `FILLER_COMPANIES=1` seeded, and 53 of 54 without, where the one failure was the phone "customise: decor saved" step timing out under load; run alone (`E2E_ONLY=phone`) it passes 33 of 33, and an earlier mixed run passed it too, so that step is flaky under load, as the first report already noted. `npm run e2e:apps` 26 of 26, `npm run e2e:launch` 18 of 18, `node test/browser/floors.mjs` 14 of 14. Screenshots: `media/plus-*.jpg` (office at both tiers, the meeting, the lobby ticker and launched wall on desktop and phone, the Orders tab and a report, the filler companies in the directory and on their floor).

**Still weak.** Sofa cushions read blobby up close. Monitor glow and the progress bars are only legible when zoomed. Five people huddled at a meeting on a phone still get overlapping bubbles. Mock runs finish in seconds, so "busy" screenshots often catch the floor just after the work. Standing orders are tied to the wall clock of the server: a laptop asleep over a slot catches up on the next tick, which is what we want, but there is no catch-up for slots missed during a long outage (only the latest is run). Filler scenes are English-only and loop after a few hours of watching.

**Untested here.** Nothing on this branch ran against a real model or a real phone; the standing-order runner was proven with an injected clock, not by waiting a day.

## The look (branch `towers-look`, not merged, not deployed)
Owner's request: make the site look as good as a reference city site, using only ideas from it, never its code, art, layout, wording or name. Steps are in `docs/DEPLOY-LOOK.md` (nothing beyond a normal deploy).

**Rendering.** The stage now runs three's own EffectComposer: `N8AOPass` (screen-space ambient occlusion, radius 1.6 and intensity 2.3 in the lobby, 0.9 and 1.9 in the room, a warm dark occlusion colour, full resolution at the high tier and half resolution at mid), a low bloom for the sun glints and lit windows, `OutputPass` with **neutral tone mapping** at exposure 0.84 to 0.92 instead of ACES (which greyed the warm stone and the sea into one haze), FXAA when the pixel ratio is under 1.75, and our vignette and grain last. The sun shadow map is 4096 at high and 2048 at mid, soft, and redrawn every other frame (every third on a phone); the sun is a warm `#ffd9b0`, lower than before so the streets get long shadows, with a cool fill from the opposite side and a sky-blue-over-warm-ground hemisphere. The sky is baked through PMREM into `scene.environment` for every standard material. The lobby camera is a 30 degree lens from further back, with linear fog that starts 300 units out, so the near city keeps its full colour. The low tier is unchanged in spirit: no post, no shadows, direct render with the neutral tone map.

**Materials and city.** Every Lambert surface became a standard material. Buildings and the tower are cut stone drawn in `onBeforeCompile` from world position with no texture files: running-bond courses with a shade per block, thin joints, grain and faint rain streaks, fading with distance so nothing shimmers. The palette is warm sand, limestone and terracotta with a few cooler rendered blocks; the sea is a deep blue with a slow swell under the ripple and the sky's reflection; rooftop pools and planted terraces sit on the mid-rise blocks, three tower cranes stand over downtown, and one street tree in seven is a stone pine. The composition is still ours: one tower on its plaza in a harbour city.

**Furniture and people** are Kenney's CC0 Furniture Kit and Mini Characters, downloaded from kenney.nl, with the licence text, zip hashes and the list of files kept in `public/models/NOTICE.txt`. They load lazily through a vendored GLTFLoader (the addons bundle itself is fetched only when a tier wants post-processing or a floor needs models), each file once and gzipped (a character is 36 KB on the wire, a desk 3.5 KB). The room builds with the old procedural furniture at once and swaps in the kit's desks, monitors, keyboards, chairs, meeting table and chairs, bookcases with books, big and small plants, kitchen counter, sink, coffee machine, microwave, fridge and bar stools, sofa, lounge chair, cushions, coffee table, floor lamp, speaker, coat rack, boxes, bins and laptops, baked into a few vertex-coloured draw calls with the company's colours on every chair, sofa and cushion. The people are the twelve human variants with their own walk, idle and sit clips through `AnimationMixer` and `SkeletonUtils.clone`; every agent state (walk, type, talk, think, listen, carry, cheer, stretch, sip, phone, water a plant) is layered on top by turning the seven bones, exactly as the procedural characters did. Saved looks still work: the outfit picks the variant whose clothes are closest, the hair style picks the side, and the skin, hair and outfit colours replace the matching cells of the kit's colour atlas in a small shader hook that keeps the cell's own shading; hats are ours on the head bone, glasses are the kit's. If a model fails to load, the procedural character and furniture stay, so a saved floor can never break.

**Measured in headless Chrome** (`node scripts/shots-look.mjs`, software rendering, so the frame rates it prints mean nothing for a real phone and are not reported). Draw calls and triangles are the renderer's counts for one frame; the larger number is a frame that also redraws the shadow map, the smaller a frame in between.

| Scene | Before | After |
|---|---|---|
| Lobby, high, 1440x900 | 61 calls, 238k tris | 99 calls, 265k tris (78 calls, 152k on a frame without the shadow pass); 21 of the calls are the post chain |
| Office quiet / busy, high | 212 / 203 calls, 290k / 283k tris | 190 / 176 calls, 296k / 292k tris (148 / 140 calls, 169k / 166k without the shadow pass) |
| Lobby, low (`?q=low`), 390x844 | 36 calls, 46k tris | 36 calls, 52k tris |
| Office quiet / busy, low | 131 / 122 calls, 74k / 71k tris | 87 / 80 calls, 67k / 65k tris |

Bytes on the wire for a cold load (gzip, no cache): lobby 493 KB on a desktop (app 101 KB, three 186 KB, addons 104 KB, fonts 82 KB, css 16 KB) and 393 KB on a phone at the low tier, which never fetches the addons; before, about 377 KB (the same without the addons and with 12 KB less app code). Opening a floor then fetches the models it uses, 427 KB for a full crew, plus the addons if the lobby had not already: 875 KB for a cold office load at either tier, against about 332 KB before. The tower and the city are still procedural, so the lobby itself carries no model files.

**Tiers.** High: full-resolution occlusion, 4096 shadows, bloom, FXAA, pixel ratio up to 2. Mid (phones, and anything with four cores or 4 GB or less): half-resolution occlusion at the Low quality preset, 2048 shadows, bloom at half strength, pixel ratio up to 1.5. Low (software renderers, two-core or 3 GB phones, save-data): no post at all. The frame-time watchdog now steps occlusion down first (full, half, off), then pixels, then the tier, each step permanent for the visit; that is the only measurement a phone gets, because nothing here ran on a real one.

**Tests on this branch** (Node 22, mock mode): `npm test` 440 of 440; `npm run e2e` 54 of 54 at 1440x900 and 390x844 (a first attempt died before its first step when headless Chrome failed to come up behind ten stray Chrome processes from earlier runs; it passed in full once those were killed); `npm run e2e:apps` 26 of 26; `npm run e2e:launch` 18 of 18; `node test/browser/floors.mjs` 14 of 14. Two test changes: the label test in `floors.mjs` reads each character's own head height instead of assuming the procedural one, and its whiteboard/screen/bubble check now samples from the moment the chat is sent, because at the high tier a software renderer is slow enough that a mock run could finish (and clear the board) before the old single-moment check ran; it failed that way twice before the change.

**Still short of the reference.** The far shore and sky are still paler than theirs; our buildings are boxes with shader windows, not modelled facades, so close up they are simpler; the water is a flat plane with a shader; the people are the kit's chibi proportions, bigger-headed than their furniture suggests; FXAA is no substitute for MSAA at a pixel ratio of 1; and the whole look was tuned on screenshots from a software renderer, never on a real phone or a real GPU's frame times.

## Lanes and the help line (branch `lanes`, not merged, not deployed)
Owner's request: keep it simple, with floors making mini businesses and sites in three lanes (game, website, business), and a way for the bots to ask the owner's assistant for help when they are blocked. Steps and rollback are in `docs/DEPLOY-LANES.md`.

**The lanes.** A boss on a new floor gets three buttons in the manager chat: Game, Website and Business. A tap is simply their first message, so typing still works, and the buttons go once they have spoken. The manager keeps its first reply short, and no work starts until the boss says go. The manager's prompt has a playbook per lane, and `assign_task` takes a `lane`, so each person gets their own part of it with their task (in the first message on a computer, since that system prompt is cached across floors):
- **Game:** three small original ideas, the Builder makes a playable version, a hired Tester plays it in a real browser, fixes small bugs and replays it, anything big goes back to the Builder, then it is published with a saved high score. Without app origins the score lasts the session and the boss is told. Without computers the game goes out unplayed and the boss is told.
- **Website:** a brief in chat, real words from the Writer, named palette, type and layout from the Designer, a build from those notes, `review_design`, publish. The notes sit in `notes/` in the project, which, like `TEST-REPORT.md`, never goes live.
- **Business:** real research with cited sources and named competitors, target customer, offer and pricing marked as proposed, numbers marked Estimate with their assumptions, a short plan, a landing page with a waitlist when forms are available, the launch checklist, and "Only you can do these".

Every agent is now told that nobody here can send email, post, run ads, contact anyone or spend money, and to say so rather than pretend. Everything a prompt promises depends on what is switched on, so iPhones, domains, pictures, search, saved data and browsers aren't mentioned where they don't exist.

**Dead ends removed from the floor.** No Sign-ups button or search-engine switch without project origins, no payment link on a document, no domain wording or Buy button when domain buying is off. The payment dialog now says to ask the manager for a Buy button, because pasting a link doesn't add one. A launch report that says "fix first" now points to the reviewer's notes.

**The help line.** The manager has `ask_buddehbot(question, what_was_tried)`: 800 characters each, refused whole if longer, 5 a floor per UTC day with a clear message at the limit, nothing on a filler floor, gone with `HELP_ENABLED=0`. Staff who are stuck say so in their report, and the manager decides. Requests are stored per floor as pending, answered, declined or expired. The Work feed shows "asked buddehbot for help", the board shows a card, the manager's chip says "Waiting on buddehbot", and the manager briefly takes a phone call. The manager doesn't wait. After 30 minutes (`HELP_TIMEOUT_MIN`) the request expires, and a new turn tells it to use its best judgment and tell the boss. An answer arrives as a new turn labelled as guidance from buddehbot, through the ordinary engine: on a floor that is out of budget or paused it simply waits, and no tool approves anything. It works across processes: the CLI only changes the row, and the server notices on its next tick, exactly once, across restarts.

**Security.** A request holds only what the manager typed plus the floor's name and number. Hidden characters are stripped when it is stored: control codes, direction marks, zero-widths, Unicode tags, variation selectors and terminal escapes. Every listing, in the CLI and the admin view alike, wraps every floor-supplied string in a fence with a random mark made fresh for that listing, and neither half of a fence can be spelled from inside one. A question naming private work is refused, as for anything leaving the building. No route creates a request. A boss sees only their own floor's, a visitor sees only that one exists, and only the admin's routes list or answer them. No new credential exists anywhere.

**Found and fixed in existing code on the way:**
- **A leak on floors with public chat:** a stored event loses its owner-only flag on SSE catch-up, so a launch report could be replayed to a visitor. Reports and help answers are now judged by what they are.
- **The checklist:** a real Builder found that an apostrophe cut a meta description short.

### Measured with real models
Run locally with `scripts/proof-lanes.mjs` (`AI_MODE=live`, computers on, project origins on `apps.localhost`, domain buying off), on real Claude, real Managed Agents containers, real search, real OpenRouter pictures and reviews. Costs are from the building's own ledger at list prices, not a provider invoice.

| Job | Cost | Time | Who |
|---|---|---|---|
| Game 1, Paint the Dark, before the prompt fixes | $3.11 | 27 min | Builder $1.97 over two rounds, Tester $0.83, manager $0.31 |
| Game 2, Bobber Drop, after them | $1.69 | 17 min | Builder $0.77, Tester $0.67, manager $0.26 |
| Website, Corner Spokes | $1.04 | 5 min | Writer $0.07, Designer $0.32 (with a $0.04 picture), Builder $0.35, manager $0.29 |
| Business, Second Shelf | $2.00 | 7 min | Researcher $1.00 (three searches $0.41), Analyst $0.14, Writer $0.20, Builder $0.32, manager $0.34 |
| Help line round trip, answered through the real CLI | $0.09 | under 1 min | manager only |
| **Total** | **Anthropic $7.83, OpenRouter $0.10** | | limits were $8 and $1 |

A watcher paused the building at $7.71 during Game 2, with the Tester's work already saved. I restarted it with room for about $0.22 more so the manager could publish. That is why the total sits so close to the limit, and there was no money left for another real run.

**What the real runs changed.**
- **Game 1:** the Builder used most of its 40 steps and then ran out on the fix round, because the limit spanned rounds. A round the manager asks for now gets its own steps. The manager had also told the Tester not to fix anything, so four fixes were never replayed. The Tester now fixes small bugs and replays them, and Builders on these small jobs aim for about 15 steps. In Game 2 the Builder cost $0.77 against $1.97, and the Tester fixed five bugs and replayed the game.
- **Website:** the manager started work as soon as the boss answered its questions, without a go. The prompt now says answering is not a go, and Game 2 held to it.

**Reading the output.** All five floors' published work is in `docs/proof-lanes/`, with screenshots in `media/lanes-*.jpg`. 47 of 47 checks in real Chrome pass (`docs/proof-lanes/browser-checks.txt`), including a real waitlist entry and a real score on the shared board on the project's own origin. The "Proof" row on the game screenshots is that check's own score.
- **Honesty held throughout.** Nothing invented turned up in what I read. The Business page says it isn't open, and its $17.99 is marked as proposed and planned. The plan marks every worked-out number, and says what it could not confirm (eBay blocked the page, so those lots come from a search summary). Its main finding is unflattering: the box loses money if books cost $4 each. Both Game managers said plainly what nobody had replayed. The Website manager flagged that the "What I fix" list was its own guess, and that the boss must email the list themselves.
- **Citations:** I spot-checked two. Gallup's 12.6 books and 27% match the page. Used Books Monthly's offer (1, 2 or 4 used books by genre) matches, but the text I fetched did not show prices, so its prices are unconfirmed by me. The rest I read but did not check.

### Tests on this branch
Node 22, mock mode. `npm test` is 501 tests across 71 suites, including the new help (42) and lanes (18) suites, and one for a fix round's steps. `npm run e2e` is 64 steps in real Chrome at both sizes, 10 of them new: the buttons, a real tap, the help line as a boss and as a visitor, and the admin dialog. `npm run e2e:apps` is 26, `npm run e2e:launch` is 18, and `test/browser/floors.mjs` is 14.

Results on the code as committed, with other workers' browser suites running on the same machine (load average 25 to 80):
- `npm test`: 501 of 501 on the final commit. An earlier run of the same code under heavier load gave 499 of 501. Both failures were timing tests, the filler scene and the checklist's speed limit. The speed limit passed when rerun alone. The filler test can fail under that load on `main` as well (main failed 1 of 2 runs, this branch 2 of 5).
- `npm run e2e`: 64 of 64 on an earlier commit, then 63 of 64 on the final-but-one, where the desktop "customise: decor saved" step timed out. Earlier reports note this step is flaky under load. On the final commit I reran only the desktop half, which also covers the admin steps, and it passed 39 of 39. The whole 64 were not run again on the final commit, whose only code change is the private-name guard, which has its own test.
- `npm run e2e:apps` 26 of 26, `npm run e2e:launch` 18 of 18, `test/browser/floors.mjs` 14 of 14.

### Still weak
- **The design reviewer said "fix first" on all four projects it saw.** It is strict, it never said ship, and Builders take some of its advice and skip the rest. The report now points to its notes, but the Website manager didn't explain what was left, even though the prompt asks.
- **A Game costs real money and time:** $1.69 to $3.11 and 17 to 27 minutes in these two runs. Almost all of it is the two computer sessions.
- **The shared leaderboard can't be tested from a computer,** because the data API only exists on the published origin. Testers can only try the local copy, and they say so. My check tried the real one after the fact.
- **Bobber Drop's layout:** a narrow column on desktop with empty margins. The Tester and the reviewer both flagged it and it shipped that way, with the boss told.
- **A first-time player's console shows a 404** when `Office.load` asks for a save that doesn't exist yet. It is harmless, but a Tester has to recognise it.
- **Help line:** nothing tells the assistant a request has arrived, so something must poll `help list --json`, or everything expires. A hijacked manager can still paste up to 1600 characters of whatever it read. It stays fenced, but it reaches a privileged reader. The private-name guard is the same denylist as before.

### Unproven
- Nothing on this branch has been deployed, or run on hz, with Docker, on a real phone, Safari or Firefox.
- Real runs covered one configuration only, with computers and project origins on. The other prompt variants, and the hidden UI without project origins on the sandbox path, were only tested with mock models.
- On a real model, I did not run a fix round under the new step rule, an expiry, a decline, or the admin view. Those ran in mock mode, and expiry on an injected clock. The 30 minutes were never actually waited out.
- "Answering is not a go" and the Tester's fix-and-replay each held in one real run, on the Game lane. The plan's checklist was reworded after the Business run so it leaves out what is already in hand, and that wording has not met a real model.
- Domain buying was off in every real run. Its code is unchanged, apart from the manager's prompt wording and the state message hiding it when off.

## The building's budgets and admin-only money (branch `lanes`)
Owner's words: "Limit the total building api costs to 120$ for openrouter and 120$ for claude api. But only make it visible to me the admin ok. Not anyone else."

- **Limits.** `BUDGET_ANTHROPIC_USD` and `BUDGET_OPENROUTER_USD`, default 120, are lifetime totals over the whole ledger. The first boot works out which provider every old row went to. Computer sessions are capped to what is left. A running call or session holds its worst case in `budget_holds`, in the database, so nothing can start on money already spoken for and only calls already under way can pass a limit, at most one per slot. A crash can't hide spending: a call that was in flight is charged what it held at the next boot.
- **At a limit.** That provider's roles stop and keep their work, and the boss hears only that the building is out of budget and to ask the owner. The other provider's roles carry on. Raising the value and restarting resumes work by itself, in the same session on a computer. Standing orders hold off and paid tools refuse without saying why.
- **Who sees figures.** Only the admin, on the admin page and through `node scripts/admin.mjs budget --json`. A boss keeps the price of a domain or purchase they are deciding on and nothing else. Bots are told no budget, limit or cost in any prompt or tool result, and a provider's own error text, which can carry account balances, stays in the log.
- **Old figures.** The first boot removes them once from chat, reports, task results, questions, still-running transcripts and stored events. That includes amounts said in words: the "we have spent about 5 cents" from an earlier run is the case that found the gap. It works by matching a spend word and an amount in one sentence, so an unusual phrasing could survive, and an old sentence about a real price with "spent" in it could lose its number. A boss's own messages are left as they wrote them.
- **Purchases.** `node scripts/admin.mjs purchases list --json` lists pending requests with everything a floor wrote fenced as untrusted data, and `purchases mark` decides one. The floor hears on the server's next tick.
- **Tests.** `test/budget.test.js`, 41 tests, includes leak tests over an owner session, a visitor, replayed events, the ticker, the wall and every prompt and tool result in every configuration. The browser e2e checks the page text on every tab.

## Customising a floor (branch `ultra-custom`, not merged, not deployed)
Owner's request: each boss's floor and team should feel like theirs, and the settings should really change things. No deploy steps beyond a normal deploy: the new columns (`floors.identity`, `floors.crew`, `agents.persona`) are added on boot, and a floor saved before them looks and behaves as it did.

**A bug this found.** The kit's people natively face +z, but the code turned them half way round and mirrored every pose to match. So the character builder showed the back of the boss's head, people walked backwards, and they sat with their backs to their desks. They now face the way they go, and the browser test checks that each seated person's legs point at their own desk.

**What a boss can change**, all from one Customise panel with one Save. The office changes live behind the panel as you tap, and Cancel puts it back. On a phone the panel is a sheet that stops short so the room stays in view; on a desktop it docks to the side.
- **Pick a vibe:** six presets that set the plan, floor, walls, art, pet, colours and tone in one tap.
- **The company:** what it does (300 characters), tone of voice (friendly, serious, silly, punk, corporate, dreamy, with a sample line), house rules (600), things to always avoid (300), who gets words, facts and looks when there's a choice.
- **Staff:** name, job title, personality (nine labels plus free text), focus, look, hire and let go within the cap. The manager always stays, and nobody leaves with a task open.
- **People:** the kit's twelve people as a direct pick, eight new hats, two new eyewear options, nine new things to wear, more colours, ten quick looks and Surprise me.
- **The office:** five floor plans (open plan, studio, garage, lounge, pods) drawn from the kit, eight floors, five wall finishes, four art styles including the company's own logo if a public project has a picture with "logo" in its file name (a drawn monogram until then), six pets.

**How it reaches the bots.** `server/brief.js` builds one `<boss_settings>` block. It goes before the security rules in the manager's and staff prompts, and into the first message on a computer. Text is cut to length and stripped of markup and invisible characters when saved and again when read, so it can't close the block or pose as something else, and the block says plainly that it can't change rules, budgets, tools or purchases. Those are enforced in code anyway, and nothing here touches them. In mock mode `server/mock-voice.js` reads that block from the system prompt and writes to suit, so `test/customise.test.js` can prove the wiring from the output: from the same request a silly floor says "Honk honk" and publishes "one suspicious duck", and a serious one says "Understood" and publishes "Prepared with care". A floor with nothing set sends exactly the prompt it always did.

**What visitors get.** The room, names, job titles, looks and the fixed personality label. Never the identity, the personality notes or the focus. A real model is told not to quote the settings in published work, but that is an instruction, not a guarantee, so don't put secrets in house rules.

**Performance** (headless Chrome on a software renderer, so frame rates mean nothing and aren't reported; `CUSTOM_ONLY=budgets node test/browser/custom.mjs`). Worst case for each plan: a full crew of ten, everyone in a hat, glasses and something extra, eight plants, the arcade, a pet and a wall finish. Low tier at 390x844: 120 to 133 draw calls and about 77k triangles against a budget of 200. High tier at 1440x900: 187 to 282 draw calls and 180k to 317k triangles against a budget of 350; the larger figures are frames that also redraw the shadow map. An ordinary new floor is unchanged in shape: 83 calls and 66k triangles busy at low, 154 calls and 167k at high (`node test/browser/floors.mjs`). The new code is about 17 KB gzipped, and no new model files were added. The synchronous part of swapping a room for a preview took 6 to 13 ms in that test; the furniture merge that follows it wasn't timed. Rebuilding also exposed a real leak: every rebuild left twenty bone textures on the GPU. With that fixed, textures stay at 35 and geometries at 77 across fifteen rebuilds.

**Tests.** `test/customise.test.js`, 41 tests: the wiring, adversarial input on every field and route, cross-floor and visitor refusals, atomic saves, cap and let-go rules, old saved floors, the logo rules, and in plain Node, every plan walked in every combination of decor (48 per plan). `test/browser/custom.mjs` in real Chrome: the panel at both sizes, 11 of 11 each, including tap targets, no sideways scroll, the room staying in view, live preview, Cancel, Save and a visitor's view; then 9 of 9 on every plan with a full crew, stepping the room's clock by hand; and 10 of 10 on draw calls.

Existing suites, on a machine with a load average of 70 to 100 because other builds were running: `npm test` 540 of 541, and the one failure is the filler scene test, which also fails on the unmodified `lanes` branch (4 of 6 runs alone under the same load). `node test/browser/floors.mjs` 14 of 14. `npm run e2e`: every desktop step that ran passed, including customise; the run was stopped before it finished. Phone only: 36 of 39. One failure is the lobby drag, whose cause is a race in the test: under load the directory sheet is still closing when the drag starts, and the same thing happens on the base commit (1 of 4 tries there, 2 of 4 here). The lift-button failure has the same cause: 450 ms after the sheet is tapped open the button is still off screen, at the same position on this branch and on `lanes` (top at 1141, and 736 three seconds later), and the overlap check then fails as a result. This branch changes no lobby code. A clean phone run on a quiet machine is still owed.

**Still weak.** Only the mock has been run, so how well a real model holds a tone is unproven. Personalities and tones are short instructions, and tests prove delivery, not quality. Hats and extras are simple shapes on the kit's heads, and some hair pokes through a cap. A floor reset doesn't bring back founding staff the boss let go, though the boss or the manager can hire them again. Nothing has run on a real phone: the phone numbers are emulation on a software renderer.

## The second look pass (branch `ultra-look`, not merged, not deployed)
Owner's request: "make it so the whole thing is better for the next hour... make sure shit works and works well." He felt the lobby still wasn't as good-looking as the reference and hadn't tried it on a phone. Everything here was tuned against real GPU screenshots on this Mac's M4 (ANGLE on Metal), not the software renderer. Reference rules stayed in force: I looked at their page by eye in a browser and read none of its files. Our lobby stays one tower, our own design. Three of our strings had drifted too close to theirs while this was being built ("Find a company or what it does", "Drag to turn. Scroll to ride.", "Turn the tower, ride the floors") and are now reworded.

**The lobby.** It is now golden hour instead of a cool grey afternoon.
- **Sky and horizon:** a new sky runs from a glowing haze at the horizon through apricot to powder blue, with thin bands of cloud lit from below. Fog now takes its colour from the view direction, rosy away from the sun and hot gold toward it, using the same function as the bottom of the sky. Sea and sky meet with no seam, and that is what makes the horizon glow.
- **Light:** a lower, warmer sun with long violet shadows and a cool fill. The shadow map covers the whole island, and because nothing that casts a shadow moves in the lobby, it is drawn once and kept (about 110k fewer triangles on every frame that used to redraw it).
- **Tower glass:** the panes are calmer: six broad bays, not eight narrow ones, and no flicker. Each pane traces the view ray into a small room behind the glass, and the glass reflects the sky and a soft skyline, with a low-contrast variation per pane. Taken floors show the company's colour as a ribbon round the shaft and warm lit rooms. The scattered white balconies became a planted terrace on every eighth floor.
- **City:** window glass is dark and warm, not bright blue stripes, so facades read as walls with windows. Balcony rails are a mid tone, not near-black dashes. The palette has a few charcoal blocks for contrast.
- **Sea:** deep teal with turquoise shallows that follow the real shoreline, foam along the quay and a path of light toward the sun. Each wave drops out before it would alias, which removed the scan lines.
- **Distance:** three layers of hills and a few low islands fade into the haze, with open water left toward the sun.
- **Lens and grade:** the camera sits further back on a slightly wider lens, so the whole tower and the horizon are in frame, with a tilt-shift softening at the bottom of the picture and a gold-and-violet grade.
- **Interface:** the panels and the text scrim are warmer, and the directory shrinks to fit its contents instead of filling the height of the screen.
- **Low tier:** still no post and no shadow map, but it gets the same sky, haze and sea, and long shadows baked once onto a texture for the ground. On the shots I took those shadows barely show, because the buildings hide most of the ground from this camera.

**Speed.** `server/statics.js` reads `public/` at start-up, stamps every internal reference with a content version and serves stamped URLs as `immutable` for a year. A wrong or missing stamp is never pinned. Assets are precompressed with brotli at start-up, with gzip until it lands. The floor, admin and claim code now load on demand, and the floor code is fetched in the background a few seconds after the lobby settles. `scripts/strip-models.mjs` slims the models by removing 29 animation clips nobody plays, removing unused UVs, and storing normals, UVs and skin weights in small integers. A character went from 36 KB to about 19 KB gzipped, and all the furniture fell by about a third raw. A curtain in the colours of the first picture holds until that picture is finished, including the post chain, so there is no pop. A floor shows a title card in a warm flash until its real furniture and people are in, up to about 2.4 seconds. On an emulated 1.6 Mbit/s, 150 ms phone connection, the first thing on screen went from a blank navy page until 2.6 seconds to the curtain at 0.7 seconds (`media/ultra-loading-before.jpg` and `-after.jpg` are both at 1.2 seconds). The page is ready at 3.1 seconds instead of 2.7, because it now waits for the finished picture. Layout shift measured 0 before and after.

| Bytes on the wire, first visit | Before | After |
|---|---|---|
| Lobby, desktop or phone (mid), when ready | 449 KB | 389 KB |
| Lobby, desktop or phone (mid), settled, with the floor's code fetched in the background | 495 KB | 448 KB |
| Lobby, phone (low), when ready | 345 KB | 296 KB |
| Then opening a floor from the lobby, desktop | 286 KB | 155 KB |
| Then opening a floor from the lobby, phone (low), which still needs the loader | 390 KB | 252 KB |
| A floor by direct link | 809 KB | 630 KB |
| The same floor on a return visit | 5 KB | 4 KB |

Those are bytes on the wire for one mock floor of six people, from an empty cache with the cache on. Before is commit d4fd32c measured the same way, which came out at 809 KB against the older report's 875 KB. Three.js (152 KB with brotli) and the addons bundle (98 KB) are still the biggest parts; neither was tree-shaken, because the bundle needs a build step we don't have and published sites use the whole of three.

| Uncapped frame rate on the M4, both builds measured back to back | Lobby, before → after | Floor, before → after |
|---|---|---|
| 1440x900 at 2x, high | 41 → 48 fps | 39 → 47 fps |
| 1440x900 at 1x, high | 145 → 147 fps | 133 → 125 fps |
| 390x844, mid (pixel ratio 1.5) | 281 → 273 fps | 241 → 239 fps |
| 390x844, low | 564 → 509 fps | 499 → 479 fps |

These are with vsync and the 60 fps limit off, while the machine was at a load average of 30 to 50 from other workers' test runs, so they are for comparing builds, not absolute speed. `node scripts/measure-look.mjs` reproduces this branch's frame rates and bytes. With vsync on it held a steady 60 fps at 1x and on both phone tiers. At 2x with vsync on it had a median frame of 16.7 ms but dropped frames under that load (42 fps average, p95 33 ms). Lobby at high: 85 draw calls and 152k triangles on every frame. Before, it was 97 calls and 265k on the frames that redrew the shadow map. Lobby at low: 41 calls, 52k triangles. Office draw calls and triangles are about the same as before.

**A bug these screenshots caught.** My first version of the model slimmer left out the stride on three-byte normals. Normals came out as garbage, shaders produced NaN pixels, and bloom smeared those across the whole frame, so the floor went black with no errors in the console. The script is fixed, and the post chain now has a guard pass that darkens any NaN or infinite pixel, so one bad pixel from any shader or driver can never black out the screen.

**Phones.**
- **Labels:** when people bunch up, `public/js/labels.js` lifts farther names clear of nearer ones, places bubbles by importance and edges them sideways or upward to find room. A bubble with no room waits rather than covering someone. It runs about six times a second, eases its moves and is unit tested with a five-person huddle.
- **Layout:** there are safe-area insets everywhere. The canvas ignores toolbar and keyboard height changes, the sheets lift above the keyboard, and the page is put back when it closes. There are `dvh` units with `vh` fallbacks, a layout for a phone on its side, and readable text (nothing under about 10 px).
- **Tap targets:** controls are sized for fingers, with `pointer: coarse` targets around 44 px. The walkthrough flagged only colour swatches at 34 px, checkboxes at 22 px and the sheet's grip at 390x26.
- **Framing:** the ticker moved down beside the pill, so it no longer covers the crown of the tower.
- **Blur:** there is no backdrop blur on phones. Re-blurring a moving 3D scene every frame is among the heaviest things a panel can ask of a phone, so the panels are more solid instead.

**A device that struggles.**
- A lost WebGL context shows a painted CSS city at once, with the interface still working.
- When the context comes back, the sky's reflections are baked again, the post chain is rebuilt and the tier steps down.
- A third loss gives up on 3D for the visit.
- With no WebGL2 at all, or no renderable half-float targets, the device goes to the painted city or to the direct path.
- The watchdog goes by time, not frames. It aims above about 42 fps on a desktop and accepts a steady 30 on a phone (Low Power Mode). A forced `?q=` tier stays put.
- `npm run e2e:resilience` proves the lost-context path in real Chrome on desktop and phone tiers, plus a browser with no WebGL at all.

**First hour, walked as a new friend on desktop and phone** (lobby, wrong code, claim, first chat, watch, tabs, customise, back to the lobby, visit another floor, reload, new device, sign in with the recovery code).

Fixed:
- Closing the recovery-code dialog any way other than the button stranded a brand-new boss in the lobby showing "Sign in". It now always goes to their floor, and the same applies after signing back in.
- Sign-in wanted the floor's slug. It now also takes the company name or the floor's whole link.
- There is now wording for having no code and for a lost recovery code.
- The character builder showed the boss's back. It now faces you.
- Dollar figures on the floor page are gone. The header's spend was public to every visitor. A boss sees none either: the share of today's allowance this pass first showed them came out in the merge, under the owner's admin-only rule. Task costs and standing-order costs are off the page.
- On a phone with the directory sheet open, the invisible "Open an office" pill and the ticker went on catching taps meant for the rows beneath them, so tapping a floor there could open the claim wizard. A CSS rule was losing on specificity. The e2e suite caught it, and it is fixed.
- Tapping search on a phone now raises the sheet instead of leaving the field behind the keyboard.
- The console is clean of the deprecated-clock and shadow-type warnings.

**Outside my files, for whoever owns them.**
- `server/orders.js:277` still puts a dollar cost line in the standing-order report that goes to the boss's chat.
- `server/engine.js:253` tells the manager the day's spend in dollars, so the model could repeat it in chat.
- Domain and purchase-request prices still show to the boss, because that is the price they are being asked to approve. The owner should decide if "never" covers those.
- On a phone, a new floor's chat opens scrolled so the first lane is cut off and the greeting is above the fold (`scrollChat` in `floor-ui.js`). I left it because a test pins the lanes on screen.
- The room itself is still lit neutrally, not for golden hour.

**Tests on this branch** (Node 22, mock mode, on the final code, with the machine at a load average of 50 to 90 from several workers' test runs at once).
- `npm test`: 516 of 516 (76 more than the last report's 440, of which this branch's new `test/statics.test.js` adds 16).
- `npm run e2e:resilience` (new): 16 of 16.
- `node test/browser/floors.mjs`: 14 of 14.
- `npm run e2e:apps`: 26 of 26.
- `npm run e2e:launch`: 18 of 18.
- `npm run e2e`: 64 of 64, at 1440x900 and 390x844 plus the admin pass.

The earlier e2e attempts in this session did not all pass. The first ones found one real bug (the invisible pill catching taps), and one failure came from a variable clash in a test I had edited. The other failures, which came and went between runs, did not reproduce on their own and don't look like app bugs: clicks landing on sheets still sliding into place, a guessed browser port, a mock job that had already finished before it could be redirected, and the admin table re-rendering during a click. I hardened the harness against the first two. The last two were not fixed; they simply didn't recur in the final run. All of the numbers above are from the final commit.

Two test changes follow from the no-dollars rule: the spend label is gone, and a standing order's card expects "Not run yet" and no dollar sign. `test/browser/cdp.mjs` gained optional launch flags, so the resilience test can start a browser with WebGL off. Its click now waits for a sliding sheet or dialog to come to rest, because under load a click could land on whatever had moved there. That is what opened the claim wizard by accident in one run.

**Still weak or unproven.**
- **Nothing here ran on a real phone or in Safari.** iOS is known-problems avoidance only: `dvh` with fallback, prefixed `backdrop-filter`, half-float check, no autoplay, `visualViewport` for the keyboard. The phone rows in the frame-rate table are the M4 drawing a phone's pixels, not a phone's GPU, so they say the look is cheap per pixel and nothing about an actual iPhone's frame rate or heat.
- **The look at 2x on the M4 is not comfortably over 60.** Uncapped, it changed from run to run with the load from other workers' test runs: 47 to 48 fps in the back-to-back table above, 33 to 37 fps in another loaded run, and about 65 to 75 fps in a tuning run earlier in the session (not a clean comparison). Full-resolution occlusion alone cost half the frame rate, so dense screens now use half resolution, and the watchdog steps down from there.
- **Closer than before, not equal to the reference.** Our buildings are still boxes with shader windows, so up close they are simpler than modelled facades, and the far hills are soft shapes, not terrain. The water has no real reflections of the city.
- **The browser tool can't open localhost.** Its policy blocks private addresses, and I did not change that setting. My GPU shots came from a separately launched Chrome on Metal, pointed only at my own mock server. The browser tool was used only to look at the reference.
- **Huddled names can float well above their heads** (up to 60 px), which loosens who is who, though nothing overlaps.
- **Brotli depends on the proxy in front** passing `content-encoding` through. Check it after deploying (see `docs/DEPLOY-LOOK.md`).
- **Not measured:** real network timings (all of this ran on localhost) and memory on a phone.

## office-next: everything merged (not deployed)
`lanes`, then `ultra-workers`, then `ultra-custom`, then `ultra-look`, each section above still describing its own part. `docs/WORKERS.md` has the staff-quality work. `floors2` was started later and isn't in here. How to ship it: `docs/DEPLOY-NEXT.md`.

**What the merge had to decide or fix.**
- **The go-ahead.** `lanes` said no work starts until the boss says go. `ultra-workers` made the request itself the go-ahead. They can't both hold, so the merge keeps `ultra-workers`: it is the later decision, made after real runs. The lanes playbooks' own "answering is not a go" wording went with it.
- **Money in new UI and new prompts.** `ultra-look` showed bosses "12% of today's allowance", which is a spend figure, so it came out. `ultra-workers` told computers they were "nearly out of budget", which now reads "your time on this computer is nearly up". `ultra-custom`'s settings block mentioned budgets, and no longer does. The leak test now scans prompts on a customised floor too.
- **Old figures said in words.** The first-boot cleanup only looked for a dollar sign, so the very sentence that started this ("we have spent about 5 cents") would have survived and replayed to the model. It now catches amounts in words, removes cost fields from stored events, and covers questions and help requests. The lanes worker who wrote the first version flagged this in its handoff.
- **A blocked admin page.** `ultra-look`'s loading curtain waited for a 3D scene to paint, and the admin page has none, so it covered the login form for about three seconds. It now lifts at once there.
- **A freeze while the first people load.** Reading the character atlas back from a GPU canvas waited for everything the GPU had queued. On the software renderer here that froze the page for 8 to 12 seconds, long enough to miss a whole job's events on the whiteboard. It was a real stall that a slow phone could also hit, not a flaky test, and the atlas is now read from a software canvas.
- **A stale browser check.** `ultra-workers` changed what the chat says when a launch report goes out, but `e2e:launch` still looked for the old words. It now checks the live link in the chat and the whole report on the project card.
- **A hanging test browser.** A headless Chrome that dies mid-run used to hang the whole suite forever. It now fails the step. This came up because something outside this work killed the browser during a run, most likely another worker's cleanup between its own runs.

**A slip worth knowing about.** The lanes worker was reported as crashed, but its process was still alive and editing `test/budget.test.js` in the main checkout while this work began there, and its line collided with one of mine. It stopped and handed over once it noticed, and this work moved to its own worktree, `../theoffice-next`. Nothing was lost. Its last edit that matters, the "a hold exists" test, is kept.

### Real check on the merged code
`scripts/proof-next.mjs`, on real Claude, real Managed Agents computers and real OpenRouter. Outputs are in `docs/proof-next/`. Spend: **Anthropic $1.77 of the $4 allowed, OpenRouter $0.10 of the $0.50 allowed**, from the building's own ledgers.

| Check | Result | Cost |
|---|---|---|
| Website job, typed the way people type, one line | Writer, Designer and Builder on a real computer, published, 5.6 minutes. No figure reached the boss or a visitor | $1.04 |
| Silly tone against serious tone, same request | Clearly different. Silly: "Not a submarine, not a spaceship, not a very small bank." Serious: "The menu is short by intention." | $0.34 |
| `ask_buddehbot` round trip through the real CLI in its own process | Asked, fenced in the listing, answered, the manager told the boss. The answer text was made up for the check and isn't a fact about the building | $0.09 |
| A low `BUDGET_ANTHROPIC_USD` | 13 of 13: no Claude call, the boss told once with no digits, no figure in the owner's or a visitor's page in real Chrome, the admin CLI shows 100%, an OpenRouter role carried on, a restart stayed stopped, raising it resumed by itself | $0.10 |
| A real computer session at a 20-cent limit | 11 of 11: capped to 20 cents, stopped at 20.25, the task waited, raising the limit carried on in the same session and published | $0.30 |

The `$0.10` line includes the first try of that check, where my script crashed after its Claude-free part, and the manager replying once the limit went up.

### Tests on the merged code
TESTS_PLACEHOLDER

### Not proven
- Nothing here has been deployed, or run on hz, in Docker, on a real phone, or in Safari or Firefox.
- The scrub has only run on test data. It matches a spend word and an amount in the same sentence, so an unusual phrasing could survive it, and an old sentence about a real price with "spent" in it could lose its number. Read a few old floors after deploying.
- Bots aren't told any figure, but nothing stops a real model inventing one. There is no filter on what it says.
- `ultra-custom`'s personalities and house rules have only been checked by tests and one real tone comparison. Whether a model holds a tone over a long job is unproven.
- The real Website job asked no follow-up question and got no go-ahead step, so the merged behaviour costs money from the first message. Whether the owner wants that is theirs to say.

## Living floors (branch `floors2`, not merged, not deployed)
Owner's request: staff should walk between offices and talk so you can read the dialogue, and the floor page should work more like the reference floor view, in our own style. No deploy steps beyond a normal deploy: nothing new in the database or the environment. Talk is one more event type in the existing `events` table.

**Rooms.** All five plans (open, studio, garage, lounge, pods) were redrawn. Each now has a glass office for the boss, one for the manager, a glass meeting room (the studio's is a big glass box in the middle; the garage's is a crate room made of old windows), a kitchen, a lounge and staff pods, joined by doors with a frame and a beam. A plan's `walls` are lines with gaps for doors, so the rooms are real to the walking grid and not just painted on. All the panes go into one mesh, so ten rooms cost one draw call. The room's floor tint and each room's painted name are baked into the existing floor texture.

**Walking.** `public/js/life.js` turns events into scenes. A batch of assignments is a meeting: everyone walks in, the manager waits at the board until they are there, reads the real plan and assignments, and everyone goes back to their own room. A single assignment, a handoff, a review, a Tester's findings and a question each mean the speaker walks over to the listener, in that person's room, with a sheet of paper where there is one, says the line to their face and goes back. The listener turns to look. Idle people go to the kitchen or the lounge, or meet a free colleague for a word. Work calls them back, mid-coffee. Nobody is ever moved except by walking, apart from a rebuild of the room itself (changing the layout in Customise); a new hire no longer rebuilds the room.

**Dialogue.** The engine emits `talk` with `from`, `to`, `text` and `kind`. `server/talk.js` only cuts: markdown, code, scenario tags, a link's query string and any dollar figure come out, and the line is shortened at a sentence or a word to 170 characters. Sources: the manager's brief (`assign`), the plan name (`plan`), a staff member's result, handed to the manager or on to the next colleague when one task depends on another (`handoff`), a Tester's result (`findings`), the manager's notes or the fact of approval (`review`), a question to the boss and the boss's answer (`question`, `answer`). The lines appear over the speaker's head and in the Talk tab.

**Who reads what.** `viewEvent` applies the feed's rules. A private project, or anything untagged on a default-private floor, reads "Talking about something private." for a visitor, in the snapshot, on the live stream and in a replay, and a project made private later hides what was already said. A question and its answer are the boss's alone whatever the project: a visitor reads "I have a question for the boss." Other public lines go through the same name redaction as public chat. A decision to check: **a visitor on a public project reads the real brief and report text**, because that is what was asked for. A manager's brief can paraphrase the boss's private chat, the same known limit as task titles. Mark a project private to hide it.

**Filler floors** read from a script (`GIVE`, `SIGN_OFF` and each company's `banter`), through the same event. Small talk is 12 fixed pairs in the browser: nothing on the server, no model, kept to 12 lines, marked "Small talk", and a test rejects any line that claims work happened.

**The page.** Desktop: a glass company card on the left (floor, logo or monogram, name, tagline, boss, head count, live activity line, what they've made, Visit website, Share), a vertical floor scrubber on the right, round pins over the rooms that open the manager chat (manager's office), Requests (boss's office), Tasks (meeting room), Talk (kitchen), Projects (lounge) and Orders (printer), and a pill over each working person with their task and a count such as `2/4`. That count is finished tasks in the run of tasks on the same plan, and a task with no plan or alone on one shows no number. The bar on their monitor used to fill on a timer and now shows the same count. A boss arrives with the chat open. A visitor arrives with the room filling the screen and a pill to open the panel. Closing the panel gives the room the space, and a pill says "Talk to Tess": one tap. Phone: the same as a bottom sheet. It folds to its tabs with a tap or a drag, the room moves into the space, the card lives under an About tab, pins and scrubber have 44-point hit areas, and pills and speech sit above the sheet. Our layout, wording and code; nothing was taken from the reference site.

@@RESULTS@@
## Known limits
- An interrupted task resumes from its last completed step, and the aborted call is charged as an estimate.
- Spend caps reset at midnight UTC.
- Rate limits and SSE are in-process, so a restart resets limits and drops streams; browsers reconnect.
- Signed links to private projects work for anyone holding them, for up to an hour.
- Public chat hides private names and titles, but not paraphrases.
- A prompt-injected agent on a public task can still damage that floor's public projects, but can't escape the sandbox, spend past the caps, or read private projects or other floors.

## Models
Most roles run on Claude Opus 5.5 through the Claude API (`$4` in, `$20` out, `$0.20` cache reads per million tokens), with effort set per role in `config/models.json`: manager and designer medium, researcher/writer/analyst/marketer medium, builder xhigh without a computer and medium on one, tester low on a computer, illustrator high. The search summary runs on Claude Sonnet 5.5. See `docs/WORKERS.md`. The hireable Tester runs on `google/gemini-3.1-pro-preview` through OpenRouter (`$2`/`$12`) for a second opinion from another lab. Assistant turns replay Claude's own content verbatim so history stays append-only; prompt caching and server-side refusal fallbacks are on.

Floor agents must not use the Claude CLI or a Claude subscription.

Spending caps are off on the live server at the owner's request (`FLOOR_DAILY_USD`, `GLOBAL_DAILY_USD` and `TASK_MAX_USD` set to `off`; defaults are 10, 25 and 3). The limits of 14 steps per staff task and 60 tasks per floor per day still apply.
