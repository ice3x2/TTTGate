# Issue23 consistent native client keepalive

Status: validRED then minimum implementation/focusedGREEN complete; related6suites43PASS/buildPASS, frozen for two independent reviews. Root assigned control fix/epic61-client-keepalive at286feff; production3files only. Main current assignment must be recorded before source.

- [x] Original23/approved resolver design and existing reuse read. Status: extract existing shared keepalive checks only, reuse factory/real peer fixture, no whole-option normalization in TunnelClient.
- [x] Actual RED. Status:96992/3ee84b naturalexit1,15failed22.303seconds before all source writes.
- [x] Minimum implementation. Status: main assignment current top/Resume/row confirmed0c2f49 before source; three approved files only.
- [ ] Two independent reviews. Status: focused/regression/build PASS below; no commit.

Exact resolver(value:unknown,warn=defaultWarn):number; default10000,undefinedsilent,0disabled,negative/invalidonewarningfallback. Caller clone only keepAlive; host/port/memory untouched. Existing factory sets native keepAlive=false for0 and clamps initialDelay500. No blackhole timing, heartbeat,TTL,18/28/29/40 policy claim.

## Current execution checkpoint

RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/keepalive-options.test.ts`. Baseline96992/3ee84b naturally failed15 in22.303seconds: six missing-resolver contracts, caller-reference clone assertion, and eight actual CLI/direct control/data option matrices. Real authenticated control and data echo completed before the option assertions; data fallback60000 differed from intended0/positive/default and CLI default/negative used0. No setup/import exception was accepted as RED.

Only afterward implementation extracted existing keepalive conditions into the shared exported resolver, changed DEFAULT_CLIENT_KEEP_ALIVE to10000, reused that constant in ClientApp and removed its duplicate invalid/negative warning branches, and cloned only keepAlive in TunnelClient while passing it through shared makeConnectOpt. Existing host/port/memory behavior is untouched. Focused97847/e375a7 naturally passed15 in22.257seconds.

Test-only logger delegates then strengthened once-warning assertions for CLI/direct paths, restoring original logger functions in finally. Related35026 is currently running: dedicated15 cases plus existing option-range, configured-keepalive, insecure-TLS YAML, TLS settings and owner lifecycle tests, followed sequentially by forced build. No duplicate execution launched and no final related/build PASS yet. Current progress receives another ledger update when the owned handle ends. #23 tests invoke the actual CLI loadClientOption entrypoint via its existing test export, then create a real client; they do not claim a spawned CLI process.
## Final frozen verification

- [x] Related regressions and forced build. Status:35026/4d34f4 six suites43testsPASS67.478seconds; sequential `npm run build -- --force` completed f664a1 naturalexit0. Existing npm always-auth warnings only. No live handle remains. Focused15PASS22.257 and related43PASS are distinct executions, not a synthetic58-test result.
- [ ] Two independent reviews/root integration. Status: frozen five files; ClientApp.ts, TunnelClient.ts, types/TunnelingOption.ts, dedicated keepalive-options.test.ts and this ledger. No commit.

Related exact command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/keepalive-options.test.ts test/unit/client/req-15-option-range.test.ts test/unit/client/TunnelClient.keepalive.test.ts test/unit/client/req-02-insecure-tls-yaml.test.ts test/security/req-02-tls-settings.test.ts test/component/client/client-owner.test.ts`.

Actual factory observer delegates the original native options factory; both real control/data connections authenticate/echo for CLI/direct absent,0,23456,-1. It observes keepAlive boolean, initialDelay and verification option, with same resolved keepalive both paths. Logger delegates prove exactly one keepalive normalization warning for negative and zero otherwise; originals restore in finally. Resolver tests include NaN/string-invalid and undefined-silent; caller object clone test preserves unrelated invalid host/port/memory fields exactly. CLI parsing still uses existing parseInt/floor; no new CLI argument grammar. No actual packet-loss, blackhole detection duration, heartbeat, TLS downgrade, TTL or18/28/29/40 policy claim. Existing factory min500 initialDelay for disabled0 is irrelevant to its false keepAlive boolean and remains unchanged.

Exact proposed title: `fix: 클라이언트 제어·데이터 연결에 동일한 keepalive 적용`.
## Root-confirmed final independent reviews

- [x] Two independent reviews. Status: root confirmed review_wave0 and fix_lint_diagnostics both returned full PASS with zero Critical/High/Medium/Low findings and exact-title PASS. Neither reviewer performed additional test execution. These are results from two other reviewers, not author self-verification.
- [ ] Root commit/integration. Status: pending; source/tests remain frozen. This update changes only the ledger and author performs no commit or process termination.

Exact reviewed title: `fix: 클라이언트 제어·데이터 연결에 동일한 keepalive 적용`.