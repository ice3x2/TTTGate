# Independent HTTP header and framed-body work research

Status: independent design PASS and root approved only #31; owner review_cert_conflict, branch fix/epic61-host-header, base35a5d5f. Exact scope: HttpHandler.replaceHostInHeader Host-selection hunk plus dedicated test/ledger31 only; held UI/EOF/pool remains untouched. Original research below is historical; current progress SSOT is execution plan.

- [x] Compare original issues and integrated source. Status: findings below.
- [x] Inspect unintegrated #29 write overlap without modifying it. Status: UI worktree still has HttpHandler.ts and HttpPipe.ts changes; no pool change in its tracked diff.
- [ ] Independently review a separately bounded header-only lane. Status: proposed #31 first; no assignment authorized here.
- [ ] Freeze exact #33 rejection/ordering behavior before RED. Status: additional response-order decision needed below.
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

## #33: independent validation, explicit response ordering required

HttpPipe.parseHeader/parseHeaderList and existing CL/TE checks do not reject
multiple request Host fields. Count case-insensitive Host occurrences before
the header callback can forward anything; identical and differing duplicates
both need rejection. Preserve response-header behavior and existing single-Host
compatibility. Missing Host is not this issue's requested new policy.

However, original #33 explicitly requests HTTP 400. Existing parser errors destroy
the handler and provide no status-response mechanism. Sending a synthetic 400
while an earlier pipelined response is outstanding would violate response order.
Before implementation root must freeze first-request 400 and pending-response
behavior; do not silently substitute connection close for the full acceptance or
introduce an unreviewed response queue. Proposed initial write set is HttpPipe
request-header checks plus the minimum HttpHandler rejection response boundary,
dedicated tests/ledger, subject to this design approval. RED must show zero bytes
of the duplicate request reach upstream, completed rejection where promised,
and unaffected existing CL/TE/CRLF and ordered prior-response behavior. This
constraint is independent of #29 but needs its own bounded API decision.

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
- [ ] Observe actual RED before production changes and complete independent per-issue gates. Status: assigned; no successor approval follows automatically. Preserve all original state/ownership/security/test constraints above.
