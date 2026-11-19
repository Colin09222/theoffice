STATUS: GREEN
JOB: r2-j53 Heartbeat, asleep, away
DONE MEANS: "With no heartbeat for 15 minutes the sign reads 'Away'; during the freeze it reads 'Back at 08:00'." (Q19, section 3 states in order:
  asleep, away, busy, inbox waiting, free.)
  - Reuses the existing Mac heartbeat; no Mac script added, nothing calls a model. server/macbeat.js reads MACBEAT_FILE (default
    /run/macbeat/last) at most every 10 s and parses only recv_ts; fresh = within 15 minutes. A missing, empty, odd or unreadable file is not
    fresh (Away) and never throws. The other fields (mac_ts, gw, disk_gb, pc) are never parsed, kept or shown.
  - docker-compose.yml: the theoffice service mounts /var/lib/macbeat at /run/macbeat read-only.
  - /api/mailroom's robot: asleep when the engine's night freeze is on (sign "Back at 08:00", whatever the heartbeat), else away with no fresh
    heartbeat (sign "Away"), else busy / waiting / free from the items. Asleep: on its dock, lamp off; Away: on its dock, lamp on.
  Proved in test/r2-heartbeat.test.js (4 tests): only recv_ts is read and 14 minutes is fresh, 15 min 1 s is not; missing/empty/odd/directory;
  on a fake clock: fresh = free, 17 minutes quiet = Away, 23:30 New York with the freeze = "Back at 08:00" even with a fresh beat, freeze off =
  free; nothing of the heartbeat in the reply; no file at all = Away and a 200; the compose mount.
  Browser (on this stack): the heartbeat file aged 16 minutes, the robot card's sign read "Away" within the next readings.
TESTS: npm test (full) at the r2-j50 code head (4ff1a4c): 1893 of 1895 pass. The 2 failures: domains.test.js IPv6 (no IPv6 in this container; fails the same on office-r2-base) and test/r2-tower.test.js poll line (fixed in r2-j36 before any push). Since then, every test/r2-*.test.js and the files this job touches, run on this branch: all pass.
DEPLOY NOTES: docker-compose.yml gains a read-only bind mount /var/lib/macbeat:/run/macbeat:ro on the theoffice service: recreate the container
  (docker compose up -d theoffice) after deploy. New env MACBEAT_FILE (default /run/macbeat/last). Without the mount the robot shows Away.
RISKS: Away shows within 15 minutes plus up to 10 s (the file is re-read every 10 s) plus the page's 5 s reading: inside the 16-minute target.
