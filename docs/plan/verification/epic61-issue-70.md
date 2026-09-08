# Issue #70 — Release version is shell data

Status: complete; source `39136cd`, integration `ed79ee0` pushed and remote verified; issue closed and notification sent.
Original title: 릴리스 워크플로우가 버전 입력을 셸 코드로 해석함.
Owner fix_ci14; worktree C:/Work/git/_Snoworca/TTTGate-epic61-release;
branch fix/epic61-release-input; baseline ae39352.
Write scope: both release workflows, shared version validator reused by the
binary archive helper, dedicated tests and this ledger. #68 source layout and
#69 binary layout remain separate. Preserve earlier actual artifacts/lint temp.

- [x] Read issue and existing consumers. Status: both workflows interpolate inputs.version into run text; archive helper already has the allowed version regex. Reuse that policy without a new dependency.
- [x] Observe harmless command-substitution RED and environment control. Status: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/tools/release-version.test.ts` exited 1 before implementation, 12 failed/1 passed, 1.1 seconds. Both actual workflow heading lines evaluated v$(printf TTTGATE_INPUT_EVALUATED) to vTTTGATE_INPUT_EVALUATED; quoted environment control preserved the literal input. Other failures captured absent early gate/shared validator.
- [x] Minimum shared validation and quoted environment handling. Status: existing archive regex moved into validate-release-version.cjs, reused by archive-binaries.cjs; each workflow sets job RELEASE_VERSION and validates it in its first shell step after Node setup, before installs/build/archive/notes. All shell version consumers now use quoted environment data; structured action fields are unchanged.
- [x] Focused regression. Status: release-version and binary-archives suites passed 17 tests in 4.669 seconds with exit 0. Additional trailing LF/CRLF boundary cases passed without further implementation changes: release-version alone 15 passed in 4.147 seconds, exit 0. Real Git Bash/tar subprocesses verify invalid values create neither notes nor archives; valid v1.0.11b, 1.2.3-rc.1 and release_2026 preserve filenames/metadata. Existing archive regression passed; no actual large archives/pkg were rebuilt.
- [x] Two independent reviews. Status: primary review_wave0 and secondary fix_supply15 code/content/exact-title PASS. Primary independently ran 15 real Bash tests with natural exit 0 in 3.478 seconds and confirmed trailing LF/CRLF/CR are rejected.
- [x] Scoped commit/root integration/push/closure/notification. Status: source `39136cd`; integration `ed79ee0641721f6ef58957ff64a62383bf7ed095` remote verified by root; GitHub CLOSED at 2026-09-07T23:16:53Z; Telegram receipt 3933 (66/27). Integration two suites/19 tests passed with natural exit 0 in 8.692 seconds. No hosted workflow execution claimed.

Validation must precede every shell input consumer. Structured action fields
remain data, and workflow dispatch permissions remain unchanged. No hosted
exploitation, privilege escalation, publication or CVE claim is made. Existing
v1.0.11b-style versions retain filenames and release metadata.

Proposed exact title: `fix: 릴리스 버전 입력을 셸 코드로 해석하지 않도록 검증`.
No #68/#69 layout fix is included; existing artifacts and their evidence remain
unchanged. Native Windows Git Bash runs are local shell regression evidence, not
an actual GitHub Actions release or permission escalation demonstration.
At commit handoff, root reports 66 tracked issues and 26 completed following
discovery of separate #71. #68/#69 remain unresolved; root owns remote closure
and notifications after integration.

Final closure: 66 tracked issues, 27 completed. Root assigned #68 next to fix_ci14 on branch fix/epic61-source-archives from ed79ee0; #69 remains separate and follows #68.
