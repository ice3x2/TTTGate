# Issue #53 — Actual large tunnel cache transfer

Status: complete; source18e08b2 -> main1e7595b integrated, root whole-file9PASS13.946seconds natural exit0, build40e4c2 PASS and push a2f2d8 verified. GitHub CLOSED2026-09-08T16:27:10Z comment5588442525; Telegram3998(68/62). Original two failures, original after73 normal and corrected-fixture normal receipts remain preserved below; no production/harness changes.

- [x] Read approved root contract and reuse actual harness/network/cache APIs. Status: source inspected before test work; network/harness/production remain read-only.
- [x] Observe actual corrupt/extra endpoint sensitivity failures. Status:76abe9 exited1 naturally, two actual endpoint mismatch failures0.349s before normal case; corrupt23/23 bytes hash mismatch and extra24/23 length mismatch. Tests now require these expected verifier rejections; not production RED.
- [x] Complete fixed normal transfer acceptance. Status: after73 original normal1PASS13.628/outer15.133 and separately corrected-fixture normal1PASS15.185/outer17.006; prior two failures retained, same fixed parameters.
- [x] Independent review. Status: review_large_transfer full rereview and fix_lint_diagnostics separate-fixer delta review PASS, no remaining Critical/High/Medium/Low findings. Root integration, whole-file regression, push, closure and notification completed; receipt below.

Frozen parameters:32MiB each direction,64KiB application writes, local server/client
buffers16MiB each; actual SocketHandler.GlobalMemCacheLimit setter1048576bytes is
authoritative, with prior getter restored in outer finally even if disposal fails.
Do not claim serverOptionOverride applies this global limit. Derived per-handler
file quota64MiB; registry file default32MiB/global256MiB/pool64MiB/ratios unchanged.
Explicit positive sessionTTL3600000. Work180s plus15s natural-exit grace; pressure30s,
recovery60s fixed before execution. No throughput benchmark or4GiB/wire change.

Only test/e2e/tunnel/large-transfer-cache.test.ts, at most one dedicated endpoint/
consumer fixture and this ledger writable. Existing finite owned custom endpoint,
multi-client ACL harness and native TCP are reused. Observe actual FileCache
instances/record IDs/write/read and logical/global high-water values through
delegating operations. Both sender/receiver promises receive rejection handlers
immediately; paused peers resume on observed spill, not elapsed-time success.
Require healthy sibling during pressure, full FIN/length/SHA256 and pre-teardown
accounting recovery. Do not change production counters, limiter registry or source.
Earlier research1MiBlocal/16MiBglobal proposal is superseded by this explicit
root-approved16MiBlocal/1MiBglobal fixture, not a claim natural spill was impossible.

All sockets/timers/evidence roots are task-owned. Unknown/denied paths remain
untouched. No process-name termination; any termination requires current verified
PID/commandline/ownership. Failure is preserved and reported before scope changes.

## First actual large-transfer result ? preserved nonpass

Command: node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/e2e/tunnel/large-transfer-cache.test.ts.
Owned handle20595, final87c769, naturally exited1: two sensitivity cases PASS,
one normal large case FAIL,64.139seconds. Failure: full response FIN deadline
exceeded at the fixed60000ms limit. No second large execution occurred.
Evidence: C:/Users/beom/AppData/Local/Temp/large53-evidence-yQUR7T/facts.json.

Actual local buffer getters16777216/global limit1048576 matched approved fixture.
Both directions produced actual FileCache writes and reads. First request pressure
handler11 had pending cached65536/logical65536 and real owned file; response
handler10 similarly had nonzero cached bytes. Global cache high-water was4980736
(request) and3670016(response). All observed writes/reads with cache instance file,
record ID and length are retained. Counts734request writes/734reads and751response
writes/742reads do not imply equality or completed response delivery.

Request length33554432 and SHA256
42992a18abeccb5d054f04842a3963d9f9f5742b92380e0246d4437581508bc7 matched expected.
Both pressure-phase healthy sibling exchanges passed and paused target sockets
were resumed. Response sender's bounded operation completed, but the external
consumer did not observe FIN. No response hash/length or pre-teardown final
accounting success is claimed. The current collector finalizes hash only at FIN,
so partial response-byte progress is not recorded by this run; independent
classification should request any additional observation explicitly before rerun.
This may be a transport/terminal issue or fixture issue; cause is not established.
No #29 implementation or wire change is inferred or authorized.

Finally restored original global134217728 even through nested disposal, restored
all FileCache/SocketHandler delegates, closed only owned sockets/listeners, and
recorded every observed cache file absent/logical0 after disposal. This post-disposal
result does not substitute for the failed pre-teardown recovery gate. Raw initial
console output was tool-truncated; exact final failure receipt and facts.json are
preserved without inventing a complete raw log. Candidate frozen for independent
review/root diagnosis decision. No process termination/benchmark/source change.

## Root-approved one-run observation supplement

Status: independent observation fixer fix_lint_diagnostics assigned; original author review_wave0 candidate and failed large53-evidence-yQUR7T remain preserved. No causal conclusion or transport repair authorized.

- [x] Freeze exact observational scope before editing. Status: only large-transfer-cache.test.ts, existing large-transfer-peer.ts collector optional observation and this ledger. Preserve32MiB,16MiB local/1MiB global,180s work+15s grace,30s pressure/60s recovery, original paused readers and every send/drain/end policy.
- [x] Add non-mutating progress/terminal/cache snapshots. Status: collector hash.copy/partial length/end/close/nativebytes/isPaused; actual client/server data/external/endpoint role and SID/socket tuple; endpoint terminal -> TunnelClient close/terminate -> data terminal/destroy snapshots; read/unread logical records at remove/delete. All wrappers delegate original this/args/return, without payload/token/credential output.
- [x] Execute only the normal32MiB case once with fresh raw stdout/stderr evidence. Status:343343/4029ef session40168 naturally exited1,one FAIL/two filtered64.126s; observed child61928 outer65.486s,signal null. No process terminated or further run. Same full response FIN60s failure; original large53-evidence-yQUR7T untouched.

Exact child command: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/e2e/tunnel/large-transfer-cache.test.ts --testNamePattern "32MiB actual tunnel"`. New evidence `C:/Users/beom/AppData/Local/Temp/large53-observation-SDuYJf` contains raw stdout.txt/stderr.txt, launch.json, child-result.json, full facts.json and derived observation-summary.json. Only the evidence output path environment changed; fixed payload/limits/timeouts/pause conditions and sender/FIN behavior did not change. No separate sensitivity run, build or benchmark was executed. Both globals and delegates restored in finally; original raw machine nonpass remains nonpass.

At failure before teardown the external response collector recorded31195136 of33554432bytes, SHA256 `e9bbc78e9bc4340a068f9c2f73ce40f25478399d89e20bdd6aea213f0e3743ec`, nativebytesRead31195136, ended=false/closed=false/paused=false. Request33554432bytes and expected SHA256 matched; both pressure observations and healthy sibling exchanges occurred. Missing response length was2359296bytes; no completed response/hash equality or pre-teardown logical recovery is claimed.

Actual SID2 large-owner roles: client-data handler10, client-endpoint12, server-data11, server-external9, with actual socket tuples preserved in every relevant snapshot. At3449ms endpoint terminal began after endpoint receiveLength33554432. Client-data10 still had pendingWrite2424832, cached2097152,36queueitems,1inflight and nativeWritable65536. Two existing closeEndPointSession delegations followed. At3453ms terminateEndPointSession entered and immediately invoked handler10.destroy while pendingWrite2359296/cached2097152/36queueitems remained. After destroy both queue counters became0. During this response phase, before test teardown, cache instance ending100755353.cache removed32unread logical records IDs362..393,2097152bytes; the remaining pending count also included in-memory data. These are actual delegate observations, not padded-capacity inference. The original run's nine unread records are a different execution, not overwritten or asserted equal.

At63453ms timeout snapshot server-external9 still had sendLength31195136 versus endLength33554432, closeWait=true/closeInitiated=false, pending queues0 and socket still alive/unpaused. Client-data10 and server-data11 were already destroyed. This sequence supports independent investigation of premature data-handler termination while outbound work remains; it does not authorize a fix or declare the exact production root cause settled. Root will obtain independent review and register/assign any confirmed runtime defect separately. No #29 held EOF implementation, #28 encoding or #40 policy change follows from these observations.

- [x] Independent review of observation and classification. Status: subsequently completed and routed to separately approved #73; this observation checkpoint was frozen before that assignment. Later authorized runs and closure are recorded below.

## After73 original unchanged normal acceptance

Root54734/b30dda executed the original normal case once after product73 integration
at674a9ea. E C:/Users/beom/AppData/Local/Temp/large53-after73-YMRscw preserves before/
after production+test hashes unchanged, actual1PASS/2filtered13.628s, outer15.133s,
native0. Request/response33554432each with SHA42992a18abeccb5d054f04842a3963d9f9f5742b92380e0246d4437581508bc7;
actualFIN, write/read1534each with matching instance/file/record lengths, pre-dispose
memory/cache0 and session0, healthy exchanges during both pressures and after,
13cachefiles absent after disposal/global134217728 restored. This validates the73
response repair, not retroactively the original failed53 runs. Independent reviews
accepted those observations but requested future failure cleanup and stronger
record assertions before final53 integration.

## Independent three-finding correction

- [x] Preserve original three files/hash before edits. Status: cd9f54 owned backup C:/Users/beom/AppData/Local/Temp/large53-contract-fix-7001ac7252e1440aac2a3c5355969804 contains original test/fixture/ledger and before-sha.txt. Original author review_wave0/observation fixer fix_lint_diagnostics; this separate fixer is review_cert_conflict.
- [x] Actual helper/record RED. Status:14dc00 naturally exited1,5failed/3filtered1.02s. Native corked sender destroyed without error remained waiting for drain instead of rejecting Closed; aborting pressure left parallel bounded/poll work unresolved; wrong cache instance/recordID/read length passed the old file-existence test. Existing polling/file-existence logic was extracted unchanged before its contract correction; no missing-helper failure counted as RED.
- [x] Minimum cancellation and logical-record repair. Status: bounded supports an optional AbortSignal and clears timer/listener on every settlement; native connect/drain waits also settle on close/error/abort. Polling uses abortable native timer promises. Large case owns one AbortController, passes it to producer/collector/poll/deadline waits, aborts in finally before owned socket destruction, disposes harness and awaits all sender/work settlements before restoring globals/observers. No orphaned pressure/recovery timers remain after cancellation. No new production/harness API or limiter/counter manipulation.
- [x] Preserve rejection semantics. Status: first helper GREEN7ea9075PASS0.626s was followed by a newly identified undefined-rejection control. bd9e6f failed1/8filtered0.594s because the initial completion helper misclassified reject(undefined) as success. Explicit success/failure settlement fixed that; final small controls3f2e4c8PASS/1filtered0.603s include original corrupt/extra sensitivity controls. All intermediate evidence remains, not called one combined run.
- [x] Exact logical cache assertion. Status: actual write events record stable cache-instance ID and returned record.length; successful read checks returnedBuffer.length against that same tracked record. Final target checks require matching instance/file/id/length multisets, including missing/extra reads. cacheSize is now labelled cacheAllocatedBytes; logicalCacheBytes is the sum of remaining record.length, not allocated extent. Observers restore/clear their own record map after actual deletion; no product data/counters altered.
- [x] One original normal-case revalidation after corrections. Status:0b9e61/64058/26d3ce nativeexit0,1PASS/8filtered15.185s and outer17.0062132s. E C:/Users/beom/AppData/Local/Temp/large53-fixed-9757b7835fa14eeb98753d12eea203d6 preserves launch/CIM/HEAD/rawstdoutstderr/JestJSON/facts/child-result/final-test-hashes. Fixed32MiB/64KiB/local16MiB/global1MiB/180+15/30/60 budgets unchanged. Both lengths/SHA exact, FIN complete, target logical record assertions pass;1518writes/1518reads, pre-dispose memory/cache0, workSettledBeforeExit=true,12observed cache files absent/logical0 after disposal and global134217728 restored. Different file/record counts are different executions, not fixed expected counts.
- [ ] Two independent correction reviews/root commit. Status: three files frozen for fix_lint_diagnostics and review_large_transfer. No production/harness/source change; no commit or extra normal retry.

Small-control command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/e2e/tunnel/large-transfer-cache.test.ts --testNamePattern='sensitivity|owned sender|pressure cancellation|logical cache read mismatch|undefined rejection'`.
Normal command: same dedicated path with `--testNamePattern='32MiB actual tunnel'`, plus --json/--outputFile into its new E. Node45956/CIM+handle identity recorded at launch; final308108 PID lookup absent, no termination performed. No blanket signal value is fabricated by the Windows observer.

Final fixture SHA69ae22c56a99693cd52ff68d04560ce56397feb2be7e6f5a5b5a94e7d4fd4ef1;
test SHA f511e8c026336d5460c12a33106c245366eba5e0de0ca6696b0be7ba22fb56e4.
Original73 production hashes still match large53-after73-YMRscw/source.json. Canonical
payload/budget values and original53failure E folders were not changed/deleted.
Exact title: `test: 터널 대용량 전송과 캐시 회수 검증`.

## Final review checkpoint

Both final reviews confirm the cancellation/settlement, actual instance/file/record/logical-length correspondence and updated execution history. The measured15.185-second normal run is distinct from8small helper contracts0.603seconds and the earlier13.628-second normal run. At that historical review checkpoint, root integration/full-file regression/push/closure remained pending; all subsequently completed as recorded below. Exact title: test: 터널 대용량 전송과 캐시 회수 검증.


## Root integration and closure receipt

- [x] Integrate and validate the complete dedicated file. Status: source18e08b2 -> main1e7595b;9tests PASS13.946seconds, natural exit0; forced build40e4c2 PASS; push/remote verification a2f2d8. This complete-file receipt is separate from the prior normal-only13.628/15.185second and small-contract runs.
- [x] Close and notify. Status: GitHub CLOSED2026-09-08T16:27:10Z, comment5588442525; Telegram3998(68/62). Original failed runs and all earlier denominators remain unchanged.
