# Deploying floors-plus

Branch `floors-plus`, not merged and not deployed. Four parts: the office floor look, filler companies, standing orders, and the lobby ticker with the launched wall. The parent deploys; nothing here touches hz, DNS or Namecheap.

| Part | Switch | Off when |
|---|---|---|
| Floor visuals, ticker, launched wall | none: they come with the code | never |
| Filler companies | `FILLER_COMPANIES=1` | unset (the default, and in every test) |
| Standing orders | none, but no order exists until a boss makes one | a floor has none |

## 1. Back up

```sh
ssh hz 'sqlite3 /opt/theoffice/data/office.db ".backup /opt/theoffice/data/before-plus.db"'
```

New tables (`standing_orders`, `standing_runs`, the filler tables) and columns (`floors.filler`, `floors.last_opened_at`) are added at boot and are harmless to older code.

## 2. Environment

Add to `/opt/theoffice/.env` as wanted. Every value has a default and nothing is required.

```
# Filler companies: 3 to 4 fictional, scripted floors that make no model calls. Idempotent seed at boot.
FILLER_COMPANIES=1
FILLER_TICK_MS=9000          # how often the scenes advance when someone is watching

# Standing orders
ORDERS_PER_FLOOR=3           # most orders a floor may hold
ORDERS_MIN_HOURS=24          # shortest interval: once a day
ORDERS_IDLE_DAYS=14          # a boss who has not opened the floor for this long gets the orders paused
ORDERS_MAX_FAILS=3           # failed runs in a row before an order pauses itself
ORDERS_RUN_TIMEOUT_MIN=180   # a run still going after this is marked failed
ORDERS_TICK_MS=30000
ORDERS_ESTIMATE_USD=0.6      # shown as the estimate until a floor has runs of its own to average
```

## 3. Deploy

```sh
rsync -a --delete --exclude data --exclude node_modules --exclude .git ./ hz:/opt/theoffice/
ssh hz 'cd /opt/theoffice && docker compose up -d --build'
```

Then on hz, with `FILLER_COMPANIES=1`, the filler companies seed themselves at boot. Check with:

```sh
ssh hz 'cd /opt/theoffice && docker compose exec office node scripts/admin.mjs filler list'
```

## 4. Freeing a floor for a real friend

A filler company is marked "filler" in the admin view with a "Remove" button. From the shell:

```sh
node scripts/admin.mjs filler list
node scripts/admin.mjs filler free --floor 37     # removes whatever filler sits on floor 37
node scripts/admin.mjs filler remove --floor 37   # the same
node scripts/admin.mjs filler seed                # put the set back (only the ones not removed by hand)
node scripts/admin.mjs code --floor 37            # now a code can reserve it
```

A removed filler stays removed across restarts; the seed never resurrects one that was taken away on purpose.

## 5. Standing orders and money

An order runs through the ordinary engine: the same 14 steps per task, 60 tasks a day, daily caps and task cap, and the same purchase rules. A domain still needs the boss's own click. Each run leaves an owner-only report with estimated and actual cost. An order pauses itself after `ORDERS_MAX_FAILS` failed runs in a row, or when the boss has not opened the floor for `ORDERS_IDLE_DAYS`, so an abandoned floor cannot keep spending. Reopening the floor resumes orders paused for absence; orders paused for failures need the boss to press Resume.

With the caps set to `off` on the live server (see REPORT.md), a daily order on a floor costs roughly what one ordinary request costs, once a day. If that is more than wanted, lower `ORDERS_PER_FLOOR` or set `FLOOR_DAILY_USD` back to a number.

The manager can set an order itself when the boss asks for something regular, so a prompt-injected manager could in principle set one too. It is bounded the same way: three per floor, once a day, the ordinary caps, visible and deletable under Orders, and paused after three failures or two weeks of the boss not looking. Nothing an order runs can approve a purchase.

## 6. Rollback

```sh
ssh hz 'cd /opt/theoffice && git checkout main && docker compose up -d --build'
```

Or set `FILLER_COMPANIES=` (empty) and restart to stop the filler scenes while leaving their floors in the directory, then remove them with the CLI above. Standing orders stop with the code that runs them; their rows stay in the database and are ignored by older code. The database backup from step 1 restores everything else.
