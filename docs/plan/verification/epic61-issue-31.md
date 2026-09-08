# Issue #31: Host-only header replacement

Status: implementation/tests/build and two independent code/content/title reviews PASS; source frozen for root commit/integration. Root-approved process branch fix/epic61-host-header, base35a5d5f.

- [x] Read original31 and main independent HTTP research. Status: header-value substring replacement corrupts unrelated values; approved helper-only lane is independent of held29 EOF.
- [x] Check reuse. Status: HttpUtil.findHeaders already selects case-insensitive names; existing http-duplex-fixture supplies real owned sockets and bounded conditions. No new fixture.
- [x] Actual RED. Status: observed four failures before production; exact receipts below.
- [x] Minimum implementation after main assignment record and actual RED. Status: only replaceHostInHeader iteration selection changed.
- [x] Two independent reviews. Status: review_wave0 and fix_lint_diagnostics PASS with zero Critical/High/Medium/Low findings; root commit/integration pending.

Request tests check Host:a/hOsT:a/normal Host, exact Cookie/Authorization(test-only)/User-Agent/custom values at upstream, two complete Content-Length responses on a still-live connection. Response control checks Host selection and unrelated values while retaining existing explicit Location and Set-Cookie transformations. No new CORS/cookie policy, duplicate-Host validation, body, EOF, drain, pool, HttpPipe or held UI worktree changes.

## Observed TDD and frozen result

- [x] Actual RED before production. Status: 1ca74f naturally exited1,4failed0.666s. Request failures showed actual Cookie/User-Agent/Authorization/custom corruption; response showed the same plus incidental Location corruption. Its expected Set-Cookie spacing initially omitted the existing second space left by Domain removal; this fixture expectation was corrected before source implementation, preserving that existing policy. Confirmatory7375d7 naturally exited1,4failed0.591s with corrected spacing.
- [x] Main assignment gate. Status: c0fb99 read execution plan lines162/322 and root-approved bounded assignment before source write.
- [x] Minimum source implementation. Status: only replaceHostInHeader iteration changes from all headers to existing HttpUtil.findHeaders(header, "Host"). Existing substring replacement and all explicit policy helpers remain intact.
- [x] Related GREEN. Status:855e4e naturally exited0,6suites58testsPASS2.344s; four new real socket tests included.
- [x] Forced build. Status:211fcc exited0, tsc -b --force; npm emitted existing always-auth config warnings.
- [x] Independent two reviews. Status: review_wave0 and fix_lint_diagnostics PASS with zero Critical/High/Medium/Low findings; root commit/integration pending.

An attempted source edit used Python's platform-default decoder and failed before any write (aee709 UnicodeDecodeError); the following unchanged-source test again failed4 in0.537s. This is preserved as an editing failure/redundant RED, not implementation evidence. Explicit UTF-8 then applied the one-line production change.

RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-host-header.test.ts`.
GREEN command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-host-header.test.ts test/component/http-directions.test.ts test/component/http-chunk-boundary.test.ts test/unit/server/http/HttpHandler.rewrite.test.ts test/unit/server/http/HttpUtil.branches.test.ts test/security/req-05-smuggling.test.ts`.

Finite Content-Length requests/responses and existing chunked/direction/upgrade/security controls were executed; no EOF behavior or full-project test coverage is claimed. No fixed sleep proves completion. Frozen title proposal: `fix: Host 치환을 해당 헤더로 제한하여 다른 값 보존`.

## Independent review receipts

Root confirmed review_wave0 and fix_lint_diagnostics final code/content/exact-title PASS, zero Critical/High/Medium/Low findings. review_wave0 independently compared original issue/scope, one-line helper selection, real finite exchanges and historical RED/GREEN receipts.
Independent selected command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-host-header.test.ts. Execution d7182f exited0 naturally: one suite/four tests PASS,0.912seconds. The other reviewer performed no additional execution; no second run is inferred. Existing exact proposed title remains PASS. Root commit/integration/push/closure pending; source/test files remain frozen.
