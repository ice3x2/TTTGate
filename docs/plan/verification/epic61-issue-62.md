# Issue #62: locked Node declaration compatibility

Status: implementation complete; independent review and integration pending.

Assigned agent: fix_ci14. Branch: `fix/epic61-ci`. Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-ci`. Writable paths: `package.json`, `package-lock.json`, and this evidence file. Next action: orchestrator independent dependency review and integration.

## Scope and cause

While implementing #14, a locked install followed by the existing TypeScript build failed with TS2315. `@types/node@18.16.19` supplies a non-generic EventEmitter, but `rimraf@5.0.1 -> glob@10.5.0 -> minipass@7.1.3` references its generic form. The root orchestrator independently reproduced this failure and opened #62 before assigning the dependency repair to this lane.

## Checklist and evidence

- [x] Reproduce failure before dependency edits using the existing build regression command.
  Status: RED. After `npm ci --no-audit --no-fund` exited 0, `npm run build` exited 1 with TS2315 at `node_modules/minipass/dist/commonjs/index.d.ts` lines 14, 17, 532 and 535. This compiler check exercises the actual incompatible declarations and is reused rather than introducing a version-string-only test.
- [x] Select compatible declarations within Node 18 and update the lockfile.
  Status: complete. Primary package metadata command `npm view @types/node@18 version --json` reported 18.19.130 as the latest listed 18.x version. `npm install --package-lock-only --save-dev '@types/node@^18.19.130' --no-audit --no-fund` exited 0. The only resolved package changes are `@types/node` 18.16.19 -> 18.19.130 and its `undici-types@5.26.5` dependency. npm also synchronized the lockfile root's existing node-forge range from ^1.3.1 to ^1.4.0 to match package.json; the resolved node-forge version did not change. Node major version and `skipLibCheck: false` remain unchanged.
- [x] Reinstall from the resulting lockfile and rerun the failing command.
  Status: GREEN. `npm ci --no-audit --no-fund` exited 0 (534 packages); `npm run build` exited 0 with no compiler diagnostics. Local runtime Node v24.16.0. The full suite before installed declaration replacement passed 66 suites / 282 tests; final combined integration regression is owned by the orchestrator.
- [ ] Independent diff and dependency review.
  Status: pending orchestrator-assigned reviewer.
- [ ] Commit, integrate, push, close issue and send Telegram.
  Status: pending orchestrator; no commit or remote mutation made in this lane.
