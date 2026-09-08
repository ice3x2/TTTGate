# Issue57 native TLS rejection evidence

Status: complete; sourcee9ab13e -> main59f493f8a8c55eb5b136296bf58b2c53d0698df9 pushed/remote verified; CLOSED2026-09-08T11:39:02Z comment5584549126 Telegram3987(67/54); three suites/9tests PASS3.368seconds natural exit0/buildPASS. Earlier pending/assignment statements describe historical stages.

- [x] Reuse/read. Status: current local forge certificate/root/socket factory; wrapper Connected is TCP progress, not TLS establishment.
- [x] Declared sensitivity RED. Status:95304a naturalexit1, nativeSecure1 versus0 after oldClosedOnly assertion passed; details below.
- [x] Strict native negative/positive and regressions/build. Status:3suites9PASS3.557seconds and forced build naturalexit0.
- [x] Two independent reviews. Status: review_wave0 and fix_lint_diagnostics final code/content/exact-title PASS, zero Critical/High/Medium/Low findings; root commit/integration pending.

## Exact sensitivity and strict evidence

Initial af88ad failed one case1.347s before the old Closed assertion could pass: the reused waitFor helper retries thrown assertions, but the first fixture incorrectly returned false. That attempt is a fixture setup failure, not accepted sensitivity RED. Its PowerShell cleanup command also masked the native child failure at shell exit0; do not cite it as successful or natural-zero validation. Corrected predicates use actual assertions inside the existing waitFor contract and the mutation command propagates the child exit code.

Corrected95304a declared sensitivity run naturally exited1: one failed/one filtered,1.365s. The actual owned one-attempt factory delegated all options except explicit rejectUnauthorized=false; native TLS established, the owned peer sent22application bytes and closed. The original Closed-only assertion passed, then strengthened nativeSecure expected0/actual1 failed. Printed nonsecret receipt: sensitivity=true, oldClosedOnly=true, nativeSecure=1, receivedBytes=22. This is a test-quality mutation RED, not a production default-trust defect. The factory restored synchronously after this one connection and the task-scoped environment selector was removed in finally.

Mutation command: set TTTGATE_TLS57_SENSITIVITY=1 only for `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/client/TlsVerification.test.ts --testNamePattern='rejects untrusted'`, restore/remove task env, return original child exit1. Normal runs omit it.

Strict command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/TlsVerification.test.ts test/unit/util/TlsOptionsFactory.test.ts test/security/req-02-tls-settings.test.ts`. 1718/2b87b0 three suites9testsPASS3.557s, followed sequentially by `npm run build -- --force` naturalexit0. Existing npm always-auth warnings only. No process termination or leaked live handle.

Strict negative observes actual DEPTH_ZERO_SELF_SIGNED_CERT, terminal Closed, native secureConnect0, authorized=false, authorizationError present, client applicationReceive0 and server applicationbytes0. Then a new explicitly CA-trusted connection to the same still-owned TLS server reaches secureConnect/authorized and exact application echo, proving peer viability. The separate positive case also requires native secure completion and exact echo; wrapper SocketState.Connected is not evidence of trust. Returned socket listeners attach synchronously before yielding. Application sends in the positive case occur only after authorized TLS; no speculative pretrust send-safety claim.

Only existing TlsVerification.test.ts and this ledger changed. Reuse original forge certificate generator/root and waitFor helpers, plus existing factory registry; no extra driver, shared fixture or production changes. Bind loopback port0 directly and use serverName localhost with127.0.0.1 transport. Track/destroy owned accepted sockets in finally, await server close, preserve original root cleanup. No external certificate/endpoint, insecure production default, SocketHandler semantic change, blackhole timing, benchmark or denied path operation.

- [x] Two independent reviews/root commit. Status: review_wave0 and fix_lint_diagnostics final code/content/exact-title PASS, zero Critical/High/Medium/Low findings; root commit/integration pending.
Exact title proposal: `test: TLS 신뢰 거부와 실제 보안 연결 성립 구분`.

## Final independent reviews

Root confirmed review_wave0 and fix_lint_diagnostics final reviews PASS with zero Critical/High/Medium/Low findings and exact-title PASS. Neither reviewer performed additional execution. The actual native trust rejection/secure establishment, same-peer trusted echo, disclosed one-attempt mutation sensitivity and initial fixture/shell-mask failure history were reviewed as separate evidence. No production default or wrapper Connected semantics changed. This ledger-only entry leaves test/source frozen; root controls commit/integration/closure.

## Operational completion

- [x] Root integration/push/closure/notification. Status: sourcee9ab13e -> main59f493f8a8c55eb5b136296bf58b2c53d0698df9 pushed/remote verified; CLOSED2026-09-08T11:39:02Z comment5584549126 Telegram3987(67/54); three suites/9tests PASS3.368seconds natural exit0/buildPASS.
Root supplied these facts. Latest completion checkpoint55CLOSED/55notified of67; current active work SSOT is execution plan. Original mutation/setup failures, document-only limits and separate execution receipts remain unchanged; no remaining issue gate.
