# Issue #49 — Natural test entrypoint termination

Status: complete; sourcea37eff77 -> main58f71969ef2df77bb729e21cb4b709b4c61d8acb pushed00295e; root integration2suites8PASS3.371s. CLOSED2026-09-09T01:18:32Z comment5594288240, Telegram4001(68/63). Actual ordinary Job3 PASS878/4 default skips, coverage PASS877/5 lifecycle/default skips, and local CI-equivalent supply-chain PASS48/4 default skips all exited naturally0. Job1/Job2 failures and checkout/fixture/argv corrections remain separate historical evidence. #52 whole-source coverage and #58 semantic verification are not completed by these results.

- [x] Read current entrypoints, approved full-entrypoint research and existing CI test pattern. Status at initial inspection: two npm flags and one workflow flag existed; YAML parsing/actual manifest assertions reused.
- [x] Observe all three actual forceExit contract failures before edits. Status:ef1efc naturalexit1,3FAIL0.365s; both npm commands and workflow actual strings contained the forbidden flag.
- [x] Remove only three flags and verify contract. Status:2cb416 naturalexit0,2suites5PASS0.422s including existing CI workflow test; no other argument changed.
- [x] Complete preflight and candidate/fixer reviews. Status: locked admin dependency setup, manifest preservation and independent reviews completed before final runs; final evidence review and root commit completed; see operational completion below.
- [x] Run actual ordinary/coverage and CI-equivalent entrypoints. Status: all three final commands naturally exited0, recorded separately below.

Writable: package.json test/test:coverage --forceExit removal, corresponding
.github/workflows/supply-chain-audit.yml flag, dedicated test/ci/natural-test-exit.test.ts
and this ledger only. Preserve detectOpenHandles, complete test selection, coverage
provider/floors, dependencies and existing online-default skips. Source/runtime and
unrelated tests remain unchanged. Real full ordinary12% case(c) is authorized once
by root's existing goal scope; explicit #64 seven-percent experiment is never run.
No benchmark-specific command, env-forged skip, threshold reduction or retry to green.

Existing bounded #49 diagnoses, original observer failure/native-exit-unobserved,
machine false versus manual descendant-absence assessment remain separate evidence
in the research/observer roots. Do not rewrite those receipts into full acceptance.
Only future owned temp paths are used; denied historical paths/unknown bootstrap
artifacts are not read, moved or deleted. Never terminate Node by name; any owned
termination requires current PID/commandline/task ownership verification.

## Frozen flag candidate and preflight

RED command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/ci/natural-test-exit.test.ts.
GREEN command adds test/ci/code-regression-workflow.test.ts. Exact manifest/workflow
assertions preserve detectOpenHandles, coverage selection and supply-chain path;
this is config fidelity, not full natural-shutdown acceptance. Three flags only
removed; package lock/dependencies/Jest configuration/floors unchanged.

Preflight e410fb (metadata only) preserved E
C:/Users/beom/AppData/Local/Temp/natural49-preflight-CA5NFw. Node v24.16.0/npm11.5.2;
node version/npm version/npm ls depth0/showConfig/listTests all exit0. Installed
Chromium executable C:/Users/beom/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe
exists. New contract adds one discovered suite:138 versus original137, not narrowed
selection. Provider babel,16-file collectCoverageFrom and existing global60lines/
60statements/50functions/50branches retained. Online/coverage/TLS-sensitivity env
selectors were unset. Static scan/source/report helper contracts remain as reviewed:
#60 canonical mkdtemp report roots only; four online audits default-skip; failure
fixtures use owned children/loopback registry; admin tests use actual Chromium/Vite
and native owned listeners. No old denied/unknown artifact was inspected or removed.

Blocking prerequisite discovered: admin/node_modules/vite/bin/vite.js is absent in
this fresh control worktree. No install performed; root must arrange locked admin
availability before full execution. Raw metadata stdout/stderr and summary.json are
preserved. The npm metadata calls used fixed literal argv through npm.cmd shell,
which emitted Node DEP0190 warning; no user text or shell substitution was supplied.

Full ordinary/coverage are not executed. Root must signal serial execution after
independent reviews and dependency preparation, avoiding simultaneous #53 diagnosis.
Existing ordinary12percent case runs unchanged once with the full command; no
explicit7percent timing experiment. Unexpected assertion/native/timeout/coverage
failure will be preserved and classified, never retried into success without a
justified scoped change. No production or process termination performed.

Four-file candidate:package.json, supply-chain-audit.yml, dedicatedCItest, this ledger.

Proposed exact title: `test: 테스트 실행의 강제 종료 제거`.
Root subsequently authorized locked admin npm ci in this owned worktree, preserving
manifest/lock hashes, with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 only for that command.
Execution still waits for root's serial start signal after #53 diagnosis; no install
or browser download has occurred. Review candidate remains frozen.

## Locked admin prerequisite completed

After root confirmed #53 diagnostic terminal and released this setup step, actual
`npm ci --prefix admin --no-audit --no-fund --prefer-offline` ran in this worktree.
Admin manifest was read first: no lifecycle install script is declared. The only
task override was PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 for the install child.
Receipt77162f naturally exited0;101packages added, native close code0/signalnull,
1996ms. Existing always-auth npm warnings were preserved.

Evidence: C:/Users/beom/AppData/Local/Temp/natural49-admin-install-jqTr9v contains
raw stdout/stderr, command/result, and before/after SHA256 for root/admin manifests
and lockfiles. All four hashes are unchanged. Read-only final check confirms admin
Vite executable and existing Chromium executable both exist. No dependency files
were copied from another worktree, no browser download or original-workspace edit.
The earlier missing-Vite checkpoint remains historical. At that setup checkpoint full npm ordinary/coverage
still awaited independent candidate reviews and root's explicit serial run signal.

## First full ordinary nonpass and assigned fixture/observer correction

Status: root reports full92244/061954 terminal:138suites136PASS/1FAIL/1skip,847tests842PASS/1FAIL/4skip,1041.787s; nativeexit1/outer1043.493s. Preserve rawstdout/stderr and secondary outputFile ENOENT; no JSON result is reconstructed as an original receipt. This is not full #49 acceptance.

- [x] Independent failure classification. Status: review_cert_conflict identified handler-map-lifecycle control driver's missing data.sessionID while current admission requires both handler/session identities. Existing full failure is actual RED; no production #26 regression inferred.
- [x] Separate fixer minimum fixture correction and selected regression. Status: fix_lint_diagnostics added only data.sessionID=packet.sessionID before real pool admission in handler-map-lifecycle-driver.ts. Existing handlerID, owner-release/survivor assertions unchanged; no production repair. d0bdf1 selected two suites8PASS3.239s; that shell also listed evidence files afterward. b0a180 then recorded an explicit direct-child result (status0/signal null/no spawn error, outer4.371s) with the same two suites8PASS3.071s and raw outputs, to make native exit provenance unambiguous. This repeat adds exact process evidence after a PASS, not retrying a failing behavior into green.
- [x] Reproduce outputFile quote error with an owned npm argv fixture before external observer edit. Status:26cd12 naturalexit1; original cmd launch passed literal quotes and split a space-containing path into two args, output absent. Fixed external observer adds only windowsVerbatimArguments:true to that same cp.spawn(cmd,/d,/s,/c,command) options.14cb9b actual npm fixture runs with space/no-space paths both naturalexit0, exact four argv values and output file contents match. No project full npm rerun; separate observer/path error from assertion failure/nativeexit.
- [x] Independent reviews/root signal before another full run. Status: subsequently completed; this earlier checkpoint was pending. At that historical checkpoint, full ordinary and coverage were not yet passing entrypoints; the later successful commands are recorded separately below.

Correction evidence `C:/Users/beom/AppData/Local/Temp/natural49-argv-fix-x5VBSB`: manifest/observe-before.cjs preserve the original full observer, observe-fixed.cjs is its one-option correction for future approved use; red-result.json/rawstdout/stderr and green-result.json/two fixture outputs preserve actual argv behavior. A new owned package with only `test: node argv.cjs` was used; no dependencies/install or project tests were executed through npm. GREEN executed the actual spawn line extracted from the fixed observer with only fixture cwd/command, not the full observer top-level. All command text was fixed task-owned input; this is not a general untrusted-command quoting API.

The original `natural49-ordinary-FbW8Oc` observer, launch, machine result, rawstdout/stderr and absent Jest JSON remain untouched. Original native1 cannot be decomposed retroactively into a new Jest exit receipt: raw summary records the assertion failure and later stderr records outputFile ENOENT. Fixed quoting proves future exact path delivery only; it does not create the missing original JSON or erase full92244 failure. selected-result.json/stdout/stderr preserve the final scoped direct Jest command `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/handler-map-lifecycle.test.ts test/ci/natural-test-exit.test.ts`.

Additional repository write is only the one-line driver identity correction plus this ledger; existing forceExit candidate files unchanged. Full-run modified reports/req-01-chi2.json and reports/req-01-entropy.json are outside the candidate and were not altered by this fixer. No process termination, benchmark, whole npm test or coverage rerun occurred. Candidate and fixed external observer are frozen for independent review; root controls next full execution and commit.

## First full ordinary execution ? historical actual nonpass

Root authorized one unchanged ordinary entrypoint after two candidate reviews, locked admin installation and #53 diagnostic terminal. Actual command: npm test -- --runInBand --json --outputFile <E>/jest-result.json. E=C:/Users/beom/AppData/Local/Temp/natural49-ordinary-FbW8Oc. Source bfa210f plus four-file candidate/manifest/lock/config hashes preserved in freeze.json before launch. No environment overrides or test selection filters. Existing online mode unset; four audit cases skipped under normal policy.

Owned observer66492 -> cmd56732 -> npm59304 -> cmd57312 -> Jest64956 was captured by PID/creation/parent/command line. Launch f9d206/session92244 at2026-09-08T14:39:54.642Z; terminal061954 at14:57:18.135Z, native command exit1/signalnull, outer1043.493seconds, timeoutfalse, terminationPerformedfalse. Fixed work1800s/grace30s budgets were not reached.

Actual raw Jest summary:138 discovered suites,136passed/1failed/1skipped;847tests,842passed/1failed/4skipped;1041.787seconds. The sole assertion failure is test/component/handler-map-lifecycle.test.ts control callback replacement case, child driver.ts57 expected1/actual0 with childstatus1. No assertion was changed/retried. Existing req04 constant-time suite passed during this ordinary run; the explicit #64 seven-percent experiment was not invoked.

Separate output-artifact failure: Windows cmd/npm argument reconstruction retained literal quotes around the requested JSON path. After the complete test summary, Jest reported ENOENT trying to open a quoted path under cwd. Requested Jest JSON was not written. Original stdout.txt/stderr.txt and observer result.json remain unchanged; supplemental-summary.json transcribes the actual raw summary and marks the absent artifact rather than claiming JSON verification. This infrastructure failure does not erase the independent actual test failure or justify rerunning the entire suite automatically.

Periodic captured ancestry snapshots and final post-exit-per-identity.json cover14 observed identities, not complete dynamic descendants.12 PIDs were absent; two were reused with different creation/parent identities, so the original observed identities were absent. Those new unrelated processes were neither signaled nor modified. An earlier post-exit-cim.json had incorrect array grouping and is preserved as superseded observation; per-identity record corrects it. No unknown executable/command values are invented.

At that first-run checkpoint no coverage command had run and full ordinary remained FAIL; root must independently classify the handler-map failure and approve any scoped repair/affected verification. Output-path launch syntax must be corrected before future authorized commands without replaying this run or relabeling it PASS. Candidate package/workflow/test files stayed unchanged throughout. This ledger update occurs after the frozen execution checkpoint.


## Job2 queued-terminal fixture synchronization correction

- [x] Preserve root-reported Job2 failure. Status: A queue0, B33/total33, local1, held targetSID8 and remoteConsumed0 were observed before the endpoint-map assertion failed. This is not yet evidence of a product regression; data-handler terminal and endpoint native terminal are separate callbacks. Original Job2 raw failure remains unchanged.
- [x] Minimal fixture correction. Status: capture the actual owned endpoint identity and native end/close observers before data terminal trigger. Preserve immediate queue/owner/notification/B assertions, then use the unchanged until3000ms contract for that endpoint terminal plus map removal while remote CloseSession remains held. No production/deadline/expected-value change.
- [x] Selected first observation and related regression. Status: unchanged30s existing Jest case budget and until3000ms. Exact selected command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/data-terminal.test.ts --testNamePattern "queued target terminal"`. a2bbff naturally exited0:1PASS/5filtered4.021s, no live handle. Actual facts in `C:/Users/beom/AppData/Local/Temp/data24-queued-7SSuBz/facts.json`: owned endpoint end+close/mapfalse, barrier elapsed0ms (already complete when reached), remoteConsumed0; A0/B33/total33/local1 and held targetSID3. Release then remoteConsumed1/local1/B-ownedtrue/total0. This supports fixture synchronization classification, not a reproduced product regression or guaranteed timing under all load.
- [x] Scoped regression natural completion. Status: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/client/data-terminal.test.ts test/component/client/client-owner.test.ts`; e1ec1c/session42363 through terminal4fe00b exit0,2suites18PASS56.281s. Queued-case evidence `data24-queued-OnXXqY` is separate from the selected observation. No full npm/coverage/build or retry of a failing selected run. Production diff is empty; only the assigned test case and this ledger were edited by this fixer.
- [x] Independent fixture review/root next-run decision. Status: two independent reviews passed and root authorized Job3; root owns integration and full entrypoint execution. Original Job2 failure remains an actual failure, not retroactively relabeled PASS.


## Final actual entrypoint evidence

- [x] Preserve Job2 nonpass and correct checkout input. Status: natural49-final-ordinary-pmNcqY,3369/8efb05 native1/timeoutfalse,138 suitesPASS/2FAIL/1skip;860testsPASS/18FAIL/4skip,1205.584s/outer1207.777. Seventeen failed SRS assertions used CRLF checkout bytes; one data-terminal assertion observed endpoint map before native endpoint completion. Neither failure is relabeled. Original reports and SRS input bytes/SHA remain in that evidence root. Exact two SRS files were restored from verified HEAD raw bytes only:651898...49d and364071...657;83620/8a6576 then18PASS33.929s and readonly366 validator71461b exit0. No validator hash/expectation weakening.
- [x] Ordinary Job3. Status: natural49-job3-Erb8BN,86380/28de47 native0/signalnull/timeoutfalse,141 discovered suites140PASS/1skip;882tests878PASS/4skip;1154.532s/outer1156.716. Actual command `npm test -- --runInBand --json --outputFile <E>/jest-result.json`. Four normal offline audit skips; ordinary timing case unchanged. Raw stdout/stderr, genuine Jest JSON, launch/result/freeze retained. Captured15 process identities were absent afterward:10 PID absent and5 reused with different creation identities. No termination and no claim that every transient descendant was observed.
- [x] Actual coverage. Status: natural49-coverage-HkSwFB,67466/3aa5b9 native0/signalnull/timeoutfalse,140suitesPASS/1skip;877testsPASS/5skip,1131.176s/outer1132.990. Command `npm run test:coverage -- --runInBand --json --outputFile <E>/jest-result.json --coverageDirectory <E>/coverage`. Actual npm lifecycle naturally skips the existing12-percent timing case plus four offline audit cases; no environment overrides. Existing16-file collection/provider/floors unchanged: lines84.35,statements83.43,functions93.22,branches74.84 percent. This is not #52 all-source coverage. All6 captured identities absent afterward; no termination.
- [x] Local CI-equivalent supply-chain command. Status: natural49-ci-oxwkzD,75635/a60d79 native0/signalnull/timeoutfalse,8suitesPASS/1skip;48testsPASS/4offline skips,12.827s/outer15.215. Command `npx --no-install jest test/supply-chain/ --detectOpenHandles --runInBand --json --outputFile <E>/jest-result.json`. Fixed180s work/15s exit; no install/online override. Raw logs/JSON/result preserved. The live ancestry query arrived after this short command ended and produced no snapshot; later exact launched observer59812/cmd36164 PIDs were absent. Missing initial-cim follow-up attempt ba57cb is not descendant evidence. No complete dynamic-child shutdown claim is inferred from that observation.
- [x] Final independent evidence review/root commit. Status: subsequently completed as recorded below; at the earlier frozen checkpoint: no further full run or coverage requested. Frozen candidate: package.json, supply-chain-audit.yml, natural-test-exit.test.ts, handler-map-lifecycle-driver.ts, data-terminal.test.ts and this ledger (six paths total; two package script flags plus one workflow flag). Production behavior unchanged.

All final evidence directories are under C:/Users/beom/AppData/Local/Temp. Each final run preserves input hashes and launch argv, and ordinary/coverage retain after-inputs equality. Before subsequent runs, both generated reports were copied byte-for-byte with hashes into the preceding run's new subdirectory, without deleting or reverting reports. SRS files and generated reports are excluded from candidate commit. Read-only6b3c2b confirmed SRS working bytes, HEAD blobs and index blobs all equal original hashes; git raw diff/numstat is empty despite status M, consistent with stale index/stat reporting rather than content changes. No index refresh, general renormalization, stash or unrelated restore was performed. Job1/2, all observer errors and earlier assertions remain historical nonpass.


## Final independent execution review

- [x] Review final code, exact title and complete execution evidence. Status: review_large_transfer and review_cert_conflict verified the candidate and raw ordinary/coverage/CI results. The remaining historical-status wording was clarified without source/test changes. Native exit0 is observed; no claim of exhaustive ancestry tracing or whole-source52 coverage is made.
- [x] Root commit/integration/push/closure. Status: complete; the following operational completion receipt supersedes this historical pending checkpoint. Exact reviewed title: test: 테스트 실행의 강제 종료 제거. Commit only package.json, supply-chain workflow, two lifecycle fixtures, CI contract and this ledger; preserve generated reports and unchanged SRS checkout separately.

## Root completion operations

- [x] Independent final review, integration and push. Status: sourcea37eff77 -> main58f71969ef2df77bb729e21cb4b709b4c61d8acb, push00295e; root selected2suites8PASS3.371seconds, separate from actual full ordinary/coverage/CI above.
- [x] Close and notify. Status: CLOSED2026-09-09T01:18:32Z comment5594288240; Telegram4001(68/63). Job1/Job2 FAIL, default skips,16-file coverage limit and bounded process-observation limits remain preserved. #52 and #58 are separate incomplete gates.
