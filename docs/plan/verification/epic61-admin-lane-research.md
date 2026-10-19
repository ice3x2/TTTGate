# Proposed early administrator consistency lane — #34 → #35 → #36 → #38

Status: independently reviewed and root-approved; the execution plan now authorizes the bounded lane. Technical proposal below is unchanged; implementation must follow per-issue ledger design, RED and review gates.
Researcher: `fix_supply15`. Administrator source inspected at integration HEAD
`69461ec5a0343a2e9f3fe6a8a5cb99d5b1310c70`; later #20 integration changes only
cache ownership and does not change these administrator paths.

- [x] Read original issues, current code/callers and ADRs. Status: complete.
- [x] Record root-selected revision compatibility policy and snapshot/serialization constraints. Status: complete below; these are settled requirements, not open user questions.
- [x] Identify serial source ownership, real failure evidence and reuse opportunities. Status: complete; implementation tests are proposed, not executed.
- [x] Independent research/scope review and root approval of the early lane. Status: `review_wave0` passed technical/ownership review and root approved the bounded exception.
- [x] Single plan owner records approved exception and fresh branch. Status: main plan updated; root created `fix/epic61-admin-revision` in the clean existing listeners worktree at `d8f335e`. Worker must create the issue ledger before RED/implementation.
- [ ] Execute #34, then #35, then #36, then #38 with separate RED/GREEN/review/remote gates. Status: #34 assigned to `fix_supply15`; following issues wait for preceding reviewed integration.

## Scheduling conclusion

This lane can begin after #20 integration alongside release #44/#65/#68. Its
administrator/configuration/certificate code is disjoint from the release owner's
deploy scripts, manifests, workflows and release fixtures. The four issues must
run serially because they overlap AdminServer and configuration state; #35 must
reuse #34's mutation serialization, not introduce a competing lock.

#28 remains blocked on the user's wire compatibility decision. These repairs do
not select packet widths, negotiate protocols or alter HTTP tunnel parsing.
Any necessary edit to a shared runtime apply method, especially TTTServer for
#35, requires an explicit ownership expansion before that file is changed.

## #34: configuration revision checks and asynchronous serialization

Original issue: [lost updates despite revision responses](https://github.com/ice3x2/TTTGate/issues/34).
Current anchors:

- `src/server/admin/AdminServer.ts:406` reads the current server option before
  awaiting request JSON, then awaits port checks around line 461 and runtime
  apply around line 481 before commit. The corresponding tunnel update/remove
  handlers begin at lines 538/595 and also await runtime changes before commit.
- `src/server/ServerOptionStore.ts:80` commits prepared options; lines 90–100
  replace memory/increment revision before save. The current APIs have no expected
  revision check. Revision snapshots are cloned for readers at line 43.
- AdminServer GET responses at lines 970/1008 include revisionState, but
  `admin/src/controller/ServerOptionCtrl.ts:39`/`:54` retain only option values.
  `ServerSetLayout.svelte:36`/`:123` and `TunnelOptionSetLayout.svelte:99`, `:249`,
  `:282`, `:308` load and mutate the editable values without their read revision.

### Settled policy

Configuration mutation requests **must carry the revision of the snapshot that
was actually read/edited**. Missing or invalid revision is HTTP 400; stale valid
revision is HTTP 409. Old API clients omitting revision are intentionally rejected
and this compatibility break must be documented. There is no fallback that treats
a missing revision as current, since that would leave lost updates unfixed.

Apply this to persistent server-option/tunneling-option create/update/delete
requests, including the existing PUT alias where it reaches those handlers.
Do not require configuration revision on unrelated login/session/CSRF/certificate
endpoints. Transient activation currently does not commit ServerOptionStore and
must not be silently treated as a persistent configuration mutation.
Authentication and CSRF checks retain their existing priority and response policy.

Recommended request metadata name: `expectedRevision`, a positive safe-integer
number copied from the same GET response's `revisionState.currentRevision`.
Freeze the exact field in #34's implementation ledger before tests; strip metadata
before normalizing/persisting configuration. Strings, null, fractional/negative
or unsafe numbers must not be coerced into valid revisions.

### Snapshot and concurrency design constraints

Keep `{editable value, read revision}` together per editor/snapshot. A singleton
controller's newest fetched revision must never be attached to an older draft.
Clone as needed so another fetch cannot mutate the draft's identity. A 409 must
remain visible and must not trigger blind mutation replay with a newer revision.

Parse/validate the request envelope before acquiring the narrow configuration
mutation queue; then, inside the queue, read current state, compare revision,
compose/normalize, check ports, apply runtime and commit. The lock must cover the
await points, not only a synchronous compare or final save. Check stale revision
before a no-op equality success too. An operation failure must release the queue.
The serialization belongs to the shared configuration owner so multiple admin
listeners using the same store cannot bypass it. Keep it out of authentication
and unrelated certificate requests; no generic transaction/locking framework is
needed.

The tunnel editor has multi-request flows: old-port removals and certificate
operations can precede a configuration update. Trace every configuration request
in those flows. Advance a working revision only from that same edit operation's
successful commit, or explicitly reload a new snapshot; never borrow global
freshness. Stop a dependent sequence on 400/409. Inspect certificate side-effect
ordering before claiming an entire multi-request edit atomic; do not silently
extend required revision to all certificate endpoints to solve that separate
domain. Request scope expansion if a necessary compound apply cannot remain
within the selected configuration contract.

### Strict RED proposal and ownership

Use real authenticated HTTP requests with current CSRF handling. GET two copies
at revision R, change distinct fields, and send both concurrently across a real
asynchronous port-check/runtime-apply path. Require exactly one success and one
409, one committed revision advance, and winner values in memory/disk/runtime.
Also test sequential stale updates, create/update/delete and PUT alias, missing/
invalid revision 400, stale no-op rejection, and no changes on rejected requests.
Use a small explicit barrier fixture only if necessary to prove overlap; label
it honestly and retain a real concurrent-request case.

Browser tests must hold two draft snapshots while another fetch/save advances
the controller cache, proving the old draft still sends R and receives 409.
Update existing configuration API fixtures to read and send their own revisions;
never weaken the new gate to retain old tests. Authentication/certificate API
tests should continue working without irrelevant revision metadata.

Proposed ownership: AdminServer configuration handlers, ServerOptionStore
revision/serialization boundary, ServerOptionCtrl and the two configuration
editor snapshots, narrowly required request/snapshot types, dedicated and
affected configuration/browser tests, compatibility documentation and #34 ledger.

## #35: real last-known-good restoration after commit failure

Original issue: [memory/disk/runtime divergence after failed commit](https://github.com/ice3x2/TTTGate/issues/35).
`ServerOptionStore.ts:90` publishes memory and revision before `save()`. Save at
line 194 writes server.yaml, then revision state; those are separate atomic-file
writes, not an atomic pair. `recordRollback` at line 114 only records metadata.
`RevisionState.ts` contains LKG identifiers/timestamps, not the full LKG values.
AdminServer applies runtime before committing the store. TTTServer's existing
`applyServerOption` and `applyTunnelingOption` restore previous runtime on apply
failure, but a later disk commit failure is a different path.

ADR-005 already chooses stage/validate/commit with **last-known-good revision
reapplication**, not merely copying a YAML file. No further user rollback-policy
question is required. The implementation must retain/obtain the actual LKG option
snapshot and matching metadata; an ID alone is insufficient, particularly when
currentRevision differs from lastKnownGoodRevision because restart scopes remain.

Reuse Files.writeAtomic/Sync (`src/util/Files.ts:71`/`:98`) and existing runtime
apply functions. Stage candidate state without publishing it, restore the actual
LKG memory/runtime/durable state if any commit step fails, and keep #34's queue
held until restoration is finished. Account for failure of the second metadata
write after YAML succeeded. Do not mark a failed attempt as current/LKG or claim
successful restoration merely because recordRollback was called. If restoration
also fails, preserve the original failure and report explicit failed scopes;
do not invent a successful rollback.

RED should use real temporary persistence targets made unwritable/invalid in a
portable way, asserting the actual save error after runtime change, and inspect
memory, YAML, revision metadata, listener state and real data flow. Where a
persistent filesystem fault prevents rollback itself, assert the honest partial
failure; an explicitly labeled one-shot persistence fault can separately test
successful recovery with real remaining IO. Existing AdminServer.apply tests
cover mocked runtime-apply failure only and are not sufficient evidence here.

Proposed ownership: the same configuration transaction owner/handlers and
dedicated persistence/runtime tests. Request and record specific TTTServer apply/
restore-method ownership before editing it. Do not expand into transport framing,
generic filesystem utilities or certificate transactions without evidence and
scope approval.

## #36: safe certificate filenames for both write and delete

Original issue: [certificate filename path traversal](https://github.com/ice3x2/TTTGate/issues/36).
`CertificationStore.ts:172`/`:191` combine names with certificate directories for
write/delete; checks around line 375 validate PEM/key pairs only. AdminServer's
certificate handlers delegate those checks. Existing web-resource containment
in AdminServer is a useful policy reference, not a certificate-write validator.

Validate original names as safe basenames before any mutation; reject path
separators, parent-directory/absolute/drive/UNC forms and invalid control bytes
with HTTP 400. Handle Windows separators on every supported host. Do not silently
sanitize a traversal into a colliding basename. Preserve valid ordinary names
and optional empty CA fields. Defense must also cover removal of previously
persisted unsafe names, so a valid replacement cannot delete outside the root.
Validate all affected names before writing/deleting; do not leave partial output
just because the last name is invalid.

Real-file/HTTP RED: use a test-owned sentinel outside the certificate subdirectory
but inside the temporary root, submit traversal names with a real valid PEM pair,
and verify it would be overwritten/deleted before the fix. Then require 400,
unchanged sentinel/metadata, safe stored-name deletion and valid registration.
Do not access user files or claim symlink containment from string checks alone.
Proposed ownership: CertificationStore preparation/write/delete filename boundary,
corresponding AdminServer validation/error mapping and dedicated real-file tests.

## #38: unmatched mutation routes must complete

Original issue: [unmatched POST/DELETE hang](https://github.com/ice3x2/TTTGate/issues/38).
`AdminServer.ts:140` dispatches and returns by method; routeDelete at line 209 and
routePost at line 221 have no unmatched fallback. GET has one. The same raw URL
also controls login's CSRF exemption, so query-bearing login cannot be fixed in
only one dispatch comparison.

Use one consistent pathname decision for route dispatch and its security guard,
then return a bounded 404 failure for unmatched POST/PUT/DELETE. Keep normal
authentication/Origin/CSRF checks: a request rejected by those guards must not be
turned into a 404 bypass. Do not broaden supported methods or alter static-file
containment as incidental cleanup.

RED with real HTTP sockets and a bounded child/request timeout must show validly
authenticated/CSRF-authorized unknown mutation paths receive no response on
baseline. GREEN requires promptly completed 404 envelopes and released requests,
valid routes/query-bearing login retain intended behavior, and missing/invalid
security credentials retain their existing rejection. Proposed ownership:
AdminServer routing/path selection plus dedicated route/browser/API regression.

## Original proposed early-lane exception, now approved through the execution plan

After #20 integration, assign one administrator consistency owner for #34 → #35
→ #36 → #38, parallel only with disjoint release #44/#65/#68. Record a fresh
worktree and issue ledger before implementation. #34 enforces the selected
mandatory snapshot revision policy, including the deliberate old-client break;
#35 reuses ADR-005 and the same serialized boundary. TTTServer changes require
explicit scope expansion. Preserve authentication/TLS/CSRF defaults, existing
protocol formats and separate release/cache ownership. #28 remains unimplemented
pending policy. Each issue retains its own RED/GREEN, independent reviews,
commit/integration and remote closure/notification evidence.

During the initial research, this file was the only artifact written; the researcher did not modify production code, the main execution plan or a worktree branch. Subsequent root approval and branch assignment are recorded below.

Approval update: root assigned the #34 branch after independent review. The execution plan is the current ownership/authorization source; no technical findings above were changed by this status update.
