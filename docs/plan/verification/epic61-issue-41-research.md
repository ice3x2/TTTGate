# Issue #41 — Legacy handler identifier research

Status: research independently rereviewed PASS by review_cert_conflict and approved by root. Assigned to review_cert_conflict in C:/Work/git/_Snoworca/TTTGate-epic61-control, branch fix/epic61-legacy-handler-ids, base 7a79df4. This document records no implementation or executed test evidence.
Researcher: review_wave0; integration workspace only. Original: https://github.com/ice3x2/TTTGate/issues/41.

- [x] Read original issue and current allocation/consumer/protocol paths. Status: complete; anchors below.
- [x] Examine reuse, ownership and separate policy boundaries. Status: recommendation below; no implementation authorization implied.
- [x] Independently review allocation/lifetime design and approve exact scope. Status: review_cert_conflict rereview PASS after mandatory dual-identity correction; root approved the bounded #41 lane.
- [ ] Create dedicated branch/ledger and execute consumer RED before implementation. Status: root created and assigned the branch/worktree above; owner must freeze exhaustion's existing caller-failure contract in ledger41 and observe required RED before production changes.
- [ ] Implement, run compatibility/lifecycle regressions, independently review and integrate. Status: pending RED and assignment.

## Observed contract

ClientHandlerPool.ts:34 has a static counter initialized to 10000. sendConnectEndPoint
at lines 280–302 creates pending/queue state then increments it without wrapping.
CtrlPacket.ts:373 serializes the header ID masked to 16 bits. Legacy clients that
ignore optional metadata return that short ID; putNewDataHandler at line 120 and
promoteDataHandler around line 361 compare against the stored full value.

The ownership domain is a ClientHandlerPool: TunnelServer selects it by control
identity before handing over a data socket. Pending entries are keyed by session ID
but searched by handler ID; active entries also retain handlerID. Promotion keeps
the ID live after removing pending state. Zero is unsuitable because the handover
path explicitly treats a falsy handlerID as missing.

Existing ProtocolV2.test.ts tests legacy admission/explicit opt-in, token rejection
and a successful wide-ID exchange above 65535. Preserve that positive wide-ID test;
do not truncate all negotiated v2 IDs to make a legacy test pass. DataStatePacket
already carries firstSessionID and a 32-bit handler ID; inspect its existing
handover use when testing late arrivals, without changing its encoding.

## Minimum recommended design

Prefer a per-pool legacy cursor over a global reservation registry. Allocate only
for the already negotiated legacy path, cycling through 1..65535 and skipping
every ID present in either pending or active maps. Build one used-ID set from the
existing maps at allocation; do not add a duplicate lifecycle registry unless
measured evidence requires it. Keep the existing nonlegacy wide allocation and
binding-token behavior. Search found no reusable bounded allocator in this module.

Allocation and reservation must be synchronous with no await or callback between
choosing the ID and publishing the pending entry. Reserve before sending control
bytes, as send completion can be synchronous. Scan at most 65535 candidates.
On exhaustion, do not send an ID of zero, overwrite a live ID or throw for normal
capacity control. Return/report bounded failure through existing session-close
cleanup, without retaining a waiting queue or changing another session.

An unavailable pending entry still owns its ID until it is removed. Promotion
does not free an ID: the active map retains ownership. Failed promotion, token
rejection, queue overflow and terminateSession remove their owned entries; an ID
is reusable only when absent from both maps. Pool end must leave no reusable
registry behind (another reason to derive occupancy from existing maps).
The allocator must not silently fix unrelated pending cleanup defects; record
any actual leak separately and obtain scope approval if it blocks safe release.

Independent reviewer review_cert_conflict confirmed the late-arrival gap:
TunnelServer copies the existing DataStatePacket.firstSessionID onto the incoming
data handler, but ClientHandlerPool.putNewDataHandler searches only handlerID and
then overwrites that sessionID with the selected pending session. Occupancy alone
therefore cannot prevent a cancelled session's late socket from claiming a reused
ID. Root approved a mandatory ClientHandlerPool-only admission fix: match both
incoming sessionID and handlerID against the same pending entry before promotion
or mutation. A mismatch rejects only the incoming socket; it must not remove,
close, reassign or otherwise mutate the newer pending/active session. Reuse the
existing DataStatePacket fields without changing their encoding or TunnelServer.

Approved design scope includes allocation and the mandatory dual-identity handover
check in ClientHandlerPool.ts, dedicated tests/driver and ledger41. Implementation
is assigned as recorded above; actual RED remains mandatory before production changes.
CtrlPacket, DataStatePacket, TunnelServer, SocketHandler and all pool consumers are
read-only unless a concrete RED requires a separately reviewed ownership addition.
Coordinate with #22's logger-only SocketHandler/TCPServer changes through serial
integration; do not share source writes. Administrator routing is disjoint.

## Actual consumer RED plan

Reuse ProtocolV2.test.ts raw control-client/socket helpers and real loopback
listeners. A legacy peer must deliberately use decoded packet.ID and emit legacy
replies without wide metadata; using modern TTTClient alone would hide this bug.
Seed only the allocation cursor near 65535 in an isolated fixture, disclose that
setup, and drive actual control request, data-socket handover, endpoint-open result,
ACK and echo. Do not allocate 55,000 sockets merely to reach the boundary.

Before source edits, require independent RED for wrap and collision avoidance:
hold simultaneous pending sessions across wrap, retain an active low ID, then
allocate again and prove unique nonzero IDs and correct endpoint/session mapping.
Promote one while others remain pending; release it through the real terminal
path, then verify safe reuse and unaffected sibling echo. Mandatory separate RED:
cancel session A, reuse its handler ID for pending session B, then deliver A's
late data socket with its original firstSessionID. Assert that only A's incoming
socket is rejected, B's pending/active records and buffers remain unchanged, and
B subsequently completes correct handover/ACK/echo. Include wrong-session
promotion controls. Observe this RED before any shared allocation/admission code.

Test exhaustion using a declared bounded occupancy fixture rather than 65535 real
sockets: assert no control send/phantom queue, one caller-visible failure and
unchanged live ownership. This is a state-fixture test, not a full network-load
claim. Keep at least the wrap/mixed legacy-v2 handover tests on actual consumers.
Re-run existing v2 >65535, legacy-disabled, token mismatch and resource queue
regressions. Own all sockets/children, bound failures, preserve receipts and exit
naturally; no generic process termination or retry-until-green.

## Independent policy boundary

#41 is an original identifier-allocation compatibility defect. It neither changes
#28's four-byte CloseSession byte-count representation nor chooses its unresolved
4 GiB policy. #29's platform-held HTTP consumer work remains untouched; this
research is not a substitute implementation or alternate route around that hold.
Keeping explicitly opted-in legacy support while preserving v2 wide IDs needs no
new legacy deprecation decision. Requiring v2, narrowing v2 IDs, introducing a new
wire field or changing authentication would require explicit policy approval and
is not recommended here. Exhaustion behavior must be frozen in the implementation
ledger as bounded resource failure before RED, not silently inferred after coding.
