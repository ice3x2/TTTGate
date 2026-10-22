# Issue #34 — Snapshot-bound configuration revisions

Status: complete; source `04dec2c`, integration `6a94729` pushed and remote verified; issue closed and notification sent. Separate certificate defect #71 remains open.
Assigned agent: `fix_supply15`; branch `fix/epic61-admin-revision`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `d8f335e`.
Original issue: GitHub #34 (관리자 설정 저장에 낙관적 잠금이 없어 동시 저장 시 앞선 변경이 조용히 사라짐).
Owned scope: configuration handlers in AdminServer, ServerOptionStore's shared
mutation boundary, ServerOptionCtrl/configuration editor snapshot state, narrowly
related request types/tests/compatibility documentation and this ledger.
No root manifest, deploy/workflow, protocol-width #28, SessionStore or unrelated
certificate implementation changes. #35/#36/#38 require later serial assignments.

- [x] Read approved administrator research and root policy. Status: complete; field/flow design below.
- [x] Write and execute actual RED before any production implementation. Status: backend four failures, controller snapshot failure and editor continuation failures confirmed before the corresponding implementation.
- [x] Implement mandatory revision and store-scoped async serialization. Status: four real HTTP tests passed, natural exit 0, 14.571 seconds (handle 16983). DELETE fixture now explicitly supplies Content-Length so Node sends its JSON body; prior 400 from missing body was a fixture error, not a production policy defect.
- [x] Carry read revision with each editor snapshot and stop failed dependent mutations. Status: explicit controller snapshot/result types, editor-owned revisions, stopped false responses and successful local working-revision advancement implemented; initial browser checks passed.
- [x] Detect/report compound certificate side effects outside configuration CAS. Status: actual certificate-store change before config 409 reproduced in handle 45527; independent review_cert_conflict classified distinct issue #71, created by root. No whole-edit atomicity claim.
- [x] Run relevant browser/API/compatibility checks, forced build and independent reviews. Status: passed; objective results and two independent reviewer receipts below.
- [x] Scoped commit and root integration/push/closure/notification. Status: source `04dec2c`; integration `6a9472906134275314eb7838066ef0c2e04f2e61` remote verified by root; GitHub CLOSED 2026-09-07T23:27:24Z; Telegram receipt 3936 (66/28). Integration four suites/17 tests passed in 99.261 seconds, natural exit 0; forced build passed.

## Fixed request policy

Use request metadata **expectedRevision**, a positive safe integer copied from
the same GET response's revisionState.currentRevision as the edited data.
Authenticated configuration mutations with missing/invalid metadata receive 400;
stale valid metadata receives 409, including stale no-op submissions. Old clients
without revision are intentionally rejected and must be documented. Strip the
metadata before normalizing or persisting configuration.

This applies to persistent serverOption/tunnelingOption create/update/delete,
including existing PUT aliases. Login/session/CSRF/certificate endpoints and
transient listener activation do not gain unrelated required metadata. Existing
authentication/Origin/CSRF checks still precede mutation admission.

## Server mutation boundary

Keep the queue on the shared ServerOptionStore, not individual AdminServer
instances. Parse/authenticate first; inside one serialized operation re-read
current state, compare expectedRevision, compose/validate, await port checks and
runtime apply, then commit. The queue covers every existing await in the mutation
and releases on success or failure. The same boundary covers all three persistent
configuration handlers. Do not hold it while waiting for an HTTP request body.
No-op equality is evaluated only after revision admission.

## Editor and multi-request design

Controller snapshot reads will return the editable value together with its own
read revision. Save/delete APIs take that explicit revision; they do not look up
a singleton latest revision. ServerSetLayout and TunnelOptionSetLayout retain
their own snapshot revision when another GET refreshes controller cache. A 409
does not retry or overwrite the draft with newly fetched state.

For a single submit containing multiple configuration mutations, initialize a
local workingRevision from that editor snapshot. Advance it only from that
sequence's successful mutation response. On a false response or 409, stop all
dependent requests and show the failure; never silently continue. The working
revision is not a license to stamp unrelated stale drafts with global freshness.
After a complete success, reload a fresh snapshot. Partial success requires an
explicit reload rather than claiming the entire edit was atomic.

The current _removeOldServerPort deletes a certificate before configuration
removal, and TLS apply may upload a certificate before its configuration write.
These separate certificate calls have no configuration CAS contract. Tests must
expose stale-editor side effects rather than claiming #34 makes the whole flow
atomic. Within the owned frontend flow, configuration removal must succeed before
its dependent certificate deletion, and every false envelope aborts the sequence.
The upload-before-config case must be reproduced/reported to root for #35 or a
separate issue if it cannot be repaired in the approved scope; do not silently
modify CertificationStore or require revision on every certificate endpoint.

## Planned RED evidence

Backend RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/configuration-revision.test.ts`.
Handle `75597` terminated naturally with exit 1: one suite, four failed tests,
14.041 seconds. Missing/invalid revision returned seven 200 responses instead of
400; stale server POST returned 200 instead of 409; tunnel create without a
revision returned 200 instead of 400; overlapping requests through two actual
AdminServer listeners both returned 200 instead of one 200 and one 409. This is
before production edits. The concurrency fixture delays the real port-check
boundary once to establish overlap and delegates the actual check; it is not a
claim of an unmodified timing environment. HTTP, authentication, store and tunnel
runtime are real, with isolated temporary configuration and loopback listeners.

Real authenticated HTTP: missing/invalid revision 400, stale 409, stale no-op,
server/tunnel update/delete/PUT, and two same-revision concurrent requests across
the asynchronous validation/apply path (one success, one 409, one revision advance).
An explicit narrow async barrier fixture may establish overlap but does not
replace the real HTTP/store path and must be labeled honestly.

Browser/controller: hold draft R, refresh another snapshot at R+1, and prove the
old draft still submits R; exercise stopped dependent sequences on 409/false
envelopes. Existing successful configuration API tests must read/send revisions,
not receive a legacy bypass. Certificate/auth callers remain exempt as above.

Controller/browser RED: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/configuration-snapshot.test.ts`.
The first run failed fixture setup because this new lane lacked admin packages;
it is not functional RED. `npm ci` in admin then exited 0 (101 packages, unchanged
manifest/lock). The same test then exited 1 naturally in 5.854 seconds: the held
editor snapshot revision was undefined instead of the actual read revision 2.
Real Chromium loaded ServerOptionCtrl via Vite against the actual authenticated
AdminServer. A separate HTTP update and a second controller GET occur before the
held draft is submitted. No production implementation preceded these failures.

Editor RED: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/configuration-editor.test.ts` exited 1 before editor changes: both cases (with/without a stored certificate) observed DELETE followed by POST although DELETE failed. Handle 28245, two failures, 14.472 seconds. This proves failure continuation; the stored-certificate case did not observe certificate deletion and is not proof of that separate side effect.

Initial browser GREEN after snapshot/controller/editor changes: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/configuration-snapshot.test.ts test/admin/configuration-editor.test.ts`, handle 27298, natural exit 0, two suites/three tests, 21.684 seconds. Broader existing callers still need explicit read revisions; successful multi-request advancement and TLS upload-before-CAS investigation remain pending before review readiness. No commit yet.

Additional successful rename checks now observe DELETE at R and POST at R+1,
with the replacement listener/configuration retained. Proxy fixture probes now
read their own fresh revision, preserving each original Origin/CSRF assertion.
The earlier compatibility run (44463) exited 1: 21 passed, two proxy cases failed
because their fixture reused a pre-browser-write revision. Focused correction
run 55767 exited 0 naturally: five tests/two suites, 29.689 seconds, covering
proxy and three editor cases. No production Origin logic changed.

`npm run build -- --force` exited 0. `npm run check` in admin exited 0 with zero
errors and ten existing warnings. Full applicable regression/review remains pending.

## Separate certificate discovery (#71)

`node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin/configuration-certificate-conflict.discovery.test.ts`
handle 45527 exited 1 naturally, 13.722 seconds. A real TLS editor loaded a
certificate, selected a valid replacement pair, then became stale after another
authenticated configuration update. Apply produced external-certificate POST 200
followed by tunneling-option POST 409. CertificationStore held the replacement
certificate, and TCPServer reported a TLS context hot-swap. The test records the
response sequence and directly asserts the in-memory CertificationStore value; it does not
verify a fresh TLS handshake or reread persisted certificate files. The assertion
that the previous certificate remains failed. Independent review_cert_conflict
classified this as distinct from configuration CAS; root created
[issue #71](https://github.com/ice3x2/TTTGate/issues/71). No certificate fix is included.
The first two diagnostic attempts failed fixture interaction with the existing
key-pair warning/clear behavior; only 45527 establishes this finding.

Root authorized preserving the complete diagnostic and its failing assertion as
`test/admin/configuration-certificate-conflict.discovery.repro.ts`, renamed only
from `.discovery.test.ts`. Identical SHA256 before/after rename confirms no content
change: `553B58C1616F7A5DAEEB4FEC6CE7344682F5B934F830E035AB859D5DEC57B033`.
The ordinary Jest `test/**/*.test.(js|ts)` pattern does not collect it.
Explicit reproduction command:
`node node_modules/jest/bin/jest.js --runInBand --testMatch '**/configuration-certificate-conflict.discovery.repro.ts' --runTestsByPath test/admin/configuration-certificate-conflict.discovery.repro.ts`.
That renamed command is documented for replay, not claimed as an additional run.
#71 implementation must restore the ordinary `.test.ts` name and reconfirm RED
before changing behavior. #34's focused GREEN excludes this known #71 failure
and makes no claim that it is repaired. #71 implementation is not yet authorized.

Latest ordinary focused regression: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/configuration-editor.test.ts test/component/server/admin/configuration-revision.test.ts test/admin/configuration-snapshot.test.ts test/security/req-12-csrf.test.ts`.
Handle 60326 exited 0 naturally: four suites, 16 tests passed in 47.665 seconds.
This adds actual ServerSetLayout stale-draft preservation after another controller
GET, and verifies successful tunnel rename revisions R then R+1. The separate
known-failing certificate diagnostic was not part of this focused command and is
not represented as fixed. Queue-release-on-busy-port regression initially used
an IPv4-specific listener, while the actual checker binds wildcard; that fixture
did not produce a port conflict on Windows (10208 exit 1, four existing tests
passed). The corrected fixture owns a wildcard listener matching the checker.
Handle 17705 exited 0 naturally: all five backend tests passed in 17.452 seconds,
including admission after a real asynchronous occupied-port failure. Production
remained unchanged during that fixture correction. Forced build repeated after
new test source also exited 0. No live execution is currently owned by this agent.

Approved exact commit title: `fix: 관리자 설정 저장에 스냅샷 리비전 검증 적용`.
Primary `review_wave0` independently passed code/content/title and ran six
backend/browser tests with natural exit 0 in 28.727 seconds. Secondary
`review_cert_conflict` independently passed code/content/title and ran five
backend tests with natural exit 0 in 20.665 seconds. The only documentation LOW
was corrected by root: the diagnostic records the response array and directly
asserts the in-memory store value. Primary rereview confirmed that correction.
No material findings remain for #34. Root authorized committing the reviewed #34
scope plus preserved #71 repro; no #71 implementation is included or authorized.

## Final root completion receipt

Status: complete; 66 tracked issues, 28 completed. Source `04dec2c` and integration `6a9472906134275314eb7838066ef0c2e04f2e61`; root confirmed remote integration, GitHub closure at 2026-09-07T23:27:24Z and Telegram receipt 3936 (66/28). Integrated configuration/editor/compatibility regression passed four suites/17 tests in 99.261 seconds with natural exit 0; forced build passed. Earlier pending statements and test results above describe historical execution stages, not outstanding #34 gates.

Root created clean successor branch `fix/epic61-certificate-transaction` at `6a94729` in the listeners worktree and assigned only #71 design to `fix_supply15`. Production implementation is prohibited before independent design review and explicit scope/ownership approval. Preserve the existing diagnostic assertion, restore ordinary `.test.ts` collection and reconfirm RED before changing behavior. #68 has two independent review PASS receipts but remains unclosed at this receipt. No #35/#36/#38 or #28 work is authorized by #34 completion.