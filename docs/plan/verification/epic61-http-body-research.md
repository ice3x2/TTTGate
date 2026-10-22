# Finite HTTP body safety research — #30 and #32

Status: #30/#32 complete; #32 receipt3983 after nine suites106PASS4.973/build/push286feff. Approved encoded-limit/precommit502 versus postcommitabort exception and original failure evidence remain preserved. Earlier proposed/assigned/pending text is historical; current progress SSOT is execution plan.

- [x] Compare original #30/#32 and integrated HttpHandler/HttpUtil. Status: findings and recommended policies below.
- [x] Approve #30 eligibility and #32 overflow policy. Status: root approved the precise contracts below, including #32 priority over a pending #33 rejection. Research itself executed no source or tests; #30 implementation assignment is separately approved as recorded above.
- [x] Assign #30 bounded source ownership. Status: fix_supply15/process fix/epic61-http-body-encoding atc497ecd; actual RED remains required before the assigned implementation, followed by independent verification.
- [x] Complete #30 implementation and independent verification. Status: completed3981; detailed original/fixer evidence in ledger30.
- [ ] Execute #32 actual RED/implementation/review gates. Status: root assigned fix_supply15/process fix/epic61-http-body-limit at1b329da. Only HttpHandler rejection/bodyoverflow/needed existing reset hunks and dedicated tests/ledger; no helper/parser/EOF/pool/new queue.

## #30: determine rewrite eligibility before framing changes

Original #30 requires unsupported/multiple encodings and non-UTF8 character sets
to pass through without byte damage or inappropriate length/header rewriting.
HttpHandler currently chooses rewriting from text MIME/type plus positive CL or
chunked, then removes Content-Length and adds chunked before body decoding.
HttpUtil uses substring codec selection (gzip, deflate, br); unsupported bytes can
reach the unconditional UTF8 toString/Buffer.from transformation.

Recommend one small eligibility decision before changeModeOfReplaceHostInBodyInResponseHeader
and before sending response headers. Reuse HttpUtil header lookup/token parsing
where present. Eligible body: existing text/rewrite-enabled/has-body conditions,
explicit CL or chunked framing, charset absent or explicitly UTF-8 (case-insensitive,
trimmed and with ordinary quoted parameter handling), and no Content-Encoding or
exactly one supported gzip/deflate/br coding. Explicit identity may be eligible
as unencoded data if the policy is frozen before RED; it needs no codec change.
Duplicate/ambiguous charset or encoding fields and lists should conservatively
bypass rewriting, not pick a convenient substring or one of conflicting values.
Non-UTF8 charsets, zstd and every multi-coding list bypass. Do not add a codec,
transcoder, dependency or heuristic JSON/HTML parser.

For bypass keep original Content-Length/Transfer-Encoding/Content-Encoding and
Content-Type and forward exact framed bytes through the existing raw path. This
does not undo separately configured Location/CORS/cookie/custom-header policies;
the guarantee is that body-rewrite eligibility itself adds no header/body changes.
Supported UTF8 single-codec behavior stays through existing decompress/rewrite/
compress functions. Whitespace/case normalization used for eligibility must agree
with the value given to those existing functions; do not approve a token the old
codec path would treat differently. No fallback after malformed supported-codec
decoding is added. Existing decompression-limit handling is a separate retained
contract, not a new #32 raw bypass.

Mandatory RED: real duplex finite CL and chunked responses for non-UTF8 binary
bytes, opaque zstd-labelled bytes and multi-encoding lists. Assert original framing
headers and exact body bytes at the client, completed finite messages, next request
context and live sibling. Positive UTF8/no-codec and gzip/deflate/br controls must
assert actual decoded hostname replacement and correct client decoding. Test
charset/encoding case, whitespace and quoted parameters without external hosts.
Use already owned fixtures; metadata-only success is insufficient.

Initial source scope after approval: HttpHandler eligibility hunk and only a small
HttpUtil eligibility helper if genuine reuse warrants it, dedicated tests/ledger30.
No HttpPipe EOF state, closeWait/output-progress/pool changes. Close-delimited
completion is still blocked by #29; finite proof must not be advertised as fixing it.

## #32: immediate finite overflow termination with a stated policy exception

Original #32 requests immediate502 and closure rather than indefinite waiting,
and explicitly excludes abandoning rewriting to stream raw internal-host content.
Existing MAX_BUFFER_SIZE is16MiB; onHttpBody returns false on excess after the
response headers were already sent, leaving the old delayed-destroy problem.

Recommend two explicit states using existing header/body callbacks:

1. Known eligible rewrite Content-Length above the existing limit, detected before
   that response's header commit: enqueue a single bounded502 with Connection:close
   and zero Content-Length, then existing orderly end. Do not forward the original
   response header/body. Prior responses already completed in the existing FIFO;
   preserve byte ordering and prevent a later response after terminal rejection.
2. Chunked finite body whose cumulative buffered bytes first exceed the limit after
   its original header was committed: immediately log a bounded diagnostic and
   destroy the owned connection via existing cleanup; do not wait for another
   receive, append a second502, synthesize a successful zero chunk or stream raw
   buffered/unrewritten data. Release accumulated body/context resources once.

The second case is an intentional exception to literal 'always502' acceptance,
because a new status line cannot replace an already committed HTTP response.
Root must explicitly approve that exception and document client-visible aborted
response; absent approval keep #32 pending rather than silently claiming compliance.
Always502 for unknown chunked size would require delaying response commitment and
possibly new buffering/response-order machinery, which is not recommended here.
An already dead peer cannot be promised delivery even in the first case.

Apply this only to bodies selected for rewriting. Do not cap opaque #30 bypass or
no-body HEAD/204/304 based on advertised CL, and do not change memory/cache quotas
globally. The known-length threshold and streaming cumulative threshold reuse the
same existing constant. Preserve supported compression limit behavior rather than
claiming this fixes all compressed expansion risks. No separate response queue,
new full-response buffering, configurable bound or timer is needed.

Mandatory RED: actual oversized CL header receives exactly one502 and closes while
upstream remains open; chunked cumulative limit+1 receives an aborted/incomplete
response and owned terminal cleanup without any further upstream bytes. Include
limit/exact-limit+1, split chunks, no-body controls and non-rewrite bypass. Assert
no raw buffered content leaks, no new status after committed headers, once-only
owner cleanup and sibling survival. Use a bounded owned payload and existing16MiB
constant; reducing production limits or adding success retries is not authorized.

Initial source scope after policy approval: HttpHandler pre-header admission and
existing body-limit branch, dedicated tests/ledger32. If parser recursion/terminal
tail requires a new primitive, present actual RED and amended scope first. Do not
alter HttpPipe unknown-length completion, EOF input notification or pool drain.

## Scheduling and honest completion

These stages share HttpHandler and must be serial with approved #33 work, on a
fresh reviewed-main checkout. Preserve the held UI #29 worktree unchanged; no
cherry-picking or reimplementing its partial changes. #30 eligibility should land
before #32 so limits apply to the final rewrite decision; #33 header rejection
policy must remain intact when adding terminal response checks. Each issue needs
its own RED, independent reviews, integration and scoped closure evidence.
#28/#40 decisions, #29 platform hold and existing timing/denied-artifact boundaries
remain untouched. This document authorizes neither implementation nor execution.

## Root-approved API and policy freeze

- [x] Freeze #30 eligibility API. Status: `HttpUtil.canRewriteTextEncoding(header: HttpHeader): boolean`. Reuse case-insensitive `findHeaders`. Return true only for an unambiguous Content-Type charset (absent, or one UTF-8 value, case-insensitive/trimmed, ordinary matched quotes accepted) and Content-Encoding absent or exactly one trimmed, case-insensitive token from identity/gzip/deflate/br. Reject duplicate Content-Type/Content-Encoding fields, duplicate or empty/malformed/ambiguous charset parameters, unknown encoding, empty encoding fields and every multi-token encoding list by returning false. No exception-based normal validation flow.
- [x] Freeze #30 integration. Status: HttpHandler ANDs this result with the existing rewrite-enabled, text-MIME, has-body and explicit finite CL/chunked predicates before rewriting framing or committing headers. False keeps the original framing/encoding/type headers and exact body bytes through the existing raw path; unrelated explicit header policies remain unchanged. Existing codecs accept the approved case/whitespace forms, so do not normalize header output or add a new codec. Existing MIME semantics are not independently expanded.
- [x] Freeze #32 limit and terminal policy. Status: the existing16MiB limit counts buffered encoded body bytes delivered to the rewrite accumulator, not decoded expansion or HTTP chunk framing. Eligible known Content-Length strictly above that limit gets one complete502 and orderly end before original header commit. Eligible cumulative body limit+1 after header commit gets a bounded diagnostic and immediate owned abort; no second502, fake success terminator or raw-body fallback. Exact-limit remains eligible. No-body and #30 bypass responses are not newly capped.
- [x] Accept original-requirement exception explicitly. Status: root approves post-commit abort in place of literal always502. Issue closure must state that distinction and client-visible incomplete/aborted response; an already-dead or incomplete upstream cannot guarantee error-response delivery. Existing decompression-limit behavior remains a separate unchanged contract, not new permission for #32 raw fallback.
- [x] Resolve M1 interaction with #33. Status: a #32 terminal decision takes precedence over and cancels any pending duplicate-Host400. Do not complete an oversized response artificially to release400. After502 enqueue or post-commit abort, same-read body, parser completion/onMessageEnd and later response tail must never append400, another502 or a success status. Keep owner cleanup once and release body/FIFO/latches through existing terminal paths. No new response queue or pool/EOF primitive.
- [ ] Verify exact finite consumer outcomes after assignment and RED. Status: use actual Node HTTP decoding/end/complete for identity and single gzip/deflate/br positive replacement, and raw exact framed-byte comparisons for unsupported/multiple/non-UTF8 bypass. For committed overflow observe actual aborted/incomplete response and cleanup without another upstream write; for precommit rejection observe completed502/end. Include prior FIFO responses plus pending #33 rejection, same-read overflow body and later response, repeated callbacks/terminal, sibling survival, exact-limit/limit+1 and encoded-versus-expanded-limit distinction. No fixed sleep or fake-clock success.
- [ ] Independently review this policy amendment and assign implementation. Status: pending. #33 completes first; #30 then receives separate root assignment and observed RED before source; #32 follows reviewed #30 through its own gate. No #30/#32 source/test execution is authorized by this document.

This freeze supersedes the earlier proposal's undecided identity and post-header exception wording. Original comparison and rationale remain historical. Exact initial production ownership remains #30 HttpHandler eligibility plus this small HttpUtil helper, and #32 HttpHandler pre-header/body-terminal boundaries only. No new codecs, transcoder, producer, dependency, response queue, shared buffer policy, EOF/#29, pool or held UI worktree changes.

## Current #30 approval and assignment

- [x] Root approve policy/API and create assigned branch. Status: fix_supply15/process fix/epic61-http-body-encoding atc497ecd, exact helper/eligibility scope above.
- [x] Observe actual finite encoding RED and complete implementation/review gates. Status: completed3981; detailed original/fixer evidence in ledger30.
