STATUS: GREEN
JOB: 18 Builder context diet
DONE MEANS: "Average Builder call is under 80,000 tokens across 20 real tasks." (The orchestrator measures this on live; here it is proved on a replay.)
  What changed (BUILDER_DIET, on): the Builder gets the brief, its teammates' short reports, a list of the files in its project (path and size) and
  of their papers, and opens only what it needs; papers are no longer pasted in. Its run is trimmed at 240,000 characters (about 60,000 tokens)
  down to half (it was 400,000 and 150,000 for every cached model). A fix round on a computer past 80,000 tokens starts on a fresh computer (250,000
  for everyone else). Prompt caching: checked, it was already on for the Builder (server/anthropic.js buildRequest: a breakpoint on the system prompt
  and a moving one on the last block; the engine never passes cache:false for staff). Per-call recording: every ledger row now carries task_id and
  computer (1 for a computer's step), on top of its prompt_tokens; scripts/builder-context.mjs [--last 20] [--floor N] [--json] averages the last N
  real Builder model calls and splits computer from not.
  Measured (test/context.test.js, the same 24-call Builder job on a project with four notes files, a 160-line page and a 300-line script, its
  request JSON at 4 characters a token): diet off: first call 10,021, average 44,077, max 75,924 tokens; diet on: first call 3,439, average 25,598,
  max 44,574 tokens (average down 42%). No recorded prompts from live exist in the tests, so this is a replay, not a recording.
TESTS: npm test 1743/1746 on this branch before the job 10 and 11 test fixes beneath it. The 3: domains.test.js IPv6 (EAFNOSUPPORT ::1;
  fails the same on office-redesign-base, this container has no IPv6) and the two workers.test.js tests fixed on jobs 10 and 11 (42/42 after).
  Changed older tests: efficiency.test.js and computer.test.js test the building-wide fresh-computer threshold with BUILDER_DIET off.
  SESSION_FRESH_OVER_TOKENS=off stays off for the Builder too. Browser suites: not run (no page changed).
DEPLOY NOTES: Migration (lane B block): ledger.task_id, ledger.computer (old rows stay 0). New env: BUILDER_DIET (on), BUILDER_KEEP_CHARS (240000),
  BUILDER_FRESH_OVER_TOKENS (80000). After deploy, over the next 20 real Builder tasks:
  docker compose exec -T theoffice node scripts/builder-context.mjs --last 200
  (a task is several calls; 200 calls is roughly 20 tasks). The target is an average of 80,000 or less.
RISKS: The 211,000 average was most likely computer sessions (the Builder on a computer was 35% of spend). Inside one Managed Agents session the
  platform keeps the whole conversation, so the diet there is the smaller first message, the file list instead of pasted papers, and a fresh computer
  for a fix round past 80,000; a single long first build on a computer can still grow past 80,000 per step. If the live average stays high, the next
  lever is a lower SESSION_FRESH_OVER_TOKENS-like rotation inside a run, which needs the platform's compaction. Trimming sooner means more cache
  writes on long staff runs; the window is still large enough that a cut is rare.
