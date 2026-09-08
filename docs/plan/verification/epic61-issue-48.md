# Issue #48 — One-shot finite tunnel exchange

Status: complete; source3522c44 -> maineb546cd8a909433386d3d86572798ce9b9507203 pushed/remote verified; CLOSED2026-09-08T12:01:10Z comment5584801437 Telegram3990(67/57). Root dedicated7PASS8.993seconds and separate req09 selected1PASS/4filtered3.42seconds, each natural exit0; buildPASS. Original66613 corrected two-path command and historical pending/RED records remain preserved.
Exact writes: test/helpers/network.ts (additive once helper and opt-in finite echo mode), test/helpers/tunnelHarness.ts (finite default endpoint setup and no-retry result comparison), dedicated test/fixture and ledger only. No production, #54/#47/#53, HTTP EOF29 or shared policy changes.

- [x] Read original48/root-approved E2E API and current callers. Status: readiness wait separate; current exchange retries and prefix truncates, existing unrelated helpers preserved.
- [x] Observe actual first-bad/extra RED and additive helper contracts. Status:6FAIL/1control before helper edits; initial direct contracts were API-absence RED, as distinguished below.
- [x] Minimum helper/caller repair and real TTT finite exchange. Status:actual full-tunnel peerFIN completes, no production amendment needed.
- [x] Focused regressions. Status:8PASS plus separate selected50-exchange casePASS; exact receipts below.
- [x] Two independent reviews. Status: review_wave0 and fix_lint_diagnostics final PASS, zero Critical/High/Medium/Low findings; root commit/integration pending.

API sendTcpAndReceiveOnce({host,port,payload,timeoutMs}) returns all bytes on actual peer end, no expected prefix comparison; errors/close-before-end/deadline reject and clean own socket/timer. Harness compares entire result exactly once without retry. Existing echo gets a narrow opt-in finite request-length response that calls socket.end after real request bytes arrive; default unrelated echo behavior unchanged. Record actual accept/request counts; fault fixture is controlled behavior, not a production data-loss claim.

RED89186: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/roundtrip-once.test.ts`, naturalexit1,6failed/1passed9.088s before helper edits. Four additive API cases fail absent function; real first-bad and extra-response full-tunnel cases incorrectly resolve hello instead of rejecting. Valid real tunnel control passes. This explicitly separates additiveAPI RED from real retry/truncation failures. Main assignment was recorded before execution; production remains unassigned.

Implementation: additive sendTcpAndReceiveOnce opens one actual socket, writes payload once at connect, collects all data and resolves only on actual end; close-before-end/error/deadline reject and clear owned timer/socket. No comparison/truncation inside helper. Harness configures its existing endpoint's opt-in finite response length, calls once and compares full Buffer.equals without waitFor. Existing prefix helper/waitFor and default echo behavior for other users are unchanged. Finite endpoint mode captures request length per connection and calls end with all actually received bytes after reaching it; no fake transport or automatic resend.

First candidate18757 run (new suite plus baseline tunnel) ended1 with7PASS/1FAIL11.812s. The direct reset peer's socket.destroy() produced an actual FIN and empty result; this is a fixture assumption failure, not a one-shot helper failure. Replacing only that fixture action with explicit native resetAndDestroy made its intended RST condition precise, without changing helper implementation or desired contract. No new production RED claimed for this test-only correction. Empty FIN can validly return an empty Buffer; the harness rejects its mismatch against nonempty expected data.

Final66613 used `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/roundtrip-once.test.ts test/e2e/tunnel/baseline-tunnel.test.ts` (start6fb8a4, terminal99f146). It naturally exited0: two suites8tests12.418seconds. Tests cover direct full normal/extra bytes, actual never-ending peer deadline and reset rejection, plus actual authenticated TTT first-bad/extra mismatch and good FIN. Each actual peer asserts one connection and one complete request; first-bad would return correct bytes on a second connection, but no second request occurs after the fix. The helper makes one write; counters are peer complete-request counts, not a claim about TCP segment/write syscall counts.

Existing caller regression: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/e2e/req-09-pool-swap-zombie.test.ts --testNamePattern '\(2\) echo'` e69ea7 naturalexit0,1PASS4filtered3.394seconds. This test performs its existing50 real exchanges, each now one-shot; it is one selected Jest test, not50separatetests. No timing benchmark, full restart loop, denied artifact or runtime source change. Existing artifactRoot cleans this selected test's newly owned report root.

Four scoped files frozen: network.ts, tunnelHarness.ts, roundtrip-once.test.ts and ledger48. Test-owned sockets/server close in finally; helper clears deadline on every result. No live handles or process termination. Proposed exact title: `test: 터널 왕복의 첫 응답을 재시도 없이 검증`. #54/#47/#53 remain separately gated; no claim this TCP FIN work completes HTTP EOF29.

## Final independent reviewer receipts

Root confirmed review_wave0 and fix_lint_diagnostics final original-requirement/code/content/exact-title PASS, zero Critical/High/Medium/Low findings. Neither reviewer performed additional execution. Both assessed single-connect/write, all-byte peer-FIN result, caller exact comparison/no retry, opt-in finite endpoint and unchanged unrelated helpers. Actual first-bad/extra failures and native RST fixture correction remain distinct from product-defect claims;8PASS and selected50-exchange1PASS are separate receipts. No production or held HTTP EOF change is inferred.
This entry changes only the ledger; source/test remain frozen. Root commit/integration and subsequent per-issue closure/notification remain pending.

## Root integration checkpoint

Source3522c44 integrated as eb546cd, pushed and remote verified by root. Root selected roundtrip-once suite: one suite/seven tests PASS8.993seconds, natural exit0. Separate existing req09 case(2): one PASS/four filtered3.42seconds, natural exit0; forced build PASS. These are separate root runs, not the author66613 two-path command. Issue remains OPEN pending root closure/notification; no completion receipt is claimed here. This correction changes only the ledger, not test/helper behavior.

## Operational completion

- [x] Root closure/notification. Status: source3522c44 -> maineb546cd8a909433386d3d86572798ce9b9507203 pushed/remote verified; CLOSED2026-09-08T12:01:10Z comment5584801437 Telegram3990(67/57). Root dedicated7PASS8.993seconds and separate req09 selected1PASS/4filtered3.42seconds, each natural exit0; buildPASS.
Root supplied these facts. At closure57CLOSED/57notified of67; current active status SSOT is execution plan. Earlier OPEN/pending paragraphs describe previous checkpoints. No #54/#47/#53 completion is inferred.
