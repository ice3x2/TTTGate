# Issue #17 — Remove crypto-js from the release manifest

Status: reviewing; implementation and focused GREEN complete; independent review pending.

Original title: 배포 매니페스트에 crypto-js 가 남아 공급망 제거 작업이 배포본에서 무효화됨.
Requirement: remove `crypto-js` and `@types/crypto-js` from `package-build.json`
and include that manifest in the supply-chain regression.

Assigned agent: `fix_supply15`. Branch: `fix/epic61-release`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-release`; base `654a065`.
Writable paths: `package-build.json`,
`test/supply-chain/r3-req-02-crypto-js-removed.test.ts`, and this evidence file.
Next action: orchestrator assigns independent review of these three files.

- [x] Read original issue, technical decisions and release path; search reuse options. Status: complete. Existing R3-REQ-02 root-manifest assertion is reused through `test.each`; no new helper or deployment abstraction. `deploy.js` copies `package-build.json` directly to `dist.js/package.json`.
- [x] Write and execute regression before manifest changes. Status: RED; one failed, three passed. The new `package-build.json` case received `^4.1.1` where absence was required. Existing root/source/installed-tree checks passed.
- [x] Remove the two release dependency entries. Status: complete; no other dependency versions or deployment behavior changed.
- [x] Execute focused regression. Status: GREEN; one suite/four tests passed, exit 0, 1.989 seconds.
- [ ] Independent review and any corrections. Status: pending; implementation author has not self-approved the result.
- [ ] Commit, integrate, verify pushed remote, close issue and send Telegram. Status: pending orchestrator. No remote mutations or commits performed in this lane.

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
Integration commit, remote hash, closure evidence and Telegram receipt: pending.
