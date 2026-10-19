# Issue73: preserve queued responses on normal endpoint EOF

Current operations: #49, #53 and #73 are complete; their exact receipts are in their issue ledgers and ../epic-61-execution.md. This document preserves the earlier research/design checkpoint. Pending actions and no-execution statements below refer to that checkpoint, not current assignment or completion status. No original failure or approval is rewritten.

Status: exact design proposal after independently confirmed real data loss. Read-only
source inspection; no tests/implementation while49 ordinary is running. Root owns
bounded writer assignment and independent design review; no new user approval gate.

- [x] Read73 acceptance and observed53 timeline. Status: normal endpoint EOF destroys2,359,296pending bytes, matching missing external response;32unread file records total2,097,152. Original53 remains FAIL.
- [x] Identify existing graceful output APIs and abort boundaries. Status: below; reuse native output queue/cache and ownership machinery.
- [ ] Independently freeze exact local callback contract and writer scope. Status: root will assign after design review.
- [ ] Observe focused real-cache/backpressure RED, implement minimum, then original53 regression. Status: not executed; heavy49 run remains exclusive.

## Current causal path and reusable APIs

EndPointClientPool.onEndPointHandlerEvent forwards End/Closed once in its general
state dispatch and again in its terminal block, removes endpoint maps, then posts
onEndPointTerminateCallback through setImmediate. TTTClient forwards it to
TunnelClient.terminateEndPointSession, which removes active/pending ownership and
calls dataHandler.destroy immediately. SocketHandler.destroy clears queued memory
and unread file records. ServerExternal waits its declared CloseSession endLength,
so dropped bytes make normal external FIN impossible. The observed failure is raw
TCP, not HTTP unknown-length response handling or a wire-count overflow.

Existing SocketHandler.end_ is the correct output request: if output is pending it
sets _endWaitingState, rejects further sends and later calls native socket.end when
its existing queue/cache/in-flight accounting drains. It does not clear queued bytes.
addOnceDrainListener provides a once-only observation, but invokes synchronously if
already drained OR isEnd, and destroy/close can call listeners with unsuccessful
state. Therefore its boolean alone is not proof of a successful flush: recheck
identity, !isEnd and isOutputDrained. Never call destroy merely because an output
write was enqueued or native writableLength happens to be0; the observed loss had
nativeWritable0 while2.25MiB remained in application queues.

## Minimum local contracts and scope

Initial production scope is only src/client/EndPointClientPool.ts terminal dispatch,
src/client/TTTClient.ts captured-owner callback forwarding and
src/client/TunnelClient.ts endpoint-originated termination/drain/identity hunks.
Use only needed hunks; no SocketHandler/FileCache/queue rewrite, shared protocol
field/type, serverExternal close condition or29HTTP EOF changes. Dedicated tests/
fixture/ledger73 plus unchanged53 repro as later regression are root-owned scope.

Proposed additive local API:

```ts
// Existing endpoint callback interface, confined to its client source file.
OnEndPointTerminateCallback(id: number, mode?: 'graceful' | 'abort'): void;
// Existing TunnelClient API; omission preserves current immediate-abort callers.
terminateEndPointSession(sessionID: number, mode: 'graceful' | 'abort' = 'abort'): void;
```

TTTClient forwards mode through its existing captured ClientOwner guard; old endpoint
pool callbacks cannot target a newer client generation. No wire command/field or
public listener interface changes. Receive-length notification still uses existing
closeEndPointSession/CloseSession framing; fix the duplicate terminal-state dispatch
so one native terminal sequence yields one logical peer-close notification.

### Terminal classification at the endpoint owner

Capture actual endpoint handler identity, state and receiveLength before removing
maps or invoking callbacks. Graceful is allowed only for the current registered
endpoint's normal native End: socket.readableEnded, no socket.errored, no breakBufferFlush,
and no locally initiated force/remote-close/disposal state. Use existing closeInitiated
and explicitly scoped retirement state to distinguish local abort paths; do not
classify every Closed as EOF. A later Closed after a handled End must not issue a
second termination or overwrite its selected mode.

Error, Closed without prior normal EOF, connection failure before endpoint setup,
forced timeout/global disposal and explicit remote/session close retain abort
semantics. Preserve operator-visible errors. Classify before calling methods that
mutate native state; do not infer normal EOF from the fact destroy completed.

Dispatch each current terminal once, remove its own endpoint mapping once, and post
one captured termination mode. A stale terminal from a superseded same-SID endpoint
must not reinsert or delete the replacement entry. A posted callback must recheck
its captured endpoint/retirement token and pool-generation authority; if a new
endpoint for that SID has appeared, it is no longer authorized to terminate it.
Use a small per-open/terminal ownership token or the actual handler reference,
not SID alone. Retain native pre-Connected failure cleanup without fabricating an
active registration; if pending endpoint ownership needs a token, keep it local to
EndPointClientPool.open and its callback rather than adding a transport framework.

### Graceful client-data output retirement

At terminateEndPointSession capture the current active data handler (and its SID,
handlerID/control owner) before touching maps. Only graceful mode with a live
OnlineSession and no pending initialization enters the new drain path. Pending
attempts/None/Initializing/ConnectingEndPoint and abort mode use existing immediate
cleanup/FailOfOpenSession safety; do not turn an unestablished session into a flush.

For graceful mode, mark this exact data handler as graceful-retiring once and keep
its active mapping until native terminal completion so errors/global shutdown still
own it. This is a lifecycle marker, not a new data queue. Call existing end_ to stop
accepting new output and flush its actual memory/cache/in-flight writes. If a drain
listener is needed for coordination, register it once with captured handler+SID;
its callback rechecks current map identity, graceful marker, live state and actual
isOutputDrained. A stale/repeated callback does nothing to replacement ownership.

On successful drain, allow native end/FIN lifecycle to complete; do not immediately
destroy after addOnceDrainListener success, since native FIN is still meaningful.
On the data handler's actual End/Closed, clear this handler's graceful marker and
reuse existing deleteDataHandler accounting/map cleanup, suppressing duplicate
peer/local endpoint-close notification already issued for the normal endpoint EOF.
This requires a narrow known-retirement branch in onDataHandlerTerminated, not a
blanket change to its #24 native-fault behavior. No terminated session is revived.

Any actual data error, abrupt remote close or global client destruction during
retirement may abort immediately and release queues via existing safety paths;
invalidate the marker before destroy because destroy can synchronously invoke drain
and terminal callbacks. Report unsuccessful delivery and never call it graceful
success. A replacement data handler for the same SID invalidates the old marker;
late callbacks may retire the old socket only and cannot clear/send/notify by SID
against the new handler. Existing remote CloseSession drain callback must likewise
check captured active identity and real drain/live status before endpoint mutation.
Preserve its length-based close semantics; do not waive endLength on the server.

## Focused strict TDD and full regression

- [ ] Small real queued-tail RED. Status: owned client/server/endpoint and actual FileCache-backed response, positive existing local/global limit configuration, capture actual target cache identity and successful write/read. Pause an owned receiver to create native/backlog pressure; resume it before normal endpointFIN. Assert nonzero queued bytes at endpointEnd, no premature queue/cache removal, exact response length/hash and native FIN on one attempt, then pre-dispose logical baseline. Do not assign counters or substitute a success socket.
- [ ] State/identity RED. Status: real endpoint End followed by Closed must notify once; queued normal drain must coexist with healthy same-owner/other-owner sessions. Replace same-SID data/endpoint while an actual drain callback is pending, release saved old callbacks and confirm new handler/queue untouched. Callback replay is disclosed supplemental identity evidence after real socket state, not another native event.
- [ ] Abort/pending controls. Status: actual RST/error/Closed-before-End, pre-Connected failure and global stop while graceful output is pending must terminate promptly through owned cleanup, not hang waiting for impossible drain. Existing #24/#25 pending-attempt/upper-owner and explicit remote close behavior remain. Check unsuccessful drain callback and synchronously already-ended addOnceDrainListener cannot report success or affect replacements.
- [ ] Terminal ordering/cleanup controls. Status: already-drained normal EOF takes the fast native-end path; queued case flushes, then native terminal releases once. No extra application send is accepted after retirement. Cache records are read before graceful release, with physical file cleanup only at its existing lifecycle; repeated dispose/old timers cause no new notifications.
- [ ] Original53 unchanged full acceptance. Status: after reviewed focused implementation, rerun original fixed32MiB/64KiB/local16MiB/global1MiB case once with exact full response hash/FIN and pre-teardown accounting. Preserve both prior failures and role traces; no deadline/payload/expected-byte relaxation. Also retain #47 finite HTTP/TLS/mixed-owner and existing small-byte/drain controls as appropriate regressions.

Do not change production based on source speculation alone: each new terminal/guard
behavior gets observed focused RED before implementation. Existing SocketHandler
end/drain is sufficient in the proposed path; if actual RED proves otherwise, report
the exact missing boundary before any additional write scope. No user process kill,
benchmark, denied artifact operation, protocolcount or29held operation is involved.

## Reviewed notification compatibility clarification

Omitted mode and explicit abort retain the current terminateEndPointSession cleanup-only behavior; they do not introduce a FailOfOpenSession or new peer notification. Existing closeEndPointSession/native-fault paths continue to own their existing failure notifications. Graceful completion must not resend the CloseSession already emitted by the endpoint-state path, and the later terminal callback adds no duplicate packet. This clarifies the existing contract without changing protocol or queue policy.
