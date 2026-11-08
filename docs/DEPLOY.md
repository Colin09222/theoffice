# Deploying The Office

For app origins and real computers, follow this first, then [DEPLOY-REALBUILDS.md](DEPLOY-REALBUILDS.md).

The app listens on `127.0.0.1:8083` in Docker, and the Bender HQ gate proxies `/theoffice` to it. Caddy already sends the whole domain to the gate, so it needs no change. Nothing here has been applied yet.

Docker was not available on the build machine, so **the image has never been built**. Treat step 3 as the first real test of the Dockerfile.

## 1. Copy the code

From this repo, on your machine:

```sh
rsync -az --delete --exclude .git --exclude data --exclude .env --exclude media --exclude node_modules ./ hz:/opt/theoffice/
```

## 2. Create the env file and data directory

On hz:

```sh
cd /opt/theoffice
cp .env.example .env && chmod 600 .env
mkdir -p data && chown 1000:1000 data     # the container runs as the `node` user, uid 1000
```

Fill in `.env`:

| Key | Value |
|---|---|
| `AI_MODE` | `live` |
| `ANTHROPIC_API_KEY` | Your Claude API key, for the Claude roles |
| `OPENROUTER_API_KEY` | Your OpenRouter key, for the rest |
| `ADMIN_PASSWORD` | A long password for `/theoffice/admin` |
| `PUBLIC_ORIGIN` | `https://iscolinfree.com`. Required: CSRF checks compare against it, and `fetch_url` refuses this domain because of it |
| `TRUST_PROXY` | `1`. Caddy appends the real client IP to `X-Forwarded-For` and the app reads the rightmost hop. Don't set it if anything other than the gate can reach the port |
| `FLOOR_DAILY_USD` | `10` |
| `GLOBAL_DAILY_USD` | `25` |
| `TASK_MAX_USD` | `3` |
| `WEB_SEARCH_API_KEY` | Optional Brave Search key. If empty, agents have no `web_search` tool and can only `fetch_url` |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `MAIL_DOMAIN` | Optional: every company's own email. Set them up with `scripts/mail-setup.mjs`, see docs/MAIL.md. Empty, the Inbox says email is being set up and nothing sends |

## 3. Start it

```sh
docker compose up -d --build
docker compose logs -f --tail=50      # expect: "the office is open"
curl -sI http://127.0.0.1:8083/theoffice/ | head -5
```

The build runs `scripts/validate-models.mjs`, which fails if a configured model has left OpenRouter or lost tool support. If the build host has no outbound network, add `--build-arg SKIP_MODEL_CHECK=1`.

## 4. Patch the gate

In `/opt/bhq/server.js`, add this function next to `proxyLive`:

```js
// The Office: public, so it sits before the password check. It gets its own cookies only, never bhq_auth. SSE streams straight through.
function proxyOffice(req, res) {
  const headers = { ...req.headers };
  delete headers['x-bhq-auth'];
  const own = String(req.headers.cookie || '').split(';').map((c) => c.trim()).filter((c) => /^office_[sa]=/.test(c)).join('; ');
  if (own) headers.cookie = own; else delete headers.cookie;
  headers['x-forwarded-for'] = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress);
  const up = http.request({ host: '127.0.0.1', port: 8083, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    r.pipe(res);
    r.on('close', () => res.end());
  });
  up.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('The Office is closed for a moment.'); } else res.end(); });
  res.on('close', () => up.destroy());
  req.pipe(up);
}
```

Then add this one line directly above the existing `/live` route, which is before any password check:

```js
if (p === '/theoffice' || p.startsWith('/theoffice/')) return proxyOffice(req, res);
```

Restart the gate the way you normally do.

`test/gate.test.js` runs this exact function, extracted from this file, against the real app.

## 5. Check it, and issue the first code

```sh
curl -sI https://iscolinfree.com/theoffice/ | grep -iE 'HTTP|content-security|x-robots'
docker compose exec theoffice node scripts/admin.mjs code            # any free floor
docker compose exec theoffice node scripts/admin.mjs code --floor 7  # a specific floor
docker compose exec theoffice node scripts/admin.mjs floors
```

Each code prints once, to your terminal. Only its hash is stored. Codes can also be issued from `/theoffice/admin`.

Then, in a browser:
- Open `/theoffice`, claim a floor, send the manager a message and watch for a reply.
- Open a published site and run `self.origin` in its console. It should print `"null"`.
- Check `/live` and the Bender HQ site still behave as before.

## Rollback

Remove the route line and restart the gate, then run `docker compose down`. All data is in `/opt/theoffice/data`.

## Running it

- **Emergency stop:** "Pause the building" in the admin view stops every floor at once. Removing the route line closes the whole thing.
- **Backups:** copy `data/office.db`, along with `office.db-wal` if present, or use `sqlite3 office.db ".backup out.db"`.
- **Limits:** set in `docker-compose.yml`: read-only root, `no-new-privileges`, all capabilities dropped, 700 MB memory, 1 CPU, 128 processes, and a port on 127.0.0.1 only.
- **Files from the boss:** `POST /api/floors/<slug>/attachments` (owner session, CSRF token, raw body, `x-filename` header) takes png, jpg, webp, gif, pdf, txt, md, csv, json and zip up to 15 MB, judged by their bytes. They live in the floor's `uploads/`, count towards its quota and are served back only to that boss, as a download with nosniff. `POST /api/floors/<slug>/chat` takes `attachments: [id]`. Claude roles see pictures and PDFs as real blocks, fenced as untrusted data; staff copy one into a project with `copy_file`, and only that copy can go live. The server's 30 s request timeout means a 15 MB upload needs about 4 Mbit/s, so the page should shrink big photos before sending them.
