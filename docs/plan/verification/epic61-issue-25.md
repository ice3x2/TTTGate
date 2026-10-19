# Issue25 upper client owner

Status: complete; sourceef11102 -> maind1ad8ffa8fc1857ab894594e175741050bac3e4a pushed/remote verified; CLOSED2026-09-08T10:58:29Z, comment5584078471, Telegram3982(66/50); six suites/46tests PASS145.728seconds natural exit0/buildPASS. Earlier review/assignment/pending statements record historical stages.

- [x] Read original lifecycle source/research and reuse. Status: reuse withClient real fixture, existing scheduler and disposal; no new fixture or transport.
- [x] Observe actual RED before production. Status: eight corrected baseline failures and separate queued-sibling failure below.
- [x] Minimal owner/captured callbacks/timer cancellation. Status: TTTClient-only implementation after RED.
- [ ] Regression/build/two independent reviews. Status: pending, no commit.

Contract: captured client/pool pair, originating client equality, invalidate before disposal and publish/wire/flags before connect. Real scheduler replacement; explicit old upper callbacks bypass only the lower-layer ownership boundary, not transport authentication. No public type, TunnelClient, endpoint-pool, wire,28/29/40 change.

Checkpoint before independent #30 test-only assignment: production25 remains untouched. Initial1249 reported8FAIL57.783s but old explicit-start sockets leaked from the test's ownership cleanup; Jest remained alive and only this owned test process was interrupted568b6e exit1. This is not natural-exit evidence. Added finally disposal of captured old client/pool and creating-scheduler timer in tests, without production edits. Corrected80537/8b982d naturally exited1:8failed31.396s. Actual stale closed flips online; stale send/receive injects STALE into real fresh echo; endpoint callbacks damage matching live session; explicit start leaves old control socket alive; stop calls wrong scheduler; late upper connected revives online. Current tests/ledger preserved while completing root's separate #30 coverage task. Actual queued-sibling ownership coverage still needs preparation before implementation25.

## Actual RED and implementation

- [x] Same-owner queued sibling RED before source. Status:8fac16 naturally exited1,1failed8filtered4.288s. Real scheduled replacement had two real greeting queues17bytes each, and replayed old endpoint termination reduced fresh aggregate34 to17. No counters or queues were assigned by the test. Existing eight baseline failures and cleanup correction above remain distinct evidence.
- [x] Minimum production. Status: only TTTClient adds private owner pair and guard/retirement/cancellation helpers; every registered callback captures its owner, control additionally validates its originating TunnelClient. Retire clears authority before pool disposal/client destruction. Start publishes and wires before flags/connect; closed invalidates before disposal and schedules through existing runtime. Timer cancellation captures creating scheduler and checks actual timer identity on late callback. Public callback types, TunnelClient, endpoint pool and scheduler implementations remain unchanged.
- [x] Focused GREEN. Status:27501/28c1f8 naturally exited0,9tests30.049s. Main top/Resume/row/research exact assignment corrected before production writes; earlier appended-only assignment was insufficient for current status and is disclosed as an operational correction.
- [x] Related regressions/build. Status:8797 completed five suites40PASS127.803seconds; forced build exit0.
- [ ] Two independent reviews. Status: review_wave0 final full code/content/exact-title PASS; second reviewer pending, root commit/integration pending.

Focused command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/client-owner.test.ts`.
Related command: same runner with client-owner.test.ts, data-terminal.test.ts, control-framing.test.ts, control-metadata.test.ts and test/unit/client/req-14-connect-race.test.ts; sequential `npm run build -- --force`.

Tests use real existing withClient/withLegacyIds owned server/client/endpoint fixture and real configured scheduler replacement, never fake replacements. Old upper callbacks are explicitly replayed after real replacement, using fresh SID as a disclosed identity probe; they are not claimed as a second native transport event. Fresh actual echo and independent sibling survive; queued same-owner pair retains handler/queue identity and aggregate, then normal held-result/ACK delivers both greetings once and both echo. Saved timer replay is a supplemental cancellation guard; the real delegated timer is canceled and a real later scheduler barrier observes no invocation. First connected-state probe assigned a flag and was removed before accepted baseline; the final case instead uses real stop then late connected callback with no fabricated state.

The tests' finally blocks explicitly dispose captured old fixture owners even on RED to avoid mistaking fixture leaks for product success. No timeout increased; the one interrupted initial execution is preserved above and not called natural. Reuse existing fixture without copying; no new fixture needed. Unused dedicated-test CtrlPacket import removed after execution; no behavior changed.

Final related evidence:8797 emitted five suites40PASS127.803seconds at8a33d5, then forced build exited0. Natural terminal result recorded separately by tool. Earlier focused9PASS30.049 is a distinct run, not added to a synthetic49-test execution. Existing control45 queued and data24 pending/queued/refused evidence roots were preserved by their fixtures. No live execution remains. Source/test/ledger frozen for two independent reviews; exact proposed title: `fix: 이전 클라이언트 콜백의 새 연결 상태 변경 차단`.
## Final independent review_wave0 receipt

Final full review: PASS, zero Critical/High/Medium/Low findings. Original issue, approved exact owner/timer contract, final TTTClient-only diff, test controls and frozen ledger were reviewed. Owner invalidation precedes disposal; callback capture and originating-client checks precede access to current state; publication/wiring precedes connect and timer cancellation uses its creating scheduler. Real replacement, matched-SID stale callback, same-owner queued bytes and stop-before-timer evidence are properly distinguished from injected callback probes.

No additional execution was performed in this final review. Focused9PASS30.049 and separate related5suites40PASS127.803 natural exit0/buildPASS were assessed as distinct author receipts. Root confirmed final source unchanged apart from removed unused test import. Root-selected exact title recorded above is PASS. Second independent review and root commit/integration remain pending; this entry does not modify source/test files.

## Separate test-only endpoint-state coverage correction

Root assigned review_wave0 as a different fixer for missing old EndPointClientPool state-callback coverage. Original production author is review_cert_conflict. The original nine cases remain, with the queued-sibling case parameterized to retain termination and add Connected/End/Closed. The existing Receive case remains unchanged. Each new state probes a saved actual old pool callback against a matching fresh SID after genuine scheduler replacement, while two real17-byte endpoint greetings wait before ACK. Delegating fresh syncEndpointSession/closeEndPointSession observers assert zero side-effect calls. Both queue/handler identities and34-byte aggregate survive, then actual held success/ACK delivers both greetings once, both sessions echo, and independent sibling echo succeeds. Observer methods restore in finally. This is an explicit stale callback identity probe and coverage strengthening, not new production RED.

Selected command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/client-owner.test.ts --testNamePattern "old endpoint (Connected|End|Closed) callback". Owned handle97801 exited0 naturally:3PASS/9filtered,10.576seconds. No production change or fixture duplication; original interrupted-run history and prior review results remain historical. Full owner regression and independent rereviews follow before final handoff.

Full owner regression: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/client-owner.test.ts. Owned handle61316 exited0 naturally: one suite/12tests PASS,40.977seconds. This is separate from the selected3PASS and historical author40-test compatibility run. Production TTTClient remains unchanged; only this ledger and dedicated test changed. Both are frozen for the two other reviewers; initial review_wave0 full PASS is not self-verification of this later test addition.

## Final M1 correction rereviews

Root confirmed review_cert_conflict and fix_lint_diagnostics independent final test-only correction rereviews PASS, zero Critical/High/Medium/Low findings and existing exact-title PASS. Neither reviewer performed additional test execution. M1 is resolved: old EndPointClientPool Connected/End/Closed probes cover the matching fresh SID while actual queued siblings, sync/close side-effect counts and later delivery/echo remain correct. Original production review and the subsequent test-only addition remain distinct; no new production RED is claimed.
This ledger-only update changes no source/test. Root commit/integration remain pending. Existing selected3PASS10.576 and full owner12PASS40.977 are the recorded correction executions, separate from historical author compatibility evidence.

## Operational completion

- [x] Root integration/push/closure/notification. Status: sourceef11102 -> maind1ad8ffa8fc1857ab894594e175741050bac3e4a pushed/remote verified; CLOSED2026-09-08T10:58:29Z, comment5584078471, Telegram3982(66/50); six suites/46tests PASS145.728seconds natural exit0/buildPASS.
Root supplied these facts. Current counts/active work are maintained in execution plan; original RED/failure/explicit exceptions and distinct execution receipts remain preserved. No remaining per-issue gate. #23 now separately assigned; #18/#28/#40/#29 boundaries unchanged.
