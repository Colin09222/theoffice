# Payments

Checkout inside the apps the teams make: real payments through Stripe Connect, with the money going straight to each company's boss.
Each boss connects their own Stripe account through Stripe's hosted onboarding. They are the seller; the money is theirs and tax, refunds and disputes are theirs to handle.
The platform takes **no fee and no application fee**. Stripe-hosted Checkout only: card details never touch this server, the app or the bots.

The code: `server/cloud/pay.js` (everything but the HTTP client), `server/cloud/pay-provider.js` (Stripe's REST API and webhook signatures, `createStripe`), `server/cloud/pay-mock.js` (a Stripe stand-in for tests),
`server/cloud/pay-schema.js`, `server/cloud/pay-config.js`, `public/js/pay-ui.js`, and `office.pay` in `server/app-client/sdk.js`. Built to docs.stripe.com, pinned to API version `2026-10-28.endive`.

## Going live
Until there is a key the floors show "Payments are being set up" and `office.pay` answers not-ready. There is no switch to flip in the code.

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
   Optional: `STRIPE_ACCOUNT_COUNTRY=us` (two letters, defaults to `us`). Stripe now makes connected accounts only through Accounts v2 (`POST /v2/core/accounts`) and wants the country before the boss sees its form, so every new account is made in this country.
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

## Shops: a basket, a guest buyer, an address, a confirmation
A shop is the `shop` starter (`server/app-client/starters/shop/`) with a catalogue, `shop.json`: each product's key, name, description, price, `priceFrom` (`boss` or `proposed`), picture, and `ships`.
```js
await office.pay.checkout({ items: [{ product: 'lavender', quantity: 2 }, { product: 'cedar', quantity: 1 }] });  // one Stripe session, every line
office.pay.returned();                 // 'success' | 'cancelled' | ''
const o = await office.pay.order();    // {ok, number, paid, items, totalCents, currency, emailed, testMode}
```
- **The catalogue is the proposal.** When a project with a `shop.json` is published (`engine.upsertProject` calls `engine.shopPublished`, `server/shop.js`), every product in it that isn't already on sale at that price is proposed to the boss exactly as `propose_product` would. A team can't ship a shop and forget to ask. A changed price replaces the waiting proposal for that key. Nothing reaches Stripe until the boss taps; **Approve all** on the Requests tab is one tap of the boss's own for everything waiting (`POST /api/floors/:slug/pay/products/approve-all`, boss only).
- **The checklist holds a shop to it.** `checkCatalogue` in `server/launch-check.js` refuses to publish a shop with a product that has no price, no picture, a placeholder name, the starter's example products, a page that says "coming soon", or no call to `office.pay.checkout`.
- **Before payments are on** the shop is still whole: every product with its picture and price (a price the boss didn't give is labelled "proposed price"), a basket, and an order request by email (`office.forms.submit('order-enquiry', ...)`) that lands in the boss's inbox. It says plainly that it can't take cards yet.
- **Guests can buy a basket.** A basket, or a single product that `ships`, needs no account: the order belongs to the visitor's browser. Anything that renews or unlocks a collection still needs an account and can't ride in a basket. The single-product call for an app's paid plan is unchanged: account only, bought once.
- **Things that are posted.** A product proposed with `ships: true` makes Checkout collect the delivery address (`shipping_address_collection`, the connected account's country). The address is stored on the order for the boss alone and is never returned to a browser.
- **The buyer's confirmation.** Back on the site, `office.pay.order()` reads the order just placed (by the token in the return address, or the visitor's own latest order) and the starter shows its number, lines and total. The buyer is also emailed a confirmation from the company's own address (`engine.mail.send`, `by: 'app'`: a fixed text to the address they gave Stripe). In test mode both say no money moved. Stripe's own receipt is separate and only goes out on live payments.
- **The sale reaches the boss.** Each paid order is told once (`pay_orders.told`), whichever of the webhook and the buyer's return got there first: it lands in the company inbox ("New order 1A2B-3C4D", from the buyer's address so a reply reaches them), shows on the Payments tab with what was bought, who by and where to send it, with **Mark as sent**, and an open floor gets a toast. The manager gets a note that there was a sale, with no amount in it.

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
`test/shop.test.js` covers the shop: the catalogue as the proposal, approve-all, a guest's basket with an address, the order view, the confirmation email, the order reaching the boss once, and Business mode ending in a live shop. `node test/browser/shop.mjs` runs the shop starter in real Chrome on a phone and a desktop, before and after the boss connects.
`test/pay.test.js` runs the real provider code against the mock over real HTTP: signatures (valid, invalid, stale, replayed), idempotency, connect, checkout, unlock, lapse, refund, disputes, server-enforced paid data, project isolation, boss-only actions, bots refused, no-key mode, no key in any response, and both scripts.
`node test/browser/pay.mjs` runs the App starter in real Chrome: a boss connects and approves, a visitor buys on the mock's hosted Checkout and the feature unlocks on a desktop and on a phone, a refund takes it away, and a floor with no key says it's being set up.

## Not done
No payouts view (the boss's Stripe dashboard is the place for that), no coupons or tax handling beyond what the boss sets up in Stripe, no platform fee, no delivery charge of its own (a price includes delivery, or delivery is its own product), one country for delivery addresses (the connected account's), and no stock counts. A paid plan or unlock still needs an account so it can be restored on any device; a shop's basket doesn't. A boss's connected account keeps its products and customers if they leave The Office.
