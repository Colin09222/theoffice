# Business mode

A guided Idea → Build → Customers → Launch journey for one floor. It is off until the boss taps **Start a business** on their floor, or
tells the manager "find me a business idea and build it". The work itself is ordinary tasks for the ordinary staff, through the usual
engine, tools and ledger. `server/business.js` only keeps the journey's place, hands out each step's tasks, reads where they stand, and
tells the manager what changed. Steps, tracks, chips, ad amounts and the video model are in `config/business.json`. Paid ads are
described in [ADS.md](ADS.md).

## The journey

- **Header and chips.** The floor shows a four-step header (Idea, Build, Customers, Launch) with progress. Each step ends with 2–4
  tap-to-send chips, and the boss can ask the manager anything at any point.
- **1. Idea.** The researcher searches and reads the web, and the research desk shows the work: searches, pages read, markets checked,
  ideas compared. It pins up 2–3 idea cards with who pays, their problem, what you sell, why now, and 2–4 evidence links.
  `checkIdeas` refuses a card in three cases:
  - a link nobody on the floor opened or found;
  - a figure not quoted from one of the card's own links;
  - a revenue range without stated, sourced assumptions.

  The boss taps a card, or asks for more.
- **2. Build.** Four department tracks, each with a lamp, a count and a done state: Website, Product, Payments and Analytics.
  - There is a live preview of the page as it is saved.
  - The domain comes through the existing broker: a .com first, then the boss's Buy click.
  - **Where the building has payments** (a Stripe key and app origins), the build is a shop on the shop starter ([PAYMENTS.md](PAYMENTS.md), "Shops"): the
    Researcher checks rival prices, the Writer decides the one to three things a customer can buy on day one with proposed prices, the Designer
    picks the look and draws a picture for each, the Builder builds it, a Tester goes through it as a customer, and the Builder fixes what was
    found and puts it live. Publishing asks the boss to approve the products. The Payments track shows "Checkout on the shop", then two items
    marked **yours to do**: connect your Stripe, approve the products. Those never hold the journey up; the shop takes order requests by email
    until they are done, and says so.
  - Without payments in the building, it is the older page: Payments says honestly that it can't take cards, and uses a notify-me sign-up.
- **3. Customers.** The marketer makes:
  - 2 picture ads;
  - 2 vertical video ads of 6–10 s with captions (`google/gemini-omni-1.2-flash` on OpenRouter's `/videos` jobs, through the image key
    and the ledger; the model always makes sound, so the request asks for it. A job that fails at the provider gets one go on
    `google/gemini-omni-1.1-flash`, and past both it falls back to a screen recording of the real site made on the Builder's computer).
    On 2026-11-07, three 1.2 jobs failed upstream ("Video generation failed"; its provider had about 61% uptime that day), and a 3 s 360p
    clip from 1.1 came back in 19 s for $0.10 and went on the ledger;
  - the ad words;
  - a campaign plan (goal, who, where, an A-versus-B test). Where is always Google Search: paid ads run there only, for now;
  - the Google search ad: 3–15 headlines, 2–4 descriptions and 3–10 keywords.

  The picture and video ads are still made, for sharing. The boss then picks the ad money: $0 "just for fun" (the default), or $5, $10
  or $25 when paid ads are on.
- **4. Launch.**
  - With $0, the ads go up on the floor and on the live site to share, plus the launch report.
  - With an amount, the manager files an AD SPEND request for the boss's one-click approval. It then runs as a Google search ad
    ([ADS.md](ADS.md)).
- **Where paid ads run: Google only, for now.** In the Customers and Launch steps a switch plate shows Google Search ads, lit, with
  "Facebook & Instagram ads: coming soon" taped over beside it. That one is a disabled button, read out in exactly those words. While paid
  ads are off, the Google plate is taped "coming soon" too, and during a building-wide stop it reads "off for now". The manager's notes say the
  same, so a boss who asks about Instagram hears that it isn't here yet.

- **Launching for real.** At Launch, and in the manager's notes from Build on, the journey says where three things stand (`launchKit` in
  `server/business.js`): a name of its own (the manager checks two or three .com names and offers them with their prices; only the boss's Buy
  click buys one, and a bought name gets the site and the company's email on it by itself), the company's email address, and whether the shop
  can take a card yet. Nothing in the journey buys a domain, approves a product or connects Stripe for the boss.

**Money.** No figure is shown on a floor except the boss's own choice of ad money on their own slip. Visitors see the steps, the
lamps and the launched ads, never an amount.

## Status (2026-11-07, 23:00 ET)

- Branch `business` in `repos/theoffice-business`, pushed, with origin/stack and origin/stack-hotfix merged in. Not deployed: nothing
  goes live until Colon says so.
- **Google only, for now** (Colon's decision): as described above, and checked in a real browser at both steps.
- **Tests:**
  - `test/business.test.js` and `test/googleads.test.js`: 30 of 30 pass, against the mocked Google Ads API.
  - With the related suites (no-budget-word, statics, security, unit, budget, domains, launch, routing, review, modes, orders,
    anthropic): 402 of 402 pass.
- **Browser check** (`node test/browser/business.mjs`, real server in mock mode): 9 of 9 pass, desktop and phone. The run covers:
  - the idea cards, chips and tracks;
  - the live preview. The test holds the journey at Build, because a mock build is over before the floor could show it;
  - the ads, the Google plan, and the switch plates at Customers and at Launch;
  - approval leading to a running campaign;
  - the visitor view, and no page errors.
- **Real API:** validate-only requests (which create nothing) passed for the whole campaign as built. From hz, the token refreshes and
  the account reads as America/New_York, USD.
- **Open:** the real $5 test with Colon; scheduling the watchdog (see the Lanternfall note in ADS.md); switching `ADS_PAID_ENABLED` on
  after that test.
