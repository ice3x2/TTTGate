# Issue #60 — Test artifact ownership and path hygiene

Status: #60 implementation, independent correction/reviews, integration/closure and notification3974 complete. Research/RED procedures below are historical; detailed evidence is in ledger60 and current counts in the execution plan.
Researcher: review_wave0. Original issue: https://github.com/ice3x2/TTTGate/issues/60.

- [x] Inspect both cited tests and existing fixture ownership. Status: findings below.
- [x] Separate path repair from process contracts and timing policy. Status: proposed bounded scope below.
- [x] Approve exact isolated RED procedure and write scope. Status: independently rereviewed PASS; root approved the two cited tests, dedicated sandbox/contract fixtures/tests and ledger60 only.
- [x] Observe path/cleanup RED before changing the two tests. Status: completed under approved sandbox contract; exact RED/GREEN/correction and notification receipts in ledger60.
- [x] Apply minimum path repair, independently verify and integrate. Status: completed under approved sandbox contract; exact RED/GREEN/correction and notification receipts in ledger60.

## Existing generated files

test/unit/server/req-04-constant-time-compare.test.ts:17,27–48 writes both
test/.tmp-req04-lint/auth-compare.json and reports/req-04-grep.json under cwd.
runLintScript invokes the real scanner with a 60-second timeout and parses stdout;
the lint case writes its filtered report and has no output-directory cleanup.
The same file contains IdentityRegistry semantic checks and an unchanged 12%
timing experiment; those are not required to repair artifact paths.

test/e2e/req-09-pool-swap-zombie.test.ts:25–37 writes/appends
reports/req-09-sessions.csv under cwd. Its afterEach disposes the tunnel harness
but does not remove this separately owned report. The CSV contains actual case
metrics; keep its schema and assertions rather than deleting reporting wholesale.

test/helpers/runtime.ts already uses system mkdtemp and per-instance cleanup for
runtime roots. Reuse that ownership pattern for the E2E report when practical;
do not reset runtime globals solely to own a lint report directory. Existing tools
lint suites use a smaller mkdtemp pattern appropriate for scanner artifacts.
No additional artifact-storage framework or production change is needed.

## Minimum proposed change

Initially own only the two cited tests, dedicated path-contract tests/fixture and
ledger60. Move all three outputs into freshly allocated system-temp roots. Keep
scanner input/script paths absolute and preserve actual scanned scope; changing
report placement must not accidentally scan an empty directory or exclude src.
Create roots only for cases that need reports, and clean each exact owned root
in finally/afterEach after scanner completion or harness disposal. Avoid module
initialization side effects when a test-name filter excludes the artifact case.
If cleanup fails, retain/report the owned path and surface the failure; do not
swallow it or expand cleanup to sibling/historical paths.

#59 owns the two tools lint callers and their process-result helper; do not edit
those files here. Reusing that helper in the req04 lint case can be separately
reviewed after #59 integration, but is not necessary to change output paths.
Do not mix strict-mode policy or abnormal-exit causality into this repair.
Existing timing source, thresholds, coverage skip rules and semantic assertions
must remain byte-for-byte unchanged where possible; do not run the timing case
as part of this bounded verification or claim new timing results.

## Safe RED proposal requiring approval

Historical main/release test/.tmp-req04-lint cleanup was denied. That denial
remains effective: never execute a cleanup targeting those locations, never move
them to enable deletion, and never route such deletion through a different tool
or test. Do not run the original req04 test against either existing worktree.
The following proposal concerns only a new disposable fixture and needs explicit
review before execution; it is not permission to bypass the old denial.

Use a fresh owned system-temp sandbox with an independently recorded absolute
root. A disposable source fixture may copy only the necessary current test/runtime
and scanner sources (exclude old reports, caches and denied directories), with
cwd rooted there. Keep dependency resolution read-only; never mutate shared
node_modules or the original worktree. Run only the lint artifact case using an
explicit test-name selection, never the timing case. Assert that executing the
unchanged artifact code leaves a generated report inside this fresh fixture's
working-tree area; the desired contract of no worktree output should fail. After
the repair the report must instead belong to a distinct owned temp root and be
removed on successful and failing assertions. Preserve source-scan/report content
checks and actual child status evidence. If this fixture cannot reproduce without
touching an existing denied path, stop and revise the procedure before execution.

### Concrete sandbox mapping required before execution

Allocate fresh root R and a separate fresh evidence root E; record both resolved
absolute paths at creation. R/workspace is the child cwd. Build an explicit manifest
of regular files to copy: the two selected test files, their required helper import
closure, scripts/lint-auth-compare.mjs, tsconfig/package metadata needed to execute
them, and the complete scanner-target src tree. Inspect each input with lstat and
copy regular files only; do not follow symlinks or junctions or copy reports,
node_modules, denied temporary directories or unrelated generated artifacts.
Retain the manifest and source/destination hashes in E so omitted scanner scope
or accidental execution of original tests can be detected independently.

Run the existing repository's Jest executable and ts-jest transformer by explicit
absolute paths, with a sandbox-specific config whose rootDir/cwd is R/workspace.
Resolve dependencies read-only from the existing repository node_modules through
explicit modulePaths/resolver configuration; relative project imports must resolve
to copied R/workspace files. Do not create a node_modules link, junction or symlink.
The resolver must not redirect the selected test/helper/source imports to their
original workspace copies. Record resolved test, transformer, script and source
paths. Cache directories, Jest cache and child TMP/TEMP belong under R; preserve
the rest of the child environment unless an explicitly owned path setting needs
adjustment. This does not authorize dependency installation or mutation.

Pass explicit --runTestsByPath for the copied file and an exact test-name filter:
req04 runs only lint case (a), never semantic/timing cases. The fixed req09 choice
is `(3b) configureSessionTtl 범위 밖 입력은 RangeError`; it constructs the actual
harness and appends `3b,range_guard,pass` at the current line 127. Filter its exact
full name (escape regex metacharacters), rather than also running case (3) or (4).
Record the exact current full req04 lint-(a) name and use the same anchored-name
selection. No blanket regex that also includes the timing experiment or restart
stress loop. A setup/resolver/manifest failure is not functional path RED.

Capture test exit, stdout/stderr, observed reports and path assertions in E before
cleanup. Before deleting R or any newly allocated report root, lstat must show a
real owned directory rather than a link, and realpath must equal the recorded
absolute root. Check any contained cleanup target remains inside that root using
path-relative containment, not a textual prefix alone. If verification fails,
leave it intact and report the path. E is preserved for independent review and is
not swept with R. Existing main/release denied paths are never cleanup candidates.

For the E2E CSV, use the same fresh-workspace containment and a smallest actual
existing owned-harness case that writes a metric, rather than rerunning all restart
loops merely to test paths. Assert metric content before cleanup, no repository
report creation, and cleanup on injected assertion failure. A new report helper
is justified only if needed to expose this lifecycle without copying production
logic. Do not replace actual tunnel behavior with fabricated metrics.

For every deletion of a newly allocated fixture, resolve and verify the exact
recorded absolute target against that one owned root before removal. Parent
timeouts terminate only their owned child and are failures; they must not trigger
cleanup of arbitrary cwd paths. Preserve any failed-run receipt outside the root
scheduled for cleanup, in another explicitly owned evidence location.

## Completion boundary

This issue repairs future test output placement and cleanup, not historical
artifact removal. Existing denied artifacts may remain with that limitation
explicitly recorded. Verify only selected artifact-generating cases and fresh
ownership/failure-cleanup controls, then obtain two independent reviews. No whole
suite, benchmark, #28 policy or held #29 action is needed. The broader test suite
and final epic gates remain separate obligations; this research claims none ran.
