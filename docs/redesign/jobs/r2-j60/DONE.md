STATUS: GREEN
JOB: r2-j60 Share cards
DONE MEANS: "Pasting a floor link into a chat app shows a 1,200 by 630 picture of that floor." Proved:
  - Browser (room-r2.mjs j60, this headless Chromium acting as the shots browser): a floor with a launch; its card made; the floor's own link
    (/theoffice/floor/<slug>) answers with og:image, og:image:width 1200, og:image:height 630, og:title "<name>: floor N of The Office" and a
    summary_large_image twitter card; fetching that og:image gives a real 1200x630 JPEG of the floor's card, 74 KB. Picture: r2-j60-sharecard.jpg.
  - test/r2-launch.test.js "DONE MEANS: a floor link carries a 1,200 by 630 picture of that floor as its preview": before any card is taken a
    plain 1200x630 PNG in the floor's colours stands in (under 200 KB); a launch (emitProject of a fresh public launch) makes the card: the card
    page photographed at 1200x630, quality lowered once because the first try was over 200 KB; the JPEG served is 1200x630 and under 200 KB; the
    link points at the new card. "the card page holds public facts only; remade weekly; a demo or hidden floor has none; SHARE_CARDS=0".
How it works: server/sharecards.js. cardHtml() writes a small page from public facts (name, floor number, launches and real visits from
  room.js roomMilestones, the best launch photo) under its own tight CSP (inline style and the building's own pictures only, no script);
  the shots browser photographs it (shooter.shoot with a 1200x630 size), quality 82, 70, 58 then 45 until under 200 KB; kept in share_cards.
  Made again on each fresh public launch (wrapping engine.emitProject) and by an hourly tick for any card over 7 days old (or a floor with none).
  The floor link is served through the same shell-with-preview path as /launched (app.js serveSharePage, now with the meta function as a
  parameter). With no browser reachable, plainCard() draws a text-less 1200x630 PNG in the floor's colours.
TESTS: node --test test/r2-launch.test.js 13/13. Full npm test: see LANE-R2-A-FINISHED.md. Browser: room-r2.mjs j60 all passed.
DEPLOY NOTES: Migration in the `// redesign r2 lane A` block: CREATE TABLE IF NOT EXISTS share_cards. New env SHARE_CARDS (default on). Needs the
  shots browser (SHOTS_CDP_URL, already set on the live server) and SHOTS_ORIGIN so the browser can reach the card page; without it the plain card
  is used. The first hourly tick after deploy makes a card for every floor on show.
RISKS: A chat app caches a link's preview; the image address carries ?v=<made_at> so a new card is a new address. app.js: the /floor/<slug> shell
  now goes through serveSharePage (falls back to the plain shell for a hidden, demo or closed floor, as before).
