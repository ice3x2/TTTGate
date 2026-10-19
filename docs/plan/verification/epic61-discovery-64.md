# Discovery #64: inconsistent timing verification

Status: complete as verification-method repair; fresh ordinary regression and final evidence review passed, commit b093dce pushed, issue closed and notified. Empirical diagnostics remain inconclusive. Parent: #61.

During #63 full regression, `test/unit/util/req-04-timing-safe-string-equal.test.ts` failed its unchanged 7% timing-bias limit with 15.779504%. Binary packaging was concurrent. A later focused run reported 1.524376% with the same runtime comparison code. The full-run failure is retained in orchestrator/worker tool output; the JSON report is overwritten by each run. Neither temporal correlation proves load caused the failure nor the later pass proves the runtime comparison safe.

The test measures 11 alternating early/late mismatch batches, each with 100,000 calls, then compares separate medians. Ordinary scheduling, allocation and measurement-order effects require investigation. #59 concerns lint subprocess exit/timeout behavior and is a distinct issue.

- [x] Preserve both observations and inspect sampling/order/noise sensitivity. Status: complete; original failure, focused observation and later raw diagnostics remain distinct.
- [x] Independently review the proposed measurement and ordinary CI security/correctness checks before code changes. Status: approved by `review_wave0` and root before implementation.
- [x] Write failing regression first and implement the accepted methodology without loosening 7%, swallowing failures or retrying to obtain green. Status: method review PASS after RED-first denominator/instrumentation repairs and independent fixer changes; 19 dedicated contract/guard tests independently passed.
- [ ] Rerun meaningful deterministic checks and the explicitly controlled timing experiment, then independent review and normal issue completion gates. Status: dedicated controls and semantic checks passed; actual diagnostics retained as INCONCLUSIVE. Fresh ordinary full regression and final evidence/commit/push/closure passed; see the #64 issue ledger.

Execution order is #63 implementation, #64 repair, then #63 final full regression and closure. This supersedes the issue's initial suggestion to defer this work alongside #59/#60; root orchestration explicitly requires immediate resolution of the current verification failure.

## Accepted result disposition

The first explicit experiment remains FAIL (10.395414% when reanalyzed with the restored original mean denominator). The preregistered five-group run was INCONCLUSIVE because identical-input hex noise exceeded 7%. The single separately approved, unchanged-method CPU-affinity run was INCONCLUSIVE because the decoded-Buffer target interval extended above 7%, despite its pooled bias being below 7%. These are not benchmark passes. The affinity launcher's outer exit 0 is not measurement success; native exit was unavailable and the raw report says INCONCLUSIVE.

Root accepted closure against #64's actual criteria: investigate unreliable measurement, provide deterministic ordinary CI regression and a defensible explicit fail-closed experiment, retain the 7% metric, preserve all outcomes and obtain independent review. A conclusive physical constant-time demonstration is not added to those criteria. Fresh ordinary full regression and final truthful result-documentation review passed; current-host empirical timing remains inconclusive. No further timing runs or condition tuning are planned. See `epic61-runtime-review.md` for independent review evidence and report identifiers.
