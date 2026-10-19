# Issue #46 — Packet-local metadata results

Status: complete; Joint final integration35a5d5f30c4b2e894ca9daf266c864bbc7871afa pushed/remote verified, sourcefdc4ad6;12suites/85tests PASS164.236seconds, natural exit0; forced build PASS. GitHub CLOSED2026-09-08T07:11:34Z, comment5580852898; root Telegram3976(66/45). Historical stage/review/pending statements below record the execution sequence; current progress SSOT is the main execution plan.
Approved research: main `epic61-client-control-research.md`. Four production files only: CtrlMetaGuards, CtrlPacket metadata readers, TunnelClient three sites, ClientHandlerPool two sites. #45 remains OPEN; joint closure requires both verified stages.

- [x] Read original issue, legacy getters and approved adapter/reuse. Status: reuse existing field predicates, SAFE_REVIVER and real handshake fixtures; sixth parseAckCtrlData fallback unchanged.
- [x] Observe result and all five live consumer syntax/schema RED. Status:54797 exited1 naturally,15failed30.6seconds before source changes.
- [x] Minimum shared validators/readers and packet-local branches. Status: four-file change; legacy wrappers reuse validators, approved native-only adapter, five live branches before mutation.
- [x] Focused regressions/build. Status:15focused and separate57compatibility PASS naturally, forced build0.
- [x] Two independent reviews. Status: final review_wave0 and fix_lint_diagnostics rereviews PASS, zero findings; root commit/integration pending.

Frozen proposed API: `MetaResult<T> = {kind:'absent'} | {kind:'invalid',reason:string} | {kind:'valid',value:T}`; new packet getters `syncCtrlAckMetaResult`, `newDataHandlerMetaResult`, `handlerWideIdMetaResult`, `messageMetaResult`. Optional empty permitted payloads are absent; Message empty is invalid. Legacy getters/assert functions retain throws by reusing nonthrowing validators. Native JSON.parse alone is inside the approved SyntaxError adapter; other exceptions propagate, schema/consumer logic uses conditions. Fixed reasons only, never native syntax text or raw credential JSON in diagnostics.

RED plan: real client Syncing bad SyncCtrlAck then valid same-owner handshake; connected bad NewDataHandler/Message then valid same-control packet and endpoint echo, no short-ID/tokenless fallback. Real authenticated raw-peer server bad Message/result then valid metadata on same control with pending/queue/sibling and normal ACK/echo preserved. Syntax and schema variants at each site, including coalesced continuation. Reuse withLegacyIds/withHandshake; receiving/deferred-send observers delegate actual methods, no fake endpoint success. Dedicated native-boundary injection proves non-SyntaxError propagation; existing schema/legacy/prototype tests stay intact. No producer, scanner, wire, generic socket or #28/#29/#40 policy changes.

RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/commons/metadata-result.test.ts test/component/client/control-metadata.test.ts`;54797 terminal1, two suites/15fail30.6seconds. Five additive-reader contracts returned undefined; all ten actual syntax/schema consumers failed connection-preserving assertions. Client failures entered generic procError1 rather than0; server cases failed valid same-batch sysinfo continuation after malformed metadata. Source was unchanged for this run. The SyncCtrlAck fixture temporarily delays the real server's normal reply until after bad-packet observation; it then delegates the original reply method using the same real handler. Other cases use actual socket coalesced writes and actual endpoint handover; no manual client reconnect.

GREEN97937: same command after minimum implementation passed two suites/15tests30.629seconds, natural exit0. Client invalid SyncCtrlAck leaves original handler/id/Syncing until actual valid reply; invalid NewDataHandler makes no data-connect call; Message continuation remains on same control. Server bad Message/open-result retains real queued marker/pending identity, processes following valid sysinfo, then completes normal OpenSession/result/ACK and delivers queued bytes plus later echo. Both syntax/schema branches at each live site are exercised, and separate raw sibling echo is preserved in connected/server cases.

Native-boundary control replaces JSON.parse only within a finally-restored unit injection and confirms non-SyntaxError TypeError propagation. This is disclosed boundary injection, not a mock network/parser-success claim. Legacy SAFE_REVIVER and public throwing getter behavior are retained by shared nonthrowing schema validators; parseAckCtrlData's separate optional-v2 fallback is unchanged. One decode per new live site; no raw JSON/native parser message logged on invalid results.

`npm run build -- --force`953422 exited0. Compatibility47559:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/commons/r2-req-04-meta-schema.test.ts test/commons/ctrl-read-result.test.ts test/component/client/control-framing.test.ts test/component/server/ProtocolV2.test.ts test/component/server/legacy-handler-ids.test.ts test/component/server/data-handshake-framing.test.ts test/component/server/data-handshake-payload.test.ts`.
47559 terminal0 naturally: seven suites/57tests109.476seconds. Legacy getter/schema/prototype/fallback tests,45framing/queued ownership,41identity,43framing,42payload and v1/v2 compatibility passed. This is a separate execution from97937; no invented single72-test run is claimed. No timing benchmark or whole-suite claim. Root coordinates final two reviews; neither45/46 is closed by this ledger. Proposed title: `fix: 잘못된 제어 메타데이터만 폐기하고 연결 유지`.

Final8files:4approved production, dedicated metadata-result and control-metadata tests, metadata-frame fixture and this ledger. No live run handle remains. Source/tests frozen; await independent review and root-authorized integration of the joint milestone.

## Independent test completion-barrier correction

- [x] Observe the old barrier failure with actual split transmission. Status: a75648 exited 1 naturally; 2 failed, 16 filtered, 6.49 seconds. This is a test completion-barrier RED against the unchanged metadata production candidate, not another production RED.
- [x] Replace only premature completion waits. Status: client waits for the expected processed Message count (the invalid Message invocation is counted explicitly); server waits for a case-specific valid sysinfo marker. Existing bounded polling and timeout failure remain. No fixed sleep is a success condition.
- [x] Preserve coalesced controls and add split controls. Status: the original eight connected client/server coalesced cases remain; eight split cases first await actual bad-packet receive/consumer completion before writing the good frame. This guarantees separate receive progress without relying on TCP write boundaries alone. The two SyncCtrlAck cases remain unchanged.
- [x] Selected GREEN. Status: 94072a exited 0 naturally; 2 passed, 16 filtered, 6.684 seconds.
- [x] Related regressions. Status: handle 54602 / terminal acf201 exited 0 naturally; 5 suites, 50 tests passed in 74.518 seconds. No live handle remains.
- [x] Independent re-reviews. Status: final review_wave0 and fix_lint_diagnostics rereviews PASS, zero findings; root commit/integration pending.

Selected RED/GREEN command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/control-metadata.test.ts --testNamePattern='split delivery (client|server) message invalid syntax=true'`.

RED facts: client Message expected 2 processed calls but observed 1; server expected the unique continuation marker but still held initial sysinfo. The valid continuation had been written but had not been consumed when the original receive-only predicate permitted assertions. The correction changes neither metadata classification nor transport behavior. All pending queue identity/bytes, same-control, normal handover/delivery, and sibling echo assertions remain.

Production SHA256 before correction (f5e0c0) and after correction (0a24be) matched exactly:

- TunnelClient: `849CAD4512766176D814F972C853F95CE72142E4B0F6DB99B66520A6ADAB4DB0`
- CtrlMetaGuards: `8B36087D5C6F3D4A0A645B81744C4F0662A7F237F12A30CF7E9BD97A294DB37A`
- CtrlPacket: `FC90912ED051B242A6062DF07A1FE9D94B778AB36F5E288EBF1BD55688085042`
- ClientHandlerPool: `B76A0708A385FBFA514D68FCEA7686C83BB187FCB2189CB6CAD86758212625DC`

Only `test/component/client/control-metadata.test.ts` and this ledger were changed by the independent fixer. No fixture or production change was needed. The earlier author's 15/57 results remain historical, separate executions.

Related regression command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/control-metadata.test.ts test/commons/metadata-result.test.ts test/commons/r2-req-04-meta-schema.test.ts test/commons/ctrl-read-result.test.ts test/component/client/control-framing.test.ts`. The existing queued-control fixture preserved its evidence at `C:/Users/beom/AppData/Local/Temp/control45-queued-x6UnYz`. Completion correction frozen for independent review; production/build results above are unchanged historical author evidence, and no additional build or whole-suite result is claimed.

## Final independent completion-barrier rereviews

Root confirmed review_wave0 and fix_lint_diagnostics final code/content/exact-title rereviews PASS, zero Critical/High/Medium/Low findings. Neither final reviewer executed additional tests. LOW is resolved by waiting for expected processed Message count or unique sysinfo marker; split-delivery RED and original production RED remain distinct. Existing coalesced/Sync controls and bounded timeout failure behavior remain intact.
review_wave0 independently hashed the four production files and confirmed they match the preserved before/after values above. Existing proposed title remains PASS. This entry changes only the ledger; production/tests are frozen. Root commit/integration remain pending and neither #45 nor #46 closes or receives its completion Telegram before joint verification.

## Joint operational completion

- [x] Final joint verification, integration/push and individual closure/notification. Status: Joint final integration35a5d5f30c4b2e894ca9daf266c864bbc7871afa pushed/remote verified, sourcefdc4ad6;12suites/85tests PASS164.236seconds, natural exit0; forced build PASS. GitHub CLOSED2026-09-08T07:11:34Z, comment5580852898; root Telegram3976(66/45).
Root supplied these operational receipts. Earlier stage-only integration, original RED, independent test-only correction and pending gate records are historical; neither issue remains OPEN or awaiting notification. The final count at joint completion was45CLOSED/45notified of66; current active work is recorded only in the execution plan. #28/#40/#29 boundaries remain unchanged.
