# Issue73 endpoint graceful response drain

Status: complete; source15bd288 -> main674a9ea pushed/remote verified7cb95c. Root29PASS47.151s/buildPASS; original53 after73 normal1PASS13.628s separately. CLOSED2026-09-08T16:04:50Z comment5588150678; Telegram3997(68/61).

- [x] Read exact main73 design and notification clarification. Status: normal endpointEOF flushes existing output, omitted/abort mode stays cleanup-only, no new FailOpen or duplicate CloseSession.
- [x] Observe focused real cache/native pressure RED. Status: original3RED and corrected expanded contracts observed before final candidate; detailed receipts below. Fixed suite30s per case; native wait5s, response completion10s. Payload8MiB (smaller than original32MiB), local16MiB/global64KiB fixture limit restored; original53 remains separate immutable production evidence.
- [x] Implement minimum approved3client hunks. Status: endpoint terminal ownership/mode and captured upper-owner forwarding; TunnelClient existing native end_ flush and old drain identity guard.
- [x] Independent reviews. Status: review_wave0 reviewed the original candidate; fix_lint_diagnostics and review_cert_conflict reviewed the final separate-fixer M2 changes with no remaining findings. Root commit/integration and original53 verification subsequently completed; see final operations below.

Writable production: src/client/EndPointClientPool.ts, src/client/TTTClient.ts, src/client/TunnelClient.ts necessary terminal/identity hunks only. Dedicated endpoint-graceful-drain.test.ts, small owned fixture if needed, ledger73. No SocketHandler/queue/cache/protocol/timer/serverExternal/29 change. Original53 request32MiB exact but response shortage2359296 matches immediate destruction queue; new tests must exercise new contracts before source.

## Historical TDD checkpoint

Initial067f0c/693c13 focused3FAIL13.944seconds naturalexit1: actual8MiB cached response never reaches externalFIN within10s, actual endpoint End and reset each dispatch two terminal states. Then minimum3client candidate0e3ede/0937bf passed3 in13.422s naturally. Additional default-abort cleanup-only and actual same-SID endpoint replacement controls c0e1b1 passed2/3filtered3.289s against that candidate; no new production change accompanied those tests.

To preserve full test-first evidence for expanded identity contracts, saved the complete3file candidate patch under C:/Users/beom/AppData/Local/Temp/drain73-contract-a9e51d246c074713a00372c83046b4ad and restored ONLY those task files to branchHEAD. Expanded95769/987fab naturally exited1 with5FAIL/1PASS28.818s; Node19616/parent17376/currentcommandline captured7cf9c8. Original3 behavior failures and old-endpoint replacement failure are reproduced; default abort is a baseline compatibility PASS. The fifth remote-close drain test failed to establish a pending callback and is a fixture-precondition failure, NOT accepted stale-drain RED. It now prepares native socket.cork/uncork to hold an actual native write completion while receiving the separate control packet; this has not yet run.

Root reported concurrent short #58 structural validator execution12204 during the tail of this run. That overlap is environmental context, not an attributed cause of any functional failure. No process was killed;73handle is terminal and further test launch waits for coordination. Production is currently restored baseline; no copy/installation/mutation/deletion of shared node_modules junction. Next: observe corrected remote-drain precondition RED, reapply the preserved minimum candidate, then only test-first fixes for remaining failures and focused/owner/fault regressions.

Corrected native-cork selected RED ca2807 naturally exited1:1FAIL/5filtered3.35s. Native socket.cork holds a real pending write while an actual control CloseSession registers its existing drain callback; a real same-SID replacement then receives an incorrect old endpoint-close callback when old.destroy dispatches failed drain (expected0/actual1). This replaces the earlier nontriggering fixture precondition as valid stale-drain RED. No payload counter/fake handler/limiter replacement. Three-file candidate re-applied only after expanded baseline and this selected RED, then existing remote-close callback gained exact handler/map/live/success/drained guards. Endpoint connection/disconnection diagnostics retained. No new test execution during the root-reserved58 window.

## Final frozen candidate and execution

- [x] Final five-suite regression/build. Status:87df3b/21676/1accd2 naturally exited0; five suites32testsPASS70.656seconds, then forcedbuild exit0. Dedicated six-case suite18.787s, existing data-terminal16.823s, client-owner34.692s, plus socket-owner-terminal and connect-race controls. No post-run source/test changes. Node56420/parent55076/creation+exact argv were captured7b1468; final read-only bb4422 found no current process at that PID. No process termination.
- [x] Two independent reviewers. Status: completed as recorded in the final review checkpoint; the earlier five-file freeze comprised: three approved client production files, dedicated endpoint-graceful-drain.test.ts and ledger73. No new fixture file needed; existing withClient/real server/endpoint helpers reused. Root later completed commit and original53 integration regression as recorded below.

Exact command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/endpoint-graceful-drain.test.ts test/component/client/data-terminal.test.ts test/component/client/client-owner.test.ts test/component/socket-owner-terminal.test.ts test/unit/client/req-14-connect-race.test.ts`, followed by `npm run build -- --force`. Existing npm always-auth warnings only. This run began after root confirmed58window terminal; the earlier short overlap remains separately recorded.

Production SHA256 before/after final execution unchanged: EndPointClientPool0F9810A705B021A002BE87F9CFAE3143BAAC625660FA73B4262BCC08C2BF0E2C; TTTClient5B1CE1EAAE47B40CECAE673F023273FDD3CEB50FBDA5B501375A0E9B87B4194C; TunnelClient5B5F86DDC16A983C6F466267E110D505E01DA29370FBC6F714443E5A0F4DA5E5.

Endpoint native End/Closed now dispatches one state/termination per captured endpoint owner; normal EOF selects graceful only before terminal mutation, errors/forced closes select abort. Same-SID replacement invalidates prior endpoint tokens; posted callbacks and later native events cannot remove replacements. TTTClient forwards the optional mode through existing upper-owner capture. Omitted/default abort stays immediate cleanup-only, adding no new peer notification. Graceful live OnlineSession keeps its map while existing end_ flushes actual queues; only its drained/nonerrored native terminal suppresses duplicate CloseSession/endpoint-close. Actual faults keep existing native-failure paths. Existing remote-close drain callback verifies handler/map identity, success/live/real drain before touching an endpoint.

Six dedicated cases: real8MiB cached full-tunnel response/hash/FIN plus exactone CloseSession and pre-dispose global logical recovery; native endpoint End and actual RST each one terminal mode; default/explicit abort cleanup-only; real same-SID endpoint replacement while oldEnd posts termination; and actual queued native cork/write plus actual remote CloseSession before same-SID data replacement/old failed-drain callback. The last case routes only the replacement to an owned real TCP listener and holds later server CloseSession notifications as a disclosed identity fixture; it does not claim full authentication of that replacement. Cork is native buffering, not synthetic drain success. Existing24/25/race/owner tests cover pending faults, cleanup, old upper-owner callbacks and small drain behavior; at this historical author checkpoint original32MiB #53 had not yet been rerun; its later passing integration evidence is recorded below.

Shared node_modules junction is read-only and untouched; no install/delete/queue/timer/protocol/serverExternal/29 edits. Original53 raw failures and additional role trace remain preserved in their original worktree/E. Exact title proposal: `fix: 엔드포인트 정상 종료 후 대기 응답 전달`.
## Independent M2 graceful-admission predicates

Root assigned review_wave0 as a different fixer after fix_lint_diagnostics identified
explicit-close-wait EOF misclassification and already-drained graceful late ingress.
Before edits, Temp/graceful73-m2-cgwp3acz preserved all three candidate production
files and their SHA256 in before.json. Tests were prepared while #58's short contract
run was active but not executed until root confirmed its terminal result.

Selected RED command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/endpoint-graceful-drain.test.ts --testNamePattern 'explicit unsatisfied close|already drained graceful'.
2b39db exited1 naturally: two failed/six filtered,3.261seconds. Actual endpoint
closeWait=true/closeInitiated=false/sendLength0 with requested100 then native EOF
reported graceful instead of abort. The actual drained OnlineSession end_ fast path
accepted immediate same-turn late payload (true/write1 rather than false/write0),
and a real write-after-end error occurred. These are candidate behavior REDs, not
fabricated OS failures. Existing tests/counters were not weakened.

Minimum correction changes only two existing predicates: normal endpoint EOF also
requires !closeWait; TunnelClient.sendData rejects a current handler already in the
existing graceful WeakSet before writing/queuing. No SocketHandler/protocol/server
change, new state registry or notification policy. Existing omitted abort remains
cleanup-only. The new tests preserve actual peer bytes0, queue unchanged, one abort
mode/terminal state, map release and healthy sibling echo. Original32PASS remains
historical; expanded regression results follow separately.

Expanded GREEN command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/endpoint-graceful-drain.test.ts test/component/client/data-terminal.test.ts test/component/client/client-owner.test.ts test/component/socket-owner-terminal.test.ts test/unit/client/req-14-connect-race.test.ts.
Owned52392/3f78fa naturally exited0: five suites34testsPASS76.69seconds, including expanded8-case graceful suite22.192seconds. Sequential npm run build -- --force b9d707 exited0, existing always-auth warnings only. No source/test change after this run; production after copies/hashes remain in graceful73-m2-cgwp3acz/after.json. Original32PASS70.656 remains a separate pre-correction run, not relabeled.
Only two predicate hunks, two dedicated cases and this ledger changed by review_wave0. Original author remains review_cert_conflict. At that M2 checkpoint the candidate was frozen for review_cert_conflict and fix_lint_diagnostics rereview; both later reviews passed as recorded below. At that M2 checkpoint original53 large case had not been rerun; no wire/server/SocketHandler/global cleanup change or process termination.


Final review checkpoint: the exact title is approved as "fix: 엔드포인트 정상 종료 후 대기 응답 전달". Final34PASS76.69seconds/build0 is separate from historical32PASS and all RED/setup receipts. This recording does not claim original32MiB response/FIN completion; that root integration gate remains mandatory.

## Root completion operations

- [x] Integrate and verify. Status: source15bd288 -> main674a9ea, pushed/remote verified7cb95c; root29PASS47.151seconds/buildPASS. Separate original53 unchanged normal passed1 case13.628seconds, natural0, E large53-after73-YMRscw. Both32MiB SHA/FIN, pre-teardown recovery and sibling checks passed. Original32/34-test author runs and both original53 failures remain historical evidence.
- [x] Close and notify. Status: CLOSED2026-09-08T16:04:50Z comment5588150678, Telegram3997(68/61). Later53 fixture correction1PASS15.185seconds/1518pairs/12files is a separate review gate, not this original1534pairs/13files run.
