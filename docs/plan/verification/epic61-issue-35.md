# Issue #35 — Preserve committed and applied state after failed changes

Status: independent fixer addressed four reviewed defects after fresh RED; five recovery suites/29 tests, forced build and two independent rereviews passed. Root authorized the eleven-file scoped commit.
Original title: 설정 커밋 실패 시 런타임 롤백이 없어 메모리·디스크·런타임 상태가 어긋남.
Owner: `fix_supply15`; branch `fix/epic61-configuration-rollback`;
worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `f65184a`.
Approved design: [compound consistency and baseline tuple](epic61-issue-71.md).
Writable: AdminServer, ServerOptionStore, CertificationStore, TTTServer,
minimum Files.ts staging/rename reuse, related tests and this ledger.
No frontend compound command/#71 implementation, general pool/socket/crypto,
release/manifests or original dirty workspace changes.

- [x] Read approved design and source/reuse boundaries. Status: shared SOS queue, certificate preparation, runtime apply and atomic file helpers inspected; actual restoration is absent.
- [x] Write/reproduce stage, partial publication, revision metadata, runtime and recovery failure RED. Status: recorded below; real-file/runtime tests use explicitly labeled fault boundaries for deterministic failure positions.
- [x] Reproduce currentRevision != actual scope LKG failure recovery and unrelated-pending success preservation. Status: RED recorded and GREEN; acknowledged committed config/certificate candidates and pendingRestartScopes preserved.
- [x] Implement minimum staging/publication and complete baseline restoration. Status: code frozen after targeted GREEN; batched stage/publication, committed/runtime snapshots, pending preservation and explicit failed restoration implemented. Independent review and broader regression remain required.
- [ ] Run focused regression, build and two independent reviews. Status: pending implementation.
- [ ] Reviewed commit/root integration/push/closure. Status: pending.

Snapshot contract: one queue-protected baseline includes committed option/cert
values, file bytes/existence, current revision and pending metadata, plus actual
per-scope runtime values/identities/status. Restoration preserves this tuple; it
must not replace an acknowledged pending candidate with an older applied LKG.
Success updates only actually applied scopes and preserves unrelated pending state.

## RED receipts

`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/configuration-rollback.test.ts`
handle 22069 exited 1 naturally: six tests failed in 21.328 seconds, before any
production change. Stage/publish/metadata failures left the new control port in
memory; unrelated successful tunnel change cleared admin-server pending scope;
runtime failure recorded an older restoredRevision rather than preserving the
captured identity; persistent restoration failure returned partial:false.

Fixtures use actual HTTP, stores, files and listeners. Exact file operations are
intercepted to inject a declared EIO once (persistent for recovery failure), with
all other operations delegated to the real fs method. This is fault injection,
not a mock-free claim. Runtime bind failure reserves the admitted free port with
an actual wildcard listener after the real availability check.

Certificate RED: same bare Jest command with
`test/component/server/admin/certificate-rollback.test.ts`, handle 41085,
exit 1 naturally, four failures in 40.303 seconds. Injected failures at certificate
index, key PEM, cert PEM and certificate revision publication leave replacement
certificate memory. The earlier four cases stopped at a hex-case fingerprint
fixture mismatch and are not counted as certificate behavior RED. No production
edits preceded 41085. The runtime-limit regression now captures the observed
limit before fixture cleanup rather than accidentally measuring restored test state.

Initial GREEN handle 21478: bare Jest configuration-rollback/certificate-rollback,
two suites/10 tests passed naturally in 57.715 seconds. Further RED on unchanged
DELETE ordering: failed removal persistence closed the old listener (one failed,
six filtered cases, 4.595 seconds). DELETE now commits before stopping the listener.

Broader handle 47843: 18 passed/one existing diagnostic expectation failed in
50.885 seconds. Kept that expectation and restored lastRollback diagnostic reporting
after confirmed baseline restoration. The diagnostic records the actual restored
committed identity rather than replacing pending state with the older applied LKG.
Diagnostic persistence failures are reported in failedScopes, not suppressed.

Additional snapshot-read RED: configuration-publication.test.ts exposed committed
candidate data through a second AdminServer while runtime application was paused
(exit 1, 4.73 seconds). The fixture delays and delegates actual runtime apply.
Relevant config/certificate snapshot GETs now share the existing mutation queue.

## Expanded verification and current checkpoint

- Publication/configuration/legacy apply run 89779: three suites/10 tests passed,
  natural exit 0, 28.707 seconds; existing rollback diagnostic assertion retained.
- Real post-apply certificate fault restored persisted baseline and fresh TLS
  fingerprint. Additional timed-activation RED 2050 found activeStart restarted
  (9.784 seconds); rollback now schedules the remaining original deadline and
  retains its original status identity. Targeted GREEN 79122 exited 0, 9.908 seconds.
- Memory-only failure RED (3.735 seconds) found an unaffected control listener
  unnecessarily restarted during restore. The existing control-change comparison
  is now shared with restore and excludes unrelated memory/external changes.
- Certificate recovery-failure RED 2472 (11.866 seconds) found a configuration
  domain label on a certificate restoration failure. The original error now
  carries its persistence domain, and the API reports certificate-restore.
- Expanded 46946 exited 0 naturally: three suites/16 tests, 103.384 seconds,
  covering acknowledged pending certificate/configuration candidates and scope
  identities, actual write failures, runtime TLS recovery and failed restoration.
- Dedicated failed rollback-diagnostic persistence test passed in 3.691 seconds.
  It fails the third state publication (candidate, baseline restore, diagnostic),
  observes explicit configuration-rollback-metadata in failedScopes, and verifies
  restored pending identities/file bytes/actual memory limit/control instance.
- `npm run build -- --force` passed after the runtime/helper/diagnostic changes.

Current broader command (83418):
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/configuration-rollback.test.ts test/component/server/admin/certificate-rollback.test.ts test/component/server/admin/configuration-publication.test.ts test/component/server/admin/configuration-revision.test.ts test/component/server/admin/AdminServer.apply.test.ts test/component/server/admin/AdminServer.security.test.ts test/security/req-08-admin-cert-hotapply.test.ts test/admin/configuration-editor.test.ts test/admin/configuration-snapshot.test.ts test/admin/csrf-requests.test.ts`.
This includes added certificate index/PEM/revision staging fault cases. Handle 83418
terminated naturally with exit 0: ten suites, 49 tests passed in 250.863 seconds.
#71 repro remains excluded
by its preserved `.repro.ts` name and is not claimed fixed.

Successful baseline identities are distinct from new rollback diagnostics.
lastRollback.restoredRevision identifies the committed baseline actually restored;
per-scope runtime LKG identities and pending values remain separately captured.
Diagnostic write failure remains visible and cannot overwrite those identities.
Caught failure recovery does not provide crash atomicity or resurrect connections
already closed during a post-commit runtime replacement.

Proposed exact title: `fix: 설정 저장 실패 시 직전 운영 상태 복구`.
Current changed scope: five approved production files, five dedicated test/fixture
files and this ledger. Independent reviewer identities/results are pending.

At the original-author handoff, no #35 execution remained. Root handed that author
a separate-worktree #11 fixer task and assigned fix_ci14 to the #35 findings below;
changes/commits from those worktrees must not be mixed.

## Independent fixer checkpoint

Status: root assigned fix_ci14 as independent fixer; fix_supply15 remains the
original implementation author. Four review findings are under fresh RED:
activation outside the shared queue; uncaptured runtime allow-client maps;
cleanup unlink masking publication/restoration errors; and missing DELETE-stop
rollback diagnostics (present in baseline HEAD). Root received secondary
review_wave0 confirmation of the same four findings and released the fixer
before production changes.

- [x] Inspect each finding and baseline contract. Status: actual source supports all four; research preceded production edits.
- [x] Execute dedicated RED. Status: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/rollback-review-regressions.test.ts`. Initial 6338 exited 1; DELETE cases initially used the wrong endpoint and are not valid RED. Correct-route 91727 exited 1, 21.082s: activation reverted after acknowledged success, cleanup reported partial:false, DELETE omitted diagnostics/diagnostic-failure scope. ACL setup initially failed before the target condition (inactive listener and absent tunnelingOptions in GET); those runs are not behavior RED. After explicit activation/store snapshot correction, unchanged production ACL tests failed twice in 6.971s: baseline authenticated TCP echo passed, but post-failed-apply echo closed with zero bytes for both IDs and names.
- [x] Authorized minimum fixes. Status: independent fixer changed only AdminServer activation serialization/DELETE diagnostics, TTTServer deep ACL snapshot/restore, and Files batch cleanup preserving the primary error and recoveryFailedPaths. Dedicated six cases passed naturally in handle 46520, 19.831 seconds.
- [x] Existing recovery regressions/build. Status: handle 30720 terminated naturally with exit 0: configuration-rollback, certificate-rollback, configuration-publication, AdminServer.apply and new rollback-review-regressions all passed, five suites/29 tests in 180.934 seconds. Conditional `npm run build -- --force` then passed. Pending values, original activation deadline, unrelated control listener preservation and configuration/certificate restoration cases remain green.
- [x] Independent rereviews. Status: review_cert_conflict confirmed all four findings resolved; review_wave0 independently ran the six new regressions with natural exit 0 in 21.249 seconds. Both final reviews passed. Root corrected the sole LOW ledger test/fixture count to five, for eleven total files. No new administrator certificate diagnostic obligation or #71 frontend work added.

The new fixture uses two real authenticated HTTP requests with an explicit
delegating apply barrier, actual authenticated client TCP echo access for both
ID/name ACLs, delegated real-filesystem fault positions, and actual listener
stop followed by a declared false-result fault. Fault injection is disclosed;
no mock-free claim. Cleanup restores injected methods in finally and closes
owned clients/listeners. No pool/HTTP/#71 frontend source changes are allowed.
