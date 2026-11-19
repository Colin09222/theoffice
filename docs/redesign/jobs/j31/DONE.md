STATUS: GREEN
JOB: 31 The browser's port (follow-up from the orchestrator)
DONE MEANS: The Office reaches the shared browser after any restart with no hand-made bridge: docker-compose.yml starts a node forwarder on
  0.0.0.0:9223 in the shots container that pipes to the headless shell's 127.0.0.1:9222, then execs the browser; only 9223 is exposed;
  SHOTS_CDP_URL=http://shots:9223; the healthcheck goes through the forwarder on the container's own non-loopback address, so it fails when the Office
  couldn't reach it. Proved in test/shotsport.test.js, which runs the exact forwarder and healthcheck text read out of docker-compose.yml (on spare
  ports via FWD_LISTEN / FWD_TARGET, which are unset in compose):
  - "the Office is pointed at the forwarder; only 9223 is exposed; the browser keeps to loopback; every hardening line is still there" (image,
    restart, init, user 10001, read_only, /tmp tmpfs, no-new-privileges, cap_drop ALL, mem_limit 600m, pids_limit 256, json-file 10m x 3, no ports:,
    no host network; theoffice's extra_hosts for the tailnet gateway unchanged).
  - "through the forwarder, on a non-loopback address, the browser is reachable and cdpPage works; the healthcheck passes, and fails without the
    forwarder": against a real chrome-headless-shell listening on loopback only (as on the server): direct to its port on the machine's own address is
    refused; the healthcheck exits 1; with the forwarder it exits 0; server/cdp.js, called as http://shots:<port> (name looked up to the address, the
    debugger URL's host rewritten to it), loads a page and returns a JPEG, and reports an uncaught TypeError on a bad one; with the forwarder gone the
    healthcheck exits 1 again.
  - "a forwarder that can't listen says so and exits, and takes the browser down with it so the container restarts" (EADDRINUSE: it logs, SIGKILLs
    its parent, which on the server is the exec'd browser; with init: true the container then exits and restart: unless-stopped brings it back).
  server/shooter.js (lane A's, on main; not on this stack): checked by hand from origin/main against the same forwarder and a real headless shell:
  makeShooter({ cdpUrl: 'http://<address>:<forwarder port>' }) came up and shoot() returned a 3,683-byte JPEG (ff d8). It looks a name up to an IPv4
  address, keeps the explicit port (it falls back to 9222 only when the URL has none), and rewrites the webSocketDebuggerUrl's host to that base;
  /json/new and the WebSocket both pass through the forwarder. server/cdp.js does the same (cdpBase keeps the port; the ws host is rewritten). No code
  change was needed in either.
  Other changes in the shots service: --remote-debugging-address is dropped (the shell ignored it; now the browser is plainly loopback-only and the
  forwarder is the one way in), init: true (reaps the browser's child processes and lets the container stop when the browser does), start_period 10s.
TESTS: npm test 1761/1762. The 1: domains.test.js "the key only travels over TLS, in the body, and over IPv4" (EAFNOSUPPORT ::1; this container has
  no IPv6; it fails the same on office-redesign-base). test/shotsport.test.js 3/3 and test/cdp.test.js 5/5, both against a real headless shell
  (not skipped). Browser suites in test/browser: not run (no page changed).
DEPLOY NOTES: No migration, no new env for the Office beyond SHOTS_CDP_URL changing to http://shots:9223 (set in docker-compose.yml). On the server, in
  /opt/theoffice after the usual rsync (remove the hand-made forwarder first: it goes away with the container anyway):
    docker compose up -d --build theoffice shots          # recreates both: the browser with the forwarder, the Office with SHOTS_CDP_URL=...:9223
    docker compose ps shots                               # "Up ... (healthy)" within about 40 s
    docker compose logs --tail=20 shots                   # "shots forwarder: 0.0.0.0:9223 -> 127.0.0.1:9222" and "DevTools listening on ws://127.0.0.1:9222/..."
    docker compose exec -T shots sh -c 'grep -i " 0100007F:2406 \| 00000000:2407 " /proc/net/tcp'
                                                          # two LISTEN rows (state 0A): 127.0.0.1:9222 (the browser) and 0.0.0.0:9223 (the forwarder)
    docker compose exec -T theoffice printenv SHOTS_CDP_URL   # http://shots:9223
    docker compose exec -T theoffice node -e "require('node:dns').promises.lookup('shots').then((a)=>fetch('http://'+a.address+':9223/json/version')).then((r)=>r.json()).then((v)=>console.log(v.Browser))"
                                                          # HeadlessChrome/...: the Office reaches it by name
    docker compose exec -T theoffice node --input-type=module -e "import { cdpPage } from './server/cdp.js'; const r = await cdpPage(process.env.SHOTS_CDP_URL, process.env.SHOTS_ORIGIN + '/theoffice/'); console.log(r.ok, r.status, r.errors, r.shot?.length)"
                                                          # true 200 [] <bytes>
    docker compose exec -T theoffice node --input-type=module -e "import { makeShooter } from './server/shooter.js'; const s = await makeShooter({ cdpUrl: process.env.SHOTS_CDP_URL }); const j = await s.shoot(process.env.SHOTS_ORIGIN + '/theoffice/'); console.log(j.length, j[0] === 0xff); await s.close?.()"
                                                          # <bytes> true (once lane A's shooter.js is deployed)
    docker compose restart shots && sleep 40 && docker compose ps shots   # still healthy after a restart, with no hand-made bridge
    curl -s -m 3 http://127.0.0.1:9223/json/version || echo 'not on the host: good'
RISKS: The forwarder is a plain TCP pipe with no filtering, the same reach the hand-made bridge had: any container on the compose network (only the
  Office) can drive the browser, nothing outside can. If the forwarder dies while running (not at start) the browser keeps running and the
  healthcheck turns unhealthy, but Docker does not restart unhealthy containers by itself; a listen failure at start does take the container down.
  Docker isn't available in this container, so the compose file itself was not started here; its YAML parses, and its forwarder and healthcheck
  text were run as written. shooter.js was checked by hand, not by a committed test, because it isn't on this branch's stack.
