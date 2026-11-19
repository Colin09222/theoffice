STATUS: GREEN
JOB: 13 Timeline with screenshots
DONE MEANS: "The floor's Timeline tab shows job cards with thumbnails and replaces Talk."
  - The Talk tab is now Timeline (same tab id, so every way into it still works; public/js/timeline-ui.js): one card per job, newest first,
    each with a small bean face, the job's name, its state, one line built by code (job 12), the time, and a photo of the step when there is
    one. The boss's messages and the manager's replies to the boss are on it too (for the boss, and for visitors on a public-chat floor);
    bean-to-bean lines (work hand-offs, meetings, small talk) are not: they stay as speech bubbles in the room. A new card slides in (0.32 s,
    off under prefers-reduced-motion); a changed card is replaced where it is; nothing else animates. Empty: "Just moved in. First job starts soon."
    With JOB_CARDS=0 the server sends no cards and the old Talk list comes back.
  - Photos (server/shots.js, Tier 0, the job 3 camera, no model): when a step is handed in or done on a project that is published and public,
    and when a project goes live, one photo of its public page is queued: at most 1 per step and 4 per job (table job_shots, UNIQUE
    card+step). The server timer takes them within seconds (SHOTS_NUDGE_MS, 3000) when it can reach a browser (SHOTS_CDP_URL); the newest is
    the card's thumbnail, served at /api/floors/<slug>/jobshot/<id> (the boss always; a visitor only for public work).
  - Proof: test/timeline.test.js "one per step, four per job, only of a public page that is up; the newest is the card's thumbnail" (6 steps,
    4 photos, a 5th refused, visitor 404 once private, boss 200), "nothing is queued for private work or a page that isn't up", "going live
    gets a photo by itself, through the server's own camera" (real Chromium over SHOTS_CDP_URL), "replaces Talk, reads job cards, keeps the
    boss's conversation and leaves bean-to-bean talk out; a new card slides in, respecting reduce motion".
  Screenshots: docs/redesign/jobs/j13/shots/timeline-{visitor,boss}-{desktop,phone}.jpg: job card with its step photo, the boss's conversation.
TESTS: npm test 1722/1723 (the one failure is the IPv6 test, environment). review.test.js route sweep lists the new public photo route.
  Browser: test/browser/redesign-shots.mjs (14 shots, 0 console errors). test/browser/chat.mjs (asserts the old Talk list) was not run.
DEPLOY NOTES: Migration: new table job_shots (CREATE IF NOT EXISTS). New env SHOTS_NUDGE_MS (default 3000). Step photos need the same browser
  as job 3 (SHOTS_CDP_URL); without it the queue waits and the timeline simply has no thumbnails. No admin command.
RISKS: A step whose project is not yet published has nothing public to photograph, so early steps of a first build have no thumbnail until the
  first publish (then the newest card gets the live page). A private project's steps get no photo at all. Browser suites that click the old
  Talk list (test/browser/chat.mjs) need updating.
