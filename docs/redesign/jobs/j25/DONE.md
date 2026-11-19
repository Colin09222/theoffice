STATUS: GREEN
JOB: 25 Idea scorecard
DONE MEANS: "Every new idea card shows 4 scores; a test idea under 8 shows the warning and can still be picked."
  server/scorecard.js, proved in test/scorecard.test.js:
  - "every new idea card shows its four scores to the boss; one under 8 shows the warning and can still be picked; a visitor sees no score": a
    Business journey in mock mode; all three cards carry Who pays, Days to first dollar, Cost to build, Cost to run per week (0 to 3) in the boss's
    view; "Night Desk Notes" (0+1+2+3) shows "This idea scores 6 of 12: nobody clear pays for it yet."; the boss picks it and the build starts.
    The scores came in the Researcher's own propose_ideas call (no other call), with no dollar figure in what it read.
  - "four scores, 0 to 3; the bar is 8 of 12 with Who pays above 0; the warning is plain".
  - "a card without its four scores is sent back to the Researcher; with them it keeps them; IDEA_SCORECARD off asks for none".
  - "what the Researcher reads names no dollar figure; the scores are required in the tool".
  The card (public/js/business-ui.js) shows "Score N of 12", the four scores with what each means (Cost to build: 3 = under $3, 2 = $3 to $10,
  1 = $10 to $30, 0 = over $30) and, below the bar, the warning. Pick this one is unchanged.
TESTS: npm test 1839/1840; the 1: domains.test.js IPv6 (EAFNOSUPPORT ::1; this container has no IPv6). No older test changed (the
  existing business tests' cards call checkIdeas directly, where scores are only asked for when switched on; the mock Researcher's cards now carry
  scores). Browser suites: not run (business.mjs/biztab.mjs; the card gained one block, checked through the boss's view).
DEPLOY NOTES: No migration (the scores live on the idea cards in business_journeys.ideas). New env: IDEA_SCORECARD (on; 0: no scores asked for or
  shown). Cards made before the deploy have no scores and show none.
RISKS: The Researcher reads the scales in words (Cost to build: 3 = one page with a form ... 0 = something big), not dollars, because no prompt or
  tool description may carry a figure (test/budget.test.js's leak tests); the dollar bands are the boss's legend. A card missing its scores is sent
  back, like a card missing its links, which can cost the Researcher one more turn in the same task. Warning only: nothing is blocked, nothing needs
  Colon's OK. The manager's note about the cards doesn't mention scores. Lane A files touched: public/js/business-ui.js (the score block) and
  public/css/business.css.
