# Issue #21 — Restore dated-log retention matching

Status: reviewing; strict RED, focused GREEN and forced build complete.
Original title: 로그 회전 정규식이 템플릿 리터럴 이스케이프 때문에 깨져 오래된 로그가 삭제되지 않음.
Assigned agent: `fix_supply15`; branch `fix/epic61-logs`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-process`.
Base: integrated #16 commit `66d0323eb2e65e21f4b5937005c95c61af19a38e`;
the preceding process branch was preserved when creating this log branch.
Writable paths: `src/util/logger/LogWriter.ts`,
`test/unit/util/log-retention.test.ts`, and this ledger.
Next action: independent review; no commit or #22 changes before integration.

- [x] Read #21 and current integration plan; check the clean process worktree. Status: complete; #16 integrated before this lane began.
- [x] Search existing regex escaping and logger tests. Status: complete; no reusable regex-escape helper found. Existing dated-log parsing/filtering duplicated patterns, so they now share one per-writer pattern; existing redaction regression is reused.
- [x] Write real temporary-file regression before implementation. Status: RED; three failed/one passed, old expired files still existed.
- [x] Correct literal matching and reuse one date-capture pattern. Status: complete; preserve backslashes with String.raw, escape logger-name metacharacters, and use the same pattern for filtering and date parsing.
- [x] Run focused retention and existing redaction regression. Status: GREEN; two suites/12 tests pass, 0.569 seconds.
- [x] Force TypeScript build. Status: `npm run build -- --force` exits 0.
- [ ] Independent review and any fixes. Status: pending orchestrator.
- [ ] Integrate, push, close and notify. Status: pending orchestrator; no commit or remote mutation in this lane.

## TDD evidence

Before editing LogWriter:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/util/log-retention.test.ts
```

Exit 1; three failed/one passed, 0.782 seconds. The explicit two-day retention,
default 30-day retention and metacharacter-name cases all found that expired
logs still existed. The existing unlimited-retention case already passed.

After implementation:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/util/log-retention.test.ts test/util/r2-req-05-errors-redact.test.ts
npm run build -- --force
```

Both commands exited 0. The first passed two suites/12 tests in 0.569 seconds;
the second forced all source type checking/emission successfully.

Tests create actual files only within newly allocated system temporary
directories, construct the actual LogWriter, and observe filesystem state.
They preserve recent/today logs and unrelated logger names, backup extensions,
prefixed filenames, nonliteral date separators and ordinary unrelated files.
The logger name `server[prod]+.(v1)` is matched literally while the regex-looking
decoy `serverpXv1` remains untouched. Default history removes a 40-day-old log
while keeping a 20-day-old one; history zero retains a 400-day-old log.

No user log directory is accessed. Cleanup waits for the writer's real owned
stream to close before removing its temporary directory. No filesystem or
clock mocks are used. Tests avoid retention-boundary timing assumptions by
placing expired/recent files well on their respective sides of the boundary.

## Scope and implementation notes

The matching fix does not change retention duration calculation, history-zero
semantics, deletion error handling, logger composition, Sentinel, transport or
configuration. One compiled pattern is reused without stateful regex flags.
The local standard metacharacter escape expression is limited to the logger
name. A first native `RegExp.escape` attempt passed runtime tests but failed
TypeScript with TS2339; the final implementation needs no compiler/config change.

This evidence covers constructor-triggered retention through the same sweep
method used by rotation. It does not claim multi-day production operation or
changes to unrelated daily-rotation lifecycle behavior.
