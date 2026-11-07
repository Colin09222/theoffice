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

Existing suites, on a machine with a load average of 70 to 100 because other builds were running: `npm test` 540 of 541, and the one failure is the filler scene test, which also fails on the unmodified `lanes` branch (4 of 6 runs alone under the same load). `node test/browser/floors.mjs` 14 of 14. `npm run e2e`: every desktop step that ran passed, including customise; the run was stopped before it finished. Phone only: 36 of 39. One failure is the lobby drag, whose cause is a race in the test: under load the directory sheet is still closing when the drag starts, and the same thing happens on the base commit (1 of 4 tries there, 2 of 4 here). The other two, a lift button off screen and the overlap check that follows it, are also lobby steps and this branch changes no lobby code, but they weren't reproduced on the base commit. A clean phone run on a quiet machine is still owed.

**Still weak.** Only the mock has been run, so how well a real model holds a tone is unproven. Personalities and tones are short instructions, and tests prove delivery, not quality. Hats and extras are simple shapes on the kit's heads, and some hair pokes through a cap. A floor reset doesn't bring back founding staff the boss let go, though the boss or the manager can hire them again. Nothing has run on a real phone: the phone numbers are emulation on a software renderer.

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
