# Lane A, round 1 rest: finished

Built under the owner's no-budget ruling of 2026-11-19 (docs/redesign/ROUND1-REST.md), stacked on office-nobudget.

| Job | Branch | Status | Head |
|---|---|---|---|
| 34 Own spend behind a tap | office-j34-ownspend | GREEN | b2f21f415f20909003b2eae86e63cc5622b7d01e |
| 26 Colon's ranked view | office-j26-ranked | GREEN | 89f1e6e123394b017351d604cb11e756114d65df |
| 33 Tapped calls | office-j33-taps | GREEN | 0622ec3e8380146453f8efc875f688cdfa74e282 |

npm test on the last branch: 1832/1833. The 1 failure is the IPv6 test (no IPv6 on the build box; it fails the same on office-nobudget).

New env (all default on): OWN_SPEND, TAP_COUNT. Migrations (lane A block): floor_marks, rank_log, tel_taps. Nothing to run after deploy.
Also fixed on the way (job 26): the admin page loaded blank on a direct visit since job 14 (stage.setView with no stage running).
Lane B files touched, briefly: server/owneralerts.js (the digest's priority and tapped-calls lines) and server/numbers.js (the calls figure).
No round 1 code that limits spend in a forbidden way was found. The status card's empty fuel-gauge and approve-plan places (job 15) can go.
