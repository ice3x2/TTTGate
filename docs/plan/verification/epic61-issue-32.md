# Issue #32 — Finite rewrite body limit

Status: minimum implementation/nine focused GREEN/105regression GREEN/forced build complete; frozen for two independent reviews. Owner fix_supply15, process branch `fix/epic61-http-body-limit`, base `1b329da`.
Root-approved body research: only HttpHandler eligible precommit/body-terminal hunks and dedicated tests/ledger. Existing16MiB counts encoded accumulator bytes. Known eligible CL>limit gets one502/CL0/Connectionclose before original header; after committed chunked cumulative>limit abort immediately, no second status/raw fallback/success terminator. This postcommit abort is the explicit root-approved exception to original always502. It cancels #33 pending400. #30 codec eligibility/decompressionlimit/EOF29/pool untouched.

- [x] Read policy and reuse. Status: existing request FIFO, header-reset guard, SocketHandler end/destroy and owned duplex fixture reused.
- [x] Observe real finite boundary/completion/abort RED. Status: four corrected actual failures/four controls plus separate502failure RED before source.
- [x] Minimum terminal repair and focused regression/build. Status:9focused then105regression PASS/build0.
- [ ] Two independent reviews. Status: pending, no commit.

RED command `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-body-limit.test.ts`. Initial51be00 exit1,4failed/4passed6.235s included two fixture TypeErrors (calling a constant bad header as a function); those two are not behavior RED. Corrected test with unchanged production2040 exited1 naturally,4failed/4passed10.377s: known CL never completes502, committed overflow never aborts, and both pending400 interactions never terminate. Exact-limit CL/chunked and HEAD/opaque bypass controls pass. Separate preimplementation send-failure/sibling contract490bb3 failed1/8filtered2.618s because no502/terminal occurred. Fault injection is explicitly exact502 write callback false, not an OS-write failure claim. All failures precede production edits and are retained.

Minimum HttpHandler-only change: eligible known CL>16MiB sets the existing terminal rejection latch, cancels pending400/FIFO, resets the existing response parser before its header callback returns, queues502 and native end. Existing encoded accumulator overflow immediately destroys. onMessageEnd returns after terminal rejection/end to prevent same-read follow-up responses. Existing codec eligibility and decompress/compress functions are untouched.

Focused1ef8e5 natural exit0,9tests2.988seconds. Actual Node HTTP observes completed502/end for precommit and aborted/incomplete200 with zero body for committed overflow; upstream writes no further triggering bytes or FIN. Exact16MiB CL/chunked completes;limit+1 rejects; priorFIFO and pending400/same-write later response never append another status. HEAD and zstd opaque bodies are not newly capped. Exact502 callback fault injection yields one cleanup/no response while a separate actual owned sibling returnsOK. It is not an actual OS write-fault claim.

Regression e095af command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-body-limit.test.ts test/component/http-body-encoding.test.ts test/component/http-duplicate-host.test.ts test/component/http-host-header.test.ts test/component/http-directions.test.ts test/component/http-chunk-boundary.test.ts test/unit/server/http/HttpHandler.rewrite.test.ts test/unit/server/http/HttpUtil.branches.test.ts test/security/req-05-smuggling.test.ts`.
Nine suites105testsPASS5.956seconds natural0. Includes actual #30codec/charset completion,31/33header/rejection,finitechunk/duplex and existing decompression-limit behavior. `npm run build -- --force`c389c9 exited0. No whole-suite/EOF/#29/expansion-limit repair claim; encoded16MiB and existing decoded expansion policy remain distinct.

Threefiles frozen: HttpHandler, dedicatedhttp-body-limit.test.ts and this ledger. No live handles or commit. Proposed exact title: `fix: 본문 재작성 한도 초과 시 즉시 응답 종료`. Postcommit abort is the explicit root-approved always502 exception and must be repeated in closure evidence.

## Independent M1/M2 correction

- [x] Preserve original candidate and perform baseline RED. Status: new owned evidence root C:/Users/beom/AppData/Local/Temp/tttgate-32-fix-3e559c8ab9c3491190cc2188fb539b07 contains original HttpHandler.ts, SHA2565A9F2C28C8D8C45AD6E339B626C597CEA66B0B303F4FB7008AA3496D3684AE71 (1c61a7). Only that task file was restored to branchHEAD; no other source/worktree was restored. New actual control ab5394 failed1/9filtered3.006s naturally because baseline never produced502, not because ingress guard alone failed.
- [x] Reobserve M1 against identical author candidate. Status: restored saved file;7c46dd confirms identical SHA above. Actual502 was written to the real socket while its callback and end were explicitly held. Two subsequent real requests reached upstream (110additional bytes), so unchanged candidate failed1/9filtered1.406s before the new source edit. This is the specific ingress RED; the baseline's missing502 failure is distinct.
- [x] Minimum M1 correction. Status: ingress checks existing _rejectionSent in addition to _inputRejected. No new flag, parser, EOF, pool or codec edits. It blocks later requests during terminal502 just as existing400 rejection blocks them; local terminal release/abort behavior remains unchanged.
- [x] M2 completion barrier. Status: preserve independent review's8PASS/1FAIL3.484s as historical timing evidence. Replace the interaction cases' client.destroyed-only wait with client.destroyed AND ownerCalls===1 before asserting server-side cleanup. No assertion removal, timeout inflation or fixed-sleep success.
- [x] Focused/related/build. Status:4c1854 focused10PASS3.577s naturally;31747/8e5721 related6suites73PASS5.995s and sequential forced build exited0 naturally. Existing npm always-auth warnings remain. Both executions are separate, not a synthetic83-test result.
- [ ] Two independent rereviews. Status: fixer review_cert_conflict changed only HttpHandler ingress condition, dedicated test and this ledger; all three frozen, root commit pending.

Selected RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-body-limit.test.ts --testNamePattern='precommit502 blocks'`.
Related command: same runner without name filter for http-body-limit, http-body-encoding, http-duplicate-host, http-directions, http-chunk-boundary and unit/server/http/HttpHandler.rewrite tests.

The added test delegates native502 writing, records its actual bytes at the client, explicitly delays callback/end, then observes both repeated requests consumed by the actual client-side receive handler while no new request is forwarded upstream. A disclosed forward observer permits the RED path to await actual upstream arrival before the exact-byte assertion. After release it verifies actual peer termination, owner1, FIFO/latches0, no second response and repeated destroy harmless. The callback/end hold is a controlled fixture, not a reproduced OS backpressure/write failure. Existing precommit502,400 cancellation, postcommit abort, bypass and limit controls remain intact. No production outside HttpHandler changed and original author evidence remains historical.
## Root-confirmed final independent rereviews

- [x] Resolve independent M1/M2 findings. Status: root confirmed review_wave0 and fix_lint_diagnostics both returned PASS for the final correction, including exact-title PASS. These are reviews by two other agents, not self-verification by fixer review_cert_conflict.
- [x] Independent selected verification. Status: review_wave0 additionally executed ten tests PASS in3.802seconds, natural exit0. The other reviewer performed no additional execution. This receipt is separate from the fixer's earlier10/73-test runs.
- [ ] Root commit/integration. Status: pending; source/tests remain frozen and unchanged by this ledger update.

Exact title: `fix: 본문 재작성 한도 초과 시 즉시 응답 종료`.
User process safety rule remains binding: never terminate node.exe by process name; any task-owned termination requires current PID, command line and ownership verification. This ledger update performed no process termination.