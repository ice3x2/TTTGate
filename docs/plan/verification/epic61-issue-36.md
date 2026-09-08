# Issue #36 — Certificate basename validation

Status: implementation, targeted regression/build and both independent reviews passed; source frozen, root commit authorization/integration/closure pending.
Original title: 인증서 파일명이 검증 없이 파일 경로로 사용되어 임의 경로 쓰기와 삭제가 가능함.
Owner: `fix_supply15`; branch `fix/epic61-certificate-paths`; worktree
`C:/Work/git/_Snoworca/TTTGate-epic61-listeners`; base `6aa3abd`.
Writable: CertificationStore, necessary AdminServer input-error mapping,
dedicated tests/ledger and minimal compatibility guidance. Other crypto, pool,
wire, #29 and unrelated files remain excluded.

- [x] Read original issue and inspect preparation/write/delete/snapshot paths. Status: complete; shared certificateFiles builds all PEM paths, while preparation currently checks only PEM values.
- [x] Freeze basename/namespace rules and reproduce preparation/write/deletion RED. Status: eight original RED cases observed; lexical policy and safety evidence below.
- [x] Implement conditional rejection before path construction/file access. Status: candidate/stored/snapshot/delete/prepared-change names share one predicate; invalid results map to 400 without exception-based input control flow.
- [x] Preserve valid filenames/optional CA and API authentication/CSRF/revision contracts; run regression/build/two reviews. Status: regression/build passed; review_wave0 and review_cert_conflict independently reported zero Critical/High/Medium/Low findings and exact-title PASS.
- [ ] Authorized commit/root integration/push/closure. Status: pending.

Safety boundary: real file effects are limited to a newly owned outer temp directory
containing a cert root and sibling sentinel. No malicious OS device/absolute path
is passed into a real write/delete before validation exists; such strings are
tested through the preparation-only contract. Original user files are untouched.

Reuse findings: prepareAdminServerCert/prepareExternalServerCert call checkKeyPair;
certificateFiles supplies candidate, retained, removal and snapshot paths; compound
prepareExternalCertificateChange and existing commit/remove paths reuse it.
Validation must include previously stored names before snapshot reads or deletion,
not only a new upload. Existing Files batching and cryptographic checks are reused.

RED: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/certificate-paths.test.ts`.
Handle 52440 exited 1 naturally: eight tests failed in 79.238 seconds. All unsafe
names passed both pure preparation methods; owned sibling sentinels were overwritten
by admin/external uploads and all three API paths returned 200, not 400. Seeded
unsafe stored names were read during capture and permitted deletion. All actual
file targets were asserted inside the newly owned outer temp root. Subsequent
API fixtures use an allocated free port rather than a fixed slot; namespace/device
strings still never reach actual write/delete APIs in the RED harness.

Chosen lexical policy: names must already be basenames. Reject separators, drive/
stream colon, controls, reserved Win32 punctuation, terminal dot/space and reserved
device/console aliases (including extension forms). Preserve ordinary Unicode,
interior spaces, dots, hyphens and leading-dot basenames. Empty name is allowed
only with empty value; existing empty optional CA remains supported.
Primary sources: [Windows filename/namespace rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
and [console handle aliases](https://learn.microsoft.com/en-us/windows/console/console-handles).
These are lexical preparation tests, not attempts to access those devices.

## GREEN and review checkpoint

Same path-test command, handle 53718: eight tests passed naturally in 32.354 seconds.
Added API controls for unsafe persisted names in token-protected DELETE and compound
rename; both retain the owned sentinel, revisions and original live listener.

Broader command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/certificate-paths.test.ts test/component/server/admin/compound-admission-controls.test.ts test/component/server/admin/compound-malformed-certificate.test.ts test/component/server/admin/certificate-rollback.test.ts test/security/req-08-admin-cert-hotapply.test.ts`.
Handle 91406 exited 0 naturally: five suites/28 tests passed in 175.273 seconds.
This preserves actual certificate restoration, fresh TLS hot-apply, malformed-input
400, queue progress and revision admission controls.

An additional real-file valid-name control (`--testNamePattern 'valid Unicode'`)
passed in 4.543 seconds: Unicode/spaced key basename and dotted certificate basename
write exact PEM bytes with empty optional CA, then delete only those owned files.
Final `npm run build -- --force` exited 0. No mock namespace/device filesystem access
or effects outside the owned outer temp root are claimed.

Only CertificationStore and required AdminServer result mapping changed in
production. Existing metadata indexes may be read, but unsafe names are rejected
before PEM path construction/capture/write/delete. Invalid prior names are not
silently shortened, migrated or deleted. Guidance: `docs/guide/certificate-filenames.md`.
This is lexical filename validation, not a new filesystem/cryptography framework.

Proposed exact title: `fix: 인증서 파일 접근 전에 안전한 파일명 검증`.
Five-file scope: two production files, one dedicated test, this ledger and guidance.
Independent code/content/title reviews passed; root commit authorization, integration,
push, closure and notification remain pending.

## Independent review receipts

Reviewer review_wave0 read the original GitHub issue, production diff, tests,
TDD ledger and filename guidance. Result: PASS, no findings. Candidate and stored
names are checked before PEM path construction; snapshot, deletion and compound
paths use the same validation while preserving batch recovery and admission.
Independent selected command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/admin/certificate-paths.test.ts --testNamePattern 'preparation rejects|valid Unicode'`.
Owned handle 5893 exited 0 naturally: one suite, two tests passed and nine filtered
tests skipped, 12.173 seconds. This selected run is not a full-suite claim.
The proposed exact title passed signature/progress-marker and scope checks.

Root relayed the separate review_cert_conflict result: zero Critical/High/Medium/Low
findings and exact-title PASS. No additional execution counts are inferred from
that review result. This review record was written by review_wave0; independent
verification of the documentation update remains root-coordinated.
