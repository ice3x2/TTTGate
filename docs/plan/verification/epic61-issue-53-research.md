# Issue #53 — Actual large tunnel transfer and cache lifecycle

Current operations: #49, #53 and #73 are complete; their exact receipts are in their issue ledgers and ../epic-61-execution.md. This document preserves the earlier research/design checkpoint. Pending actions and no-execution statements below refer to that checkpoint, not current assignment or completion status. No original failure or approval is rewritten.

Historical research checkpoint (current execution state: ../epic-61-execution.md). Status at initial research: read-only exact proposal; independent review and root assignment pending. Current #47 integration regression is separate and must finish first. No tests, benchmark, cache operation or production change executed.
Original issue: https://github.com/ice3x2/TTTGate/issues/53.

- [x] Read original53, E2E research and existing cache/queue/resource APIs. Status: findings below.
- [x] Address independent M1 pressure/sender ordering. Status: separate document fixer fix_lint_diagnostics clarified concurrent sender/barrier order, paused socket identity and logical cache evidence below; no execution or budget change. Independent re-review pending.
- [ ] Approve fixed payload/budgets and exact owned fixture scope. Status: proposal only.
- [ ] Execute actual spill/fidelity/cleanup evidence after #47 integration. Status: unassigned; no production writes authorized.
- [ ] Independently review observed effects and integrate scoped tests. Status: pending; size alone is not spill evidence.

## Reuse and meaningful observations

Use the reviewed multi-client tunnelHarness clients/endpointFactory/stop/readiness
API after #47 integration. Custom endpoint traffic needs its dedicated external
TCP consumer, not sendAndReceive's echo-only API. Reuse owned network/root helpers
and resourceStats; do not add another tunnel implementation or fake native sockets.
SocketHandler exposes pendingWriteBytes, pendingFileCacheBytes and global buffered/
cached getters. FileCache.writeSync/readSync/remove supply actual storage boundaries;
delegating observers can record successful lengths, record IDs and cache lifecycle
without replacing data or return values. Never instrument by assigning counters.

QueueLimiter spills on actual local OR global budget overflow. Existing defaults
include pool queue64MiB, per-handler file cache32MiB, global file cache256MiB and
high/low ratios0.75/0.5. Read pressure can start before spill; a paused peer and
large payload do not guarantee a cache write. A no-spill result is insufficient
coverage and must be reported, not turned into success or 'fixed' by forcing the
limiter. Existing FileCache blocks can remain physically allocated after logical
records are released; do not demand disk length zero before their disposal point.

## Proposed numeric contract

One deterministic32MiB request and equal-size response, each streamed in64KiB
application writes with distinct first/tail markers and incremental SHA256. Total
each direction stays far below4GiB. This is functional correctness, not a throughput
benchmark. Use positive per-session server/client buffers1MiB and positive global
memory16MiB through existing supported options. Keep existing file/pool quotas and
watermark ratios unchanged. Set explicit positive sessionTtlMs=3600000 so a short
diagnostic cannot be mistaken for the disabled-policy behavior. No #40 policy or
#28 field-width decision is made.

Exact large-owner options are `tunnelingOptionOverride: {bufferLimitOnServer: 1,
bufferLimitOnClient: 1}` and common `serverOptionOverride: {globalMemCacheLimit: 16,
sessionTtlMs: 3600000}`. Those configuration buffer/memory numbers are MiB, while
sessionTtlMs is milliseconds. Before payload transmission, assert the actual target
SocketHandler.bufferSizeLimit is1048576 on the exercised server/client paths and
SocketHandler.maxGlobalMemoryBufferSize is16777216; serialized option values alone
do not prove application. ExternalPortServerPool and TTTServer multiply per-session
values by1024*1024. Global memory is applied by the existing composition path;
the harness's direct construction is not itself proof it applied16MiB. If runtime
getters do not match, stop at that setup precondition and request the exact existing
API/helper setup amendment; do not assign counters or silently change production.

Freeze one180-second work budget plus15-second natural-exit grace before execution.
Within it, pressure-observation deadline30s and recovery60s are failure limits, not
expected timings. Do not increase sizes/deadlines or retry after failure merely
to obtain green. Execute serially without another heavy test/build/benchmark from
this task; record actual host conditions without claiming an exclusive machine.

## Actual owned fixture stages

Use two authenticated client identities and distinct ACL-routed owned endpoints.
A dedicated large endpoint captures full request length/hash, then produces its
response; the healthy sibling serves small finite binary echoes. First verify
identity readiness and a sibling baseline. Record global/local cache and buffer
baselines after stable readiness and before starting the large session.

Observe both directions in separate cases for clear ownership. Request-pressure:
capture the exact net.Socket accepted by the owned large endpoint for this session,
with its local/remote address/port and reference; pause that receiving socket before
the large external sender starts. Response-pressure: finish receiving the request
normally, capture the exact external client's response-reading socket for this
session, and pause it before releasing the endpoint's response producer. Do not
pause a listener, an unrelated sibling or an inferred socket selected only by name.
Record the same socket reference at pause/resume and actual read progress before
and after release. Preserve the peerFIN/full-byte completion contract.

For either direction start the sender Promise immediately, register its rejection
handler immediately, and retain that one Promise without awaiting its completion.
The sender writes64KiB application chunks with ordinary write(false)/drain handling;
it can legitimately remain suspended while the peer is paused. Concurrently poll
the bounded pressure barrier, checking the captured sender error at every step.
Awaiting the complete sender before observing spill/resuming the reader deadlocks
the very backpressure condition being tested and is forbidden. No resend, synthetic
drain, manual cache insertion or limiter override. Both sender and receive-completion
Promises need rejection handlers immediately so an early failure cannot become an
unhandled rejection or be hidden until teardown.

Release the paused reader only when actual pendingFileCacheBytes>0, successful
delegated FileCache write bytes>0 and an owned cache file are observed. A bounded
small sibling exchange must complete during that pressure interval. Also capture
real pause/resume or writable-drain observations/high-water counters, without
equating application chunks with TCP segmentation. If those natural conditions
cannot occur under the frozen budgets, retain the failed coverage precondition
and request independent fixture/design review; no production 'spill forcing'.

Freeze ordering as: exact reader pause -> start sender/error capture -> concurrently
observe actual target-session spill -> complete bounded live sibling -> resume that
same reader -> await the retained sender and full finite response/FIN -> compare
hashes/lengths -> observe logical recovery. Starting the sibling or pressure barrier
must not first await the large sender. Failure or deadline at any stage preserves
the original failure; finally resumes/destroys only the owned sockets and settles
the already-started work without another transmission. Existing180s+15s total,
30s pressure and60s recovery limits remain unchanged. If32MiB and the existing
0.75 high-water pause prevent any spill, report that coverage precondition failure
and seek design review, not a larger payload, longer budget or forced spill.

Associate storage evidence with the actual congested SocketHandler for the selected
large session/direction and its exact `_fileCache` object reference. Delegating
FileCache.writeSync observes the real return after success, snapshots record.id,
record.length, record.capacity and input logical length, and credits bytes only
when that cache instance matches the selected handler. Delegating readSync(id)
matches the same instance/id and actual returned Buffer length to the recorded
logical length; undefined/error is a failure, not a successful read. Snapshot numeric
fields immediately because reusable cache blocks are mutable. Other clients' cache
I/O cannot satisfy the large-session barrier. CacheRecord.length is payload bytes;
capacity may include minimum-block padding/reused capacity and file length includes
allocated space. Neither capacity, low-level padded fs.write length nor file existence
alone counts as logical spilled/read payload. Keep per-record observations plus
target-handler pendingFileCacheBytes and global high-water accounting; never invent
counter values or substitute storage results.

After release, require exact full length and SHA256 at endpoint and external client,
correct markers, actual FileCache read bytes>0 and no duplicate request/response.
Then wait for the large session's natural terminal cleanup, before harness dispose:
its queue/cache logical counters and global totals must return to recorded baseline,
and healthy sibling must still complete another exact exchange. No cache bytes or
handler ownership may be hidden by global teardown. After actual normal disposal,
verify the task's cache files/directories follow their existing deletion lifecycle.
RSS/process handle counts are diagnostics only, not exact leak acceptance metrics.

## Minimum scope and honest RED

Proposed writes: test/e2e/tunnel/large-transfer-cache.test.ts, one dedicated large
endpoint/consumer fixture if necessary and ledger53. Existing harness/network/
FileCache/SocketHandler/QueueLimiter remain read-only initially. If an additive
fixture hook is truly required, approve exact helper hunk after actual RED; no
runtime source modification before a separate root-approved issue/scope.

This is primarily missing-coverage work: a new actual32MiB test passing integrated
production is valid evidence without inventing a production RED. To validate test
sensitivity, use a disclosed owned endpoint that changes one response byte or
appends one extra byte and require exact-length/hash failure on one attempt; this
is fixture/mutation evidence only. Any helper behavior change needs its own valid
preimplementation RED. Real cache failure found during the functional test remains
a production finding and cannot be repaired silently in this test-only assignment.

Own every accepted socket, paused reader and timer immediately; finally resumes/
destroys only those sockets, restores observers and awaits listeners/harness cleanup.
Preserve failure receipts even if cleanup also fails. Do not run a process-name kill;
only verified task PID/current commandline/ownership can be terminated under the
existing rules. No benchmark, denied artifact cleanup or held UI/#29 operation.

#53 completion requires observed real writes AND reads, high-water/pressure evidence,
one-shot hashes and pre-teardown logical recovery;32MiB echoed alone is not enough.
#49 full natural shutdown, #52 whole-source thresholds and #58 traceability remain
separate gates. No tests or cache files were created by this research.
