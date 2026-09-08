# Data-channel handshake framing and retained payload research (#43 -> #42)

Status: technical research and final API-record review PASS by review_wave0; root approved only bounded #43 implementation. Assigned owner review_cert_conflict, control worktree branch fix/epic61-data-handshake-framing, base 0ca1399. #42 requires its own later gate.
Researcher: review_cert_conflict. Original GitHub #43 and #42 and current main
sources were read; no source edit, server or test execution occurred during this research. At the original research checkpoint, #41 was frozen for review. It is now complete and integrated as `b6dbf014745a97b6a85805d1691abab5e9de4e50`, CLOSED 2026-09-08T03:34:05Z, Telegram receipt 3966 (66/38). Its identity-admission behavior must be preserved.

- [x] Read original issues and actual producer/parser/consumer. Status: source findings below.
- [x] Examine existing format, negotiation and buffer reuse. Status: format-preserving proposal below.
- [x] Independent review and explicit scope/sequence approval. Status: review_wave0 technical/API-record PASS; root approved the exact #43 scope and created the assigned branch. #42 stays separately gated.
- [ ] #43 dedicated branch/ledger, actual parser/consumer RED, fix and independent integration. Status: assigned to review_cert_conflict in C:/Work/git/_Snoworca/TTTGate-epic61-control on fix/epic61-data-handshake-framing at 0ca1399. Ledger/API freeze and actual RED precede implementation; production is limited to DataStatePacket and TunnelServer handshake, plus the two named unit migrations and dedicated tests/fixture/ledger. ClientHandlerPool writes and #42 delivery are not authorized.
- [ ] #42 separate RED, minimum tail delivery fix, independent review and integration. Status: pending #43.

## Actual format and source evidence

`src/commons/DataStatePacket.ts:29-47` emits its fixed prefix and three uint32
identities for all peers. When a nonempty binding token exists, the producer adds
a uint16 token-byte length and token bytes; a tokenless legacy packet omits that
extension completely. `TunnelClient.ts:408-410` uses this producer and the token
already supplied by the server's NewDataHandler control request.

`DataStatePacket.fromBuffer:61-76` infers token presence from current buffer size.
At exactly LENGTH it completes a tokenless packet. At more than LENGTH it treats
the following two bytes as token length. Consequently a v2 token split at LENGTH
is prematurely accepted as absent, while coalesced legacy payload can be mistaken
for an extension. No parser can reliably disambiguate these two formats from those
unversioned bytes and arbitrary payload alone. TCP segmentation is not a format flag.

The actual server has information that the parser currently ignores:
`TunnelServer.ts:450-457` records the authenticated ClientHandlerPool identity;
the pool exposes `legacyMode` and nonlegacy pending handlers receive binding
tokens. The fixed data header carries ctrlID, allowing lookup of that already
negotiated pool once the fixed header is complete. Unknown control identities
must not select a fallback format. This lookup is not a substitute for #41's
session/handler admission or the existing constant-time binding-token check.

`TunnelServer.ts:499-524` accumulates incomplete input in `leftOverBuffer` only
while DataHandlerState.None. On successful parse it changes state and stores
remainBuffer in the same field. Later receives skip that field, causing #42.
`ClientHandlerPool.pushReceiveBuffer:212-227` already queues bytes while an endpoint
is opening, applies session/pool limits, and dispatches directly once OnlineSession.
`flushWaitBuffer` drains that queue after the open-result/ACK path. Reuse this
behavior instead of inventing another pending payload buffer or bypassing limits.

Existing reusable pieces: DataStatePacket's fixed-header field parsing,
TunnelServer's per-handler accumulator and pool lookup, CtrlPacketStreamer/raw-peer
fixtures from ProtocolV2 and reviewed #41, and the existing bounded waiting queue.
BufferReader is a generic consuming reader, not a negotiated handshake framer;
its underflow exceptions do not justify replacing explicit incomplete checks.

## #43: preserve emitted bytes, make decoding context explicit

### Root-approved exact parser API

Root approved the following small result contracts, with no default format and
no exceptions for predictable malformed input or incomplete input:

```ts
type FixedHeaderResult =
    | {kind: "incomplete"}
    | {kind: "invalid"; reason: string}
    | {kind: "complete"; ctrlID: number; handlerID: number; firstSessionID: number};

static readFixedHeader(buffer: Buffer): FixedHeaderResult;

static fromBuffer(buffer: Buffer, format: "legacy" | "token"): {
    packet: DataStatePacket | undefined;
    remainBuffer: Buffer | undefined;
    error?: string;
};
```

Check prefix length before comparison, return invalid for a wrong complete prefix,
and check the complete fixed-header size before reading uint32 fields. The decoder
reuses that result: incomplete input retains the received buffer without error;
invalid input returns `packet: undefined` plus `error` and no usable payload.
TunnelServer handles these results with conditions, records a diagnostic and
rejects the incoming handshake when invalid. Do not introduce a new throw/catch
branch for prefix validation. Unexpected system errors remain exceptional.

The required format is selected only from the authenticated pool reached through
the fixed ctrlID. The consumer must retain/check that pool identity across fragments
without binding unvalidated session state. Complete packet admission still uses
the reviewed session/handler pair and existing token validation. Invalid input
must not be marked authenticated or passed to a payload consumer.

Root explicitly permits migrating both existing unit call sites:
`test/unit/commons/DataStatePacket.test.ts` and
`test/util/r2-req-02-buffer-endian.test.ts`. Tokenless cases pass `"legacy"`, token
cases pass `"token"`; no auto-detect/default is retained. Existing producer byte
assertions remain unchanged. Add actual invalid-prefix result/consumer rejection
RED before implementation; root confirmed the current tests do not impose a
prefix-throw compatibility contract. No producer/wire change is approved.

Recommended initial production scope: `DataStatePacket.ts` and the data-handshake
portion of `TunnelServer.ts`, with dedicated parser/real-consumer tests and ledger43.
Client producer, protocol field widths, control negotiation and authentication
policy remain unchanged. Existing parser unit callers may be migrated to an
explicit expected format; do not retain buffer-length guessing in the live path.

1. Accumulate until the fixed header is available and validate its prefix using
   existing code. Expose/reuse that fixed-header parse rather than copying magic
   offsets into TunnelServer. Incomplete input must not allocate/admit a data session.
2. Look up the ctrlID's authenticated pool. Derive expected legacy/token form from
   its existing negotiated identity, not a request-supplied flag or current segment
   length. Keep the identity associated with this handshake while waiting for bytes;
   disappearance of its pool/pending session must fail admission, not change format.
3. Legacy: consume exactly LENGTH; all following bytes are remainBuffer, including
   `GET `, NUL, bytes resembling a token length and invalid UTF8.
4. V2: require the two length bytes and all declared token bytes before completing.
   Exact fixed-length input is incomplete, not a completed tokenless v2 packet.
   Explicit zero length/wrong token must fail the existing token admission.
   Missing extension with no further bytes remains incomplete until the existing
   unauthenticated connection deadline; do not call it a successful empty token.
5. Preserve the exact suffix independently of packet completion. #43 fixes frame
   boundaries; it must not claim #42 consumer delivery is fixed before that issue's
   separate RED and implementation. Do not silently discard suffix bytes to pass
   handshake tests.

Keep the current uint16 representable token-length bound and existing handshake
timeout/unauthenticated-connection policies. Bound accumulated handshake data using
the decoded frame requirement; do not confuse coalesced application payload with
token bytes. A new tighter token limit, optional token fallback for authenticated
v2 peers, unconditional two-byte legacy extension, new prefix or version field
would be a policy/compatibility change requiring separate explicit approval.

Original #43 suggests always emitting a token length. That would change existing
tokenless legacy bytes. The context-based approach above can preserve the current
formats and both supported peer modes, so no new wire-format decision is necessary
for this recommendation. Freeze the parser API/negotiation behavior in ledger43
before RED and obtain root approval; this research does not itself approve a patch.

## #43 RED and compatibility evidence

- [ ] Parser RED for every two-part split and byte-at-a-time input. Status: planned; cover fixed prefix/identities, exactly LENGTH, one length byte, token interior, zero length, complete token and binary suffix. Supply explicit expected peer mode in the new assertions; baseline may ignore that new test argument, but the observed failure must be behavioral, not a compile/setup error.
- [ ] Preserve existing producer bytes. Status: planned; assert legacy output equals the original fixed-layout bytes and token form equals original fixed header + uint16 length + token. Include existing uint32 wide identities; do not truncate v2 to fix legacy.
- [ ] Real v2 handover split at LENGTH. Status: planned; use an authenticated raw control peer and actual data socket. Establish the boundary through a disclosed receiving-side barrier/observation, then send token continuation and prove OpenSession/result/ACK success. Merely making two writes is not proof TCP delivered two reads.
- [ ] Real legacy handshake with coalesced binary suffix and no extension. Status: planned; assert correct admission and exact parsed suffix while #42 remains explicitly unresolved. Wrong ctrl/session/handler/token cases must reject without forwarding unauthorized payload or mutating an unrelated session.
- [ ] Bounded incomplete handshake and cleanup controls. Status: planned; exercise truncated length/token, existing deadline and sibling survival. Restore test policy overrides and own every socket/root. A timeout is failure unless the test specifically asserts the existing rejection deadline.

## #42: deliver suffix once, only after successful admission

Initial production scope: data-handler portion of `TunnelServer.ts` plus dedicated
tests/ledger42. If no trustworthy existing success signal is sufficient,
`ClientHandlerPool.putNewDataHandler` may need a separately approved narrow boolean
admission result, after #41 integration. It currently returns void even when it
rejects and closes the incoming socket. Do not blindly queue the suffix or mark
the handler authenticated after rejection; test the actual accepted/rejected path.
No new type/transport framework or change to ExternalPortServerPool is proposed.

Consume and clear remainBuffer when the handshake completes, then pass nonempty
bytes through the same receive path used by later chunks, after identity/token
admission and before any later chunk can overtake them. That path must retain its
session activity and queue-failure handling. It may queue before endpoint open and
must flush exactly once when the normal success/ACK path completes. Empty tails
must not emit callbacks. Reject/close/error paths clear only their own retained
data; #41's incoming-only rejection invariant must survive terminal cleanup.

- [ ] Observe #42 RED after #43 integration. Status: planned; an actual admitted data socket sends handshake + a first binary marker together, then a second marker. Require both markers in order with no loss or duplication; verify bytes buffered before OpenSession completion emerge after its existing ACK/flush.
- [ ] Exercise legacy and v2 on real consumers. Status: planned; include exact-boundary/no-tail control, fragmented handshake, all payload split positions, embedded NUL/non-UTF8 and repeated sessions. Use an owned external client and owned raw endpoint peer; do not label direct parser callbacks as full-tunnel delivery evidence.
- [ ] Rejected admission with suffix. Status: planned; wrong token and #41 stale-session/wrong-ID controls must produce zero payload delivery, preserve sibling maps/buffers/echo and not mark rejected connections authenticated.
- [ ] Waiting queue overflow with retained suffix. Status: planned; reuse existing resource limit and assert the original failure/cleanup behavior without a separate unbounded buffer or duplicate close callbacks.
- [ ] Regression/build/two independent reviews. Status: planned; retain DataStatePacket layout tests, ProtocolV2 wide/token/opt-in tests, reviewed #41 real consumers, connection-race and queue/resource regressions. No forced process exit or retry-until-green.

## Sequencing and excluded work

Complete reviewed #41 first, then #43 framing, then #42 suffix delivery, each with
its own ledger, observed RED, scoped commit/integration and notification gates.
These paths share TunnelServer/ClientHandlerPool context and must have one serial
owner. Administrator tasks can remain in disjoint files; coordinate heavy network
tests and integration. Root has assigned the #43 worktree recorded above; #42 remains unassigned and requires its own approval.

#28's four-byte CloseSession count/4 GiB policy remains unanswered and is not
changed by either proposal. #29's platform-held HTTP EOF consumer work remains
untouched; this is not an alternate implementation of or workaround for that hold.
No external endpoint, daemon, server or test was run during this research. The original #41 freeze reference was historical; #41 is now complete at `b6dbf01` with receipt 3966 (66/38). The later root assignment authorizes #43 under its stated RED/API/scope gates only; #42 remains unapproved.
