# Issue29: explicit HTTP input completion and output drain contract

Status: design only at02567a3, branch fix/epic61-http-eof-lifecycle. No production/test edits or execution. Original HTTP-only work at494d72f and both consumer RED cases remain preserved. Independent design and safety review are pending; this document does not authorize retrying the rejected pool implementation.

- [x] Read current ownership boundaries. Status: ExternalPortServerPool.send/closeSession/closeIfSatisfiedLength at223/246/255 own delivery and final session termination. HttpHandler.sendData accepts response input, while sendLength records completed output progress. Its underlying socket faces the external HTTP client, so that socket's FIN is not the upstream response EOF.
- [x] Identify the dependency. Status: buffered response rewriting requires input completion before it can produce final output. The current consumer waits for output completion before calling handler.end_. Parser-only HTTP/1.1 recognition cannot break this cycle. A CloseSession received before the last response bytes must remain pending until those bytes arrive.
- [ ] Independently review the contract and platform restriction. Status: required before tests or implementation. This proposal names the needed consumer boundary explicitly rather than hiding it in getters/setters or another file. It is a clearer lifecycle contract, but it is not proven independent of the previously rejected approach: the same pool call sites remain necessary. Do not treat renaming the worktree/API as safety clearance. If the restriction covers these call sites, stop for legitimate platform resolution rather than bypass it.

## Proposed API and ownership

All signatures below are proposals awaiting review, not implemented APIs.

* HttpPipe.endInput(): void finalizes UNKNOWN_LENGTH_BODY through the existing message-end callback. An incomplete header, fixed-length body, chunk body or trailer reports the existing parser error. Empty idle state, already completed input and accepted raw upgrade do not invent another HTTP message. Requests without framing remain bodyless. HTTP response status/body rules for HEAD,1xx,204,304 remain in their existing owners.
* HttpHandler.responseInputLength: number is a side-effect-free getter over the existing cumulative response input counter, not output sendLength and not request receiveLength. Audit counter update ordering before reuse; accepted bytes must be counted once before parser completion callbacks. No number/wire widening belongs here.
* HttpHandler.endResponseInput(): void is an explicit once-only input EOF signal. Set its latch before parser callbacks. It flushes supported close-delimited rewriting through existing encoding/chunk output paths, but does not release the handler or close the external socket. Repeated signals are harmless; further input after finalization is rejected through the existing terminal error policy rather than silently accepted.
* HttpHandler.onOutputProgress: (() => void) | undefined is a narrow optional internal callback. Existing successful native output completions invoke it after accounting, scheduled outside the parser write stack. It does not create a new payload queue. Clear it on release; queued notification checks live ownership before acting. Existing raw SocketHandler callbacks retain their behavior.

The pool owns closeWait/endLength/closeInitiated and the session-map identity. The HTTP handler owns parser-input EOF and response-output flushing. Never change the meaning of a generic sendLength getter to force the existing pool predicate to pass.

## Required consumer contact points, disclosed scope

Minimum anticipated production writes are HttpPipe.ts, HttpHandler.ts and the following ExternalPortServerPool.ts call sites. No independent parser-only solution is claimed.

1. At HTTP-handler construction, bind output progress to a pool recheck capturing the exact session ID and handler object. The callback returns unless the current map entry is that object.
2. In closeSession, record the original target and closeWait as today, then evaluate HTTP input completion independently of output drain.
3. After each successful pool.send, re-evaluate that same input boundary. This is necessary when CloseSession arrived first. The final target is cumulative original response bytes; transformed byte counts cannot substitute for it.
4. In the shared close check, for HTTP only, signal endResponseInput once when closeWait is set and accepted response input exactly equals the retained valid target. Do not signal while bytes are missing. Overshoot, invalid/conflicting target or a target below accepted input aborts without flushing or graceful-completion claims, as frozen in M2 below. Then wait for original-count output accounting and native output drain before the existing closeInitiated/end_ path. Recheck after asynchronous output completion, with the identity and terminal guards.
5. Forced timeout/error destruction remains immediate abort and must not synthesize an EOF flush, success response or second status. Existing socket send failure and owner cleanup remain visible.

No public endpoint type change is expected if the existing HTTP intersection exposes the methods; any required type change must be disclosed before writing. No new timer, payload queue, control packet, producer byte format, general pool refactor or unrelated lifecycle change is proposed. Existing cleanup interval is not the primary progress notification.

The held HttpHandler/HttpPipe patch is historical input only. It predates #30 encoding eligibility, #32 encoded-body bound and #33 rejection handling; do not cherry-pick it wholesale. Preserve current unsupported-encoding bypass, finite-body limits, precommit502/postcommitabort, pending400 precedence and no-second-status behavior. Close-delimited rewrite buffering must have the same approved bound; do not introduce unbounded accumulation.

## Test-first acceptance, no tests run here

### Frozen input completion and abort contract (M2)

Status: design clarification only; platform BLOCKED remains. No clearance, production/test change or execution is implied.

The target must be a finite nonnegative safe integer. The first valid target is retained by the current session/handler owner. An identical repeated target is idempotent. A conflicting target, a target below already accepted response input, or input overshooting the retained target aborts the affected session through the existing error/forced cleanup path. Invalid targets likewise abort. None of these cases may flush buffered HTTP as successful EOF, truncate bytes to the target, or claim graceful completion.

If CloseSession arrives before the data, re-evaluate after each accepted response input. When and only when accepted input equals the retained target, latch input completion before calling endResponseInput exactly once; only afterward evaluate output accounting and native drain for graceful termination. Do not infer input completion from output sendLength. Target0 follows the same equality rule and parser empty/incomplete-state handling; it is never a replacement for an invalid count.

Abort sets a terminal latch before cleanup, detaches the output-progress callback and invalidates any scheduled notification by captured handler identity plus the terminal latch. A callback already queued may run but must have no effect. It cannot finalize input, emit the final rewritten chunk, re-enter graceful close or affect a replacement session. Release also clears callback ownership. Do not add a new timer/queue to implement cancellation.

- [ ] Observe order and count RED. Status: pending clearance/design review. Exercise before-data/after-data targets, zero and UINT-safe boundaries, NaN/infinity/fraction/negative/unsafe targets, equal duplicate, conflicting duplicate, target below received and final-write overshoot. Assert exact input bytes at the EOF call, no early flush, one EOF at equality and no EOF on abort.
- [ ] Observe callback/abort RED. Status: pending. Hold actual output drain after exact input completion, then abort; release pressure and invoke an already queued progress notification. Assert one owner cleanup, no later EOF/graceful close/final chunk, and unchanged replacement/sibling ownership. Repeated abort and duplicate target must remain harmless. Disclose any scheduled-callback fault input rather than claiming an OS failure.

- [ ] Freeze approved signatures, counter ordering, overshoot policy and exact budgets. Status: pending independent review and clearance for the disclosed consumer work. Reuse the existing real HTTP duplex fixture and preserved http-eof-consumer tests; use owned ephemeral listeners and current PID safety rules.
- [ ] Restore both original consumer failures as actual RED on the clean baseline. Status: pending. Native Node HTTP response must report exact rewritten payload/end/complete for CloseSession-before-final-data and CloseSession-after-data. Keep two-second fixture deadlines/ten-second case budgets unless a separate evidence-based fixture design is approved; do not stretch timeouts to obtain PASS.
- [ ] Add input/output separation RED. Status: pending. Before the last declared byte, assert no EOF/final chunk/owner close; deliver that byte and hold native output pressure, then assert one input finalization and no final session close until native drain. Repeated close/progress signals must produce one terminal cleanup; old session callbacks must not affect a replacement/sibling.
- [ ] Preserve parser and error controls. Status: pending. Actual HTTP/1.0 and1.1 close-delimited binary bypass and eligible text rewrite; partial header/Content-Length/chunk/trailer EOF failure; HEAD/1xx/204/304 body exclusion; accepted101 raw pass-through with transport termination; finite CL/chunked next-message tails unchanged. Error/forced close never flushes an incomplete success or queued400 after a terminal502/abort.
- [ ] Implement only after meaningful RED, then targeted regressions and build. Status: pending. Include #11/#12/#30/#31/#32/#33 security/parser controls and actual consumer cases. A parser unit PASS or direct helper EOF call cannot replace consumer acceptance. Preserve all failed receipts; no retries-until-green, benchmark or4GiB transfer claim.
- [ ] Obtain two independent final reviews and root integration approval. Status: pending. No issue closure until both consumer orderings, bounded flushing and cleanup are established. Documentation completion alone is not product completion.
