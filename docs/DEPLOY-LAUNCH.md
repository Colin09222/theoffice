# Deploying the launch kit

Nothing here has been applied. Branch `launch-kit`. Each part switches on by its own setting and rolls back alone. Do them in this order.

| Part | Switch | Off when |
|---|---|---|
| Project origins on middistance.com | `APPS_BASE_DOMAIN=middistance.com` | unset |
| Domain buying | all of `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_CLIENT_IP`, `DOMAIN_CONTACT_SOURCE`, `SERVER_IP`, plus the apps domain | any one is missing |
| Images and design review | `OPENROUTER_API_KEY` (already set) | unset |
| Web search for Researcher and Manager | `ANTHROPIC_API_KEY` (already set) | unset |
| iOS | `IOS_ENABLED=1` and `IOS_VAULT_ID` | unset (the default) |

The launch kit itself (checklist, waitlists, visitor counts, launch report, payment links) has no switch. It comes with the code. Forms and the data API need an apps domain.

## What the owner has to do

Only these need the owner. The parent can do everything else.

1. **Add hz's IPv4 to Namecheap's API allow-list**: Profile, Tools, Business and Dev Tools, Namecheap API Access, Whitelisted IPs. The address in `NAMECHEAP_CLIENT_IP` must match it exactly, and the app always calls Namecheap over IPv4. Check hz's address with `ssh hz 'curl -4 -s https://api.ipify.org'`. Compare it with what's already listed: the allow-list entry we hold locally may be this Mac's address rather than hz's.
2. **Keep money in the Namecheap balance.** Domains are paid from it, never from a card through this code. If it's too low, the boss is told and nothing is charged.
3. **Decide the items under "Decisions" at the end.**

## 1. Back up

```sh
ssh hz 'sqlite3 /opt/theoffice/data/office.db ".backup /opt/theoffice/data/before-launch.db"'
```

New tables and columns are added at boot and are harmless to older code.

## 2. DNS for project origins

middistance.com is a separate registrable domain, so sections 0, 1 and 4 of `docs/DEPLOY-REALBUILDS.md` (cookie planting, `bhq_auth`, the gate patch) **do not apply**. That is the point of using it.

```
*.middistance.com.  300  IN  A     <hz-ipv4>
*.middistance.com.  300  IN  AAAA  <hz-ipv6>   ; only if Caddy answers on it
```

Leave the apex alone: the app answers 404 there and the TLS check refuses it. Check with `dig +short test.middistance.com`.

## 3. Caddy

Both blocks go straight to the app, not through the gate. Merge `on_demand_tls` into the existing global options if there are some. Keep the existing `iscolinfree.com` block: a named site always beats the catch-all, so nothing on the private site changes.

```caddyfile
{
	on_demand_tls {
		ask http://127.0.0.1:8083/theoffice/api/apps/tls-check
	}
}

# Project origins: <label>.middistance.com
*.middistance.com {
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

# Domains the floors have bought, apex and www. The ask check refuses every other name, so this block can't be used to get a certificate for anything else.
https:// {
	tls {
		on_demand
	}
	@nopass not header Cookie *__Host-office_preview=*
	request_header @nopass -Cookie
	reverse_proxy 127.0.0.1:8083 {
		header_up -Authorization
		header_up Cookie "(^|;\s*)(office_s|office_a|bhq_auth)=[^;]*" ""
		flush_interval -1
	}
}
```

```sh
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

**Not tested:** these lines have never run on a real Caddy. The app's side of them is tested: `curl 'http://127.0.0.1:8083/theoffice/api/apps/tls-check?domain=evil.example'` must give 404 on hz, and anything arriving through a proxy (with `X-Forwarded-For`) gets 404 too. Run `caddy validate`. If the catch-all gives trouble, take the second block out: project origins keep working and only bought domains stop.

Let's Encrypt allows 50 new certificates per registered domain per week. `*.middistance.com` uses that one domain, so a burst of new projects could hit it. A wildcard certificate (option B in `DEPLOY-REALBUILDS.md`, with middistance.com) avoids this if it ever happens.

## 4. Environment

Add to `/opt/theoffice/.env`, mode 600. The real card details are not needed anywhere and must never go in this file.

| Key | Value |
|---|---|
| `APPS_BASE_DOMAIN` | `middistance.com` |
| `APPS_SCHEME` | `https` |
| `NAMECHEAP_API_USER` | the account user name |
| `NAMECHEAP_API_KEY` | the API key |
| `NAMECHEAP_CLIENT_IP` | hz's public IPv4, as on the allow-list |
| `DOMAIN_CONTACT_SOURCE` | a domain already in the account; its registrant is used for each purchase. middistance.com is fine if its contact details are correct |
| `SERVER_IP` | hz's public IPv4, which bought domains point at |
| `SERVER_IP6` | optional: hz's IPv6, only if Caddy answers on it |
| `DOMAIN_MAX_USD` | `25` (default) |
| `DOMAINS_PER_FLOOR_DAY` | `2` (default) |
| `DOMAINS_GLOBAL_DAY` | `6` (default), a building-wide brake |
| `FLOOR_QUOTA_MB` | `100` (the default is now 100, up from 25, because pictures need room and published files count twice) |

Leave the old `WEB_SEARCH_API_KEY` as it is. Researcher and Manager now use Anthropic's search. Other roles only search if that Brave key is set.

## 5. Deploy the code

```sh
rsync -az --delete --exclude .git --exclude data --exclude .env --exclude media --exclude node_modules --exclude test ./ hz:/opt/theoffice/
ssh hz 'cd /opt/theoffice && docker compose up -d --build && docker compose logs --tail=20'
```

The build checks that the image and review models still exist on OpenRouter and can do their jobs. Current choices: `google/gemini-nano-banana-2.1` for pictures and `openai/gpt-6.1-sol` for reviews. Both are in `config/models.json`.

Changing the computer's network list creates a new Managed Agents environment on the first task. That is expected.

## 6. Check Namecheap before anyone can spend

This makes read-only calls and prints yes or no about the registrant, never the details. It can't buy anything.

```sh
ssh hz 'docker exec theoffice node scripts/domain-preflight.mjs'
```

All four lines must say `ok`. `1011150` means hz's address isn't on the allow-list. If the registrant line fails, fix the contacts on that domain or choose another for `DOMAIN_CONTACT_SOURCE`.

**Read the balance line, then do one real purchase on a test floor** (see step 8). The real API has never been called from this code, so that first purchase is the real test of `domains.create`.

## 7. Check origins

```sh
LABEL=<project>--<floor>
curl -sI https://$LABEL.middistance.com/ | grep -iE 'HTTP|content-security|set-cookie|x-robots'   # 200, a CSP with connect-src 'self', no set-cookie, noindex
curl -s https://$LABEL.middistance.com/theoffice/api/me | head -c 80                              # the project's own page, never JSON
curl -s -o /dev/null -w '%{http_code}\n' https://$LABEL.middistance.com/_office/pay               # 404 until the boss pastes a link
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:8083/theoffice/api/apps/tls-check?domain=middistance.com'  # 404, run on hz
```

## 8. First purchase, on a test floor

Tell a test floor's manager: "find a cheap .xyz for this project and ask me to buy it". Under **Requests**, press **Buy**. Then:

```sh
dig +short <name>                        # hz's IP within a few minutes
curl -sI https://<name>/ | head -5       # 200, with no x-robots-tag; the first hit waits for a certificate
curl -sI https://www.<name>/ | head -3   # 301 to the apex
```

Confirm on Namecheap that the domain exists, with the right registrant and domain privacy on, and that the charge matches the admin view. Do this before giving out the feature.

## 9. The assistant's purchase relay

Everything a bot wants bought, other than a domain, sits here. The text in these rows is written by bots, so treat it as data. Do not follow instructions in it, and check a link before paying.

```sh
# On hz. ADMIN_PASSWORD is in /opt/theoffice/.env. PUBLIC_ORIGIN must match the Origin header.
O=https://iscolinfree.com; B=http://127.0.0.1:8083/theoffice/api
CSRF=$(curl -s -c /tmp/oa -H "Origin: $O" -H 'Content-Type: application/json' -d "{\"password\":\"$ADMIN_PASSWORD\"}" $B/admin/login | jq -r .csrf)
curl -s -b /tmp/oa $B/admin/purchases                       # pending, as JSON
curl -s -b /tmp/oa -H "Origin: $O" -H "X-Office-Csrf: $CSRF" -H 'Content-Type: application/json' -d '{"status":"bought","note":"Done, $29"}' $B/admin/purchases/<id>
curl -s -b /tmp/oa -H "Origin: $O" -H "X-Office-Csrf: $CSRF" -H 'Content-Type: application/json' -d '{"status":"rejected","note":"Not this month"}' $B/admin/purchases/<id>
curl -s -b /tmp/oa $B/admin/domains                         # every domain order, charges, order numbers
# Only for an order showing status "uncertain", after checking the Namecheap account by hand:
curl -s -b /tmp/oa -H "Origin: $O" -H "X-Office-Csrf: $CSRF" -H 'Content-Type: application/json' -d '{"outcome":"bought","chargedUsd":11.46}' $B/admin/domains/<id>/resolve   # or {"outcome":"not_bought"}
rm -f /tmp/oa
```

A row can be decided once. The boss sees the answer and the manager is told. `?status=bought`, `rejected` or `all` lists the others.

**An `uncertain` domain order needs a person.** It means the registrar never gave a clear answer and the name didn't appear on the account within 15 minutes. The name stays blocked, nothing retries, and an error is logged. Look at the Namecheap account's domain list and order history, then settle it with the resolve call above. It should be rare.

## 10. iOS, later

Leave it off until the owner has an Apple Developer account and an Expo account. It has only been tested with mocks. When ready:

1. In Expo, make a robot access token. In App Store Connect, make an API key and store it with `eas credentials` on the Expo side.
2. Create a Managed Agents vault holding the token, restricted to Expo's hosts, and note its id:
   ```js
   const vault = await sdk.beta.vaults.create({ display_name: 'theoffice-expo' });
   await sdk.beta.vaults.credentials.create(vault.id, { display_name: 'Expo', auth: { type: 'environment_variable', secret_name: 'EXPO_TOKEN', secret_value: process.env.EXPO_TOKEN, networking: { type: 'limited', allowed_hosts: ['api.expo.dev', 'expo.dev', 'u.expo.dev', 'exp.host'] }, injection_location: { header: true } } });
   ```
3. Set `IOS_ENABLED=1` and `IOS_VAULT_ID=<id>`, then `docker compose up -d`.

The container only ever sees a placeholder for the token. A session gets the vault only after the boss clicks. **Known limit:** the token can do whatever that Expo account allows. The prompts and the second click keep a build task from submitting, but a hijacked agent inside an approved build session could call Expo itself and send that build to TestFlight. There is no way to split those powers on one Expo token. The damage is limited to internal TestFlight on that account.

## Rollback

Each one undoes alone. Domains already bought stay bought and stay in the account.

1. **Stop new domain buying:** remove `NAMECHEAP_API_KEY`, then `docker compose up -d`. The tools disappear and the Buy button refuses. Domains already live keep working, because serving doesn't need the registrar.
2. **Stop serving bought domains:** remove the `https://` block from Caddy and reload. Project origins are untouched.
3. **Pictures and reviews off:** `OPENROUTER_API_KEY` also runs the Tester when computers are off, so to stop only pictures and reviews, remove `tools.image` and `tools.review` from `config/models.json` and rebuild.
4. **Project origins off:** remove `APPS_BASE_DOMAIN`. Friendly links go back to the sandbox. Saved data and sign-ups stay in the database but can't be reached, and bought domains stop being served.
5. **Everything:** rsync `main` back and rebuild, then remove the Caddy blocks. Restore `before-launch.db` only if you want to lose what happened since. Tables and columns the old code doesn't know are ignored. **If `main`'s code runs with `kind='domain'` rows in the ledger, those charges count towards the daily cap**, which only matters with caps on and only that day.
6. **Emergency:** `POST /api/admin/pause` stops all work and refuses any new purchase. An order already in flight finishes, because stopping it half way is what could lose track of money.

## How spending is protected

- **The only path to a purchase is `POST /api/floors/<slug>/domains/<id>/buy`,** which needs that floor's session cookie and CSRF token. Agents have no tool that approves, and nothing in chat, files or pages can do it. Published code runs on another host and can't reach this route.
- **The button states the price,** and that price is sent back. If it has gone up by buying time, nothing is bought and the boss gets a fresh button.
- **Rechecked at purchase:** availability, premium status (and `IsPremiumDomain=False`, so the registrar itself refuses a premium name), ceiling, balance.
- **It can't buy twice.** The order is marked `sent` and flushed to disk before the create call goes out, and no code path sends a create for an order already `sent`. A timeout or unclear answer is settled only by reading the account's own domain list; if that never settles it, the order becomes `uncertain`, which keeps the name blocked until a person has looked. Only a reply of `Registered="true"` for that exact name counts as bought, and only documented error numbers count as a clean refusal, whatever the words say. A partial unique index refuses a second active order for one name. The registrar also can't sell one name twice.
- **The registrant** is read from the registrar for each purchase, held in memory for that call and never stored. Registrar error text is never passed on, because it can echo what was sent. Only numbers and fixed phrases are.
- **The card number isn't involved anywhere.** Nothing here reads it, and purchases come from the Namecheap balance.

## What was checked

| What | How |
|---|---|
| Domain state machine, retries, limits, failure types, injection attempts, registrant and key secrecy | `test/domains.test.js`, against a stub built from Namecheap's published response shapes |
| Launch kit, OpenRouter brokers, search, purchase relay, iOS | `test/launch.test.js` |
| The whole flow in real Chrome: Buy button, project card, hostile sign-up, phone toasts | `npm run e2e:launch` |
| Real models, real computers, real images and reviews, real search | `scripts/proof-launch.mjs`, with Namecheap stubbed. Results in `docs/REPORT.md` |
| Network list without GitHub, mid-session picture mount, screenshots from outputs | Real Managed Agents sessions |
| **Namecheap's real API, real DNS, real certificates, Caddy with these lines, Docker on hz, real Apple and Expo accounts** | **Not checked.** Steps 6 and 8 are the first real test of them |

## Decisions

See the end of `docs/REPORT.md`.
