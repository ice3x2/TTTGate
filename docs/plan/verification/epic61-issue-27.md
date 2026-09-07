# Issue #27 — HTTP handler ownership cleanup

Status: complete; independently reviewed, integrated, pushed, closed and notified.
Original title: HTTP 외부 포트가 접속 하나마다 핸들러를 영구 누적함.
Assigned agent: `fix_supply15`; branch `fix/epic61-handler-lifecycle`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `2b0a426`.
Writable test paths shared with #26: `test/component/handler-map-lifecycle.test.ts`
and `test/component/handler-map-lifecycle-driver.ts`, plus the new owner-contract
test. Root/primary review approved the bounded TCPServer/SocketHandler ownership
change. HttpHandler/EPS remain read-only. Next action: none for this issue; operational completion is recorded below.

- [x] Read #27/#26 and inspect actual HttpHandler callback replacement. Status: complete.
- [x] Reproduce HTTP terminal retention before shared implementation. Status: RED for natural EOF, actual HttpHandler.destroy and explicit socket-error paths; control-case RED was captured in the same run.
- [x] Approve and implement shared owner-termination cleanup. Status: root/primary-approved optional owner hook implemented only after both issue REDs and seven additional owner-contract REDs.
- [x] Run focused/integration regressions. Status: paired/owner 12 tests pass; broader six suites/23 tests exit 0 naturally and forced build passes, as recorded in #26 ledger.
- [x] Independent final review. Status: two independent reviews PASS as recorded in the GitHub closure comment.
- [x] Integrate, push, close and notify. Status: complete; operational evidence below.

## RED evidence

The initial shared command recorded in #26's ledger exited 1 with four failed
cases. Each #27 case starts the actual ExternalPortServerPool in HTTP mode and
uses the actual HttpHandler replacement path. Two real connections are retained;
closing the first leaves TCPServer map IDs [1, 2] instead of only the still-live
ID 2. The final live connection must remain until it too closes.

Terminal paths: client EOF with an actual HTTP request; public HttpHandler.destroy;
and native socket.destroy(Error), which deliberately injects an error into the
real socket error/release path. The error injection is explicitly a deterministic
fixture, not a claim of an observed physical network failure. Browser/crypto/
socket implementations are not replaced. Both issue-specific REDs precede any
shared implementation, avoiding a test-after fix for the second issue.

A further raw-close case directly destroys the actual underlying socket without
an error, covering the native close listener independently of EOF and public
handler.destroy. Before implementation it also failed (one failed/four unselected,
2.254 seconds), retaining closed ID 1 beside live ID 2.

## GREEN and semantic boundary

All four HTTP terminal modes now remove only the logically terminated handler
from the TCPServer registry while retaining the second live connection. Closing
that final connection leaves the registry empty. The actual HttpHandler still
replaces onSocketEvent; it requires no forwarding workaround or source changes.

The owner callback is consumed once independently of native socket listeners,
so explicit destroy/error cleanup cannot erase it through removeAllListeners.
Seven real-socket contract tests additionally verify callback ordering, reentrant
destroy and no premature notification while end_ waits for write drain/peer FIN.
Full commands and natural exit/build results are in `epic61-issue-26.md`.

The notification tracks existing logical End/Closed semantics, not a claim of
physical close at End. No HTTP parsing, TLS policy, control protocol, session
callback or configuration behavior is changed by this ownership fix.

## Operational completion

Integration commit: `bf6b790`. Independently observed pushed `origin/fix/epic-61` HEAD: `bf6b790832b838ee8e8bb528dc974dd0810795f9`. GitHub independently confirmed CLOSED at `2026-09-07T19:19:05Z`. The existing GitHub closure comment records two independent reviews, six suites/23 integration tests and forced compilation PASS. Hosted workflow execution is not claimed.

Telegram title: TDD Gate 27 HTTP 외부 포트가 접속 하나마다 핸들러를 영구 누적함 (62/19). Successful message `3920` is from the orchestrator's tool receipt, not an independent Telegram fetch. Do not duplicate the notification.
