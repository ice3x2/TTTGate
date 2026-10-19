# Issue18 explicit session idle policy

Status: complete; source9fe3728 -> main563795955855687f01f6644a8310278c764e42b8 pushed/remote verified; root integrated six suites71PASS201.501seconds and separate req09twoPASS7.594seconds/buildPASS; CLOSED2026-09-08T12:36:35Z comment5585232482 Telegram3992(67/58). Earlier pending implementation/review/closure statements are historical.

- [x] Approved design/source reuse. Status: existing timer/live gate, config validation/72load protection and runtime snapshot/35rollback reused.
- [x] Actual RED before five-file minimum implementation. Status: initial13FAIL and corrected expanded15FAIL after all five task files restored; receipts below.
- [x] Real timer/API/rollback regressions and build. Status: exact separately dated receipts below.
- [x] Independent two reviews. Status: both final reviews PASS; root integrated/pushed/closed and notified3992 as recorded above.

Contract: sessionTtlMs default3600000/0disabled/positive1000..3600000; normal invalid config returns result before mutation. Existing configure invalid RangeError remains direct caller contract. EffectiveTTL/scan snapshot and live positive0positive preserve actual LKG/pending baseline; TTLonly never restarts listeners. No new control activity/heartbeat/ServerApp/EOF/pool/40 policy.

## Live checkpoint and failure history

Initial27914/b237ab13FAIL11.922s before source; missing resolver/policy/default and accepted invalid API TTL failed. First minimum candidate66714/585a02 passed12/failed1 in15.475s. Remaining failure was fixture's incorrect500 expectation for existing runtime-apply failure400; diagnostic44444b/fad439/45c3fd preserved that classification and existing message Unable to apply server option. No production response-code policy changed.

All five task production files were saved as candidate patch then restored to branchHEAD before correcting the API expectation and adding invalid-YAML/restart controls. Corrected86681/de486f15FAIL43.074s preceded reapplication. An extended failed execution can include setup/cleanup delays; missing API and native0rejection are not success evidence. Reapplied candidate77684/5d4719 passed14/failed1 in18.426s: actual close/start left timer undefined. Only then successful start clears its existing _closed flag, preserving stop/configure-no-start behavior. No new scheduler/heartbeat.

Focused66562/6bc148 naturally exited0: two suites17PASS3filtered26.781s; explicit selected req09TTL cases plus dedicated15. Sequential forcedbuild exited0 with existing npm always-auth warnings only. No live handle remains at this checkpoint. Existing req09zero-range assertion now verifies disabled0; negative/NaN added, other guards and explicit1000/200 idle control retained. Broader admin/store recovery regression36217 is running and its final result is not yet claimed.

Commands: dedicated baseline/candidate `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/session-idle-policy.test.ts`; focused uses that path plus test/e2e/req-09-pool-swap-zombie.test.ts with `--testNamePattern='TTL|idle|effective interval|invalid YAML|start after close|configureSessionTtl'`, then `npm run build -- --force`.

Untracked workspace config/.bootstrap-token investigated by metadata only, never contents: exact path C:/Work/git/_Snoworca/TTTGate-epic61-process/config/.bootstrap-token, creation/modification2026-09-08T12:02:41.3891395Z,64bytes. Timestamp falls within this task's failed-run period; SessionStore singleton creates a token under current Environment, and fixture reset can restore workspace Environment. No execution receipt currently proves which delayed callback created it. Ownership remains uncertain: retained untouched, not staged/published/deleted; root notified. No source/user files were restored outside the five task files.
Broader36217 command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/session-idle-policy.test.ts test/unit/server/ServerOptionStore.test.ts test/unit/server/ServerOptionStore.revision.test.ts test/component/server/admin/configuration-rollback.test.ts test/component/server/admin/compound-tls-save.test.ts test/component/invalid-config.test.ts. No repeated full-suite/benchmark run.

## Final frozen implementation/evidence

- [x] Broad recovery/config regressions. Status:36217/9d390e six suites71testsPASS198.303seconds naturalexit0, before the final direct-undefined caller guard below. This does not claim every project test or the skipped req09nonTTL cases passed.
- [x] Preserve direct programmer-argument contract. Status: after broader completed, explicit configureSessionTtl(undefined) compatibility assertion159ab1 failed1/14filtered3.14s: shared config default had inadvertently allowed direct missing argument. Added only a direct undefined RangeError guard; normal config/API undefined still resolves1hour through result validation, no exception-based normal validation flow.
- [x] Final affected paths/build. Status:91992/90c407 two suites17PASS3filtered26.64seconds naturalexit0, then forcedbuild exit0. Includes real disable/re-enable/refresh/expiry and close/start timer lifecycle, actual API TTL-only apply, pending baseline effectiveTTL/scan rollback, invalid API/YAML preservation and req09explicit range/idle cases. No production edit after this run.
- [x] Two independent reviews. Status: review_wave0 and fix_lint_diagnostics final PASS, zero remaining findings; root integration/push completed; closure/notification pending.

Production: shared default/result TTL validation; Store normalized TTL/default and72invalid-load reuse; TunnelServer detached effective pair, pair validation before mutation, implicit interval bounds, live disable/re-enable and actual start/close flags; TTTServer startup/apply/capture/restore with session-ttl scope and nonrestart control classification; AdminServer hot-apply classification. Actual invalid config is rejected before persistent mutation, while existing direct invalid argument throws remain caller invariants. No ServerApp, control-packet activity, new heartbeat, generic pool, EOF or40policy changes.

Rollback test uses a disclosed after-real-apply failure result, not a naturally occurring runtime error. It checks real HTTP API behavior and snapshots preserving committed YAML/current/LKG/pending while restoring actual live1234msTTL/200msscan and scope identities, not reconstructing scan from committed values. Terminated sessions are never recreated by the policy. Existing real fixture echoes prove active control/data survive TTL-only apply; one-hour default is a configured numeric assertion, not an hour-long survival measurement. All runtime roots/socket cleanup remain owned except the separately disclosed workspace artifact.

Exact proposed title: `fix: 세션 유휴 제한을 설정하고 실제 적용 상태 복구`.

## Final independent review receipts

Root confirmed review_wave0 and fix_lint_diagnostics final code/content/exact-title PASS with zero remaining Critical/High/Medium/Low findings. The stale default60-second comment was corrected to1hour and review_wave0 reread that exact comment; no functional or test change accompanied it. Neither reviewer executed additional tests in final review.
Original broader71PASS before direct-undefined guard, later17PASS/build after that guard and earlier baseline/setup failures remain separate unchanged receipts. Review confirms normal result validation versus direct caller invariant errors, real timer lifecycle/TTL-only apply and actual TTL/scan/pending recovery; no hour-long measurement or terminated-session resurrection is claimed. This entry changes only the ledger. Source/test and the excluded unknown workspace artifact were not accessed or modified by this recording action; root integration/push completed; closure/notification pending.

## Root integration execution receipts

- [x] Integrate, verify, build and push. Status: source9fe3728 -> main563795955855687f01f6644a8310278c764e42b8; root push/ls-remote receipt a3c42a confirmed matching hash.
- [x] Root integrated regression. Status: session28975 terminal ca0be0 exited0 naturally, six suites/71tests PASS201.501seconds. Selected paths: test/component/server/session-idle-policy.test.ts, test/unit/server/ServerOptionStore.test.ts, test/unit/server/ServerOptionStore.revision.test.ts, test/component/server/admin/configuration-rollback.test.ts, test/component/server/admin/compound-tls-save.test.ts, test/component/invalid-config.test.ts.
- [x] Separate req09 TTL control and forced build. Status: a1900f exited0, two PASS/three filtered7.594seconds for test/e2e/req-09-pool-swap-zombie.test.ts with --testNamePattern TTL; forcedbuild8eb7a1 exited0. Separate receipts, not an invented combined73-test run.
- [x] GitHub closure and notification. Status: root confirmed CLOSED2026-09-08T12:36:35Z/comment5585232482 and Telegram3992(67/58), receipt66ac13/tool verified.

Root supplied these objective execution receipts for this recording. They supplement rather than replace author71PASS198.303 and final17PASS26.64/build history. Source/test and excluded unknown bootstrap artifact remain unchanged/unread. Another reviewer must independently confirm this ledger-only update.

## Final operational completion

- [x] Completion receipt recorded. Status: root confirmed issue18 CLOSED2026-09-08T12:36:35Z, comment5585232482; exact Telegram3992: `TDD Gate 18 유휴 터널 세션이 60초마다 강제 종료됨 (67/58)`. Source9fe3728 and integrated563795955855687f01f6644a8310278c764e42b8 are remote-verified. Current completion58of67. Original counts, separate test receipts and failures above remain unchanged; no additional execution or artifact access occurred for this update.