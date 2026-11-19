STATUS: GREEN
JOB: 29 Browser suites on the new design
DONE MEANS: "Update each test/browser suite that still drives the old UI to the new design (home layout, lift of open floors, Timeline
  instead of Talk, the four states, floor-lite on phones, Business tab, portfolio page) so it tests the same user paths, keeping its
  coverage; run every suite you can plus npm test; change product code only for a real bug the suites find."
  Pushed early at the orchestrator's request (a change of priority for job 30): the suite work below is done, but not every suite got a
  clean final run after its last fix. What was and was not re-run is listed suite by suite.

  Product bugs the suites found, all fixed here (each says which suite found it):
  - e2e.mjs: a new boss on a phone landed on the light floor page (job 16) with no way into Setup. A boss whose floor is still being set
    up now goes straight to the full floor page (public/js/floor-lite.js).
  - tower.mjs: someone in a room who took the lift to another floor was dropped back on the light page. Taking the lift from a room
    keeps the room (public/js/main.js).
  - floors.mjs: on a phone the taller, padded floor header (redesign skin) sat under the toast. The toast now sits below it
    (public/css/skin.css). The same check passes on office-redesign-base.
  - custom.mjs: skin.css's dark modal backdrop overrode customise.css's see-through one, so the room was dimmed while you customised it.
    The customise backdrop is clear again (skin.css). This check passes on base.
  - mobile.mjs: tap targets under 44 px on 360 and 375 px phones. On the floor without its room: Home 42x40, Send 44x40, Share 92x38,
    Visit website 114x38. On the full floor: Back to building 44x40 (j14's 40 px .btn.back for the Launched page reached it).
    All are 44 px each way on phones now (skin.css).
  - mobile.mjs: the folded sheet scrolled by 1 px. skin.css's 1 px top border sat inside its fixed peek height (content 121 px, room for
    120). The line is now an inset shadow and takes no space. A focused check measures 121/121, as base does.

  Test changes (no step dropped; each change says why):
  - cdp.mjs: page.room() (on a phone, taps Watch the room so the full floor page loads; does nothing elsewhere) and page.tab(id) (opens
    a panel tab or a Business section through setTab). Every suite that opens a floor calls room() after goto.
  - Old UI to new: .open-pill becomes .open-office; Talk becomes Timeline (.timeline .tl-job, .tl-line; the tab id is still 'talk');
    Inbox, Numbers, Orders, Payments and Launch are opened as Business sections ([data-tab=biz], [data-biz=...]), with the unread
    count on the Business tab; the Closed pill becomes the four states plus the boss's "Outside your set hours" banner (modes, e2e);
    "N people" on the company card becomes the status card's Run by, state and Now, or "Just moved in" (floors); the home directory,
    lift buttons, Happening now and All launches replace the old lobby (e2e, tower, polish, makers2); /launched and
    /launched/<slug> (e2e).
  - modes.mjs: the goal is public by design now (the status card shows it to everyone, Q4 / job 15). The step checks it shows on the
    status card and nowhere else, and the plan stays private.
  - e2e.mjs: Happening now holds the 5 newest lines, and the redirect, stop and standing-order steps push a launch out of them. Its
    launch is now checked right after publishing, in a tab of its own; the later step keeps the rest (5 lines at most, nothing
    private, on screen, no overlap).
  - chat.mjs and server-panel.mjs create the /tmp folders they write pictures to (they crashed on a fresh machine).
  - Longer waits where the renderer is slow, never looser checks: a lift ride or floor load takes 30 to 90 s here, not 1 to 2.
    tower LIFT_MS and setup FLOOR_MS default to 150 s (set them to 15000 for the old bound); floors, e2e, makers2, mail, shop and
    attach got longer waits on floor loads, reloads and picture uploads. The speed checks themselves are unchanged (tower's
    "quickly", polish's 300 ms lift, the first-frame and draw-call budgets).
  - e2e.mjs: the mock is held slower for the redirect step only, so the job is still running when Redirect lands. This step failed
    the same way on the untouched office-j24-portfolio tree.

TESTS: npm test 1733/1735. The 2 failures are the same two as job 24's: the IPv6 test (the box has no IPv6) and test/launch.test.js
  "launch_check can't wipe what publishing recorded" with "claim failed 408" (a request timeout while other tests shared the CPU; the
  file passes 71/71 on its own). Browser suites: headless Chromium with SwiftShader software GL in mock mode, two or three suites
  at once on a 4-core box. "Base" means the same suite on office-redesign-base (before the redesign) on this box.
  Passing:
    apps 26/26, attach 10/10 (after the longer upload wait; 7/10 before, one slow upload knocking on), biztab 9/9, business 18/18,
    cloud 18/18, cloud-powers 17/17, home 10/10, launch 18/18, legal 8/8, mail-domain 8/8, makers 56/56, numbers 8/8, pay 26/26,
    phone 19/19 (no 3D before Watch the room; weight and first paint under budget), resilience 15/15, server-panel 36/36 (after the
    folder fix), signup-mail 13/13, stack 8/8, look-shots (all sizes ok, no page errors; it has no pass count),
    redesign-shots (20 shots, 0 console errors).
  Fixed after their run, not re-run since (stopped for job 30):
    modes 7/8 (the one failure was the goal check, rewritten as above); mail 6/7 (a debug run showed the reply landing just after
    the old 30 s wait; now 120 s); shop 30/31 ("marked as sent" after a whole-floor reload took over 30 s; now 120 s); chat 7/8 (the
    missing /tmp folder; now created); setup 42/50 (first floor loads timed out at 15 s, then knock-ons; now 150 s); makers2 26/29
    (see below).
  Failing, and failing the same way on base (slow renderer, not the redesign):
    floors 32/37. The 5 failures are walk timings: walking to the meeting and back, every layout, a new hire at a desk, the visitor's
      walk, the phone line said out loud. Base, living half: 13 passed, 8 failed, those same steps plus the scrubber. The scrubber,
      Timeline, status card and toast steps pass here.
    tower 15/23. The 8 failures are lift rides that timed out at 15 s (now LIFT_MS) and "arrives quickly" (23.8 s against 1.8 s).
      Base: 13 failed.
    custom 17/30 when stopped. hire, the boss builder, the bean builder and hostile name (both viewports) and the five "plans" walks
      fail; base fails all of those too (base: 20 passed, 23 failed). The backdrop step that failed before the fix passes now.
    makers2 26/29: lobby to launcher (floor load), the hold, and Launch anyway; base: 21/24, the same family of timeouts.
  Failing, not compared on base:
    polish 6/14. All 8 failures are speed limits a software renderer cannot meet: warm lift under 300 ms, first 3D frame (90 s),
    idle frame throttling, the governor stepping down, and one knock-on of the lift timeout.
  Not finished in time here:
    e2e. The first full run passed 21 and failed 4 before its 90-minute cap; all 4 were fixed after (redirect hold, Happening now
      order, two floor-load waits). The final desktop-only run passed 17, then failed "Happening now shows this floor's launch": the
      launch never shows in Happening now even right after publishing. That is the live defect job 30 fixes (the strip is built from
      the ticker, and the pinned launch sorts behind newer lines). The phone half and the admin pass did not get a run after the fixes.
    mobile. The last run passed 152 and failed 8 before its 90-minute cap, at 360, 375 and 390 px. The 8 were Back to building at
      44x40 and the 1 px sheet scroll, both fixed after that run started. The floor without its room passes at every size. Base,
      360x640: 57/57.
  mobile-audit.mjs and redesign-seed.mjs are helpers, with no checks of their own.
DEPLOY NOTES: none (CSS and two small client fixes; no migration, no env var).
RISKS: e2e (both halves and admin), mobile (all six sizes), modes, mail, shop, chat, setup and makers2 have not had a clean run after
  their last change. A job with a quieter box (or a GPU runner) should run them again with the defaults; their longer waits only
  matter when the box is slow. The polish speed limits cannot be met with software GL. They need a GPU runner to mean anything.
  The 44 px rule for .btn.back applies to every back button on phones (the Launched page's too), which is what the tap-size rule wants.
