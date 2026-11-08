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
  - Payments says honestly that there is no Stripe here, and uses a notify-me sign-up instead.
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

**Money.** No figure is shown on a floor except the boss's own choice of ad money on their own slip. Visitors see the steps, the
lamps and the launched ads, never an amount.

## Status (2026-11-07, 22:35 ET)

- Branch `business` in `repos/theoffice-business`, pushed. Not deployed: nothing goes live until Colon says so.
- **Tests:**
  - `test/business.test.js` and `test/googleads.test.js`: 30 of 30 pass, against the mocked Google Ads API.
  - Related suites (unit, budget, domains, launch, routing, review, modes, orders, anthropic): 283 of 283 pass.
- **Browser check** (`node test/browser/business.mjs`, real server in mock mode): 8 of 9 pass, desktop and phone. The run covers the
  idea cards, chips, tracks, ads, Google plan, switch plates, approval leading to a running campaign, the visitor view and no page
  errors. The build-step live-preview check fails in mock mode: the mock builder saves and publishes the page within a fraction of a
  second, so the journey is in Customers before the floor sees the page. The preview now asks again every 3 s while it is on screen,
  for real builds that save long before a lamp changes.
- **Real API:** validate-only requests (which create nothing) passed for the whole campaign as built. From hz, the token refreshes and
  the account reads as America/New_York, USD.
- **Open:** the real $5 test with Colon; scheduling the watchdog (see the Lanternfall note in ADS.md); switching `ADS_PAID_ENABLED` on
  after that test.
