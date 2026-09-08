# Issue #54 — Explicit multiple-client harness

Status: minimum helper implemented, related18GREEN and additional focused controls passed; frozen for two independent reviews. Owner fix_supply15/listeners branch `fix/epic61-multi-client-harness`, base `eb546cd`.
Root-approved exact API in main epic61-e2e-research.md. Only test/helpers/tunnelHarness.ts, dedicated multi-client test/fixture and this ledger writable; network48/production read-only.

- [x] Read original54/current48 helper/reuse/API. Status: single-default fields preserved; explicit client specs and detached mappings, per-ID stop/readiness/send.
- [x] Actual identity/one-shot/isolation/partial-failure RED. Status:9failed/1control before helper changes, receipts below.
- [x] Minimum harness implementation and focused legacy regression. Status:18relatedPASS,10focusedPASS and strengthened routing1PASS as separate commands.
- [ ] Two independent reviews/integration. Status: pending; no commit.

Explicit multi requires send ID even after one remains; unknown/stopped/missing reject before connect. Legacy or explicit singleton omits ID safely. Multi fixture rejects conflicting old client options/trusted-list/tunnel-list/ACL overrides before allocation. Actual authenticated ID set readiness, distinct endpoint/ACL mappings and local stop cannot reset sibling. Setup/start registers resources immediately and cleans failed partial work; natural exit and original error preserved. Existing one-shot full-FIN helpers unchanged. Same-member overlapping finite exchanges are not supported. No #47/#53/#18/#28/#29/#40 policy change.

RED6048: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/multi-client-harness.test.ts`;9failed/1passed28.624seconds,naturalexit1 before helper changes. Requested A/B actual authentication produced baseline-client-id; invalid specs unexpectedly allocated/returned harnesses; heldB never reached its requested endpoint; second-client failure never occurred because only one started; factory failure left root. Existing explicit-singleton-shaped invocation happened to pass old single behavior, not evidence that old API supported metadata mapping. Failure fixtures delegate actual endpoint/client creation and inject only the declared second start/certificate-load errors; original failure objects are checked.

Minimum helper-only implementation registers per-spec endpoints/clients, identity-specific predicate readiness, explicit target selection, local stop and remaining-member restart. Existing single defaults/return aliases and network48 full-FIN path retained. Setup/start/restart failures clean resources and preserve original error (aggregate cleanup failures if necessary). Returned client mapping is detached. Shared runtime is initialized/cleaned once, not per client. Factory fault test finalizer was made conditional on a still-existing root to avoid closing already-cleaned endpoints twice; no helper behavior change was driven by that test-only cleanup correction.

91672 command adds `test/component/roundtrip-once.test.ts test/e2e/tunnel/baseline-tunnel.test.ts` to the new suite. Running, not yet PASS. No production/network source changed. Proposed exact title: `test: 다중 클라이언트의 독립 터널 경로 검증`.

91672 completed naturally exit0: three suites18tests23.499seconds. Then test-only delegated checks require invalid target selection to make zero once-helper calls and actual created net.Server listeners to be closed on factory failure. Focused81147 natural0,10PASS12.021seconds. Finally the A/B routing case was strengthened with two independent real finite endpoints recording complete request bytes: A receives exactly first-A once, B exactly first-B once; no cross-routing inferred from echoed results alone. Selected0c39c4 natural0,1PASS9filtered3.451seconds. These are coverage additions, not new production RED; no helper logic changed after initial GREEN (only explicit readonly parameter typing aligns with the approved signature).

Held B case observes nonzero actual endpoint request bytes and retains B's real control/data handler identities while A is stopped; its peer releases one FIN response and receives one request. It does not claim cache/queue-pressure coverage. A remains absent after whole server restart and B's new exchange succeeds through native reconnect. Partial second-client-start fault delegates first actual start, records stop/root cleanup, and preserves the identical injected Error. Factory cert-load fault occurs after real endpoint creation; actual listener.listening=false and root absence are asserted before fallback test cleanup. Both are declared fault boundaries, not natural OS failures. Existing single default/singleton/48 firstbad-extra fullFIN tests passed.

Scope3files frozen: tunnelHarness.ts, multi-client-harness.test.ts, this ledger. network48, runtime/production unchanged. No live process handles, benchmark, denied artifact or process-name termination. Root reviews/assigns successors separately; no commit.

## Independent held-request framing correction

Root assigned review_wave0 test-only fixer for the first-data-chunk assumption in the held B endpoint. Extracted that existing endpoint receive behavior into a local test helper and added an actual split-prefix socket contract before correcting it. Receipt9bc81e naturally exited1: oneFAIL/10filtered0.535seconds. A real three-byte prefix was observed before the remainder was written, but old once(data) had already made release available; this is fixture-contract RED, not production/harness RED.

The local helper now accumulates bytes until expected request length, completes once with the entire captured Buffer and provides an idempotent single release. The held B test uses the same helper, checks full request bytes and count1, and retains all original A-stop/B-handler/FIN assertions. No fixed sleep or one-write/one-segment assumption; original ten cases remain plus the split helper contract.

Full selected-suite command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/multi-client-harness.test.ts. Owned handle41885 exited0 naturally: one suite/11tests PASS11.752seconds. Only this ledger and dedicated test changed; harness/network/production are unchanged. Frozen for review_cert_conflict and fix_lint_diagnostics rereviews; root commit/integration pending.

## Independent partial-startup evidence correction

Root assigned review_wave0 to correct the nonexistent tunnelServer.isListening assertion after review_cert_conflict identified its vacuous negative check. Source inspection confirmed no such property. A temporary type assertion exposed it directly: selected second-client-start case463b19 exited1 naturally, oneFAIL/10filtered3.258seconds, expected boolean/actual undefined. This is a test-evidence contract failure, not a production cleanup failure.

The final test removes that property entirely. It delegates actual net.Server.listen and records created native listeners; delegates the first actual TTTClient.start and captures its real control net.Socket before the deliberately failing second start. After the identical injected Error surfaces, it asserts first client stopped, exactly one captured control socket destroyed, a nonempty native-listener set all listening=false and root removed. Delegates restore in finally and actual harness cleanup remains unchanged. No production/harness/network change.

Full dedicated command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/multi-client-harness.test.ts. Owned63410 exited0 naturally: one suite/11tests PASS11.624seconds. Prior first-chunk framing correction/RED remains preserved above. Test and ledger frozen for review_cert_conflict and fix_lint_diagnostics independent rereviews; this author does not self-approve the correction.


## Final independent reviews

- [x] Final code, evidence and exact-title reviews. Status: review_cert_conflict and fix_lint_diagnostics both PASS with zero remaining findings after the separate held-request and partial-startup test-only corrections. Root commit/integration pending. Historical pending statements above describe earlier checkpoints.
