STATUS: GREEN
JOB: r2-j70 Feedback button (ships OFF: FEEDBACK_BUTTON default 0)
DONE MEANS: "A "Yes" on a test site adds one to that floor's Numbers tab." Proved (with the switch on for the test only):
  - Browser (room-r2.mjs j70): a test site served on its own origin (<label>.apps.localhost) shows "Was this useful? Yes / No"; a real click on
    Yes, a typed line and Send: the boss's Numbers route then says this week { yes: 1, no: 0 } with the line. Picture: r2-j70-button.jpg.
  - test/r2-feedback.test.js "DONE MEANS: with it on, a "Yes" on a test site adds one to that floor's Numbers tab": one first-party script on a
    public page, never on a private project; one Yes is one on the Numbers tab with its line; the same visitor again the same day, a bot, a bad
    answer each add nothing; the Numbers tab is the boss's only.
  - "ships OFF": config is false unless FEEDBACK_BUTTON=1; with it off no page gets the script and an answer posted anyway keeps nothing (no row,
    nothing queued).
  - "fenced as untrusted before any bot reads it": the manager's figures carry the counts and the visitors' lines inside <untrusted_data
    source="visitor feedback">, and a line cannot close the fence.
How it works: server/feedback.js (FEEDBACK_JS, injectFeedback, createFeedback().record, feedbackFigures, feedbackForBots). server/app.js serves
  /_office/feedback.js like the tapped-calls script, adds it to a public project's HTML pages only when FEEDBACK_BUTTON=1, and takes answers at
  /_office/feedback from the page's own origin only (204 always). server/numbers.js adds `feedback` to the boss's Numbers (and the counts and
  fenced lines to managerFigures, which feeds lane B's weekly proposal); public/js/numbers-ui.js shows them.
TESTS: node --test test/r2-feedback.test.js 3/3; numbers 14/14, taps 5/5, security 71/71. Full npm test: see LANE-R2-A-FINISHED.md.
  Browser: room-r2.mjs j70 all passed.
DEPLOY NOTES: Migration in the `// redesign r2 lane A` block: app_feedback. New env FEEDBACK_BUTTON, default 0 = OFF: nothing shows on any
  site and nothing is kept until the orchestrator sets FEEDBACK_BUTTON=1 after Colon says yes. Files touched outside lane A's list:
  server/app.js (the script, the route), server/numbers.js and public/js/numbers-ui.js (the figures).
RISKS: The widget is a small card in the bottom right corner of every public page of a launched site or game, asked once a day per page per
  visitor (localStorage); a site with its own bottom-right control may overlap it. Visitors' lines are kept 200 characters long, as text.
