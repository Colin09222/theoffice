STATUS: GREEN
JOB: 22 Business tab
DONE MEANS: "Numbers, Orders, Payments, Inbox and Launch live under one tab."
  - Boss only: the separate Inbox, Payments, Orders and Numbers tabs (and the Business journey tab, while a journey runs) are now sections of
    one Business tab (public/js/floor-ui.js bizSections): Journey (while active), Numbers, Orders, Payments, Inbox, Launch. Each section is
    the same panel as before (renderNumbers, renderOrders, renderPay, renderInbox, renderBusiness): nothing removed. Launch is new as a place,
    not as a feature: each project's launch checks, visitors, sign-ups, payment link and report, exactly as on its project card (launchBits).
    The Business tab carries the Inbox's unread count; it opens on the section last looked at; Requests and Servers keep their own tabs.
    A visitor has no Business tab (and never had Numbers).
  - Proof: test/browser/biztab.mjs (npm run e2e:biztab, real Chromium): boss tab row = chat,talk,work,tasks,projects,biz,requests (no
    numbers/orders/pay/inbox); sections Numbers, Orders, Payments, Inbox, Launch; each section opens its panel under the Business tab;
    visitor: no Business tab; 0 console errors. test/biztab.test.js checks the same from the source.
  Screenshots: docs/redesign/jobs/j22/shots/business-boss-desktop.jpg and the usual set.
TESTS: npm test 1731/1732 (the one failure is the IPv6 test, environment). Browser: biztab.mjs all passed; redesign-shots.mjs 18 shots, 0 console errors.
DEPLOY NOTES: none (no migration, no env var).
RISKS: Anything that opened a tab by id (a toast, a room pin) still works: setTab accepts the section ids. Browser suites that click the old
  tabs by their place in the row (test/browser/numbers.mjs, mail.mjs, pay.mjs) may need the Business tab clicked first.
