# Issue #44 — Release validation gates

Status: both independent code/title reviews, actual pipeline and independent final evidence review passed; scoped commit pending.
Original title: 배포 파이프라인에 타입 검사와 테스트 게이트가 없어 결함이 그대로 패키징됨.
Assigned agent: `fix_ci14`; worktree `C:/Work/git/_Snoworca/TTTGate-epic61-release`;
branch `fix/epic61-release-gates`; baseline `30599cf`.
Before the actual pipeline, root authorized reviewed #19/#20 integration commits
`bbf1ef4` and `1670ea7` to be cherry-picked without conflict as `6e33b4d` and
`fe54bdd`. The frozen pipeline baseline is now `fe54bdd` plus the four owned
#44 files below. This includes the completed cache fixes without expanding #44.
Writable paths: deploy.js, necessary root/admin gate scripts/workflows, dedicated
release orchestration tests and this ledger. FileCache/SocketHandler belong to
the parallel cache lane. #65 archive collection and #68 source layout/docs are
separate later checkpoints, not included here.

## Findings and proposed execution order

Existing deploy.js imports rimraf/fs-extra before it can install dependencies and
deletes dist/dist.js before any validation. It runs an admin build, root build
and pkg, without locked installs, Svelte checking or tests. Existing package
scripts provide check/build/test/pkg; reuse them with fixed arguments and explicit
working directories. Built-in Node filesystem operations remove the pre-install
dependency requirement.

Required order: locked root install, locked admin install, browser installation
(hosted Linux includes OS dependencies), admin static check, forced root build,
complete ordinary test suite, final production admin build, then distribution
filesystem writes and pkg. The final admin build must follow tests because
preview fixtures rebuild admin/dist. Existing distribution directories must
survive every failed gate before the output phase.

Proposed fixture evidence uses the real npm and Node executables in a temporary
project whose scripts journal ordered stages and deliberately fail selected
gates. It tests orchestration and artifact preservation, not real compilation,
browser installation or a complete project release. The actual project pipeline
must be run separately and identified as such; no release is published.

- [x] Read #44, current deploy/workflows/package scripts and ADR/reuse sources.
  Status: complete; original user workspace remains untouched.
- [x] Write and observe gate-order/failure/artifact-preservation RED before changes.
  Status: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/tools/deploy-gates.test.ts` exited 1, nine tests failed in 1.178 seconds. Fresh fixture execution failed on the pre-install rimraf import, so no gate journal existed; the actual browser-install script was also absent. This RED is recorded as missing bootstrap/gates, not falsely as a completed real release.
- [x] Implement the minimum deterministic gate sequence and deferred output phase.
  Status: built-in filesystem operations, fixed npm arguments/explicit cwd, the seven required gates and final production admin rebuild are implemented. Root test:browser:install calls Playwright; hosted Linux adds --with-deps. No #65/#68 change. Fixture handle 37604 exited 0 naturally: nine tests passed in 42.446 seconds using the same command.
- [x] Run fixture tests, independent reviews and the actual project pipeline with distinct evidence.
  Status: fixture tests, primary review_wave0 and secondary fix_supply15 code/content/title reviews passed. Actual pipeline handle 11246 terminated with exit 0; detailed observed results below.
- [ ] Commit reviewed scope and hand off integration/push/closure to root.
  Status: pending; #65/#68 work is not authorized by this checkpoint.

## Fixture evidence and exact source scope

The test creates temporary projects with spaces and an ampersand in their path,
uses real npm ci and Node scripts to journal each stage, and invokes the copied
deployer from a separate owned caller directory. Each of seven deliberate gate
failures has the exact expected journal prefix, nonzero exit, no pkg call and
unchanged old dist/dist.js/caller artifacts. The successful fixture checks cwd,
forced build/full-test arguments, test environment, hosted-Linux browser arguments,
and that the final production rebuild replaces the test's preview-marker output
before both distributions are copied. These are orchestration data/scripts, not
actual compiler/browser/packager implementations.

Only deploy.js, the root test:browser:install package script, the dedicated
`test/unit/tools/deploy-gates.test.ts`, and this ledger are changed. Existing
workflow entrypoints already invoke npm run dist and inherit the new gates; no
archive or release-note changes are made here. Windows uses npm's batch launcher
with fixed command tokens and separate cwd; no filesystem path is interpolated
into a shell command. The deployer uses its own directory, not the caller's cwd.

Proposed exact title: `fix: 배포 전에 설치·타입 검사·전체 테스트 게이트 실행`.

## Actual project pipeline (completed)

Root authorized `node deploy.js` on the frozen baseline above. Handle `11246`
terminated with exit 0; complete output is retained in
`results/release/issue44-actual-pipeline.log`. Root/admin locked installation,
browser installation, admin check (0 errors, 10 existing warnings), and forced
root compilation completed. The complete ordinary Jest run passed 91 suites
(one skipped suite), 445 tests passed and four online tests skipped, 449 total,
in 383.801 seconds. It used the existing --detectOpenHandles/--forceExit script;
this does not establish the separate #49 natural-exit cleanup claim.
The final production Vite build then passed in 2.32 seconds and pkg 6.22.0
completed. Primary `review_wave0` and secondary `fix_supply15` reported
code/content/title PASS. Primary independently reviewed the final execution log,
gate order/counts, three matching production web hashes, production-only four
admin/dist files, five binary headers/sizes and native Windows x64 startup with
exit 0. Final evidence review passed; no full pipeline rerun was performed.
Distribution paths were resolved inside this assigned
worktree before execution; no publication command is invoked.

Observed dist/bin artifacts (bytes): TTTGate-alpine-x64 83790484,
TTTGate-linux-arm64 71724044, TTTGate-linux-x64 77692244,
TTTGate-win-arm64.exe 90294416, TTTGate-win-x64.exe 96005776.
The current source layout contains dist.js/app.js (4192 bytes) and
dist.js/package.json (693 bytes). Archive selection and source-layout instructions
remain separate #65/#68 work; this result does not close those issues.
admin/dist/index.html, dist/web/index.html and dist.js/web/index.html all have
SHA256 `3CD60681B807D1B02526C7FDD7CB5927948403F67410248FEF00F4BA026F7B52`.
The three copies follow the final production rebuild, not the preview fixture.
Ordinary test-generated reports and lint temporary files are not release source
changes and are excluded from the scoped commit. No timing experiment was run.
