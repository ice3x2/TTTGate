# Issue #59 — Lint subprocess reliability research

Status: independently reviewed PASS and approved by root; assigned to fix_supply15 in process branch fix/epic61-lint-process-contract at f240046. Original research below executed no scripts/tests; actual RED is mandatory before implementation.

- [x] Read original #59/#60 and current lint callers. Status: complete.
- [x] Separate observed failures from causal hypotheses. Status: complete; exact historical child diagnostics are unavailable in the cited issue.
- [x] Examine reuse and owned-path verification. Status: proposed below, not executed.
- [x] Approve bounded scope and RED contract. Status: root approved both tools callers, small shared test helper, dedicated process-contract fixtures/tests and ledger; scanner/package/#60/denied paths excluded.
- [ ] Implement after actual RED and verify independently. Status: assigned branch created; no behavior edits before observed RED.

## Findings

[Issue #59](https://github.com/ice3x2/TTTGate/issues/59) and `docs/research/2026-09-05-tttgate-full-inspection.md:457` report an abnormal child exit while eight audit agents/coverage work ran, followed by a passing quiet run. They do not preserve the actual status, signal, error code, stderr or elapsed time. This supports an intermittent observation, not proof of CPU load, timeout, out-of-memory, antivirus interference or a Node fault as its cause. Do not select one of these explanations without new evidence.

`test/unit/tools/lint-auth-compare.test.ts:22-36` already uses `spawnSync(process.execPath, ...)` with a **30-second timeout** and unique `mkdtempSync(os.tmpdir())` roots/report directories. Its assertions (51,78,92) show only status; error/signal/stderr are not included. Increasing an already bounded timeout alone would not explain an abnormal non-null exit. The warn-mode test inherits `LINT_AUTH_COMPARE_STRICT` unless explicitly overridden, making its expected warn result depend on the parent environment. That is a concrete deterministic isolation gap, distinct from the unclassified historical abnormal exit.

`test/unit/tools/req-21-lint-error.test.ts:25-35` duplicates the same child pattern. Its violation assertion is merely `status !== 0` (49), so a spawn failure with null status can be mistaken for a successful strict-lint rejection. Exact status 1, no process error/signal and a completed semantic report should distinguish an actual detected violation from failed execution. This adjacent caller is a possible narrowly approved reuse target, not automatic permission to change every lint caller.

`scripts/lint-auth-compare.mjs:194-231` emits violation/summary JSON, writes the report synchronously, then exits 1 for strict violations or 0 otherwise. Its heuristic scanning and CLI policy do not need a speculative rewrite for #59. Explicit process exit can be investigated if output truncation is actually reproduced; it is not an established cause here. No production script behavior change is proposed without its own RED.

`test/unit/server/req-04-constant-time-compare.test.ts:26-36` instead uses a fixed repository `test/.tmp-req04-lint` report path and a 60-second timeout, then parses stdout without checking child completion. It also writes `reports/req-04-grep.json`. This caller's path hygiene belongs to separately gated [#60](https://github.com/ice3x2/TTTGate/issues/60); its benchmark/semantic checks are outside #59. **Do not execute this test, delete its existing directory, or use another tool/test to bypass the prior automatic deletion rejection in main/release.** Existing artifacts remain preserved.

## Minimum proposed implementation and RED

Initial writable proposal: the dedicated tools lint test plus a small local test runner/diagnostic helper only if actual reuse with the strict-tools caller is approved; dedicated process-contract fixtures/tests and ledger59. `test/helpers/smokeProcess.ts` already collects asynchronous process streams, but adopting its broader server lifecycle just to improve one synchronous lint assertion is unnecessary. Prefer a small result check reused by these two tools tests over a generic subprocess framework. No package/config, lint detection rules, #60 paths, req04 benchmark, pool or held #29 changes.

1. Before edits, isolate each future fixture in a newly allocated owned system-temp directory, with absolute script/source/report paths and an explicit stable cwd. Run only explicit #59 test paths. Warn mode must explicitly select strict=0 and strict mode select strict=1/CLI flag, while retaining the rest of the environment; do not blanket-strip Node instrumentation or resource settings to make a failure disappear.
2. Actual deterministic RED: start an owned test-driver child with parent `LINT_AUTH_COMPARE_STRICT=1` and the warn-mode fixture; current inherited environment gives strict exit1 instead of expected warn0. Keep valid strict violation and clean-source controls. This demonstrates environment isolation, not the historical load failure.
3. Diagnostic-contract RED using real owned child processes: deliberate nonzero child with stderr marker, nonexistent executable and a bounded deliberately waiting child timeout. Require the test failure report to include expected/actual status, signal, error code/message, stderr and command/cwd/elapsed context. No fabricated process result or retry-until-green. Use a short timeout only for the intentional timeout fixture; it does not prove the production timeout should change.
4. If the strict-tools caller is included, demonstrate actual failed child execution is not accepted as a violation verdict, then require exact expected exit plus successful JSON summary/report semantics. A valid strict violation remains a passing test; a process failure remains a failure. Do not accept empty output as clean scan.
5. Run the actual lint script on a small owned clean and violating source tree with its report entirely under that root. Retain real scanner assertions, not merely classifier outputs. Preserve unexpected abnormal exits and diagnostics; do not retry to obtain GREEN or claim an intentional failure fixture reproduces an OS resource fault.

Keep the current 30-second child budget unless measured evidence justifies a different bounded value. If an asynchronous runner becomes necessary, its Jest budget and child deadline must be coordinated and its child reaped on failure; no detached process, blanket process kill or global Jest timeout expansion. Successful focused checks establish the repaired deterministic contracts; #59 closure wording must retain the limit that the historical abnormal exit's underlying cause may remain unclassified.

## Owned-path safety and gates

New tests can use their own `mkdtemp` root as the two tools suites already do. Record the created absolute root, keep every generated source/report/driver inside it, and verify any cleanup target is that exact owned root before removal. Never enumerate or clean historical `test/.tmp-req04-lint` directories. Because the scanner excludes path segments named `test`/`reports`, generated input belongs in an owned `src` subdirectory, with report output in a separate `reports` child. Cleanup should not silently disguise leftover owned artifacts; report them if cleanup cannot finish.

Before implementation, root must approve the exact test/helper write set and whether the adjacent strict-tools fail-open assertion is included. #60 remains a separate assignment and any denied old-path cleanup remains denied. After actual RED/minimal repair, focused real subprocess tests and independent reviews are required; no heavy-load experiment or system fault claim is authorized by this research.

Current assignment supersedes earlier approval-pending prose only for the explicitly listed test/helper scope. Historical abnormal-exit cause remains unclassified; #40/#28 decisions and #29 hold remain unchanged.
