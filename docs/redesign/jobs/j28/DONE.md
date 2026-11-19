STATUS: GREEN
JOB: 28 A shared headless browser (follow-up from the orchestrator)
DONE MEANS: Live gets a browser beside the Office, and job 11's smoke check uses it when SHOTS_CDP_URL is set (page loads, console errors counted,
  screenshot saved to the job), falling back to today's HTTP check. Proved in test/cdp.test.js:
  - "a page in a fresh context: its status, console errors and page errors, and a JPEG; the context is thrown away after" (mock DevTools endpoint).
  - "a page that won't load or answers 404 fails; a name for the browser becomes its address": Chrome refuses a DevTools request whose Host is a
    name ("Host header is specified and is not an IP address or localhost", checked against a real headless shell here), so server/cdp.js resolves
    http://shots:9222 to the container's address first. The mock refuses names the same way.
  - "smokeCheck uses the shared browser when SHOTS_CDP_URL is set, and falls back to the HTTP check when it is down"; SMOKE_BROWSER=0 skips it.
  - "after a publish the smoke check runs in the shared browser at SHOTS_ORIGIN and saves its screenshot to the job": the browser is sent to
    http://theoffice:8083/theoffice/f/<floor>/<project>/, smoke_checks.how = 'cdp', the console error is recorded, the JPEG is on the floor's drive at
    projects/<slug>/notes/shots/smoke-<task>.jpg.
  - "against a real headless Chromium, when this machine has one": ran here against chrome-headless-shell 157 (not skipped): a good page passes with
    a real JPEG, a page with an uncaught TypeError fails with it in the errors.
  What changed: docker-compose.yml gains the `shots` service; theoffice gets SHOTS_CDP_URL=http://shots:9222 and SHOTS_ORIGIN=http://theoffice:8083
  (its extra_hosts for the tailnet gateway is kept as it was). server/cdp.js (new) speaks the DevTools protocol with Node's own fetch and WebSocket:
  no new package, no browser in the Office's image. Order of checks: shared browser, then a local Playwright if one exists, then plain HTTP.
  The shots service: image office-runner/browser:pw1.65.0 (not built here), its Chromium headless shell found under /ms-playwright and run with
  --no-sandbox --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222 --user-data-dir=/tmp/profile; `expose: 9222` only (no ports:, no host
  network), so only containers on this compose network reach it; user 10001 (the image's owner of /ms-playwright), read_only with a 256 MB /tmp
  tmpfs (HOME=/tmp), cap_drop ALL, no-new-privileges, mem_limit 600m, cpus 1.0, pids_limit 256, restart unless-stopped, json-file logs 10m x 3 like
  theoffice, and a healthcheck that asks /json/version with the image's node. Each check opens its own browser context and disposes of it after, so
  no cookies or storage carry from one site to the next. Published sites on their own origins and bought domains load over the internet; the
  browser's user agent says HeadlessChrome, so its visits are not counted (server/launch.js's bot list).
TESTS: npm test 1758/1759. The 1: domains.test.js "the key only travels over TLS, in the body, and over IPv4" (EAFNOSUPPORT ::1; this container has
  no IPv6; it fails the same on office-redesign-base). test/cdp.test.js 5/5, including the real headless shell. Browser suites in test/browser:
  not run (no page changed). Docker is not available here, so the shots service itself was not started; docker-compose.yml parses as YAML.
DEPLOY NOTES: No migration. New env (set in docker-compose.yml for theoffice): SHOTS_CDP_URL (unset = no shared browser), SHOTS_ORIGIN.
  On the server, from the directory with docker-compose.yml (/opt/theoffice):
    docker image inspect office-runner/browser:pw1.65.0 --format '{{.Id}}'          # the image is there (do not build it)
    docker compose up -d --build theoffice shots                                    # after the usual rsync: the Office with the new env, and the browser
    docker compose ps shots                                                         # Up ... (healthy) after ~30 s
    docker compose logs --tail=20 shots                                             # "DevTools listening on ws://0.0.0.0:9222/..."; no "no headless shell"
    docker compose exec -T theoffice node -e "const dns=require('node:dns').promises;dns.lookup('shots').then(a=>fetch('http://'+a.address+':9222/json/version')).then(r=>r.json()).then(v=>console.log(v.Browser))"
                                                                                    # prints HeadlessChrome/... : the Office reaches it
    docker compose exec -T theoffice node --input-type=module -e "import { cdpPage } from './server/cdp.js'; const r = await cdpPage(process.env.SHOTS_CDP_URL, process.env.SHOTS_ORIGIN + '/theoffice/'); console.log(r.ok, r.status, r.errors, r.shot?.length)"
                                                                                    # true 200 [] <bytes>: the browser opens the Office's own pages
    curl -s -m 3 http://127.0.0.1:9222/json/version || echo 'not on the host: good'  # 9222 is not published
  After the next publish on any floor: sqlite3 data/office.db "SELECT id, how, ok, status, shot_path FROM smoke_checks ORDER BY id DESC LIMIT 3"
  should show how = 'cdp' and a shot_path. To turn the shared browser off without a deploy: remove SHOTS_CDP_URL (or SMOKE_BROWSER=0) and
  `docker compose up -d theoffice`; `docker compose stop shots` stops the browser and the check falls back to HTTP by itself.
RISKS: The binary name inside /ms-playwright is found at start (chrome-headless-shell or headless_shell), so a different layout in that image
  fails loudly in `docker compose logs shots` rather than silently. --no-sandbox is used because the container drops every capability (Chromium's
  own sandbox needs user namespaces); the container is the boundary: read-only, no capabilities, no published port, memory and pid limits. A page
  the browser opens can reach other services on the compose network (only the Office, which it can already reach publicly) and the internet.
  The browser also reaches the Office over the compose network only because the Office listens on 0.0.0.0:8083 inside its container (unchanged).
  Lane A's launch-card screenshots (job 3) and timeline thumbnails (job 13) can call cdpPage(SHOTS_CDP_URL, url) for the same browser; I did not
  change their code. Not tried on the real server or with Docker (no Docker here): the compose file is checked as YAML only.
