# Issue #13 — Login attempts belong to the network, not the submitted password

Status: complete; independently reviewed, committed, integrated, pushed, closed and notified.
Original title: 로그인 레이트리밋 키에 비밀번호 해시가 포함되어 무차별 대입을 차단하지 못함.
Assigned agent: `fix_supply15`; branch `fix/epic61-login-limiter`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `bf6b790`.
Writable paths: login-limiter methods/call sites in
`src/server/admin/AdminServer.ts`,
`test/unit/server/admin/req-07-rate-limit.test.ts`, and this ledger.
SessionStore, loginBackoff, LoginCtrl/Login.svelte and other administrator methods
remain read-only. Next action: none for this issue; continue the remaining epic work.

- [x] Read #13, current plan/ADRs and limiter/backoff/request-test reuse. Status: complete; reuse existing real HTTP fixture, existing clock seam and current network bucket/backoff logic.
- [x] Correct the test that explicitly allowed password-change bypass and add rotating-password/XFF regressions before code changes. Status: RED; three failed/three passed, details below.
- [x] Remove the submitted-password/account dimension from limiter identity. Status: implemented after RED; no limits, durations, address policy or backoff algorithm changed.
- [x] Observe focused limiter/backoff regression. Status: handle 24804 exited 0 naturally; two suites/10 tests passed, 28.824 seconds.
- [x] Force build and complete appropriate surrounding regression. Status: forced TypeScript build exits 0; surrounding three suites/12 tests exit 0 naturally.
- [x] Two independent reviews and any corrections. Status: primary `review_wave0` and secondary `research_schedule` passed code/content/message review; primary independently reran two suites/10 tests with natural exit 0, 28.693 seconds, as confirmed by root review receipts.
- [x] Commit, integrate, push, close and notify. Status: complete; operational evidence below, original dirty workspace untouched.

## RED evidence

Before modifying AdminServer, the existing other-password expectation was changed
from 401 to the required 429. New tests submit a different password and a different
untrusted XFF header on each failure, and cover explicit trusted-XFF /24 grouping.

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/server/admin/req-07-rate-limit.test.ts
```

Handle **61844 exited 1**: three failed/three passed, 23.86 seconds. All failures
expected 429 but received 401: another password after five failures, a sixth new
password after five distinct guesses, and another password from the same trusted
IPv4 /24 bucket. This demonstrates that the password-derived account key bypassed
the intended network limit. No production implementation preceded this RED.

## Current implementation and verification scope

`extractAccountKey` is removed. Limiter key construction returns only the existing
network bucket of the existing policy-selected client address. Blocking, failure
recording, success reset and delay lookup all use that same key. The named crypto
imports remain used elsewhere and are not removed.

The five-failure threshold, 60-second window/block, 10,000-entry bounded map,
IPv4/IPv6 bucket calculation, trustXForwardedFor policy, status/envelope handling
and computeBackoffMs implementation are unchanged. The test additionally verifies
the 59,999/60,000 ms boundary through the existing injected clock and successful
login reset. HTTP requests and delays are real; only the time source is injected
for boundary determinism. The LRU test retains its explicitly documented request
data fixture, without claiming 10,050 real network requests or mock-free coverage.

Current focused command:

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/server/admin/req-07-rate-limit.test.ts test/unit/server/admin/loginBackoff.test.ts
```

Handle **24804 exited 0 naturally**: two suites/10 tests passed, 28.824 seconds.
This ledger was persisted after the RED/initial
implementation when the orchestrator requested the missing resumability record;
it does not imply earlier persistence.

## Final checkpoint evidence

```powershell
npm run build -- --force
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/AdminServer.security.test.ts test/unit/server/admin/SessionStore.security.test.ts test/unit/server/AdminSecurityPolicy.test.ts
```

Forced build exited 0. Surrounding regression handle **24537 exited 0 naturally**:
three suites/12 tests passed, 9.727 seconds. Combined with focused handle 24804,
22 test cases passed across five suites. No SessionStore, loginBackoff, security
policy registry or UI source was changed; the surrounding tests exercise those
existing contracts with the new limiter key.

The fixed tests retain actual five-failure/401 then blocked/429 behavior, show
that different guesses and untrusted forwarded headers consume one bucket,
preserve trusted-XFF /24 grouping/separate network buckets, check the exact
block-expiry boundary and successful-login reset, retain the 10k map cap and
existing backoff lower-bound checks. They do not claim broader distributed
rate-limit enforcement or change the existing IP normalization policy.

Proposed commit title: `fix: 관리자 로그인 실패를 네트워크별로 집계`.
Commit, remote hash, issue closure and Telegram receipt are recorded below.

## Integration verification and operational completion

Source commit: `34a931c`. Integration commit and independently observed pushed `origin/fix/epic-61` HEAD: `1caf4df9f7418678a355a2ef39dfd80d9d9cd62f`. GitHub independently confirmed CLOSED at `2026-09-07T19:34:18Z`.

Root reports integration forced compilation PASS. The first integration test invocation (handle `1136`) named a nonexistent backoff test file and exited 1 with ENOENT. Two actual selected suites still reported 11 tests passed in 37.541 seconds, but the entire invocation did not pass. This was the orchestrator's mistyped test path, not a product RED or a suppressed application failure. Root then ran the actual `loginBackoff.test.ts` separately: four tests passed in 0.318 seconds, exit 0. These distinct outcomes complement the earlier complete focused and surrounding successful runs above; they are not presented as a single exit-0 integration command.

Telegram title: `TDD Gate 13 로그인 레이트리밋 키에 비밀번호 해시가 포함되어 무차별 대입을 차단하지 못함 (63/20)`. Successful message `3921` is from the orchestrator's tool receipt, not an independent Telegram fetch. Do not duplicate the notification.

## Independent review approval

The orchestrator supplied both independent approvals before authorizing the
scoped commit: `review_wave0` (primary) and `research_schedule` (secondary) passed
code, content and the exact title `fix: 관리자 로그인 실패를 네트워크별로 집계`.
The primary's independent bare-Jest run passed two suites/10 tests and exited
naturally in 28.693 seconds. No material findings remain in the reviewed scope.
