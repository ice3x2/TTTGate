# Issue #28 — Negotiated exact close counts

Historical checkpoint convention: lower pending, no-run, no-production and unchecked design/implementation wording is preserved historical evidence, superseded by the later execution and final-review sections; the latest independent rereview/root integration gate remains current.

Status: final independent rereviews completed with C/H/M/L0 and MERGE_READY from two reviewers; source commite8d3bf8 integrated by root as259fff6. Root focused2suites24PASS52.912s naturally exited0 and root forced build exited0. Implementation259fff6 and verificationc11716b were pushed; issue28 closed2026-09-09T05:45:18Z with comment5596449843 and Telegram4007(68/67). Agent focused24PASS53.658s/regression55PASS149.71s/build0 and earlier21focused/49regression remain separate historical evidence. User approved negotiated safe-integer counts and explicit oversized failure for unsupported peers on2026-09-09. All actual RED/intermediate failures and documented coverage limitations remain preserved. Worktree `TTTGate-epic61-count`, branch `fix/epic61-large-close-count`, base `02567a3`; no commit/push by this ledger updater.

- [x] Read AGENTS, issue28 research, ADR-004/004-1 and current producer/consumer paths. Status: read-only complete.
- [x] Reuse existing packet JSON suffix, metadata result validation and authenticated capabilities. Status: design below; no duplicate parser or new transport proposed.
- [x] Independently approve encoding, negotiation and unsupported-peer teardown scope. Status: completed, including documented same-control sibling interruption; original design and review history retained below.
- [x] Author failing contracts before implementation. Status: actual RED and separate correction RED preserved below; setup failures are not behavioral RED.
- [x] Implement minimum reviewed change and obtain separate reviews. Status: two final independent rereviews returned C/H/M/L0 MERGE_READY after fixes.
- [x] Run relevant focused/integration regressions and root integration. Status: sourcee8d3bf8 -> root259fff6; root24PASS52.912s/native0 and forced build0, separate from agent results.
- [x] Push and issue closure. Status: implementation259fff6 and verificationc11716b pushed; CLOSED2026-09-09T05:45:18Z/comment5596449843/Telegram4007(68/67).

## Existing boundaries and reuse

`CtrlPacket.waitReceiveLength` reads a uint32 prefix; `closeSession` writes four bytes and appends optional JSON. `handlerWideIdMetaResult` reads CloseSession JSON from offset4. `HandlerWideIdMeta` is shared with three other commands; do not silently broaden their schema. Reuse `readJsonMeta`, `MetaResult`, SAFE_REVIVER and nonthrowing validation from CtrlMetaGuards. Existing throwing getters retain their documented adapter behavior.

Producers are `ClientHandlerPool.sendCloseSession` and `TunnelClient.sendCloseSession`. Consumers are ClientHandlerPool's CloseSession branch and TunnelClient's CloseSession branch. The latter currently accesses the count inside a successful drain callback; validate and capture the exact target before registering that callback, then retain #73 current-handler/success/drained guards.

Server identity capabilities are copied in `TunnelServer.promoteToCtrlHandler` / `ClientHandlerPool.setAuthenticatedIdentity`. Client currently reads SyncCtrlAck capabilities but does not retain a negotiated large-count flag. Reuse these handshake fields. There is no bitmask: the new capability is a string token, not a numeric bit.

ADR-004 requires incremental negotiation; ADR-004-1 forbids silent downgrade. ADR-006 prefers session/connection containment. Neither endpoint byte comparison nor SocketHandler counters needs widening: they are JavaScript numbers already. No BigInt, full uint64, data-state framing, HTTP EOF, buffer policy or authentication-default change belongs here.

## Wire contract

Capability token: `close-count-safe`. Add it to the supported ProtocolCapability union/default list only when both complete send/receive paths exist. No protocolVersion bump.

All CloseSession counts must be finite nonnegative `Number.isSafeInteger` values in `0..Number.MAX_SAFE_INTEGER`. Zero is an ordinary existing close target; it is never substituted for a count that cannot be represented.

| Count | Prefix | JSON suffix at offset4 |
| --- | --- | --- |
| 0 through 0xffffffff | Exact existing uint32 | Existing metadata unchanged, including property order/absence |
| 0x100000000 through 0x1fffffffffffff | 0xffffffff marker | Existing handlerID, then `waitReceiveLength` containing the exact JSON number |

Example extended payload: `ff ff ff ff` followed immediately by UTF-8 `{"handlerID":7,"waitReceiveLength":4294967296}`. Existing frame header, payload-length field and JSON boundary do not move. Presence of the extension field selects the extended form, not the prefix alone. An upgraded receiver requires bilateral negotiated capability and a validated extension before using this form. It must never fall back to the prefix on an extension error. An old peer must never be sent this form by a conforming sender.

The extension field is emitted only for counts greater than uint32. For small counts the factory must serialize precisely the pre-change packet bytes with the same caller metadata; no empty object/new field/reordered fields are introduced. `0xffffffff` without the extension remains an ordinary exact small count.

Proposed narrow types/API:

- `CloseSessionMeta = HandlerWideIdMeta & {waitReceiveLength?: number}` in ProtocolV2; other command metadata stays unchanged.
- CloseSession-specific validator/result reusing the existing JSON reader. Reject present fields that are null, non-number, negative, fractional, nonfinite, unsafe, or <=0xffffffff; reject extension with prefix other than 0xffffffff. Unknown unrelated JSON keys retain current compatibility behavior. Packet-wide duplicate-key policy is unchanged.
- `CtrlPacket.closeSession` accepts CloseSessionMeta but owns extension serialization from its count argument, not a caller-provided contradictory value. Existing callers need no change for small counts. Large counts require a positive explicitly supplied negotiation option (for example final `allowLargeCount=false` argument); factory rejects unsupported/invalid counts with RangeError as a programmer boundary. Runtime producers precheck predictable conditions and never use exception handling for normal branching.
- `readCloseSessionCount(allowLargeCount: boolean)` returns an explicit success/error result containing the exact count and optional handlerID; ordinary callers migrate to this result. After valid suffix parsing, an absent extension field means the four-byte legacy count, including exactly0xffffffff, with or without negotiated support. A present extension requires bilateral negotiated capability, prefix0xffffffff and a finite integer strictly greater than0xffffffff and at most Number.MAX_SAFE_INTEGER. Explicit null, wrong type, invalid range or malformed JSON is a protocol error, never field absence or prefix fallback. Existing `waitReceiveLength` remains the legacy uint32 accessor for compatibility, with all live CloseSession consumers migrated away from it. No later callback reparses the packet.

## Negotiation and lifecycle

Server advertises local support in SyncCtrlAck. On verified v2 Ack, effective support is the intersection of the server's advertised support for that connection and authenticated client's advertised support. Do not assume server supports an arbitrary token merely because a client lists it. Store the effective large-count boolean in the authenticated pool (or derive it from a deliberately intersected capability set). Preserve unrelated capability semantics: avoid globally changing how other tokens are interpreted.

Client enables support only for a valid v2 SyncCtrlAck advertising the token AND the v2 identity branch that sends an Ack advertising its own support. Publish/reset the per-control negotiated value with the current control owner: reset before connect, absent/legacy fallback, failed handshake and control teardown. A reconnect to an old server must not inherit prior support. Sending Ack with a local supported list alone is not bilateral negotiation.

The server validates/authenticates before publishing capability; client validity is scoped to the server connection already selected by its existing TLS/identity policy. No added token changes HMAC contents or introduces fallback.

## Unsupported and malformed counts

Predictable invalid sender counts log `E_CLOSE_COUNT_INVALID`; valid oversized counts without bilateral support log `E_CLOSE_COUNT_UNSUPPORTED`. Include direction, sessionID, handlerID, numeric count and negotiated support only. Never log key, proof, binding token, full metadata or packet bytes. No CloseSession is serialized/sent on these failures. Do not catch a RangeError and continue as if notified.

Candidate containment decision: abort the affected authenticated CONTROL CONNECTION through the existing fatal-control owner cleanup, rather than invent a session-abort wire signal that old peers cannot understand. Client reuses `closeControlHandler(current,error)`; server invokes current control-handler destruction through normal TunnelServer terminal ownership so `destroyClientHandlerPool` runs. Do not call pool.end in isolation, replace callbacks, or silently clear maps before the owner cleanup observes them. All pending/active sessions on this control may be interrupted; other authenticated controls must survive. Existing reconnect policy remains unchanged and must not replay interrupted payloads.

Root explicitly approved proceeding with this authenticated control-connection abort design and its same-control sibling impact as the legacy cleanup tradeoff. Independent design review is still pending; this is not an implementation or execution approval. A same-control-sibling-preserving session abort would require a separately reviewed abort signal/consumer scope. It must not be implemented by CloseSession(0), saturation, or by moving the held #29 consumer change elsewhere. Other authenticated clients and existing reconnect behavior must remain intact, without replaying interrupted payloads.

Inbound extension without negotiation, invalid extended count, or contradictory marker is an explicit close-count protocol failure, logged without payload and handled by the same current-control abort. This is intentionally stricter than packet-local optional metadata discard (#46): an invalid terminal target cannot be interpreted as small graceful completion or left silently waiting. Record that terminal-specific compatibility exception in tests/docs. Ordinary malformed metadata for unrelated commands retains #46 behavior. Existing legitimate small CloseSession frames remain accepted with either peer generation.

The receive path must not derive negotiation from a packet field. Optional handlerID retains existing identity/fallback rules; #28 must not inadvertently weaken SID/owner validation or silently broaden handler-ID routing.

## TDD and acceptance matrix

Each item starts RED before implementation. Setup failures, source-order checks and intentionally malformed inputs have distinct classifications; do not call every failure a production reproduction.

- [ ] Packet boundaries. Status: pending. Golden pre-change bytes for legacy no-meta and handlerID-meta small frames at0,1,0xffffffff; extended roundtrip at0x100000000,0x100000000+123 and MAX_SAFE_INTEGER. Preserve metadata offset4 and streaming split/coalescing. Reject -1, fraction, NaN, infinities, MAX_SAFE_INTEGER+1, strings/null and contradictory caller metadata. Test result readers with raw malformed serialized suffixes, not only factory-produced valid frames.
- [ ] Negotiation matrix. Status: pending. v2 both=yes permits extension; new/old, old/new, neither, legacy mode/fallback disable extension. Advertised client-only token cannot enable a server that did not advertise it. Successful new->old reconnect clears prior state. Invalid metadata and failed handshake do not publish support. Existing small frames remain byte-identical in every supported mix.
- [ ] Both senders. Status: pending. Invoke real ClientHandlerPool and TunnelClient producer paths through actual owned control sockets; observe exact CloseSession prefix/meta/count. Prepare only task-owned counters near uint32, disclose preparation. At invalid/unsupported count assert no CloseSession bytes, exact diagnostic category, natural owner teardown and no successful-completion callback. Confirm unrelated control's finite echo survives; document interruption of same-control siblings if connection-abort tradeoff is approved.
- [ ] Both receivers and drain. Status: pending. Send actual encoded control frames to each live consumer. With a task-owned near-boundary send counter, first admit the small final payload into the actual endpoint writer/native cork. Then compare CloseSession before versus after output drain; finish only after exact target and drain. This does not require accepting new input after a handler transitions to Terminated. Observe existing natural10s pool scan within a fixed12s allowance and the unchanged30s case budget; never invoke private scans. Preserve #73 stale/failed callback guards. Use real sockets/cache where relevant, never synthetic drain or a fabricated successful callback.
- [ ] Legacy absence and invalid inbound target. Status: pending. For both negotiated and non-negotiated readers, absent suffix or valid metadata without the extension field must accept the exact four-byte legacy count, including0xffffffff. Separately test present extension without bilateral token, prefix other than0xffffffff, explicit null, wrong type, fractional/nonfinite/unsafe/<=uint32 number and malformed JSON: each must produce a protocol error with no prefix fallback. Assert explicit terminal error/current-control teardown, no unhandled exception and no orphan session/cache maps; preserve other client owner. Extension absence alone is not an invalid number or missing-marker error.
- [ ] Regression. Status: pending. Reuse CtrlPacket unit cases, ProtocolV2 control exchange, control-framing/control-metadata, data-terminal/client-owner/endpoint-graceful-drain, handler-ID tests and small tunnel flow. Do not assume #53 small-count large-cache PASS proves >4GiB delivery. Existing fixed-time budgets stay unchanged unless a separate fixture budget is explicitly frozen before new execution.
- [ ] Final independent review. Status: pending. Check compatibility vectors, capability reset, producer/consumer symmetry, original error preservation, cleanup before fixture disposal and no unrelated owner destruction. Full tests/build and root commit/push occur only after scoped GREEN/review.

## Writable scope after design approval

Production: `src/commons/ProtocolV2.ts`, `src/commons/CtrlMetaGuards.ts`, `src/commons/CtrlPacket.ts`, `src/client/TunnelClient.ts`, `src/server/ClientHandlerPool.ts`, `src/server/TunnelServer.ts` only for the encoding/capability/close failure paths above. Reuse current control teardown; if it cannot safely supply the selected contract, stop for design review rather than editing another consumer opportunistically.

Tests: dedicated packet/consumer count tests under `test/unit/commons` and `test/component`, at most one owned fixture, plus existing exact protocol cases only where their asserted wire/capability contract changes. This ledger records RED/GREEN/review. No test has been authored or run yet.

Read-only/out of scope: ExternalPortServerPool, EndPointClientPool, TTTClient, SocketHandler, all HTTP/EOF files, config/UI/#40 files, metadata consumers for other commands, dependencies/build configuration, original SRS. Any actual necessity requires explicit bounded amendment and independent review. No process-name termination and no hidden retry/benchmark. The current design document is the only written artifact of this task.


## Implementation assignment and first test checkpoint

Status: root approved strict TDD implementation on count worktree. Packet golden/boundary/present-invalid contracts and real both-direction producer/consumer, legacy unsupported containment and client old-peer reconnect tests authored before production changes. Reuse withClient/withLegacyIds and real control transport. No4GiB payload or fake network success.

- [x] Preserve dependency setup failure. Status:5f679a/session43008/6779a5 failed MODULE_NOT_FOUND for Jest before tests loaded, E count28-red-zAzSsK. This is not behavioral RED. Root subsequently supplied verified root/admin node_modules junctions.
- [ ] Observe bounded behavioral RED after root serial window. Status: #40 install/selected run currently owns execution window; packet13cases and real6cases are waiting. Existing30s per real case preserved, packet30s observation and real180s outer budget proposed. No production edits yet.
- [ ] Implement approved count result and both negotiation/terminal paths only after RED. Status: pending.


## First actual RED and minimum candidate result

- [x] Baseline test-first RED. Status:9e7e1b/session53285/f49339 naturally exited1,21FAIL74.713s. E count28-red-zAzSsK preserves behavior.stdout/stderr/result. Real server large/unsupported serialization RangeError, missing client notification/unsupported abort and invalid consumer non-termination are behavior failures. Packet reader API absence is recorded separately as capability absence; near-cork close-after also emitted ECONNRESET, not standalone product proof. Initial missing-Jest failure remains setup-only.
- [x] Minimum candidate implemented after RED. Status: six approved production paths only (ProtocolV2,CtrlMetaGuards,CtrlPacket,TunnelClient,ClientHandlerPool,TunnelServer). Exact count result/legacy bytes, per-control capability and invalid/unsupported control termination. HTTP/buffer/data-state/sharedpool primitive untouched.
- [ ] Candidate full focused GREEN. Status:0b5681/session55926/49dad4 naturally exited1,19PASS2FAIL59.989s. All13packet and6actual producer/consumer/legacy/reconnect cases passed, but two near-counter/drain cases failed: close-first native write was not held; close-after native target/drain did not close endpoint. Raw candidate.stdout/stderr/result preserved. These are not relabeled PASS; no regression/build or completion claim.
- [ ] Independently classify near-counter fixture/consumer ordering before further change. Status: root notified of source-derived possible fixture direction assumption and existing callback-before-sendLength accounting. No consumer/source expansion, timeout change or rerun authorized by this paragraph.


## Near-counter delegated observation, source frozen

Root approved one two-case test-only observation.802d46/session88021/017892 naturally exited1:2FAIL6filtered16.779s. Raw observation.stdout/stderr/result remain in count28-red-zAzSsK; per-case facts count28-near-observation-gqHtZc and count28-near-observation-lKalGV.

Close-first: dataState3->4 before external remaining3bytes, data.receiveLength14->17 but no endpoint-send event; endpoint sendLength4294967310 stayed below target4294967313, native writableLength0. This test sent additional input after the existing receiver transitioned to Terminated, so it does not establish a valid accepted-input ordering for the count change.

Close-after: actual3bytes reached corked endpoint/native writableLength3 with drainedfalse. After uncork the existing write callback and close-check both saw sendLength4294967310/drainedfalse. At the unchanged3s failure boundary, sendLength was4294967313/drainedtrue/closeWaittrue/socket still open; no additional scan check was observed within that window. Existing pool scan interval is10s, so this observation does not prove its later behavior or authorize a source repair.

Observers delegate original this/args/return and restore in finally. No SocketHandler/endpoint-pool changes or longer deadline. Root receives facts before selecting a corrected accepted-input fixture ordering and explicit existing-scan contract. Original RED/candidate failures remain failures; current #28 is incomplete and no further test run is implied.


## Independently approved near-counter fixture correction (not executed yet)

Status: root relayed independent approval to correct fixture ordering only. Both variants now admit the final3bytes into actual endpoint writer/native cork before terminal control; parameter distinguishes CloseSession before versus after output drain, not before input. Existing post-terminal-input FAIL observations gqHtZc/lKalGV remain unchanged and are outside #28 count-encoding acceptance.

After uncork, retain the3s exact-count+drained assertion, then observe native closure through the existing10s pool scan with an explicit fixed12s allowance inside unchanged30s case budget. No private scan call, production change, synthetic drain, extra payload/retry or new timer policy. All original source candidate changes remain frozen; #40 owns the active runtime window. Corrected test is frozen awaiting root run signal.


## Final candidate freeze

- [x] Corrected focused contracts. Status:22c240/session18671/546659 naturally exited0,2suites21PASS56.208s. Raw corrected.stdout/stderr/result in count28-red-zAzSsK. Exact13packet golden/extended/invalid contracts plus8actual owned cases. Prior21RED and19PASS2FAIL plus2observationalFAIL remain separate.
- [x] Actual near-target output ordering. Status: facts s3Tv92 and3HHSty. Final3bytes admitted before CloseSession; target4294967313/send4294967310/nativecork3 prove no early close. After actual count/drain completion, close-before-output-drain waits for the existing natural10s scan (approximately9841ms from drained observation to scan); close-after-drain closes immediately. Both end with exact send count and actual socket closure; independent control sibling echo succeeds. No4GiB empirical transfer or acceptance of input after Terminated is claimed.
- [x] Related regression. Status:63e17d/session14890/b4ab31 natural0,6suites49PASS153.207s. Exact paths: test/unit/commons/CtrlPacket.test.ts, test/commons/metadata-result.test.ts, test/component/server/ProtocolV2.test.ts, test/component/client/control-metadata.test.ts, test/component/client/endpoint-graceful-drain.test.ts, test/component/client/data-terminal.test.ts. No unrelated suite renamed or missing path counted as PASS; raw command/result saved.
- [x] Forced build. Status:69cc30 npm run build -- --force naturally exited0/signalnull/errornull; rawbuild.stdout/stderr/result retained. Existing always-auth warnings retained.
- [ ] Independent final candidate review. Status: six production files + two dedicated test files + this ledger frozen, no commit/push. Other writers may review original requirements and facts without adopting author conclusions. Runtime window released.

Coverage precision: both actual producer/receiver directions carry exact large targets. Null invalid metadata is exercised against both real consumers; malformed JSON/wrong numeric forms are packet-level. Legacy server unsupported and actual client reconnect to old advertised capabilities prove containment and unrelated-control survival. Near-counter native-drain acceptance is specifically the client endpoint consumer; the server direction has exact consumer notification evidence, not an additional near-counter external-pool drain experiment. Full bilateral advertised-server-absent/client-present permutations, unsafe-count runtime matrix and exhaustive same-control pending/active teardown counters are not claimed by these21tests. Preserve these limits for independent review; do not equate successful related regression with every design matrix cell.

Candidate files: src/commons/ProtocolV2.ts, src/commons/CtrlMetaGuards.ts, src/commons/CtrlPacket.ts, src/client/TunnelClient.ts, src/server/ClientHandlerPool.ts, src/server/TunnelServer.ts, test/commons/close-count.test.ts, test/component/client/close-count.test.ts and this ledger. No HttpHandler/HttpPipe/ExternalPortServerPool/EndPointClientPool/SocketHandler or buffer-policy writes; no process termination.

## Separate review correction: negotiation, teardown and diagnostics

- [x] Write stronger contracts before any correction to production. Status: separate fixer review_large_transfer extends only the existing component test. Valid safe-integer large frames are sent to both actual consumers after a real server-absent/client-present capability exchange. Invalid-null controls retain their own accurate title. Unsupported server/client abort cases now include real queued input and pre-dispose map/queue/owner cleanup, plus independent-control echo. INVALID and UNSUPPORTED server logs must include the actual active handlerID. No private destructive hook or source correction has been applied yet.
- [x] Observe bounded selected RED and preserve passing controls. Status: root released runtime window. handle24852/E `C:/Users/beom/AppData/Local/Temp/count28-review-red-uc1x9zo5`,5selected cases2FAIL3PASS/6filtered,19.618s/native1. Both valid unnegotiated consumer cases and client queued-abort cleanup passed. Both server INVALID/UNSUPPORTED cases retained pending state after native socket close. Original assertion stopped before log verification, so the same exact expected fields were combined for an additional diagnostic RED with production still unchanged: handle96358/E `count28-diagnostic-red-e38jfh4u`,2FAIL/9filtered8.808s/native1. Actual retired server pool had active0,pending1,queue1,25queued bytes and missing handlerID diagnostic for each case. Launch/rawstdout/stderr/native result preserved; this is not an expectation reduction.
- [x] Apply minimum demonstrated source correction. Status: ClientHandlerPool.sendCloseSession logs actual active handlerID (pending ID/0 fallback only if absent), and end() reuses burnWaitBuffer for remaining queued sessions then clears pending map before existing native data/control retirement. No other production file changed by this fixer; no private destructive hook invoked by tests, no new wire error message or scope expansion. GREEN/regression/build subsequently passed as recorded below.
- [x] Focused corrected GREEN. Status: handle91093/E `C:/Users/beom/AppData/Local/Temp/count28-review-green-cdv2ggol`,2suites24PASS53.658s/native0. Exact direct Jest --runInBand --silent --runTestsByPath test/commons/close-count.test.ts test/component/client/close-count.test.ts. The real unsupported server cases now assert pending/queue/bytes0 plus actual handlerID diagnostic before fixture disposal; client queued cleanup and both valid unnegotiated consumers pass. Root approved adding pool-resource and handler-map lifecycle to the prior six regression files because end() changed.
- [x] Related regression. Status: handle7652/E `C:/Users/beom/AppData/Local/Temp/count28-review-regression-t_gvvd_p`,8suites55PASS149.71s/native0. Exact direct Jest --runInBand --silent --runTestsByPath paths: test/unit/commons/CtrlPacket.test.ts, test/commons/metadata-result.test.ts, test/component/server/ProtocolV2.test.ts, test/component/client/control-metadata.test.ts, test/component/client/endpoint-graceful-drain.test.ts, test/component/client/data-terminal.test.ts, test/unit/server/ClientHandlerPool.resource.test.ts, test/component/handler-map-lifecycle.test.ts. No helper/test baseline changed to pass this run.
- [x] Forced build. Status: handle59586/E `C:/Users/beom/AppData/Local/Temp/count28-review-build-8lv4xpsk`,npm run build -- --force,native0/outer8.681s; existing npm always-auth warnings retained. Each new E records exact command/cwd, raw stdout/stderr and native code/outer time. No synthetic raw/PID history is claimed.
- [x] Independent correction rereview/root integration. Status: two final rereviews returned C/H/M/L0 MERGE_READY; sourcee8d3bf8 integrated as259fff6. Root focused2suites24PASS52.912s/native0 and forced build0. The correction fixer changed only ClientHandlerPool.ts, existing component close-count test and this ledger within the nine-path candidate. Its no-commit/no-push execution checkpoint remains historical; subsequent root source commit/integration is recorded here. No #29/#40/shared consumer edits, process termination, full-suite or coverage run.

## Root integration checkpoint

- [x] Record root-relayed final facts. Status: source commite8d3bf8, integration259fff6, two independent final MERGE_READY reviews with zero C/H/M/L, root focused2suites24PASS52.912s natural0 and root forced build0. These facts are root-relayed receipts, not new execution by this document updater.
- [ ] Remote push and closure. Status: pending; preserve all earlier RED/intermediate failures, agent focused24/regression55/build receipts and coverage limitations without combining counts or promoting partial evidence.
