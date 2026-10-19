# Issue #20 — Fresh identifiers for reused cache blocks

Status: complete; independently reviewed, committed, integrated, pushed, closed and notified.
Original title: 파일 캐시 블록 재사용 시 식별자를 재발급하지 않아 전송 중인 데이터가 해제됨.
Assigned agent: `fix_supply15`; branch `fix/epic61-cache-identity`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `bbf1ef4`.
Owned paths: reusable-block ID allocation in `src/util/FileCache.ts`, dedicated
real-file identity tests and this ledger. SocketHandler and successful release
timing are unchanged; #19 reviewed integration is the prerequisite baseline.

- [x] Read #20 and approved cache research/serial ownership. Status: complete.
- [x] Force block reuse with another live anchor and capture stale-ID RED before code. Status: four failed/one passed, 0.671 seconds; reused ID equals 1, stale read returns replacement bytes and stale remove returns true.
- [x] Assign a fresh identifier on reusable-block allocation. Status: implemented after RED; one production line issues the next ID in the reuse branch.
- [x] Verify stale reads/removal cannot touch current data, valid IO and #19 regression. Status: handle 21909 exited 0 naturally; three suites/11 tests passed, 8.54 seconds.
- [x] Forced build. Status: `npm run build -- --force` exited 0.
- [x] Two independent reviews. Status: primary `review_wave0` and secondary `fix_ci14` passed code/content/title review; primary independently ran five real-file tests with natural exit 0 in 0.364 seconds, confirmed by root review receipts.
- [x] Scoped commit and root integration/push/closure/notification. Status: complete; operational evidence below.

Next action: none for this issue; any new admin lane requires separate research review and root approval.

## RED evidence

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/util/file-cache-identity.test.ts
```

Before code edits, exit 1: four failed/one passed in 0.671 seconds. A second live
record keeps the free list intact, and tests assert unchanged physical position
and allocated size to prove reuse rather than fresh allocation. The old numeric
ID is saved before the mutable CacheRecord object can be reused. Separate tests
observe unchanged ID 1, stale-ID reads returning `new payload`, stale removal
returning true, and repetition reusing a released ID. Empty-cache reallocation
is a distinct already-passing control.

## GREEN and limits

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/util/file-cache-identity.test.ts test/unit/util/file-cache-read.test.ts test/component/cache-read-failure.test.ts
npm run build -- --force
```

Jest handle **21909 exited 0 naturally**: three suites/11 tests passed, 8.54
seconds. Forced build exited 0. The tests verify fresh primitive IDs across
repeated physical reuse, stale read/removal rejection, preserved current/anchor
bytes, empty-cache allocation and all #19 real cache/socket failure/positive cases.

Only `block.id = this._lastId++` was added to the reusable-block branch. Existing
capacity/position/length behavior, mutable CacheRecord object reuse and successful
SocketHandler release timing are unchanged. The tests intentionally save old
primitive IDs; they do not claim immutable historical CacheRecord objects.
No SocketHandler, protocol, UI or policy changes are included.

Actual owned files: `src/util/FileCache.ts`,
`test/unit/util/file-cache-identity.test.ts`, and this ledger.
Proposed title: `fix: 재사용 파일 캐시 블록에 새 식별자 발급`.

## Operational completion

Source commit: `aa261a3`. Integration commit and independently observed pushed `origin/fix/epic-61` HEAD: `1670ea79f3c5d1f7133e8f64b0bb9e1740730481`. GitHub independently confirmed CLOSED at `2026-09-07T22:24:55Z`. Root reports three suites/11 integration tests passed naturally in 5.056 seconds; prior forced compilation and independent real-file tests are recorded above.

Telegram title: `TDD Gate 20 파일 캐시 블록 재사용 시 식별자를 재발급하지 않아 전송 중인 데이터가 해제됨 (63/24)`. Successful message `3927` is from the orchestrator's tool receipt, not an independent Telegram fetch. Existing notification denominators remain unchanged. Do not duplicate the notification.

Both reviewers approved that exact title before root authorized the scoped
commit. Primary `review_wave0` and secondary `fix_ci14` reported no material
findings; the independent five-test real-file run exited naturally in 0.364
seconds. No admin-lane research document belongs to this commit.
