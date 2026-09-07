# Issue #26 — Control-pool handler ownership cleanup

Status: reviewing; shared #26/#27 implementation, focused and broader natural-exit regression, and forced build pass.
Original title: 클라이언트 재연결 때마다 서버의 `TCPServer` 핸들러 맵에 항목이 누적됨.
Assigned agent: `fix_supply15`; branch `fix/epic61-handler-lifecycle`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `2b0a426`.
Approved writable paths: `src/util/TCPServer.ts`, `src/util/SocketHandler.ts`,
`test/component/handler-map-lifecycle.test.ts`, its dedicated driver,
`test/component/socket-owner-terminal.test.ts`, and the separate #26/#27 ledgers.
Next action: independent final review; no commit or other transport issue work.

- [x] Read #26/#27 and search existing terminal cleanup facilities. Status: complete; replaceable onSocketEvent is the only current map cleanup path, and SocketHandler removes native socket listeners during release/destroy.
- [x] Write and reproduce both issue-specific failures before shared implementation. Status: complete; first run failed control plus three HTTP terminal cases.
- [x] Approve minimum SocketHandler ownership hook. Status: root and primary reviewer approved only an optional bound-factory owner callback, private one-shot consumption and five existing terminal transition notifications.
- [x] Add owner contract RED before shared production changes. Status: seven tests failed with zero owner notifications; exact-once, reentrant destroy, live ownership and pending write/FIN checks precede implementation.
- [x] Implement shared fix after approval and run focused/integration regressions. Status: focused 12 tests pass; broader six suites/23 tests pass naturally, forced build exits 0.
- [ ] Independent final review, integration, push, closure and notification. Status: pending.

## RED evidence

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/handler-map-lifecycle.test.ts
```

Before production changes: exit 1; four cases failed, 5.464 seconds. The #26
case creates real TCP control/data sockets, uses actual ClientHandlerPool APIs
to request and register the data handler, and observes the NewDataHandler packet.
It then disconnects control so the real pool.end path replaces callbacks and
ends its data handler. Both handlers reach Closed, but the TCPServer map holds
closed data ID 2 plus live unrelated ID 3, instead of only ID 3.

The fixture also requires a live unrelated connection to remain registered and
requires map size zero after that final live connection closes. This prevents a
blanket map.clear workaround. No socket or ClientHandlerPool implementation is
mocked. The fixture directly wires the lifecycle APIs; it is not a complete
authenticated tunnel-handshake/E2E test.

The HTTP issue's independent RED cases were executed in the same initial run
before any shared production edit; see `epic61-issue-27.md`.

## Approved ownership change

An optional callback supplied only when SocketHandler.bound creates an owned
handler remains separate from mutable onSocketEvent. A private one-shot
notification runs at existing End/Closed transitions before application
callbacks. TCPServer moves only its map deletion into that callback.
Raw socket.once('close') alone cannot cover destroy/release paths because their
removeAllListeners calls precede close delivery. No generic event framework,
ClientHandlerPool/HttpHandler change or client connection API change was made.

## Owner contract and GREEN evidence

Before production edits:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/socket-owner-terminal.test.ts --silent
```

Exit 1; seven failed tests, 0.695 seconds. Reflect.apply supplied the optional
factory argument to the old implementation, which ignored it; the real socket
tests observed zero notifications instead of one. No factory/socket behavior
was replaced. The checks cover native EOF, native close, socket error, explicit
destroy, endImmediate, reentrant destroy from the owner callback, and ownership
retention while end_ waits for buffered output and the peer's FIN.

The callback is stored before initSocket and cleared before invocation, so
reentry cannot deliver it twice. Notification follows the existing state/flag
updates and precedes the replaceable application callback. No notification was
added to end_. Queue/drain operations, client connect signature and application
callback replacement behavior remain unchanged. The owner receives the actual
handler argument; TCPServer does not capture an uninitialized handler variable.

Focused owner and paired map tests: two suites/12 tests pass, 4.744 seconds.
Broader command:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/socket-owner-terminal.test.ts test/component/handler-map-lifecycle.test.ts test/component/tcp-restart.test.ts test/component/inactive-listener.test.ts test/security/req-08-admin-cert-hotapply.test.ts test/unit/util/SocketHandler.resource.test.ts --silent
npm run build -- --force
```

Jest handle **95367 exited 0 naturally**: six suites/23 tests passed, 20.772
seconds. Forced TypeScript build also exited 0. These include restart/error
callbacks, inactive listener bookkeeping, TLS certificate behavior and existing
SocketHandler resource/drain regressions. No forced exit or timer suppression.

End is a logical terminal state for the TCPServer registry, matching its old
cleanup semantics; the hook does not claim that the physical socket has closed
at the first End notification. The black-box leak cases additionally wait until
the closed handlers reach Closed, and retain an unrelated live entry throughout.
