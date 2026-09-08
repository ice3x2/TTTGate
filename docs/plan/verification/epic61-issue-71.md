# Issue #71 — Compound TLS edit consistency

Status: complete; source `5ec1e801dea6084352f524c61e6160b0082ca114`, integration `6aa3abd21aa7d1361f8b615137e88e847958bbb8` pushed and remote verified; GitHub CLOSED 2026-09-08T02:28:27Z; Telegram receipt 3961 (66/34). Integrated seven suites/44 tests passed in 283.824 seconds with natural exit 0; forced build passed.
Original title: 오래된 TLS 편집본이 설정 충돌 전에 인증서를 변경함.
Implementation owner: `fix_ci14`; original design/repro author: `fix_supply15`.
Branch `fix/epic61-compound-tls-save`; worktree
`C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `0f83a90`.
Root integrated/closed #35 and approved this ledger's backend/store/runtime scope,
minimal Files reuse, ServerOptionCtrl/CertificationCtrl/TunnelOptionSetLayout and
related tests/docs. Historical design-phase statements below remain evidence of
the original sequencing, not current implementation authorization limits.

- [x] Record assignment and original issue. Status: complete; issue #71 read from GitHub; clean branch confirmed.
- [x] Inspect ADR-005, preserved repro, shared revision queue and existing certificate staging/apply/persistence. Status: complete; source anchors and limitations below.
- [x] Propose minimum compound consistency boundary, writable paths and #35 separation. Status: proposal written below; no implementation authorization implied.
- [x] Independent design review and explicit root approval. Status: both independent rereviews PASS and root approved the revised certificate-delete token, coherent baseline tuple, occupied-row rename rejection and failure matrix. #35 foundation precedes #71; no production changes in this design phase.
- [x] Restore ordinary `.test.ts` collection and reconfirm original RED before implementation. Status: renamed preserved repro to configuration-certificate-conflict.discovery.test.ts; handle 7992 exited 1 before production edits, one browser test failed in 11.148 seconds because stale editor replaced the certificate.
- [x] Add concurrent/new-port/invalid-input/disk/fresh-handshake regressions and implement approved scope. Status: initial 22 API cases passed; runtime exception RED and four additional recovery/stale-writer cases passed. Receipts at the implementation checkpoint below.
- [x] Latest backend regression/build. Status: handle 50502 exited 0 naturally, seven suites/60 tests passed in 351.759s, then forced build passed. Includes all 26 compound cases, #35 configuration/certificate/fixer rollback, publication, #34 revision and legacy apply tests.
- [x] Final affected controls. Status: handle 65471 exited 0 naturally, proxy/admission/real TLS hot-swap three suites/eight tests passed in 21.073s. Same-row stale no-op, config-only certificate-revision preservation and queue release after invalid preparation are explicit passing controls.
- [x] Two independent reviews. Status: review_cert_conflict and review_wave0 final rereviews PASS; receipts below.
- [x] Scoped commit/root integration/push/closure/notification. Status: complete; source `5ec1e801dea6084352f524c61e6160b0082ca114`, integration `6aa3abd21aa7d1361f8b615137e88e847958bbb8` pushed and remote verified; GitHub CLOSED 2026-09-08T02:28:27Z; Telegram receipt 3961 (66/34). Integrated seven suites/44 tests passed in 283.824 seconds with natural exit 0; forced build passed.

Known evidence: the preserved browser repro records certificate POST 200 followed
by configuration POST 409 and directly asserts the in-memory certificate value.
Fresh TLS handshake and persisted-file assertions must be added; they are not
already established by runtime log messages. A preflight GET or reordering two
independent requests cannot establish a compound concurrency boundary.

## Original design-phase reuse findings and source anchors

| Existing path | Reuse and limit |
| --- | --- |
| `docs/plan/00-2.tech-decisions.md:45` | ADR-005 requires stage/validate/commit, keeps the old listener until commit, and defines rollback as applying the last-known-good revision. |
| `src/server/ServerOptionStore.ts:35` | `runConfigurationMutation` already serializes asynchronous work across AdminServer instances and releases its queue in finally. Reuse it; do not add a mutex framework. |
| `src/server/admin/AdminServer.ts:406` | `mutateConfiguration` authenticates elsewhere, strips expectedRevision, and compares it inside the shared queue. Extend this admission boundary for the compound command. |
| `src/server/admin/AdminServer.ts:556` | Tunnel update currently composes, validates/checks a port, applies runtime, then commits configuration. Separate certificate POST at line 755 has no configuration admission. |
| `src/server/CertificationStore.ts:207` | `prepareExternalServerCert` reuses the existing PEM, CA and RSA key-pair checks. The RSA-OAEP encrypt/decrypt comparison at line 384 verifies pairing; it is not encryption at rest. Preserve it and file permission handling. |
| `src/server/CertificationStore.ts:226` | `commitExternalServerCert` removes previous PEM files, replaces the memory entry, writes JSON/PEMs, then bumps certificate revision. It is not a reversible staged transaction. |
| `src/server/ServerOptionStore.ts:93` | Configuration commit publishes memory/revision before save; recordRollback only records metadata. No existing LKG snapshot reapply method exists in these stores. |
| `src/server/TTTServer.ts:243` | `applyTunnelingOption` reads the certificate from CertificationStore and stops a current listener before starting its replacement. New TLS ports therefore cannot use a merely staged certificate without a narrow runtime argument change. |
| `src/server/TTTServer.ts:289` | `applyExternalServerCert` uses existing pool hot-swap, falling back to restart and previous-certificate restoration. Reuse this runtime capability rather than duplicate TLS context logic. |
| `src/server/ExternalPortServerPool.ts:111` | `startServer` already accepts an explicit CertInfo. No pool change is needed just to provide a staged certificate. |
| `admin/src/layout/TunnelOptionSetLayout.svelte:275` | Apply currently removes old ports separately, optionally uploads a certificate, then saves configuration. A rename must not delete the prior listener before the compound command is admitted/validated. |
| `admin/src/controller/CertificationCtrl.ts:41` | External certificate GET already receives a server revisionState but returns only CertInfo. Retain the read revision with the corresponding certificate snapshot. |
| `test/security/req-08-admin-cert-hotapply.test.ts:25` | Reuse the real TLS peer-fingerprint probing pattern and guaranteed cleanup; a new connection proves the certificate actually served. |

## Proposed request and snapshot contract

Use the existing POST/PUT `/api/tunnelingOption` rather than a second near-duplicate
endpoint. Extend its existing flat body with optional compound metadata:

```text
normal tunnel option fields
expectedRevision: editor configuration snapshot revision (existing #34 contract)
certInfo?: matching certificate supplied by this edit
expectedCertificateRevision?: revision of the certificate snapshot being edited
previousForwardPort?: original persisted row port when this edit renames it
```

For every certificate-affecting compound operation, require a positive safe-integer
expectedCertificateRevision: certificate addition/replacement and old-certificate
deletion during rename are equally covered, even when certInfo is omitted. Determine
the affected persisted certificate entries inside the queue, not from a browser
boolean. A token is required for a rename that deletes its previous certificate;
do not treat the absence of a new certificate upload as a bypass. Both values must be checked under the shared queue;
invalid metadata is 400 and either stale revision is 409 before all side effects.
Normal configuration-only calls keep the #34 contract. Certificate data and the
three metadata fields must be removed before configuration normalization/storage;
do not persist private PEMs as extra tunnel-option properties.

CertificateStore uses a global certificate revision, including administrator
certificate writes. This deliberately conservative token can conflict after an
unrelated certificate edit. It avoids introducing per-port version storage and
is proposed for explicit design approval. Existing standalone certificate APIs
remain authenticated/CSRF protected; no mandatory configuration field is imposed
on them. For external-certificate DELETE, require the certificate snapshot token
in its body as well, so stale deletion is rejected rather than deleting a newer
replacement. This intentionally changes that DELETE's missing-token result to 400
and must be documented/migrated in its controller and existing tests. Administrator
certificate endpoints do not gain unrelated required fields.

Serialize every administrative certificate writer that shares this revision state
through the same queue, including certificate-only update/delete. Otherwise such
a request can interleave inside a compound save after certificate admission.
The standalone API represents its caller's explicit certificate write; a later
compound edit must detect that write through its certificate snapshot revision.
Do not implement nested acquisition: public HTTP handlers acquire the queue once,
then invoke the existing non-locking prepare/commit/apply operations.

Configuration/certificate GET handlers participating in editor snapshots must
also avoid observing a compound operation midway through asynchronous publication.
Reuse the same queue for these HTTP snapshot reads. A config GET followed by a
certificate GET can still span a different completed transaction, but submitting
both captured tokens detects that intervening write. Do not refresh either token
globally when another editor reads configuration.

For rename, previousForwardPort identifies only the selected persisted row. Build
one candidate that removes that old row and adds the replacement. Verify old-row
existence, target-port admissibility and the certificate before deleting anything.
For A -> B with A != B, reject with 409 if B is already a configured row, including
when B's listener is offline. Do not replace B based on physical port availability.
Both rows, both certificates and their listener states stay unchanged. An A -> A
same-row no-op is evaluated after normal revision admission and is not this conflict.
Never issue a frontend DELETE before this command or delete other unfinished rows
as a side effect of applying one row. Old-port certificate cleanup is a dependent
part of the admitted edit, not a preflight action.

## Proposed stage, publication and runtime boundary

1. Authenticate/CSRF-check and read the HTTP body without holding the queue.
2. Under one queue acquisition, compare both required snapshot tokens. Capture
   the coherent pre-attempt baseline tuple defined below, including committed
   pending values and the distinct actual applied values/identities per scope.
3. Strip metadata, compose the candidate, validate option and certificate with
   existing routines, and check new/renamed port availability. No certificate map,
   file, revision, listener or TLS context changes occur during these checks.
4. Stage the matching candidate option/certificate as explicit values. Extend the
   narrow TTTServer apply entry to accept the staged certificate and a distinct
   previous certificate for restoration. Reuse pool start/hot-swap. In particular,
   do not write CertificationStore just so new TLS startup can read it back.
5. Publish and apply only through the approved commit/LKG boundary described below.
   Return success after both stores and runtime match; report config and certificate
   revisionState. Every validation/conflict response preserves both state domains.
6. Release the queue after the complete result. No auto-retry or hidden token refresh.

The UI keeps each certificate snapshot token with its row, alongside the editor's
configuration token and original row port. It sends one command containing the
selected option and intended certificate, including for a new TLS port and rename.
On conflict/invalid input it retains the draft and performs no certificate upload,
old-port deletion or dependent request. Reload only after complete success or an
explicit user reconciliation of a partial failure.

## #35 boundary and required scheduling decision

The above admission/staging work is #71. Real rollback after a disk write failure
is #35, whose original issue was also inspected. Existing store methods cannot
atomically commit multiple JSON/PEM/revision files and cannot restore an LKG
snapshot. Calling recordRollback does not restore anything. Recalling ordinary
commit methods with old values would also manufacture extra revisions and is not
a valid exact restoration strategy.

ADR-005's old-listener-until-commit rule is also not met by the existing
applyTunnelingOption order. Merely moving certificate commit into that old order
would solve stale admission but would not establish the full ADR boundary. Merely
putting disk writes first could leave new disk/memory after runtime apply failure.

**Approved sequence:** freeze the single-command contract now, then implement the
narrow #35 commit/LKG foundation before completing #71's shared publication step:
**#35 -> #71**. Root explicitly requires ADR-005
without weakening its ordering. An admission-only exception retaining the current
runtime-before-commit order is therefore not proposed for approval. This remains
the dependency amendment approved after two independent rereviews. A separate
branch/assignment and RED gate are still required before #35 implementation.

#35 should own coherent pre-attempt baseline tuples and actual restoration across
configuration YAML/state, certificate index/PEMs/state and listener/ACL/active status. It should
stage file writes before publishing memory, use existing atomic file primitives,
and expose a narrow outcome to this administrator command. Multi-file crash
atomicity or a generic journal/database framework is not silently included; any
required crash-recovery policy must be stated separately during #35 design.

### Publication order and failure outcomes

The recovery contract is **preserve the complete normally operating state just
before the failed attempt**, including already-acknowledged pending configuration.
Capture one baseline tuple while holding the queue:

```text
committed:
  configuration candidate values + YAML bytes/existence
  certificate index + each affected PEM bytes/existence + permission policy
  config and certificate revision metadata identities/currentRevision
  pendingRestartScopes and previously acknowledged pending candidate values
applied:
  actual effective option/certificate values for each runtime scope
  each scope's confirmed applied LKG identity (may differ from currentRevision)
  actual listener port/TLS context, ACL and active/offline/timeout state
```

Runtime values must come from the effective constructor/start/successful-apply
state, maintained by the narrow runtime owner; do not reconstruct them by reading
the newest ServerOptionStore/CertificationStore candidate. A single global LKG
number does not describe scopes with different applied identities. Preserve that
distinction in the snapshot and restore the actually confirmed scope values.

For example, committed revision 8 may contain an acknowledged pending admin-port
change while the admin listener still applies scope revision 7. A later failed
tunnel edit restores committed revision 8 and its pending candidate/files, the
revision-7 admin runtime, and the same pendingRestartScopes. It must neither
discard the successful pending setting nor apply it as though it were runtime LKG.
Do not replace disk with revision 7 while leaving revision-8 memory, or relabel a
pending candidate as an applied LKG. Configuration and certificate identities are
tracked separately; both belong to the same baseline capture.

The #35 foundation must stage/validate all affected durable representations before
publishing them. Keep the current listener/context and committed memory active
until durable commit succeeds. Publish the new committed memory/revisions only
after all required writes succeed, then apply the prepared runtime values. A
successful HTTP response follows runtime success, never precedes it. Old-listener
stop/replacement occurs only after commit, as ADR-005 requires.

There is still a bounded interval between durable commit and runtime application;
external traffic can use the previous listener in that interval. The queue prevents
another administrative mutation/snapshot read from observing an intermediate
command result, not all external observation. This is explicitly staged application
with compensating LKG recovery, not instantaneous filesystem/network atomicity.

| Failure point | Required preservation/recovery and observable result |
| --- | --- |
| Authentication, body/metadata validation, stale config/cert revision | No stage writes, revision bumps, certificate changes or listener actions; existing 401/403/400/409 contract. No rollback metadata is fabricated. |
| Option/certificate preparation or port check | 400 and unchanged old configuration, certificate maps/index/PEMs/revisions and fresh-handshake fingerprint. Old/new target ports receive no destructive operation. |
| Writing any staging file before publication | Remove only owned staging output; retain old committed memory/files/revisions and active listener. Return failure with the actual persistence scope. No old listener is stopped. |
| Publishing one durable file succeeds but a later file fails, including revision metadata publication | Restore all affected durable representations and committed memory/revision/pending fields from the tuple's committed component, while preserving its actual applied scope values/identities. Do not roll acknowledged pending candidates back to an older runtime LKG. Do not claim recovery unless every required restoration succeeds. |
| All durable publication succeeds, then runtime apply fails | Restore the same complete baseline tuple: committed candidate/files/revisions/pending state from its committed component and actual listener certificate/options/ACL/active state from its applied component. For a failed new/renamed port, clean up only that command's new listener and restore/retain the old one. Return failure even when recovery succeeds. |
| Recovery write/restart itself fails | Return explicit failure/partial information and actual failedScopes; preserve the available old working listener where possible. Record recovery failure, never an unconditional restoredRevision success claim. Files/runtime may remain divergent and operators must see that state. No automatic retry-until-success. |
| Commit and runtime both succeed | Advance intended config and certificate revisions once and update only the scopes actually applied. Preserve other scopes' acknowledged pending candidates, pendingRestartScopes and confirmed applied LKG identities; do not mark the whole configuration LKG or clear unrelated pending state. Expose the matching state to later queued reads, then return success. A config-only command does not bump the certificate revision. |

The baseline tuple contains actual committed and applied values, not merely file
copies or one LKG number. Restoration uses the same bounded prepare/publish/apply
paths with each captured identity; it must not call ordinary
commit repeatedly and manufacture new successful revisions. Rollback diagnostic
metadata may record a real failure, but must distinguish attempted recovery from
confirmed restoration. Retention across process crashes is a separate guarantee
from these caught write/runtime failures and must not be implied by the tests.

## Proposed writable files after approval

- `src/server/admin/AdminServer.ts`: compound payload admission/orchestration,
  certificate writer serialization and coherent editor GET snapshots.
- `src/server/TTTServer.ts`: explicit staged/previous certificate input and bounded
  effective-runtime snapshot and compound apply/restore reuse. Root approved this
  necessary #35 foundation expansion in principle; implementation remains gated.
- `src/server/ServerOptionStore.ts`, `src/server/CertificationStore.ts`: only narrow
  candidate/snapshot/publication/restore operations approved for the #35 foundation;
  no independent transaction framework or certificate cryptography replacement.
- `src/util/Files.ts` only if the #35 design approves extracting its existing
  writeAtomic staging/rename steps for reuse: current lines 71/98 combine writing
  one temporary file with immediate publication, so they do not stage a complete
  multi-file candidate. Preserve the existing callers' contract; this conditional
  utility ownership must be confirmed before editing, not inferred as granted.
- `admin/src/controller/ServerOptionCtrl.ts`,
  `admin/src/controller/CertificationCtrl.ts`,
  `admin/src/layout/TunnelOptionSetLayout.svelte`: snapshot metadata and single save.
- Dedicated API/browser/real TLS/file regressions, preserved repro restoration,
  affected existing fixtures, compatibility documentation and per-issue ledgers.

No root/admin manifests, deploy/workflows, protocol changes, SessionStore,
certificate path-validation #36 or general pool/socket lifecycle edits are proposed.
The original dirty workspace remains untouched.

## Test-first gates for the approved boundary

- [x] Restore preserved repro to `.test.ts` and reconfirm RED unchanged. Status: 7992 failed before implementation; corrected browser later passed.
- [x] Before implementation add stale/config-certificate concurrency regressions. Status: API RED/22-case GREEN recorded; real files/revisions/fresh TLS are asserted.
- [x] Verify a certificate-only request queued during a compound save cannot interleave. Status: delegating actual apply barrier proves writer waits; matching certificate revision pair then advances in order.
- [x] Stale certificate rename/delete admission. Status: missing/stale RED then GREEN, plus actual other-writer replacement followed by stale rename/delete GREEN preserves replacement files and fresh TLS.
- [x] A -> occupied configured B conflict. Status: offline configured B is rejected with 409; snapshots/files/A TLS and B offline state remain unchanged.
- [x] Fresh same-port, new TLS port and renamed TLS port cases. Status: fresh peer identity and exact revision increments pass; old row/certificate/listener removed only on successful rename.
- [x] Malformed/mismatched PEM/CA and busy-port controls. Status: invalid certificate paths reject without state change; wildcard busy-port control passes without unrelated availability changes.
- [x] #35 stage/publication/metadata/runtime/recovery foundation and compound failure tests. Status: #35 is integrated; compound tests reuse its real-file fault boundary and separately cover runtime return failure, thrown apply and failed restoration.
- [x] Latest browser/security controls. Status: backend 60 tests/forced build, restored browser/editor/CSRF 12 tests, and proxy/admission/TLS eight tests passed; no ordinary suite was weakened or left opt-in.
- [x] Two independent implementation reviews. Status: both final rereviews PASS; completion receipt and original reviewer/fixer evidence retained.

Current next action: #71 has no remaining completion gate. Root assigned #36 to `fix_supply15` in listeners on `fix/epic61-certificate-paths` at `6aa3abd`. The original design-only phase performed no production edits/heavy tests; subsequent implementation receipts remain separate below.

### #35 failure-test inputs and expected state

All scenarios use isolated real files and actual listeners. Prefer a real file
collision/locked-path failure; where exact post-publication timing needs a boundary
interceptor, label it explicitly, delegate successful writes to the real primitive,
and record which operation fails. Do not call such fixtures mock-free. Do not weaken
production error handling or add a generic injectable filesystem framework for tests.

| Test input / deterministic failure position | Required assertions |
| --- | --- |
| Cannot create/write the first staged config file; parameterize certificate index and each PEM staging file | No durable publication occurred; bytes/existence, both committed revisions/pending values and applied scope identities remain the baseline. Old listener accepts a fresh handshake with its original certificate. Only owned staging paths may be cleaned. |
| First final config/index/PEM rename succeeds, the next publication fails | Capture proof of the successful first publication before failing the next. After recovery, every affected file and memory value equals the baseline committed component; runtime matches its applied component; no revision bump from the failed attempt remains. |
| Config or certificate revision-state file publication fails after data publication | Restore data AND both revision/pending metadata domains to their baseline identities; prove it by rereading files and store state. A successful data write must not cause reported success or a fabricated successful revision. |
| Runtime apply fails after all durable writes complete (real target bind collision introduced at the admitted pre-apply boundary, or explicit runtime failure boundary) | Confirm durable publication was reached, then verify full baseline committed/pending state restored plus actual old per-scope runtime values/identities, ACL and listener status. New target resources are closed; response remains failure. |
| A restoration publication or previous-runtime restart also fails | Preserve any unaffected baseline scopes and available old listener; assert partial/failure outcome with original failure and restoration failedScopes. Never report that a divergent scope was restored. Test releases locks/owned sockets afterwards so cleanup is deterministic. |
| Repeat partial-publication, metadata-publication and runtime-failure scenarios with currentRevision != applied LKG | First obtain a real successful pending-restart response, capture its committed candidate/revision/files and old applied scope identity, then attempt the failing edit. The previously acknowledged pending change and pendingRestartScopes survive exactly; runtime remains/reapplies actual LKG values rather than the pending candidate. |
| Successful change to one scope while another scope has an acknowledged pending change | Capture currentRevision != applied LKG for the unrelated pending scope, complete a valid change elsewhere, and assert its pending candidate/files, pendingRestartScopes and actual applied LKG identity survive. Only scopes really applied by the successful attempt gain a new applied identity. |

Recovery diagnostic metadata, if persisted, is a distinct record of this failed
attempt and must not overwrite the baseline successful revision/pending identities.
Tests assert those identities separately from any appended failure details. A
failed restoration cannot be made green by updating only lastRollback metadata.

## Design approval receipt

Root reported both independent design rereviews PASS and explicitly approved
#35 -> #71, the committed/applied baseline tuple, certificate deletion-token
admission, configured-target rename conflict and the failure matrix. Root also
requires preserving unrelated pendingRestart state and applied LKG identities on
successful writes; that obligation and its regression are included above.

Approved document-only title: `docs: 설정 복구와 TLS 편집의 일관성 설계 정의`.
`review_cert_conflict` and `review_wave0` independently passed the title and approval
state. Root corrected the final LOW to distinguish pending foundation/implementation
RED from already-approved design, then authorized this one-file commit. This receipt
authorizes the design commit, not #71 production or an unassigned #35 edit.

## Implementation checkpoint after #35 integration

Current implementation owner is fix_ci14 on fix/epic61-compound-tls-save,
base 0f83a90. The historical design receipt above is superseded by root's explicit
#71 implementation assignment. Original browser RED: handle 7992 exit 1, one
failure in 11.148s. The repro is back in ordinary .test.ts collection.

API/TLS/file RED before production: compound-tls-save.test.ts handle 50515 exit1,
17 failed/two controls passed in 96.502s. New/rotation/rename served the wrong
fresh certificate; stale/missing certificate admission and invalid PEM checks
were absent, certificate publication fault targets were never reached, and a
concurrent admitted save lacked a matching certificate revision. Additional
pending/queued-writer cases failed before implementation (92731); an IPv4-only
busy-port fixture did not match the availability check's binding scope and was
corrected to a wildcard listener. Its baseline control then passed in 7.646s;
that initial busy-port observation is not counted as an implementation RED.

The two stores now expose narrow preparation/publication operations reused by
their original commit methods and the compound endpoint. One existing Files
batch stages/publishes both stores' files before either memory state/runtime is
advanced. Private metadata is extracted before normal option composition.
TTTServer's #35 staged-certificate input and baseline restore are reused without
pool/socket changes. The UI holds each row's certificate revision/original port
and submits one compound save; separate pre-save certificate POST/row DELETE is
removed. External DELETE's token contract and affected browser tests are migrated.

Initial API GREEN: 22 tests passed in 142.372s. A further genuine runtime-throw
boundary RED (48265, 8.749s) retained advanced revisions after a thrown apply;
the compound handler now catches that exceptional failure and restores its
baseline. Runtime-throw, actual later-writer stale rename/delete and restoration
failure checks then passed (four selected cases, 27.951s). Existing restored
browser repro/editor/CSRF suites passed 12 tests in 69.694s. Admin static check
reported zero errors and ten existing warnings. These are intermediate results;
latest complete regressions, build and independent reviews remain pending.

Compatibility instructions: docs/guide/compound-tls-save.md. No crash atomicity,
mock-free fault injection, general pool change or #36 filename validation is
claimed. Test-only fresh TLS probes inspect self-signed peer identity explicitly;
production trust defaults are unchanged.

Final execution receipts: 50502 naturally exited 0 (seven backend suites/60 tests,
351.759s) then forced compilation passed; 65471 naturally exited 0 (three suites/
eight admission, proxy and TLS tests, 21.073s). Earlier browser/editor/CSRF 26793
naturally exited 0 (three suites/12 tests, 69.694s). The original stale-TLS browser
case now asserts one configuration POST409 and no earlier certificate POST.
New no-op/queue-release and later-writer controls strengthen validation on the
implemented boundary without claiming an additional production RED.

Proposed exact implementation title: `fix: TLS 설정과 인증서를 한 번의 저장으로 일관되게 적용`.

## Independent fixer checkpoint

Root assigned `fix_supply15` as separate fixer after both initial reviewers found
the same HIGH/MEDIUM; original implementation author is `fix_ci14`. HTTP #29 is
frozen in another worktree and is not part of these edits.

New RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/compound-malformed-certificate.test.ts test/admin/compound-stale-rename.test.ts`.
Handle 99738 exited 1 naturally: two tests failed in 16.434 seconds before any
fixer production edit. Real browser A -> B draft, later A certificate replacement,
then TLS-off/B lookup sent certificate token 4 instead of original 3 and returned
200 instead of 409. Seven malformed certificate shapes each returned 500 instead
of 400. Tests also capture real config/cert file bytes, revisions and fresh TLS
identity; the malformed test sends a valid empty-CA follow-up through the second
AdminServer before assertions to exercise queue release.

Root released production hold after the secondary reviewer confirmed both findings
and no additional blockers. Minimum repair completed: originalCertificateRevision
is retained independently of later source/target certificate reads and used for a
persisted-row rename's deletion. The controller strips that UI-only field before
serialization. Compound validation guards null/missing subfields then reuses
ObjectUtil.equalsType(EMPTY_CERT_INFO, certInfo) before cryptographic preparation;
a present empty CA remains valid.

Initial fixer GREEN 41722: two suites/two tests passed naturally in 17.314 seconds.
Extended command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/compound-stale-rename.test.ts test/component/server/admin/compound-malformed-certificate.test.ts test/component/server/admin/compound-admission-controls.test.ts test/admin/configuration-certificate-conflict.discovery.test.ts test/admin/configuration-editor.test.ts`.
Handle 83780 exited 0 naturally: five suites/11 tests passed in 75.008 seconds.
Controls include target-port TLS toggle and original-port TLS toggle after a later
writer, unchanged real files/revisions/fresh TLS identity, and successful fresh
TLS-off rename without persisting internal snapshot metadata. The malformed test
also proves a valid empty-CA request progresses on the other admin listener.

Final forced `npm run build -- --force` exited 0; admin `npm run check` exited 0
with zero errors and ten existing warnings. No changes to the HTTP #29 worktree,
pool/socket/wire or certificate cryptography. Original production author remains
fix_ci14; independent fixer is fix_supply15. Both final rereviews and root commit
authorization are now received; final receipt follows.

## Final review and commit authorization

review_cert_conflict confirmed both findings resolved and reviewed the complete
evidence. review_wave0 independently ran the malformed-certificate regression:
one test passed in 4.92 seconds, natural exit 0. Both final code/content/title
reviews PASS. Root authorized combining the original fix_ci14 implementation and
the independent fix_supply15 repairs, restored ordinary repro, added tests and guide.

Approved title: `fix: TLS 설정과 인증서를 한 번의 저장으로 일관되게 적용`.
The scoped status contains 18 paths: ten modified paths, six new files and the old
and new paths of the restored repro. Git rename detection represents these as
17 logical changed files. No HTTP #29 file is included.

## Root completion and historical handoff preservation

Status: complete; source `5ec1e801dea6084352f524c61e6160b0082ca114`, integration `6aa3abd21aa7d1361f8b615137e88e847958bbb8`, CLOSED 2026-09-08T02:28:27Z, Telegram receipt 3961 (66/34). Root integration seven suites/44 tests passed in 283.824 seconds with natural exit 0; forced build passed. Current epic count is 34/66; #28 policy and the whole epic remain unfinished.

The pre-integration operations backup retained the original design branch `fix/epic61-certificate-transaction`, base `6a94729`, design author `fix_supply15`, in the same listeners worktree. Preserve these as historical design identity. The approved #35 -> #71 sequence, #35 integration `0f83a90`, subsequent #71 implementation assignment to `fix_ci14`, restored ordinary reproduction and required fresh RED are retained in this ledger's design and implementation receipts. Backup pending statuses are superseded by the recorded implementation/review/closure evidence; they are not outstanding gates. Independent fixer `fix_supply15` and original implementation author `fix_ci14` remain distinct.

#36 is now assigned to `fix_supply15` on listeners `fix/epic61-certificate-paths@6aa3abd`. The separate #29 consumer-integration action is held after its platform terminal safety rejection (possible cybersecurity risk), with no pool edit; preserve partial HTTP/tests and await platform resolution without alternate-agent/tool bypass.