STATUS: GREEN
JOB: r2-j69 Building library
DONE MEANS: "An entry with an email address in it is scrubbed, waits for Colon, and is readable by other floors only after his tap." Proved:
  - test/r2-library.test.js "DONE MEANS: ...": a manager's propose_library_entry with an email address in its lesson is stored with the address
    replaced by [removed] (the tool says private details were taken out), status waiting; another floor's read_library says nothing is approved;
    the admin list shows it; one admin POST approves it; then the other floor's Builder reads it inside <untrusted_data source="building
    library">, still scrubbed, and never told which floor it came from; a second decision on it is refused (409).
  - All 7 rules: "rule 3: code scrubs emails, phones, web addresses, prices and the floor's company, boss and customer names" (a form entry's
    name counts as a customer record); "rules 1, 2 and 4: a fixed form, 2 a week, and nobody but the admin decides" (a boss gets 401);
    "rules 5 and 6: only managers propose; the read tool is read-only, fenced, and the library is the only shared thing" (LIBRARY=0 takes the tools
    away); "rule 7: the seed is the launch checklist and Colon's own floors' launches, every one waiting for his tap" (LIBRARY_SEED_FLOORS=6,
    scrubbed of the floor's own name, seeded once).
  - Browser (room-r2.mjs j69): the admin page's Building library shows the waiting entry as text, scrubbed, with "1 private detail(s) taken out";
    one tap on Approve approves it. Picture: r2-j69-admin.jpg.
How it works: server/library.js (scrub, privateWords, propose, read, seed, the admin routes GET /api/admin/library and POST /api/admin/library/:id
  { action: approve | reject }); two tools in server/tools.js that only hand over to it: propose_library_entry (manager) and read_library (manager
  and Builder); public/js/admin-ui.js lists waiting entries with Approve and Reject. The seed runs once at start.
TESTS: node --test test/r2-library.test.js 5/5; budget 41/41, buildwell 24/24, roles 4/4, manager 37/37, context 2/2 with the new tools.
  Full npm test: see LANE-R2-A-FINISHED.md. Browser: room-r2.mjs j69 all passed.
DEPLOY NOTES: Migration in the `// redesign r2 lane A` block: library_entries. New env LIBRARY (default on) and LIBRARY_SEED_FLOORS (default empty;
  set it to Colon's own floor numbers, e.g. 6, before the first start so the seed includes their launches; the launch-checklist entry is seeded
  either way). After deploy: Colon approves the seed entries in admin (Building library); nothing is readable until he does. Files touched
  outside lane A's list: server/tools.js (two tool definitions, their place in the manager's and Builder's lists, two one-line handlers) and
  public/js/admin-ui.js (one section). The manager's prompt is unchanged: the tools describe themselves.
RISKS: Name scrubbing is by the floor's own words (company, boss, staff, customers' names from forms and orders); a name the floor never recorded
  can slip through, which is why Colon reads each entry before approving. Short common words are never taken out.
