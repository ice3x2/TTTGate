# Issue #64 — Timing experiment variability

Status: reviewing final evidence; methodology repairs and deterministic focused checks pass. The first empirical experiment remains FAIL and both subsequent approved diagnostics are INCONCLUSIVE. No empirical timing PASS is claimed. #64 does not change production comparison code; the separately reviewed #66 parity repair is included in the later diagnostics' built helper.
Assigned agent: `fix_supply15`; branch `fix/epic61-node24`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-node24`; runtime worker owns concurrent #63 build/packaging work.
Original title: 상수 시간 비교 벤치마크의 결과 변동으로 전체 테스트가 간헐적으로 실패함.
Writable paths: `scripts/timing-safe-string-equal-bench.cjs`, root `package.json`
test command, `test/unit/tools/timing-experiment.test.ts`, only the 7% experiment
and semantic additions in `test/unit/util/req-04-timing-safe-string-equal.test.ts`,
and this issue's evidence files. Next action: final artifact review and orchestrator
commit/remote closure. Runtime worker completed the forced build, ordinary full
tests and five binary regenerations sequentially. No further timing run
is authorized. This methodology repair is a prerequisite
to #63 closure.

- [x] Preserve full-suite failure and focused pass. Status: complete; observations below.
- [x] Read comparison implementation, both existing timing tests and methodological primary sources. Status: complete.
- [x] Investigate order/sampling sensitivity without editing tests. Status: one fixed balanced-order diagnostic complete; cause remains unproven.
- [x] Approve a narrow methodology/security-regression change. Status: root and independent `review_wave0` approved only the failing 7% hex experiment; 12% UTF-8 experiment unchanged.
- [x] Add failing regressions before implementing the approved test/experiment changes. Status: RED seven failed tests, then focused GREEN 18 tests; details below.
- [x] Run deterministic and separately approved conditioned timing checks, preserving all outcomes. Status: dedicated method/guard tests passed; original timing FAIL and two later INCONCLUSIVE diagnostics are preserved below. The earlier full ordinary regression handle 72239 passed 72 suites/328 tests with four online tests skipped. Final ordinary handle 16537 passed 75 suites/372 tests with four online tests skipped (376 total), 228.365 seconds. Neither ordinary test result converts a timing experiment into a pass.
- [ ] Independent review, integrate, push, close and notify. Status: pending orchestrator.

## Observed outcomes

Full Jest command `npm test -- --runInBand`, handle 55877, exited 1:
`test/unit/util/req-04-timing-safe-string-equal.test.ts`,
`REQ-04 timingSafeStringEqual > 마이크로벤치 — early-mismatch vs late-mismatch 편향 < 7% (median 기반)`.
Expected <7%; actual **15.779504434027428%**. Other tests: 318 passed,
four online tests skipped, 323 total. Packaging was concurrently active during
part of this run, but that fact does not establish the failure's cause.

One focused run after packaging ended (handle 51349) passed all 10 tests:
bias **1.5243764193431324%**, same 7% threshold. The full suite was still running
during this focused check. It is not a controlled idle-host replication and is
not a substitute for the failed full result.

## Methodology findings

The current experiment uses 5,000 warmup iterations, 11 samples of 100,000
comparisons, always early-mismatch followed by late-mismatch. Comparing the two
separate medians does not cancel systematic order effects. Both classes include
hex decoding, buffer allocation/copy and the real crypto primitive; it does not
isolate the primitive. There is no noise/sensitivity control, and every run
overwrites `reports/req-04-bench.json`. Coverage conditions already skip it.
The separate server test measures UTF-8 with seven samples and a 12% threshold.

A read-only diagnostic executed compiled production code in plain Node, kept
the same hex inputs/100k iterations/5k warmup, and ran exactly 12 alternating
AB/BA pairs. It reported **1.1540075822831342%** pooled bias. First pair:
early 101,168,400 ns / late 87,876,200 ns. Last pair: late 61,555,000 ns /
early 64,439,400 ns. This shows within-run drift; attributing that drift to JIT,
GC, CPU frequency or scheduling would require further isolated measurements.
Tool output chunk `2da0bd` contains every raw sample; this diagnostic is not
presented as an accepted security gate or a replacement passing result.

Sources:

- [Node crypto API](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b) warns that surrounding code can defeat timing safety even when the primitive is used.
- [Google Benchmark variance guidance](https://github.com/google/benchmark/blob/main/docs/reducing_variance.md) identifies scheduling competition, CPU/core/frequency changes and cache effects as measurement variability sources; dedicated/controlled machines reduce these effects.
- [dudect methodology](https://github.com/oreparaz/dudect) uses measurement statistics to seek evidence of leakage; finite passing measurements do not formally prove constant-time behavior.

## Approved approach and implementation

Production code is unchanged. Preserve ordinary-CI semantic and delegation
checks and add every-byte mismatch cases for Buffer/hex/UTF-8 plus encoding and
length rejection cases using real crypto. Report their scope as deterministic
security/correctness regression, not empirical constant-time proof.

Move noisy measurement to an explicit command operating on built code under
recorded execution conditions. Reject instrumentation, retain the 7% hex
threshold, use fixed balanced AB/BA ordering, and save unique raw reports even
on failure. No rerun-until-green loop. An identical-input noise control and an
intentionally early-exit sensitivity control distinguish an invalid experiment
from a target result; invalid controls must produce nonzero inconclusive status.
The existing 12% UTF-8 experiment is unchanged, as explicitly directed by the
root and independent reviewer.

## Test-first implementation evidence

Before adding the experiment script/command or moving the old benchmark:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/tools/timing-experiment.test.ts
```

Exit 1, seven failed tests: missing classifier script, missing explicit npm
command, and process status expected 2 but received 1. Classifier cases use
numeric measurement data fixtures, not fake crypto calls. They verify valid
pass, exact 7% failure, invalid/noisy/insensitive controls and malformed samples.
Process cases verify nonzero instrumentation/missing-conditions outcomes and
distinct retained report files.

After implementation:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/tools/timing-experiment.test.ts test/unit/util/req-04-timing-safe-string-equal.test.ts
```

Exit 0, two suites/18 tests passed (final focused run 1.442 seconds). All original
semantic tests remain, plus every-byte mismatches across Buffer/hex/UTF-8 and
matching-prefix/invalid-format/expected-length rejection tests. Only the noisy
7% experiment and its obsolete report-directory setup were removed from Jest.
There is no new `test.skip` or threshold change.

The standalone experiment uses 12 predeclared alternating AB/BA pairs, 100,000
calls per batch and 5,000 warmup calls per class/group. Identical-input noise must
be below 7%; deliberately early-exit sensitivity must exceed 7%. Invalid controls
produce exit 2 (inconclusive); valid target >=7% produces exit 1; valid target
<7% produces exit 0. Each invocation writes a timestamp/PID/UUID report containing
all groups' raw samples and host metadata. There is no auto-retry or filtering.

## First actual experiment: failed and preserved

Executed exactly once:

```powershell
npm run test:timing -- --conditions 'Windows x64 workstation on Node 24.16.0; packaging and this lane Jest processes finished; other OS and user processes were not isolated; default CPU scheduling and frequency settings'
```

The build passed. Experiment exited **1 / fail**:

- Target bias: **9.881787986628991%** (fails unchanged 7% criterion).
- Identical-input noise control: **5.221093445093258%** (below 7%).
- Early-exit sensitivity control: **94.28384205383836%** (above 7%).

Original unique report:
`results/timing/req-04-2026-09-07T15-38-30-092Z-20236-54902eaf-fcfb-4174-83cf-c98fa5449144.json`.
An unchanged copy is retained in [the first experiment's raw evidence](epic61-issue-64-first-experiment.json).
This result is not presented as passing, and a failed macro-bias experiment does
not alone prove exploitable content timing. Independent analysis is pending.

The invocation exposed Windows npm forwarding/quoting of multiword `--conditions`:
the preserved raw report contains caret-escaped words beginning `^Windows^ x64^`.
The full operator statement is preserved in the command above; the raw report is
not rewritten. A regression expecting the complete statement then failed (expected
`test fixture; instrumentation intentionally enabled`, received `test`), before
fixing the CLI parser to collect argument words up to the next option. The final
18-test GREEN includes that repair. No additional real timing run was performed
to seek a passing result.

## Independent review fixes: denominator and instrumentation

Independent fixer: `fix_ci14`, same runtime worktree. Scope is the experiment
script, its dedicated `test/unit/tools/timing-experiment.test.ts` and this ledger;
runtime manifests and #66 production comparison changes remain other workers'
exclusive ownership.

- [x] HIGH denominator finding: confirm the author's test-first restoration of the original mean-based metric.
  Status: independently confirmed from current script and actual dedicated test run before fixer edits: eight tests passed. The target medians 193/207 fail at 7%; medians 93.1/100 also fail under the mean denominator, whereas a max denominator would incorrectly pass them. No further metric change was made by this fixer.
- [x] MEDIUM instrumentation finding: reproduce short preload and global coverage bypasses before changing the guard.
  Status: RED. `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/tools/timing-experiment.test.ts` exited 1 with three new cases failed/eight existing cases passed. Actual child Node invocations exercise `-r preload.cjs`, the same short preload via NODE_OPTIONS, and a preload-installed `globalThis.__coverage__` with execArgv cleared to isolate that signal. A preload sentinel throws at the first timing read, preventing collection of any timing samples when a guard fails. The Windows NODE_OPTIONS fixture path was normalized to forward slashes before the final RED run so a module-resolution error could not substitute for the intended failure.
- [x] Add only missing instrumentation signals and rerun the dedicated regressions.
  Status: GREEN. The guard now recognizes short `-r` flags and global coverage state. Same command exited 0: one suite/11 tests passed, 1.166 seconds. All three instrumented child invocations return inconclusive/exit 2, retain an empty measurement group report and never reach the timing sentinel. No cryptographic function is replaced; the preload deliberately marks measurement instrumentation.
- [x] Preserve original raw evidence and recalculate its classification without new measurement.
  Status: unchanged raw copy is byte-identical to the original unique report. SHA-256: `e9be23a4e69ad9099c9adae95bca4999f8aaa10ab4c5b936d488c8797dfe62d8`. Calling only `classifyMeasurements` on its saved samples yields target **10.395414391898452%**, noise **5.361046057234612%**, sensitivity **178.37167730188335%**, status **fail**, under the restored mean formula. The earlier 9.8818%/5.2211%/94.2838% values above remain historical output of the erroneous max-denominator classifier, not the accepted current metric. Raw samples and historical report fields were not rewritten.
- [x] Independently review these repairs and preregister the next diagnostic.
  Status: root approved the fixed diagnostic design below. `review_wave0` independently passed all 19 pure-data/guard tests in 1.331 seconds and approved code/method before root execution. The fixer performed no actual timing runs, threshold adjustment, rerun-until-green or raw-sample filtering. Results of root's separately authorized measurements are recorded below without replacing the original FAIL.

## Preregistered five-group diagnostic

Root explicitly approved this replacement fixed method before implementation and
before its single authorized measurement. Its purpose is to distinguish hex
conversion effects from the predecoded Buffer path and report imprecision rather
than silently retry the earlier failed experiment. The original raw report and
its corrected mean-based FAIL remain unchanged. The new method has a separate
identifier, `five-group-balanced-block-intervals-v2`, in every new report.

Fixed design:

- Five groups: `hexTarget`, `hexNoise`, `decodedBufferTarget`, `bufferNoise`, and deliberately early-exit `earlyExit`.
- Same 64-character hex values representing 32 bytes, with early/late mismatch positions; Buffer values are decoded before sampling. Each noise group repeats the identical early-mismatch comparison for both labels. Positive control deliberately exits at the first unequal byte; it is not a cryptographic substitute.
- Exactly 50,000 warmup calls per group, alternating labels, then 120 pairs per group with 10,000 calls per label/sample. AB/BA alternates and the five-group order rotates by one position for each pair. No sample rejection or repeat-until-pass path exists.
- Preserve pooled median absolute difference divided by the two medians' mean, threshold 7%. Additionally compute signed `(late - early) / mean(early, late) * 100` for every pair, twelve fixed blocks of ten successive pairs, and a descriptive 95% t11 interval over block means using critical value 2.2009851601.
- Both noise pooled biases must be below 7% and their intervals contained in [-7%, 7%]. The positive control pooled bias must exceed 7% and its signed lower interval bound must exceed 7%. Otherwise the whole experiment is inconclusive/exit 2.
- With valid controls, either target's pooled bias >=7% remains FAIL/exit 1 regardless of interval precision. If neither pooled target fails but either target interval is not contained in [-7%, 7%], return inconclusive/exit 2. PASS requires both targets' pooled bias <7% and both intervals inside the bounds. Reviewer `review_wave0` explicitly confirmed this precedence before implementation.
- Report all raw samples, rotating order, block means, intervals, formulas and host metadata. Intervals are descriptive under unknown serial dependence; they are not a constant-time proof or a guaranteed coverage statement.

Test-first evidence:

- [x] Write fixed-method and precision contracts before changing the script.
  Status: RED after shared dependency installation completed: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/tools/timing-experiment.test.ts` exited 1, nine failed/ten passed. Failures included obsolete 12-pair/100k metadata, missing five-group statistics, mean boundary decisions and imprecision handling. A prior missing-Jest error during another worker's install was discarded as setup evidence, not counted as functional RED.
- [x] Implement the approved fixed method without extra command modes or changes to production comparison code.
  Status: GREEN after the subsequent shared install completed: same command exited 0, one suite/19 tests passed in 1.646 seconds. Pure numeric fixtures cover both target failures, target/noise imprecision, signed sensitivity direction, point-failure precedence and the exact twelve-block t11 calculation. Instrumented subprocess tests check fixed schedule metadata while producing no timing samples. Missing import-local during the install was not counted as a product failure or successful verification.
- [x] Independent final code/method review and #66 refreshed build confirmation.
  Status: `review_wave0` approved final code/method and independently passed 19 tests; runtime worker confirmed forced TypeScript build with #66 before root execution.
- [x] Execute exactly one originally authorized five-group diagnostic after all agent Jest/build/packaging work is quiescent.
  Status: root executed the default-affinity diagnostic below and retained its INCONCLUSIVE result. A separately reviewed and root-authorized CPU-affinity condition change subsequently produced the second INCONCLUSIVE result; it was not an automatic retry. No OS/user-process isolation was claimed.

## Actual five-group results and final empirical limitation

Both runs used the reviewed fixed method and unchanged 7%/precision rules.
The original three-group FAIL remains preserved and is not retrospectively
reclassified using the newer method. No measurements were discarded or selected
as a passing substitute.

| Run and preserved raw report | Hex target bias | Hex noise bias | Decoded Buffer target bias | Buffer noise bias | Early-exit bias | Overall result |
|---|---:|---:|---:|---:|---:|---|
| [Default affinity, 15:56:17 UTC](epic61-issue-64-default-affinity.json) | 2.9980866% | 9.8664483% | 5.7557343% | 0.9584382% | 107.0479762% | INCONCLUSIVE: hex noise exceeds 7% |
| [One CPU affinity, 16:03:07 UTC](epic61-issue-64-single-cpu-affinity.json) | 5.7133287% | 0.5249817% | 3.7893823% | 2.1227768% | 102.4122283% | INCONCLUSIVE: Buffer interval exceeds the allowed bounds |

The first new diagnostic ran on the shared Windows workstation's default
32-logical-CPU affinity. Its recorded conditions say no other agent test,
install, compilation or packaging process was active, while explicitly stating
that the host was not exclusive. The report is inconclusive because the noise
control failed; sub-7% target point estimates do not override that control.
Root reported a nonzero launcher result; the report's status remains the
classification evidence, rather than an inferred native exit value.

Following independent result review, root explicitly authorized one changed-
condition diagnostic on the lowest permitted CPU affinity mask, `1`, at normal
priority, with the same method and no threshold changes. This was a bounded
diagnostic of scheduling conditions, not permission to repeat until passing.
The [launcher metadata](epic61-issue-64-affinity-launch.json) records observed
PID 114204, affinity mask 1, normal priority, and hashes matching the experiment
script and built helper. Its nativeExitCode is null; root observed outer-launcher
exit 0. Neither is evidence of a timing PASS. Preserved
[stdout](epic61-issue-64-affinity-launch.stdout.txt) explicitly says inconclusive;
[stderr](epic61-issue-64-affinity-launch.stderr.txt) is retained as captured.

For the affinity run, the hex target's descriptive interval is
[-6.5513483%, 2.8264777%], but the decoded Buffer target interval is
[-3.3577295%, 14.1672820%]. The latter is not contained in [-7%, 7%], so the
overall experiment remains inconclusive even though its pooled Buffer bias is
3.7893823%. This is insufficient empirical precision, not proof of either
constant-time behavior or exploitable timing leakage.

Intentional evidence copies preserve original bytes and filenames are distinct;
existing files were not overwritten. Original source report paths are:

- `results/timing/req-04-2026-09-07T15-56-17-366Z-132320-8ae9248a-dbfb-4997-ae35-a44bb80a35a7.json`; copied report SHA-256 `3b3962d47b6213e808b970008cb14880998df293849abad30a5e9c0d128262e8`.
- `results/timing/req-04-2026-09-07T16-03-07-856Z-114204-0451ede2-8abd-4ed1-8870-1fbaf897ce65.json`; copied report SHA-256 `ede41288b6c390519fd9344e7cc363af3b1717ad8aeda1d86d1023d76fd3f72b`.
- `results/timing/affinity-launch-a86b58f9-7b54-4d35-8cf0-1190737d8e33.json`; copied metadata SHA-256 `3d4bea42add5140b0b0c20406b9fd43ffdb49e16bdeed47fd0fb17f7ae69ae0f`.

Original failed raw evidence still hashes to
`e9be23a4e69ad9099c9adae95bca4999f8aaa10ab4c5b936d488c8797dfe62d8`.
Launcher script hash `85ed47df91921824df5b692b76897725187db0d6379bf5cce00d432bcd705a25`
and built helper hash `e626b7b9e76dffd05fab177f50a803501362b1d63323ca640ed40a048e210a0d`
match the observed files at evidence recording.

## Closure gate

### Raw Git blob fidelity repair

Before integration, independent reviewer `research_schedule` compared original
source files, evidence working copies and actual committed Git blobs using
Python `subprocess.check_output` bytes and SHA-256, without shell text decoding.
RED: unpublished commit `ebd1057` normalized the affinity-launch JSON from CRLF
to LF; its blob hash was
`46c35c535d44fde963cd79b421b89363d4b2190c220935ff648bdf4d26f9c658`,
while both original source and untouched evidence copy retained the documented
`3d4bea42add5140b0b0c20406b9fd43ffdb49e16bdeed47fd0fb17f7ae69ae0f`.
The other three JSON blobs already matched their documented hashes.

The narrow repair adds exact-path `-text` attributes for the four intentional
JSON copies and two launcher output files, then runs `git add --renormalize`
only for those six files. No measurement contents were edited. GREEN: all six
staged blobs now match the original evidence working bytes; the affinity JSON
hash is restored to its documented value and all other JSON hashes remain
unchanged. Launcher stdout SHA-256 is
`0ff29f648f521317c15321c80a85a7b0e86ccd4ab088431ef7a5b4173ad12aef`;
stderr is empty (SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).
Independent attribute review and amended-commit blob verification remain the
orchestrator's final gates before integration.

#64 acceptance is the approved measurement-method repair: deterministic ordinary
security regressions, explicit conditioned experiments, preserved nonpass data,
and fail/inconclusive handling without threshold relaxation. It is not physical
constant-time proof. Primary reviewer approved that bounded acceptance after
result review, conditional on fresh ordinary full regression and accurate final
documentation of this empirical limitation.

- [x] Fresh ordinary full regression and required regenerated-artifact checks.
  Status: runtime worker reported forced build handle 45821 exited 0; full ordinary regression handle 16537 then passed 75 suites/372 tests with four online tests skipped (376 total) in 228.365 seconds. Sequential packaging handle 33884 regenerated all five artifacts after that test run; Windows native CLI/probe and target header/hash checks passed. Full commands and platform evidence are in [the #63 ledger](epic61-issue-63.md). Final independent artifact review remains required before closure. These checks do not alter either empirical INCONCLUSIVE result.
- [x] Independent review of final evidence copies and result documentation.
  Status: PASS by `review_wave0`: all four raw/launcher SHA-256 values, nonpass outcomes, interval bounds and native-exit limitation were independently checked. The subsequently added final ordinary/artifact status above awaits the final reviewers; this fixer does not self-approve it.
- [ ] Commit, remote verification, issue closure and Telegram report.
  Status: pending orchestrator. No additional timing runs are authorized by this ledger.
