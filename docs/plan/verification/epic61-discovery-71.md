# Issue #71 discovery: stale TLS edit certificate conflict

Status: OPEN; design approved after two independent rereviews and root checkpoint. Current order is #35 -> #71. `fix_supply15` is assigned #35 implementation on `fix/epic61-configuration-rollback`, base `f65184a`, in the listeners worktree; #71 implementation waits for reviewed #35 integration. Historical discovery/design branches below are evidence only.

- [x] Preserve the actual discovery and independent classification. Status: complete; author-observed RED handle 45527, exit 1 in 13.722 seconds; earlier fixture failures are not functional RED.
- [x] Register issue #71 in the administrator sequence and inventory. Status: recorded; initial order was amended after approved design review to #34 -> #35 -> #71 -> #36 -> #38, same owner serially.
- [x] Approve compound-save design and exact write ownership. Status: both independent rereviews and root checkpoint passed; #35 foundation is assigned first at `f65184a`, and #71 compound implementation follows its reviewed integration. See `epic61-issue-71.md` and the main execution plan for the approved baseline-tuple contract.
- [ ] Reconfirm preserved regression RED, implement and verify. Status: pending reviewed #35 integration; retain the assertion, then restore ordinary test collection when implementation begins.
- [ ] Independent review, integration, push, closure and notification. Status: pending.

## Evidence and limits

Discovery worktree: `../TTTGate-epic61-listeners`, branch `fix/epic61-admin-revision`, author `fix_supply15`. Original diagnostic: `test/admin/configuration-certificate-conflict.discovery.test.ts`; retained opt-in destination: `test/admin/configuration-certificate-conflict.discovery.repro.ts`. The assertion that CertificationStore still contains the old certificate must remain intact. The `.repro.ts` extension is outside the current ordinary Jest `*.test.(js|ts)` collection. #34 focused GREEN reports do not imply this separate defect is fixed.

Opt-in command after preservation:

```powershell
node node_modules/jest/bin/jest.js --runInBand --testMatch '**/configuration-certificate-conflict.discovery.repro.ts' --runTestsByPath test/admin/configuration-certificate-conflict.discovery.repro.ts
```

Independent reviewer `review_cert_conflict` inspected original GitHub #34/#35, the author diagnostic, source/current diff and issue-34 ledger without rerunning the browser experiment. The diagnostic directly asserts certificate store content; runtime hot-swap is reported in author logs and supported by source. Fresh TLS handshake and persisted-file contents were not independently asserted. Certificate upload ordering predates the #34 diff. This is an authenticated compound-edit consistency defect, separate from #35 disk-failure recovery. The issue-body phrase describing persistence success was corrected before publication to distinguish a successful response/store change from unverified disk observations.

At registration, live GitHub lookup showed 66 tracked issues (5–60 and 62–71), 26 CLOSED; #70 was OPEN. Preserve existing completion receipts and historical denominators. New notifications use total 66.

## Published GitHub issue (registration-time snapshot; current schedule above supersedes its ordering)
[오래된 TLS 편집본이 설정 충돌 전에 인증서를 변경함](https://github.com/ice3x2/TTTGate/issues/71)

## Reproduced behavior

A stale, authenticated TLS editor can replace a certificate before its configuration save is rejected for a revision conflict. The browser sends the certificate request first, independently of configuration revision admission.

The preserved real-browser diagnostic ran against an isolated actual AdminServer, CertificationStore and TLS listener. After a separate configuration mutation advanced the revision, Apply sent `POST /api/externalCert/61376` (200), followed by `POST /api/tunnelingOption` (409). The certificate-preservation assertion failed because CertificationStore contained the replacement certificate. Author-observed handle 45527 exited 1 naturally in 13.722 seconds. Earlier attempts failed fixture key-pair interaction and are not accepted functional RED evidence.

Source inspection independently confirms the upload-before-configuration order in TunnelOptionSetLayout, the separate certificate endpoint, and runtime hot-apply support. Reported logs show hot-swap, but the existing diagnostic does not independently assert a fresh TLS handshake or read persisted certificate files. Add those checks during implementation; do not claim they are already proven.

## Scope distinction

- #34 guards configuration mutations using the editor's snapshot revision. Certificate upload is a separate operation outside that admission boundary.
- #35 concerns disk persistence failure and restoring prior state. This case receives a successful certificate-update response and changes CertificationStore, then conflicts in a separate configuration request; it requires no injected disk failure.
- The certificate-before-configuration ordering predates #34. Do not describe it as newly added certificate replacement code.
- This is an authenticated editing consistency defect; no unauthenticated exploitation or privilege escalation is claimed.

## Acceptance criteria

- Preserve the failing browser reproduction and confirm RED before implementation. While tracked as this separate open issue, retain an explicitly runnable `.repro.ts` artifact; restore ordinary `.test.ts` collection when implementing the fix. No skipped assertion or weakened expectation.
- A stale TLS edit must receive conflict without changing the affected certificate, certificate revision/files, tunnel configuration or live TLS certificate.
- Admission must also cover a concurrent mutation between preparation and save; a separate revision preflight GET alone is insufficient.
- Fresh authenticated edits apply the matching configuration and certificate successfully. Invalid certificate and conflict paths preserve the prior working state.
- Verify persisted state and a fresh TLS handshake as well as browser responses and store contents. Preserve authentication, CSRF and certificate-validation defaults.
- Document the consistency boundary of the compound save and its relationship to #35 persistence-failure recovery. Reuse existing staging, revision and rollback mechanisms where possible.
- Independently review, commit, push, close and send the per-issue notification.

Parent: #61. Discovered while implementing #34. Assign to the same administrator owner after #34, serialized with #35; no implementation authorization is implied by this discovery record alone.

Subsequent #70 closure: GitHub CLOSED at 2026-09-07T23:16:53Z; root remote integration ed79ee0 and Telegram receipt 3933 (66/27). At that receipt, 66 issues were tracked and 27 completed; registration-time 26/66 above is historical.

Subsequent #34 closure: source 04dec2c, integration 6a9472906134275314eb7838066ef0c2e04f2e61, GitHub CLOSED 2026-09-07T23:27:24Z, Telegram receipt 3936 (66/28). At that receipt, 66 issues were tracked and 28 completed. Historical registration and #70 counts above remain preserved.

Current checkpoint after #69 closure: 66 tracked issues, 30 completed. #71 remains OPEN and implementation follows approved #35 foundation integration. Earlier receipt counts and quoted original issue text are historical evidence, not active assignment instructions.
