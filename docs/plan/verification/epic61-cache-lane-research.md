# Proposed early file-cache lane — #19 then #20

Status: independently reviewed and approved; the bounded #19/#20 exception is recorded in the execution plan. Implementation follows that plan's exclusive ownership and test-first gates.
Researcher: `fix_supply15`. Inspected integration HEAD:
`1caf4df9f7418678a355a2ef39dfd80d9d9cd62f`.
Only this research document is written; `epic-61-execution.md` remains owned by
its existing planner. #28 implementation remains blocked on the user's protocol
compatibility decision.

- [x] Read original #19/#20 and inspect cache, send-loop and callback consumers. Status: complete.
- [x] Check existing plan, ADRs, test helpers and shared-file dependencies. Status: complete.
- [x] Define bounded source ownership and proposed test-first evidence. Status: complete below; tests are proposed, not executed.
- [x] Independently review this research and early-lane exception. Status: `review_wave0` passed the source/dependency review; require an additional last-item drain-failure RED case.
- [x] Root approves scope and has the single plan owner apply the exception. Status: root applied the bounded exception to the main plan.
- [x] Assign a fresh branch before implementation. Status: `fix/epic61-cache-read` in the existing clean listeners worktree, based on `bacae6f`; the assigned worker must persist its issue ledger before RED/implementation.

## Conclusion and sequencing

An early cache lane can run alongside administrator #8/#51: cache-file and
socket-send bookkeeping do not depend on browser login/bootstrap/routing. Execute
**#19, then #20 serially under the same owner**, preserving the completed
#26/#27 terminal-owner cleanup. No change to control-packet format, negotiated
protocol, counter width or HTTP parsing is needed for these two repairs.

The existing plan puts #19/#20 in Wave 4 after Wave 3 because that lane broadly
groups overlapping transport/resource work. This proposal creates a narrow
exception only; it does not release #28 or the following HTTP/transport work.
Any additional caller or framing change discovered during TDD must be reported
for ownership/scope review before editing.

## Original issues and code anchors

| Requirement | Current evidence at the inspected HEAD |
| --- | --- |
| [#19: failed cache reads silently report successful sends](https://github.com/ice3x2/TTTGate/issues/19) | `src/util/SocketHandler.ts:710` dequeues a cached item; lines 716–718 read/remove/decrement it; the following fallback substitutes EMPTY_BUFFER. `sendPopDataRecursive2` starts at line 589 and adds the original item length to `_sendLength` at line 627 after write success. |
| #19: repeated cache release/accounting | `src/util/SocketHandler.ts:725` completion subtracts queue bytes; lines 730–732 remove/decrement again when the buffer is the empty sentinel. A failed read takes that path after the earlier decrement. |
| #19: absent data and short reads | `src/util/FileCache.ts:141` returns undefined for deleted/unopened cache or missing ID. Line 150 ignores the byte count returned by fs.readSync and returns an allocUnsafe buffer of the requested length. A short-read/truncation case is an additional source-observed candidate to reproduce; no runtime reproduction is claimed here. |
| [#20: freed block ID is reused for new content](https://github.com/ice3x2/TTTGate/issues/20) | `src/util/FileCache.ts:38` finds a reusable block; line 117 changes its length but does not issue a new ID. Only the fresh-allocation branch at line 129 increments `_lastId`. `remove` starts at line 154 and returns blocks to the free list. |
| Existing failure/cleanup APIs | `src/util/SocketHandler.ts:395` has procError; owner notification is at line 322 and existing terminal transitions; `failWaitItem` is at line 739 and the `(handler, success, error?)` completion contract at line 797. |

FileCache.readSync has only one production caller: SocketHandler's cached dequeue.
Thus the read-validation contract can be repaired locally without changing
administrator or protocol consumers.

## Caller semantics and preservation requirements

The send completion API already represents failure as `success=false` with an
optional Error. ExternalPortServerPool's callback (`:240`) only advances graceful
close logic on success. TunnelServer's handshake-send callback (`:418` onward)
logs failure; several ClientHandlerPool paths inspect success. EndPointClientPool
(`:113`) ignores the success argument and invokes its closure check. Therefore,
reporting false alone is insufficient: the failed SocketHandler must also enter
its existing local error/terminal cleanup so consumers and its TCP owner observe
closure. This matches ADR-006's connection/session-local containment.

Do not add failed bytes to sendLength, write a substitute empty payload, leave
the dequeued item without a failure callback, or report a successful drain for
discarded data. The failed item and remaining queued items must complete at most
once and release their owned accounting once. Another live handler's cache
accounting must remain intact.

Preserve existing successful cache-release timing. #20 explicitly defers moving
release from read completion to socket-write completion as a larger change; it
must not be introduced incidentally. Also avoid simply marking a consumed cache
item as `cacheID=-1`: current callers use that sentinel to decide whether to
subtract memory-buffer usage, so such a shortcut can change the wrong counter.
Choose the smallest explicit ownership representation justified by RED evidence.

Keep FileCache's existing missing-ID/deleted-cache semantics unless the tests
demonstrate a required contract change. A real I/O exception is exceptional;
do not use catch/retry as the normal queue-dispatch mechanism or swallow it.

## Proposed exclusive ownership

| Issue | Allowed implementation area after approval | Read-only/deferred |
| --- | --- | --- |
| #19 | SocketHandler's cached dequeue, send failure handling and per-item accounting; FileCache.readSync only if precise short-read/error detection is required; dedicated file/socket tests and #19 ledger | ClientHandlerPool, EndPointClientPool, HttpHandler, TCPServer lifecycle, admin code, manifests/workflows, protocol counters |
| #20 | FileCache.writeSync reusable-block identifier allocation and dedicated direct cache tests/#20 ledger, after #19 is reviewed and integrated | Broad release-timing redesign, HTTP behavior, packet encoding, unrelated cache/path cleanup |

FileCache is a shared file between these items, and SocketHandler relies on its
record ownership semantics. Serial execution is required even if #19 initially
needs only SocketHandler edits. A future owner modifying SocketHandler for #28,
#22, #40 or other transport work must wait for this lane's integration.

## Proposed strict TDD for #19

1. Create a temporary cache directory and real loopback sockets using existing
   runtime/network helpers. Keep a peer paused and lower the existing memory
   threshold so an observed queued payload spills to an actual FileCache. Verify
   pending cached bytes before injecting failure; do not rely only on a sleep.
2. In separate cases, delete/invalidate that owned cache using its real API and
   truncate its real backing file. If thrown read errors need separate coverage,
   isolate an owned invalid-descriptor case in a child; never affect user files
   or unrelated descriptors. No production DI framework is proposed.
3. Resume the peer and observe the exact failed item: false/error completion once,
   handler terminal state, no substituted payload, no failed-length addition to
   sendLength, and failure completion of queued followers. Preserve the actual
   RED result before changing either send or read code.
4. Keep a second live handler with queued cache data during the failure. Assert
   the global logical cache counter still equals that survivor's owned pending
   bytes after the failed handler cleans up; then drain/dispose the survivor and
   require the counters to return to baseline. This catches double decrement.
5. Retain a successful spill/roundtrip case with exact byte comparison and ordinary
   write callbacks. Run existing SocketHandler resource/owner-terminal and tunnel
   regressions, then forced build and independent review.

The existing `SocketHandler.resource.test.ts:8` SlowWritableSocket is a deliberately
non-draining socket fixture; it only tests quota containment. Its presence is a
reuse reference, not proof of real cache read-failure behavior or a mock-free
claim. Prefer real queued I/O for the new reproductions; if deterministic socket
boundary control proves necessary, document that fixture explicitly and obtain
scope agreement rather than disguising it as real end-to-end I/O.

## Proposed strict TDD for #20

Use actual temporary files and FileCache directly. Write records A and B, retain
B as an anchor, remove A, then write C small enough to reuse A's capacity. The
anchor is essential: removing the only live record resets the free-block list
and would miss the buggy reuse branch. Capture A's primitive ID before reuse.

Require C's physical position to reuse A's block while its ID is fresh. Reads and
removal using A's stale ID must not read or remove C; B and C must retain their
exact bytes. This establishes the specific RED before changing identifier
allocation. Inspect the returned CacheRecord object semantics during the test;
do not infer stable old-record identity merely from a reused mutable object.
Keep #19 failure/accounting regression green after this serial repair.

## Dependencies and decisions

- ADR-002 requires the failure tests first; ADR-003 permits a small justified
  seam but does not justify adding a general injection framework.
- ADR-006 requires local failure containment; completed #26/#27 owner cleanup
  should be included in the lane baseline so a failed handler is unregistered.
- ADR-004/004-1 protocol negotiation and no silent downgrade stay untouched.
  #28's pending compatibility decision concerns wire/counter width, not whether
  a cache read succeeded. #19/#20 must not choose that policy or change encoding.
- UI #8/#51 owns administrator/session/browser code and can proceed in parallel.
  No shared writer is necessary for this bounded cache repair.
- Later HTTP forwarding and large-transfer gates consume SocketHandler behavior;
  they should validate the integrated fix, but their implementation is not a
  prerequisite to demonstrating local cache failure or stale-ID invalidation.

## Original proposed exception — adopted with review requirements in the execution plan

> Proposed bounded early cache lane: after completed runtime and owner-terminal
> cleanup, #19 may run alongside administrator #8/#51 with exclusive ownership
> of cached-read/send/accounting paths in SocketHandler, narrowly required
> FileCache.readSync validation, dedicated tests and its ledger. #20 follows
> serially under the same owner after #19 reviewed integration, owning cache block
> ID allocation and direct real-file regression. Preserve successful release
> timing; do not move cache release to write completion. No control-packet width,
> HTTP parser, administrator, manifest or workflow changes are authorized. #28
> remains blocked on its explicit compatibility decision. Any additional caller
> edit requires a scope/ownership amendment. Record a fresh worktree/branch and
> both issue gates before implementation; retain separate RED/GREEN/review/remote
> closure evidence for each issue.

The researcher initially added only this document. After independent review,
root amended the execution plan and created the assigned branch. The execution
plan includes the additional last-item drain-failure RED requirement and is the
current authorization source; the quotation above preserves the original proposal.
