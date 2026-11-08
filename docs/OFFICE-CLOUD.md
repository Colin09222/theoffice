# Office Cloud

The backend every published project gets for free: a database, accounts, saves, leaderboards, multiplayer rooms, uploads, AI and fetching web pages.
It runs inside the Office server (no new container, no new env vars), stores everything in the same SQLite file, and the staff use it
through one script. The staff's full reference is `server/app-client/OFFICE-CLOUD.md` (it goes into every builder's computer as
`.office/OFFICE-CLOUD.md`, with a starter game in `.office/examples/cloud-game/`).

## How a page uses it
```html
<script src="_office/office.js"></script>
<script> const office = Office.connect(); </script>
```
`office.auth`, `office.db`, `office.saves`, `office.leaderboard`, `office.rooms`, `office.files`, `office.pay` (see `docs/PAYMENTS.md`), `office.ai`, `office.fetch`, `office.scrape` (plus `office.shared` and `office.forms`,
which sit on the older `/_data/v1` store). The same file is at `/theoffice/sdk/office.js` on the main site for reference.

Server code is a separate, rare thing: see `docs/OFFICE-RUNNER.md`. A page finds its project's server with `office.server.url()`.

## Where it lives
- Every project origin (`<label>.middistance.com` and any domain bought for it) answers `/_office/cloud/...` itself, so the page's own
  CSP (`connect-src 'self'`, now with the same host's `wss:` spelled out) already allows it. The project is whichever one the Host names.
- Rooms are WebSockets at `/_office/cloud/rooms/<name>`, written by hand (`server/cloud/ws.js`): text frames only, no compression.
  Caddy passes the upgrade straight through, as the live edge config already proxies these hosts to `127.0.0.1:8083`.
- Code: `server/cloud/` (`index.js` HTTP and upgrade, `store.js` SQLite, `rooms.js`, `ws.js`, `schema.js`, `powers.js` switches and counts, `ai.js`, `web.js`, `robots.js`, `scrape.js`), `server/app-client/sdk.js`. Payments are `server/cloud/pay.js` and friends (`docs/PAYMENTS.md`).

## Safety
- **Isolation:** every row carries `(floor_id, project)` and every query names both; sessions, files, rooms and boards are looked up the same way.
  A token, id or room name from one project finds nothing in another (tested for each).
- **CORS:** a request with an `Origin` must come from one of the project's own origins (its label and its live bought domains), or it gets 403 and
  no CORS headers. A sibling project is refused even though browsers call it "same site". Writes need an `Origin`; WebSockets check it on upgrade.
- **Accounts:** scrypt (N=16384) in the thread pool, at most 2 at once; sessions are random 256-bit tokens stored as SHA-256 hashes, 30 days.
  Log-ins are limited per account and address; a wrong password and an unknown name look the same. An account may have an email
  (optional); with one it gets a welcome email and can reset a forgotten password (see "Email for accounts" below).
- **Ownership:** anyone can read a document unless it was added `{private: true}`; only its owner can change or delete it. Guests own things
  through a random token in their browser, and keep them when they sign up.
- **Uploads** are typed from their bytes (images, sound, video only; never HTML, SVG or script) and served with `nosniff`, a `sandbox` CSP and
  `inline` disposition. Stored in 256 KB pieces and streamed, so a download never holds a whole file in memory.
- **Untrusted content:** a visitor's words only reach a model if the project's own page sends them to `office.ai`. That model has no tools and sees nothing of the building, and nothing a visitor writes reaches the staff's models. The boss and the admin see counts only, never content or password hashes.
- **No dollar figures** anywhere a boss, visitor or bot can see them: the backend's responses, its docs for the staff, and its views.

## Limits (defaults; `cloudLimits`, `cloudRoomLimits`, `cloudRates`, `cloudAiLimits` and `cloudFetchLimits` in config override; the main AI and fetch ones also take `OFFICE_AI_MAX_TOKENS`, `OFFICE_AI_DAY_FAST`, `OFFICE_AI_DAY_SMART`, `OFFICE_AI_BUILDING_DAY_USD`, `OFFICE_FETCH_DAY`, `OFFICE_FETCH_HOST_DELAY_MS` and `OFFICE_FETCH_CACHE_MS`)
| | |
|---|---|
| Storage per project | 20 MB of data (documents, saves, scores, accounts), 50 MB of files; 8 GB for the whole building (hz has about 60 GB free) |
| Documents | 32 KB each, 50 collections, 20,000 per project, 2,000 per person, 100 per page |
| Saves | 64 KB each, 200 keys and 1 MB per person |
| Leaderboards | 50 per project, 5,000 entries each (a full board keeps its best), scores within plus or minus a trillion |
| Files | 5 MB each, 100 and 25 MB per person, 2,000 per project |
| Rooms | 16 people, 50 rooms per project, 1,000 in all; 600 connections in all, 200 per project, 32 per address; messages 8 KB, 20 a second (burst 40) and 32 KB a second each; 100 state keys / 32 KB per room |
| AI per call | 1,000 tokens written at most (600 by default); 32,000 characters in, plus 8,000 of `system`; 40 messages; 60 seconds |
| AI per day | 150,000 tokens per project on `fast`, 15,000 on `smart` (input and output both count); a building ceiling for all app AI (`buildingDayUsd`, for the admin's eyes only, default 2) |
| AI per visitor | 12 calls a minute and 200 a day per address per project, 2 at once; 240 a minute and 4 at once per project; 8 at once in the building |
| Web pages | 500 real fetches per project per day; 30 a minute and 600 a day per address per project, 3 at once; 240 a minute and 6 at once per project; 8 at once in the building; 512 KB and 15 seconds a page |
| Requests | 30,000 a minute for the building, 3,000 per project, 600 per address, 240 writes per address per project; 120 queries a minute per address and 1,200 per project; 2 uploads at once per address; sign-ups 10 an hour per address; log-ins 10 per 15 minutes per account and address |

Request counts are kept in memory and written once a minute. Memory stays small: rooms cap out near 35 MB of state, at most 4 uploads
(20 MB) and 2 password hashes (32 MB) are in flight, and query responses stop at 512 KB.
Measured: 300 live players in 19 full rooms, each setting 1 KB of state and sending ten 1 KB messages, added about 3 MB of heap
(and 50 MB of RSS, test clients' sockets included); everything was released when they left.

## Email for accounts
Code: `server/cloud/auth-mail.js`, with small hooks in `server/cloud/index.js` (routes), `server/app.js` (the reset page), `server/mail.js`
(`by: 'app'` and the held reset text) and `server/cloud/schema.js` (`cloud_resets`, `cloud_mail_days`). Tests: `test/auth-mail.test.js`, `npm run e2e:signup-mail`.

- **From the company's own address.** Every email goes through `engine.mail.send(floor, { by: 'app', ... })`, the company's normal mail path,
  so the From is whatever that path picks for the floor (today `<company>@MAIL_DOMAIN`; a company's own domain once that lands), with the
  company's signature. `by: 'app'` skips the "new address needs the boss's tap" rule, because the visitor typed the address themselves and the
  text is fixed by the building, not written by the staff.
- **Welcome:** `POST auth/signup` with an `email` sends a short welcome after the account is made. The reply says `email: {welcome}`:
  `sending`, `none` (no email given), `off` (email isn't on in the building, or paused) or `full` (the project's daily allowance is spent).
  Sign-up never waits for or fails on the email.
- **Forgot password:** `POST auth/forgot {email}` always answers `{ok: true, message}` with the same words whether or not the address has an
  account, and the email is sent after the answer, so neither the words nor the timing tell. When email can't go out at all (not set up,
  paused, today's allowance spent) it answers `{ok: false, emailAvailable: false, message}`, the same for every address. The link is
  `<the project's own origin>/_office/reset#t=<token>`: the origin the request came from (its label or a live bought domain).
- **Tokens:** 256 random bits; only the SHA-256 is stored (`cloud_resets`). One live link per account (a new one kills the old), 30 minutes,
  single use: the token is spent in the same transaction that sets the password. A reset signs out every session of that account, kills
  any other link, and signs this browser in. A token works only on its own project.
- **The company's copy:** the company's outbox keeps the email with `[link left out of this copy]` in place of the link, so the boss and
  the staff (`mail_inbox`, `mail_read`) never see a working link. The real text is held in memory until it is sent; a restart in between
  sends nothing usable, and the visitor asks again.
- **Reset page:** `/_office/reset` (with `reset.js` and `reset.css`) on every project's origin, under the page's own CSP (`script-src 'self'`),
  `referrer-policy: no-referrer`, noindex. It takes the token out of the address bar at once and calls `office.auth.resetPassword`.
- **Limits:** forgot per address 5 an hour and per project 60 an hour (429), per account 3 an hour (silently: the same answer, no email);
  reset per address 20 and per project 200 an hour; `auth/email` changes 10 an hour per account. Each project may send `OFFICE_APP_MAIL_DAY`
  (default 30) account emails a day (`appMailDaily` in config), and every one also counts against `MAIL_FLOOR_DAILY` and `MAIL_BUILDING_DAILY`.
  An email the floor's or building's cap stops is handed back to the project's allowance.
- **Older accounts:** `POST auth/email {email, password}` adds or changes the email (needs the password, so a stolen session can't redirect
  resets; changing it kills any open link). `GET auth/email` says `{available}`.
- SDK: `office.auth.forgotPassword(email)`, `resetPassword(token, password)`, `setEmail(email, password)`, `emailAvailable()`; `signUp` takes `email`.
  The App starter asks for an optional email and has "Forgot password?" (`#/forgot`).
- Not done: no email confirmation (an address is taken on trust, so a typo'd address just never gets mail), no "email changed" notice to the old address.

## AI (`office.ai`)
`POST /_office/cloud/ai/chat`, handled by `server/cloud/ai.js`. A page sends `{prompt or messages, system, maxTokens, model: 'fast' | 'smart'}` and gets `{text, truncated, refused, model, tokens, left}`.
`fast` and `smart` are the only model names a page ever sees; `appAi` in `config/models.json` says what they mean (Haiku 5.5 and Sonnet 5.5). No key, model id or price leaves the server, and provider errors become one plain message.
- **Only the project's own pages:** a POST needs an `Origin`, and it must be one of the project's own origins, as for all of Office Cloud. A client that lies about its `Origin` still only spends that project's daily allowance, at one visitor's rate.
- **No tools:** a call is one exchange with a model that has no tools and sees nothing of the building. Thinking is off so a reply isn't eaten by reasoning.
- **Money:** every call is held against the building's Anthropic budget while it runs and written to the ledger against its floor (`kind='app_ai'`, `provider='anthropic'`), like anything the staff spend. It stops cleanly when the building's budget is reached, when today's app AI reaches `buildingDayUsd`, or when `FLOOR_DAILY_USD` or `GLOBAL_DAILY_USD` are set and reached (app AI counts toward those).
- **A call that dies** is released, and anything already written is charged at an estimate. One cut off by its 60-second limit is charged what it held, and a crash is settled at the hold on the next start, as for the staff.
- `OFFICE_AI_ENABLED=0` turns it off for the building; see the admin commands below for the per-project pause.

## Web pages (`office.fetch`, `office.scrape`)
`POST /_office/cloud/fetch` and `/scrape`, handled by `server/cloud/web.js` on top of `server/safefetch.js`, the same SSRF-safe fetch the staff use.
- **Blocked addresses:** private, loopback, link-local, CGNAT and metadata addresses, every IPv6 form that smuggles one, names that resolve to any of them, credentials in URLs, ports other than 80 and 443, and the building's own hosts and bought domains. Checked on every redirect, inside the socket's DNS lookup so a rebinding name gets no second answer, and again against the address actually connected to. All of them get the same answer, so a page can't use it to map what is behind the building.
- **Manners:** `User-Agent: TheOfficeBot/1.0 (+https://fakebusiness.io/theoffice/; ...)`. Every hop asks that site's `robots.txt` first (RFC 9309: a 4xx means no rules, and anything unreachable means no). It is cached for an hour, a failure for a minute, and `Crawl-delay` is honoured up to 30 seconds. One gap per host for the whole building (at least 1 second), and a request that would wait over 4 seconds is told to try again.
- **Only text:** HTML, JSON, XML and plain text, at most 512 KB, 15 seconds and 4 redirects. Nothing is sent but the address. `office.scrape` parses without running anything, in one forward pass so a hostile page costs only its own length.
- **Cache:** a page is kept for 5 minutes, up to 24 MB for the whole building, and shared between projects since it holds only public pages fetched without credentials. A cache hit, or joining a fetch already running, doesn't count against the daily allowance.

## Website chat
A small AI assistant added to launched sites and apps at serve time, on top of `office.ai` and its limits. See `docs/CHAT.md`.

## The boss and the admin
- The boss's **Backend** panel also shows AI requests today, tokens left today (quick and smart), pages read today and pages left, with a switch for each, on by default. Counts only.
- The boss's project card has a **Backend** button: accounts, documents, saves, scores, uploads, who's playing now, requests today, storage used.
  **Clear saved data** on the card now clears the backend too (accounts included).
- `GET /theoffice/api/admin/cloud` lists every project; `POST /theoffice/api/admin/cloud/wipe {floor, project}` wipes one and closes its rooms.
- In the container:
  ```
  node scripts/admin.mjs backend usage [--json]
  node scripts/admin.mjs backend export --floor N --project SLUG [--files] [--out FILE]   # no password hashes or sessions
  node scripts/admin.mjs backend wipe --floor N --project SLUG --yes
  node scripts/admin.mjs cloud ai status [PROJECT] [--floor N] [--json]     # PROJECT is a subdomain label, or a slug with --floor when two floors share one
  node scripts/admin.mjs cloud ai pause|resume PROJECT                       # one project
  node scripts/admin.mjs cloud ai pause|resume --all                         # the whole building, no restart needed
  node scripts/admin.mjs cloud fetch status|pause|resume ...                 # the same for office.fetch and office.scrape
  ```
  They work on the database file, so a running server sees a pause on its next call. **Clear saved data** does not reset today's counts or lift a pause.

## Tests
`test/cloud.test.js` and `test/cloud-rooms.test.js` (isolation, CORS, accounts, data, saves, boards, files, rooms, quotas, rate limits, totals),
`test/cloud-admin.test.js` (the CLI), and `node test/browser/cloud.mjs`: the starter game published for real in Chrome, saving, logging in,
posting a score, and two tabs in one room. `test/cloud-powers.test.js` covers `office.ai` and the web fetcher (origin, every limit, ledger, kill switches, the SSRF list, robots.txt, redirects, and no secret or money in any response), and
`node test/browser/cloud-powers.mjs` runs both from a real page on a project origin (mock AI, a local test server) and shows another origin being refused.

## Deploy
Nothing new to set: no env vars, no container, no Caddy change. AI and web fetching are on by default (`OFFICE_AI_ENABLED=0` and `OFFICE_FETCH_ENABLED=0` turn them off). The tables are created on start. After deploying, check with
`curl -s https://<label>.middistance.com/_office/cloud/ping` (`{"ok":true,"version":1}`) and open a published game in two tabs.
Fixed on the way: `public/css/building.css` styled every `.stack`, which broke the Visitors, Sign-ups and Payment dialogs on main;
it is now scoped to the lobby's `section.stack`.

## Not done
No streaming from `office.ai` and no per-floor total across a floor's projects (the building's daily ceiling is what bounds the money).
No email verification, no server-side code or per-collection rules beyond private/public and ownership,
and rooms keep no state once empty. The container's `mem_limit` is still 700m in `docker-compose.yml`; the backend fits within it.
