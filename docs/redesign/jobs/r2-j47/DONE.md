STATUS: GREEN
JOB: r2-j47 Job event log
DONE MEANS: "Every job stores its events with times for at least 30 days." Proved:
  - test/r2-room.test.js "DONE MEANS: every job stores its events with times: card, tasks, handoffs, talk beats and the launch": a real mock job
    ("go build soup finder", run to the end): job_events holds card, task, handoff, talk and launch events, every one tied to a job card, in time
    order with its time; task events name their task and carry its status (doing, then review/done).
  - "kept for at least 30 days": events 29, 31, 34, 36 and 60 days old; a prune at 35 days keeps 29, 31 and 34; JOB_EVENTS_DAYS defaults to 35 and
    is never taken under 30 (10 becomes 30).
  - "JOB_EVENTS=0 records nothing".
How it works: server/eventlog.js wraps engine.emit (as jobcards.js wraps emitTask). Each event that belongs to a job is kept in job_events:
  'task' (status, title, who), 'beat' as 'check' (passed, who), 'handoff' (from, to), 'talk' beats assign, handoff, findings, review and plan (the
  words, plus the visitor's version and the hush flag the live talk carries), 'project' as 'launch', and the card's own changes ('jobcard').
  A job is a job card (jobKey); handoffs and talk lines go to the job of the person's latest task. An hourly prune drops what is older than the
  keep. The floor's own events table is untouched (it still keeps its last 1,500).
TESTS: node --test test/r2-room.test.js 35/35 at this commit. The full npm test on this stack is reported in LANE-R2-A-FINISHED.md.
  Browser: none needed (server only).
DEPLOY NOTES: Migration: one `// redesign r2 lane A` block in server/db.js (LANE_A2_SCHEMA): CREATE TABLE IF NOT EXISTS job_events and two indexes;
  run on every start, nothing to do by hand. New env JOB_EVENTS (default on), JOB_EVENTS_DAYS (default 35, minimum 30). Jobs from before the deploy
  have no log, so Replay (r2-j48) can only play jobs that start after it.
RISKS: The log is raw on the server (whole titles and words); whoever reads it applies the visitor's rules (r2-j48 does). Rows grow with work; at
  today's pace that is a few thousand rows a month.
