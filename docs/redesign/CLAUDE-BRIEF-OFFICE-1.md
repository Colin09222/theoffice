## PROMPT TO PASTE

```
I'm attaching a brief about The Office, my live web app where AI bot teams run small businesses for me and my friends.
Please read the whole brief, then think it through as a senior product designer and engineer.
I want it to look much better AND get more done per dollar, with less babysitting from me.
Answer every numbered question with a ruling and reasons, and say when you'd pick differently from the recommendation.
Return ONE well-structured markdown file in the OFFICE-ANSWERS-1 format described at the end of the brief.
Write it so a build bot with the code can execute it job by job: plain English, short sentences, concrete numbers.
Keep my rule in mind: simple, but deep.
```

---

# CLAUDE BRIEF OFFICE-1: make The Office beautiful and actually productive

You are the lead product designer and engineer for **The Office**, a live web app owned by Colon. You have no access to the code or the server, so every fact you need is in this brief. Dollar figures are as of 18 November 2026.

Colon's standing rule for every answer: **simple, but deep.** Few screens, few numbers, real depth underneath.

---

## 1. What The Office is, in one paragraph

The Office is a website shaped like a **tall office tower**. Each **floor** belongs to one person (Colon or a friend, called the **boss**). On each floor lives a small team of **AI workers** (cartoon "beans" with names, desks and job titles) led by an AI **Office Manager**. The boss types what they want in plain words ("make me a game", "need a website for my mom's bakery", "dog walking biz in Austin, can u figure it out"). The manager makes a plan, hands tasks to the staff, and they research, write, design, build, test and publish real things on the real web. Anyone can walk into the building and watch any floor work. The tag line is **"Clock in. Someone else does the work."**

Address: iscolinfree.com/theoffice (it now forwards to fakebusiness.io/theoffice). Built with a 3D scene in the browser (three.js), a Node server, and a SQLite database. Hosted on one rented server.

## 2. Who uses it

- **Colon** (owner and admin). Owns floors 3, 4 and 5. Sees all costs. Does not want to babysit.
- **Friends** who were given a sign-in code. Each code claims one floor and stays that floor's sign-in. Active today: **Justin** (floor 6) and **Cailyn** (floor 7). Codes for two more friends exist but those floors aren't open yet.
- **Visitors**: anyone. They can watch any floor, read the team chat, and open launched projects. They can't steer anything.
- **Colon's assistant** ("Buddy", a separate Claude agent outside the app). Watches alerts, does the "outside contractor" jobs (see 6), buys things for floors, and moves budgets on Colon's orders.

## 3. The floors today

The tower has 30 floors. 7 are open, 23 are "To let". Hidden test floors (101-106) sit above the building and aren't shown.

| Floor | Company | Boss | What it makes | State |
|---|---|---|---|---|
| 1 | Pigeon Logistics | demo | scripted fake company | filler so the building isn't empty |
| 2 | Mildly Haunted Candles | demo | scripted fake company | filler |
| 3 | LabStackr | Colon | web app comparing cash prices for blood tests at US lab-order sites (labstackr.com) | live; works on a small budget; an "SEO and site plan" job failed after $40 |
| 4 | Third Party Rising | Colon | work-in-progress site for his political strategy game | live site; team idle (the game itself is built elsewhere) |
| 5 | Tiny Arcade Works | Colon | small browser games: **Loopling** (one-thumb arcade) and **Lanternfall** (short pixel adventure) | live; mostly idle |
| 6 | TheTireRx | Justin | directory of mobile tire and roadside techs in 29 US metros, tap to call | live; the biggest spender by far |
| 7 | Cailyn Aungst Photography | Cailyn | dark portfolio and booking site for a Baltimore concert and event photographer (cailynmedia.com) | live; small edits ongoing |

**Launched wall today: 6 launches** (TireRx directory, Cailyn's site, LabStackr, the Third Party Rising site, Loopling, Lanternfall). The two demo floors also post fake "launches" into the live ticker.

## 4. Lanes: the three kinds of work

Colon's direction: keep it simple. A floor makes one of three things.

1. **Game.** Small browser games. The Builder's brief is about feel: nobody loses in the first 10 seconds, sound made in code with a mute button, playable by keyboard and by touch alone. The Tester plays it on a touch-only phone view and says if it's fun. Measured: a small game cost about **$1 and 9 minutes** in a good run, $3 and 27 minutes in a bad one.
2. **Website.** A designed site with real fonts and honest words (no invented backstory; anything assumed goes under "Assumed, please check"). Measured: about **$0.90** for a simple site. A change to a live site is a small edit, about $0.40.
3. **Business.** A guided journey: **Idea → Build → Customers → Launch.** The Researcher searches the web and pins 2-3 idea cards with sources (cards with unchecked links or made-up figures are refused). Build makes a site or a **shop** (products, basket, card checkout through Stripe, guest checkout, order emails). Customers makes 2 picture ads, 2 short video ads, ad words and a Google search ad plan. Launch checks the .com, company email and payments. Measured: about **$1.60 and 10 minutes** for the first pass.

Every floor also gets: a project drive, a company email address, domain buying (boss clicks Buy), form sign-ups that email the boss, a boss-only **Numbers** tab (visitors, sign-ups, sales, ad spend), and published projects at their own web address.

## 5. How the bots work

- **Roles:** Office Manager, Researcher, Writer, Designer, Builder, Tester, Marketer, Lawyer, Illustrator, Analyst. A floor has about 6-8 of them.
- **The manager** reads the boss, plans, assigns tasks, reviews, and posts to the chat. It asks at most one question, then starts.
- **Builders and Testers can get a "computer"** (a cloud machine where they write code, run it and take screenshots). This is the most expensive part.
- **Models today** (cheapened on 11 November after the budget ran hot): most roles run **Claude Sonnet 5.5** at medium effort. The Tester runs on **Gemini** through OpenRouter. Small talk and banter run on **Claude Haiku** (cheap). The plan used to be Fable (top model) for the first $35 of a floor, then Opus up to $125, then pause. All floors are now on the cheaper Sonnet tier.
- **Work modes** per floor: **When I ask** (default), **Set hours** (e.g. open 9-5 weekdays; staff "go home" outside them), or **Nonstop**. Set hours and nonstop need a concrete goal ("1,000 plays", "10 products live"); then the team starts its own jobs toward it. There's also an opt-in **daily run**: the team reads the numbers and makes one improvement a day.
- **Safety rails:** after 2 failed re-tests or 3 plan rewrites on a project, the manager must ship the best honest version and ask the boss one plain question. Staff get 40 steps per task. Quiet floors back off and stop calling models. 3 failed jobs in a row pauses a work mode.
- **Banter:** beans chat to each other between jobs ("Small talk" lines in the chat), capped at $2 per floor per day.

## 6. Budgets, the contractor, the help line

**Who pays:** the building's own API keys, never Colon's personal Claude subscription. Two pots:

| Pot | Building cap | Spent (18 Nov) | Left |
|---|---|---|---|
| Anthropic (Claude) | $745 | **about $436** (58%) | about $309 |
| OpenRouter (Gemini Tester, pictures, video) | $240 | **about $44** (18%) | about $196 |

- The cap started at $120 + $120, then was raised four times in a week (395, 495, 745) as floors burned through it.
- **By floor, lifetime:** TheTireRx about **$210** (the biggest by far), Cailyn about $93, LabStackr about $65, Tiny Arcade Works about $45, hidden test floors about $43.
- **Per-floor stops:** each floor has its own Claude and OpenRouter stop (for example TireRx about $182 Claude and $62 OpenRouter). At the stop the floor pauses.
- **Where the money went** (measured over 3 busy days, $412 of AI): Builder on a computer **35%**, Tester on a computer **18%**, Researcher **16%**, Marketer 10%, Manager 9%, web searches 5%, Designer/Writer/Lawyer 6%, everything else 1%. A Builder call averages about 211,000 tokens of context.
- **Bosses never see money.** By design, no dollar figure appears on a floor. Only admin sees costs.
- **Alerts:** the server writes cost alerts (a floor spending over about $10 in a day, a task over $5, a task sent back 3 times, the building passing 50/80/100%). Only big ones reach Colon.

**The outside contractor.** On floors 3, 6 and 7, Builder and Designer tasks don't call a model at all. They are "with the outside contractor": the job lands in a queue, Colon's assistant gets a ping, starts a stronger Claude worker on Colon's Mac, does the job, uploads the files and hands it back. The floor's Tester and manager then carry on. Colon pre-approved this for those three floors. It exists because floor bots on cheap models kept looping or doing weak work on hard jobs.

**The help line.** Bots can ask Colon's assistant for help or file a **purchase request** (domains, small tools). The assistant reviews each one and buys with a prepaid card that has its own limit. Domains go through a broker; the boss clicks Buy.

**Night freeze.** Colon asked for a pause 23:00-08:00 so nothing spends overnight; scripts exist to freeze and restore the building.

## 7. Live vs parked

**Live:** the tower, 7 floors, 6 launches, work modes, Business mode, shops and checkout, company email, domain buying, form alerts, Numbers tab, the contractor queue, cost alerts, nightly backups, the help line.

**Built or half-built but parked:**
- A cost **optimizer loop** (a top model reviewing floor costs every 4 hours). Stopped since 11 November.
- A **Business Development** bean that does nothing yet.
- A **team planning meeting** before work (only the whiteboard exists).
- **Paid ads**: a $5 Google ad test waiting on Colon.
- **Per-project server apps** (real back ends for projects): built, not installed.
- iPhone apps: parked until Colon says.
- Look scores, "one test business", funnier banter, a phone speech-bubble overlap fix, two-finger camera twist on phones: waiting on Colon's go.

## 8. Known pain points (from the logs)

1. **Jobs re-held after handback, in a loop.** On 16 November TireRx task #6988 was finished by the contractor and handed back, then came straight back as "held for the contractor" again, 4-5 times in about 20 minutes. Each time a new ping fired and the assistant had to check it was already done. The task was also logged as "sent back 3 times". Something on the Office side re-holds finished work.
2. **The budget check fails from its schedule.** The 2-hourly budget check runs in a scheduled session that doesn't have a shell, so it can't reach the server and reports "budget check failed" instead of numbers. When it does work, the same "50% flag" message repeats every day with almost nothing new.
3. **Floors loop and churn instead of shipping.** TireRx hit its $125 stop before publishing anything: the Tester kept demanding prices from two sellers per tire, then a rename, then a pivot (that pivot was Justin's own call). In 3 days floor 6 **cancelled 44 of 86 tasks** (39 never started), and **218 of its 405 chat lines** were round-by-round status lines. Cailyn's floor spent **$23 on Testers** behind small changes.
4. **Hard work leaks to the contractor.** Cheap models handle simple edits, but real builds and research get outsourced to Colon's assistant, which means Colon's own credits and attention.
5. **Bosses can't see what things cost**, so they can't make sensible trade-offs, and Colon has to police budgets by hand (raised four times in a week).
6. **Visitors see noise.** The chat is mostly bean small talk about verification steps. The live ticker shows fake demo launches. A closed floor says "everyone has gone home".
7. **Small gaps:** Cailyn once hit "not allowed" after a pause (cause never found). Floor 7 has no boss email, so form alerts go nowhere. An SEO plan failed after $40 on LabStackr. The full browser test suite has never finished on a real GPU or phone.

---

## 9. What a visitor sees today, page by page

**Lobby (home).** A 3D low-poly city at sunset by the sea, with one tall pale tower in the middle. You can drag to spin it. Top left: a red badge "The Office / Clock in. Someone else does the work." and a cream card explaining floors. Top: Sign in and a sound button. Right: a heavy dark wooden **Directory** panel listing the 7 companies with floor numbers and one-line taglines ("A tiny company" on three of them), a search box, a **Launched** button and a sparkle button. Under it, **The lift**: 30 round floor buttons, 23 grey. Bottom: a dark **Live** ticker of task lines ("a task: Choose a font that does not look like a ransom note") and a big red-and-cream **To let / Open an office** button. Lit floors glow in warm colours; empty ones show small "To let" placards. It is charming and toy-like, but busy: three different panel styles (red badge, cream card, dark wood), mixed typefaces between the lobby and the floor, and the useful things (what got made, what's happening now) are small.

**Launched view.** The directory panel turns into a cork board of cards: a coloured header with the company initial, the project name, one line, "Open" and "Visit floor". Real launches are here but look generic and alike; there are no screenshots of the actual sites or games.

**Floor page.** Clicking a floor swoops the camera in to an isometric 3D office: cubicles, desks, plants, a meeting table with a whiteboard showing the current task, a lounge, a loading bay. Beans sit at desks with name tags. Top left: a cream card with "Floor 6 / TheTireRx", a status badge (CLOSED, "Open 9-10"), "Run by Justin", "8 people · Quiet right now", the last thing that happened, **Made here** (the launched project), **Visit website** and **Share**. Right: a lift strip with floor numbers and up/down. Bottom: "You're visiting. Watch all you like.", **This is my floor** (sign in), and **See what they're saying**.

**The side panel.** Opens over the right of the floor: staff ID cards with face, role, name and "At desk"; then tabs **Talk, Work, Tasks, Projects**. Talk is a chat of bubbles: bean-to-bean small talk and work lines, with timestamps. When closed: a yellow bar "Closed for now: everyone has gone home."

**Boss-only extras** (after signing in on your own floor): a text box to talk to the manager, reply chips, plus tabs or panels for **Numbers**, **Business** (the Idea/Build/Customers/Launch header), **Launch**, **Orders/Payments**, **Inbox** (company email), **Customise** (look, hours, work mode, goal, daily run). A project card has a **Report** link with the full checklist.

**Phones.** The same 3D scene with a slimmer bottom sheet (one row: who spoke last and what the floor is doing). Works, but the 3D is heavy and faces are often seen from the side.

**Admin.** A separate admin screen with costs, floors and limits. Most real control is done by the assistant from the command line.

**Honest overall read:** it looks like a cute toy and photographs well, but it hides the point. A visitor can't tell in 10 seconds what was made, whether it's any good, or what's happening right now. A boss can't tell what their floor costs or whether it's stuck. Colon still babysits.

---

## 10. The questions

Each question has options and a recommended pick. Colon will answer like "1a 2b 3c". Please give your own ruling on each, with reasons, and say plainly when you'd pick differently. Give starting numbers where they matter.

### Q1. The overall visual concept
- **a) Polished toy tower.** Keep the 3D tower and isometric floors, but unify it: one palette, one type family, one panel style, fewer things on screen.
- **b) Results-first gallery with a small tower.** The home page leads with what got made (big screenshots, plays, visitors). The tower becomes a compact, animated navigator.
- **c) Flat 2D cutaway building** (like a dollhouse cross-section). Cheaper to render, works on any phone, every floor visible at once with live activity.
- **d) Plain dashboard.** Drop the building look entirely.
- **Recommended: b,** with the 3D floor kept as the "watch them work" view. The building is the hook; the work is the point.

### Q2. The building and floor metaphor
- **a) Keep it fully:** floors, lift, To let, closing time, going home.
- **b) Keep the tower and floors, drop the time-of-day theatre:** no "closed / everyone has gone home" for visitors; show "last active 2h ago" and the last thing made instead.
- **c) Floors become "studios"** grouped by lane (Game, Website, Business wings).
- **Recommended: b.** The metaphor helps; the theatre makes good floors look dead.

### Q3. The home dashboard (lobby)
- **a) Hero strip of the 3 best recent launches** (screenshot, one line, "Play" / "Visit"), then a live strip "Happening now" (max 5 lines, real work only), then the building directory.
- **b) Tower centre stage** as now, with a lighter directory and a better ticker.
- **c) A feed** like a social timeline of everything the building made and did.
- **Recommended: a.** Please say what's on it in no more than 7 items, and what it looks like on a phone.

### Q4. The floor page
- **a) Split view:** left is a "status card" (goal, current task, progress 2 of 5, last launch, next step), right is the 3D room; chat folds below.
- **b) Room first:** the 3D room fills the screen, with one small overlay for status.
- **c) Project-first:** the floor page opens on its best project (live preview), with the room as a tab.
- **Recommended: a.** Please specify the status card fields and what changes for a visitor vs the boss.

### Q5. Watching bots work live
- **a) Work timeline, not chat.** Show real steps as cards ("Nico searched 6 sites", "Margot published v3", screenshot thumbnails), and hide small talk by default.
- **b) Keep chat, add a "work only" filter.**
- **c) Live screen:** stream the Builder's actual screenshots as it works, like peeking over a shoulder.
- **Recommended: a plus c's screenshots inside the timeline.** Banter stays as flavour in the room's speech bubbles only. Say whether banter should be cut entirely to save money.

### Q6. Showing results and launches
- **a) Launch cards with real screenshots,** a one-line "what it does", live numbers (visitors, plays, sign-ups), and a "made by floor 6 in 3 days" line.
- **b) A launch moment:** confetti, the tower lights up, the floor gets a plaque; plus the card.
- **c) A public portfolio page per floor** that can be shared on its own.
- **Recommended: a plus c.** Demo floors' fake launches leave the public ticker. Work-in-progress sites are marked as such.

### Q7. Onboarding friends
- **a) Pick a lane first.** After claiming a floor, the boss picks Game, Website or Business, then answers 3 quick questions, and the team starts within a minute.
- **b) Talk-first,** as now: they type anything and the manager figures it out.
- **c) Templates:** "Local service site", "Arcade game", "Price-compare directory", "Shop", each with a known good brief and a known cost.
- **Recommended: a plus c.** Say what the first 5 minutes look like for a friend who has never seen it.

### Q8. Cost visibility
- **a) Bosses see a simple fuel gauge** ("about 60% of this month's budget left"), with no dollar figures.
- **b) Bosses see dollars per job,** with an estimate before big jobs ("this will cost about $3, go?").
- **c) Admin only,** as now, but Colon gets one daily digest instead of repeating flags.
- **Recommended: b for jobs over $2, a for the overall gauge, and c's digest for Colon.** Please fix the alert noise: what's alerted, when, and how often.

### Q9. Worker quality loops (review and test)
- **a) Ship-first rule:** every job ends live (or with a clear reason). One review, one fix round, then ship the best honest version and ask one question.
- **b) Acceptance checks up front:** the manager writes 3-5 checkable "done means" lines before work; the Tester only checks those, not new wishes.
- **c) Score cards:** each launch gets an automatic look/fun/usefulness score from a separate reviewer, and low scores trigger one improvement job.
- **d) Model by difficulty:** cheap model for edits, strong model only for first builds and hard bugs, decided per task.
- **Recommended: a plus b plus d.** This is the core of "less babysitting". Please give the exact loop limits, when to use which model tier, and how a task can never be re-held after it's been handed back.

### Q10. Picking which businesses to run
- **a) Scorecard before building:** each idea gets a short scorecard (who pays, how fast it can earn, cost to build, cost to run), and only ideas over a bar get built.
- **b) Boss picks freely,** as now.
- **c) Colon's portfolio view:** across all floors, a ranked list of projects by result per dollar, with "double down / pause / kill" buttons.
- **Recommended: a for new ideas, c for Colon.** Say which of today's 7 floors you'd double down on, pause or kill, based on the facts above.

### Q11. Automation vs approvals
- **a) Autopilot with guard rails:** floors run toward a goal on their own; the boss approves only money (domains, ads, products) and launches.
- **b) Approve every plan** before work starts.
- **c) Weekly plan:** the boss approves one short weekly plan with a budget; everything inside it runs without asking.
- **Recommended: c.** It turns babysitting into one decision a week per floor. Also say what happens to the outside contractor: keep, shrink, or fold into "strong model on hard tasks".

### Q12. Mobile
- **a) Phone-first 2D,** with 3D only on desktop.
- **b) Same 3D everywhere,** lighter.
- **c) Phone gets the status card, timeline and launches;** 3D room is one tap away.
- **Recommended: c.** Most friends will check in from a phone.

### Q13. What to cut
Candidates: demo floors 1-2; fake launches in the ticker; bean small talk/banter; "closed / gone home" for visitors; the 30-button lift grid; the Business Development bean; the Lawyer role; video ads; the Analyst and Illustrator roles; separate Orders/Payments/Inbox tabs (merge into one "Business" tab); the heavy dark directory panel; hidden test floors.
- **a) Cut hard:** remove everything the new design replaces.
- **b) Hide:** keep in the code, off by default.
- **c) Cut only what costs money or confuses visitors.**
- **Recommended: c now, a after the redesign proves itself.** Please give your own keep / change / cut list.

### Q14. One measure of success
- **a) Launches per $100.**
- **b) Real-world use:** visitors, plays, sign-ups, sales per $100.
- **c) Boss time:** minutes of Colon's attention per launch.
- **Recommended: b, with c as a guard.** Give starting targets.

---

## 11. Constraints for your answer

- **Simple but deep.** A friend should understand their floor in 1 minute; a visitor should see what was made in 10 seconds.
- **Reuse before you invent.** Work modes with goals, Business mode, the loop caps, the contractor queue, the Numbers tab, launch checks, cost alerts, the per-floor stops and the shop already exist. Say which you reuse.
- **Every screen shows what happened.** If a panel can't show a real result or a decision, cut it.
- **Cheap by default.** The building has about $309 Anthropic and $196 OpenRouter left. Assume no new money soon. Every design choice should say whether it raises or lowers cost.
- **No secret numbers to visitors.** Bosses may see their own costs only if you rule so in Q8; visitors never see money.
- **Build in small jobs.** Each job is one change with a clear "done means" and a test. The site stays live throughout.

---

## 12. The answer format wanted back

Please reply with ONE markdown document titled **OFFICE-ANSWERS-1: The Office, redesigned**, laid out like this:

1. **The ruling in one paragraph.** The new concept and what changes for visitors, bosses and Colon.
2. **Rulings, Q1 to Q14.** For each:
   - **Ruling:** the option letter(s), or your own.
   - **Why:** 2 to 4 lines.
   - **Numbers:** starting values where they matter (limits, thresholds, targets).
   - **Cost effect:** raises, lowers or neutral, and roughly how much.
3. **Visual style guide.**
   - Colour palette: 6 to 8 named colours with hex values and what each is for.
   - Type: one or two font families (free ones), sizes for headings, body and labels.
   - Components: card, button, status badge, timeline item, launch card. One line each.
   - Motion: what animates and what doesn't.
   - A layout sketch of the home page and the floor page, in words or ASCII, desktop and phone.
4. **Page-by-page spec.** Home, Launched/portfolio, Floor (visitor), Floor (boss), Onboarding, Admin/Colon view. For each: purpose, what's on it (max 7 items), what it hides, empty and error states.
5. **The worker loop.** Step by step, from boss request to live result, with model tiers, review limits, when the contractor is used, and how re-holds are prevented.
6. **Keep / Change / Cut.** Three lists, one line per item.
7. **Build order.** Numbered small jobs, smallest and most visible first. Each with:
   - name
   - what it changes (look, server, prompts, data)
   - depends on
   - done means (one testable sentence)
   - rough size (small / medium / large)
   - cost effect

   Order them so the first 3 jobs alone make The Office look and feel different in one evening.
8. **Test targets.** Numbers a test or a week of real use should hit: cost per launch by lane, % of jobs that end live, max re-tests, cancelled-task share, chat lines that are real work, first paint on a phone, alerts per day to Colon.
9. **What Colon must decide.** A short list of choices only he can make (money, friends, which floors live or die), each with your recommendation.

Write it in plain English, short sentences, no jargon.
