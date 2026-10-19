# Issue #7 — Administrator request CSRF integration

Status: complete; independently reviewed, integrated, pushed, closed and notified.
Original title: 관리자 UI 가 CSRF 헤더를 보내지 않아 모든 설정 변경이 403 으로 거부됨.
Assigned agent: `fix_ci14`; branch `fix/epic61-ui-csrf`; base `67d8123`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-ui`.
Writable paths: `admin/src/controller/AdminRequest.ts`, the seven mutation methods
in ServerOptionCtrl.ts/CertificationCtrl.ts, `admin/test/requests.ts`,
`test/admin/csrf-requests.test.ts`, and this ledger.
Next action: none for this issue; #67 now assigned separately.

## Scope and reuse

All seven mutation methods now use one small request helper. It reads the existing
csrfToken cookie, attaches X-CSRF-Token, preserves caller content-type/body and
forces same-origin credentials. If that cookie is absent, the existing authenticated
GET /api/csrfToken restores it before any mutation. Concurrent callers share that
recovery only; no mutation is replayed after a 403 or transport failure.

The helper rejects foreign-origin URLs before accessing a token or sending a
request. Fetch redirects are errors, so an otherwise same-origin endpoint cannot
forward the token to a different origin. Existing 401 InvalidSession behavior is
preserved. Other HTTP failures, invalid JSON/envelopes and network failures return
success:false and a meaningful message through the controllers' existing result
contract; callers can display the message using their existing failure branches.
No UI error is represented as success and no backend policy is weakened.

Reuse inspection covered the existing controller fetch patterns, InvalidSession,
server CSRF recovery endpoint, real AdminServer/TTTServer, temporary runtime roots,
browser helper and real certificate generator. The browser fixture imports actual
controllers from Vite but runs its document on the actual AdminServer origin.
Thus browser cookies and Origin behavior match deployment; API calls are not
proxied or mocked. Direct browser fetch to /api/login initializes only test auth
because the separate #8 login-wire issue is intentionally not repaired here.

Root independently reproduced the separate development-proxy Origin mismatch and
opened #67. It follows #7 before #8. This change does not claim that Vite's current
development proxy can perform mutations; it retains strict backend Origin/CSRF
checks and leaves production proxy/backend policy untouched.

## Checklist and test-first evidence

- [x] Inspect issue, current controller/API patterns, auth and recovery contracts.
  Status: complete; no backend runtime hooks or source changes were required.
- [x] Reproduce all seven authenticated mutation failures before implementation.
  Status: RED. `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/csrf-requests.test.ts` failed all five test cases in 44.499 seconds. Actual browser network responses for all seven controller calls were 403 instead of 200, with Missing CSRF token results. Lost-cookie calls failed, expired auth did not preserve the required session error/preflight behavior, and helper safety/error cases could not load the not-yet-created helper.
- [x] Implement shared cookie/recovery/error handling and delegate only seven mutation paths.
  Status: complete after RED. Existing GET controllers, LoginCtrl/bootstrap, backend business logic and TLS defaults are unchanged. Existing InvalidSession imports remain used by their GET methods.
- [x] Require a meaningful failure for a successful HTTP response missing the API envelope.
  Status: additional RED before that guard. The real /invalid-envelope.json fixture returned {}, and the selected error-contract test failed (expected success:false, received undefined) in 11.733 seconds. The helper then added only the boolean success-field check for successful responses; non-2xx messages remain preserved.
- [x] Execute focused browser/API checks and static/backend builds.
  Status: GREEN. Full dedicated test command passed five tests in 50.567 seconds. `npm --prefix admin run check` exited 0 with zero errors/ten existing accessibility/CSS warnings. `npm run build` exited 0.
- [x] Execute full administrator suite and existing backend CSRF guards.
  Status: GREEN. Handle 61955 exited 0; command `node node_modules/jest/bin/jest.js --runInBand --silent test/admin test/security/req-12-csrf.test.ts` passed seven suites/26 tests in 129.45 seconds, without forced exit.
- [x] Independent review and any corrections.
  Status: final PASS by `review_wave0`, including separate fixture cleanup rereview. Proposed title: `fix: 관리자 변경 요청에 CSRF 검증과 토큰 복구 연결`.
- [x] Commit, integration verification, remote verification, closure and Telegram report.
  Status: complete; operational evidence below.

## What the real tests prove

Seven valid authenticated controller calls receive HTTP 200 and success:true:
server-option save, tunnel addition, tunnel removal, listener activation, admin
certificate registration, external certificate registration and external certificate
deletion. The fixture uses real listeners/configuration/certificate commits;
additional checks observe activated state, removal and the stored admin certificate.
It asserts exactly seven mutations and no token-recovery request when a cookie exists.

When the cookie is removed, two concurrent real mutations produce one recovery GET
followed by exactly two POSTs. Expired session recovery throws InvalidSession and
sends no mutation. A real no-cors browser request omits the non-safelisted header,
elicits the actual API's 403 CSRF failure, and returns its message without replay.
Malformed/empty-envelope JSON is served from the real server's temporary web root;
closing that API produces a real network failure. Local HTTP recipient/redirect
servers confirm foreign URL requests are blocked and a 307 mutation redirect is
not followed: the foreign recipient observes zero requests. These fixtures replace
no browser APIs or cryptographic/server methods.

## Independent setup-failure cleanup repair

Independent fixer: `research_schedule`. The MEDIUM review finding concerned
fixture ownership before setup returns, not production request behavior. Scope:
only `test/admin/csrf-requests.test.ts` and this review note; production helpers,
controllers, server policy and shared browser/proxy helpers were not edited.

Two explicit setup checkpoints observe real acquired resources and throw the
same deliberate Error before browser acquisition or after actual browser launch.
The checkpoint is an openly declared failure injection, not a claim to reproduce
a physical browser outage. No browser/server/crypto implementation is replaced.
Tests demand the identical original Error, removed temporary root, a closed
acquired browser page and successful rebinding of the actual API/external ports.
Their own fallback cleanup releases baseline resources after failed assertions.

RED before cleanup implementation:
`node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin/csrf-requests.test.ts -t 'setup failure releases'`
exited 1: two failed/five unselected, 19.772 seconds. Both expected a removed root
but `fs.access` still succeeded. The original five success/security cases were
unchanged. GREEN with the same selection (plus `--silent`) exited 0 naturally:
two passed/five unselected, 13.011 seconds.

The fixture now records each owned resource immediately after creation and uses
one teardown for successful tests and setup failures. Nested finally blocks
attempt browser, API, tunnel and root cleanup even if an earlier close rejects.
The setup catch rethrows its original error after cleanup, preserving failure
identity. Its try scope begins immediately after root acquisition and covers
configuration, listener startup, browser navigation and login assertions.

Complete regression command
`node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin/csrf-requests.test.ts --silent`
exited 0 naturally: seven tests passed, 63.457 seconds. This retains every
original mutation/recovery/error/foreign-origin test. Independent rereview is
pending; the fixer has not committed or approved their own changes.

## Limits

These are deployment-origin controller/API checks, not proof of every rendered
dialog or the unfinished development proxy (#67). Login/bootstrap (#8), obsolete
empty-key discovery (#51) and unrelated server lifecycle issues remain scheduled.
Local checks use Node v24.16.0/Svelte 5.57.0/Chromium; hosted CI is not claimed.

## Operational completion

Integration commit and independently observed pushed remote HEAD: `2b0a42690f6aa52046cc648cc7b1ec479b3f4c8f`. GitHub independently confirmed CLOSED at `2026-09-07T18:30:13Z`. Root's final shared integration selection passed six suites/25 tests naturally in 109.895 seconds. The earlier native Vite launch failure and successful unchanged-case follow-up remain separately recorded in `epic61-integration-native-failure.md` without asserting an unproven cause.

Telegram title: `TDD Gate 7 관리자 UI 가 CSRF 헤더를 보내지 않아 모든 설정 변경이 403 으로 거부됨 (62/16)`. Successful message `3917` is from the orchestrator's tool receipt, not an independent Telegram fetch. #67 development-proxy work follows separately. Do not duplicate the notification.
