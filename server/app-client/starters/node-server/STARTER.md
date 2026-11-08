# Node server starter

A real server for the few ideas Office Cloud can't do alone: a job on a schedule, long-running work, a scraper with a real browser, sockets.
If Office Cloud can do it (accounts, a database, saves, `office.ai`, `office.fetch`, `office.scrape`), use that instead: a server takes one of the building's few slots.

Working already: `GET /health`, a small API with CORS for this project's own pages (`server.js`), a scheduled job (`jobs/refresh.js`, listed in `office.json`), Office Cloud from server code (`office-cloud.js`), and a real-browser scraper (`browser.js`).

Make it do the real job, then call `deploy_server`. Save your files first. The first deploy needs the boss's yes; after that, `deploy_server` updates it.

## The rules
- Listen on `process.env.PORT`. Write only to `/data` (kept, 256 MB) and `/tmp` (wiped when it sleeps). It sleeps after 15 quiet minutes and wakes on the next request, so nothing lives in memory across a sleep.
- Keep `GET /health` answering 200: the Tester checks it.
- Never put a key in these files. The boss adds settings on the Servers tab; read them from `process.env`. The building's own keys are never given to an app.
- `office.json`: `cron` is 5-field in UTC, at most every 5 minutes, up to 5 jobs. Delete `cron` if there is no job.

## Pages calling this server
The page and the server are different origins. In the page: `const office = Office.connect();` then `const url = await office.server.url();` or `await office.server.fetch('/api/latest')`.
`OFFICE_SITE_ORIGINS` holds every address the project's pages can be on, and `server.js` already answers CORS for exactly those. Send visitors' data in the body or an `Authorization` header, not cookies: cookies from `api--` servers stay on that host.

## Office Cloud from server code
`office-cloud.js` uses `OFFICE_CLOUD_URL` and `OFFICE_TOKEN`, which the Office puts in the environment. `office.ai.chat`, `office.fetch`, `office.scrape` and `office.db` work under the same daily limits as the project's pages, and reach only this project.
To act for a signed-in visitor, have the page send `office.auth.token()` (say, as an `Authorization: Bearer` header), and on the server look it up with `office.asVisitor(token)`, which answers who they are, or null.

## A real browser
Only if the page truly can't be read with `office.scrape`: set `"tier": "browser"` in `office.json` and add `"playwright-core": "1.65.0"` to `dependencies`, then use `browser.js` from the job. Browser servers are even rarer than slots.
