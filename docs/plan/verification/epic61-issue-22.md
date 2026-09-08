# Issue #22 — Persist socket logs when child stdio is ignored

Status: three-line production fix, real-file GREEN, selected regressions, forced build and both independent reviews passed; source frozen. Root commit authorization remains pending.
Owner: review_cert_conflict; branch `fix/epic61-socket-logs`, base `7a79df4`;
worktree `C:/Work/git/_Snoworca/TTTGate-epic61-process`.
Approved root plan: main `docs/plan/verification/epic61-issue-22-plan.md`.

- [x] Read issue, approved plan and reuse paths. Status: complete; empty logger names select file-disabled fallback. Production configureLogger currently registers server/client/boot.
- [x] Observe real timeout/bind-error/control-file RED with ignored stdio. Status: actual child exit 0, timeout/owner/EADDRINUSE and server control-file assertions passed; both required socket log records absent. Jest exit 1, one failed test, 1.212 seconds, before any source edits.
- [x] Apply only two logger names and one existing writer registration. Status: socket name added to the two modules and production configureLogger; no logger/transport behavior edits.
- [x] Focused and relevant regression/build. Status: three suites/nine tests passed naturally in 3.663 seconds; forced TypeScript build exited 0. Exact command and evidence below.
- [x] Two independent original-issue/diff/evidence/title reviews. Status: review_wave0 and fix_supply15 independently PASS with zero Critical/High/Medium/Low findings; source frozen. Root relayed fix_supply15's confirmation of the reviewer-authored execution record as well.
- [ ] Root-authorized commit/integration/push/closure/notification. Status: not authorized.

The test uses actual AppCompositionRoot configuration, real bound SocketHandler
timeout and TCPServer EADDRINUSE from a second owned wildcard listener. It does
not register a test-only socket writer. A real server logger control proves file
output exists independently. Parent ignores all child stdio exactly as Sentinel's
spawn boundary does; this is not an actual Sentinel watchdog/restart run.
Only owned listeners/sockets are closed, and existing logger config replacement
ends actual streams. No forced process exit or fake flush. A child timeout fails.
Each run copies its actual logs, event receipt and child status into a fresh
ignored results/logging/issue22-* directory for review.

Production scope: logger declaration in SocketHandler/TCPServer and one socket
writer registration in AppCompositionRoot. Logger/Sentinel implementations,
transport lifecycle, cache and blocked #29 work remain unchanged.

RED command: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/socket-log-persistence.test.ts`.
Execution chunk 7ee4b1, exit 1 naturally. Actual preserved logs/receipt:
`results/logging/issue22-1788836751225`. No fixture failures preceded this RED.

GREEN/regression command:
`node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/component/socket-log-persistence.test.ts test/unit/util/log-retention.test.ts test/component/tcp-restart.test.ts`.
Execution chunk cf1d00 exited 0 naturally: three suites, nine tests, 3.663 seconds.
The unchanged dedicated assertion now observes both SocketHandler timeout and
TCPServer EADDRINUSE in actual socket-*.log files, along with the independent
server control. Actual child receipt/logs: `results/logging/issue22-1788836788905`.
These are ignored-stdio child tests, not full Sentinel daemon supervision.

`npm run build -- --force` (chunk cc47b7) exited 0 after the fix. No manifest,
logger implementation, Sentinel, generic transport or blocked HTTP EOF changes.
The selected regressions cover existing retention and actual TCP stop/start
behavior in addition to the new real idle-timeout logging event.

Proposed exact title: `fix: 소켓 계층 로그를 파일에 기록`.
Six scoped files: three production files, dedicated test/child driver and this
ledger. Original issue and approved main plan are unchanged; runtime evidence
directories are preserved but excluded from the commit. No files are staged and
no commit/push/notification has been performed by the implementation owner.

## Independent review checkpoint

Reviewer review_wave0 independently read the original issue/approved plan, three
production changes, test/driver, ledger and preserved RED/GREEN event/log files.
Result: PASS, zero Critical/High/Medium/Low findings. Both preserved children exited
0 with real timeout, one owner callback and EADDRINUSE receipts; the server-file
control exists in both runs, while only GREEN contains both required socket logs.
The existing logger config replacement closes streams, and the fixture cleans
owned sockets/listeners without forced process exit. This is not full Sentinel
daemon-supervision evidence.

Independent selected command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/socket-log-persistence.test.ts`.
Execution chunk e0261e exited 0 naturally: one suite/one test passed, 1.032 seconds.
Exact proposed title passed scope, signature and progress-marker checks.
Root subsequently relayed fix_supply15's independent code/content/exact-title
PASS with zero Critical/High/Medium/Low findings and confirmation of this selected
execution record. Both reviews are complete; root commit authorization and
integration/push/closure/notification remain pending.
