# Issue #37 — Apply the committed normalized tunnel row

Status: both independent final reviews PASS; implementation frozen for root commit/integration. Own ten-case GREEN and forced build complete; broader71708 retained as 65 passing/one failing. The independently reviewed #35 test-only correction is now integrated here and its corrected unit passed separately. No commit authorized.
Original title: 터널링 옵션 hot apply 에 정규화되지 않은 원본이 전달되어 저장 설정과 런타임이 어긋남.
Owner: `fix_supply15`; branch `fix/epic61-normalized-apply`; worktree
`C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `7c765a7`.
Integrated test-only dependency: `1a94d43f3fd8da347621186928986217e6394da7`, cherry-picked from source `6263373697c7a19f896365ffdc59fe0d3e8bd4ca` after root main integration.
Approved research: main `epic61-issue-37-research.md`, including resolved M1.
Writable: AdminServer.ts, dedicated tests and this ledger only.

- [x] Read issue/research and reuse paths. Status: both ordinary and compound handlers apply the original payload after committing its normalized clone; existing store.getTunnelingOption returns the needed clone.
- [x] Observe both ordinary and compound actual TLS/default propagation RED. Status: six failures/four controls passed before production edits; receipt below.
- [x] Pass the committed normalized clone to both runtime calls. Status: exactly two call arguments now use existing getTunnelingOption clone after publication; previous option/staged certificate/order preserved.
- [x] Run explicit-value, normalization, rollback, compound/path/routing regressions and forced build. Status: own ten GREEN; broader 65 PASS/one stale #35 expectation FAIL; corrected dependency unit separately PASS, as detailed below. No single all-green broader run is claimed.
- [ ] Obtain two independent final reviews. Status: ready; source and tests frozen.
- [ ] Authorized commit/root integration/push/closure. Status: pending.

Safety: omitted destination ports 80/443 are observed only in committed/applied
metadata, with no endpoint connection. TLS/I/O cases use owned loopback listeners
and explicitly allocated service ports. No access to a pre-existing default-port
service and no claim that metadata observation is an endpoint exchange. #28/#29,
normalization policies, stores/runtime/pool/crypto and manifests are unchanged.

RED: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/normalized-tunnel-apply.test.ts`.
Handle 70404 exited 1 naturally: six failed/four passed in 58.434 seconds before
source edits. Both ordinary and compound saves persisted tls:true but actual TLS
handshakes disconnected before establishment. Four omitted-default cases recorded
missing runtime TLS/buffer/HTTP/port defaults and keepAlive 10000 versus stored -1.
Explicit TCP/edit and actual post-apply rollback controls passed on the baseline.
Default 80/443 cases opened no client/session or endpoint connection; actual TLS
cases supplied a separately owned loopback service port and owned forward listener.

Initial GREEN45199: same ten tests passed naturally in 60.414 seconds.
Forced `npm run build -- --force`, handle81502, exited0.

Broader command71708:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/normalized-tunnel-apply.test.ts test/unit/server/ServerOptionStore.test.ts test/unit/server/ServerOptionStore.revision.test.ts test/component/server/admin/configuration-rollback.test.ts test/component/server/admin/compound-tls-save.test.ts test/component/server/admin/certificate-paths.test.ts test/component/server/admin/admin-routes.test.ts`.
An unchanged direct ServerOptionStore.revision test expects restoredRevision1 but
observes committed-baseline revision2. Neither that test nor ServerOptionStore is
modified here. Root assigned independent baseline classification; no expectation
is changed or failure hidden within #37. Final 71708 result: natural exit1, six
suites passed/one failed, 65 tests passed/one failed, 421.13 seconds. Keep this
result separate from the passing #37-specific command. No broader PASS is claimed.

Root assigned an independent test-only #35 supplement on a separate branch.
Its corrected expectation preserves committed2/applied-LKG1/pending values and adds
real YAML/state assertions. This agent independently reviewed that distinct
test/document patch with no findings. Root integrated it as main
`78f4500489db71b8b79d33360d9c9785307b2231`; the authorized source cherry-pick
produced local `1a94d43f3fd8da347621186928986217e6394da7`.

Separate corrected-unit command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/server/ServerOptionStore.revision.test.ts`.
Receipt `da9a6a`: one suite/one test PASS, 1.034 seconds, natural exit0.
Root explicitly requested this focused rerun because #37 production and the other
65 passing tests were unchanged. This is separate evidence, not a retroactive
PASS for command71708 or a newly executed all-green broader run. Production #37
and its tests remain frozen; no live run handles remain.

Proposed exact title: `fix: 정규화된 터널 설정을 런타임에 적용`.
Three-file scope: AdminServer.ts, dedicated normalized-tunnel-apply.test.ts, ledger.
Broader failure classification and the separate correction are complete.
review_wave0 and review_cert_conflict final reviews PASS with zero findings.
Do not commit or start another issue from this checkpoint without root approval.

## Independent reviewer receipt

review_wave0 compared original #37, approved research, frozen three-file change
and the execution/classification evidence. Result: PASS, zero Critical/High/
Medium/Low findings; exact title also PASS. Production blob 972e122 retains only
the two runtime-argument substitutions previously reviewed. The committed clone
is reused in both ordinary and compound paths without altering previous option,
staged certificate or #35/#71 publication/recovery order.

No additional test execution was performed for this final review. The reviewer
assessed existing ten-test GREEN, 65 passing broader cases, independently classified
stale-unit failure and the separate approved correction's passing unit evidence.
The original broader command remains a failed run; no retroactive all-green run
or restart evidence is inferred. Both reviews are complete; root commit/integration
authorization remains pending. Only this reviewer receipt was edited; production
and test files remain frozen.

Root relayed review_cert_conflict's final code/content/exact-title PASS with zero
Critical/High/Medium/Low findings. That second reviewer performed no additional
test execution; no further test counts are claimed. Both independent reviews
are complete and root controls subsequent commit and integration.
