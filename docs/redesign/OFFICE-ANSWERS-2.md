# OFFICE-ANSWERS-2: impressive, useful, and buddehbot on the floor

Written 19 November 2026 from CLAUDE BRIEF OFFICE-2. Builds on OFFICE-ANSWERS-1. No budget rules are used anywhere.

**Three notes before the rulings.**
- **Screenshots.** Only the brief reached me, not the three image files. I worked from the brief's section 3 description. If the images show something section 3 does not say, tell me and I will adjust.
- **"Start at"** means my starting value. Tune it after a week.
- **"Check"** means the build bot must confirm it in the code first. Record and field names in section 3 are my guesses at what exists.

---

## 1. The ruling in one paragraph

**Calm when quiet, vivid when real.** The building shows three true signals: **work** (what the bots are doing), **use** (real people visiting what was made) and **time** (the real New York clock). An idle floor stops pretending: nobody types, the team drifts to the lounge and the kettle, and the walls fill with framed launches. When something real happens, the room reacts: true poses, a paper carried, a cheer, a window flash on the tower. For the long quiet hours, visitors get a **Replay** of the last real job, clearly labelled as a replay. The bots do more useful work through weekly upkeep, one numbers-led proposal a week, a launch checklist and a "did it work" check after every change. **buddehbot** becomes a small boxy robot in a basement mailroom. It is a display only. It reads the help, purchase and contractor records that already exist and shows them as folders, a tray and stamps. It adds no new way for a bot to reach buddehbot, and floor work stays on The Office's own keys.

---

## 2. Rulings, Q1 to Q24

### Part A: visually impressive

**Q1. First-load wow**
- **Ruling: b + a, plus a cheap slice of c.** I differ in two places.
- **Why:** The live tower is right, but work alone is too rare to light it. Real visits happen all day, so they become a second light signal. The slice of c is for phones, where today nothing on the first screen moves.
- **Numbers:**
  - Room light on a floor = work. Brighter and flickering while a job runs. One flash on a launch (0.8 s).
  - A small sign light on each floor = visits in the last 24 hours. 4 levels: 0, 1 to 50, 51 to 200, over 200.
  - Fly-in: 2.5 s, first visit only, desktop only, starts when the tower is ready, any input skips it. It never delays the page content.
  - Hero cards: crossfade between up to 3 real screenshots, 4 s each, 0.6 s fade. Only the card in view animates.
  - Phone home: a pulsing dot on the badge of any floor that is Working. No 3D.
- **Changes:** V + Sv (small activity feed).
- **Spend:** none.

**Q2. Light, time and weather**
- **Ruling: a + one seasonal set.** Agree on a. I would build only the December set for now.
- **Why:** Real time is truthful and free. It makes the night freeze visible. Seasonal sets are nice but each is a job; prove one first.
- **Numbers:**
  - New York time for everyone. Sunrise and sunset are worked out from the date by formula. No data feed.
  - 4 looks: dawn, day, golden hour (last 60 minutes before sunset), night. Blend over 20 minutes. Update once a minute.
  - 23:00 to 08:00: room lights and desk lamps off on every floor. The crown sign, the billboard, street lights and the visit sign lights stay on.
  - December set: 1 to 31 December. Snow on the roof, a tree in the lobby.
- **Changes:** V.
- **Spend:** none.

**Q3. Camera**
- **Ruling: b on desktop, a on phones.** Agree, with limits.
- **Why:** Following real events points the visitor at the good moment. Without limits it would fight the user.
- **Numbers:**
  - Follow: 1.2 s ease in, 3 s hold, 1.2 s back. At most once every 20 s.
  - Any drag turns Follow off. A small **Follow the work** switch turns it back on.
  - Idle drift: starts after 8 s without input. 2 degrees a second, swinging 15 degrees each way.
  - Reduce motion: no follow, no drift, no fly-in.
- **Changes:** V.
- **Spend:** none.

**Q4. Bean animations**
- **Ruling: b + c, plus 4 idle moves from a.** I differ: the idle moves matter most.
- **Why:** Most floors are idle for days. What a visitor mostly sees is the idle state, so it must look lived-in and be true.
- **Numbers:**
  - **Idle rule:** on an Idle floor, no bean types and no monitor glows. Beans sit in the lounge, stand at the kettle, read, or stretch. 4 moves, each 4 to 8 s, one bean moving every 10 to 20 s.
  - State-true poses: building (fast typing, monitor glow), researching (papers spread), testing (clipboard), waiting on boss (glance at the boss door every 15 s).
  - Result beats: cheer on launch (2 s), high-five on a passed check (1.5 s), slump on a failed check (1.5 s). Real task events only.
- **Changes:** V.
- **Spend:** none.

**Q5. Props that show real progress**
- **Ruling: a + b + c + d.** I would do d now, as milestones (see Q15).
- **Why:** Each prop is a real number you can see. Frames and trophies stay on the wall when the floor is quiet, which is exactly when the room needs them.
- **Numbers:**
  - Frames: one per real launch, newest first, max 8 on the wall, then a "+N" tag.
  - Whiteboard: the current plan, up to 5 jobs, one tick per job done.
  - Paper piles: one sheet per queued job, max 5 sheets. An empty queue means an empty tray.
  - Trophies: first launch, 100 visits, 1,000 visits, 10,000 visits. Max 4 on the shelf.
- **Changes:** V + Sv.
- **Spend:** none.

**Q6. Lobby showpiece**
- **Ruling: a now. b later. Skip c.**
- **Why:** The billboard puts real work on the building itself. The ticker band would repeat "Happening now", which still has the repeat bug. The lit crown is folded into Friday (Q16).
- **Numbers:** 3 launches, 6 s each, 0.6 s fade, one 512 by 320 image each. Build b only after the repeat bug is fixed, and feed it from the same list.
- **Changes:** V.
- **Spend:** none.

**Q7. Sound**
- **Ruling: a + b.** Agree.
- **Why:** Sound on by default surprises people. Event sounds reward the real moments.
- **Numbers:** Off by default. The choice is remembered. Room tone at 15% volume, event sounds at 40%. At most one event sound every 2 s. Silent when the tab is hidden. Sounds: launch bell, paper thunk, stamp, lift ding.
- **Changes:** V.
- **Spend:** none.

**Q8. Photo mode and share images**
- **Ruling: b, then a.** Agree. Skip c.
- **Why:** Link previews are seen every time a friend shares a floor. That is the cheapest reach there is.
- **Numbers:** Share card 1,200 by 630, under 200 KB, remade on each launch and once a week. Photo: 1,920 by 1,080 PNG with the floor name and date in the corner.
- **Changes:** Sv, then V.
- **Spend:** none.

**Q9. Phone limits**
- **Ruling: a + b.** Agree. Use c only as the last fallback.
- **Why:** A hard budget keeps the room light. The frame test protects weak phones. **Check** what cutaway.js does; if it works, it is the fallback when 3D cannot run.
- **Numbers:**
  - Budget once 3D loads: 30 fps cap, pixel ratio 1.5, one shadow light, 60,000 triangles, 2 MB of 3D files.
  - Frame test, 2 s, uncapped: 50 fps or more = high. 30 to 49 = medium. Under 30 = low.
  - If low still runs under 15 fps, show the cutaway (or a still picture of the room) with a note.
  - Drop one level, once, if the average falls under 24 fps for 5 s.
- **What each effect does on low:**

| Effect | On low |
|---|---|
| Fly-in | Desktop only. Never on phones. |
| Live tower | Not shown. The floor list dot pulses instead. |
| Hero crossfade | Stays. Stops under reduce motion. |
| Real-time light | Colour change only. No shadows, no lamp lights. |
| December set | Roof colour only. No tree, no falling snow. |
| Camera follow and drift | Off. |
| State-true poses | Stay. Monitor glow is a flat colour, not a light. |
| Result beats | Stay. |
| Frames | Max 3, small pictures. |
| Whiteboard | Stays. |
| Paper piles | One flat sheet, or none. |
| Trophies | Stay. |
| Billboard | Not shown (phone home has no tower). |
| Sound | Same as everywhere. |
| buddehbot mailroom | Robot, tray and stamp stay. No tube animation. |
| Replay (Q24) | Timeline cards and screenshots only. No room. |

- **Changes:** V.
- **Spend:** none.

### Part B: work better

**Q10. New real value**
- **Ruling: a + c. b becomes the menu c picks from. Skip d.**
- **Why:** Upkeep keeps live things working. One proposal a week keeps floors moving without a boss having to think of jobs. "Getting found" is what raises real use, so it should be the first thing c reaches for. d adds work with no proof anyone wants it.
- **Numbers:**
  - Upkeep: Tuesdays 09:00, every live site. Checks run by code: broken links, load time, form test, domain renewal date. A model is called only when a check fails. Max 3 fixes per site per week. Each fix is an edit with the smoke check. Renewal warning 30 days ahead.
  - Proposal: Mondays 08:30. One change, one reason, the number behind it. Boss taps Yes or No. No reply in 7 days drops it.
  - Anything public outside the site (a business profile, a directory listing) always needs a boss tap.
- **Changes:** Sv + P.
- **Spend:** small. One short call per floor per week, plus fixes only when something is broken.

**Q11. Launch quality checks**
- **Ruling: a + b.** Agree. c later.
- **Why:** The checklist catches the dull faults. One fresh look from a different model catches "works but looks wrong". It must not become a loop.
- **Numbers:**
  - 8 checks: loads under 3 s on a phone, phone view fits, no broken links, form test arrives, link-preview tags, icon, 404 page, HTTPS.
  - Blocks the Launch tap: no HTTPS, a broken form, a broken link on the main page. The rest are warnings.
  - The checklist gates **Launch** only. Work in progress still publishes.
  - Fresh-eyes: one call, with a desktop and a phone screenshot and the done-means lines. Score 1 to 5. Under 3 makes one fix job. **No second score.**
- **Changes:** Sv + P.
- **Spend:** small. One call per launch.

**Q12. "What we made this week"**
- **Ruling: a only.** I would skip b.
- **Why:** Real screenshots and numbers tell the story. A written roundup adds words, not facts.
- **Numbers:** Built Mondays 08:10. Shows launches, changes shipped, before and after screenshots, visits. A quiet week says so: "Quiet week. Nothing shipped. 2,241 visits to things made earlier." Keep 12 weeks of history.
- **Changes:** V + Sv.
- **Spend:** none.

**Q13. Friend engagement**
- **Ruling: a + b.** Agree. c and d later.
- **Why:** A waiting question is the main reason a floor stalls. A boss who hears about it replies sooner.
- **Numbers:** Email for three events only: question waiting, launch ready, something shipped. Max 3 emails a day per boss. One reminder after 24 hours for an open question. Weekly report Mondays 09:00. Floor 7 needs its boss email first.
- **Changes:** Sv.
- **Spend:** none.

**Q14. Cross-floor collaboration**
- **Ruling: b now. a later. Skip c.**
- **Why:** A shared library lets every floor start from what already worked. Borrowing a bean is fun to watch but large, and it mixes floors.
- **Numbers and privacy rules:**
  1. A library entry has a fixed form: title, lane, a lesson of up to 500 characters, an optional code part.
  2. A floor proposes at most 2 entries a week.
  3. Code scrubs every entry: names, emails, phone numbers, web addresses, prices, and any word from that floor's company name, boss name or customer records.
  4. Colon approves each entry with one tap in admin. Nothing enters the library without it.
  5. Bots read the library only. It is fenced as untrusted text, the same way floor text is fenced for buddehbot.
  6. No bot can read another floor's drive, chat, Numbers, inbox or orders. The library is the only shared thing.
  7. Seed it with the launch checklist and parts from Colon's own floors.
- **Changes:** Sv + P.
- **Spend:** none to small.

**Q15. Reputation and levels**
- **Ruling: my own. Milestones, not levels. Real counts, not badges. No leaderboard.**
- **Why:** A level is an invented number. "1,000 visits" is a fact. Trophies (Q5d) and framed launches already are the reputation. Agree on no leaderboard.
- **Numbers:** Bean ID cards show two real counts: jobs finished and launches worked on. Floor plaque shows launches and total visits.
- **Changes:** V + Sv.
- **Spend:** none.

**Q16. Weekly showcase**
- **Ruling: a, with a quiet-week rule.**
- **Why:** It gives the week a beat. It must not throw a party for nothing.
- **Numbers:** Fridays 16:00 to 23:00. The floor with the most real visits this week is featured: lit crown, its launches on the billboard, one cheer when a visitor opens its room. **Only if something shipped in the building that week.** Otherwise no party, and the billboard runs as normal.
- **Changes:** V.
- **Spend:** none.

### Part C: buddehbot as a physical bot

**Q17. Where it lives**
- **Ruling: a. d only for contractor deliveries.** I differ slightly.
- **Why:** A basement mailroom says "serves every floor, belongs to none". Answers and purchases return by tube. The ride up is saved for the one big real delivery: finished contractor files landing on a floor.
- **Numbers:** One main tube up the side of the tower with a tube point on each open floor. The mailroom shows at the foot of the tower on the home panel and as **B** on the lift.
- **Changes:** V.
- **Spend:** none.

**Q18. How paperwork shows**
- **Ruling: a + b + c + d together.**
- **Why:** They are one chain: a bean walks the folder to the tube point, the tube carries it, the tray holds it, the stamp closes it. Each step is short.
- **Numbers:** Walk 4 s. Tube 1.5 s. Tray shows one folder per open item up to 8, then "+N". Stamp 0.6 s. A visitor who arrives late sees the current state only. No animation is replayed.
- **Changes:** V + Sv.
- **Spend:** none.

**Q19. States and truth**
- **Ruling: a + b + c.** Agree.
- **Why:** Without a heartbeat, "busy" could be a Mac that is switched off. The Colon stamp is true only when a record says he approved.
- **Numbers:** Heartbeat every 5 minutes from a plain script on the Mac. It makes no model call. It sends only: awake or working, and an item number. No text. Away = no heartbeat for 15 minutes outside the freeze.
- **Changes:** V + Sv.
- **Spend:** none.

**Q20. What each audience sees**
- **Ruling: b for visitors.** Agree.
- **Why:** One line of kind makes the mailroom readable. Nothing private leaves.
- **Numbers:** Three lines only: "Help question from floor 6", "Purchase request from floor 3", "Build job from floor 6". Never the item, the price or the question.
- **Changes:** V + Sv.
- **Spend:** none.

**Q21. Look and personality**
- **Ruling: b, the boxy robot.** Agree.
- **Why:** It really is a different kind of thing: an outside agent. A robot on wheels also needs no walking skeleton, which makes it cheap to animate.
- **Numbers:** About 0.8 of a bean's height. Under 1,500 triangles. Ink body, Slate panels, one eye light, Tower Red stamp.
- **Changes:** V.
- **Spend:** none.

**Q22. Truth and the line**
- **Ruling: a + b. Never c.**
- **Why:** A display that only reads cannot open a new path.
- **The subscription line, confirmed:** The character reads existing records. It adds no tool for bots, changes no prompt and sends nothing to the Mac. Floor bots keep running on The Office's own keys. The contractor stays manual: only Colon's **Send out** button fills the queue. Tapping the robot never contacts buddehbot.
- **Numbers:** Every animation event carries a record type and a record number. The page refuses to play one without them. Target: 100%.
- **Changes:** Sv.
- **Spend:** none.

**Q23. Launch sign-offs**
- **Ruling: a + c.** Agree.
- **Why:** buddehbot does not check launches, so its stamp there would be untrue. The code checklist is real and deserves its own mark.
- **Numbers:** A **CHECKED 8 of 8** mark on the launch plaque and card. It is a stamp, not a new character. The fresh-eyes score is shown to the boss only.
- **Changes:** V.
- **Spend:** none.

### Part D: what's missing

**Q24. Three ideas**

1. **Replay: "Watch how this was made."**
   - What: a 30 to 60 second time-lapse of a real past job. The room plays back the real events, with the real timeline cards and screenshots. A clear label: "Replay · Tuesday 14:10".
   - Size: L. Changes: V + Sv (keep each job's events with times).
   - Cost per week: none.
   - Benefit: there is always something true to watch, even when every floor is idle. This is the best answer to the quiet building. I would build it before buddehbot.

2. **"Did it work?" check.**
   - What: every shipped change records the number it was aiming at. Seven days later, code compares before and after and posts the result on the timeline: "New gallery page: visits 649 to 702".
   - Size: S to M. Changes: Sv.
   - Cost per week: none.
   - Benefit: bosses and bots learn what helps. It makes the weekly proposal (Q10c) smarter each week.

3. **A feedback button on every launched product.**
   - What: "Was this useful? Yes / No" and one optional line, on each site and game. Results land in the Numbers tab and feed the weekly proposal.
   - Size: M. Changes: V + Sv.
   - Cost per week: none extra. Feedback text is fenced as untrusted before any bot reads it.
   - Benefit: the bots work on what real users ask for, not on guesses.

---

## 3. buddehbot character spec

### Look
- A small boxy robot on two wheels. The only non-bean in the building.
- About 0.8 of a bean's height. Square body, rounded corners, a flat head with one round eye light.
- Ink body. Slate panels. Tower Red rubber stamp held in a clamp hand.
- Eye light shows state: Amber = busy, Teal = awake and free, off = asleep or away.

### Home and desk
- A basement mailroom under the lobby. Brick walls, one hanging lamp, a wall of pigeonholes with one slot per open floor.
- A plain desk with: an in-tray, an out-tray, a stamp pad, a desk phone, a small sign stand.
- A brass tube mouth above the in-tray. It runs up the side of the tower to a tube point on each open floor.
- A charging dock in the corner.

### Animations and their triggers

| # | Animation | Trigger record |
|---|---|---|
| 1 | Manager takes the phone call (exists), then a slip drops down the tube into the tray | A help request is created |
| 2 | A bean walks a folder to the floor's tube point; it drops into the tray | A purchase request is created |
| 3 | The manager carries a folder with a COLON APPROVED stamp to the tube point | Colon presses Send out on a job |
| 4 | Robot lifts the top folder onto the desk; eye turns Amber | An item is marked picked up, or the heartbeat names it |
| 5 | Stamp comes down; one voice line; folder goes up the tube | An item is closed with an outcome |
| 6 | Folder pops out at the floor's tube point; a bean collects it | Same record as 5 |
| 7 | Robot rides the lift with a box, sets it at the Builder's desk, rides back (8 s) | A contractor job is handed back |
| 8 | Robot turns a page of a paper every 20 to 40 s | No open items, heartbeat fresh |
| 9 | Robot on its dock, lamp off, sign "Back at 08:00" | Night freeze is on |
| 10 | Robot on its dock, lamp on, sign "Away" | No heartbeat for 15 minutes, freeze off |

### States, in priority order
1. **Asleep:** the freeze is on (23:00 to 08:00). The tray can still fill.
2. **Away:** no heartbeat for 15 minutes.
3. **Busy:** at least one item picked up and not closed.
4. **Inbox waiting:** open items, none picked up.
5. **Free:** no open items.

### Who sees what

| | Sees | Can tap |
|---|---|---|
| Visitor | Robot, state, tray height, stamps, one line of kind with floor number | The robot: a small card with state and counts by kind |
| Boss | All of that, plus their own floor's items in full: question, answer, item and price, contractor status | Their own items, to read them |
| Colon | Everything | The robot: the whole queue, with Send out and admin actions |

### Voice lines (full list)
One bubble per event, 2.5 s, never more.

| Event | Line |
|---|---|
| Help answered | "Answered." |
| Help declined | "Not this one." |
| Help expired | No line. Stamp only. |
| Purchase bought | "Bought." |
| Purchase declined | "Not this one." |
| Purchase flagged to Colon | "Asking Colon." |
| Colon approved | "Approved." |
| Contractor job picked up | "On it." |
| Contractor job delivered | "Done." |
| Item was already finished (**Check** this outcome exists) | "Already done." |
| Asleep | Sign, not a bubble: "Back at 08:00." |
| Away | Sign: "Away." |

Stamps: ANSWERED, BOUGHT, DONE, DECLINED, EXPIRED, and a second small COLON APPROVED.

### Data it reads (**Check** the real names)
- **Help requests:** number, floor, created time, picked-up time, closed time, outcome (answered, declined, expired).
- **Purchase requests:** number, floor, created time, reviewed time, outcome (bought, declined, flagged), Colon-approved time.
- **Contractor jobs:** number, floor, task number, sent-out time, sent out by, picked-up time, handed-back time.
- **Heartbeat:** time, status, item number.
- **Freeze state:** on or off.
- The public feed carries only: number, kind, floor, state, times. Text, items and prices stay on the server and go only to the right boss and to Colon.
- **Check:** which part of domain buying buddehbot does today. Show a folder for it only if a real record exists.

### What it must never do
- Never show an item without a real record number.
- Never invent busywork. An empty tray means it reads a paper or sleeps.
- Never show question text, item names or money to visitors.
- Never banter, joke or speak outside the list above.
- Never stamp a launch.
- Never give bots a new way to reach buddehbot. No "ring buddehbot" for bosses.
- Never send anything to the Mac from a tap or an animation.
- Never move floor work onto Colon's personal subscription.

---

## 4. Visual upgrade list, in priority order

| # | Change | Size | Phone "low" |
|---|---|---|---|
| 1 | Idle floors look lived-in (nobody types; 4 idle moves) | S | Stays |
| 2 | Framed launches on the wall | S | Max 3, small |
| 3 | Hero card crossfade and live dot | S | Stays |
| 4 | Real New York light | M | Colour only |
| 5 | Live tower: work light and visit sign light | M | Floor list dot |
| 6 | Replay of the last real job | L | Cards and screenshots only |
| 7 | State-true poses and result beats | M | Stays, flat glow |
| 8 | Whiteboard plan, paper piles, trophies | M | Stays, piles flat |
| 9 | Billboard on the crown | S | Not shown |
| 10 | First-visit fly-in | S | Never on phones |
| 11 | Camera follow (desktop), idle drift (phone) | M | Off |
| 12 | Sound off by default, event sounds | S | Same |
| 13 | buddehbot mailroom, folders, tray, stamps | M | No tube animation |
| 14 | Share cards | M | Not 3D |
| 15 | Friday feature | S | Billboard not shown; cheer stays |
| 16 | December set | S | Roof colour only |
| 17 | Photo button | S | Hidden on low |

---

## 5. Keep / Change / Cut

**Keep**
- Everything round 1 shipped: one look, results first, the worker loop.
- The paper carry, meetings, cheers and the manager's phone call.
- No 3D on phones until "Watch the room".
- The four help-line flows and their safety fence, exactly as they are.
- Contractor manual only.

**Change**
- Fixed golden hour becomes real New York time.
- Idle floors: beans leave their desks.
- Sound: off by default.
- Tower windows: lit by real work and real visits.
- "Waiting on buddehbot" text becomes a folder you can see.
- Levels become milestones. Badges become real counts.
- The old floor card becomes the new status card (already planned).

**Cut**
- Real weather (later, if ever).
- Model-written weekly roundup.
- Ticker band and lit crown as standing features (crown is Friday only).
- Public leaderboard.
- Role guilds, lane playbooks, the 20-second reel, the weekly team photo.
- A boss "ring buddehbot" button.
- A buddehbot stamp on launches.

---

## 6. Build order

Continues from j31. The first seven change the feel in a day.

| # | Name | Changes | Depends on | Done means | Size |
|---|---|---|---|---|---|
| j31 | Lived-in idle floors | V | None | On an Idle floor no bean types and at least one idle move plays within 20 s. | S |
| j32 | Framed launches | V | Screenshot service | Floor 6's wall shows one frame with the real TheTireRx screenshot. | S |
| j33 | Hero crossfade and live dot | V | Screenshot service | A hero card with 3 screenshots fades between them; a Working floor's badge pulses on a phone. | S |
| j34 | Sound off by default | V | None | A first-time visitor hears nothing until they turn sound on. | S |
| j35 | Real New York light | V | None | With the clock set to 23:30 New York, all room lights are off and the crown sign is lit. | M |
| j36 | Activity feed and live tower | V + Sv | None | Starting a test job on a hidden floor brightens that floor's windows within 10 s. | M |
| j37 | Crown billboard | V | Screenshot service | The tower crown cycles the 3 hero screenshots every 6 s. | S |
| j38 | First-visit fly-in | V | j36 | The fly-in plays once on desktop, never a second time, and never under reduce motion. | S |
| j39 | State-true poses | V | j31 | A Builder on a running job types with monitor glow; a waiting floor's beans glance at the boss door. | M |
| j40 | Result beats | V | j39 | A real launch event triggers one cheer; a failed check triggers one slump. | S |
| j41 | Whiteboard plan | V | None | The whiteboard lists the current plan's jobs and ticks one when it is done. | M |
| j42 | Paper piles and trophies | V + Sv | None | A bean with 3 queued jobs has 3 sheets; floor 6 shows the 1,000-visit trophy. | S |
| j43 | Event sounds | V | j34 | With sound on, a launch rings one bell and no two sounds play within 2 s. | S |
| j44 | Phone hard budget | V | None | The phone room stays under 60,000 triangles and 2 MB of 3D files. | S |
| j45 | Auto quality | V | j44 | A slow test phone lands on low and shows no shadows; cutaway.js has been checked and its use noted. | M |
| j46 | Camera follow and drift | V | j40 | The desktop camera eases to a real handoff and back, and stops after a drag. | M |
| j47 | Job event log | Sv | None | Every job stores its events with times for at least 30 days. | S |
| j48 | Replay | V + Sv | j47 | An idle floor offers "Replay" and plays its last real job in under 60 s with a visible Replay label. | L |
| j49 | buddehbot public feed | Sv | None | One read-only address returns open items as number, kind, floor, state and times, with no text or prices. | S |
| j50 | Mailroom and robot | V | None | The basement shows on the tower panel and at B on the lift, with the robot at its desk. | M |
| j51 | Folders, tube and tray | V | j49, j50 | A test purchase request makes a folder appear in a bean's hand within 10 s and the tray rise by one. | S |
| j52 | Stamps and voice lines | V | j51 | Closing a test item as bought shows BOUGHT and the line "Bought." once. | S |
| j53 | Heartbeat, asleep, away | Sv + V | j50 | With no heartbeat for 15 minutes the sign reads "Away"; during the freeze it reads "Back at 08:00". | S |
| j54 | Audience views | V + Sv | j49 | A visitor sees kind lines only; a boss sees their own items in full; Colon sees the whole queue. | M |
| j55 | Contractor delivery and Colon stamp | V | j52 | A handed-back job triggers one lift ride; COLON APPROVED appears only on items with an approval record. | S |
| j56 | Truth test | Sv | j52 | An automated test fails if any played animation has no record number. | S |
| j57 | Launch checklist | Sv | None | Launch is blocked on a test site with a broken form and allowed once it is fixed. | M |
| j58 | CHECKED mark | V | j57 | A launch that passes shows "CHECKED 8 of 8" on its plaque and card. | S |
| j59 | Fresh-eyes review | P | j57 | A launch gets exactly one score, and a score under 3 creates exactly one fix job. | S |
| j60 | Share cards | Sv | Screenshot service | Pasting a floor link into a chat app shows a 1,200 by 630 picture of that floor. | M |
| j61 | Boss alerts | Sv | Floor 7 email | A waiting question emails the boss once, and again once after 24 hours. | S |
| j62 | Weekly floor report | Sv | j61 | Each boss gets one Monday email with what shipped, visits and one suggestion. | S |
| j63 | Upkeep rounds | Sv + P | j57 | A planted broken link on a test site is found and fixed on the Tuesday run with no Tester call. | M |
| j64 | Numbers to actions | P | None | Each active floor gets one Monday proposal with a number and a Yes / No tap. | S |
| j65 | "Did it work?" check | Sv | None | Seven days after a change ships, a before-and-after line appears on the timeline. | S |
| j66 | This week page | V + Sv | Screenshot service | The Monday page builds from real records and shows a quiet-week line when nothing shipped. | S |
| j67 | Milestones and real counts | V + Sv | j42 | Bean cards show jobs finished and launches; no level appears anywhere. | S |
| j68 | Friday feature | V | j37 | On a Friday with a shipped change the top floor gets the lit crown; with none, nothing changes. | S |
| j69 | Building library | Sv + P | None | An entry with an email address in it is scrubbed, waits for Colon, and is readable by other floors only after his tap. | M |
| j70 | Feedback button | V + Sv | None | A "Yes" on a test site adds one to that floor's Numbers tab. | M |
| j71 | Photo button | V | None | Photo saves a 1,920 by 1,080 PNG with no UI and the floor name. | S |
| j72 | December set | V | j35 | On 1 December the roof has snow and the lobby has a tree; on 1 January both are gone. | S |

---

## 7. Test targets

| Measure | Target |
|---|---|
| Phone first paint | Under 2 seconds on a mid-range phone |
| Phone frame rate, room open, high | Steady 30 fps |
| Phone frame rate, room open, low | 24 fps or more on average |
| Total 3D download, phone | 2 MB or less |
| Total 3D download, desktop | Start at 5 MB or less |
| Animations tied to a real record | 100% |
| Real help request to folder appearing | Under 10 seconds |
| buddehbot "Away" shown after the Mac goes quiet | Within 16 minutes |
| Visitor-visible private text or money in the mailroom | 0 |
| New paths from a bot to buddehbot | 0 |
| Model calls made by any visual in parts A and C | 0 |
| Idle floors showing a typing bean | 0 |
| Launches passing all blocking checks | 100% |
| Fresh-eyes scores per launch | Exactly 1 |
| Open boss questions answered within 24 hours | Start at 80% |
| Real visits per week (today 2,241 across the three hero launches) | Up 10% in 4 weeks, up 25% in 8 weeks |
| Visitors who open a room or a Replay | Start at 30% of home visits |

---

## 8. What Colon must decide

1. **Replay before buddehbot?** Recommend yes. It fixes the quiet building for every visitor. The robot is seen mostly when items exist, which is rare.
2. **Real visits as a light on the tower.** Recommend yes. Visit counts are already public on the launch cards.
3. **Milestones instead of levels.** Recommend yes. If you still want levels, base them only on the same four milestones.
4. **Friday feature names a top floor.** Recommend yes, as praise only, with no ranked list. Say no if you think Justin or Cailyn would feel compared.
5. **The robot look.** Recommend the boxy robot in Ink and Slate. Your call on a name plate: "buddehbot" or just "Mailroom".
6. **A heartbeat script on your Mac.** Recommend yes. It is a plain script with no model call and no floor text.
7. **Library approvals.** Recommend you approve entries yourself, about 5 minutes a week. Nothing crosses floors without your tap.
8. **Sound off by default.** Recommend yes.
9. **The two waiting friends.** Recommend opening their floors once j31 to j38 are live. More real floors is the truest fix for a quiet building.
10. **Send the screenshots.** They did not arrive with the brief. I will revise anything they contradict.
