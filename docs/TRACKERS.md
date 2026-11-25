# Sales and website traffic trackers

Owner-approved 2026-11-25. Code: `server/trackers.js` (data, admin routes, snapshot hook), `public/js/trackers-ui.js` (the cards inside the
status card), `scripts/admin.mjs sales|traffic|trackers`. Tests: `test/trackers.test.js`. `TRACKERS=0` hides the cards.

## Who sees them
The floor's boss and the admin (owner session), on the floor page under the status card, desktop and phone. Visitors and other floors' bosses
get nothing: `trackers` is only added to their snapshot (`viewerFor` now carries `admin`).

## Sales
- Manual only. Entered by the owner's assistant with the admin CLI (or `POST /api/admin/trackers/:floor/sales`, admin + CSRF). No boss or public write path.
- Table `floor_sales`. `amount` is the sale's total in USD; `qty` (default 1) is what "sold" counts. Days are New York days.
  `--date` puts a sale on an earlier day (no time shown). Undo marks the row `undone_at`; it leaves every total.
- Card: today, last 7 days (today + 6 before), this calendar month, all time (sold count + $), and the 5 latest entries (date/time ET, amount, note, source).

## Traffic
- Source: the Office serves every published site itself (fakebusiness.io/theoffice/..., *.middistance.com app labels and custom domains
  via Caddy on-demand TLS -> the Office). `launch.js recordVisit` counts each page view into `app_visits` (unique visitors a day by a salted,
  day-scoped hash; bots left out; UTC days). The card sums that floor's rows: today, 7 days, 30 days, plus a 30-day sparkline of visitors.
  Caddy has no access logs, so this is the only real source and the cleanest one.
- A floor with no counted site: `traffic set` days by hand (`floor_traffic_manual`). A hand-entered day replaces the counted figure for that day.
- Note: the Office's own counts leave out bots but not the owner's own visits.

## Test offset
- `floor_traffic_offset` (floor_id, per_day, from_day). Each shown day from `from_day` up to today gets `+per_day` visitors and `+per_day` pageviews.
  Never written into `app_visits` or the manual rows; `--off` deletes the setting and the real numbers come back.
- Only the tracker card uses it. The public header count, the visit lights, Friday feature, "did it work" and Numbers tab stay real.
- The card shows a small dashed "test" tag; hovering it shows the per-day offset and today's real figures. `traffic show` prints real beside shown.

## Commands (in the container: `docker exec theoffice node scripts/admin.mjs ...`)
    sales add --floor N|SLUG --amount USD [--qty N] [--note "..."] [--date YYYY-MM-DD]
    sales list --floor N|SLUG [--limit N] [--json]
    sales undo --id N [--floor N|SLUG]
    traffic show --floor N|SLUG [--json]
    traffic set --floor N|SLUG --date YYYY-MM-DD --visits N [--pageviews N]   |   traffic set --floor N --date D --clear
    traffic offset --floor N|SLUG --per-day N --from YYYY-MM-DD   |   traffic offset --floor N --off   |   traffic offset --floor N
    trackers [--json]
