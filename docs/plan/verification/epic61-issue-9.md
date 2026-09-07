# Issue #9 — Control command payload boundaries

Status: integrating; targeted GREEN, existing protocol regression and independent reviews complete.

Original title: 페이로드가 빈 `CloseSession` 제어 패킷 하나로 서버와 클라이언트 프로세스가 종료됨.
Assigned agent: `fix_ci14`. Branch: `fix/epic61-control`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-control`; base `d8cb6a7`.
Writable paths: `src/commons/CtrlPacket.ts`, dedicated #9 tests under
`test/commons/` and `test/component/`, and this evidence file.
Next action: orchestrator commit and focused integration regression on the current Node 24 host; repeat against #63 declarations after that lane is integrated.

## Scope and reuse

The existing parser returned complete packets with short CloseSession payloads;
the getter then read four bytes unconditionally. Merely returning the existing
Error parsing state would still close the control connection because the streamer
throws it. A distinct discarded state now represents a complete frame whose
required command fields are absent. The streamer consumes exactly that frame,
preserves its tail and continues iteratively. It logs a bounded aggregate warning
for discarded payloads. Invalid prefix/unknown-command/oversized-frame behavior
remains unchanged and is not claimed as resolved here (#45).

Required binary bounds are CloseSession's four-byte count, AckCtrl's two length-
prefixed strings, and OpenSession's host/port/TLS/buffer-limit fields. Optional v2
JSON schema handling remains #46. Existing BufferReader, packet factories,
streamer queue/accounting, LoggerFactory and test runtime/network helpers are
reused. No shared transport consumers, manifests or packaging files were edited.

The issue's global exception-handler recommendation was evaluated with the
orchestrator: a process-wide catch-and-continue handler could conceal unrelated
fatal state and is not needed to prevent malformed packets reaching this getter.
The scoped parser/getter fix and isolated-process regression provide the required
defense without changing bootstrap failure policy. This disposition was explicitly
accepted by the orchestrator before implementation.

## Checklist and evidence

- [x] Inspect issue, execution plan and parser/consumer reuse points.
  Status: complete. The bounded early #9 lane is independent of concurrent #63 manifests/packaging; later #28/#45/#46 work is not included.
- [x] Write and execute packet regression before production changes.
  Status: RED. `npm test -- --runInBand test/commons/control-payload-minimum.test.ts` exited 1: 16 failed/one passed. Cases cover zero-to-three-byte close payloads and getter safety, required Ack/Open extents, incomplete-frame waiting, valid frames surrounding malformed payloads, a 4,000-frame burst and valid v1/v2 count/metadata preservation.
- [x] Reproduce all three real consumer failure paths before production changes.
  Status: RED. After correcting fixture setup (named TunnelClient export, required admin port and explicit local legacy-auth opt-in), `npm test -- --runInBand test/component/control-payload-consumers.test.ts` exited 1 with three failed tests in 9.967 seconds. Authenticated server control channel was destroyed; the client with empty output lost its control channel; the pending-output child process exited 1 with unhandled `ERR_BUFFER_OUT_OF_BOUNDS` through `CtrlPacket.waitReceiveLength -> SocketHandler.callAllDrainEvent` after data-socket termination. Initial fixture setup failures/timeouts were not treated as product RED evidence.
- [x] Implement minimum parser/getter defense and precise iterative discard.
  Status: complete, after both RED runs. Declared frame completeness is checked before command payload validity, so partial TCP delivery waits rather than discarding bytes from the next frame. The getter also returns zero for short in-memory payloads.
- [x] Execute focused packet and real consumer regressions.
  Status: GREEN. `npm test -- --runInBand test/commons/control-payload-minimum.test.ts test/component/control-payload-consumers.test.ts` exited 0: two suites/20 tests passed, 7.508 seconds. `npm run build` exited 0. During fixture stabilization, awaiting the data socket's close listener hung because existing SocketHandler cleanup removes listeners; the fixture now waits one event-loop turn for queued write callbacks and asserts destroyed state. Assertions and pending-output proof were retained; no product assertion was weakened.
- [x] Run existing packet/metadata/streamer and authenticated v2 regression.
  Status: GREEN. Handle `10829` exited 0; command `npm test -- --runInBand test/unit/commons/CtrlPacket.test.ts test/commons test/component/server/ProtocolV2.test.ts` passed six suites/53 tests in 28.766 seconds.
- [x] Independent review and corrections.
  Status: PASS by `review_wave0`, six suites/49 tests passed in 6.578 seconds; no material findings. Independent content/title review also PASS by `research_schedule`. Approved title: `fix: 짧은 제어 패킷으로 인한 연결 종료와 예외 차단`.
- [ ] Commit, integrate with Node 24 baseline, verify remote, close issue and send Telegram.
  Status: pending orchestrator; no commit or remote mutation made in this lane.

## Consumer test fidelity and limits

Server regression starts the real TTTServer, authenticates a real local control
socket with explicit test-only legacy opt-in, sends malformed CloseSession plus a
valid sysinfo frame and observes the same pool consuming its tail. Client cases
perform the real TunnelClient handshake against a local protocol peer. They
register a real connected SocketHandler in its active session map as fixture
setup; no parser, getter, transport queue, drain callback or consumer method is
replaced. Socket corking keeps real pending output deterministic while the separate
control connection receives the malformed frame and valid OpenSession tail.
Destroying the data socket then exercises deferred write/drain callbacks. The
parent asserts child exit zero, explicit liveness/tail markers and pending-output
proof. A watchdog fails stalled children rather than accepting missing execution.

Local runtime is Node v24.16.0. These tests target the identified payload defect;
they do not claim complete protocol fuzzing, malformed JSON recovery, or a hosted
CI run. Authentication/TLS production defaults remain unchanged.
