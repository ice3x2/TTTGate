# Issue #28 — Large close-session counts and compatibility

Status: research complete; explicit compatibility decision pending. Author: `research_schedule`. Technical documentation review passed; the two updated progress statements await separate rereview. No implementation or new regression tests were written for this research. Backend limiter issue 13 is complete; frontend login issue 8 continues and the whole epic is not blocked.

## Current evidence

Read GitHub issue 28 and current integrated source. The issue suggests either widening the field or saturating it, but the saturation suggestion conflicts with actual close semantics:

- `src/commons/CtrlPacket.ts:140`: `closeSession` allocates four count bytes and calls `writeUInt32BE(waitReceiveLength)`; values above 0xffffffff cannot be encoded.
- `src/commons/CtrlPacket.ts:82`: `waitReceiveLength` reads the four-byte prefix.
- `src/commons/CtrlPacket.ts:255`: CloseSession optional metadata is parsed from offset 4. An unconditional eight-byte replacement would shift the JSON boundary for existing parsers.
- `src/util/SocketHandler.ts:373`: the receive counter grows by every received chunk. Its representation is a JavaScript number.
- `src/server/ClientHandlerPool.ts:458` and `src/client/TunnelClient.ts:569`: both send paths construct CloseSession packets using that count. The client wraps its send path in catch; this does not deliver the missing close notification.
- `src/client/EndPointClientPool.ts:95` and `src/server/ExternalPortServerPool.ts:256`: both close only when `endLength <= sendLength && isOutputDrained`, with the existing close-wait flag set.
- `src/commons/ProtocolV2.ts`: capability declarations and handshake metadata already exist, but no large-close-count capability exists. `HandlerWideIdMeta` currently contains only the optional handler ID.
- `docs/plan/00-2.tech-decisions.md`, ADR-004 and ADR-004-1: protocol changes are incremental/negotiated; silent downgrade is prohibited.

These are source-derived findings, not a claimed 4GiB live-transfer reproduction. Line anchors refer to the inspected revision and may move after implementation.

## Why saturation is unsafe

Suppose the sender's true count is `0x100000000 + 100`, but the close packet saturates it to `0xffffffff`. The receiver may already have sent `0xffffffff` bytes to its endpoint and have an empty output queue while the remaining data is still arriving over the separate data channel. The existing predicate then considers the saturated count satisfied and can close early. A locally drained queue is not proof that all remote data has arrived. Modulo or zero replacement similarly reduces the required count. Catching the encoding exception alone leaves the close notification absent.

## Design choices, not approved implementation

| Choice | Assessment |
| --- | --- |
| Preserve the four-byte prefix and existing JSON boundary; negotiate an additional exact-count field | Preferred candidate. Requires capability propagation, validation, sender selection and receiver interpretation. Upgraded peers could preserve the full close target without widening every existing frame. |
| Unconditionally replace four bytes with eight | Breaks existing count/metadata interpretation; inconsistent with the recorded compatibility policy. |
| Saturate, wrap, use zero, or merely catch errors | Does not preserve complete-delivery semantics; unsuitable as a full solution. |
| Explicitly limit oversized sessions for peers without support | Avoids pretending graceful completion succeeded, but introduces a compatibility/error policy that must be decided before implementation. Exact enforcement and diagnostics need design after that decision. |
| Preserve oversized sessions with unmodified legacy peers | Requires additional protocol/lifecycle research; current close field cannot express the exact total. No lossless compatibility solution is claimed here. |

The counters currently use JavaScript numbers. A validated extension bounded by `Number.MAX_SAFE_INTEGER` matches that representation. Claiming the full uint64 range would require reviewing counters and comparisons for BigInt conversion; that larger change is not implicitly authorized. No final field name or wire encoding has been selected.

Root has asked the user to choose between requiring both peers upgraded for oversized sessions with an explicit unsupported-peer limit, and further design for legacy large-transfer compatibility. The answer is pending. Elapsed time is not an answer, and no dependent code may be written yet.

## Scheduling and ownership

Issue 13 is now integrated and complete; issue 28 can potentially run beside the continuing frontend issue 8 because their production files do not overlap. The current plan does not yet authorize that early lane: record the chosen policy, agreed design and actual worktree/branch before dispatch.

Likely exclusive production ownership: `CtrlPacket.ts`, `ProtocolV2.ts`, `CtrlMetaGuards.ts`, `TunnelClient.ts`, and `ClientHandlerPool.ts`. Capability plumbing may additionally require `TunnelServer.ts`; inspect before assigning. Read endpoint close consumers and existing tests first, and expand ownership only for demonstrated changes. Do not concurrently assign other protocol/transport writers to those files.

Issues 41 (ID reuse) and 43 (data-handshake framing) are not technical prerequisites for count encoding, but they share protocol files and must integrate serially. This is a dependency analysis, not authorization to skip their gates or broaden this issue.

## Proposed boundary-first TDD

- [ ] Record policy and protocol design before dependent tests/implementation. Status: pending user input and independent review.
- [ ] Write failing packet tests at 0xffffffff, 0x100000000 and a larger exact count, plus invalid/range boundaries. Status: pending policy/design.
- [ ] Exercise both real close-notification send paths with prepared large counter state; assert the peer receives the exact target and the control connection survives. Status: pending.
- [ ] Prepare real socket counters near the boundary, send a small remaining payload and show that closure waits for the full target and actual output drain. Status: pending. Declare counter preparation as a fixture; do not claim a 4GiB transfer occurred.
- [ ] Test negotiated support combinations, unchanged small-count frames and the explicitly chosen unsupported-peer behavior. Status: pending policy.
- [ ] Independently review the implementation and run appropriate protocol/lifecycle regressions. Status: pending implementation.

Boundary fixtures can prove encoding and the close predicate without allocating or transmitting 4GiB. They cannot substitute for the separately scheduled large-transfer/cache-spill tests, and should not be described as equivalent empirical coverage.
