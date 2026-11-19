STATUS: GREEN
JOB: 24 Floor portfolio page
DONE MEANS: "Each floor has a public share page listing its launches."
  - Every open floor has a public share URL: /theoffice/launched/<floor-slug> (public/js/launched-ui.js with a floor): the floor header (floor
    number, state badge, lane, name, tag line, "Run by", Visit floor), title "Launched by <company>", a filter by lane (All, Games, Websites,
    Business), the launch cards (real screenshot, name, one line, visits or plays this week, "Made by floor N in X days", Play/Visit), Work in
    progress below, and Share (the phone's share sheet, else the link copied). Empty: "Nothing launched yet. The team is on step 2 of 4."
    (from the status card's Now). The floor's status card links to it ("All launches"). The building's /theoffice/launched is the same page
    for every floor.
  - Hidden: sign-ups, sales and money (the cards carry visits/plays only), private projects, demo floors (/api/building/launched?floor=<demo>
    is empty; a demo, hidden or suspended floor's link gets no preview).
  - Link preview: the server answers /theoffice/launched and /theoffice/launched/<slug> with the app shell plus og:title, og:description,
    og:url, og:site_name, twitter tags, and og:image = the floor's best launch's real screenshot (job 3, a 640x400 JPEG, public URL) when
    there is one; a drawn SVG card is never used as og:image. Text is escaped. (This also makes /launched load from a link; it was in-app only.)
  - Proof: test/portfolio.test.js: "one floor's launches only, newest first, work in progress marked; private work and demo floors left out";
    "the floor's page is the app with a preview: its name as the title and the best launch's real screenshot as og:image" (quotes and &
    escaped, no image before a photo exists, summary_large_image after, the image URL answers 200, unknown floor: plain shell); "title,
    lane filter, launch cards, work in progress below, the floor header, Share and Visit floor; the empty state".
  Screenshots: docs/redesign/jobs/j24/shots/portfolio-visitor-{desktop,phone}.jpg and the usual set.
TESTS: npm test 1733/1735. Failures: the IPv6 test (environment), and test/launch.test.js "launch_check can't wipe what publishing recorded" with "claim failed 408" (a request timeout while a screenshot run shared the CPU; the file passes 71/71 on its own). Browser: redesign-shots.mjs 20 shots, 0 console errors.
DEPLOY NOTES: none (no migration, no env var). Link previews use PUBLIC_ORIGIN for absolute URLs (already set on live); without it, the
  request's Host.
RISKS: A floor with no launch screenshot yet has a preview with no picture until job 3's script or timer has taken one. Chat apps cache
  previews; a new screenshot shows in a preview only when the app fetches again.
