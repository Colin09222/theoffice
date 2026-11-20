# Lane B, round 2: finished

Built on office-r2-base under docs/redesign/ROUND2.md and OFFICE-ANSWERS-2.md. Mock mode only; no keys; no budget rules anywhere.

Job, branch, status, head SHA (the branch's DONE commit):
r2-j33, office-r2-j33-hero, GREEN, 311d3f55278fd16393184df244b1928d32db5287
r2-j34, office-r2-j34-sound, GREEN, 13bd22810249583d7e4a50a1dfdf0c656396b833
r2-j35, office-r2-j35-light, GREEN, 3659bc52a5249a151fbdd531287b575cad1e7c8e
r2-j36, office-r2-j36-tower, GREEN, 0780caac93b70260fb5d17ce9ecb5758c35fe16c
r2-j37, office-r2-j37-billboard, GREEN, fae316ab8f68441b25d2026830dbe94c14a969db
r2-j38, office-r2-j38-flyin, GREEN, 6f9f7a3f5dc2d9afab8fe200c10591cf64c6ab85
r2-j43, office-r2-j43-sounds, GREEN, 53ff952e447fd845075d41269fb6e36c994b0140
r2-j49, office-r2-j49-feed, GREEN, 89e0dd431fdadc124e917336d319ca5f28f3ff9c
r2-j50, office-r2-j50-mailroom, GREEN, 0a9e9fef7527ddd1ab32cee857a5cf0e78b65cac
r2-j51, office-r2-j51-folders, GREEN, 9cff9daec824ff3b0f1f08c9b9b5989f6b493595
r2-j52, office-r2-j52-stamps, GREEN, 218e1034c796e2a6022362a42e3da8b25c2674a4
r2-j53, office-r2-j53-heartbeat, GREEN, 2458b1deb0c6052bb6ad45ffeecf92de7b954919
r2-j54, office-r2-j54-audience, GREEN, 5619882d389766a1373ca53b5cd2ecde15aa8eeb
r2-j55, office-r2-j55-delivery, GREEN, 15c6d208d4550eb7367b74df4fcb314535e7129c
r2-j56, office-r2-j56-truth, GREEN, 576cfd04c33baf49a110e87d68d447434107f1e9
r2-j61, office-r2-j61-alerts, GREEN, 10c6217498b7d7bee582ef06fba2ddc817d57a0f
r2-j62, office-r2-j62-report, GREEN, dc3adbc59568a0583189875124cff66dc02ded83
r2-j64, office-r2-j64-proposals, GREEN, d89f284616e655915ace10a7b941b76ee01dabcb
r2-j65, office-r2-j65-didit, GREEN, 583f6c6fc184705ec3f08aa571c02d57ed71ba96
r2-j66, office-r2-j66-thisweek, GREEN, 550d840d97955463f6ccb21306dd16e49305e54c
r2-j68, office-r2-j68-friday, GREEN, db6e26a497eec86205f2f31197d3d0046d7f74fa
r2-j72, office-r2-j72-december, GREEN, 98735a20ab42333a193b44d36558eac04499afe2

Tests at the r2-j72 head (98735a2, before this file): npm test 1934 of 1936. The 2 failures happen the same on office-r2-base in this container:
domains.test.js "the key only travels over TLS, in the body, and over IPv4" (no IPv6 here) and launch.test.js "launch_check can't wipe what
publishing recorded" (claim 408 right after the stalled-page test; base fails it identically, run alone). Every test/r2-*.test.js: 84 of 84.
Browser: npm run e2e:r2-building (new) passes all 31 checks at the r2-j72 head. onboarding.test.js's 3-minute real-browser walk runs 170 to
196 s in this container and also fails on office-r2-base (193.7 s); it passed in the final full run.

Shipped switched OFF (the orchestrator turns them on after Colon says yes): BOSS_ALERTS=0 and WEEKLY_REPORT_EMAIL=0 (r2-j61, r2-j62).
New switches, all on by default: HERO_FADE, LIVE_TOWER, MAILROOM, MACBEAT_FILE (default /run/macbeat/last), PROPOSALS, DID_IT_WORK, THIS_WEEK, FRIDAY.
Migrations: one "redesign r2 lane B" block in server/db.js, new tables only: boss_alerts, floor_proposals, change_checks, week_pages, weekly_reports.
After deploy: docker compose up -d theoffice (docker-compose.yml now mounts /var/lib/macbeat:/run/macbeat:ro for the heartbeat, r2-j53).
Floor 7 needs a boss address before alerts or reports can reach it (admin.mjs mail boss-email).
Lane A files touched, small and noted in each DONE.md: office-scene.js (r2-j35 setRoomLights hook; r2-j51 one import and one line for the tube
hook), timeline-ui.js (r2-j65, one line). Browser suites that count the lift's floor buttons now skip the new B button (r2-j50).
Checked and written in DONE.md: no "picked up" record exists for help, purchases or contractor jobs (so Busy and "On it." can't show yet); no
"already done" outcome is recorded (that line is left out); domain buying is the server's own broker, not buddehbot (no folder for it).
