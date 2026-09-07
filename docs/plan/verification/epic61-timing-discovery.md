## Observation

During #63 Node 24 migration verification, the full Jest run failed the wall-clock timing-bias assertion in `test/unit/util/req-04-timing-safe-string-equal.test.ts`: expected bias below 7%, observed 15.779504%. Binary packaging was running concurrently. A subsequent single focused run, after packaging finished, passed the unchanged threshold with bias 1.524376%. The runtime comparison implementation was not changed by #63.

This does not establish load as the cause or prove the comparison implementation safe. It demonstrates inconsistent verification outcomes requiring independent investigation. The report file is overwritten by each run, so retain the first failure's tool output in the issue evidence rather than presenting the later pass as the only outcome.

This differs from #59, which concerns a lint child-process exit/timeout assertion.

## Acceptance criteria

- Reproduce and investigate the timing test's noise/order/sampling sensitivity before changing it.
- Use a meaningful deterministic correctness/security regression for ordinary CI and a defensible timing experiment with explicit execution conditions where timing is measured.
- Do not simply loosen the 7% threshold, suppress failures or retry until green.
- Preserve failed and successful observations, and independently review any test/measurement change.

Parent: #61. Discovered during #63; schedule with the test stability work alongside #59/#60, with dedicated test/report ownership. No claim that Node 24 introduced a runtime vulnerability.
