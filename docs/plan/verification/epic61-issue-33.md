# Issue33 duplicate Host

## Separate test-only peer/write failure coverage

Root assigned review_wave0 as an independent test-only fixer for fix_supply15's
missing peer/write failure coverage finding. Original production author remains
review_cert_conflict. Only http-duplicate-host.test.ts and this ledger changed;
both production files remain unchanged.

The first new case sends a valid pending request and duplicate request through
real owned sockets, confirms one prior FIFO item and no response, then closes
the actual client peer. It checks one owner termination, upstream termination,
cleared FIFO/input/rejection state and no late400 after a disclosed direct late
finite-response callback. The second injects false only at the existing raw
sendData callback for the exact400 bytes. It proves immediate owned destruction,
one cleanup, zero upstream/response bytes and no repeated emission after late
callback/repeated destroy. This is explicit callback fault injection, not a
reproduced OS write failure. Its delegate is restored in finally.

Command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-duplicate-host.test.ts`.
Execution77c76e exited0 naturally: one suite/ten tests PASS,1.111seconds. This is
coverage strengthening of existing error paths, not a new production RED. Original
RED/setup history below remains intact. Test/ledger are frozen for review_cert_conflict
and fix_supply15 independent rereviews. No EOF/pool/held UI source was touched.

Status: implementation/regressions/build complete, frozen for two independent reviews; root assigned process fix/epic61-duplicate-host base4b5015f; main assignment recorded before source. Owner review_cert_conflict.

- [x] Original33/research and reuse read. Status: existing FIFO, HttpUtil.findHeaders, duplex fixture and native socket write/end reused.
- [x] Actual RED. Status: corrected tests reobserved against both restored baseline files, receipts below.
- [x] Minimal two-file implementation. Status: header rejection and ordered400 only.
- [ ] Two reviews. Status: regressions/build PASS below, independent reviews pending, no commit.

Frozen API: HttpPipe.onRequestRejected(reason:'duplicate-host') once before header callback, stop request/body/tail. HttpHandler separate inputReject/400sent, all existing FIFO final responses before complete400/end,1xx nonconsume, no response tail after400. Accepted101 terminates before raw switch; dead/incomplete prior upstream cannot guarantee400. No EOF/pool/heldUI/new response queue/unrelated policy changes.


## Exact execution and limits

Initial run73534/163843 failed7 in12.793s, but its parser test used an invalid default import. First implementation attempt29349/095b8a failed7 in8.85s: missing HttpUtil import caused actual consumers to close, and the test import was still wrong. Neither setup failure is accepted as valid parser RED. Both production files were fully restored to this branch baseline (never held UI). Correcting the named test import then rerunning61380/bd17c2 produced7failed12.773s before rewriting production. Original first-request/finite/101 failures and parser callback failure were preserved.

The next implementation run6b2d48 passed6/failed1 in2.813s: the chunked fixture incorrectly waited for partial chunk data that this existing parser only emits when a complete chunk arrives. Again both task production files were restored, test barrier moved to a complete data chunk with terminal zero chunk still pending, and final corrected baseline36274/126f85 failed7 in12.762s. Only corrected baseline failures establish the complete RED set. Reapplying the minimum candidate then5989e7 passed7 in0.707s. This preserves test-first evidence rather than justifying source from setup failures.

Additional cleanup assertions before their source change:385719 failed2/passed6 in0.889s because HttpHandler latches remained true after actual terminal owner cleanup. Clearing the two latches in release followed this observed RED. No other lifecycle/EOF behavior was changed.

Related command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-duplicate-host.test.ts test/component/http-host-header.test.ts test/component/http-directions.test.ts test/component/http-chunk-boundary.test.ts test/unit/server/http/HttpHandler.rewrite.test.ts test/unit/server/http/HttpUtil.branches.test.ts test/security/req-05-smuggling.test.ts`.
683fc6:7suites66testsPASS3.083s. Sequential forced build completed80486e naturalexit0; existing npm always-auth warnings only. Later test-only strengthening added100 alongside103 and a split-header parser prefix control;511895 selected8PASS1.303s natural0, no new production RED claim and no production change afterward.

Actual duplex evidence includes identical/different mixed-case duplicates, no request/body/tail upstream, complete400 before native EOF, two prior CL/chunked final responses in FIFO order,100/103 nonconsume, no unsolicited response tail after400, finite rewritten body before400, and101 termination before raw response. Standalone parser contract additionally proves callback once and repeated/split input drop; missing request Host and duplicate response Host remain accepted as before. Existing regression covers128 cap, upgrade, HEAD, finite chunk tails and CL/TE smuggling rejection. No close-delimited EOF, pool, generic timeout, queue redesign, missing-Host policy or full-suite claim.

Frozen write set: src/server/http/HttpPipe.ts, src/server/http/HttpHandler.ts, test/component/http-duplicate-host.test.ts and this ledger. Existing fixture unchanged. Root receives separate main operational document deltas for independent review. No commit. Proposed exact title: `fix: 중복 Host 요청을 응답 순서에 맞춰 거부`.

## Final independent review of test-only M1 correction

- [x] Resolve M1 peer/write failure coverage. Status: review_wave0 added test/ledger evidence only; existing production remained unchanged. Actual peer closure and explicit exact400 callback-failure injection are distinct from reproduced OS write failure; no new production RED is claimed.
- [x] Two final independent rereviews. Status: root confirmed review_cert_conflict and fix_supply15 both returned PASS with zero Critical/High/Medium/Low findings and exact-title PASS. Neither reviewer executed additional tests. These are independent reviews of review_wave0's test-only correction, not a new self-approval of review_cert_conflict's original production implementation.
- [ ] Root commit/integration. Status: pending; source/tests frozen, no commit authorized to this agent.

Exact title: `fix: 중복 Host 요청을 응답 순서에 맞춰 거부`.