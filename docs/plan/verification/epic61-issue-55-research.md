# Issue #55 — Truthful test evidence policy

Status: #55 complete; sourcef88d52a -> main61f60f16bb4ecbda62e226ed9e5371f39372e032 pushed/remote verified; CLOSED2026-09-08T11:42:01Z comment5584583045 Telegram3988(67/55); comment/guide-only correction, two independent reviews PASS and Jest config load exit0, no test-count claim. Original research/proposed-pending text is historical; current active status/counts SSOT is execution plan.
Original issue: https://github.com/ice3x2/TTTGate/issues/55.

- [x] Compare original #55 and blanket NO-MOCK declaration with actual tests. Status: mismatch confirmed below.
- [x] Distinguish test evidence types and retain mandatory real end-to-end gates. Status: proposed policy correction below.
- [x] Approve bounded policy-correction path. Status: root approved exact three-file scope; final authored policy documents still require independent reviews.
- [x] Correct declaration/guide and independently verify/integrate. Status: completed; exact execution/review/closure evidence in issue ledger.

## Direct evidence

jest.config.ts:4 declares only real-environment tests (NO-MOCK), but
test/unit/server/TunnelServer.keepalive.test.ts replaces TCPServer.create with an
empty object and asserts arguments. test/unit/client/TunnelClient.keepalive.test.ts
replaces SocketHandler.connect. test/unit/server/http/HttpHandler.rewrite.test.ts
uses createMockSocketHandler and injects a decompression-limit exception. These
remain valid narrow unit contracts; none proves native listener settings, actual
socket delivery or real decompression resource failure merely by passing.

Recent component tests provide separate real evidence: keepalive-options.test.ts
observes/delegates the native options factory while real control/data connections
authenticate and echo. http-body-encoding.test.ts uses actual owned duplex sockets,
Node HTTP completion and real supported codec transforms. Client lifecycle tests
use real scheduled replacement and endpoint greetings, with disclosed callback
holds/replays for race conditions. Configuration rollback tests delegate normal fs
operations but inject selected failures. Evidence ledgers already distinguish
these boundaries instead of claiming every fixture is mock-free.

## Recommended minimum policy text and scope

Replace only the blanket jest.config.ts comment with a short pointer to a dedicated
test-evidence policy document. State that unit substitutes are permitted for their
declared contracts, while transport/security/lifecycle acceptance needs actual
consumer/integration evidence and cannot be discharged solely by substitutes.
The original #55 explicitly allows policy correction as an alternative to rewriting
the cited tests. Do not remove useful tests, rename mocks as real or fabricate new
RED for a comment/document-only change.

Initial proposed writes: jest.config.ts comment only, a small test-evidence guide,
ledger55, and only demonstrably false descriptions adjacent to the three cited
tests if any exist. Do not rewrite historical execution receipts or broad archived
plans to pretend they followed a newly clarified policy. Add a clearly dated
current-policy reference where necessary; preserve past failures and limitations.
No Jest runtime options, coverage thresholds, testMatch, package commands or source
changes. Search for other current blanket policy statements during approved work,
and report any additional exact paths before widening edits.

Use explicit evidence descriptions:

| Kind | Permitted claim | Required limit |
| --- | --- | --- |
| Pure/unit stub or mock | Branch behavior, argument propagation, deterministic return/error contract | Not native transport, TLS establishment, actual persistence or end-to-end behavior |
| Delegating observer | Actual underlying call/event/output was observed when the original implementation ran | Identify wrapper/spy; do not call replaced return values or counters real operations |
| Fault injection | Recovery at the explicitly injected boundary with real unaffected components | Not proof the OS naturally produced that error or the hypothetical incident's cause |
| Actual owned integration/E2E | Observed concrete peer handshake, byte delivery, persistence, lifecycle and completion | Name the exercised path and assertions; setup/helper calls alone are insufficient |
| Mutation sensitivity | Assertions reject the deliberately weakened/broken controlled case | Not evidence of a production defect when original behavior already passes |

Reserve mock-free claims for a bounded tested path with no replaced behavior
standing in for that claimed effect. A delegating observer may preserve native
behavior, but describe it explicitly rather than applying a suite-wide label.
Mixed tests may provide real network evidence and injected-error evidence together;
report both honestly. Timing/throughput/blackhole/security claims require their own
actual measurement or contract, never inference from argument assertions alone.

## Hard acceptance gates remain

The user-mandated test-first rule remains: behavior changes require valid observed
RED before source, no test-after justification; policy documentation changes do
not authorize weakening or skipping assertions. Independent reviewers evaluate
original requirements/diff/evidence; another fixer resolves findings. Distinguish
setup/fixture failures from behavior RED and preserve all failed-run receipts.

#48 retry-free roundtrip, #47 real HTTP/TLS E2E, #54 multiple clients and #53 large
transfer/cache spill remain separate required actual-consumer milestones. #55
policy consistency does not complete them. #52 whole-source coverage and #58
requirement traceability also remain separate: honest uncovered/partial labels
are required and unit mocks cannot be counted as missing E2E evidence. Do not
lower thresholds, narrow source scope or claim code coverage proves integration.

## Verification plan after authorization

Read original #55 against final comment/guide and cited test labels. Independently
confirm test inventories/behavioral assertions remain unchanged and declaration
now matches reality. No broad rerun is required for documentation-only edits;
if actual test logic changes emerge, stop and seek a separate scoped TDD plan.
No #29 EOF, denied artifact deletion, timing benchmark or process operation is
needed. Never terminate node.exe by name; only current-task processes with verified
PID, command line and ownership may be terminated under AGENTS.md. Root controls
publication, closure and per-issue notification after independent review.
