# Issue #10 — Reject inactive connections without registering sessions

Status: complete; independently reviewed, integrated, pushed, closed and notified.
Original title: 비활성 외부 포트에 접속 한 번이면 서버 프로세스가 종료됨.
Assigned agent: `fix_supply15`; branch `fix/epic61-listeners`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `9281bb2`.
Writable paths: `src/server/ExternalPortServerPool.ts`,
`test/component/inactive-listener.test.ts`,
`test/component/inactive-listener-driver.ts`, and this ledger.
Next action: none for this issue; #39 is now assigned after integration.

- [x] Read #10, current integration plan and existing lifecycle/helper code. Status: complete; use the bounded listener lane parallel to administrator work.
- [x] Check reuse opportunities. Status: complete; reuse existing free-port and TCP roundtrip helpers and the established isolated Node/ts-node child pattern; no shared helper or TCPServer edit.
- [x] Write real socket/process regressions before implementation. Status: RED; both inactive-on-startup and activation-timeout cases crash their child with the reported TypeError.
- [x] Apply admission/registration fix. Status: complete; allocate a session ID only after admission and ignore handler events that have no registered session.
- [x] Run new and existing listener regression. Status: GREEN; two suites/three tests pass.
- [x] Run baseline server/client tunnel regression and forced build. Status: GREEN; one baseline test passes and forced TypeScript build exits 0.
- [x] Independent review and corrections. Status: PASS by `review_wave0`; three focused listener tests passed, no material findings.
- [x] Integrate, push, close and notify. Status: complete; operational evidence below.

## Test-first evidence

Before changing the pool:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/inactive-listener.test.ts
```

Exit 1; two failed tests, 2.375 seconds. Each real isolated child exited 1 with
`TypeError: Cannot read properties of undefined (reading 'forwardPort')` at
`ExternalPortServerPool.ts:283` during socket termination. No process-wide
exception handler intercepts the defect.

One case starts with `inactiveOnStartup: true`. The other uses the actual
`active(port, 0.05)` API and waits for its real activation timer to expire.
Both connect to the actual listening socket, send rejected data and close it.

After implementation:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/inactive-listener.test.ts test/component/server/ExternalPortServerPool.test.ts
npm run build -- --force
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/e2e/tunnel/baseline-tunnel.test.ts --silent
```

All commands exited 0. New/existing listener tests: two suites/three tests passed,
3.795 seconds. Baseline tunnel regression: one suite/one test passed, 4.65 seconds.
Forced build completed without diagnostics.

## Verified behavior

Both rejection paths leave the listener online with zero status sessions,
zero registered handlers, no new-session notification, no handler event callback
and no termination notification. The test then reactivates the same listener,
performs a real payload echo, observes one accepted session with count one, and
observes exactly one termination callback with final session/handler counts zero.
The parent asserts child exit 0 and the complete result record, so a late
unhandled exception cannot be reported as success.

The implementation does not merely attach the missing option bundle to a
rejected socket. Rejected sockets never receive a session ID or enter the
registered-session event path. Membership guarding also prevents already-removed
handlers from generating duplicate termination/accounting events. Accepted
connection option setup, buffer setup and data forwarding are retained.

Tests use actual sockets, actual timers and isolated child processes; they do
not substitute process, TCPServer or SocketHandler behavior. Internal handler-map
size is read only to verify rejected-session bookkeeping. No production files
outside ExternalPortServerPool were changed. This evidence does not claim full
HTTP/TLS or reconnection coverage beyond the separate existing baseline test.

## Operational completion

Integration commit: `22d6a08`. Independently observed subsequent remote HEAD: `67d81239936d98b05ffeff0765e9f6c3e6979c64`. GitHub independently confirmed CLOSED at `2026-09-07T17:18:41Z`. Root reports forced compilation and four integrated tests passed in 8.874 seconds.

Telegram title: `TDD Gate 10 비활성 외부 포트에 접속 한 번이면 서버 프로세스가 종료됨 (61/13)`. Successful message `3914` is from the orchestrator's tool receipt, not an independent Telegram fetch. Do not duplicate the notification.
