STATUS: GREEN
JOB: r2-j57 Launch checklist
DONE MEANS: "Launch is blocked on a test site with a broken form and allowed once it is fixed." Proved:
  - test/r2-launch.test.js "DONE MEANS: Launch is blocked on a test site with a broken form and allowed once it is fixed; work in progress still
    publishes": a real maker job (mock mode) built and passed by the Tester; a sign-up form that sends nowhere is put on its main page; the boss's
    Launch tap answers 400 "Not launched yet. Fix this first, then tap Launch again. Form test arrives: The form sends nowhere." and nothing launches;
    the boss's checklist route says blocked: form. The form is fixed to send to the building's form handler: Launch answers 200, the job is
    launched, the checklist's test entry arrived and was taken out again (0 entries left in the boss's list).
  - "eight checks by code; a good site passes all eight"; "the three that block: no HTTPS, a broken form, a broken link on the main page" (an http
    address; a form that sends nowhere; a test entry that does not arrive; a missing page of the site's own; a dead link to another site; the
    building's own _office/ and _data/ paths are not broken; a building on localhost is not held for HTTPS); "the five warnings" (slow on a phone,
    a 1,200 px page, no preview tags, no icon, no 404 page); "no form at all is fine"; "the checklist gates Launch only: a staff publish of work in
    progress with a broken form still goes up"; "LAUNCH_CHECKLIST=0: the checks still run and are kept, nothing is held".
How it works: server/checklist.js. runChecklist() runs the 8 checks on the project's files: speed (the main page and its own assets at slow 4G,
  1.6 Mbit/s and 150 ms, under 3 s), phone fit (device-width viewport, no fixed width over 600 px), links (every a/img/script/link on the main page:
  the site's own must exist, another site's must answer through the guarded fetcher safeFetch), form (each form on the main page must send to the
  building's /_data/v1/form/<name>, which takes one real test entry through handleData and then deletes it, or to an outside address that
  answers), preview tags (og:title, a description, og:image), icon, 404.html, HTTPS (the live address). It wraps engine.makers.launch (the Launch
  tap, as legal.js does): no HTTPS, a broken form or a broken main-page link refuses with the reason; warnings never hold. Results are kept in
  launch_checklists for the boss (GET /api/floors/:slug/launch-checklist/:project) and for r2-j58's mark.
TESTS: node --test test/r2-launch.test.js 7/7; test/makers.test.js 32/32, launch.test.js 71/71, business.test.js 17/17 with the gate on. Full npm
  test: see LANE-R2-A-FINISHED.md. Browser: none (server; the refusal shows as the Launch tab's existing toast).
DEPLOY NOTES: Migration in the `// redesign r2 lane A` block: CREATE TABLE IF NOT EXISTS launch_checklists. New env LAUNCH_CHECKLIST (default on;
  0 = never held). Links to other sites are fetched from the server through safeFetch (6 s timeout, no private addresses).
RISKS: The gate is on the maker Launch (the Launch tab's tap). The Business journey's step 4 "Launch" is about ads and was left alone. The checks read
  the project's current files, which at Launch are the version the Tester passed in nearly every case. A building on localhost is exempt from
  HTTPS (local runs and tests); on the live building every address is https. A dead outside link holds Launch: if a partner site is down at that
  moment, the boss waits or removes the link.
