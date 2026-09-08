# Client control framing and metadata failure research (#45 -> #46)

Status: joint #45/#46 milestone complete through final verification/integration/push and individual closure/notification3975/3976. Historical design and stage approvals below are execution history; current counts and active work are maintained in the main execution plan.
The JSON SyntaxError adapter and joint #45 -> #46 milestone passed independent
design review before root assigned their execution. The initial research itself
performed no source edits or test/server execution.
Researcher: review_cert_conflict. At the research checkpoint, read main `f3c2a10`, including completed
#42 integration `43221c0` (41/66 per root). Original issues #45 and #46 were read.

- [x] Inspect original issues and current frame/metadata consumers. Status: findings below distinguish still-open defects from #9's existing structural guards.
- [x] Identify result-based reuse and cleanup/reconnect ownership. Status: bounded proposal below.
- [x] Independently rereview exact result API/adapter/milestone. Status: final design/API review PASS and root approved both sequential stages.
- [x] Assign joint milestone and execute #45 framing RED. Status: completed; stage reviewed/integrated07c083d, detailed receipts in ledger45.
- [x] Finish #46 correction/reviews and joint milestone verification. Status: complete; Joint final integration35a5d5f30c4b2e894ca9daf266c864bbc7871afa pushed/remote verified, sourcefdc4ad6;12suites/85tests PASS164.236seconds, natural exit0; forced build PASS. Both issues closed/notified.

## Historical source findings and corrected interpretation

`TunnelClient.ts:292` calls readCtrlPacketList without a protocol-error boundary.
SocketHandler's receive callback catches escaped exceptions and calls procError,
which destroys that socket and reports generic Closed. The process does not crash.
`TunnelServer.ts:604-618` instead catches framing failure at its control boundary
and removes only the affected control pool. #45 must not claim that an unknown
frame boundary can safely keep the corrupted control stream or all of its sessions.
The goal is classified, owned, once-only teardown and existing reconnect behavior.

`CtrlPacket.fromBuffer` already returns ParsedState.Incomplete/Error/Discarded/
Complete and validates prefix, command, 64000-byte payload bound and command body
structure. The integrated #9 hasRequiredPayload path discards complete-but-short
OpenSession/Ack/Close command payloads. Those are regression controls, not newly
unhandled throws as the original #45 issue's older anchors suggest.
`CtrlPacketStreamer.readPacket` currently converts Error to throw; feed/concatenation
overflow also throws unless its existing callback handles it. Reuse this parser,
queue and accounting rather than adding a second byte scanner/resynchronizer.

Client metadata sites are syncCtrlAckMeta, newDataHandlerMeta (currently decoded
twice in one branch), and getMessageFromPacket. Server ClientHandlerPool uses
getMessageFromPacket and handlerWideIdMeta. These five live consumer locations
invoke throwing JSON/schema helpers without a packet-local invalid-result branch.
`CtrlMetaGuards` already centralizes type/capability/integer/string limits and the
SAFE_REVIVER that drops __proto__/constructor/prototype. Reuse those rules exactly.
Existing r2-req-04-meta-schema tests explicitly expect the legacy getters to throw.

There is a sixth, distinct compatibility behavior: parseAckCtrlData catches invalid
optional v2 metadata and falls back to the legacy name/key object. #46's five-site
repair must not silently modify this authentication/fallback policy. If tightening
it is required, present that exact behavior for separate root approval first.

## #45 minimum framing boundary

Proposed initial production writes: TunnelClient.ts and only the streamer/result
portion of CtrlPacket.ts, plus dedicated tests/fixtures/ledger45. Keep TTTClient,
EndPointClientPool, SocketHandler, server framing consumers and wire producers
read-only unless an actual failing ownership test requires a reviewed amendment.

Freeze this additive streamer result API for implementation review:

```ts
type CtrlReadResult = {
    packets: CtrlPacket[];
    error?: {kind: "framing" | "overflow"; cause: Error};
};
public readCtrlPacketResult(buffer: Buffer): CtrlReadResult;
```

Success/incomplete uses error:undefined and returns any complete packets while
retaining incomplete bytes within the existing bound. Existing Discarded command
frames remain discard-and-continue. Fatal framing/overflow returns packets:[] and
the tagged existing diagnostic, resets this result-reader's pending bytes/queue,
and never throws for these predictable input conditions. Unexpected exceptions
are not disguised as malformed input.

Share the existing field validation and packet/queue operations through nonthrowing
internal primitives; do not add another parser. The new result API reports errors
only through its result and does not invoke the optional onOverflow callback.
This prevents callback-plus-result double handling by its consumer. Legacy feed,
readPacket and readCtrlPacketList retain their current policies: default overflow
throws the existing RangeError; configured onOverflow is called exactly once after
queue reset without that default throw; framing errors retain their existing throw
contract. Compatibility wrappers must not accidentally invoke callbacks twice or
adopt the new result API's batch-reset behavior where the old API differs. Keep
legacy parse/drain state semantics and existing tests, reusing the same internal
primitives rather than duplicating validation. Add direct RED/contracts for result
overflow, default legacy throw and configured legacy callback behavior before edits.

For a fatal frame batch, recommend dropping that batch's collected packets and
remaining bytes, then terminating the affected control connection. This preserves
the old throw path's lack of partial batch delivery and avoids opening an endpoint
immediately before teardown. Do not invent byte resynchronization or process a
suffix after a fatal boundary error. Valid frames processed in earlier receives
are not retroactively rolled back.

TunnelClient consumes the result, logs a bounded protocol-specific diagnostic and
closes only its currently owned control handler. Use existing destroyAllDataHandler,
queue-accounting cleanup and onCtrlStateCallback so TTTClient closes its endpoint
pool and uses its existing scheduler/reconnect delay. Do not call failHandshake
blindly: it reports closed before the native terminal event and does not itself
clear all data/queue ownership. Reuse or extract one terminal transition, with
current-handler identity checked before clearing fields/notifying; delayed terminal
events from the old handler must not clear a replacement handler or notify twice.
This narrow control-owner guard, if needed, requires RED and explicit scope approval;
it is not completion of broader #25 delayed data/endpoint callback work.

## #46 packet-local metadata results

After the verified/reviewed #45 stage in the joint milestone, proposed writes are CtrlMetaGuards.ts, metadata decoding in
CtrlPacket.ts, the three client consumer sites in TunnelClient.ts, the two server
sites in ClientHandlerPool.ts, and dedicated tests/ledger46. One serial owner
avoids overlapping edits to CtrlPacket/TunnelClient. Preserve #41 allocation and
dual-identity admission and #43/#42 data-channel framing/delivery.

Use a small discriminated result: absent, invalid(reason), or valid(value).
Absent is only genuinely optional empty metadata allowed by the existing command;
malformed nonempty JSON/schema is never converted to absent. A mandatory Message
with empty data is invalid. This distinction prevents invalid SyncCtrlAck metadata
from selecting legacy fallback and invalid NewDataHandler metadata from falling
back to the short ID or opening a channel without the intended binding token.
Do not require new metadata on legitimately compatible legacy packets.

Extract nonthrowing schema validation from the existing predicates/string caps;
have legacy assert/getter APIs reuse it so their explicit throw contracts remain
intact. Add result-returning metadata readers for the live consumers, decode once
per packet, and branch on invalid before state/identity/pool mutation. Invalid
metadata discards only that complete framed packet; continue with later packets
in the same batch. During Syncing, retain state and existing deadline/handshake
behavior until a valid packet arrives; no forged legacy fallback, implicit retry,
new timeout or blanket connection teardown for a known-boundary metadata error.

Root-approved native JSON boundary: invoke JSON.parse only after the command and
payload region are explicitly identified as JSON metadata. Preserve SAFE_REVIVER.
The adapter converts only a native JSON.parse SyntaxError to invalid metadata;
other exceptions are rethrown and never treated as a harmless packet discard.
The catch encloses native parsing only, not schema validation or consumer actions.
Absence handling, format selection, all schema checks and consumer dispatch remain
explicit conditional/result branches. This narrow native-parser compatibility
adapter is the sole approved exception boundary; do not add new guard throws,
regex JSON validation, a second parser/dependency, YAML permissiveness or broad
consumer try/catch loops. Add malformed-JSON and non-SyntaxError propagation
controls, disclosing any test-only native-boundary injection.

Invalid-result diagnostics identify command/session and a fixed validation reason.
Never print raw credential/proof/token JSON or native parser snippets containing
it. Legacy throwing getters/assert APIs and the sixth parseAckCtrlData fallback
policy remain unchanged; no invalid-as-absent downgrade is introduced at the five
new live result consumers.

## Actual RED and regression gates

- [x] #45 malformed-frame RED. Status: executed during implementation; original planned contract follows, receipts in issue ledgers. Use actual TunnelClient/TTTClient with an owned local control peer or reviewed tunnel harness. Inject wrong prefix, unknown command, declared payload > existing limit and bounded accumulator overflow. Observe a protocol error result/diagnostic, zero escape into the generic SocketHandler procError path, one terminal notification and cleared owned data/wait queues. A receiving-side observer may delegate the actual callback to distinguish the error boundary; disclose it.
- [x] #45 valid framing controls. Status: executed during implementation; original planned contract follows, receipts in issue ledgers. Fragment valid headers/bodies, coalesce valid packets, and include #9 complete-but-invalid command bodies that are already discarded. Ensure valid suffix frames after a Discarded frame still work, whereas a fatal frame batch is not dispatched. Keep producer bytes/max limits unchanged.
- [x] #45 real reconnect/ownership. Status: executed during implementation; original planned contract follows, receipts in issue ledgers. Establish actual authenticated control/data/owned endpoint echo, deliver malformed framing, then let the real TTTClient scheduler reconnect once and prove fresh echo. An unaffected second client/tunnel continues to echo. Verify old handler's late terminal event cannot tear down the replacement; if a broader #25 defect prevents this, report it before expanding scope. No manual reconnect masking, generic process kill or retry-until-green.
- [x] #46 client metadata RED at all three sites. Status: executed during implementation; original planned contract follows, receipts in issue ledgers. Fully framed non-JSON and valid-JSON/wrong-schema SyncCtrlAck, NewDataHandler and Message inputs must not reach generic socket error or mutate client IDs/mode/create endpoint sockets. Follow each malformed frame with a valid frame on the same actual connection, including coalesced batches; real endpoint echo and existing legacy/v2 negotiation remain usable.
- [x] #46 server metadata RED at both sites. Status: executed during implementation; original planned contract follows, receipts in issue ledgers. Inject invalid Message and Success/FailOfOpenSession wide metadata through an owned authenticated client's actual control socket. Preserve existing active sibling echo and pending session/queue identity; a later valid result completes the normal OpenSession/ACK/echo. Use a disclosed delegating endpoint-open scheduling barrier if necessary to keep the pending phase observable, not a fake successful endpoint result.
- [x] Absent/invalid and guard compatibility. Status: executed during implementation; original planned contract follows, receipts in issue ledgers. Keep optional legacy absence, valid v2 wide/token metadata, schema numeric/string/array bounds and prototype-key stripping. Retain legacy throwing-getter tests alongside the new explicit-result tests. Do not reinterpret invalid metadata as absent or relax integer/body limits.
- [ ] Cleanup and diagnostics. Status: planned. Own all sockets, endpoints, roots and child processes; wait for natural test exit. Inspect once-only callbacks, queue byte counts and affected-instance isolation. Preserve real abnormal results and selected-case counts; no load/timing cause or whole-suite success is inferred from a focused run.

## Separation and approval gates

Root approved one serial milestone satisfying the original related-issue request:
implement/verify/review #45 frame boundary and owned reconnect first, then perform
separate #46 metadata RED/implementation/verification with the same owner. Preserve
separate per-issue evidence and reviewable changes, but close neither issue or send
its completion notification until both client/server stages are verified. Root
then integrates the reviewed changes and closes/notifies #45 and #46 individually.
The first stage alone does not claim its still-throwing metadata consumers are fixed.
The native JSON/API review and both stage assignments were approved before execution; final implementation review is tracked in ledger46.

No new fields, version negotiation, ID width or producer wire layout are proposed.
#28 CloseSession count/4 GiB policy, platform-held #29 HTTP EOF work and #40 buffer
minimum/unlimited policy remain untouched. Existing signed buffer fields/defaults
are not redefined by a structural-frame check. No timing experiment or benchmark
policy change is part of this research. This historical research paragraph did not itself authorize execution; root subsequently assigned the stages as recorded above.

## Historical first-stage assignment checkpoint

Root approved the first #45 stage only for execution under the exact API and mandatory RED above. #46 follows reviewed #45 verification/integration with separate stage approval under the same owner. The approved gate required both stages verified before closure; that gate is now complete. Earlier unassigned prose describes pre-approval research; counts attached to earlier integration receipts remain historical. #60 alias-root test repair is separate; #28/#40/#29 boundaries remain unchanged.

## Historical approved #46 stage

Root approved the next stage after reviewed #45 integration. Exact write set and native JSON/schema/absence/security boundaries above remain binding; no sixth Ack fallback or producer change. At that stage checkpoint #45 remained OPEN without a completion Telegram. #46 requires actual client/server RED before production edits, independent reviews and joint milestone verification before individual closure/notification. Earlier first-stage-only assignment statements are historical.
