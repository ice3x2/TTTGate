# Independent HTTP header and framed-body work research

Status: bounded #31 implementation completed through closure/notification3978; source b76a10c -> main4b5015f2b08b7784924754e3c09f5a8299131854 pushed/remote verified; GitHub CLOSED2026-09-08T09:14:59Z, comment5582451863; root Telegram3978(66/46). Integrated six suites/58tests PASS3.443seconds, natural exit0; forced build PASS. Original research below is historical. #33 policy/API approved and assigned to review_cert_conflict in process fix/epic61-duplicate-host at4b5015f; other proposals are not assigned. Current progress SSOT is execution plan.

- [x] Compare original issues and integrated source. Status: findings below.
- [x] Inspect unintegrated #29 write overlap without modifying it. Status: UI worktree still has HttpHandler.ts and HttpPipe.ts changes; no pool change in its tracked diff.
- [x] Review/execute bounded #31 header-only lane. Status: completed; actual RED/GREEN/reviews and closure evidence in ledger31.
- [x] Freeze exact #33 rejection/ordering behavior before RED. Status: root approved ordered400/API below; process owner assigned.
- [ ] Assess existing/new #56 finite-message positive coverage. Status: read-only finding below; no issue closure claimed.
- [ ] Assign any #30/#32 bounded stage only after scope/response policy review. Status: no implementation authorization; EOF coverage remains blocked by #29.

## Independence versus file overlap

The integrated HttpHandler already handles explicit Content-Length/chunked bodies
and #11's request FIFO/no-body controls. Request header selection and duplication
do not require the missing EOF consumer work. They are semantically separable,
but share files with the preserved #29 partial implementation: HttpHandler.ts
(10-line diff) and HttpPipe.ts (14-line diff). Do not reuse, cherry-pick, overwrite,
resolve away or continue those held changes. A proposed new header lane must use
a fresh latest-main checkout, exclusive bounded hunks/tests, serial integration,
and explicit approval of that overlap. This is not permission to bypass the hold.

No recommendation below implements endResponseInput, output-progress callbacks,
closeWait/drain behavior, unknown-length completion or pool changes. #29 remains
unchanged and blocked; any test whose success requires that work stays blocked.

## #31: strongest independently bounded candidate

HttpHandler.replaceHostInHeader currently scans every header value for a substring,
and is invoked from request and response manipulation. A short Host such as a
corrupts Cookie/User-Agent/Authorization values. Limit that helper to the Host
header name (case-insensitive), reusing existing header utilities, without adding
implicit transformations of other headers. Existing explicit Location/CORS/cookie
policies are separate and should not be incidentally rewritten.

Proposed writes: HttpHandler.ts's header replacement only, dedicated tests and
ledger31. Actual RED uses the existing real duplex fixture and a short request
Host, with Cookie/Authorization/User-Agent/custom values containing it. Assert
only Host changes before upstream forwarding, all other values remain exact,
and a subsequent finite valid response completes. Include mixed-case Host and a
normal Host control. No EOF, real external endpoints or held UI checkout needed.

## #33: duplicate request Host and ordered 400 proposal

Status: root approved the following ordered rejection policy/API freeze.
Root assigned review_cert_conflict to process fix/epic61-duplicate-host at4b5015f; execution plan records the exact two-file boundary and current46of66. No source
or tests executed for this design.

The original requires HTTP400 when two or more Host fields occur. Count request
Host names case-insensitively after complete header parsing, before invoking the
normal onHeader callback, enqueuing a RequestContext or forwarding header/body.
Reject identical as well as differing duplicates. Response Host and missing request
Host remain under their existing policies; neither is a new validation rule here.

Two possible policies were compared:

- Immediate400 when no earlier requests are pending; if prior responses exist,
  close without400. This is the smallest implementation but does not fully meet
  original33's400 requirement and can truncate a healthy earlier response. It
  requires an explicit root acceptance change and is not the recommendation.
- Immediate400 with no pending requests; otherwise stop admitting request input,
  finish all previously admitted responses in existing FIFO order, then send one
  complete400 and close. This preserves original33 and existing response ordering.
  Waiting for only the currently streaming response is insufficient when multiple
  earlier requests are already pending.

**Root-selected policy: the second policy, with separate input-rejected and
400-sent latches; no new response queue.** Existing `_pendingRequests` already counts earlier
admitted requests; final response completion shifts it, while informational1xx
must not consume a slot. The malformed request does not enter that FIFO or reach
upstream. Discard its body and all subsequent request bytes after the latch is set,
including bytes coalesced in the same read; allow upstream responses to continue.
When pending count reaches zero, after the last finite response's output has been
enqueued, enqueue exactly `HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
and end through the existing native write/end path. Do not send400 ahead of body
bytes or append more responses after it. Mark emission once before any callback;
late terminal callbacks must not emit again. Write failure takes the existing
terminal cleanup path. Release clears the latch/FIFO and closes the owner once.

Current `onHttpMessageEnd` performs synchronous body replacement/output before
shifting the final response FIFO. Therefore the finite-message path offers an
ordered insertion point without buffering prior responses in a new queue. Use
that point only while the handler remains live (rewrite failure can destroy it).
Confirm existing SocketHandler write/end ordering and callback ownership in RED
preparation; do not create output-progress, EOF or pool APIs for this issue.

A narrow additive parser rejection notification/result is needed: duplicate Host
is an explicit condition, not a newly thrown normal-control-flow exception.
HttpPipe must reset/stop only its request input and notify HttpHandler of this
specific rejection before its regular header callback; other parse-error contracts
stay intact. Root-frozen callback: `onRequestRejected(reason: 'duplicate-host')`, invoked once
for duplicate request Host before the normal header callback. After rejection the
request parser stops input/body/same-read tail and repeated input. Keep this narrow
reason/result independent of ordinary parser errors.
Proposed source ownership: request-only duplicate check/result in HttpPipe and the
terminal latch/ordered400 boundary in HttpHandler, plus dedicated tests/ledger.
Reuse existing case-insensitive header utilities/FIFO/socket lifecycle; no shared
transport, HttpUtil, body rewrite or generic parser refactor is authorized.

A nonterminating upstream can prevent its prior response from completing. This
proposal adds no timeout, fabricated completion or new heartbeat: existing errors,
connection timeout and peer termination retain their behavior, and an already-dead
connection cannot be promised a delivered400. Close-delimited response completion
is the held29 dependency, not permission to implement it here. Validate only
explicit Content-Length/chunked preceding messages and document this boundary.
An accepted101 upgrade also exits HTTP framing: never append an HTTP400 to upgraded
raw data; if a duplicate request was latched behind an outstanding upgrade, terminate
that connection rather than claim ordered HTTP rejection after protocol takeover.
Root explicitly accepted this exception: when a prior101 is accepted with rejection
latched, terminate before switching to raw forwarding; emit no HTTP400 into the
upgraded stream. Subsequent response tail must stop after400 emission as well.

- [x] Freeze ordered rejection/API. Status: root approved onRequestRejected duplicate-host callback once, separate inputReject/400sent latches, existing FIFO ordered400/end and explicit101/dead/incomplete-upstream exceptions.
- [ ] Actual first-request RED. Status: plan identical/different/mixed-case duplicate Host, split/coalesced headers and invalid body/later request suffix; zero invalid bytes upstream, exact400/EOF once, healthy independent sibling. Single mixed-case Host remains valid and missing Host behavior is unchanged.
- [ ] Actual pipelined RED. Status: plan one and multiple outstanding requests with partial CL and chunked responses, including existing synchronous text rewrite; invalid request arrives while response body is incomplete. Assert only valid requests upstream, no400 before all preceding final response bytes, exact ordered complete responses followed by400 and terminal close. Keep upstream open until these finite-message assertions complete; no FIN-triggered success.
- [ ] Counter/terminal controls. Status: informational100/103 must not reduce pending count or release400 early; final responses do, invalid and later input never consume slots. Repeat bad input emits400 only once; owner cleanup once, pending/latch zero on terminal, sibling continues. Preserve128-cap behavior and existing CL/TE rejection. Include peer/write failure and accepted-upgrade exception without new error/EOF semantics.

Root dispatch freeze: only HttpPipe request header/rejection boundary and
HttpHandler rejection/ordered-output boundary are writable production areas, plus
dedicated tests and ledger33. At pending0, enqueue400 then invoke existing end;
after every prior final completion recheck live/pending0 before emitting. Never
consume100/103 as final. Test invalid body/later request in the same read, repeated
input, multiple preceding responses, rewrite completion,128 cap and101 exception.
No EOF/endResponseInput/pool/new response queue, Location/CORS/cookie/body policy
change is approved. Actual RED must precede production writes after assignment.

## #30: finite-message stage is separable, whole scope needs honest limits

Current HttpHandler decides body rewriting before changing length/transfer headers;
HttpUtil unsupported/multiple content encodings can reach toString/Buffer.from.
The original recommended bypass can be selected at headers for non-UTF8 charset
or unsupported/multiple encodings, preserving original framing and raw bytes.
This can be tested on explicit Content-Length and chunked messages without EOF:
EUC-KR/non-UTF8 bytes, opaque zstd-labelled bytes (no decoder needed), br,gzip chain,
and supported single-encoding/UTF8 positive controls. Keep input response headers
unchanged when bypassing, and prove actual client body completion/binary equality.

Proposed writes only after approval: HttpHandler rewrite eligibility and minimal
existing HttpUtil token/charset reuse, dedicated tests/ledger30. Do not add a codec,
new dependency or change decode order by guesswork. A finite-message stage cannot
claim close-delimited EOF correctness or close #29. Any required EOF response
completion remains blocked; explicitly qualify #30 validation/closure scope rather
than laundering that prerequisite into another task.

## #32: response commitment prevents an automatic 502 fix

The 16 MiB body limit branch returns false, after response headers may already be
sent. For known oversized Content-Length a pre-header rejection may be possible;
for chunked input the overflow can become known only after headers/body were
processed. A second 502 status line at that point is not a valid replacement
response. Original #32 explicitly excludes raw bypass, so do not choose it silently.
Root needs a concrete header-commit/overflow termination decision before work.
Finite-body tests can reproduce hanging/overflow independently of EOF, but do not
implement buffering redesign or unknown-length handling as a #29 workaround.
Keep this issue unassigned until that scoped design is reviewed; any EOF-dependent
acceptance remains blocked.

## #56: finite positive coverage already exists and can be audited separately

Original #56 cites the old unit suite's bypass-only coverage. Since then integrated
test/component/http-directions.test.ts checks actual finite text-body replacement
and absence of internal.example/path, and rejected-upgrade continuation checks
the correct next request's hostname. Inspect these assertions against the exact
issue before duplicating them. A dedicated test-only strengthening, if needed,
may use real Content-Length/chunked UTF8 and supported single gzip/br roundtrips
with exact decoded expected content and Node HTTP completion. No runtime edits or
EOF cases are necessary for that bounded evidence. This research ran no tests and
does not itself establish #56 complete; preserve TDD rules if behavior fixes emerge.

## Recommended dispatch boundary

Only #31 is immediately ready for a minimal independently reviewed header plan.
#56 can be investigated as test-only finite-message coverage. #33 needs the 400
and pipeline ordering contract; #30 needs an explicitly qualified framed-body
stage; #32 needs the already-committed-response policy. None is authorized by this
research. Integrate sequentially under one new HTTP owner, preserving the held
UI worktree. No packet-count policy (#28), buffer policy (#40), timing benchmark,
denied artifact cleanup or #29 EOF implementation is proposed or executed.

## Current bounded #31 assignment

- [x] Independent design review and root assignment. Status: approved; review_cert_conflict on fix/epic61-host-header at35a5d5f; HttpHandler.replaceHostInHeader Host-selection hunk plus dedicated test/ledger31 only; held UI/EOF/pool remains untouched.
- [x] Observe #31 actual RED and complete independent per-issue gates. Status: complete3978; no successor approval follows automatically.
