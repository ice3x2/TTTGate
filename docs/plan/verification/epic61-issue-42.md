# Issue #42 — Deliver the admitted handshake suffix once

Status: implementation/regression/build and both independent code/content/title reviews PASS; source frozen for root commit/integration.
Owner review_cert_conflict; control worktree `fix/epic61-data-handshake-payload`,
base `f2400463f7c2cb0fd31e4030418101c7fd813cfd`. Main assignment/research approved.

- [x] Read original #42, integrated #43 and approved local contract. Status: complete; existing isEnd admission guard is sufficient, no ClientHandlerPool return change.
- [x] Freeze order, cleanup, zero-tail and failure contracts. Status: below.
- [x] Observe real coalesced-tail/ordering/cleanup/overflow RED and missing-queue control. Status: eight failures/three controls, natural exit 1, 41.527 seconds; exact evidence below.
- [x] Minimum TunnelServer helper/dispatch implementation and stronger #43 suffix assertion. Status: one shared payload path; clear completed accumulator and dispatch only live admitted nonempty suffix. Actual duplicate-overflow RED justified the live-handler fallback guard. Existing #43 suffix control now requires actual queue/ACK/delivery, not just retained bytes.
- [x] Relevant regressions and forced build. Status: two suites/18 tests plus separate seven suites/43 tests passed naturally; forced build exited 0. Exact commands below.
- [x] Two independent issue/diff/evidence/title reviews. Status: both independent reviews PASS; root integration pending.

On complete parse, keep suffix locally and clear the completed accumulator. Run
existing admission; ended handlers receive neither authentication nor dispatch.
For a live accepted handler, mark authenticated then synchronously dispatch only
a nonempty suffix through one private receiveSessionPayload helper shared with
later chunks. Existing session association, activity and queue limits are reused.
No await/reordering/second queue. Incomplete handshake accumulation stays unchanged.

Actual tests use reviewed withHandshake/withLegacyIds real TCP/control/data/endpoint
fixtures. Record that the parse-completing read contains the suffix; writes alone
are not segmentation evidence. Before endpoint ACK the suffix must be counted in
the existing queue and not delivered. After normal result/ACK, markers A+B arrive
in order exactly once and a later endpoint echo succeeds. Rejected suffixes must
not persist on ended handlers or touch another session's buffers/echo. Empty tails
must create neither a receive-queue item nor payload callback.

Overflow contract: existing queue-limit rejection closes only the offending
session, releases its accounting and reports one session-close callback. The
current pool reports overflow itself, so the outer fallback may need a live-handler
guard, but only after actual RED. A declared missing-queue fixture with a live
handler must still cause one fallback close. Tests disclose the queue/policy and
callback observation boundaries and preserve the original callbacks.

Allowed: TunnelServer data receive/helper, dedicated tests/ledger and strengthening
the existing #43 retained-suffix consumer assertion. ClientHandlerPool, parser,
producer, shared types, wire and #28/#29/#40 decisions are excluded. No new issue
scope or general lifecycle cleanup is authorized.

RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/data-handshake-payload.test.ts`.
Session 65845 exited 1 naturally, eight failed/three passed, 41.527 seconds.
Both real legacy/v2 reads contained frame plus all three suffix bytes, but
receiveBytes stayed zero. Completed empty tails and rejected session/token tails
remained retained. Tail overflow never reached its queue/close path; later-byte
overflow reported the same close callback twice. The still-live missing-queue
fallback already reported exactly once, and prefix/control rejection controls
passed. These are actual assertions/failed deadlines, not timeout-as-success.
No production change preceded this RED and no fixture correction was necessary.

## GREEN and compatibility receipts

Payload/consumer command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/data-handshake-payload.test.ts test/component/server/data-handshake-framing.test.ts`.
Session 59635 exited 0 naturally: two suites/18 tests PASS in 64.036 seconds.
The existing #43 legacy suffix assertion now requires cleared accumulator, exact
receive-queue bytes and actual delivery after normal OpenSession/result/ACK. Its
ID checks remain intact; parser remainBuffer byte assertions are unchanged.
The new cases verify real legacy/v2 binary A+B ordering and later endpoint echo,
zero-tail callback avoidance, rejected suffix cleanup, actual duplicate-overflow
repair and still-live missing-queue fallback. The original prefix/control
rejection controls also preserve legitimate pending bytes and sibling echo.

Compatibility command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/commons/data-state-framing.test.ts test/unit/commons/DataStatePacket.test.ts test/util/r2-req-02-buffer-endian.test.ts test/component/server/ProtocolV2.test.ts test/component/server/legacy-handler-ids.test.ts test/unit/server/ClientHandlerPool.resource.test.ts test/unit/client/req-14-connect-race.test.ts`.
Session 18501 exited 0 naturally: seven suites/43 tests PASS in 42.776 seconds.
The two commands are separate receipts, not an invented single 61-test run.
`npm run build -- --force` (5f008b) exited 0.

Proposed exact title: `fix: 데이터 연결의 초기 페이로드를 순서대로 전달`.
Four scoped files: TunnelServer.ts, dedicated data-handshake-payload.test.ts,
the stronger existing consumer assertion and this ledger. Reused fixtures remain
unchanged. Resource limit and missing-queue fixtures are explicit controlled
state; all actual transport calls delegate to the existing implementation.
No ClientHandlerPool/parser/producer/type/wire or #28/#29/#40 change. No source
exception was hidden or original failed run relabeled. Nothing staged/committed.

## Independent reviewer receipt

review_wave0 compared original #42, approved research, frozen production/test diff
and execution ledger. Result: PASS, zero Critical/High/Medium/Low findings and
exact-title PASS. Synchronous nonempty-tail dispatch follows admission and clears
the completed accumulator. The shared existing payload path retains activity and
queue handling; actual overflow RED and missing-queue control justify the narrow
duplicate-close guard. Producer/parser/ClientHandlerPool behavior is unchanged.

Independent selected command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/data-handshake-payload.test.ts --testNamePattern 'handshake suffix precedes'`.
Owned handle 29095 exited 0 naturally: one suite/two legacy-v2 delivery cases PASS,
nine filtered out, 8.734 seconds. This is selected actual queue/ACK/ordered-delivery
evidence, not a new full compatibility run. Both independent reviews are complete;
root authorization remains pending. Root coordinates independent confirmation of
this record. Source and tests remain frozen.

Root relayed fix_supply15's final code/content/exact-title PASS, zero Critical/
High/Medium/Low findings, without additional test execution. Both reviewer results
are complete; root owns subsequent commit/integration and closure.
