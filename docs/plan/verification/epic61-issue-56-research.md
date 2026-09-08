# Issue #56 — Finite rewrite positive assertion audit

Status: #56 evidence-only closure complete3984; original independent selected6PASS and audits remain separate evidence. Earlier approval/implementation-pending prose is historical; current counts/active state SSOT is execution plan.

- [x] Read original #56 and current HTTP tests. Status: exact assertions mapped below.
- [x] Distinguish positive rewrite evidence from bypass/line coverage. Status: original finite positive requirement already has explicit coverage added by #30; no new runtime repair established.
- [x] Identify remaining test-matrix gaps without expanding original acceptance. Status: optional bounded additions below.
- [x] Independent audit review and root decide evidence-only closure versus approved test supplement. Status: two independent audits PASS, root selected evidence-only resolution; no new code/test/RED required.
- [x] Documentation integration and root closure/notification. Status: completed3984; no new source/test/RED.

## Original requirement and current satisfaction

[Issue #56](https://github.com/ice3x2/TTTGate/issues/56) asks for a normal within-limit body assertion proving hostname replacement, because the old rewrite test only covered bypass. The original cited `test/unit/server/http/HttpHandler.rewrite.test.ts:100-146` still does only that: its mocked decompression-limit error expects internal.example present and public.example absent. This is intentionally a negative/bypass contract, not normal rewrite evidence and not a real socket/decompression-limit reproduction.

The later `test/component/http-body-encoding.test.ts` supplies the missing positive contract with actual owned sockets and Node's HTTP parser:

| Exact current anchor | What it explicitly proves | Limit |
|---|---|---|
| Lines6,17-38 | Input is `http://internal.example/path`; decoded response must equal exactly `http://public.example/path`. Equality excludes the original internal hostname from this tested body, even without a redundant not.toContain assertion. | One HTTP URL occurrence, ASCII hostname/path, text/plain. No claim about all URL forms or every MIME. |
| Lines21-25,35 | Promise resolves on actual response `end`, and `complete` must be true. Errors/aborted reject. | Finite CL/chunked responses only; no FIN-based unknown-length proof. |
| Lines57-58 | Real identity/gzip/deflate/br input compression and output decoding, mixed-case/whitespace coding and quoted mixed-case UTF-8, all with exact rewritten-body equality. | These codec-positive calls use input Content-Length. |
| Lines60-61 | Absent charset and absent coding positive rewrite with both input CL and chunked. | Chunked input is uncompressed in this positive matrix. |
| Lines45-49 | Second request returns actual `OK`/complete=true, pending FIFO empties, upstream remains open. | Second response is application/octet-stream, so this checks context/lifecycle, not a second hostname replacement. |
| Lines80-116 | An independent finite sibling runs the same positive exchange while an opaque response is held incomplete, then the opaque response completes byte-exact. | Sibling proof is not every codec/framing cross-product. |

These are assertions on actual transformed bytes and finite HTTP completion, not hit counts or a claim inferred from calling the implementation. A regression that bypasses every normal replacement would fail the exact public-URL equality. Therefore the literal #56 finite normal-path gap has already been filled by integrated #30 tests; this audit does not require rewriting the old bypass test or duplicating the same six positive cases solely under an issue56 filename. Existing #30 execution receipts are in `epic61-issue-30.md`; this read-only audit makes no new test-PASS claim.

## Related suites: useful boundaries, not substitute coverage

- `http-host-header.test.ts` (#31) asserts exact request/response header selection and preserves unrelated values. Its bodies are `OK`; it is not a text-body hostname replacement test.
- `http-duplicate-host.test.ts`, case `finite rewritten response finishes before400`, asserts public URL occurrence and a terminal chunk before ordered400. This is useful positive ordering evidence but its substring assertion alone does not prove every internal occurrence disappeared or Node decoded completion. #30 exact equality is stronger for the simple body.
- `http-body-limit.test.ts` (#32), exact16MiB CL/chunked cases, asserts status/end/complete/byte count for an all-A body; it cannot demonstrate hostname substitution because its input contains no hostname. Oversized502/abort and bypass/HEAD controls prove different contracts.
- `http-directions.test.ts` (#11) proves request/response framing, HEAD and upgrade bytes; it is not a codec/body replacement positive matrix.
- `http-chunk-boundary.test.ts` (#12) proves exact raw chunk boundaries and a Node keep-alive decoded `hello` response with trailers/complete/upstream-open. It does not contain an internal hostname and must not be counted as positive rewrite coverage.

## Concrete optional test-only gaps

These gaps exist in the inspected positive matrix, but are broader than the original request for a normal within-limit assertion. Root should decide whether to strengthen them before #56 closure rather than silently turn them into required runtime scope:

1. **Compressed chunked input:** gzip/deflate/br positives currently cover CL only. Parameterize the existing positive call over CL/chunked; keep real output decompression, exact public-body equality, Node end/complete and next context. No codec or HttpPipe changes are justified by this audit.
2. **Non-ASCII UTF-8 and multiple occurrences:** current positive body is one ASCII URL. A small UTF-8 body with Korean text and two supported internal URL occurrences can require exact expected text and no internal hostname in the decoded body. This tests preservation plus repeated replacement without claiming unsupported charset support. Read current modifyUrlsInBody behavior before choosing URL syntax; an unexpected functional failure requires its own root scope decision.
3. **Rewrite on the second context:** current next-context body is opaque `OK`. Two successive rewrite-enabled finite responses using distinct Host contexts would explicitly check per-request host capture for body output, if desired. Reuse existing FIFO/duplex harness and compare each decoded result; do not add another HTTP parser or generic fixture framework.

No additional production change is proposed. If root authorizes a test supplement, prefer a narrow extension of `http-body-encoding.test.ts` plus ledger56, preserving existing negative tests and execution history. Any deterministic behavior change discovered must get actual RED before scoped implementation; a new test passing existing source is coverage strengthening, not a fabricated production RED. Tests must use owned loopback endpoints and clean owned resources, with only their explicit paths selected.

## Exclusions and process safety

Close-delimited/unknown-length body completion remains the held #29 boundary. Neither the existing positives nor these optional additions prove EOF consumer correctness, and no held UI/source/pool changes are proposed. No timing/benchmark, denied `test/.tmp-req04-lint` execution/deletion/move, dependency mutation or process termination occurred. If a future test requires termination, only its exact owned PID with current command-line and ownership verification is eligible; never terminate node processes by name. Current epic completion counts and assignments remain solely in the main execution plan.
