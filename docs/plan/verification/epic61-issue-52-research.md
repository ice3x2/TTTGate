# Issue #52 — Whole-source coverage baseline

Status: read-only research complete; independent review and implementation assignment pending. #49 natural-shutdown/entrypoint prerequisite remains mandatory. No tests, coverage, benchmark, installation or deletion executed.
Original requirement: https://github.com/ice3x2/TTTGate/issues/52.

- [x] Inspect current config and src inventory. Status:16 explicit collectCoverageFrom entries; current global lines/statements60, functions/branches50. rg lists68 src files and no current .d.ts files.
- [x] Preserve all four original whole-source baselines. Status: proposed exact thresholds below; these are original issue measurements, not a new measurement.
- [ ] Independently review scope/config-contract RED plan. Status: pending; no config changes authorized by this research.
- [ ] Complete #49 prerequisite then execute approved full coverage. Status: pending; partial natural-exit diagnostics cannot satisfy this gate.
- [ ] Independently verify denominator, thresholds and exact entrypoint results. Status: pending; no lowered baseline or exclusion workaround.

## Required minimum configuration change

Replace the16-file list with an inclusive production-source glob, proposed
`src/**/*.{ts,tsx,js,jsx,mjs,cjs}`, and exclude only declaration files
`!src/**/*.d.ts` if an explicit exclusion is needed by the installed transformer.
There are currently no declarations, so that negative glob should have no effect.
Do not exclude entrypoints, Sentinel, ServerApp, untested utility modules, generated-
looking files under src, or type-named modules merely because they reduce coverage.
The src tree is the requested production boundary; admin SPA coverage is separate
and must not be mixed into the original denominator without a separate decision.

Set global thresholds exactly to original #52 non-regression baselines:

| Metric | Minimum percent |
| --- | --- |
| lines |64.26|
| statements |63.71|
| functions |69.74|
| branches |52.23|

Do not round downward, use a narrower file group or lower a metric to make the
run pass. New higher targets require a later decision; this repair protects the
existing measured baselines only. Current execution-plan shorthand lists lines
and branches but does not override the original four-metric requirement.

Initial proposed writes: jest.config.ts collectCoverageFrom/coverageThreshold and
only obsolete scope-policy comments, a dedicated configuration-contract test and
ledger52. Preserve testMatch, ignore patterns, transformer, provider, dependencies,
ordinary test selection and reporters unless a concrete verified incompatibility
requires separate approval. #49 owns forceExit and shutdown repair; no duplicate
flag removal here. Historical plan/measurement receipts remain unchanged.

## Instrumentation denominator and side effects

Inclusive matching is not the same as executable statement count. Pure type-only
modules may erase to no statements/functions under TypeScript; record them as
matched/no executable counters rather than inventing hits or excluding the entire
types directory. Modules containing enums or executable imports remain eligible.
.d.ts declarations describe types and contain no runtime statements; document any
exclusion as declaration-only, not as a path to remove low-coverage implementation.

Collecting coverage for unimported files normally instruments/transforms source
without requiring an application's runtime import. Do not add a test that imports
app.ts/ServerApp solely to manufacture coverage and starts services as a side effect.
Use existing actual startup fixtures for meaningful behavior coverage when needed.
The final report must reconcile matched src inventory with reported file counters,
not simply report a passing global percentage. Unsupported executable extensions
or instrumentation failures must be reported and resolved explicitly; do not hide
them behind an ignore glob. Preserve current provider/transformer when comparing
results to the original baseline and record their installed versions.

## Test-first and execution sequence

1. Before config edits, add a deterministic config-contract test that resolves the
   actual Jest configuration and checks all four exact thresholds and inclusion of
   representative currently omitted modules (SocketHandler, CtrlPacket,
   DataStatePacket, ClientHandlerPool, ExternalPortServerPool, TTTServer,
   CertificationStore, HttpHandler, ServerOptionStore, BufferReader/Writer and
   entrypoints). Enumerate all regular src files for inclusion rather than testing
   only the expected literal glob. Ensure source exclusions contain no arbitrary
   implementation names. Observe genuine current16-file/threshold RED without
   running coverage or importing production entrypoints.
2. Apply minimum config change and pass that contract test. This proves scope/config,
   not achieved runtime coverage. Do not claim threshold attainment from it.
3. Only after #49's reviewed natural-exit and full entrypoint prerequisite, obtain
   explicit full coverage execution approval, including timing/path/online/browser
   conditions. Reuse its external observer, record exact npm environment/command,
   complete output, natural process close and preserved report directory. Do not
   forge coverage env to skip ordinary timing or run denied path cleanup.
4. Run the actual `npm run test:coverage -- --runInBand` against final config and
   all normally selected suites, with no ad hoc exclusions or retries-until-green.
   A natural exit with threshold failure is still FAIL. Distinguish assertion,
   process shutdown, instrumentation and threshold failures before routing fixes.
5. Inspect coverage summary plus per-file lcov/matching inventory; compute that all
   four global metrics meet the exact floor using raw counters where available,
   not rounded display values alone. Include zero-hit eligible modules. Preserve
   uninstrumented/no-executable explanations and verify no source files vanished.

If the current whole-src result is below any floor, retain the failure and add
meaningful tests for actual uncovered behavior under independently reviewed scope.
Do not delete assertions, mark files ignored, reduce thresholds or claim partial
suite results satisfy #52. #58 requirement traceability and #47/#53 E2E remain
separate obligations; coverage percentages alone prove neither.

## Safety and current limits

This research measured no coverage and makes no updated percentage claim. #49 may
run unchanged narrow coverage for shutdown diagnosis, but that is not #52 acceptance.
No source production, benchmarks, denied historical artifact paths or process
termination were touched. Future owned process termination must verify PID,
current command line and task ownership; never terminate Node by name. #28/#40
decisions and #29 held work remain unchanged.

## Configuration-contract preparation after #49

Status: design-only preparation assigned to fix_lint_diagnostics. Root completed #49 at main58f71969 and assigned listeners contract implementation preparation on that base. The contract below remains the scope boundary; no runtime whole-source coverage success is claimed. Earlier pending checkpoints above describe the research stage.

- [x] Reuse existing contract style. Status: inspected control worktree `test/ci/natural-test-exit.test.ts`: deterministic actual configuration inputs, exact assertions, no production import or fake coverage receipt. At that research checkpoint main still had the pre-integration #49 checkout, so the candidate was read from control. Actual config is `jest.config.ts`; initial reads of nonexistent `jest.config.cjs` and the not-yet-integrated main CI file failed and are not test results.
- [ ] Add `test/ci/whole-source-coverage.test.ts` under the listeners assignment. Status: contract implementation preparation; no execution result is claimed by this research. Import only the actual Jest configuration object (its import of Jest is type-only), enumerate regular files under src with filesystem APIs, and use the installed Jest `globsToMatcher` from `jest-util` for the effective collectCoverageFrom selection. Reuse the installed dependency without adding packages; confirm its available export at implementation time.
- [ ] Observe current configuration RED before edits. Status: exact planned command `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/ci/whole-source-coverage.test.ts`; fixed diagnostic child budget30s, not measured duration. Save stdout/stderr/native status and separate config assertion failures from loading/setup errors. No full coverage during this RED.

Concrete contract cases:

1. `whole-source coverage includes every eligible production source file`: enumerate every current regular executable source, currently68 TypeScript files, excluding declaration-only .d.ts. Match every supported TS path against actual collectCoverageFrom and retain the complete inventory. Do not hardcode68 as a ceiling. Current moduleFileExtensions is ts/tsx/js/json and the transformer handles .ts; matching a six-extension synthetic glob alone cannot prove effective instrumentation. If any other executable source extension is discovered, fail with an explicit unsupported-instrumentation gap for separate review; do not silently omit it or change provider/transformer within this scope.
2. `whole-source coverage preserves the four original non-regression floors`: exact global object `{lines:64.26, statements:63.71, functions:69.74, branches:52.23}`. This checks configuration only, never achieved coverage.
3. `whole-source coverage admits future source paths without implementation exclusions`: a new nested TS source path must match and a declaration-only .d.ts path must not. Check actual matching for the entire source inventory and reject arbitrary implementation exclusions. Do not require a literal two-element glob array: equivalent complete matching is allowed. Synthetic path matching proves selection only, not transformer execution or achieved coverage.

Minimum config candidate replaces the16-file allowlist with complete supported TS source selection and declaration exclusion, and sets all four floors. Existing provider, transformer, moduleFileExtensions, reporters, testMatch, ignore patterns and package scripts remain unchanged. No additional extension is claimed instrumentable from a glob match; an actual unsupported executable extension is an explicit failing gap, not permission to reduce original whole-source scope. Full coverage must reconcile every source with counters/type erasure and preserve zero-hit executable modules. Any below-floor result remains FAIL and routes to independently scoped meaningful behavior tests; no floor/provider/exclusion workaround is authorized.
