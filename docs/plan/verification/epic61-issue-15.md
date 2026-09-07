# Issue #15 — Fail-closed supply-chain checks

Status: implementation and focused test execution complete; independent review pending.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-supply`; branch: `fix/epic61-supply`.
Writable paths: `test/supply-chain/**`, `test/helpers/SupplyChainGate.ts`, `scripts/supply-chain-gate.cjs`, `.github/workflows/supply-chain-audit.yml`, and this evidence file.

- [x] Read #15, project AGENTS, technical decisions, and epic execution plan. Status: complete.
- [x] Search existing command runners and audit parsers before implementation. Status: complete; existing supply-chain suites duplicated catch/stdout handling, while no reusable report validator existed. Extracted shared validation into `scripts/supply-chain-gate.cjs`, used by `test/helpers/SupplyChainGate.ts` and the admin reporting CLI.
- [x] Reproduce failure before changing gates. Status: complete; command below exited 1 because the old gate incorrectly exited 0.
- [x] Add process-result regression cases before implementing the shared validator and workflow conditions. Status: complete; missing helper and missing scheduled-only job conditions failed before implementation.
- [x] Implement shared fail-closed JSON/process validation and scheduled online audits. Status: complete, subject to review.
- [x] Run focused regression. Status: complete; 47 passed, four explicitly online tests skipped in normal local execution.
- [ ] Independent review and fixes. Status: pending orchestrator assignment.
- [ ] Integrate, verify remote commit, close issue, send Telegram. Status: pending orchestrator.

## TDD evidence

Initial RED command:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/supply-chain/fail-closed.test.ts
```

Before gate implementation: 1 failed test; expected child Jest exit 1, received 0.
The child executed the existing medium audit suite with the real npm CLI,
`npm_config_registry=http://127.0.0.1:1`, fetch retries 0, timeout 1000 ms.
This demonstrates the original network-failure bypass without replacing npm.

Additional RED command:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/supply-chain/process-results.test.ts test/supply-chain/r3-req-06-ci-gate-dryrun.test.ts
```

Before helper/workflow changes: helper module missing; scheduled-only condition expected but undefined (1 failed, 7 passed assertions). After first implementation, two added tests for exit 1 with zero vulnerabilities and inconsistent counts both failed before their validation was implemented.

GREEN command:

```powershell
node node_modules/jest/bin/jest.js --runInBand test/supply-chain
```

Result: exit 0; 8 suites passed, 1 online-only suite skipped; 47 tests passed,
4 online tests skipped, 51 total; 15.76 seconds. The offline network test
explicitly enables online mode and now observes child Jest exit 1.

Protocol fixtures emitted by real child Node processes cover valid clean reports,
valid vulnerability reports with npm exit 1, empty/malformed/error JSON, missing
fields, inconsistent counts, unexpected process exit, spawn error, timeout, and
empty or unsuccessful dependency-tree results. Temporary substitute npm
executables additionally prove the actual gate rejects empty `npm ls` output
and a critical lodash advisory fixture. These are process-contract fixtures,
not claims about live advisory accuracy or mock-free registry behavior.

`npm run build` exited 1 with four existing TS2315 diagnostics in
`node_modules/minipass/dist/commonjs/index.d.ts`; tracked separately as #62.
No dependency manifests or lockfiles changed in this lane.

## Behavior and remaining evidence

Online audit tests require `SUPPLY_CHAIN_ONLINE=1`. The scheduled/manual runtime
job enables this explicitly. Normal code/PR tests remain deterministic and do
not depend on advisory registry availability. Online jobs run only on schedule
or explicit dispatch; failed audit commands remain failures. The vulnerable
fixture is rejected by the same assertions as real npm audit output.

Audit exit 1 is accepted only as a complete, consistent vulnerability report;
the existing severity/package assertions still examine its findings. Empty or
error output cannot become an empty vulnerability map. Dependency inspection
uses the full production tree so absence is a successful exit 0 and failures
need no exception-based fallback.

The admin HIGH report-only policy is preserved. The Node CLI reuses the same
validated audit report, warns for valid HIGH findings, rejects CRITICAL findings,
and fails for unavailable or malformed audit results. Before implementing this
CLI, `admin-report.test.ts` failed on the missing CLI and the HIGH fixture test
failed (expected exit 0, received 1). Both are green after implementation; the
HIGH fixture asserts warning text and package name, while the real unreachable
registry case asserts failure with an audit-result diagnostic.
Live registry and hosted workflow runs are not claimed by this local evidence.
Windows Node emits a shell/argument deprecation warning for the fixed internal
npm arguments; focused tests still exit cleanly without `--forceExit`.
