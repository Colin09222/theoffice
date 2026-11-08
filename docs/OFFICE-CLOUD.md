# Office Cloud

The backend every published project gets for free: a database, accounts, saves, leaderboards, multiplayer rooms and uploads.
It runs inside the Office server (no new container, no new env vars), stores everything in the same SQLite file, and the staff use it
through one script. The staff's full reference is `server/app-client/OFFICE-CLOUD.md` (it goes into every builder's computer as
`.office/OFFICE-CLOUD.md`, with a starter game in `.office/examples/cloud-game/`).

## How a page uses it
```html
<script src="_office/office.js"></script>
<script> const office = Office.connect(); </script>
```
`office.auth`, `office.db`, `office.saves`, `office.leaderboard`, `office.rooms`, `office.files` (plus `office.shared` and `office.forms`,
which sit on the older `/_data/v1` store). The same file is at `/theoffice/sdk/office.js` on the main site for reference.

## Where it lives
- Every project origin (`<label>.middistance.com` and any domain bought for it) answers `/_office/cloud/...` itself, so the page's own
  CSP (`connect-src 'self'`, now with the same host's `wss:` spelled out) already allows it. The project is whichever one the Host names.
- Rooms are WebSockets at `/_office/cloud/rooms/<name>`, written by hand (`server/cloud/ws.js`): text frames only, no compression.
  Caddy passes the upgrade straight through, as the live edge config already proxies these hosts to `127.0.0.1:8083`.
- Code: `server/cloud/` (`index.js` HTTP and upgrade, `store.js` SQLite, `rooms.js`, `ws.js`, `schema.js`), `server/app-client/sdk.js`.

## Safety
- **Isolation:** every row carries `(floor_id, project)` and every query names both; sessions, files, rooms and boards are looked up the same way.
  A token, id or room name from one project finds nothing in another (tested for each).
- **CORS:** a request with an `Origin` must come from one of the project's own origins (its label and its live bought domains), or it gets 403 and
  no CORS headers. A sibling project is refused even though browsers call it "same site". Writes need an `Origin`; WebSockets check it on upgrade.
- **Accounts:** scrypt (N=16384) in the thread pool, at most 2 at once; sessions are random 256-bit tokens stored as SHA-256 hashes, 30 days.
  Log-ins are limited per account and address; a wrong password and an unknown name look the same. **No email is sent**, so there is no
  password reset; the SDK guide tells the staff to say so.
- **Ownership:** anyone can read a document unless it was added `{private: true}`; only its owner can change or delete it. Guests own things
  through a random token in their browser, and keep them when they sign up.
- **Uploads** are typed from their bytes (images, sound, video only; never HTML, SVG or script) and served with `nosniff`, a `sandbox` CSP and
  `inline` disposition. Stored in 256 KB pieces and streamed, so a download never holds a whole file in memory.
- **Untrusted content:** nothing a visitor writes reaches a model. The boss and the admin see counts only, never content or password hashes.
- **No dollar figures** anywhere in the backend, its docs or its views.

## Limits (defaults; `cloudLimits`, `cloudRoomLimits` and `cloudRates` in config overrides)
| | |
|---|---|
| Storage per project | 20 MB of data (documents, saves, scores, accounts), 50 MB of files; 8 GB for the whole building (hz has about 60 GB free) |
| Documents | 32 KB each, 50 collections, 20,000 per project, 2,000 per person, 100 per page |
| Saves | 64 KB each, 200 keys and 1 MB per person |
| Leaderboards | 50 per project, 5,000 entries each (a full board keeps its best), scores within plus or minus a trillion |
| Files | 5 MB each, 100 and 25 MB per person, 2,000 per project |
| Rooms | 16 people, 50 rooms per project, 1,000 in all; 600 connections in all, 200 per project, 32 per address; messages 8 KB, 20 a second (burst 40) and 32 KB a second each; 100 state keys / 32 KB per room |
| Requests | 30,000 a minute for the building, 3,000 per project, 600 per address, 240 writes per address per project; 120 queries a minute per address and 1,200 per project; 2 uploads at once per address; sign-ups 10 an hour per address; log-ins 10 per 15 minutes per account and address |

Request counts are kept in memory and written once a minute. Memory stays small: rooms cap out near 35 MB of state, at most 4 uploads
(20 MB) and 2 password hashes (32 MB) are in flight, and query responses stop at 512 KB.

## The boss and the admin
- The boss's project card has a **Backend** button: accounts, documents, saves, scores, uploads, who's playing now, requests today, storage used.
  **Clear saved data** on the card now clears the backend too (accounts included).
- `GET /theoffice/api/admin/cloud` lists every project; `POST /theoffice/api/admin/cloud/wipe {floor, project}` wipes one and closes its rooms.
- In the container:
  ```
  node scripts/admin.mjs backend usage [--json]
  node scripts/admin.mjs backend export --floor N --project SLUG [--files] [--out FILE]   # no password hashes or sessions
  node scripts/admin.mjs backend wipe --floor N --project SLUG --yes
  ```

## Tests
`test/cloud.test.js` and `test/cloud-rooms.test.js` (isolation, CORS, accounts, data, saves, boards, files, rooms, quotas, rate limits, totals),
`test/cloud-admin.test.js` (the CLI), and `node test/browser/cloud.mjs`: the starter game published for real in Chrome, saving, logging in,
posting a score, and two tabs in one room.

## Not done
No email (so no password reset or verification), no server-side code or per-collection rules beyond private/public and ownership,
and rooms keep no state once empty. The container's `mem_limit` is still 700m in `docker-compose.yml`; the backend fits within it.
