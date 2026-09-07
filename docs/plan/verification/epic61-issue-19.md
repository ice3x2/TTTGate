# Issue #19 — Cache read failures must not become successful sends

Status: independently reviewed and approved; scoped commit authorized, root integration/push/closure pending. No #20 implementation authorized yet.
Original title: 파일 캐시 읽기 실패 시 빈 버퍼를 대신 보내고 성공으로 보고해 데이터가 조용히 사라짐.
Assigned agent: `fix_supply15`; branch `fix/epic61-cache-read`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `bacae6f`.
Approved writable scope: SocketHandler cached dequeue/send-failure/accounting,
narrow FileCache.readSync validation, dedicated real-file/socket regression and
this ledger. Use current main execution plan and approved cache-lane research,
not the older branch's plan. UI, protocol/width #28, cache-ID #20 and successful
cache-release timing remain outside this repair.

- [x] Read approved scope/research and inspect live branch. Status: complete; independent research review passed per root authorization.
- [x] Reproduce deleted/missing cached payload, exact accounting and last-item failed drain before implementation. Status: actual last-item drain returned true, current/follower writes reported success and a survivor's 8192 bytes became global 4096 in the RED run.
- [x] Reproduce an actual truncated backing-file read before changing readSync. Status: both direct FileCache and queued-socket truncated-file cases failed before implementation.
- [x] Implement minimum local failure handling and exact read validation. Status: implemented only after the authoritative RED; failed cached item remains queued until existing error cleanup runs.
- [x] Verify current/follower callbacks once, no failed send bytes, survivor accounting, owner cleanup and successful spill bytes. Status: six focused tests pass naturally, 5.143 seconds.
- [x] Run relevant regression and forced build. Status: six suites/20 tests pass naturally; forced TypeScript build exits 0.
- [x] Two independent reviews. Status: primary `review_wave0` and secondary `fix_ci14` passed code/content/exact-title review. Primary independently ran two suites/six tests with natural exit 0 in 5.128 seconds, as confirmed by root review receipts.
- [ ] Commit/integrate/push/close/notify via root. Status: pending.

Next action: commit only the six owned files with the approved exact title and
hand the hash to the root. #20 waits for reviewed integration and assignment.

## RED before implementation

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/util/file-cache-read.test.ts test/component/cache-read-failure.test.ts
```

Authoritative RED: exit 1, five failed/one successful-spill control passed,
4.871 seconds. Actual observations:

- Deleted final cached item notified its pending drain waiter **true**, expected false.
- Missing current cached record and its queued follower both called completion with success true, expected false.
- Another live handler retained 8192 pending cached bytes, but global accounting became **4096**, expected 8192.
- An actual truncated file produced a successful cached send, expected failure.
- Direct FileCache.readSync after truncating its backing file to two bytes did not throw.

The fixture uses real temporary files, actual FileCache methods and real loopback
TCPServer/SocketHandler connections. It uses the real socket Writable cork/uncork
boundary to hold a 128 KiB prefix in flight while later records remain in the
actual file-backed queue; no write method or socket implementation is replaced.
Pending cache bytes are asserted before corruption. The earlier attempt using
only a paused loopback peer did not establish a queued record and is classified
as fixture setup failure, not the retained socket RED. It did independently
expose the real short-read failure before the deterministic cork fixture was added.

The successful-spill control passes on baseline with exact bytes, callbacks and
drain result. Every child cleans its clients/server and temporary root, then
asserts global accounting returned to its initial value. No production change
had been made at the RED checkpoint above.

## Focused GREEN and implementation

The identical command now exits 0 naturally: two suites/six tests pass in
5.143 seconds. Failed drain is false exactly once, current/follower writes fail
once, the current failure contains an Error, failed bytes do not increase
sendLength, the failed socket becomes terminal and leaves its TCP owner, and
the independent survivor retains its full 8192-byte contribution. The unmodified
successful-spill control still receives exact bytes and success/drain callbacks.

Cached dequeue now peeks until read validation succeeds. A missing payload or
read error reaches procError while the current item still contributes pending
bytes, so existing drain notification is false even for the final failed item.
Error cleanup then completes/removes current and follower records once and
passes the error through their existing optional completion argument. No extra
cacheID sentinel or broad release-timing redesign was introduced. Successful
reads still release their cache record before socket write, as before.

FileCache.readSync now fills the requested record in a bounded-by-length read
loop and throws on unexpected EOF; incomplete allocUnsafe data is never returned.
Missing/deleted record returns remain undefined. Block-ID allocation (#20),
protocol formats, UI and quota policy are unchanged.

## Broader checkpoint

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/util/file-cache-read.test.ts test/component/cache-read-failure.test.ts test/unit/util/SocketHandler.resource.test.ts test/component/socket-owner-terminal.test.ts test/component/handler-map-lifecycle.test.ts test/e2e/tunnel/baseline-tunnel.test.ts
npm run build -- --force
```

Jest handle **25520 exited 0 naturally**: six suites/20 tests passed, 14.271
seconds. Forced build exited 0. This includes owner-terminal and callback-
replacement cleanup, existing resource limits and baseline tunnel data flow.
No forced exit or socket/write substitution is used by the new tests.

Actual changed paths are `src/util/SocketHandler.ts`, `src/util/FileCache.ts`,
`test/component/cache-read-failure-driver.ts`,
`test/component/cache-read-failure.test.ts`, `test/unit/util/file-cache-read.test.ts`
and this ledger. The first two contain the only production changes. No queue
release-to-write-callback migration, cache-ID reuse fix or UI change is included.

## Independent approval

Both assigned reviewers approved before root authorized the scoped commit:
`review_wave0` (primary) and `fix_ci14` (secondary), code/content/message PASS.
The primary's independent real-file/socket run passed two suites/six tests and
exited naturally in 5.128 seconds. No material review findings remain.
Approved exact title: `fix: 파일 캐시 읽기 실패를 전송 성공으로 보고하지 않도록 수정`.
