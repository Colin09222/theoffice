STATUS: GREEN
JOB: r2-j52 Stamps and voice lines
DONE MEANS: "Closing a test item as bought shows BOUGHT and the line 'Bought.' once." (Section 3: only the listed lines, one bubble per event, 2.5 s;
  stamps ANSWERED, BOUGHT, DONE, DECLINED, EXPIRED and a small COLON APPROVED.)
  - mailroom-events.js: STAMPS, the voice line table (Answered., Not this one., Bought., Approved., On it., Done.), stampFor and lineFor. Help
    expired: stamp only. Asleep and Away stay signs, not bubbles.
  - The mailroom (desktop and phone alike): on a close, the robot's arm brings the stamp down in 0.6 s, the Tower Red stamp word shows over the
    room, one bubble for 2.5 s, and the stamp sound (if sound is on).
  CHECKED "already done": no such outcome is recorded anywhere. A second decision on a help request throws "already" and changes nothing; a
  second hand-back of a contractor job is refused the same way. So "Already done." is left out. "Purchase flagged to Colon" has no record either.
  Proved in test/r2-stamps.test.js (4 tests): the stamps and lines exactly; the already-done check against the real help line; with the real
  feed, a purchase decided as bought gives exactly one BOUGHT and one "Bought." over three readings; the bubble's 2.5 s and the red stamp.
  Browser (on this stack): marking the test purchase bought showed BOUGHT for that record and said "Bought." once.
TESTS: npm test (full) at the r2-j50 code head (4ff1a4c): 1893 of 1895 pass. The 2 failures: domains.test.js IPv6 (no IPv6 in this container; fails the same on office-r2-base) and test/r2-tower.test.js poll line (fixed in r2-j36 before any push). Since then, every test/r2-*.test.js and the files this job touches, run on this branch: all pass.
DEPLOY NOTES: none.
RISKS: "Approved." and "On it." are in the table but cannot play today: no record says a job was picked up, and the COLON APPROVED stamp is r2-j55's.
