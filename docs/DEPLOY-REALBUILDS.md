# Deploying real builds

Two independent switches, each reversible on its own. Nothing here has been applied. Do them in this order.

- **App origins** (`APPS_BASE_DOMAIN`): each project gets its own web origin, with real localStorage, service workers, PWA install and the data API.
- **Computers** (`COMPUTER_ENABLED=1`): the Builder and Tester work in Anthropic-hosted containers through Claude Managed Agents.

Not tested anywhere yet: real DNS, real certificates, Caddy with this config, Docker, or the hz gate. The app side of all of it is tested. See "What was checked" at the end.

## 0. Read this first: same domain or a separate one

A browser treats `x.apps.iscolinfree.com` and `iscolinfree.com` as the **same site**, though not the same origin. For a domain shared with the private site, that means:

1. **Planted cookies.** Published code can set a cookie for the parent domain with `document.cookie = "x=y; Domain=iscolinfree.com; Path=/theoffice"`. It can't read any cookie, but:
   - It can log a logged-out visitor into the attacker's own floor, by planting a valid `office_s`. They would then be chatting on the attacker's floor.
   - It can lock an owner out. Two `office_s` cookies are treated as logged out, and logging in again doesn't help until they clear the planted one.
   - It can overflow the cookie header, so every request to the private site fails until the visitor clears cookies.
2. **Same-site requests.** `SameSite=Lax` doesn't stop a same-site request, so a published page can send requests to the private site with `bhq_auth` attached. It can't read the replies. The gate patch in step 4 refuses these. The Office's own API already does.
3. **CSP is not a hard wall.** The page's Content-Security-Policy blocks all of this from ordinary pages, but a service worker can synthesise a page with no CSP. The gate patch is the real defence for item 2. Nothing stops item 1.

**Recommendation: use a separate registrable domain**, such as `iscolinfree-apps.com`. It removes all of the above for the main site and the private site, because the browser then treats projects as a different site. It costs one domain registration, which is the owner's decision. Everything below works the same way with either; swap the domain name. The server logs a warning at boot if the two share a site.

If you stay on `apps.iscolinfree.com`, step 1 and step 4 are mandatory and item 1 is an accepted risk, in a building of friends who were each given a code. It cannot read anything.

**Either way,** projects can plant cookies on each other, because they share the apps domain. A hostile project can't read another's data or fake its preview pass (`__Host-` cookies can't be planted), but a very large planted cookie can make every project fail with a 431 for that visitor until they clear cookies. Listing the apps domain on the Public Suffix List would end that, and is worth doing on a separate domain once it is stable.

## 1. Check `bhq_auth` first (same-domain only)

```sh
ssh hz 'grep -n "bhq_auth" /opt/bhq/server.js | grep -i "cookie"'
curl -sI https://iscolinfree.com/ | grep -i set-cookie
```

The cookie must have **no `Domain=` attribute**. With one, the browser would send it to every project origin, and published code could use it. The Office's cookies have no `Domain` (tested), and neither does `bhq_auth` in the local copy of the gate (`repos/bhq-gate/server.js`), but that copy may not match hz. If `bhq_auth` has one on hz, remove it or use a separate domain; do not continue.

Also check the gate for a WebSocket handler: `ssh hz 'grep -n "upgrade" /opt/bhq/server.js'`. The local copy has none. The patch in step 4 only covers ordinary requests, and browsers let any page open a WebSocket, with cookies attached and the reply readable. If there is one, it needs the same `refuseAppOrigins` check on its `Origin`, or a separate domain.

## 2. DNS

Add one record, with `<hz-ip>` and `<hz-ipv6>` from the existing apex record:

```
*.apps.iscolinfree.com.  300  IN  A     <hz-ip>
*.apps.iscolinfree.com.  300  IN  AAAA  <hz-ipv6>
```

If the zone is behind a CDN proxy, set this record to DNS-only: Caddy has to answer the TLS itself, and most CDN free plans don't cover a second-level wildcard. Check with `dig +short test.apps.iscolinfree.com`.

## 3. Caddy

This site block goes straight to the app, **not through the gate**, so nothing about the private site is in its path. Use one of the two TLS options.

**Option A: on-demand TLS.** No DNS API needed. The `ask` URL approves only live published projects, and only answers direct calls: through the gate it returns 404, because the gate adds `X-Forwarded-For`. Each project gets its own certificate. Let's Encrypt allows 50 new certificates per registered domain per week, shared with everything else on that domain. It also makes a private project's name visible in certificate logs, and its origin answers TLS where an unknown one does not.

```caddyfile
{
	on_demand_tls {
		ask http://127.0.0.1:8083/theoffice/api/apps/tls-check
	}
}

*.apps.iscolinfree.com {
	tls {
		on_demand
	}
	# Only a private project's preview pass needs a cookie. Dropping the rest also stops a planted cookie breaking public projects.
	@nopass not header Cookie *__Host-office_preview=*
	request_header @nopass -Cookie
	reverse_proxy 127.0.0.1:8083 {
		header_up -Authorization
		header_up Cookie "(^|;\s*)(office_s|office_a|bhq_auth)=[^;]*" ""
		flush_interval -1
	}
}
```

Merge the `on_demand_tls` lines into the existing global options block if there is one. If Caddy runs in a container, use the address it reaches the app by.

**Option B: wildcard certificate.** One certificate, no per-project rate limit and no leak of project names, but it needs a Caddy build with your DNS provider's plugin and an API token:

```caddyfile
*.apps.iscolinfree.com {
	tls {
		dns <provider> {env.DNS_API_TOKEN}
	}
	# Only a private project's preview pass needs a cookie. Dropping the rest also stops a planted cookie breaking public projects.
	@nopass not header Cookie *__Host-office_preview=*
	request_header @nopass -Cookie
	reverse_proxy 127.0.0.1:8083 {
		header_up -Authorization
		header_up Cookie "(^|;\s*)(office_s|office_a|bhq_auth)=[^;]*" ""
		flush_interval -1
	}
}
```

Reload with `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`. The app also ignores those cookies itself, so the `header_up` lines are a second lock.

## 4. Gate patch (same-domain only)

In `/opt/bhq/server.js`, add this function next to `proxyOffice`, with your domain in the first line:

```js
// Published projects live on sibling subdomains, and a browser sends this site's cookies on their requests. Those requests are refused here, before anything private sees them. Following a plain link is fine.
const APPS_SUFFIX = '.apps.iscolinfree.com';
function refuseAppOrigins(req, res) {
  const fromApps = (v) => { try { return new URL(v).hostname.toLowerCase().endsWith(APPS_SUFFIX); } catch { return false; } };
  const navigation = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
  if (navigation) return false;
  if (req.headers['sec-fetch-site'] === 'same-site' || fromApps(req.headers.origin) || fromApps(req.headers.referer)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Refused.');
    return true;
  }
  return false;
}
```

Then make this the very first line of the gate's request handler, above every route and the password check:

```js
if (refuseAppOrigins(req, res)) return;
```

If another subdomain legitimately calls the main site from a browser, narrow the `same-site` check first. Restart the gate. `test/gate-apps.test.js` runs this exact code.

## 5. Copy the code and set the env

Back up first: `sqlite3 /opt/theoffice/data/office.db ".backup /opt/theoffice/data/before-realbuilds.db"`. The new tables and columns are added automatically at boot and are harmless to older code.

From this repo's `real-builds` branch:

```sh
rsync -az --delete --exclude .git --exclude data --exclude .env --exclude media --exclude node_modules ./ hz:/opt/theoffice/
```

Add to `/opt/theoffice/.env`:

| Key | Value |
|---|---|
| `APPS_BASE_DOMAIN` | `apps.iscolinfree.com`, or your separate domain. A domain containing the main site is refused and the app stays in sandbox mode |
| `APPS_SCHEME` | `https` |
| `PUBLIC_ORIGIN` | `https://iscolinfree.com` (already set; it is now also the only site allowed to frame a project) |
| `COMPUTER_ENABLED` | Leave unset for now. `1` in step 7 |
| `SESSION_MAX_USD` | `5`. A hard platform budget per session. It applies even with every daily cap off, and is lowered to the task and daily caps when those are set |
| `SESSION_MAX_STEPS` | `40`. Model requests per session, the computer's version of the 14-step limit. One step is usually one command |
| `SESSION_MAX_MINUTES` | `30` |
| `MAX_SESSIONS_FLOOR` / `MAX_SESSIONS_GLOBAL` | `2` / `4` |

`ANTHROPIC_API_KEY` must be from a workspace with access to Managed Agents (the Claude Platform beta). The 60-tasks-a-day limit needs no setting.

```sh
ssh hz 'cd /opt/theoffice && docker compose up -d --build && docker compose logs --tail=20'
```

## 6. Check app origins

Publish something, or use an existing project.

```sh
LABEL=<project>--<floor>
curl -sI https://iscolinfree.com/theoffice/f/<floor>/<project>/ | grep -iE 'HTTP|location'      # 302 to the project origin
curl -sI https://$LABEL.apps.iscolinfree.com/ | grep -iE 'HTTP|content-security|set-cookie'      # 200, a CSP with connect-src 'self', no set-cookie
curl -s https://$LABEL.apps.iscolinfree.com/theoffice/api/me | head -c 80                        # the project's own page (client-side route fallback), never JSON
curl -s -o /dev/null -w '%{http_code}\n' https://nope--nothing.apps.iscolinfree.com/             # TLS failure on option A, 404 on option B
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:8083/theoffice/api/apps/tls-check?domain=evil.example'  # 404, run on hz
curl -s -H 'Sec-Fetch-Site: same-site' -o /dev/null -w '%{http_code}\n' https://iscolinfree.com/   # 403 with the gate patch
```

Then in a browser, on a project origin's console:

```js
self.origin                                  // the project's own https origin, not "null"
localStorage.setItem('t', 1)                 // no error
document.cookie                              // no office_s or bhq_auth
await fetch('https://iscolinfree.com/')      // TypeError, blocked by CSP
```

Check `/live` and the Bender HQ site still behave as before.

## 7. Turn computers on

Set `COMPUTER_ENABLED=1`, then `docker compose up -d`. The first task creates one environment (`theoffice-computer-<hash>`) and one agent per role (`theoffice-builder`, `theoffice-tester`). Their ids are kept in the `settings` table and only change when their definitions do.

Claim or use a test floor, and tell the manager: "go build a tiny game with a saved high score". Watch for "started a computer", "installed packages", "ran the build", "checked it in a real browser" and "published" in the feed, and for the spend figure to move. Every session is viewable in the Console under Managed Agents, Sessions.

Sessions are left in place for debugging, and hold that task's project files and transcript in Anthropic's systems until deleted. Nothing here deletes them.

## Rollback

Each step undoes alone, and nothing needs restoring.

1. **Computers off:** remove `COMPUTER_ENABLED`, then `docker compose up -d`. The Builder goes back to writing files through the old tool loop. A task that was mid-session resumes under the old loop from its brief and any notes, with its safety prompt, and without files it hadn't saved. Its session is left idle; delete it in the Console if you like.
2. **App origins off:** remove `APPS_BASE_DOMAIN`, then `docker compose up -d`. Friendly links serve from the sandbox again at once. Saved game data stays in the database but is unreachable, and sandboxed pages can't use it.
3. **Code:** rsync `main` back and rebuild, then remove the gate line and the Caddy block, and reload both. Binary files published meanwhile stop being served by the old code; they stay in the database.
4. **DNS:** the record can stay, or be removed.

The private site is never in the path of the app origin, and removing the gate line restores it exactly.

## What was checked

| What | How |
|---|---|
| Host routing, cookies ignored, data isolation, labels, TLS check, gate patch | Node tests with crafted `Host` headers (`test/apporigin.test.js`, `test/gate-apps.test.js`) |
| Cookie non-delivery, CSP blocks, real localStorage, service worker, offline | Real Chrome on `*.apps.localhost` (`npm run e2e:apps`, `scripts/proof-realbuild.mjs browser`) |
| Containers, network limits, Playwright, cost | Real Managed Agents sessions (`scripts/proof-realbuild.mjs build`) |
| Real DNS, real TLS, Caddy config, Docker image, the gate on hz | **Not checked**. The Caddy lines in particular are from its documentation, so run `caddy validate` |
