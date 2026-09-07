# Issue #8 — Bootstrap and compatible administrator login

Status: ready to commit; focused/static/build/broader regressions and both independent reviews passed.
Original title: 신규 설치에서 최초 관리자 비밀번호를 설정할 수 없음.
Assigned agent: `fix_ci14`; worktree `C:/Work/git/_Snoworca/TTTGate-epic61-ui`;
branch `fix/epic61-ui-bootstrap`; initial baseline `bf6b790`, updated by approved
cherry-pick of #13 commit `1caf4df` as `476120b`.
Writable paths: LoginCtrl.ts, Login.svelte, dedicated administrator browser
fixtures/tests and this ledger. Root additionally approved removing only the
orphan sha512Hex/forge import from `admin/src/util/hash.ts` while retaining native
randomHex; old hash-only fixtures/tests will become wire/native-challenge tests.
Backend AdminServer/SessionStore is read-only because #13 owns its parallel lane.

## Scope and reuse

Existing backend accepts raw `key` plus optional `bootstrapToken`, trims the key,
validates a minimum length of eight for initialization, persists bcrypt, and
migrates a matching legacy SHA-512 credential to bcrypt. Client hashing currently
breaks that wire contract. Existing response flags/status distinguish bootstrap
requirement, invalid token, weak password and rate limiting. No new password
policy or backend behavior will be introduced.

Reuse real AdminServer/SessionStore, existing temporary roots, browser helper and
certificate-independent HTTP setup. Tests will use isolated roots/server instances
so failed attempts cannot contaminate another scenario. #51's empty-key discovery
cleanup remains separate until #13 integration; no dead backend handler changes
are authorized here. Original user dirty files remain untouched.

- [x] Read #8, current login/server code, ADRs and existing browser/hash tests.
  Status: complete; root approved bounded orphan removal and server-authoritative password policy.
- [x] Write and observe actual raw-key/bootstrap/status/restart RED before implementation.
  Status: initial command `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/login-bootstrap.test.ts` exited 1, seven tests failed in 34.895 seconds (handle 73874 observed terminal by this worker). Failures show a hashed key and missing token on the wire, missing bootstrap field/guidance, weak input producing 403 instead of 400, existing bcrypt/legacy accounts producing 401, and missing 429 guidance. The full restart paths were written before implementation but could not proceed past their initial failed login at RED.
- [x] Reconfirm RED on the independently fixed #13 limiter baseline.
  Status: approved backend-only cherry-pick completed; handle 84362 exited 1 with the same seven failures in 35.974 seconds. Each test owns a separate root and actual backend child process; no automatic retry or shared failure-count state is used.
- [x] Implement raw-key/result contract and bootstrap UI; remove newly orphaned hashing only.
  Status: raw key and optional bootstrap token are sent; status/flags retained; UI displays token, weak-password and 429 guidance. The incompatible client strength policy and hashing are removed. randomHex remains unchanged. Existing hash-only tests are replaced by real-wire/restart coverage and retained native challenge tests.
- [x] Execute browser, restart compatibility, static/build and relevant regression checks.
  Status: focused handle 32778 exited 0, seven tests passed in 31.26 seconds. Existing bcrypt and legacy credentials succeeded before and after a fresh backend child-process restart with different PID and cleared browser cookies; the legacy credential persisted as bcrypt. Native 429 had one UI attempt and no automatic retry during the explicit 1.2-second observation window. `npm --prefix admin run check` exited 0 with zero errors/ten existing accessibility/CSS warnings; `npm run build` exited 0. Broader handle 47043 exited 0 naturally: 11 suites/42 tests passed in 153.642 seconds using `node node_modules/jest/bin/jest.js --runInBand --silent test/admin test/unit/server/admin/SessionStore.security.test.ts test/component/server/admin/AdminServer.security.test.ts test/unit/server/admin/req-07-rate-limit.test.ts`.
- [x] Independent review by the assigned primary and second reviewers.
  Status: primary `review_wave0` code/TDD review PASS with two selected actual-wire/legacy-restart tests passed naturally in 7.598 seconds; secondary `fix_supply15` code/content/message review PASS. Approved title: `fix: 관리자 로그인에 부트스트랩 토큰과 원문 비밀번호 전달`. No self-approval.
- [ ] Commit after both reviews, integrate, push, close and notify.
  Status: exact-title scoped commit authorized by root after both reviews and final regression; integration, push, issue closure and notification remain root-owned.

## Implementation and evidence limits

LoginCtrl sends the original key string and optional bootstrapToken, preserving
the actual HTTP status and backend response flags. Login UI binds its own input
values, offers the token after bootstrapRequired, distinguishes missing/invalid
token, weak-password and 429 responses, and disables duplicate in-flight submits.
The incompatible local 12-character/digit/symbol rule is removed; the server's
existing policy decides acceptance. No automatic 429 retry is scheduled.

Private client hashing and its now-orphan shared SHA-512 implementation/import
are removed; native randomHex remains unchanged. Earlier hash-only fixture
assertions are superseded by actual raw-wire and persisted bcrypt/legacy account
tests, while native random challenge checks remain in both real browser contexts.
The original user dirty workspace is untouched.

The test backend is a real new Node child on every start, with an isolated root
and fresh AdminServer/SessionStore. Restart closes the old child naturally,
requires a new PID, clears browser cookies and reloads the same persisted key.
This proves credential compatibility rather than reuse of a surviving session.
No backend source changes were made for #8; #13 was integrated as its already-
reviewed commit. #51's obsolete discovery call/dead backend handler remains a
separate next checkpoint; it is not claimed resolved here. Tests use explicit
loopback HTTP fixtures without changing production TLS/security defaults.
