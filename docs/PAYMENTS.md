# Payments

Checkout inside the apps the teams make: real payments through Stripe Connect, with the money going straight to each company's boss.
Each boss connects their own Stripe account through Stripe's hosted onboarding. They are the seller; the money is theirs and tax, refunds and disputes are theirs to handle.
The platform takes **no fee and no application fee**. Stripe-hosted Checkout only: card details never touch this server, the app or the bots.

The code: `server/cloud/pay.js` (everything but the HTTP client), `server/cloud/pay-provider.js` (Stripe's REST API and webhook signatures, `createStripe`), `server/cloud/pay-mock.js` (a Stripe stand-in for tests),
`server/cloud/pay-schema.js`, `server/cloud/pay-config.js`, `public/js/pay-ui.js`, and `office.pay` in `server/app-client/sdk.js`. Built to docs.stripe.com, pinned to API version `2026-10-28.endive`.

## Going live
Nothing is deployed by this repo's tests. Stripe has no key yet; until there is one the site shows "Payments are being set up" and `office.pay` answers not-ready. There is no switch to flip in the code.

1. Sign up at stripe.com and activate the platform account. Under **Connect**, finish the platform profile and branding (name, icon, colour: Stripe requires them for hosted onboarding) and enable the countries you want. Set **Connect > Settings > Onboarding options** as you like.
2. Do this all in **test mode first** (see below), then repeat with the live key: the two are kept completely apart.
3. In the server's `.env` (the container reads it through `env_file`), set the secret key:
   ```
   STRIPE_SECRET_KEY=sk_test_...   # or sk_live_..., or a restricted rk_ key. Never in git.
   ```
4. Make the Connect webhook endpoint and its signing secret, in the container:
   ```
   STRIPE_SECRET_KEY=... node scripts/pay-setup.mjs /run/secrets/stripe-whsec
   ```
   It creates a Connect endpoint for `https://iscolinfree.com/theoffice/api/pay/webhook`, listening for every event in `WEBHOOK_EVENTS`, and writes the signing secret to the file you name with mode 600. It prints neither the key nor the secret. Stripe shows a secret only once, so running it a second time changes nothing unless you pass `--rotate`.
5. Put the secret from that file in `.env` too, and restart:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   Both settings are required. With a key but no webhook secret the building stays "being set up", because without webhooks a lapsed subscription would never lose access.
6. Check it: `curl -s https://<label>.middistance.com/_office/cloud/pay/status` answers `{"ready":false,"testMode":true,...}` until that floor's boss has connected, then `ready:true`.
7. A boss opens their floor's **Payments** tab and taps **Connect Stripe**. Test mode shows a banner to the boss, on Stripe's own pages, and in `office.pay.status()`.

Test mode: use Stripe's test cards, for example `4242 4242 4242 4242` with any future date and any CVC. To simulate a slow card use `stripe trigger` from the Stripe CLI against the endpoint or the mock.

**Going from test to live:** set the live key and make a new live webhook endpoint with `scripts/pay-setup.mjs` (each mode has its own secret). Every row carries `livemode`, so test accounts, products, orders and sales never count against live ones: bosses reconnect once in live mode and re-approve their products with one tap. A test purchase can never unlock anything once the keys are live.

## What a boss sees
A **Payments** tab on their floor, boss-only: connect, status, what Stripe still needs (in plain words), the products on sale, the last 30 days of sales, recent orders and a **Refund** button. Approvals sit in **Requests**, alongside domains and mail: one tap per product and price (a proposed price is shown on the approval card). The older pasted Payment Link still works on the project card.

## How a page uses it
```js
const s = await office.pay.status();                    // {ready, testMode, message, products: [{key, name, description, amountCents, currency, interval}]}
const r = await office.pay.checkout({ product: 'pro' }); // goes to Stripe's page; {ok: false, code, message} when it can't. returnPath is optional.
const yes = await office.pay.has('pro');                 // decided on the server
await office.pay.manage();                               // Stripe's Customer Portal for cancelling and updating
```
`office.pay` never throws: anything it can't do resolves to `{ok: false, code, message}` with a line the page can show. A purchase needs an Office Cloud account (guests are told to sign in). Back from Stripe, `has` works even before the webhook, because the server asks Stripe about the buyer's open order.
Server code in the building calls `payHas(db, floorId, project, ownerKey, productKey)` or `engine.pay.has(...)`.

**Paid data:** a product's `unlocks` is a list of Office Cloud collections. Every read and write on those collections answers `402 payment_required` to anyone who doesn't hold it, whatever the page claims. The gate outlives the product going off sale, so buyers keep what they paid for and the data doesn't open up.

## Safety
- **Keys:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are read in one place and go in one Authorization header or one HMAC. Never in a response, a browser, an app, a bot or a log (`hideKeys`, and `scrub` knows Stripe's formats). Stripe's error texts are logged scrubbed and never shown.
- **Bots:** the only tool is `propose_product` (manager only), and it can only put a proposal on the boss's Requests list. There is no bot tool to charge, change a price, refund, approve or read sales. Nothing reaches Stripe until the boss taps Approve; approval is a boss-only route with Stripe idempotency keys, so a double tap can't make two products. A re-proposal for an existing key is a price change and needs the same tap: Stripe prices never change, so a new one is created and the old one retired; existing subscribers keep theirs.
- **Webhooks:** `POST /theoffice/api/pay/webhook`. The signature is checked over the raw bytes with `whsec`, with a 5-minute tolerance both ways, before anything is parsed. Handled in one transaction with the event's id, so replays and Stripe's retries process once. Handlers read subscriptions fresh from Stripe rather than trusting the event's snapshot, because Stripe doesn't promise order. Events from the other mode or an unknown account are acknowledged and ignored. Events about the boss's other business on their account cost no API calls and are ignored.
- **Unlocks:** one-offs are live when `checkout.session.completed` has paid status, or when an async payment clears. Subscriptions follow Stripe's status: active, trialing and past_due keep access; canceled, unpaid and paused end it. A full refund or an open dispute ends access; a partial refund doesn't.
- **Isolation:** purchases and gates are per project, per account, per mode. Only the project's own origin can use the API, and the checkout `success_url` can only be on that origin.
- **Rate limits:** checkout creation per address, per account and per project; `has` per address (`CLOUD_RATES`).
- **Money display:** a company's sales go only to its boss, on their Payments tab. Never to visitors, the feed, speech bubbles, the tower or the ticker. The building's staff tools don't print sales figures.

## Refunds and receipts
Refunds are the boss's button, on the Payments tab or on their own Stripe dashboard (a refund made there is picked up by webhook). Refunding a subscription cancels it first, so a card can't be charged again after its refund.
Stripe sends the receipts. When the buyer's account has an email it is set on the Checkout Session and as `payment_intent_data.receipt_email`, and Stripe sends the receipt in live mode. For everyone else Stripe uses the email collected on Checkout, as long as "Successful payments" is on under Customer emails in the boss's Stripe settings; the panel says so.

## Disconnecting
```
node scripts/admin.mjs pay status <floor>       # the account as the building sees it, no sales figures
node scripts/admin.mjs pay disconnect <floor>   # stops new sales; webhooks still keep access correct
```
The Stripe account always remains the boss's own, and any subscriptions keep billing there until they cancel them in Stripe.

## Tests
`test/pay.test.js` runs the real provider code against the mock over real HTTP: signatures (valid, invalid, stale, replayed), idempotency, connect, checkout, unlock, lapse, refund, disputes, server-enforced paid data, project isolation, boss-only actions, bots refused, no-key mode, no key in any response, and both scripts.
`node test/browser/pay.mjs` runs the App starter in real Chrome: a boss connects and approves, a visitor buys on the mock's hosted Checkout and the feature unlocks on a desktop and on a phone, a refund takes it away, and a floor with no key says it's being set up.

## Not done
No payouts view (the boss's Stripe dashboard is the place for that), no coupons or tax handling beyond what the boss sets up in Stripe, no platform fee, and no guest checkout: a purchase needs an account so it can be restored on any device. A boss's connected account keeps its products and customers if they leave The Office.
