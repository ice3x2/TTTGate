# Issue #66 — Reject unmatched hex nibbles

Status: complete; independently reviewed, integrated, pushed, closed and notified. Timing outcomes remain FAIL/INCONCLUSIVE, with no physical constant-time proof claimed.
Original title: 홀수 길이 hex가 잘려 서로 다른 값이 timingSafeStringEqual에서 같다고 판정됨.
Assigned agent: `fix_supply15`; branch `fix/epic61-node24`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-node24`.
Integration baseline: #9 commit `a8ea15b` cherry-picked as `2f5a219` before this
issue's changes; the combined runtime work has since been committed and integrated.
Writable paths: `src/util/timingSafeStringEqual.ts`,
`test/unit/util/odd-hex-timing-safe-string-equal.test.ts`, and this ledger.
Next action: none for this issue; operational completion recorded below.

- [x] Read issue and inspect existing helper/test reuse. Status: complete; use the existing formatValid/dummy native comparison path and retain existing general semantic suite.
- [x] Write failing odd-hex regressions before implementation. Status: RED; 11 tests failed and two legitimate-input tests passed, exit 1.
- [x] Add minimum parity validation without normal-flow exceptions. Status: complete; hex strings must have even length before matching the existing character format. No early return or native comparison-path change.
- [x] Run focused new/existing comparison tests and build. Status: comparison GREEN (two suites/24 tests); initial build failure repaired through #63 compiler compatibility change, final forced build exits 0.
- [x] Independent review and any fixes. Status: PASS by `review_wave0`; independently reran 24 focused tests, no material findings.
- [x] Combined regression and updated actual binaries. Status: final forced build 45821 exited 0; full suite 16537 passed 75 suites/372 tests with four online skips (376 total), 228.365 seconds; then packaging 33884 regenerated all five binaries and native Windows x64 checks passed. Final checksums and execution evidence are recorded in [#63's ledger](epic61-issue-63.md#final-sequential-verification).
- [x] Integrate, push, close and notify. Status: complete; operational evidence below.

## TDD evidence

RED command, before helper edits:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/util/odd-hex-timing-safe-string-equal.test.ts
```

Exit 1; 11 failed/two passed. Examples expected false but received true:
`('aaf','aa')`, `('aa','aaf')`, `('','f')`, `('a','b')`, Buffer/odd-string
mixtures, and `('aaf','aa','hex',1)`. These use the actual production helper,
Buffers and crypto implementation, without mocking.

Focused GREEN and initial build commands:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/util/odd-hex-timing-safe-string-equal.test.ts test/unit/util/req-04-timing-safe-string-equal.test.ts
npm run build
```

Two suites/24 tests passed, exit 0, 0.726 seconds. Build handle 18168 exited 1:
Node 24 declarations reference `Disposable`, `Symbol.dispose`, `Symbol.asyncDispose`
and `esnext.disposable`, which the installed compiler cannot resolve. This new
build failure is reported to the orchestrator; #66 does not own compiler changes.
The authorized #63 repair subsequently upgraded TypeScript within 5.x and
removed an unused deprecated declaration stub; `npm run build -- --force` then
exited 0. See `epic61-issue-63.md` for separate compiler RED/GREEN evidence.
Valid even-length hex/case variants, empty/empty, Buffer inputs with odd byte
counts, and odd-length UTF-8 strings retain their existing results.

The helper now sets `formatValid=false` for unmatched hex nibbles; it still
normalizes/pads inputs and invokes the existing same-length native
`crypto.timingSafeEqual` call before combining validity/result flags. Invalid
hex is not rejected via exceptions or a content-comparison early return.

This proves a functional input-validation defect and repair. Authentication
bypass or a relationship to #64 timing measurements is not claimed.
No #64 benchmark files or root configuration were edited for this issue.

## Operational completion

Integration commit and independently observed pushed remote HEAD: `b093dce3dcd945833dc46ac490b099970dd6507a`. GitHub independently confirmed CLOSED at `2026-09-07T16:27:02Z`. Root reports clean root/admin installs, forced compilation and eight suites/66 focused integration tests passed in 27.951 seconds. The fix preserves native comparison and does not claim an authentication bypass was demonstrated.

Telegram title: `TDD Gate 66 홀수 길이 hex가 잘려 서로 다른 값이 timingSafeStringEqual에서 같다고 판정됨 (61/9)`. Successful delivery message `3904` is from the orchestrator's tool receipt, not an independent Telegram fetch. Do not duplicate the notification.

## Final verification

After the compiler repair and #64 diagnostic checkpoint, these commands ran
sequentially and all exited 0:

```powershell
npm run build -- --force
npm test -- --runInBand --silent
npm run pkg
```

Final ordinary regression: **75 suites/372 tests passed**, four explicitly online
tests skipped, 376 tests total. All five platform binaries were refreshed from
the final #9/#63/#66 compiled source; header/architecture/hash checks passed.
The Windows x64 product printed its version and usage with exit 0, and the
runtime probe confirmed embedded Node 24.18.1. This is separate from the #64
timing experiment's INCONCLUSIVE outcome and does not claim timing-safety proof.
`review_wave0` independently approved #66 and reran its 24 focused tests.
