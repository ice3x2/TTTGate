# Issue #14: code regression CI

Status: complete; independently reviewed, integrated, pushed, closed and notified.

Assigned agent: fix_ci14. Branch: `fix/epic61-ci`. Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-ci`. Writable paths: `.github/workflows/code-regression.yml`, `test/ci/code-regression-workflow.test.ts`, and this evidence file. Next action: none for this issue; combined Wave 0 regression follows #15 integration.

## Scope

Issue #14 requires ordinary code pull requests to execute the repository's full Jest suite. A dedicated workflow separates this trigger from supply-chain path filters. It builds TypeScript and executes the full root test command on every pull request, main pushes, and manual dispatch. Release gates are tracked separately by #44 in the epic execution plan.

Reuse inspection: package.json provides `build` and `test`; Jest already includes all `test/**/*.test.(js|ts)` suites. Existing supply-chain YAML tests demonstrate the installed `yaml` parser. No dependency or runtime code changes are needed for the new workflow. Existing supply-chain workflow is owned by #15 and is untouched.

References: GitHub #14; `docs/plan/00-2.tech-decisions.md` (ADR-002, ADR-008); integration worktree `docs/plan/epic-61-execution.md`.

## Checklist and evidence

- [x] Read issue, decisions, plan and existing workflow/test infrastructure.
  Status: complete.
- [x] Write and execute failing YAML regression before creating workflow.
  Status: RED confirmed. `npm test -- --runInBand test/ci/code-regression-workflow.test.ts` exited 1: 1 suite failed, 2 tests failed, both ENOENT for `.github/workflows/code-regression.yml`.
- [x] Add unrestricted PR workflow using locked install, build and complete suite.
  Status: implemented after RED. `npm test -- --runInBand test/ci/code-regression-workflow.test.ts` exited 0: 1 suite passed, 2 tests passed. Contract checks reject branch/path filters, conditional/skippable jobs or steps, working-directory redirection, scoped test arguments and masked command failures.
- [x] Execute broader build/test regression.
  Status: full suite `npm test -- --runInBand` exited 0: 66 suites passed, 282 tests passed, 148.335 seconds. Initial `npm ci --no-audit --no-fund` exited 0, added 533 packages. Initial `npm run build` exited 1 with TS2315 (EventEmitter is not generic) at `node_modules/minipass/dist/commonjs/index.d.ts` lines 14, 17, 532 and 535. This became issue #62; see `epic61-issue-62.md` for its separate RED/GREEN evidence. Following that dependency fix, locked reinstall and `npm run build` both exited 0. Local runtime Node v24.16.0; GitHub-hosted Node 18 verification remains pending. Tracked reports rewritten by the full suite were restored to their lane baseline.
- [x] Independent review, corrections and re-review.
  Status: PASS by `review_wave0`; no material findings. See `epic61-wave0-review.md`.
- [x] Commit, integrate, push, close issue and send Telegram.
  Status: complete; operational evidence below.

## Limits

Local YAML contract tests inspect the actual workflow structure; they do not prove a GitHub-hosted run. The new workflow uses Node 18 consistently with existing workflows. Admin test runner enablement is tracked by #50. Existing full-suite runtime defects and supply-chain audit behavior must remain visible and are not suppressed by this change.

## Operational completion

Original issue title: CI 가 코드 변경에 대해 테스트를 한 건도 실행하지 않음. Integration commit: `1df351f`. Independently observed pushed remote HEAD: `a35f53c9c1be7c79b7ac26e916ce3abebbc9430c` on `origin/fix/epic-61`. GitHub independently confirmed CLOSED at `2026-09-07T15:04:15Z`.

Telegram title: `TDD Gate 14 CI 가 코드 변경에 대해 테스트를 한 건도 실행하지 않음 (57/1)`. Delivery succeeded with message ID `3893` according to the orchestrator's Telegram tool receipt; the reviewer did not independently fetch the Telegram message. Do not send a duplicate completion notification.
