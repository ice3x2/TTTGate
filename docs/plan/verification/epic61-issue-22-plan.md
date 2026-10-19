# Issue #22 — Socket log persistence pre-plan

Status: complete; source 1099b55e970b57408aeca663f3690b32a100a06c, integration c40ef3ca29fb26dc0c812cab8f2936820319c561 pushed and remote verified; GitHub CLOSED 2026-09-08T03:15:04Z, comment 5578555935; root Telegram receipt 3964 (66/36). Integrated three suites/nine tests PASS in 3.323 seconds, natural exit 0; forced build exit 0.
Original issue: 소켓 계층 로그가 파일에 기록되지 않고 데몬 모드에서 전부 소실됨.
Planner: `fix_supply15`; prior read-only researcher: `review_cert_conflict`.
Location: integration worktree `C:/Work/git/_Snoworca/TTTGate-epic61`.
Assigned owner: `review_cert_conflict`; worktree `C:/Work/git/_Snoworca/TTTGate-epic61-process`, branch `fix/epic61-socket-logs`, base `7a79df4`. Root approved only the three source files below plus dedicated test/driver and ledger22.

- [x] Read original issue and obtain prior research. Status: complete; reviewer supplied its earlier root-only research receipt; no earlier executed daemon reproduction was claimed.
- [x] Verify current source/reuse anchors. Status: both socket modules use an empty logger name; the default writer has file:false; configureLogger registers server/client/boot only.
- [x] Independently review this plan and approve the bounded parallel assignment. Status: review_wave0 reported zero findings and PASS; root approved the bounded lane alongside administrator #38.
- [x] Create assigned worktree and ledger22. Status: completed; historical assignment above and execution evidence in epic61-issue-22.md.
- [x] Write and observe real logging RED before source edits. Status: completed; ignored-stdio child/control checks passed while socket log assertions failed before implementation.
- [x] Apply minimum three-file fix, obtain GREEN/build and two independent reviews. Status: completed; both reviews PASS and integration regression/build passed.
- [x] Authorized commit/integration/push/closure/notification. Status: complete; source 1099b55e970b57408aeca663f3690b32a100a06c, integration c40ef3ca29fb26dc0c812cab8f2936820319c561 pushed and remote verified; GitHub CLOSED 2026-09-08T03:15:04Z, comment 5578555935; root Telegram receipt 3964 (66/36). Integrated three suites/nine tests PASS in 3.323 seconds, natural exit 0; forced build exit 0.

## Minimum change and reuse

| Path | Planned change / existing behavior |
| --- | --- |
| `src/util/SocketHandler.ts:15` | Change only the logger name from empty to common `socket`; retain module label SocketHandler. |
| `src/util/TCPServer.ts:8` | Use the same `socket` writer; retain module label TCPServer. |
| `src/bootstrap/AppCompositionRoot.ts:8` | Register one `socket` writer through the existing appendWriteConfig/updateConfig pattern. Keep foreground console behavior and existing file/retention/redaction defaults. |
| `src/util/logger/LoggerFactory.ts:60` | Read-only: unregistered names fall back to the default writer, so changing names alone is insufficient. |
| `src/util/logger/LoggerConfig.ts:21` | Read-only: empty/default writer disables file output; named registration defaults file output on. |
| `src/Sentinel.ts:261` | Read-only evidence of ignored stdin/stdout/stderr in daemon children. |

Reuse the existing LoggerFactory/LogWriter, date-named files, permission/error
handling, redaction and #21 retention behavior. No second writer implementation,
per-server/client socket logger split or new logging option is proposed.

## Strict RED experiment

Use a fresh owned temporary root and an owned child driver. The driver must invoke
the actual AppCompositionRoot.configureLogger after Environment configuration; the
test must not register a socket writer itself. Trigger these existing paths:

1. Bind a real SocketHandler to an owned loopback connection, call setTimeout with
   a short bounded idle timeout, and observe its normal terminal callback.
2. Hold an owned wildcard listener and start a real TCPServer on that occupied
   port; observe EADDRINUSE without crashing the child or touching foreign listeners.
3. Emit a control marker through already configured `server` logging. It must reach
   the owned log directory, proving file output/flush works independently of the bug.

Parent launches the driver with `stdio: ['ignore', 'ignore', 'ignore']`. The child
writes a small separate event receipt into the owned root after the real timeout
and bind-conflict callbacks; that receipt must not contain fabricated log entries.
After child natural exit, assert the control marker is in actual files and require
both SocketHandler timeout and TCPServer EADDRINUSE entries in `socket-*.log`.
Baseline must fail the socket-log assertions while the real-event/control checks
pass. This demonstrates the ignored-stdio child boundary, not a full Sentinel
watchdog, daemon restart or process-discovery lifecycle run.

Track every child/socket/listener from allocation. Bound waits and fail on timeout;
close only owned resources and allow actual log writes to finish. Use existing
writer teardown/config replacement only after events if needed; do not add a new
logger shutdown API, force process exit to fake flush, call generic Sentinel.stop,
or broaden process termination. Preserve the child exit status and file evidence.

## GREEN and exclusions

Run the identical experiment after the three-file fix, then relevant existing
log-retention/socket-timeout/TCP-restart regressions and forced TypeScript build.
Review original issue, diff, event receipts and real files independently. Record
test counts, natural exit and review findings in ledger22 before root integration.

Writable scope after approval: those three source files, dedicated logging
child/tests and ledger22 only. Sentinel and logger implementations, transport/cache
lifecycle, pool/types/wire and #29 are excluded. This independent logging task does
not authorize bypassing the separate #29 automatic security-review block.

The experiment and ownership sections above preserve the approved pre-implementation plan. Execution and closure are complete in epic61-issue-22.md; they are not outstanding assignment instructions.
