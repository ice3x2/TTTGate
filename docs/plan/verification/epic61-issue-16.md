# Issue #16 — Sentinel failure exits its own process

Status: reviewing; strict RED, focused GREEN and forced build complete.
Original title: `Sentinel` 이 자기 프로세스 대신 PID 1 에 SIGTERM 을 보냄.
Assigned agent: `fix_supply15`; branch `fix/epic61-process`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-process`; base `b093dce`.
Writable paths: `src/Sentinel.ts`, `test/component/sentinel-exit.test.ts`,
`test/component/sentinel-exit-driver.cjs`, and this ledger.
Next action: independent review; no commit or #21 implementation before review
and orchestrator integration.

- [x] Read #16, technical decisions and current integration plan. Status: complete; use the explicitly authorized early process lane parallel to administrator work.
- [x] Search existing subprocess helpers and Sentinel tests. Status: complete; reuse the established real child Node + ts-node pattern from #9; no existing Sentinel suite or production injection facility to reuse.
- [x] Reproduce the dangerous target selection before implementation without delivering OS signals. Status: RED; one failed/one passed test, exact observations below.
- [x] Apply minimum self-termination fix. Status: complete; preserve lookup error logging and timer cancellation, replace both signal requests with native `process.exit(1)`.
- [x] Execute failure and healthy monitoring regression. Status: GREEN; one suite/two tests pass.
- [x] Force TypeScript build. Status: `npm run build -- --force`, handle 32884, exit 0.
- [ ] Independent review and any corrections. Status: pending orchestrator assignment.
- [ ] Integrate, push, close and notify. Status: pending orchestrator; no commit or remote mutation in this lane.

## Test-first evidence

The same command ran before and after changing `Sentinel.ts`:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/sentinel-exit.test.ts
```

RED (handle 57342): exit 1; one failed/one passed, 12.9 seconds. The failure
fixture's synchronous journal recorded these requested targets:

```json
[{"kind":"signal","pid":26576,"signal":"SIGTERM"},{"kind":"signal","pid":1,"signal":"SIGTERM"}]
```

26576 was the isolated child PID for that run. Every signal request was
intercepted and recorded before it could reach the OS; **zero signals were
forwarded**, including the PID 1 request. The test expected no signal requests.
The healthy lookup case already passed its second real three-second polling
interval before implementation.

GREEN (handle 72272): exit 0; one suite/two tests passed, 11.604 seconds.
Assertions verify the failing lookup was queried for the actual child's PID,
no signal target was requested, no watchdog ended the child, native child exit
status was 1 with no terminating signal, the lookup error remained observable,
and the exit journal recorded code 1. The healthy scenario observes two real
polling intervals and then the fixture intentionally exits with status 0.

The fixture deliberately replaces `find-process` results and the child's
`process.kill` boundary. It is **not described as mock-free**. `process.exit`,
the child process, promises, timers, logger and filesystem journal are real.
The parent process is never patched, and this work never sends PID 1 or any
external process a signal. The fallback watchdog uses only its own child exit.

## Change and limits

The lookup-error branch still reports the original error and cancels its polling
interval, then exits its own Node process with failure code 1. It no longer
sends asynchronous SIGTERM to itself followed by SIGTERM to PID 1, and the
misleading `Stop app` message was removed. App restart, launch and explicit
user-requested stop behavior are unchanged by this narrow fix.

The test exercises a deterministic lookup rejection rather than waiting for a
real platform process-discovery outage. It does not claim full daemon E2E or
container shutdown testing. Both normal polling and failure behavior are
verified in real isolated child processes with the stated boundary fixtures.
