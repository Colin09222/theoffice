# Numbers and the daily run

Two things that turn a launched project into something that keeps being run: a company dashboard for each boss, and an opt-in daily loop in which the AI team reads the numbers and makes one real improvement.

Both are boss-only. The dashboard has one owner-only route and the run's words are hidden from visitors. Nothing here goes in the public feed, a speech bubble, the tower, the ticker or a leaderboard, and AI cost and building budgets are never shown on a floor.

## The Numbers tab

A boss-only tab on the floor (`public/js/numbers-ui.js`, `public/css/numbers.css`), phone first, from `GET /api/floors/:slug/numbers[?project=slug]` (`server/numbers.js`, owner-only, `no-store`):

| Figure | Where it comes from |
|---|---|
| Visitors and page views | `app_visits` (`recordVisit` in `server/launch.js`: no cookies, salted hash, per day) |
| Sign-ups | `app_forms` |
| New accounts | `cloud_users` (Office Cloud) |
| Sales, orders, active subscribers | `salesSummary(db, floorId, { days })` from `server/cloud/pay.js`, loaded softly |
| Ad spend against what it earned | `ad_spend` (Business mode): this company's campaigns from the last 30 days, in dollars |

- Today, last 7 days and last 30 days. Bars are plain SVG, tap or hover one to read that day. No chart library, no CDN.
- Top pages and where visitors came from for each period, per project when a company has several. Sales are per company (the contract has no project), and the dashboard says so.
- Days are UTC, because that is how visits are counted. A person who comes back on another day counts again.
- Empty states tell the truth: "no sales yet", "nothing on record yet". With no `pay.js` the dashboard says "no sales yet" and everything else works; a `salesSummary` that throws shows "couldn't be read just now".

`salesSummary` is expected to return `{ currency, grossCents, refundsCents, orders, activeSubs, byDay: [{ day, grossCents, orders }] }`. The dashboard adds up `byDay` so the tiles always match the chart; `activeSubs` is taken as it comes.

## The daily run

Per floor, off by default because each run costs AI money. The boss turns it on under Customise, Hours, "Run my company every day", and picks the time; it runs in their own time zone. Only the boss's own form changes this: the manager has no tool for it, so a page or an email can't start one.

Each run (`server/daily.js`):

1. The manager gets a private note: the numbers (`managerFigures`), customer questions (soft-loaded `unansweredQuestions` from `server/cloud/chat.js`, if present), open bugs and failed work, fenced as data. It is one call away from its inbox if company email is on. None of this is saved in the chat, and it is gone when the run ends.
2. It picks **one** concrete improvement and hands it to the Builder and then the Tester through the ordinary job system, on the autonomous model routing (`config/models.json`; tasks carry `auto=1`). The Tester is told to leave a `TEST-REPORT.md` with an `office-verdict` block, the same one the maker loop reads.
3. Only a version the Tester passed can go live. During a run `publish_project` is refused for this project until the newest version has passed with no blocker, major bug or regression, and a change after the pass starts it over. The existing Launch hold on maker projects stays as it is.
4. If nothing is worth doing, the manager assigns nothing and says why. That is a fine answer, and the report says so.
5. The boss gets a short report: what the numbers did (real figures only; "not enough data yet" when there aren't any), what changed, what's next. It is composed by the server from what is on record, sent as a boss-only message, shown at the top of the Numbers tab, and emailed to the boss's own address if company email is on.

### Guards

| Guard | How |
|---|---|
| Off by default | `daily_settings.enabled` starts at 0, and turning it on doesn't start a run: the first one is the next time the clock reads the boss's hour |
| One run per floor per day | by the floor's local day (a partial unique index backs it up) |
| Token cap per run | `DAILY_TOKEN_CAP` (default 5,000,000). The floor's ledger since the run started; over it, the run's open work is cancelled and the boss is told |
| Floors per day, building-wide | `DAILY_MAX_FLOORS` (default 5), per UTC day. A floor that doesn't get a slot stays due for the rest of its own day |
| The building's budget cap | a run doesn't start past it, and one under way stops cleanly when it is reached. The boss is told work stopped, never how much |
| Time limit | `DAILY_RUN_TIMEOUT_MIN` (default 180) |
| Goal first | the same rule as `docs/WORK-MODES.md`: no goal, no run. The manager asks the boss once, and the next run goes ahead once there is one |
| Costs and new people | buying something, spending money or emailing a new address still waits for the boss's tap, as it always has |

A floor that is busy at its hour stays due for the rest of its own day and starts when it is quiet, after any work-mode job. If the whole day goes by, that day is skipped.

### What keeps the numbers private

The manager sees the figures in its private prompt only, and they are never stored in the chat history. During a run: everything the manager says goes to the boss alone, even on a floor with its chat open; task titles, briefs and review notes have private figures stripped before they reach the board, the Talk tab or a staff member (`stripFigures`); and a published title or description that holds them is refused. An ordinary number or price in a brief stays.

### Admin

`scripts/admin.mjs` works on the database file alone; a running server sees the change on its next tick.

```
node scripts/admin.mjs daily status [--json]   which floors have it on, their next run and how the last one went. No figures from a floor
node scripts/admin.mjs daily run <floor>       force one run, to test it. The goal still comes first, the budget cap still applies, and it counts as that day's run
node scripts/admin.mjs daily pause|resume      stop or restart new runs across the building. A run under way finishes
```

`DAILY_TICK_MS` (default 30000) is how often the server looks. Tests: `test/numbers.test.js`, `test/daily.test.js`, and `node test/browser/numbers.mjs` for the tab on a phone and a desktop.
