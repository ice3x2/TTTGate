# #35 revision diagnostic test alignment

Status: test-only alignment, relevant GREEN, forced build and both independent reviews complete; source frozen, root commit authorization pending.
Independent fixer: review_cert_conflict; process worktree
`fix/epic61-rollback-evidence`, base `0ca1399`.
Only ServerOptionStore.revision.test.ts and this supplement are writable.

- [x] Read the approved #35 baseline contract and original unit assertion. Status: complete; committed revision 2 with pending admin-server is distinct from LKG metadata 1.
- [x] Preserve original failing evidence. Status: root relayed review_wave0's independent untouched-main failure (one failed test, 0.845 seconds); fixer reproduced it on this base before editing, one failed test in 1.283 seconds, natural exit 1 (11513d).
- [x] Align the expected diagnostic and strengthen preservation assertions. Status: restoredRevision is the acknowledged committed baseline 2; attemptedRevision 3, current 2, LKG 1 and pending admin-server remain distinct. Configuration values/YAML bytes and persisted state metadata are checked after recording diagnostics.
- [x] Relevant regression and forced build. Status: two suites/10 tests passed in 44.452 seconds, natural exit 0; forced TypeScript build exited 0. Commands/results below.
- [x] Freeze for two independent reviews. Status: review_wave0 and fix_supply15 code/content/title PASS, zero Critical/High/Medium/Low findings. Root commit authorization pending.

Original command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/server/ServerOptionStore.revision.test.ts`.
Only the stale expected restoredRevision failed (expected 1, actual 2). The #35
contract preserves previously accepted pending values while runtime recovery uses
its separate applied LKG; diagnostics must not mislabel the committed baseline.
This unit is a metadata/real-file test, not actual runtime-listener restoration
evidence. Existing #35 component regressions supply the runtime evidence.

No production behavior changes, new issue, additional issue closure/count or #37
implementation are included. #43 preparation remains separately preserved in
the control worktree; #28 policy and #29 platform hold are unchanged.

GREEN command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/server/ServerOptionStore.revision.test.ts test/component/server/admin/configuration-rollback.test.ts`.
Session 3601 exited 0 naturally: two suites/10 tests PASS, 44.452 seconds.
The existing component suite remains unchanged and covers publication, runtime,
pending-state and diagnostic recovery. `npm run build -- --force` (22039) exited 0.

Proposed exact title: `test: 설정 복구 진단의 커밋 리비전 계약 검증`.
The two-file change is frozen. Production and all other test files are unchanged;
root owns integration, and no new issue completion/Telegram count is claimed.

## Independent reviewer receipt

review_wave0 compared the approved #35 contract, independently reproduced baseline
failure, final unit diff and this ledger. Result: PASS, zero Critical/High/Medium/Low
findings. The test preserves current=2, LKG=1 and pending settings while checking
diagnostic identity, configuration values, YAML bytes and persisted metadata.
It remains metadata/file evidence, not a runtime-restoration test.

Independent command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/server/ServerOptionStore.revision.test.ts`.
Execution f165cc exited 0 naturally: one suite/one test passed in 0.915 seconds.
Exact proposed title passed scope/signature/progress-marker checks. Both reviews
are complete; root commit authorization remains pending. Root coordinates
independent confirmation of this reviewer-authored record. No unit or production
file was changed by this reviewer.

Root relayed fix_supply15's second independent code/content/exact-title PASS with
zero Critical/High/Medium/Low findings. That reviewer did not rerun tests; no
additional execution evidence is claimed. Root owns subsequent integration.
