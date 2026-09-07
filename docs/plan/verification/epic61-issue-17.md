# Issue #17 — Remove crypto-js from the release manifest

Status: complete; independently reviewed, integrated, pushed, closed and notified.

Original title: 배포 매니페스트에 crypto-js 가 남아 공급망 제거 작업이 배포본에서 무효화됨.
Requirement: remove `crypto-js` and `@types/crypto-js` from `package-build.json`
and include that manifest in the supply-chain regression.

Assigned agent: `fix_supply15`. Branch: `fix/epic61-release`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-release`; base `654a065`.
Writable paths: `package-build.json`,
`test/supply-chain/r3-req-02-crypto-js-removed.test.ts`, and this evidence file.
Next action: none for this issue; full packaging verification remains #44.

- [x] Read original issue, technical decisions and release path; search reuse options. Status: complete. Existing R3-REQ-02 root-manifest assertion is reused through `test.each`; no new helper or deployment abstraction. `deploy.js` copies `package-build.json` directly to `dist.js/package.json`.
- [x] Write and execute regression before manifest changes. Status: RED; one failed, three passed. The new `package-build.json` case received `^4.1.1` where absence was required. Existing root/source/installed-tree checks passed.
- [x] Remove the two release dependency entries. Status: complete; no other dependency versions or deployment behavior changed.
- [x] Execute focused regression. Status: GREEN; one suite/four tests passed, exit 0, 1.989 seconds.
- [x] Independent review and any corrections. Status: PASS by `review_wave0`; no findings. Independent focused run passed one suite/four tests in 2.063 seconds.
- [x] Commit, integrate, verify pushed remote, close issue and send Telegram. Status: complete; operational evidence below.

## Commands and evidence

Environment preparation: `npm ci --no-audit --no-fund` exited 0, installing 534 packages.
The following exact command was run for both RED and GREEN:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/supply-chain/r3-req-02-crypto-js-removed.test.ts
```

RED preceded editing `package-build.json`. Both dependency assertions are kept in
the shared test body, so restoring either prohibited package breaks the manifest
case. The test reads the actual release manifest rather than reconstructing it.

Full deployment execution is deferred to #44 after the administrator UI lane
is ready. These results prove manifest removal and existing server-chain
regression, not a generated binary or full packaged-install verification.

Proposed commit title: `fix: 배포 매니페스트에서 crypto-js 의존성 제거`.
Integration commit, remote hash, closure evidence and Telegram receipt are recorded below.

## Operational completion

Integration commit and independently observed pushed remote HEAD: `5cd4df0252225501e4517ab3bc3c16dac30a9652` on `origin/fix/epic-61`. GitHub independently confirmed CLOSED at `2026-09-07T15:15:46Z`.

Telegram title: `TDD Gate 17 배포 매니페스트에 crypto-js 가 남아 공급망 제거 작업이 배포본에서 무효화됨 (58/4)`. Delivery succeeded with message ID `3897` according to the orchestrator's Telegram tool receipt; the reviewer did not independently fetch the message. Do not send a duplicate completion notification.
