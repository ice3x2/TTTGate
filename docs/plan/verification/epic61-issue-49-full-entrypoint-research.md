# #49 full entrypoint preparation after bounded diagnostics

Current operations: #49, #53 and #73 are complete; their exact receipts are in their issue ledgers and ../epic-61-execution.md. This document preserves the earlier research/design checkpoint. Pending actions and no-execution statements below refer to that checkpoint, not current assignment or completion status. No original failure or approval is rewritten.

Status: read-only source/config inventory; no suite, benchmark, install or deletion executed. Independent review and concrete full-run approval required. No new execution prohibition is created by this research.

- [x] Refresh discovery against integrated #47 main. Status: actual Jest --listTests --json --runInBand exited0 and listed137 suites; --showConfig exited0. Previous135 inventory predates the two #47 suites and remains historical.
- [x] Distinguish timing detection clues from actual measured tests. Status: findings below; transitive regex counts are not benchmark counts.
- [ ] Independently review full-run environment/process/path conditions and observer capability. Status: pending; this is the necessary preparation for full acceptance, not a replacement subset gate.
- [ ] Authorize and execute actual ordinary/coverage entrypoints once with preserved results. Status: root may assign the necessary unchanged ordinary case, current owned paths and flag repair under the existing full-goal authorization after concrete preflight; actual conflicting restrictions remain separate.

## Current command contract

Direct Jest showConfig reports forceExit=false and collectCoverage=false by default.
package.json still adds --forceExit in npm test and test:coverage. Therefore a bare
natural-exit diagnostic is not the actual npm entrypoint contract, and running
unchanged npm scripts cannot prove removal of forced exit. After reviewed shutdown
diagnostics, root must authorize the small script/workflow flag edit and test the
real npm commands with their real lifecycle environment. Do not fake lifecycle
variables, silently omit files, change provider or lower thresholds.

## Real timing versus static references

The directly executed measurement identified in discovered tests is
test/unit/server/req-04-constant-time-compare.test.ts case(c): seven samples of
UTF8 comparison using hrtime, median, threshold12%. It is ordinarily included and
uses its existing explicit coverage-detection skip. #64 deliberately left that
case unchanged. The separate seven-percent hex experiment was moved out to the
explicit timing command; its historical FAIL/INCONCLUSIVE and no-further-measurement
decision remain intact. Running npm test is not authorization to retry that explicit
experiment. test/unit/tools/timing-experiment.test.ts primarily validates recorded
classifiers/CLI instrumentation rejection; hrtime references in child source that
deliberately throws TIMING_MUST_NOT_RUN are not another successful measurement.
Crypto/TLS/key generation imports in61 transitively matched suites do not turn
them into61 timing benchmarks.

The prior session also restricted rerunning case(c) during selected artifact work.
For a full ordinary npm verification, the existing full-goal authorization permits root to freeze the concrete scope explicitly
covering this existing12% case once, unchanged, with no threshold tuning/retry to
green. This is distinct from reopening #64's explicit experiment. Ask the user only if an actual explicit session restriction conflicts with the required run; a restriction tied to earlier selected artifact work is not a permanent ban on the full ordinary entrypoint. Do not forge COVERAGE or use a name filter and call the result ordinary acceptance. Genuine coverage
execution naturally follows the test's existing coverage skip and must report it.

## External/network/browser/native child classification

- Four actual npm-audit cases use onlineTest, selected only with
  SUPPLY_CHAIN_ONLINE=1. Default npm runs legitimately skip them under existing
  policy; report those skips, not online audit success. Full offline/default script
  fidelity and separate online supply-chain acceptance are different claims.
- Supply-chain fail-closed/admin-report tests deliberately target loopback registry
  port1 or a fixture executable; this is expected-failure evidence, not live registry
  availability. npm ls reads the local installed dependency tree. Do not install
  dependencies merely to investigate these tests.
- Deploy gate tests run real npm fixture commands against newly owned manifests
  without external dependencies; their browser-install/pkg actions are declared
  stage fixtures. They do not download Chromium or build actual binaries. Actual
  admin tests instead need the already installed Playwright Chromium and Vite/Svelte
  dependencies; they fork owned servers and launch a real browser. Check executable
  availability read-only before the full run; missing tools are a prerequisite
  failure, not permission for an unreviewed install or skipped browser suite.
- Admin and tunnel integration endpoints are owned loopback servers. Strings such
  as evil.example are Origin/header negatives, not proof of outbound network use.
  The #47 wrong-name TLS case attaches to the owned server. Search strings alone
  cannot establish every dynamic target; review actual spawn/connect call sites
  in the137 inventory, including helper imports, before final authorization.
- Process fixtures spawn Node, npm/cmd, Vite and browser children. Successful output
  before exit is insufficient. Preserve child exit/signal/error and expected-failure
  semantics. An observer that sees only periodic direct children has bounded evidence,
  not a complete dynamic descendant inventory. Full subprocess/browser ownership
  review must account for that limitation without name-wide kills or whitelists.

## Paths and full-run prerequisites

Integrated #60 moved req04 lint(a) and req09 reports into verified new temp roots;
it does not enumerate/delete the historical denied test/.tmp-req04-lint directories.
Full-run authorization should explicitly permit those current code paths while
preserving the old directories. This is approval of reviewed future owned writes,
not retroactive permission to delete old artifacts. Existing admin tests can rebuild
admin/dist into fixture assets; final production asset restoration, if required,
must be explicit rather than treating a test build as release readiness.

Freeze a clean source checkpoint, actual node/npm/dependency versions and browser
binary availability; keep concurrent source writers out of that checkout. Preserve
original user/worktree files and unknown bootstrap artifacts. Confirm all137
discovered paths remain in the actual command; state-sensitive globals require
runInBand and real aggregate order, not summing individual PASS receipts.

Proposed initial full-entrypoint budgets: ordinary1800seconds plus30seconds exit
grace; coverage2700seconds plus30seconds exit grace, sequential, no concurrent
heavy benchmark/build from this task. These are conservative predeclared proposals
for137 suites (recent smaller aggregates already take minutes), not measurements
or promises. Freeze budgets before execution and preserve timeout/failure without
automatically increasing them. Coverage threshold failure is separate from process
nontermination and remains nonpass even if all test assertions pass.

## Path to completion without narrowing the task

1. Finish the already approved remaining diagnostics with repaired observer; preserve
   first machinefalse/manual bounded assessment separately. Do not rerun it to erase
   history or claim those five suites complete #49.
2. Review full137 dependency/ownership call sites and explicitly settle existing12%
   ordinary measurement, current owned-path permissions and online mode. No new
   restriction on harmless read-only inspection is needed.
3. Approve flag removal only with the original npm/workflow selection preserved.
   Execute npm test -- --runInBand and npm run test:coverage -- --runInBand once
   each under the reviewed observer; retain exact JSON/logs, skips and natural-close
   evidence. A baseline/reference direct command may diagnose beforehand, but does
   not replace these final commands.
4. Address actual failures via independent classification and scoped TDD/fix/review,
   then repeat only affected checks justified by the change and final entrypoints
   when necessary. Never retry unexplained failures or manufacture statistical PASS.
5. #52 expands whole-source measurement after #49; current16-file coverage is not
   #52 acceptance. #58 preserves every366 requirement and uses real per-case evidence.

No test body, benchmark, install, cleanup or process termination ran during this
research. Only discovery/showConfig were executed. Current source/state changes
after this checkpoint require renewed inventory comparison, not fabricated continuity.


## Authorization clarification

Root may execute necessary flag repair and one unchanged ordinary/coverage verification under the user's full-epic authorization after freezing the source, budgets, owned paths and existing offline mode. No additional user confirmation is inferred merely from research checkpoints. Existing explicit #64 experiment restrictions, threshold changes, online-mode/new-credential changes, new installations requiring separate scope, historical denied deletion and newly discovered production scope remain distinct boundaries. No such action is authorized by a subset PASS.
