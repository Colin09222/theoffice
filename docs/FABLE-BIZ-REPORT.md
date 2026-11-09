# Branch `cloud/fable-biz`: a floor that can run a real business

Written 2026-11-09. Everything here was built and tested with `AI_MODE=mock`: no real model call, no real Stripe, no real email, no server
access. So this report separates three things: what changed, what the tests prove, and what only real builds can show.

## The short version

- **Selling is now a kind of job, and it can't end in "price coming soon".** A shop is a site with a catalogue (`shop.json`) on a new `shop`
  starter. The page, the launch checklist and the boss's approvals all read the same file. Publishing a shop asks the boss to approve its
  products by itself, so nothing depends on a bot remembering `propose_product`.
- **A customer can buy a basket as a guest, gets a confirmation, and the boss gets the order.** Stripe's hosted Checkout, an address for
  posted things, a thank-you with an order number, a confirmation email from the company, the order in the boss's inbox and on the Payments
  tab with what to send and where.
- **Before Stripe is connected the shop is still finished and honest.** Every product with its picture and price, a working basket, and
  an order request by email. The manager walks the boss through the two taps that are theirs.
- **Business mode ends in that shop**, tested by a Tester before it goes live, and Launch says where the .com, the company email and
  payments stand. Nothing buys a domain or approves a product for the boss.
- **`ask_colleague` is answered by the colleague's own model.** Banter and meetings stay on Haiku.
- **Cost:** cache fixes for the roles that run in the engine, and rounds that change nothing no longer cost anything. Estimates only.
- **One Fable 5.2 step:** a last look before a first publish, twice at most, never able to block for good.
- **Games:** see the section below.

## 1. Selling

### What changed

| Piece | Where | What it does |
|---|---|---|
| Shop starter | `server/app-client/starters/shop/` | Product grid from `shop.json`, basket, "Pay by card" through `office.pay.checkout({ items })`, thank-you from `office.pay.order()`, order request by email before payments are on, contact form. Says "proposed price" on a price the boss didn't give, and says when pictures are illustrations. |
| Basket checkout | `server/cloud/pay.js`, `sdk.js` | `checkout({ items: [{ product, quantity }] })`: one Stripe session, up to 20 lines, quantity 1 to 20. `office.pay.returned()` and `office.pay.order()` for the thank-you. |
| Guest buyers | `pay.js` | A basket, or one product that is posted, needs no account. Anything that renews or unlocks a collection still does, and can't ride in a basket. The single-product call apps use for a paid plan is unchanged. |
| Posted things | `pay.js`, `propose_product` | A product with `ships: true` makes Stripe's page collect the address. It is kept for the boss alone and never returned to a browser. |
| The catalogue is the proposal | `server/shop.js`, `engine.upsertProject` | Any publish of a project with a `shop.json` proposes every product not already on sale at that price. A changed price replaces the waiting proposal. |
| Approve all | `pay.js`, `public/js/pay-ui.js` | One tap of the boss's own for everything waiting. Boss-only route. Each product still gets its own Stripe idempotency key. |
| Checklist | `server/launch-check.js` | A shop won't publish with a product missing a price or picture, a placeholder name, the starter's examples, "coming soon" on a page, or no call to `office.pay.checkout`. |
| Buyer's confirmation | `pay.js` | An email from the company's own address with the order number, lines, total and address. Sent once per order. Says so when it was a test payment. |
| The sale reaches the boss | `pay.js`, `mail.js`, `pay-ui.js`, `floor-ui.js` | Company inbox ("New order 1A2B-3C4D", from the buyer's address), Payments tab with items, buyer, address and **Mark as sent**, and a toast on an open floor. The manager is told there was a sale, never the amount. |
| A shop lane | `server/prompts.js` | `SHOP` in the manager's playbook and a part for the Writer, Designer, Builder and Tester. The manager's Selling line says a wish to sell is a shop, never "coming soon", and spells out the boss's two taps. |
| Maker flow | `server/makers.js` | A Website job whose words are about selling starts on the shop starter. |

Money rules are unchanged. Bots can only propose; approval, refunds and prices are the boss's taps; no fee; card details never touch the
site. The one new boss power is Approve all, which is still their own click on a boss-only route.

### What the tests prove

- `test/shop.test.js` (18 tests, real provider code against the mock Stripe and mock mail over HTTP): the catalogue becomes proposals and
  nothing reaches Stripe before the boss taps; approve-all is boss-only; a guest's basket makes one session with every line and asks for
  the address on Stripe's page with no application fee; the order view never carries the address; the confirmation email goes once; the
  order reaches the inbox once even when the webhook is replayed; a visitor to the floor sees nothing of the sale; subscriptions and
  unlocks still need an account; the starter won't publish with its examples; the lane's prompts say what they must and nothing about
  hurry or money.
- `node test/browser/shop.mjs` (real Chrome, phone and desktop): before Stripe, every product shows with picture and price, the order
  request reaches the inbox, nothing says "coming soon". Then the boss connects through the hosted page and approves both with one tap;
  a stranger buys three things, lands on a thank-you with an order number, gets the email with the same number; the boss sees both
  orders with the address and marks one sent. All passed.
- `test/pay.test.js` still passes (61), with one expectation updated for the new `ships` field. `node test/browser/pay.mjs` passes.

### What they can't prove

- **That real bots build a good shop.** The mock staff write a fixed catalogue. Whether the Writer proposes sensible prices, the Designer
  makes good product pictures and the Builder restyles the starter well needs real builds.
- **Real Stripe.** The parameters follow Stripe's documented shapes (`line_items`, `shipping_address_collection`,
  `customer_details`, `collected_information.shipping_details`), but only the mock has answered them. The first test-card purchase on
  the real test key is the proof. If the address comes back empty, look at where the pinned API version puts `shipping_details`.
- **Email delivery.** The confirmation uses the same path as the welcome email. It needs the building's mail to be on; without it the
  buyer still gets the on-page confirmation, and the boss still gets the Payments tab.
- **The Tester can't finish a purchase.** Its computer can't reach Stripe's pages, so it checks that "Pay by card" returns a Stripe
  address. Nobody on the team ever enters a card.

## 2. The Business journey

### What changed (`server/business.js`, `config/business.json`)

- **Build makes a shop** where the building has payments: Researcher (rival prices), Writer (the offer, and one to three things to buy
  with proposed prices), Designer (look, and a picture for each), Builder (the shop), **Tester (as a customer)**, Builder (fixes, then
  live). Before this the Builder published with no Tester at all. Without payments in the building it is the old notify-me page.
- **Payments track:** "Checkout on the shop", then "Connect your Stripe" and "Approve the products", marked *yours to do*. They light the
  lamp for attention but never hold the journey up.
- **Launch kit:** from Build on, the manager's notes say whether the business has its own .com (and to offer two or three checked names,
  with prices, for the boss's Buy click), what the company's email address is, and whether the shop can take a card yet.
- A "company email address" item on the Website track.

### What the tests prove

`test/shop.test.js`, "Business mode ends in a shop": the six tasks in order, all on the shop lane, a Tester hired; the catalogue live;
the Payments items read *done / yours / yours*; the boss's connect and approve-all turn them; a stranger buys from the live shop; no
domain order exists that the boss didn't click. `test/business.test.js` (the older journey, no payments) and
`node test/browser/business.mjs` (18 of 18) still pass.

### What they can't prove

I could not walk the journey with real models, so I can't score it. The weak points I would watch on the first real run: whether the
Writer's "what can they buy on day one" is sensible for a service business; whether six tasks feel slow to a boss watching; and whether
the manager actually offers domain names at Launch rather than only mentioning them.

## 3. Games

The gentle opening is now measured, not hoped for.

### What changed

- **A browser rule, `pressure`** (`config/makers.json`, `server/playtest.js`): the playtest starts with a run that sends no input and
  times two things, the first hurt and game over. The bars: hurt within 30 s, lost within 60 s, and never lost in the first 10 s. Time
  counts only while in play and uses the game's own clock where the hook has one, so a slow test machine doesn't make a game look gentler.
  It shares the existing 60 s window, so a size takes about half a minute longer at most.
- **The loop goes by the numbers** (`server/makers.js`): the Tester's verdict carries `idle: {hurt, lose}`, `decide()` judges on those
  whatever box was ticked, and the Builder's fix list names them. The design doc now has to say what happens to a player who does nothing.
- **Both starters pass it.** Idle seconds before and after:

  | Starter | Before: first hurt / game over | After |
  |---|---|---|
  | game-2d | 29 to 39 / 32 to 43 | 11.5 to 12.4 / 21 to 29 |
  | game-3d | 31 to 33, or never / still alive at 60 s (one run at 150 s) | 12 to 13 / 22 to 27 |

  From 11 s a ring marks where the player stands and a strike lands 1.1 s later. Any movement dodges it.
- **Prompts** (`server/prompts.js`): the bar is named, the Builder times an idle run with its own script, the Tester reports the two numbers.
- **Cost:** a game's Builder now gets the playtest script on its own computer and runs it before handing over, so a failing browser rule
  is caught inside the build task instead of costing a Tester round, a fix pass and a re-test.
- **Bugs found on the way:** the playtest's "restart works" and "pause is reachable" waits were always true (a precedence slip), so those
  two rules were never really checked. They are now. The 3D starter's particles never showed. Both fixed.

### What the tests prove

`test/pressure.test.js` (28 tests) and `node test/browser/makers.mjs` at full length (56 of 56): the rule is measured on both starters at
both sizes, flows into the briefs, and `decide()` holds a game to it.

### What they can't prove

No real model has built a game against the rule or filled in the idle numbers. The Builder self-check saving rounds is an argument, not a
measurement. An idle player who keeps drawing heal upgrades lasts longer: the worst seen was 29 s, well inside the 60 s bar, but the
tail isn't bounded. And the frame-rate bar can't currently fail (the kit caps frame times at 50 ms, so fps never reads under 20 against
a bar of 18): left alone, because an honest reading needs a trial on a real Tester computer first.

## 4. `ask_colleague`

A work question now runs on the asked colleague's own entry in `config/models.json` (effort capped at high, the autonomous override
respected, their persona and recent work as a cached system block). Persona, notebook, meetings and banter stay on `tools.talk`. It is
one function with one extra route, not a second system. `test/people.test.js` proves the answer call is Opus at high while every other
talk call is Haiku at low, and that the ledger row is priced as Opus.

## 5. Cost

All figures are estimates from token prices. No real call was made.

| Change | Helps | Rough size |
|---|---|---|
| Pictures no longer rewrite earlier messages (which restarted the cache) | Designer, Manager | About $0.29 per avoided restart on a 60K-token conversation |
| A cache breakpoint on the system prompt | Every engine-side call | Cents per wake |
| Keep-alive while a long reply streams | Calls over four minutes | About $0.02 against $0.38 for a miss |
| Identical screenshots return the last design review | Builder, Designer | $0.10 a time, plus the steps around it |
| A maker test of unchanged files is replayed, not rerun | Maker jobs | One Tester session each time |
| The manager is told when a send-back changed nothing | Chat-lane jobs | One round each time |
| The ship check never pays twice for one version | First publishes | One Fable call each time |

Two honest limits. The Builder and Tester run in managed sessions, where caching is Anthropic's; for them the saving is fewer rounds, not
cheaper tokens, so the $31 Builder task is only helped by the review, test and send-back changes. And the new work adds cost in two
places: the ship check (two calls at most per project) and the Tester plus second Builder task in Business mode.

No model, effort or token limit was lowered. No prompt mentions cost, speed or steps (`test/buildwell.test.js` and the new tests check
the new text too).

**A risk that was already there:** `trimSteps` drops old steps but keeps later thinking blocks. On an Anthropic account created on or
after 2026-08-31, Opus 5.5 answers an edited history with a 400. If the building's account is older it only costs a cache restart. Worth
checking the account's age before a long job hits it.

## 6. The Fable 5.2 step

`server/shipcheck.js`, `tools.ship` in `config/models.json`. On a first publish of a site, app or game through `publish_project`, one
call is shown the boss's words, the Builder's brief, the Tester's report and screenshots and the page, and asked "would you ship this
today?". A no refuses the publish with up to five things to fix.

- Twice at most per project. A version already seen is never paid for again. After the second look, or a third try with nothing changed,
  it goes live and the manager is told what is left.
- No key, no room in the limits, a refusal or an unreadable answer all mean no opinion, and the publish goes on.
- Built for how Fable 5.2 differs from Opus (checked against the current API notes): thinking is never sent as disabled, no forced tool
  choice (it answers in JSON, read tolerantly), a refusal is handled as no opinion, the default server-side fallback is on, and it is
  priced at $8 / $40 in the ledger. It needs 30-day data retention on the account; without it the call fails and nothing is blocked.
- `SHIP_CHECK=0` switches it off.

`test/shipcheck.test.js` (8 tests) proves the plumbing. It can't prove the judgement is good or worth the price: that needs a few real
publishes, comparing what it flags with what the outside reviewers flag. If it mostly agrees with the Tester, switch it off.

## 7. Other things found

- `checkout` used to refuse a second purchase of anything. Posted things and baskets can now be bought again.
- The app starter and the maker config told apps to ship payments "as a coming-soon hook", against the house rule. Reworded.
- `modelShape` treated Fable like an older Opus (thinking off allowed, forced tool choice allowed). Both are a 400 on Fable 5.x. Fixed.

## Test results

- `AI_MODE=mock npm test` on the merged branch: see the last section.
- Browser, real Chrome: `shop.mjs` all passed; `business.mjs` 18 of 18; `pay.mjs` passed.
- One test fails in this container and on main alike: `test/domains.test.js` "the key only travels over TLS… over IPv4" needs IPv6
  (`listen EAFNOSUPPORT ::1`).
- Tests changed because the behaviour legitimately changed: `pay.test.js` (products carry `ships`), `lanes.test.js` (a fifth lane),
  `customise.test.js` (the outside reviewer is not company staff, so it doesn't carry the company's voice).

## What I'd do next

1. **Run one real shop build and one real test-card purchase** before the judged builds. Everything about real Stripe and real bots
   hangs on that.
2. **A shop playtest** in `server/playtest.js` (`--type shop`): add to basket, change a quantity, request an order, with done-rules in
   `config/makers.json`, and a fifth launcher button. Today a shop from the launcher runs under the Website rules.
3. **Delivery charges.** A price includes delivery, or delivery is its own product. A flat rate the boss approves once would be better.
4. **More than one delivery country**, and stock counts.
5. **Measure the ship check** against the reviewers for a week, then keep it or drop it.
6. **A session shared across maker passes**, the biggest remaining cost idea, left out because it is a large change with an uncertain
   trade-off.
