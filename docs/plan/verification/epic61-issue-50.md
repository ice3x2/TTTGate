# Issue #50 — Admin browser regression runner

Status: complete; independently reviewed, integrated, pushed, closed and notified.

Original title: 관리자 UI 에 테스트와 러너와 스크립트가 전혀 없음.
Assigned agent: `fix_ci14`. Branch: `fix/epic61-admin`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-admin`; base `654a065`.
Writable paths: root/admin package manifests, `.github/workflows/code-regression.yml`,
`test/ci/code-regression-workflow.test.ts`, `test/admin/`,
`test/helpers/adminBrowser.ts`, `admin/test/`, and this evidence file.
Next action: none for this issue; #63 runs before #5 or login implementation begins.

## Scope and decisions

Reuse the repository Jest runner (ADR-008) with Playwright's browser library,
not a second test runner. Vite loads actual admin source into Chromium; no DOM,
File, Web Crypto, browser API, or component mock is used. The neutral fixture
mounts the existing AlertLayout component and tests its click behavior. Browser
login hashing is compared with the server's actual legacy hash implementation
for whitespace, Korean/supplementary Unicode and empty strings. This is a legacy
hash compatibility test, not evidence that the current login wire protocol works.
Issue #8 owns the separately identified raw-password versus browser hash mismatch.

The original workspace's Svelte 5/Vite 6 and crypto-js removal changes are
untouched. Their adoption and actual production entrypoint RED belong to #5 and
later issue checkpoints. The test fixture supports both Svelte APIs solely so
neutral harness verification survives that planned upgrade. It does not change
the production entrypoint or enable a production compatibility mode.

The user explicitly selected a newer LTS baseline; root chose Node 24 and opened
#63 (`epic61-node24-decision.md` in the integration worktree). The touched code
regression workflow uses Node 24. Other runtime/version migrations remain #63's
scope. Primary npm metadata reported Playwright 1.63.0 requiring Node >=20;
the exact version is locked for reproducible browser installation.

## Checklist and TDD evidence

- [x] Read #50 and related #5/#6/#7/#8/#51, ADRs, existing Jest/network/runtime helpers, and original admin changes.
  Status: complete; reused Jest, existing components and server hash contract. Browser skill read before browser work; this change consists of committed automated tests, not ad hoc browser inspection.
- [x] Write failing script, browser execution and CI installation tests first.
  Status: RED. `npm test -- --runInBand test/admin test/ci/code-regression-workflow.test.ts` exited 1: three suites failed; missing admin script, missing `adminBrowser` helper, and missing CI admin/browser installation steps. Two assertions failed, one passed, and the browser suite could not load the not-yet-created helper. `npm --prefix admin test` separately exited 1 with `Missing script: test`.
- [x] Add the new Node 24 workflow requirement before changing its configured version.
  Status: RED. `npm test -- --runInBand test/ci/code-regression-workflow.test.ts` exited 1, expected `24`, received `18` (one failed/one passed).
- [x] Add the minimum runner, isolated Vite child process and browser driver.
  Status: implemented after RED. Root `test:admin` runs Jest without `--forceExit`; admin's `test` delegates to it. Each browser test closes Chromium and the Vite process. Real browser page errors are recorded and asserted absent. CI installs locked root/admin dependencies and Chromium/system dependencies before the full suite.
- [x] Execute the public admin command and focused CI regression.
  Status: GREEN. `npm --prefix admin test` exited 0 without forced exit: two suites/three tests passed, 6.549 seconds. `npm test -- --runInBand test/admin test/ci/code-regression-workflow.test.ts` exited 0: three suites/five tests passed, 5.327 seconds. `npm run build` exited 0. Local runtime Node v24.16.0. Root and admin dependency installation plus `npx playwright install chromium` exited 0.
- [x] Independent review and corrections.
  Status: PASS by `review_wave0`; no material findings. Public admin script passed two suites/three tests without forced exit; CI contract passed one suite/two tests. Proposed title: `test: 관리자 UI 브라우저 회귀 테스트 기반 추가`.
- [x] Commit, integrate, run combined regression, verify remote, close issue and send Telegram.
  Status: complete; operational evidence below.

## Evidence limits

Only the neutral component and legacy hash contract are tested here. Production
SPA mounting under Svelte 5, certificate lifecycle, actual CSRF requests, bootstrap
and raw-password login remain the explicit following issue checkpoints. The suite
does not skip tests when the browser or admin dependencies are missing: setup fails.
Hosted CI execution is not claimed by local Windows browser/contract tests.

## Operational completion

Integration commit and independently observed pushed remote HEAD: `d8cb6a73cdf8a359946465f816e2cfc48c9be5cd` on `origin/fix/epic-61`. GitHub independently confirmed CLOSED at `2026-09-07T15:19:17Z`.

The orchestrator reports successful clean root/admin dependency installs and build, followed by five focused tests passed in 6.712 seconds. These complement the reviewer's public-admin and CI-contract runs; hosted workflow execution remains unclaimed.

Telegram title: `TDD Gate 50 관리자 UI 에 테스트와 러너와 스크립트가 전혀 없음 (58/5)`. Delivery succeeded with message ID `3898` according to the orchestrator's Telegram tool receipt; the reviewer did not independently fetch the message. Do not send a duplicate completion notification.
