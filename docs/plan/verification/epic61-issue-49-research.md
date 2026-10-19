# Issue #49: natural test-process shutdown acceptance

Current operations: #49, #53 and #73 are complete; their exact receipts are in their issue ledgers and ../epic-61-execution.md. This document preserves the earlier research/design checkpoint. Pending actions and no-execution statements below refer to that checkpoint, not current assignment or completion status. No original failure or approval is rewritten.

Historical research checkpoint (current execution state: ../epic-61-execution.md). Status at initial research: read-only research and proposed acceptance plan; independent review/root assignment required. Author fix_lint_diagnostics. No test, benchmark, server, coverage or process-termination command was executed. No source/script/config change. Current code was inspected after the local #72 integration; freeze an exact commit and dirty-file manifest before any future execution.

- [x] Read original #49/#52, scripts, fixtures and historical #64/#49 receipts. Status: findings below.
- [x] Define bounded natural-exit evidence and failure classification. Status: proposal, not executed.
- [x] Inspect current #60 artifact ownership and remaining execution restrictions. Status: old denied paths are not cleanup targets; this does not authorize their use.
- [ ] Independently review exact commands, selected suite inventory and watchdog ownership. Status: root gate required before running anything.
- [ ] Execute approved per-suite diagnosis, repair actual findings through separate scoped TDD, then aggregate shutdown validation. Status: unassigned.
- [ ] Remove reviewed forced-exit switches and verify actual entrypoints; hand off to #52 coverage. Status: conditional gates below, no removal authorized by this document.

## Observed scope and historical boundaries

[Original #49](https://github.com/ice3x2/TTTGate/issues/49) asks to remove forced exit so retained resources are visible. Passing test assertions alone does not establish shutdown. `package.json` currently defines `test` as `jest --detectOpenHandles --forceExit` and `test:coverage` with those options plus `--coverage`. `.github/workflows/supply-chain-audit.yml:106` also explicitly uses `--forceExit`; `.github/workflows/code-regression.yml` runs `npm test -- --runInBand`. A package-only edit would leave the supply-chain lane forcing exit. Inventory every current occurrence before assigning a write set; do not modify unrelated workflow behavior.

Partial repair `8266c10cfebdfead3550e9ff63a2f26a932bf242` added finally disposal for both owned ExternalPortServerPool instances in `test/security/req-08-admin-cert-hotapply.test.ts`. Historical ledger `epic61-issue-49-tls-cleanup.md` records the same command: four assertions passed but the RED child stayed alive at its 25-second deadline; GREEN four assertions passed and the child exited naturally0 in14.261s. The earlier cp949 observation failure was excluded. That is a real fixture-leak repair, not global #49 completion. Its historical termination receipt is not a standing authorization to kill future processes without current PID/command-line/ownership checks.

#64 closed as measurement-method repair; its FAIL/INCONCLUSIVE experiments remain nonpass. Do not rerun timing experiments, relax their threshold, alter affinity or search for a passing condition under #49. The ordinary `req-04-constant-time-compare.test.ts` still contains a timing case: it skips under its existing coverage conditions and otherwise runs. A default ordinary full run would include it. A passing historical ordinary run with forced exit does not establish natural shutdown, and a timing assertion failure is not proof of a leaked handle.

`test/helpers/resourceStats.ts` supplies useful counters, not process-exit evidence. `test/helpers/tunnelHarness.ts` owns client/server/echo cleanup. The former payload retry path was corrected by completed #48; the current helper uses a single-attempt full-FIN exchange. #54 currently owns the multi-client harness candidate. Do not overlap that writer. `test/helpers/smokeProcess.ts` uses a real spawned child, but `waitForExit` races an exit promise against a timeout without canceling the losing timer. A fast child can therefore leave the observer timer pending; its `kill` helper also lacks the current explicit command-line verification. These are static audit candidates, not reproduced causes or authorization to change shared helpers. Prefer a small reviewed external process observer whose own deadline is canceled on child close; request exact scope before adding it.

## What constitutes a positive shutdown receipt

For each child record: exact source commit/dirty hashes, executable and Node version, argv, cwd, relevant environment differences, selected tests/name filters, PID and creation/ownership record, start/end timestamps, stdout/stderr, Jest result JSON, child exit code/signal, deadline value, and whether any termination occurred. Use fresh canonical owned evidence directories outside roots scheduled for cleanup. Preserve failure receipts before any approved cleanup.

PASS requires completed expected tests, no unexpected skips, Jest success, child `close` observed with exit0/signal null before its declared deadline, drained captured stdout/stderr, and no watchdog/force-exit termination. Treat the worker's final test summary and process closure as separate facts. Check any task-created descendants also exited, including spawned drivers and browser helpers; parent exit alone cannot prove an orphaned child exited. Track descendants as they are created rather than guessing ownership from a process-name snapshot.

At the suite's own teardown, observe its owned listeners, sockets, timers/pools and child handles released, with concrete identities/counters where available. A process can exit despite an unref'd timer or detached child, so natural exit is necessary but does not replace existing resource assertions. `--detectOpenHandles` diagnostics and optional active-resource observations are clues, not complete leak inventories; never blindly close listed resources merely to obtain exit0.

Watchdogs are failure detectors, not successful cleanup. Register them before execution, using known case budgets and observed setup/teardown costs rather than repeatedly increasing them. A deadline must cover actual selected test work and a separately declared post-summary shutdown grace. Freeze numeric budgets per selected inventory at root approval; this research has not measured a new full-run duration. Keep user updates/poll intervals at most60s even when a child runs longer. Cancel observer timers after normal exit. An assertion failure that exits naturally remains FAIL; a passing Jest summary without child exit is NONTERMINATING/FAIL; spawn/setup errors and coverage-threshold failures have their own labels. Do not retry a known failure until a scoped change or independently explained external correction justifies a new run.

Before any required termination, verify the exact live PID, current command line, start/parent ownership against this task's spawn record. A reused PID or uncertain child is not eligible. Never `taskkill /IM node.exe`, `Stop-Process -Name node`, kill a user's service, or terminate another agent's process. Each descendant needs its own ownership proof. A watchdog-terminated result stays failed even after cleanup succeeds.

## Exact candidate commands and staged approval

The following commands are proposed, not executed. Run from the isolated integration checkout after root freezes its source and permissions. `<E>` is a newly owned evidence directory; `<SUITE>` is one explicit approved repository-relative path. Shell implementations must pass these as structured argv or properly quoted literal paths, not concatenate untrusted command text.

1. Inventory/configuration only:

   `node node_modules/jest/bin/jest.js --showConfig`

   `node node_modules/jest/bin/jest.js --listTests --runInBand --json`

   Preserve both outputs, compare discovered suites with the committed configuration and classify those requiring network, native processes, platform conditions, timing or denied-path review. Inventory is not test success. Do not install/update dependencies during diagnosis; record the locked tree already present.

2. Initial positive control, subject to explicit approval:

   `node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles --runTestsByPath test/security/req-08-admin-cert-hotapply.test.ts --json --outputFile <E>/tls-cleanup.json`

   This revisits the integrated partial repair, not its old source. Use the recorded25-second historical watchdog as context, not an automatic new deadline; approve the current budget first. Preserve any failure without rerunning to turn it green.

3. Per-suite isolation for the approved inventory:

   `node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles --runTestsByPath <SUITE> --json --outputFile <E>/suite.json`

   Spawn a fresh owned child per suite, serially. Use unique output paths. Explicit filename/name selection must be recorded; filtered or platform-gated suites remain uncovered. This localizes resource owners and distinguishes a suite leak from aggregate state interactions. A passing subset cannot authorize claiming all tests naturally terminate. Cases whose own child deliberately fails can pass only if their contract explicitly expects that failure and reaps that child; retain both levels of status.

4. Full aggregate ordinary and coverage candidates, only after the entire selected inventory and timing/path/online prerequisites receive explicit approval:

   `node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles --json --outputFile <E>/ordinary.json`

   `node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles --coverage --coverageDirectory <E>/coverage --json --outputFile <E>/coverage.json`

   These commands have no `--forceExit`. Do not run the ordinary aggregate now: it includes the timing case and previously restricted req04 test. Do not set COVERAGE or forge npm_lifecycle_event to silently skip timing in an allegedly ordinary run. Root may separately authorize an explicitly named non-timing suite/case matrix, but it must be labeled partial; arbitrary test exclusions cannot satisfy the exact final `npm test` contract. Preserve full-run ordering effects; per-suite PASS is insufficient for the combined invocation. The coverage candidate uses the existing configuration only; its currently narrow denominator is not whole-source #52 acceptance.

## Artifact and process preflight

The integrated #60 req04 lint case creates a fresh `createArtifactRoot('req04-artifacts-')`, passes that root to the scanner, and writes its filtered report there; finally cleans that captured root. Req09 lazily creates its separate `req09-artifacts-` root and cleans it after harness disposal. `artifactRoot.ts` records realpath(mkdtemp), checks lstat real-directory/non-symlink and unchanged realpath, then removes only that root. Neither current test enumerates or deletes the old repository `test/.tmp-req04-lint` location. This static result does not itself lift the earlier execution/cleanup restriction: obtain the concrete isolated selected-case approval before including req04. Preserve existing main/release artifacts; no deletion, relocation or alternate-tool bypass.

Audit other test subprocesses, shutdown callbacks, persistent timers and paths before full execution. A new independent worktree may contain regular source copies but must not inherit historical reports or link a denied path into cleanup scope. Use the already reviewed #60 manifest/sandbox approach if needed; preserve complete scanner src scope, read-only dependency resolution and separate R/E evidence. Do not route unknown cleanup through a broad test command.

## Removing flags and relation to #52

Once the reviewed ordinary inventory has true natural-exit and owned-resource evidence, root may authorize only the relevant `package.json` flag removal and the specific supply-chain workflow flag removal. Keep `--detectOpenHandles`, assertions, coverage settings and dependencies unchanged. New production/fixture defects require separate issue ownership and actual RED before repairs; do not add blanket unref, process.exit, forceful afterAll cleanup or swallowed exceptions to manufacture exit.

After the flag edit, verify the actual entrypoints with their real npm environment, under the same observer: `npm test -- --runInBand`; `npm run test:coverage -- --runInBand`; and the workflow-equivalent direct `node node_modules/jest/bin/jest.js test/supply-chain/ --detectOpenHandles`. Reuse a reviewed external job/watchdog deadline so nontermination is a failed job rather than endless waiting. Do not claim missing online prerequisites passed; either approve/provide them and execute the entrypoint or explicitly retain its incomplete gate. Independent reviewers inspect exact scripts/config plus process receipts before #49 closure.

#49 shutdown work precedes #52's whole-source coverage gate in the execution plan. #49 may audit natural coverage-process shutdown against the unchanged configuration, but it must not select new coverage files or lower thresholds. If the unchanged coverage command fails a threshold, that is a real separate nonpass even when it exits naturally; it cannot be called leak failure or final entrypoint PASS. Root must route its resolution without changing #52 scope implicitly. #52 then uses its independently approved full-source inventory/baseline and again requires natural exit; it cannot restore forceExit. Final epic release needs both gates. No current53/67-style count or closure increment is made by this research.

## Independent review handoff

- [ ] Review scope/commands/safety and actual known-failure mapping. Status: parent to appoint independent reviewer; this author has not self-approved this document.
- [ ] Freeze new observer and exact process/test inventory budgets. Status: no arbitrary waiting, whole-suite or benchmark execution authorized.
- [ ] Route any demonstrated helper/production leak with separate owned write set and RED. Status: static smokeProcess timer observation only; no repair requested here.

Expected final conclusion is bounded: the reviewed configured test entrypoints pass and their actual owned processes/resources terminate without forced exit. It is not proof that every possible runtime is leak-free, that #64 timing passed, that #52 coverage is complete, or that held #29 behavior works.

## Approved read-only inventory receipt and proposed diagnosis matrix

- [x] Recheck prior LOW correction. Status: completed48 is now described as single-attempt full-FIN;54 is separately identified as the then-current harness writer. No remaining finding on that sentence.
- [x] Capture metadata without executing tests. Status: root authorized HEAD/status/Node/npm dependency listing/Jest showConfig/listTests and static inventory only. Initial E C:/Users/beom/AppData/Local/Temp/tttgate49-inventory-9f01803ce6724c25a87c7a2952a47cd2 captured HEAD5637959 and134suites, but54 integration occurred before static capture ended. Preserve this mixed checkpoint; it is NOT a coherent frozen source inventory.
- [x] Recapture stable source checkpoint. Status: final E C:/Users/beom/AppData/Local/Temp/tttgate49-inventory-55b8553ead1842c6ae225999961ffbba captures HEAD-before/after both514d882d73ecf8164ba88e8f68eec0d65fc9c322. Node v24.16.0, npm ls --depth=0 --json exit0, showConfig exit0, listTests exit0,135discovered suites. Metadata command receipt190af6; static scan ca2050; timestamp2026-09-08T12:42:36.2126995Z. No suite/test/benchmark/server was executed by this inventory.
- [x] Preserve source and dirty documentation distinction. Status: tracked-file-hashes.json records512regular tracked files; status-before/after and dirty-document-hashes.json retain current docs changes independently. The untracked denied test directory is named only by git status and explicitly not traversed/read/deleted. Appended research after inventory naturally changes this document; inventory hashes describe their capture checkpoint.
- [ ] Approve numerical per-suite diagnosis/observer. Status: the matrix below is a recommendation only; no test execution/flag removal/coverage run authorized by inventory completion.

Final E contains command-status.json, head-before/after.txt, status-before/after.txt,
node.txt, npm-ls.json and stderr, jest-config.json and stderr, jest-tests.json and
stderr, tracked-file-hashes.json, dirty-document-hashes.json, static-inventory.json
and inventory-summary.json. Child stdout/stderr for listing commands are preserved
as their separate raw files. npm ls reports the installed local tree, not an audit
or proof that every transitive lock entry was validated; no installation/update.

The static scan covers every discovered suite and recursively follows resolvable
relative literal imports only. Per-suite direct matching line numbers and transitive
paths classify spawn/timer/listener/cleanup/path/timing-review/online-review clues.
It includes comments/string literals and omits dynamic/package dependency resolution:
these flags require human review, not automatic claims of leak/external execution.
Final direct counts are24spawn,42timer,38listener,92cleanup,80path,4timing-review,
15online-review; corresponding transitive counts36/72/81/102/109/61/62. Counts overlap.
The earlier mixed scan also had a broader timing regex, so do not compare its category
counts as a code-change trend. Exact final regex methodology is stored with the rows.

Recommended first serial non-benchmark inventory (each complete suite, no name filters):

| Exact suite | Expected cases from current declarations | Proposed work budget + post-summary grace | Purpose |
| --- | --- | --- | --- |
| test/security/req-08-admin-cert-hotapply.test.ts |4|90s +15s|Recheck integrated owned-pool cleanup; original14.261s receipt is historical context, not a new observation.|
| test/component/socket-owner-terminal.test.ts |7|45s +10s|Actual terminal/drain ownership and repeated callback cleanup.|
| test/component/roundtrip-once.test.ts |7|60s +10s|Owned finite response, reset/deadline and full-tunnel first-response failure evidence.|
| test/component/client/TlsVerification.test.ts |2|90s +15s|Actual rejected/trusted native TLS and owned socket teardown, no insecure mutation env.|
| test/component/multi-client-harness.test.ts |11|90s +15s|Integrated54 multi-owner and partial-startup cleanup; latest helper gate must finish first.|

These budgets are conservative proposals using declared per-case limits and prior
receipts; freeze them before execution, never retry with larger values to obtain PASS.
The post-summary grace is a separately recorded exit condition within the observer,
not an artificial child kill counted as success. Confirm expected expanded Jest
counts from result JSON when actually executed. Existing negative fixture cases
must produce their expected rejection and natural outer success. No benchmarking
case is selected; crypto use in TLS is not itself a timing benchmark.

Use a reviewed external observer before this matrix: separate source/test ownership,
absolute Node+argv/cwd, creation PID/time and current command-line evidence, captured
stdout/stderr drained through close, deadline timer canceled after close, JSON result
and descendant ownership recorded. Any deadline/failure is preserved and routed
before a scoped fix; no process-name termination. Do not use smokeProcess.waitForExit
unchanged to validate its own losing-timer cleanup. Its timer/exit-vs-close flaw
remains a static candidate needing bounded RED and separate write authorization.

Completing these five diagnoses remains partial #49 evidence; all135tests/aggregate
ordinary command, timing-gated case, online tools, browser/subprocess ownership and
coverage entrypoint require separate review/authorization. Do not remove forceExit
from package/workflow solely on subset PASS. #52 coverage denominator, #64 timing,
#47/#53 E2E and held29 remain distinct, unchanged gates. No source or Jest flags were
modified, no denied artifact operation or process termination occurred.
## Exact initial observer recommendation: reuse tool runtime

- [x] Recheck source checkpoint. Status: current HEAD83f7f3b34387eb800865f843b0d24183dee2cc38; git diff from inventory514d882 over src/test/package.json/package-lock.json/jest.config.ts is empty. The intervening commit contains documentation, so the135-suite source inventory remains applicable; do not claim the HEAD hashes themselves are identical.
- [x] Inspect five selected suite subprocess reachability. Status: none of the five suite files or their recursively resolved relative local imports contains a spawn/execFile/fork child-process call/import in the static inventory. Direct check of network/tunnelHarness/testCerts/CACertGenerator agrees. Each still uses real sockets, timers and native crypto; dependency/native internals and dynamic imports are not exhaustively proven spawn-free. --runInBand excludes Jest worker-process scheduling for this diagnosis. Do not report missing descendant evidence as proof that no child ever existed.
- [ ] Approve exact launch/metadata procedure below. Status: proposal only; no test, new observer code/file or flag edit executed/written.

Prefer existing exec_command/write_stdin orchestration; a new repository observer
or changes to smokeProcess are unnecessary for this initial matrix. Tool runtime
already supplies a live session, incremental output and terminal exit code. However,
it does not expose the launched Node PID/creation time and stdout/stderr as separate
files in every terminal result. A direct shell `node ...` may finish before a second
CIM call can discover it. Do not silently omit those evidence fields.

Minimum gap-filling procedure, implemented only as an approved per-run PowerShell
launch command rather than a new reusable source helper:

1. Allocate a fresh canonical E for that suite. Record exact HEAD/source hashes,
   cwd, Node executable/version, argument array and explicit environment differences.
   Capture the current PowerShell PID, creation time, ParentProcessId and command
   line through Get-CimInstance Win32_Process. Do not use $PID as an assignable var.
2. Launch the absolute Node executable with the frozen Jest argv using the existing
   Start-Process -PassThru -WindowStyle Hidden and separate redirected stdout/stderr
   files. Keep the returned process object/handle. Immediately capture its actual
   PID, CreationDate, ParentProcessId, ExecutablePath and CommandLine with CIM,
   compare with the launched command and shell parent, and preserve the record.
   If the process disappears before this snapshot, keep the run as metadata-incomplete
   rather than inventing creation/parent data. Do not rerun merely for a green result.
3. The shell waits on that owned process and returns its exact exit code after saving
   start/end/elapsed/status facts. Existing exec_command yields the live shell session;
   write_stdin resumes it in at most60s intervals. During live observation, read-only
   CIM checks record any observed child/descendant identities with creation times.
   Separate negative observations from a comprehensive historical descendant trace.
4. On natural child exit, drain/read the redirected files and Jest JSON, record the
   tool terminal exit separately, and require zero error/signal/termination. This
   shell has no Promise.race timer to leak. Actual suite cleanup assertions remain
   required even if native Node exits; unref/detached resources are not inferred clean.
5. Root/agent tracks the frozen total work deadline and post-summary grace using
   actual timestamps while polling. Reaching a deadline produces TIMEOUT/FAIL and
   preserves evidence; it is never converted to PASS by termination. If termination
   becomes necessary, recapture exact PID/current command line/creation time and
   task ownership before touching only that process. No automatic process-name or
   descendant-tree kill. An uncertain process remains untouched pending root action.

This is a small launch-command metadata supplement to existing tool runtime, not a
new repository observer/driver. Do not execute until independently reviewed. Existing
#47 external observer is not necessary unless separate pipe-drain/descendant tracing
requirements exceed this method; if they do, inspect/reuse its actual parent script
with its owner before proposing a new observer. The #60 R/E ownership pattern can
be reused for evidence roots without linking/deleting historical denied artifacts.

The initial five suites have no discovered local child spawning, making this bounded
observation practical. If runtime reveals descendants or a dynamic spawn path,
stop expanding the diagnosis and freeze a concrete creation/close tracker before
claiming their lifecycle. This initial matrix is partial
#49 evidence only and changes no issue count; configured ordinary/coverage full-run
acceptance, timing/online prerequisites and forceExit removal remain separate gates.
## Root-approved initial five diagnoses

Status: root approved execution after independent fix_lint_diagnostics observer review PASS. Main83f7f3b34387eb800865f843b0d24183dee2cc38, five suites in the matrix order with fixed work/grace budgets. Fresh E procedure/logs/CIM/Jest JSON; no repository helper/source/flag change, benchmark, deletion or retry. Stop expansion at first abnormal/incomplete outcome. A five-suite PASS is partial49 evidence only and does not authorize forceExit removal or closure.

- [ ] Execute suite1 TLS hot-apply90+15s. Status: observer failure; Jest assertions4PASS, native exit code unobserved. Expansion stopped, no retry.
- [ ] Execute suite2 socket-owner45+10s. Status: only after prior natural PASS.
- [ ] Execute suite3 roundtrip-once60+10s. Status: only after prior natural PASS.
- [ ] Execute suite4 TLS verification90+15s. Status: only after prior natural PASS.
- [ ] Execute suite5 multi-client90+15s. Status: only after prior natural PASS.

Windows launch validates/quotes each literal argument, retains PassThru Handle/StartTime, records CIM identity immediately, waits through HasExited/WaitForExit and reads ExitCode separately. Null exit is uncertainty/failure, never coerced0; no LASTEXITCODE or fictitious POSIX signal. Unsupported/unobserved metadata is explicit. No uncertain PID termination.
## First diagnosis: observer failure, not natural-exit PASS

Root-approved first suite actually launched once under main83f7f3b. Procedure file:
C:/Users/beom/AppData/Local/Temp/tttgate49-diagnostics-1d3627ad09ae40499a3458996099c6cd/observe.ps1.
E: same parent /01-tls-hotapply, retaining launch.json/stdout.txt/stderr.txt/
jest-result.json/observer-failure.json. Launch recorded NodePID26440, shell59008,
current CIM command line, parent/creation time and retained Handle/StartTime.

Toolfff2c5 terminated the parent observation with exit1 and no resumable session:
line20 ReadAllText(stderr.txt) raised IOException because live redirect access was
incompatible with the writer's sharing mode. No process was terminated by this agent.
Subsequent CIM query3be795 found no process at the recorded PID and found completed
output files; original native ExitCode is therefore unknown, not0 and not a natural-
exit PASS. Result JSON read e20b7e has success=true,4passed/0failed/0pending; those
are assertion facts only. Signal is not available, no fictitious POSIX null is used.

Expansion stopped at the first abnormal observation: remaining four suites were
not launched. The runner and failed evidence remain unchanged for a different
fixer/reviewer; no direct observer modification or rerun is authorized yet. A
possible minimal repair is a shared-readable FileStream, but it requires independent
scope/verification and a separate remeasurement decision. Do not use this loss of
exit-status evidence to classify a product leak or retroactively approve #49.
## Authorized remeasurement after independently repaired observer

Status: root approved a fresh five-suite serial remeasurement after two independent
reviews of the real shared-read repair. This is triggered by corrected observation
logic, not a retry to conceal a test failure. Original01 observer-failure evidence
is preserved. Main83f7f3b source is frozen until completion; only docs may change.
Fixed order/budgets and first-abnormal-stop rule remain. Observer SHA2E926EA9AAACD1BD596F5D28D679F45AD4B48A43209E988DE4587703778E97F1.

- [ ] Remeasure five approved complete suites. Status: starting fresh E, no #49 closure or forceExit-removal inference.
## Remeasurement1: native exit observed, descendant gate unresolved

Repaired observer SHA matched before launch. Fresh E:
C:/Users/beom/AppData/Local/Temp/tttgate49-remeasure-35b8e4000c6744b1ad188eb8e3e616c4/01-tls-hotapply.
Tool0559d4 returned synchronously with no live session. Exact Node62356/shell60336
identity recorded; four Jest assertionsPASS7.538s, actual ExitCode0/HasExitedtrue,
timeoutfalse, outer9.0271238s, no termination. This fixes the prior unobserved-exit
problem but is not classified PASS by the current observer.

A real direct child conhost.exe PID63328/parent62356 was captured with creation time
and command line. The observer's blanket descendants.Count===0 gate made passed=false
rather than checking eventual descendant termination. Subsequent read-only CIM found
no process at63328; descendant-after.json and descendant-after-count.json preserve
the observation/count0. Do not infer a JavaScript child spawn or product leak from
this Windows console-host observation, and do not silently rewrite original result.

Expansion again stopped at the first nonpass classification; remaining four suites
unexecuted. Root must approve/review exact observed-descendant lifecycle handling
before further diagnostics. No runner correction, retry or kill was performed by
this author. Original01-sharing-failure and this distinct remeasurement remain
separate immutable evidence. Partial49 and full-suite/forceExit gates are unchanged.
## Independent manual classification and terminal handoff

Root relayed independent review_wave0 assessment: remeasurement1 supports a bounded
manual diagnosis PASS because actual Node ExitCode0 and four assertion PASS were
observed, and the captured conhost was absent in subsequent CIM. This is not the
original automated result: result.json passed=false and its descendants.Count0
policy remain unchanged. The author does not self-reclassify that record.

Exact delayed observations: descendant-after-count.json at
2026-09-08T13:06:22.4277829Z shows PID63328 count0. Final-owned-process-cim.json at
2026-09-08T13:08:05.0038961Z shows recorded Node62356, conhost63328 and shell60336
all count0. Creation/path/command-line evidence remains in launch/result.json;
no termination occurred. These are later absence observations, not exact conhost
exit timestamps or proof its close occurred within the original grace window.
No evidence file was rewritten to remove that limit.

Root received the terminal handoff and may resume serialized main integration.
Remaining four diagnoses are still unexecuted pending independent repair/review
of the descendant-lifecycle observer contract and separate root approval. This
manual subset PASS does not complete49 or authorize forced-exit flag removal.
## Approved remaining-four checkpoint

Status: root approved remaining4 after both independent final descendant-observer
reviews PASS. New source checkpoint1370993d4339dfd4e8a09cc241ced4b4f600ff96 is frozen
for these runs. First83f7f3b suite is NOT rerun or merged into a single source freeze;
its machinefalse and independent bounded manualPASS remain unchanged. Fixed order:
socket-owner45+10s, roundtrip-once60+10s, TlsVerification90+15s, multi-client90+15s.
Observer SHA37D425D5E103C95462E8E5D211BA7709C269A166CEB3EAF935CB1544EDD89C76.
Stop at first abnormal/uncertain result; no source/flags/benchmark/delete/kill.

- [ ] Remaining4 serial diagnostics. Status: starting fresh E; each receipt/identity/HEAD and captured-child post-status separate. Partial49 only.
## Remaining-four actual outcomes on1370993

All four were launched once in the frozen approved order. Evidence parent:
C:/Users/beom/AppData/Local/Temp/tttgate49-remaining-3fc3799e4a7f47e98c57baf56afb03bf.
Each subdirectory preserves launch/CIM/argv/HEAD, raw stdout/stderr, Jest JSON and
original observer result. Runner hash37D425...89C76 was verified and copied here.

| Suite/subdirectory | Node PID | Jest assertion time/count | Native exit / observer result | Outer seconds |
| --- | --- | --- | --- | --- |
|02-socket-owner|13888|7PASS/0.469s|0 / PASS; captured63408 gone|2.3260998|
|03-roundtrip-once|51716|7PASS/10.007s|0 / PASS; captured19184 gone|11.7176078|
|04-tls-verification|18340|2PASS/2.396s|0 / PASS; captured57384 gone|4.0228646|
|05-multi-client|62392|11PASS/12.678s|0 / INCONCLUSIVE; captured61504 identity incomplete|14.3596241|

Receipts793825/c468ac/a691f8/2ec273 respectively. Third run had tool session14150;
last run had68578, both terminal. Last captured child has PID/parent62392/creation
but ExecutablePath and CommandLine null, so Get-CapturedProcessState correctly
returned uncertain under its frozen contract. Do not label it conhost by assumption
or turn result.passed=false into PASS. All native exits were observed0, timeoutsfalse,
no tests failed/skipped and no termination occurred; assertion/native facts do not
remove the descendant uncertainty. No suite was retried.

Final read-only CIM ca3f31 at2026-09-08T13:17:22.1516566Z found Node62392,
shell61424 and captured61504 each count0, saved as final-owned-cim.json. This later
absence is supplemental evidence, not an original complete identity/within-grace
receipt. Source HEAD remained1370993 through the end. Root receives terminal handoff;
no owned live tool session remains. Any manual reclassification/observer change
requires separate independent review/root decision. First83f7f3b manual boundedPASS
and original machinefalse remain separate; there is no single five-suite frozenPASS,
aggregate npm/coverage result or #49 completion/forceExit removal authorization.