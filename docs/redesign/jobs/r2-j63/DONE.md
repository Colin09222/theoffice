STATUS: GREEN
JOB: r2-j63 Upkeep rounds
DONE MEANS: "A planted broken link on a test site is found and fixed on the Tuesday run with no Tester call." Proved:
  - test/r2-launch.test.js "DONE MEANS: a planted broken link on a test site is found and fixed on the Tuesday run with no Tester call": floor 6,
    TheTireRx, switched out of weekly plans (round 1's plan off: upkeep must still run there), with a real mock-built live site. A link to
    old-prices.html is planted in the live page. The Monday tick does nothing; the Tuesday 09:01 New York tick (fake clock) finds it (links,
    "old-prices.html"), and makes one small Builder job "Upkeep: fix <site> (...)" whose brief names it. The team runs it (mock mode): the Builder
    edits and publishes; the next tick checks the site again: fixed (the link is gone from the live page). No Tester task was made and no Tester
    call is on the ledger. A second tick that week does nothing. upkeepDue: 08:59 too early, Monday no.
  - "at most 3 fixes a site a week; a paused floor gets its report and no fix; a domain due within 30 days is told once": with 3 fixes already
    used that week a failing site gets no fourth; a live domain bought 340 days ago is told to the boss once ("... is due for renewal in N days.
    Renewing is your call"); a paused floor's failing site is reported and gets no fix job; UPKEEP=0 runs nothing.
How it works: server/upkeep.js. A minute tick; in the Tuesday window (New York, from 09:00) each open, non-demo floor runs once a week
  (upkeep_runs). Every live public site (site, app, game) is checked by code on its live files (published_files) with r2-j57's checks: links,
  phone speed, a real form test entry (removed again). A model is called only for a failure: one small Builder job (size small, so it ships on
  the smoke check and the Builder's self-check with no Tester, the round 1 rule), at most 3 per site per week (upkeep_fixes), and the site is
  checked again once that job is done, with another fix inside the 3 if it still fails. Domains: a live domain whose yearly renewal falls within
  30 days is told to the boss once (upkeep_notices); renewing stays the boss's tap. Nothing outside the site is ever touched. The boss's room hears
  a one-line notice when something was found.
TESTS: node --test test/r2-launch.test.js 15/15. Full npm test: see LANE-R2-A-FINISHED.md. Browser: none (server).
DEPLOY NOTES: Migration in the `// redesign r2 lane A` block: upkeep_runs, upkeep_fixes, upkeep_notices. New env UPKEEP (default on). The first
  Tuesday after deploy runs it for every live site. Links to other sites are checked through safeFetch.
RISKS: A domain's renewal date is worked out as a year after it was bought (the order rows keep no expiry date). A paused floor is checked but not
  fixed (it starts no work while paused); the plan-off switch does not stop upkeep, as the spec has TheTireRx on upkeep only.
