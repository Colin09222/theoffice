STATUS: GREEN
JOB: r2-j48 Replay
DONE MEANS: "An idle floor offers "Replay" and plays its last real job in under 60 s with a visible Replay label." Proved:
  - Browser (room-r2.mjs j48): a floor that ran a real mock job ("go build tyre finder") and is now Idle shows "Watch how this was made" with its
    controls; a click plays that job: all 40 of its real logged steps played, in room mode (desktop, ?q=mid), finishing in 59.8 s by the replay's own
    clock (planned 55 s; this software renderer starves page timers, so the slack was used); the label "Replay · Thursday 16:19" was on screen and
    visible at every one-second check until the end. On a phone at low it plays as cards and photos only (data-mode cards). Pictures:
    r2-j48-replay.jpg, r2-j48-phone-low.jpg.
  - test/r2-room.test.js "a replay lasts 30 to 60 s whatever the job took, in the real order, long waits squeezed"; "the label" (New York time:
    "Replay · Tuesday 14:10"); "DONE MEANS (server): an idle floor with a finished job offers its replay; the replay is that job's real events, in
    order" (each step carries its job_events id); "a visitor never replays private work or a hushed line; the boss can; REPLAY=0 offers nothing".
How it works: server/eventlog.js replayFor() picks the floor's newest job card with 3 or more logged events that this viewer may see (a visitor
  never a private job; hushed talk dropped; names redacted as in live talk), adds its step photos (job_shots), and answers at
  GET /api/floors/:slug/replay; the snapshot's room.replay says whether there is one. public/js/replay.js lays the events on a 30 to 55 s timeline
  (room-rules.js replayTimeline: real order, long gaps squeezed) and plays them: task starts and finishes, handoffs, talk beats, checks and the
  launch in the room, the real timeline card changing as it did, and the photos appearing. A Stop button; real work starting stops it at once; at
  the end everyone goes back to their live state. Phone low: no room, cards and photos only.
TESTS: node --test test/r2-room.test.js 39/39 at this commit. Full npm test: on the r2-j41 tree 1871/1872 (only the IPv6 test); on this tree,
  see LANE-R2-A-FINISHED.md. Browser: room-r2.mjs j48 all passed.
DEPLOY NOTES: No migration (it reads r2-j47's job_events). New env REPLAY (default on). New file public/js/replay.js; CSS in office.css.
  Only jobs that ran after r2-j47 is deployed can be replayed.
RISKS: The offer sits with the floor's controls (bottom left on desktop), not on the status card, which is lane B's. The planned length is capped at
  55 s, not 60, so a slow device's late timers still finish inside a minute.
