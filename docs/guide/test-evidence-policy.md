# Test evidence policy

Current policy, 2026-09-08. Tests must state what they demonstrate and which behavior they replace or control. Unit doubles and pure algorithm tests are permitted for their stated contracts. Transport, security and lifecycle acceptance still requires actual owned consumer/integration evidence; substituted behavior alone cannot satisfy those requirements.

| Test technique | Supported claim | Evidence limit |
| --- | --- | --- |
| Pure algorithm test | Concrete input/output, parser or state-transition contract using the actual algorithm | Does not establish socket, TLS, persistence or end-to-end behavior |
| Unit stub/mock | Arguments, branch selection, returned result or error handling at the declared boundary | A fake TCPServer or socket does not prove native connection settings or byte delivery |
| Delegating observer/spy | The original implementation ran and its actual call, event or output was observed | Identify the observer and what it forwards; a substituted return value is not a real operation |
| Fault injection | Recovery from the specific injected failure, with other real components identified | Does not prove the OS naturally produced the error or explain a historical incident |
| Actual owned integration/E2E | Specific peer handshake, delivered bytes, persisted bytes, resource state and completion observed through real consumers | Name the exercised path and assertions; creating a harness or calling setup is insufficient |
| Mutation sensitivity | Assertions reject the deliberately broken controlled case | A mutant failure is not a production defect or production RED when the original already passes |

For example, `TunnelServer.keepalive.test.ts` replaces TCPServer.create and proves argument propagation. A separate real control/data connection test is needed to support native keepalive application. The rewrite guardrail unit injects a decompression-limit error; it demonstrates the response to that error, not an actual decompression resource failure. Actual Node HTTP completion plus decoded body equality in the component tests supplies a different kind of evidence.

A mixed test may combine real sockets with a held callback or injected filesystem error. Record both parts rather than label the whole suite “mock-free.” Use that label only for a precisely bounded path whose claimed effects are not replaced. State whether bytes were actually received, a write was merely requested, a callback was held, a peer completed its response, or an assertion inspected only metadata. Native keepalive timing, blackhole detection, throughput and security claims require their own relevant observations; argument checks cannot stand in for them.

Behavior changes require a valid observed failing test before implementation, followed by minimum repair and regression checks. A setup/import/fixture failure is not behavior RED. Preserve failed runs and distinguish them from later executions. A documentation-only policy correction does not require a fabricated RED and does not authorize weakening tests, skipping assertions or rewriting historical evidence. Existing plans and receipts retain their original wording and context; this document states the current policy.

Independent reviewers compare original requirements, changes and factual evidence. Another fixer addresses findings, followed by independent rereview. An author observing a command's exit code or test count is not an independent acceptance review. Describe fault/mutation boundaries to reviewers without presenting a desired conclusion as evidence.

The following gates remain separate and mandatory:

- #48: retry-free roundtrip assertions. Retries must not conceal dropped data or turn an unexplained failure into success.
- #47: real HTTP/TLS end-to-end verification.
- #54: multiple-client behavior through actual consumers.
- #53: large transfer and actual cache-spill behavior.
- #52: whole-source coverage with honest uncovered/partial labels. Coverage percentages do not prove integration and this policy changes no thresholds or source scope.
- #58: requirement-to-test traceability. Unit evidence must not be substituted for a missing end-to-end obligation.

Use owned loopback peers, temporary roots and bounded test processes. Restore observers and fault controls, clean only verified task-owned resources, and preserve failure evidence. Never terminate Node processes by name; any termination requires the exact current-task PID, current command line and ownership verification. This policy grants no permission to operate on denied artifact paths or bypass held work. EOF/#29, benchmark and other issue-specific execution restrictions remain in effect.
