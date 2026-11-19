STATUS: GREEN
JOB: 33 Tapped calls
DONE MEANS: "Count real taps on tel: links on every floor's published sites, the same way real visits are counted (bots, the floor's boss and
  Colon excluded; no third-party script; no personal data kept, just floor, project, page path, number tapped, time). A tiny first-party
  beacon added when the Office serves a published page is fine; it must not break pages that have their own scripts, or work offline. Show
  the count in the boss's Numbers tab ('Calls tapped: N this week') and in the owner's digest line for each business floor. Feed j26's
  real-use figure. DONE MEANS: in a test, a tap on a tel: link on a published page is counted once; a boss's own tap and a bot's are not;
  the digest shows the count."
  - server/taps.js and serveApp in server/app.js:
      - The script. When the Office serves an HTML page of a public project that has a tel: link, it adds one first-party script,
        <script src="/_office/taps.js" defer>, before </body>, once. Other pages get nothing.
      - What the script does. It listens for clicks on tel: links (capture phase, no preventDefault, no globals, wrapped in try) and
        sends one sendBeacon to /_office/tap on the page's own origin, falling back to a keepalive fetch whose failure is swallowed.
        Offline the beacon just fails and the call still goes through.
      - The route. /_office/tap takes only the page's own origin and a public project, and always answers 204. The row it keeps is
        floor, project, page path, the number (digits and a leading + only) and the time; nothing else, no address, no browser.
  - Not counted:
      - Bots, by the same pattern as visits.
      - A repeat of the same tap from the same device within 10 seconds.
      - Another site's request.
      - A private project.
      - The floor's boss and the admin: their device is remembered while they use the Office (any signed-in request notes a salted hash
        of address and browser, in memory only, for a day; the salt is new on every start). A tap from a remembered boss device on that
        boss's floor, or from the admin's, is not counted. The ETag carries "-t" so switching it on or off isn't hidden behind a 304.
  - The Numbers tab (server/numbers.js calls { week, ever, show }; public/js/numbers-ui.js) shows "Calls tapped: N this week". The week
    starts Monday 00:00 New York, as the digest counts it. It appears once the company has a tel: link published or a tap on record.
  - The owner's digest gets a line, "Calls tapped this week: floor 6 TheTireRx 3; ...". It covers every business floor (an active
    business journey, or business work as its latest lane) and any floor with a tap this week.
  - Job 26's ranked view counts taps in real use (windows[n].parts.taps), from the same table.
  - Switch: TAP_COUNT=0 stops adding the script and counting.
  Proved in test/taps.test.js, 6 tests:
    - The beacon on the page:
        - one script on the tel: page and none on a plain page, with the page's own script untouched and no third-party script;
        - /_office/taps.js is served;
        - the script never stops a tap or throws, and swallows a failed send;
        - it is added once.
    - Counting:
        - a visitor's tap counts once, and the same tap again does not;
        - a Googlebot tap, a foreign-origin tap, the boss's tap (after the boss used the Office from that browser) and the admin's do
          not count;
        - another visitor on another page does;
        - the rows hold only id, floor, project, path, number and time, with no IP or browser string.
    - "a private project is never counted, and TAP_COUNT=0 adds no script and counts nothing".
    - Numbers are kept as digits with a leading +.
    - Where the count shows: the Numbers tab gives calls { week: 2, ever: 2, show: true } and the page code says "Calls tapped: N this
      week"; the digest has "Calls tapped this week: floor N ... TheTireRx ... 2."; the ranked view has parts.taps 2.
  Browser check, real Chromium on a 390x844 phone at <label>.apps.localhost: tapping the tel: link on a published page recorded one row
  (shop, /, +15550102000). The page's own script, a separate /own.js, still worked, and there were no page errors.
TESTS: npm test 1832/1833 (6 new). The 1 failure is domains.test.js's IPv6 test (EAFNOSUPPORT ::1: no IPv6 on the box; it fails the same on office-nobudget). The page's ETag gets "-t" before the chat part, so test/chat.test.js's "-chat" ending holds. Browser: the Chromium tap check above.
DEPLOY NOTES: Migration (lane A block in db.js): table tel_taps. New env TAP_COUNT (default on; 0 turns the beacon and counting off).
  Nothing to run after deploy. Pages already published get the beacon at serve time; nothing is republished.
RISKS:
  - Telling the boss and Colon apart: the published site's origin never sees the Office's cookies, so their own taps are recognised by
    the device they last used the Office from (same address and browser, within a day, remembered in memory only). A boss tapping from
    a phone they never signed in with, or after a server restart before signing in again, would be counted. A customer on the boss's
    own wifi and browser make would not.
  - A tel: link the page adds with its own script after load is still counted (the listener is on the document). A page that sets
    Content-Security-Policy itself is unchanged: the Office's own CSP already allows same-origin scripts and requests.
  - A tap is counted when the link is tapped, not when a call connects. That is all a web page can know.
  - Lane B file touched: server/owneralerts.js gets the calls line in the digest (a few lines). The Numbers tab code (server/numbers.js)
    gets the calls figure.
  - Nothing found in round 1 code that limits spend in a forbidden way.
