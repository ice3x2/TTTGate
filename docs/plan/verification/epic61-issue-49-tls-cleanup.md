# Issue #49 partial repair — TLS fixture pool disposal

Status: focused GREEN; independent review pending. Issue #49 remains OPEN for the global shutdown work.

Assigned independent fixer: `research_schedule`; worktree `C:/Work/git/_Snoworca/TTTGate-epic61-tls-cleanup`, branch `fix/epic61-tls-cleanup`, base `67d8123`. Owned files are the existing TLS hot-apply security test and this ledger only. This partial repair unblocks broader listener-restart regression; it does not change production code, package scripts or forceExit configuration.

- [x] Inspect the existing fixture and reproduce native process nontermination before edits. Status: RED documented below.
- [x] Dispose both owned ExternalPortServerPool instances in finally blocks immediately covering all work after creation. Status: implemented; all existing assertions retained.
- [x] Run the identical bounded native-exit probe. Status: GREEN; four tests pass and Node exits naturally with code 0.
- [ ] Independent review of scope, assertions and actual natural exit. Status: pending another reviewer.
- [ ] Commit and integrate this partial fixture repair. Status: pending orchestrator; no commit by fixer and no issue closure claimed.

## Controlled RED and GREEN

Setup: `npm ci --no-audit --no-fund` exited 0, installing 580 locked packages.

Both probes executed this exact child command:

```text
node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles --runTestsByPath test/security/req-08-admin-cert-hotapply.test.ts
```

A Python parent used `subprocess.Popen`, captured output and waited with `communicate(timeout=25)`. It called `kill()` only on its own child if that deadline expired. The probe's acceptance requires both passing assertions and natural Node exit 0; an assertion-only PASS is insufficient. There is no `--forceExit`, timer unref, warning suppression or process-wide exception handler.

RED, before any test edits: owned Node PID 80068; all four assertions passed (Jest 11.414 seconds), but Node remained alive at 25 seconds. The parent terminated only that child and reported `NATURAL_EXIT False EXIT 1 SECONDS 25.032`, exiting 1. The earlier identical probe also reached its deadline, but a cp949 observer encoding error prevented useful output capture; it was not used as the retained RED evidence. The UTF-8 observation above is the authoritative reproduction.

Case 5 formerly stopped only its listener, leaving the pool's interval alive; case 6 never disposed its empty pool. The existing `dispose()` API clears the pool resources and is reused for both. In case 5 the finally scope now includes the port-selection/startup loop, and in case 6 it includes certificate generation, so errors after creation also trigger disposal. No assertion, certificate verification, port-selection policy or production behavior was changed.

GREEN, same command and 25-second watchdog: owned Node PID 116772; four assertions passed (Jest 10.842 seconds). Node exited naturally: `NATURAL_EXIT True EXIT 0 SECONDS 14.261`. The watchdog did not terminate it.

Proposed commit title: `test: TLS 인증서 교체 픽스처의 풀 자원 정리`.
