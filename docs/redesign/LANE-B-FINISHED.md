# Lane B finished

One line per job: NN, branch, STATUS, head SHA (the job's DONE.md commit). Each branch is stacked on the one above it, starting from office-redesign-base.

- 04, office-j04-rehold, GREEN, 9ad1c901404d
- 05, office-j05-budget, GREEN, 9403d6456d3c
- 06, office-j06-digest, GREEN, dbfd4007e986
- 07, office-j07-caps, GREEN, 40b20e405ace
- 08, office-j08-gaps, GREEN, 4440cf9fb175
- 09, office-j09-donemeans, GREEN, 2b9a5e47c474
- 10, office-j10-loop, GREEN, ce23ccba4cac
- 11, office-j11-smoke, GREEN, 439ee7abc93a
- 17, office-j17-tiers, GREEN, 1c33c0557429
- 18, office-j18-context, GREEN, cdcb8eb87aa1
- 19, office-j19-manual, GREEN, ea1aa827a7eb
- 27, office-j27-roles, GREEN, d7bd1a689aac

Known in this container on every branch: domains.test.js "the key only travels over TLS, in the body, and over IPv4" fails with EAFNOSUPPORT (no IPv6 here); it fails the same on office-redesign-base. Two date-dependent tests (googleads.test.js and business.test.js "ends within 7 days") failed on base too during some hours of this run.
