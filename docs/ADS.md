# Paid ads: Google Search (Business mode)

Business mode's Launch step can put real money behind a floor's ads. Paid ads run on **Google Search only** for now: the floor shows
"Facebook & Instagram ads: coming soon" as a taped-over switch next to Google. The picture and video ads are still made, for sharing.
The free path ($0, "just for fun") stays the default, and it is the only path until paid ads are switched on.

## What happens

1. When the ads are ready, the boss picks the ad money on the floor: $0 (the default), $5, $10 or $25.
2. With an amount, the manager files an AD SPEND request. It needs the boss's own Approve click; no bot holds a tool that approves.
3. The click records the approval first (status `approved`, with `decided_at`). The building's monthly cap is checked in the same transaction.
4. The server then makes the campaign on Google in one all-or-nothing request, **PAUSED**: budget, campaign, US and English targeting,
   ad group, the marketer's keywords (phrase match) and a responsive search ad pointing at the floor's live site.
5. Only then is it switched on, and only if the approval still stands on record, paid ads are still on and no stop is set. If a stop
   landed while it was being switched on, it goes straight back off.
6. About once a minute the server pauses and closes campaigns past their end. Every 15 minutes it reads views, clicks and cost. If any
   campaign has cost more than its approved amount, it pauses **every** Office campaign at once and sets the building's stop, so nothing new
   starts until `ads resume`. The boss's slip shows views and clicks, never the cost.

## The limits, and where they live

Constants in `server/googleads.js`, so no setting can lift them:

- **Budget.** A campaign *total* budget (`period: CUSTOM_PERIOD`, `totalAmountMicros`) of exactly the approved amount, never over **$25**.
  It counts whole dollars only.
- **Dates.** v26 wants whole days: a start at `00:00:00` and an end at `23:59:59`.
  - The campaign starts today, or tomorrow in a day's last 15 minutes.
  - It runs **7 whole days**, always: day 1 at `00:00:00` to day 7 at `23:59:59` (from now, a little under 7 days; from a late-night
    approval, 7 days and a few minutes).
  - Google refused the same total budget over 2 days (`UNKNOWN` on `end_date_time`) and took it over 7, on a live campaign
    (2026-11-07). Validate-only requests refused 3 days. So there is no setting for the length.
- **Network.** Google Search only: `targetSearchNetwork` (search partners) and `targetContentNetwork` (display) are off.
- **Bidding.** Maximize Clicks (`targetSpend`) with a ceiling on each click: `AD_CPC_CEILING_USD`, default $0.50, never over $2, and never
  over the amount itself.
- **One per floor.** A floor has one live request or campaign at a time.
- **Account check.** The Google Ads account must be in US dollars and in the configured time zone, or nothing is made.

## Settings (`.env` on hz, never in the repo)

| Setting | Default | What it does |
| --- | --- | --- |
| `ADS_PAID_ENABLED` | off | `1` turns paid ads on. Off means the floor offers only $0, and nothing new starts. Campaigns already running keep running to their end within their approved totals; use `ads pause-all` to stop them. |
| `AD_MONTHLY_CAP_USD` | 50 | The building's limit for the calendar month (account time zone). Admin only, never shown on a floor. |
| `AD_CPC_CEILING_USD` | 0.50 | The most one click may cost (at most $2). |
| `GOOGLE_ADS_CUSTOMER_ID` | | The ad account, digits only. |
| `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN` | | OAuth. The server buys an access token from the refresh token and keeps it in memory only. |
| `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | | Optional. Sent only if set (v26 works without the developer token). |
| `GOOGLE_ADS_TIME_ZONE` | America/New_York | Must match the account's own zone. |

The four `GOOGLE_ADS_*` credentials were added to `/opt/theoffice/.env` on hz on 2026-11-07, with a backup at
`.env.bak-before-google-ads`. The running container picks them up at its next `docker compose up -d`. Credentials never reach a log line,
the database, a prompt, a tool result or a floor, and `scrub()` removes them from any error text.

## How the monthly cap counts

Every campaign approved, running, stopped or ended this month is counted at its approved amount, or at its real cost if that is higher.
So is any request whose campaign was made on Google, whatever happened to it afterwards. A new campaign is refused when that count plus
its own amount would pass `AD_MONTHLY_CAP_USD`. The cap is checked three times:

- when the boss picks an amount;
- when the manager files the request;
- at the boss's click, which is the check that decides.

The floor is told only "the building can't take another paid campaign this month", never a figure.

## The spend watchdog

`scripts/ads-watchdog.mjs` runs from a scheduler on hz, inside the container so it has the server's settings:

```
*/15 * * * * cd /opt/theoffice && docker compose exec -T theoffice node scripts/ads-watchdog.mjs >> /opt/theoffice/ads-watchdog.log 2>&1
```

It reads each campaign's real cost through the API (`metrics.cost_micros`, all time, and for this month). Then:

- If any Office campaign has cost more than its approved amount, or the account's cost this month is over the cap, it pauses **every**
  enabled campaign at once. It also sets the building's stop, so nothing new starts until `ads resume`.
  - This holds even when the server's own check paused the over campaign first.
  - Each campaign over its amount raises this alarm once (the database remembers it). After that it trips again only if it is switched
    back on, so `ads resume` isn't undone by an old campaign that stays off. `ads resume` also counts every overspend known so far as seen.
- It always pauses a campaign the Office doesn't know, and an Office campaign that is on though its request is closed.
- It pauses a campaign past its end date, on schedule.
- A pause goes through for every campaign it can change, even if one can't be changed, and the line says so.

It prints one line and exits 0 (all well), 1 (it paused something for being over, unknown or stray) or 2 (Google couldn't be read).
While the building's stop is on, the all-well line ends with "new paid campaigns held since … until "ads resume"".
`--dry-run` says what it would pause and pauses nothing.

**Before scheduling it:** the account also holds the Lanternfall test campaign (`24450155671`, $2 total, Nov 8–14), which the Office
didn't make. The watchdog will pause it on its first run (a dry run on 2026-11-07 said exactly that). So schedule the watchdog after
Nov 14, or accept that the Lanternfall test stops early.

## Admin

```
docker compose exec theoffice node scripts/admin.mjs ads list [--json]   # approved against spent per campaign (Google's figures), the month against the cap, any stop
docker compose exec theoffice node scripts/admin.mjs ads pause-all       # emergency stop: pause every enabled campaign in the account, and hold new ones
docker compose exec theoffice node scripts/admin.mjs ads resume          # lift the stop, once you've looked (paused campaigns stay paused)
```

## What was checked against the real API, and what is mocked

- **Tests use a mocked API only** (`server/googleads-mock.js`), and no test reaches Google. The mock refuses what the real API refused:
  - `startDate`/`endDate` (v26 wants `startDateTime`/`endDateTime`);
  - a start that isn't `00:00:00`, or an end that isn't `23:59:59`;
  - a total budget over fewer than 4 days;
  - over-long ad text.
- **Validate-only requests on 2026-11-07, which create nothing:** the whole campaign as the server builds it validates against the real
  v26 account ($5 total, today 00:00:00 to the 13th 23:59:59, with keywords and the responsive search ad). The read-only queries the
  watchdog and the broker use work as written.
- **From hz:** the token refreshes on the server, and the account reads as `America/New_York`, USD.
- **Not yet done:** a real campaign through the server. That is the $5 test with Colon.

## The $5 test with Colon

1. Deploy this branch to hz when Colon says so. The credentials are already in `.env`.
2. Set `ADS_PAID_ENABLED=1` in `.env`, then run `docker compose up -d`.
3. On a floor with a live public site, go through Business mode, choose $5 and Approve.
4. Run `admin.mjs ads list`: the request should be `running (Google: ENABLED), approved $5`.
5. In Google Ads, check the campaign: total budget $5, the end date, Search only, and the keywords and ad.
6. Run `ads-watchdog.mjs --dry-run` once. Then schedule it, keeping the Lanternfall note above in mind.
7. If anything looks wrong, run `admin.mjs ads pause-all`.
8. If the OAuth app is still in Google's "Testing" publishing status, its refresh token stops working after 7 days. Publish it to keep the
   connection, or reconnect when the watchdog starts saying `ads ERROR`.
