# Issue #39 — Preserve TCP server lifecycle across restart

Status: complete; independently reviewed, integrated, pushed, closed and notified. Final broader regression exits naturally; prior assertions-only diagnostic remains unclassified.
Original title: `TCPServer` 재시작 시 서버 이벤트 핸들러가 재부착되지 않아 포트 충돌로 프로세스가 죽음.
Assigned agent: `fix_supply15`; branch `fix/epic61-tcp-restart`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `67d8123`.
Writable paths: `src/util/TCPServer.ts`, `test/component/tcp-restart.test.ts`,
`test/component/tcp-restart-driver.ts`, and this ledger.
Next action: none for this issue; paired #26/#27 is now assigned separately.

- [x] Read #39, current integration plan and existing TCP/listener tests. Status: complete; #10 reviewed integration precedes this branch.
- [x] Check reuse. Status: complete; use the existing server factory, event callbacks, free-port/roundtrip helpers and child-test pattern. Server handler setup is moved into the factory instead of duplicated after each restart.
- [x] Write failing restart/collision/lifecycle regressions before implementation. Status: RED; details below include actual EADDRINUSE without a start callback.
- [x] Repair instance lifecycle and callback retention. Status: complete; each new server receives lifecycle handlers, teardown affects its own instance, public callbacks survive restart, and stale errors clear for a fresh attempt.
- [x] Run dedicated real-child/socket regression. Status: GREEN; four tests pass and the Jest process exits 0.
- [x] Force TypeScript build. Status: handle 98127 exited 0.
- [x] Complete broader regression disposition. Status: reviewed #49 partial repair 9c9c8f7 was cherry-picked as 3a2e570; new handle 94401 exited naturally with code 0, four suites/11 tests passed in 21.275 seconds. Earlier handle 7475 remains an unobserved termination, not PASS.
- [x] Independent review and corrections. Status: final PASS by `review_wave0`; dedicated tests and broader natural-exit regression verified.
- [x] Integrate, push, close and notify. Status: complete; operational evidence below.

## RED evidence

Before editing TCPServer:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/tcp-restart.test.ts
```

All four cases failed. Repeated restart left `isListen()` false after the
successful start callback. Restarting synchronously inside the close event lost
the new server's handlers and timed out. The first collision fixture bound only
IPv4 loopback, which did not reliably conflict with the production wildcard
listener on Windows; that fixture was corrected before any production changes.

The collision-only RED was then repeated with both blocker and production
server binding the same wildcard address:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/tcp-restart.test.ts -t collision
```

Exit 1; two failed/two unselected tests. Without a start callback the child
terminated with uncaught `Error: listen EADDRINUSE: address already in use
:::51639`. With a callback the missing persistent lifecycle event caused a
12-second child timeout. No process-wide exception catcher, fake process or
fake socket is used; only the child is bounded by the parent's timeout.

## GREEN evidence

After implementation, the full dedicated command above exited 0:
one suite/four tests passed, 4.28 seconds. It verifies:

- Three full start/echo/stop cycles: exactly three Listen, Closed, Bound, start
  completion and stop completion callbacks.
- Real restart-port collision both with and without a start callback: error
  remains observable through `getError()` and a Closed event; supplied error
  callback receives EADDRINUSE exactly once.
- Recovery after releasing the conflicting socket: listening/data flow resume,
  the old error is cleared, and callback counts remain exact.
- Synchronous restart inside the Closed callback: old-instance cleanup does not
  erase the new instance's listeners or state; healthy echo and final stop pass.

The broader command was:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/tcp-restart.test.ts test/component/inactive-listener.test.ts test/component/server/ExternalPortServerPool.test.ts test/security/req-08-admin-cert-hotapply.test.ts --silent
```

It reported four suites/11 tests passed in 19.484 seconds, then warned that Jest
did not exit. Handle **7475 was confirmed live**, so exit 0 was not claimed. Source inspection
finds the existing TLS case (5) calls only `pool.stop(port)` and case (6) creates
a pool without disposal; pool construction starts a ten-second cleanup interval
which is stopped only by stopAll/dispose. Independent baseline verification is
requested before attributing the retained handles. The TLS test file is outside
this lane and remains untouched.

`npm run build -- --force` (handle 98127) exited 0.

## Implementation limits

Error/close/listening handlers share the existing factory for TCP and TLS.
Handler closures retain the concrete native server, preventing a delayed old
event from changing the current server. Teardown runs before the public Closed
callback and only removes listeners from the old native server; user callbacks
remain configured on the reusable wrapper. Paired operation listeners remove
their opposite completion listener, so successful start listeners do not retain
an error callback for a later failure.

TLS option construction and certificate verification behavior are unchanged.
No SocketHandler, ExternalPortServerPool, protocol, HTTP, configuration or
administrator implementation changed. Retained callback behavior is exercised
with real network traffic, not just listener-count assertions.

## Diagnostic process revalidation

After independent baseline verification confirmed the existing TLS fixture leak,
the orchestrator authorized stopping only the owned diagnostic process. The
exact four-test command had no matching live Node process in Win32_Process;
polling the original handle 7475 returned `Unknown process id 7475`. A broader
read-only Jest process inventory showed only PID 73636 running the distinct
single-file TLS probe with `--detectOpenHandles`; it was not this worker's four-
suite job and was not signaled. No process was killed because no owned live
target could be verified. The old diagnostic's termination cause and exit code
remain unobserved; it is not classified as natural PASS.

The separate #49 partial fixture repair was reviewed independently and integrated
before repeating the broader test command. #49 itself remains open for global
shutdown/force-exit work.

## Final natural-exit regression

Root commit `9c9c8f7` (only TLS fixture cleanup and its ledger) was cherry-picked
as `3a2e570` without changes to the pending #39 source/test diff. The independent
fixture repair disposes both test-owned pools; #39 did not edit that fixture.

The exact broader command recorded above was rerun, without `--forceExit` or any
new exception catcher. Handle **94401 exited 0 naturally**:
four suites/11 tests passed, 21.275 seconds. This includes real restart/collision
and synchronous callback-restart cases, inactive-listener bookkeeping, existing
pool operations and TLS certificate hot-apply. No lingering-Jest warning or
watchdog termination was used for this result.

The prior 7475 assertions-only run and unknown eventual termination remain
recorded separately; the new successful process does not change their status.

## Operational completion

Integration commit: `cf38c9d`. Independently observed subsequent remote HEAD: `2b0a42690f6aa52046cc648cc7b1ec479b3f4c8f`. GitHub independently confirmed CLOSED at `2026-09-07T18:29:25Z`. Root's final shared integration selection passed six suites/25 tests naturally in 109.895 seconds. The first run's native Vite-child failure and focused follow-up remain recorded in `epic61-integration-native-failure.md`; they are not retroactively marked PASS. The separate #49 fixture cleanup `8266c10` is integrated, but #49 remains open.

Telegram title: TDD Gate 39 `TCPServer` 재시작 시 서버 이벤트 핸들러가 재부착되지 않아 포트 충돌로 프로세스가 죽음 (62/15). Successful message `3916` is from the orchestrator's tool receipt, not an independent Telegram fetch. Do not duplicate the notification.
