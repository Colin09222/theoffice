# office-runner (Phase 1)

Runs friends' project **server apps** for The Office on hz, each in its own gVisor sandbox, so an app
can run its own server code, scrapers (headless Chromium) and, in Phase 2, AI features through an
Office proxy. Capacity: **`MAX_APPS=4`** deployed apps in total (sleeping ones count), at most
**`MAX_BROWSER_APPS=2`** on the browser tier. Both live in `/opt/office-runner/etc/runner.json`; edit,
then `systemctl restart office-runner` (apps are not touched by that).

## Architecture

```
internet ── Caddy (edge-caddy-1, host network)
              │  api--<label>.middistance.com          (on-demand TLS; ask → 127.0.0.1:8091 dispatcher)
              ▼
        office-runner-edge  127.0.0.1:8090    unprivileged (systemd DynamicUser, no caps, read-only FS)
              │  wake? ──────────────► office-runner (control) 127.0.0.1:8092 + /run/office-runner/api/runner.sock
              │                          root, owns Docker, /data volumes, secrets, schedules, builds
              ▼                          ▲ Phase 2: the Office calls this API with the shared token
        app containers on office-apps (172.30.0.0/24, br-office-apps), runtime runsc (gVisor)
        build containers on office-build (172.30.1.0/24), runtime runsc-build; only egress is the
        edge's CONNECT proxy 172.30.1.1:3128 → registry.npmjs.org, cdn.playwright.dev,
        playwright.download.prss.microsoft.com (443 only)
```

**Why systemd and not a container for the runner:** it has to drive Docker (the socket is
root-equivalent, so a container would isolate nothing), loop-mount each app's quota'd `/data` image
where dockerd can see it, and keep secrets root-only. It must also outlive the kill switch and any
app mishap. The one part that touches internet traffic, the edge, is split out and locked down hard
(throwaway user, no capabilities, read-only system, no Docker socket, no secrets but its own token).
Node for both is the binary from the same digest-pinned `node:22-slim` image the apps build on, so
nothing was installed on the host for it.

Files on hz:

| Path | What |
|---|---|
| `/opt/office-runner/app/` | this folder's `src/` (world-readable, no secrets) |
| `/opt/office-runner/bin/node`, `runnerctl`, `deploy-dir.mjs` | pinned Node 22; operator CLI; folder deploy tool |
| `/opt/office-runner/etc/runner.json` | settings (`MAX_APPS`, `MAX_BROWSER_APPS`, `IDLE_MINUTES`, ...) |
| `/opt/office-runner/secrets/` (0700) | `api.token`, `edge.token`, `apps/<label>.json` (per-app env, 0600) |
| `/opt/office-runner/shared/api.token` (0440 root:1000) | Phase 2's copy of the API token for the Office container |
| `/opt/office-runner/state/apps.json` | deployed apps; `state/KILLED` while the kill switch is on |
| `/opt/office-runner/volumes/<label>.img` → `mnt/<label>` | each app's `/data`: a 256 MB ext4 image, loop-mounted `nosuid,nodev,noexec` |
| `/opt/office-runner/logs/<label>.jobs.log` | scheduled job output (last 128 KB) |
| `/opt/office-runner/firewall/office-apps.nft` | the firewall (see below) |
| `/opt/office-runner/kill-all` | the kill switch |
| `/etc/systemd/system/office-{runner,runner-edge,apps-firewall}.service` | units |

## How an app runs

* **Deploy** (`POST /v1/apps/<label>/deploy`): the server folder's files are checked (no `..`, no
  absolute paths, ≤ 3000 files, ≤ 20 MB) and its `office.json`/`package.json` read. Capacity is
  checked and the app gets a fixed address `172.30.0.10+`. The build runs **under gVisor** in a
  container from the pinned base (`node:22-slim@sha256:5ec23b…`, or `office-runner/browser:pw1.65.0` =
  that image + Playwright 1.65.0's headless Chromium): files go in through Docker's archive API,
  `npm ci`/`npm install`, `npm run build` if present, `npm prune --omit=dev`. Non-root, no
  capabilities, 1.5 GB, 2 CPUs, 256 pids, 10 minutes, network = the build allowlist only. The result
  is committed as `office-app/<label>:b<n>` and the previous image removed. One build at a time.
* **Start / wake**: the first request to `api--<label>.middistance.com` (or `POST .../start`, or a
  job) creates the container if needed, starts it and waits for it to listen on `$PORT` (8080), up to
  45 s. Requests wait meanwhile; the edge retries once if a cached route went stale.
* **Sleep**: after `IDLE_MINUTES` (15) with no traffic the container is stopped (memory freed, `/data`
  kept). Three failed starts in 10 minutes back off for 5 minutes.
* **Scheduled jobs**: `office.json` `cron` (5-field, UTC, at most every 5 minutes, ≤ 5 jobs). At the
  time, the runner wakes the app and runs the command inside it (`docker exec` as the app user, under
  `timeout -s KILL`). The job keeps the app awake only while it runs: if the app was asleep and nobody
  visited meanwhile, it goes straight back to sleep.
* **Stop** keeps an app down (requests get 503) until **start**. **Delete** removes container, image,
  secrets, job log and (unless `?keepData=1`) its `/data`, freeing the slot.

App contract (for the AI staff writing them): listen on `process.env.PORT`; write only to `/data`
(persistent, 256 MB) and `/tmp` (tmpfs, wiped on sleep); `office.json` is optional:

```json
{ "tier": "browser", "start": "node server.js",
  "cron": [{ "name": "scrape", "schedule": "*/30 * * * *", "run": "node scrape.js", "timeoutMinutes": 5 }] }
```

Without `start`, the runner uses `npm start`, then `main`, then `server.js`/`index.js`/`app.js`.
Env given to every app: `PORT=8080 HOME=/tmp TMPDIR=/tmp NODE_ENV=production OFFICE_APP OFFICE_HOST
OFFICE_DATA_DIR=/data` (+ `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` on the browser tier) and its own
secrets. **Apps never get the building's API keys**: the runner never reads the Office's env, and a
secret whose SHA-256 is listed in `/opt/office-runner/etc/forbidden-secret-sha256` is refused.

## Security list (every app container)

| Control | Setting |
|---|---|
| Kernel isolation | `--runtime=runsc` (gVisor, systrap platform): apps talk to gVisor's kernel, not the host's |
| User | uid/gid 10001, never root |
| Capabilities | `--cap-drop ALL`, `--security-opt no-new-privileges` |
| Filesystem | `--read-only` root; `/tmp` tmpfs `noexec,nosuid,nodev`, 64 MB (256 MB browser) |
| Persistent data | only its own `/data`: a 256 MB loop-mounted ext4 image (`nosuid,nodev,noexec`), a hard quota |
| Mounts | nothing else from the host: no Docker socket, no host paths |
| Processes | `--pids-limit 128` |
| Memory / CPU | standard 512 MB / 1 CPU, browser 1 GB / 1 CPU; swap = memory (no swap) |
| Network | `office-apps` only, fixed address, no published ports, no IPv6 |
| Logs | json-file, 2 × 2 MB per app |
| Secrets | env vars from root-only files, never logged, never returned by the API (names only) |
| Restart | none by Docker; the runner wakes apps on demand |

Builds: same, plus runtime `runsc-build` (gVisor with `--overlay2=none` so `docker commit` sees the
installed files), 1.5 GB, 2 CPUs, 256 pids, 10 minute limit, network `office-build`.

### Network (nftables, `office-apps.nft`, loaded by `office-apps-firewall.service`)

Its own tables only (`inet office_apps`, `bridge office_apps_l2`), never `flush ruleset`; Docker's
and UFW's rules are untouched. Base chains at priority -10, so a drop there is final. The runner
**fails closed**: it won't start an app or a build unless these tables are loaded.

* Apps may open **TCP 80/443 to public addresses**, and DNS to Hetzner's resolvers.
  Per app (each has its own address): **10 new connections/s** (burst 40), **≤ 64 open**,
  **upload 1 MB/s** (burst 4 MB), **download 4 MB/s** (burst 16 MB), DNS 20 queries/s.
* Apps may reach this host only at its public address on 80/443, i.e. Caddy, so
  `https://iscolinfree.com` (the Office, and Phase 2's AI proxy) works.
* Dropped: 0/8, 10/8, 100.64/10, 127/8, **169.254/16 (169.254.169.254)**, 172.16/12, 192.168/16 and
  the other special ranges, multicast; **SMTP 25/465/587**; every other port and protocol; IPv6; any
  host service (sshd, the Office on 127.0.0.1:8083, the runner, Caddy's admin, Docker's networks);
  **app↔app** at layer 3 and layer 2 (bridge table); anything opening a connection into an app.
* Build containers: nothing forwarded at all; only `172.30.1.1:3128`, the edge's CONNECT proxy,
  which allows `registry.npmjs.org`, `cdn.playwright.dev`, `playwright.download.prss.microsoft.com` on
  443 and resolves them to public addresses only.

### Routing and TLS

Caddy's `*.middistance.com` site sends `api--<label>.middistance.com` to the edge
(`127.0.0.1:8090`, 32 MB request bodies, streaming, WebSockets) and everything else to the Office
exactly as before. The global on-demand TLS ask now goes to a loopback dispatcher site
(`127.0.0.1:8091`): `api--*` names are asked to the runner (yes only for labels it has), every other
name to the Office's `tls-check` with the same path and Host and no `X-Forwarded-*` (the Office
refuses asks carrying `X-Forwarded-For`). Exact config: `deploy/Caddyfile.runner`. The edge also
strips `Domain=` from cookies apps set, so an app can't plant cookies on other projects.

**Phase 2 must:** stop the Office from ever allocating a project label that starts with `api--`
(today `candidate()` in `server/apps.js` would give project "api" on floor "x" the label `api--x`,
which Caddy would now send to the runner; there are none today: 0 of 15 labels).

## Kill switch

`/opt/office-runner/kill-all` SIGKILLs every app and build container at once (needs no daemon) and
sets `state/KILLED`: wakes, starts and jobs are refused (503) until
`/opt/office-runner/kill-all --release`. `--status` shows it. API: `POST /v1/kill-all`,
`POST /v1/kill-all/release`.

## Phase 2 API (control daemon)

`http://127.0.0.1:8092` on the host, or the unix socket `/run/office-runner/api/runner.sock`
(dir 0750 root:1000, socket 0660 root:1000), which Phase 2 can mount into the Office container
together with `/opt/office-runner/shared/api.token`. The Office container can't reach the host's
127.0.0.1 from its bridge network, so the socket is the way in. Every call:
`Authorization: Bearer <api.token>`. JSON in and out; errors are `{ "error": code, "message": text }`.

| Call | Does |
|---|---|
| `GET /v1/health` | `{ ok, apps, maxApps, browserApps, maxBrowserApps, killed }` |
| `GET /v1/apps` | all apps (as below) |
| `POST /v1/apps/:label/deploy` `{ files: [{ path, data, encoding?: "base64"\|"utf8", executable? }], tier?, wait? }` | queue a build (202), or with `wait: true` build and answer when done (200). 409 `capacity` / `browser_capacity` / `busy`, 400 for bad files/manifest |
| `GET /v1/apps/:label` | `{ label, host, tier, status: running\|sleeping\|stopped\|building\|build_failed\|killed, enabled, image, deployedAt, lastTraffic, lastExit, jobsRunning, cron, secrets: [names], limits, build: { id, status, startedAt, finishedAt, error } }` |
| `POST /v1/apps/:label/start` | enable and wake now (waits until it listens) |
| `POST /v1/apps/:label/stop` | stop and keep it down |
| `POST /v1/apps/:label/sleep` | stop now; next request wakes it |
| `GET /v1/apps/:label/logs?tail=200` | `{ logs, jobs, build }`: container stdout/stderr tail, job log, last build log |
| `GET /v1/apps/:label/secrets` | `{ names }` |
| `PUT /v1/apps/:label/secrets` `{ env: { NAME: value } }` | replace all; app restarts on its next request with them |
| `PATCH /v1/apps/:label/secrets` `{ set: {...}, unset: [...] }` | change some |
| `POST /v1/apps/:label/jobs/:name` | run a scheduled job now, wait for it, `{ exitCode, timedOut, ms }` |
| `DELETE /v1/apps/:label[?keepData=1]` | remove the app, free the slot |
| `POST /v1/kill-all`, `POST /v1/kill-all/release` | the kill switch |

Labels: 1-58 of `a-z 0-9 -`, not starting or ending with `-` (Office labels like
`candle-shop--arcade-qa` fit, giving `api--candle-shop--arcade-qa.middistance.com`).

Operator shortcuts on hz: `runnerctl GET /v1/apps`, `deploy-dir.mjs <label> <folder> [tier]`,
`journalctl -u office-runner -u office-runner-edge`, `nft list table inet office_apps` (counters).

## Install / restore

Install (done 2026-11-08, see the dated note in ACCESS-AND-OPS.md): gVisor `runsc` from gVisor's
apt repository; `deploy/daemon.json` merged into `/etc/docker/daemon.json` and `systemctl reload
docker` (SIGHUP; no container restarts); `bash deploy/install.sh --with-browser-base`; the Caddy
changes in `deploy/Caddyfile.runner`, validated, then `caddy reload`.

Restore (backups and a RESTORE.md are in `/root/office-runner-backup-*` on hz):

1. Apps off: `/opt/office-runner/kill-all`.
2. Caddy: `cat /root/office-runner-backup-*/Caddyfile > /opt/edge/Caddyfile` (in place, same inode),
   then `docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.
3. Runner: `systemctl disable --now office-runner-edge office-runner`;
   `docker rm -f $(docker ps -aq --filter label=office.runner)`; `umount /opt/office-runner/mnt/*`;
   `docker network rm office-apps office-build`.
4. Firewall: `systemctl disable office-apps-firewall` then
   `nft delete table inet office_apps; nft delete table bridge office_apps_l2`.
5. gVisor: remove the two `runsc*` entries from `/etc/docker/daemon.json` (it did not exist before:
   delete it), `systemctl reload docker`; `apt-get remove runsc`; remove
   `/etc/apt/sources.list.d/gvisor.list` and `/usr/share/keyrings/gvisor-archive-keyring.gpg`.

None of these steps restarts dockerd or an existing container.
