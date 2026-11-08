# Office Runner: real server code for a project

Most projects should stay on Office Cloud (`docs/OFFICE-CLOUD.md`): accounts, a database, saves, `office.ai`, `office.fetch`, `office.scrape`, with no server code at all.
A **server slot** is for what that can't do: a job on a schedule, long-running work, a scraper that needs a real browser, sockets. Each one runs in a sandboxed container on `hz` under
office-runner (`runner/README.md`, Phase 1). This document is Phase 2: the Office's side.

The building has **4 slots in total, sleeping servers included, and at most 2 with a real browser.** Those numbers live in the runner, not here.

## On and off
The Office talks to the runner over a unix socket with a token, both bind-mounted read-only by `docker-compose.yml`:

| Mount | What |
|---|---|
| `/run/office-runner/api/` | holds `runner.sock`. A directory, so a runner restart's new socket shows up without restarting the Office |
| `/opt/office-runner/shared/` | holds `api.token` (`0440 root:1000`; the container runs as uid 1000) |

Both are looked at each time they're needed (`server/runner.js`). **No socket, or no readable token, and the feature is simply off**: no tool is offered, no prompt mentions it, no Servers tab appears, and everything else runs as before.
If the runner is installed later the Office needs no restart. Docker makes a missing mount source an empty directory, which counts as missing. The Office holds no other runner settings; `RUNNER_SOCKET` and `RUNNER_TOKEN_FILE` exist for tests.

## The flow (`server/servers.js`)
1. A Builder puts code in `projects/<project>/server/` (`server_starter` drops in a working Node one) and calls `deploy_server`.
2. **The first deploy of a project asks the boss** through the normal Requests tab, with the Builder's one-line reason, saying it uses one of the building's server slots. Nothing is built before the tap.
3. On Allow, the Office checks the slot count, records the yes, and sends the folder to the runner to build. The boss hears when it is built; the manager hears too, and if the build failed the manager gets the error, fenced as untrusted data, to give the Builder.
4. **After that, `deploy_server` just redeploys** (same slot, no second yes), and waits up to 90 seconds for the result so a build error comes straight back to the Builder as readable text. If it takes longer, it says so, and the same note reaches the manager when it finishes.

A failed build keeps the slot on the runner, so a fix is one more deploy. Only **delete** frees a slot; **stop** keeps the app and the slot. The full-building message says exactly that, and only ever lists the boss's own servers.

`server_starter`, `deploy_server`, `server_status`, `server_logs`, `server_restart` and (for testing) `server_check` are staff tools (Builder; the Tester gets status, logs and check; the manager gets status, logs and restart, and never deploys: it reads every staff result and knows private titles, so it has no way to send anything out). Logs and build output are fenced before an agent sees them, and any `ofs_` token that got printed is hidden. Nothing a floor wrote reaches the runner except the files in its own server folder.

The `server/` folder of a project is **never published** to its public site, if it holds a `package.json`, `office.json`, or a `server.js`/`index.js`/`app.js` at its top level.

## Labels and addresses
A server lives at `https://api--<label>.middistance.com`. Caddy sends `api--*` to the runner's edge, so **the Office never allocates a project label, long or short, that starts with `api--`** (`RESERVED_PREFIXES` in `server/apps.js`, with a test, including the hashed fallback).
`<label>` is the project's site label, fixed the first time a server is asked for, so launching a project later can't move a running server. Runner names stop at 58 characters; a longer project label gets a short hashed form.

### How a built site finds its server
```js
const office = Office.connect();
const url = await office.server.url();        // its address, or null if it has no server
const res = await office.server.fetch('/api/latest');
```
This is `GET /_office/cloud/server` on the project's own origin. The site's CSP gets `connect-src 'self' https://api--<label>.middistance.com` once the project has a server, and only that one address.

### CORS (what the Builder should do; the starter already does it)
The page and the server are different origins, so the server must answer them. The Office keeps `OFFICE_SITE_ORIGINS` current on every deploy and restart: a comma-separated list of every address the project's pages can be on (its long label, its short label, a bought domain). Allow only those:

```js
const allowed = (process.env.OFFICE_SITE_ORIGINS || '').split(',').filter(Boolean);
const origin = req.headers.origin;
if (origin && allowed.includes(origin)) {
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
}
if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
```
Never `*` with credentials. Send what the server needs in the body or an `Authorization` header, not cookies: the edge strips `Domain=`, so a server's cookie stays on its own `api--` host. A page's Office Cloud session goes up as `Authorization: Bearer <office.auth.token()>` and is checked with `office.asVisitor(token)`.

## Secrets and powers
**Boss settings.** Per-app environment settings on the Servers tab: names are shown; values are never shown again (not to the boss, staff, logs or snapshot). `OFFICE_*` and the runner's own names are refused.

**Building keys are never given to an app.** A value containing any secret from the Office's settings or environment is refused before it leaves (`checkBossEnv`), and the runner refuses what's listed in `etc/forbidden-secret-sha256`. A boss's own key for their own app is fine. Staff can't set environment settings at all.

**Office Cloud from server code.** The Office injects into each app:

| Name | What |
|---|---|
| `OFFICE_TOKEN` | a project-scoped token (`ofs_...`, 256 bits). Only its SHA-256 is kept. Minted at the first deploy, ended when the server is deleted or the floor is closed or wiped |
| `OFFICE_CLOUD_URL` | `https://iscolinfree.com/theoffice/api/app-cloud`. The app firewall allows the host's public 443 |
| `OFFICE_SERVER_URL` | the server's own address |
| `OFFICE_SITE_ORIGINS` | above |

The door (`/theoffice/api/app-cloud/...`, handled in `server/cloud/index.js`) takes only `Authorization: Bearer <token>` and **has no project in the address**: the token is the project, so another project's data can't be named. It is the same code as a page's `/_office/cloud/...`: `office.ai` (ledger, daily counts and the boss's off switches), `office.fetch`/`scrape`, `db`, `saves`, `boards`, `files`. Per-visitor limits count server code as one visitor per project (`srv:<floor>:<project>`), so one server can't use up an address shared with others. A request with an `Origin` header is refused (a browser holding this token is a leak), and sign-up and login are not available (only `auth/me`, to check a visitor's session passed on by the page).
On another project's site, the token is just a stray header that site ignores.

## The boss's Servers tab (`public/js/server-panel.js`)
Phone first. For each server: status (running, asleep, building, build failed), its address, recent logs, Restart, Stop/Start, **Delete to free the slot**, its scheduled jobs in words with Run now, and its settings. Slot requests stay in the Requests tab with every other request.

## The starter and the teams
`server/app-client/starters/node-server/` is a small working server with `/health`, an API with CORS, a scheduled job and an `office-cloud.js` client. `server_starter` copies it and never overwrites the team's own files. The prompt additions (`SERVER_DOCS`, the Tester's note and one line for the manager) appear only when the runner is on, and say: Office Cloud first, a server only when the idea really needs one. The Tester uses `server_check` for the health endpoint and one real flow.

## Admin (`scripts/admin.mjs`, run in the container)
```
node scripts/admin.mjs runner status [--json]   how full the building is, and each server with its floor and project
node scripts/admin.mjs runner stop <label>      stop one (it keeps its slot)
node scripts/admin.mjs runner remove <label>    delete one and end its token
node scripts/admin.mjs runner kill-all          stop every app and build at once
node scripts/admin.mjs runner release           lift the kill switch
```
`/opt/office-runner/kill-all` on the host is the same switch and needs nothing running.

## Tests
- `test/servers.test.js` with `test/fake-runner.js`, the real API on a real socket using the runner's own rules (`runner/src/apps.mjs`): off state, the approval, slot limits and the full-building message, `api--` labels, secrets never echoed, build failures, tokens that can't reach another project, the limits and ledger, publishing, CSP, the admin commands.
- `test/browser/server-panel.mjs`: the panel on desktop and phone in real Chrome.

## Deploy notes
Merge this branch, `docker compose up -d --build`. The compose mounts make the socket and token appear inside the container; with the runner installed, slots switch on by themselves. Server code needs `PUBLIC_ORIGIN` set (it is, on `hz`) for `OFFICE_CLOUD_URL`. Caddy needs nothing from this phase; the runner's own install handled `api--*`.
