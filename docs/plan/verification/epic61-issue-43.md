# Issue #43 — Decode the negotiated data-handshake format

Status: implementation and test-only M1 coverage follow-up complete; both final independent rereviews PASS. Source/tests frozen; root commit authorization and integration pending.
Owner review_cert_conflict; control worktree `fix/epic61-data-handshake-framing`,
base `0ca13992dadc8bc124f65230e866c5470eefbd23`.
Root-approved API/research: main `epic61-data-handshake-research.md`.

- [x] Read issue, approved API and producer/consumer reuse. Status: complete.
- [x] Freeze incomplete/invalid/complete and required-format contract. Status: below; no producer changes permitted.
- [x] Observe malformed/split/token/legacy parser and actual consumer RED. Status: corrected run 34575 plus additional admission/required-format RED below, before production.
- [x] Minimum two-file implementation and two existing unit-call migrations. Status: approved result API, pool identity pinning/format selection and conditional rejection implemented; producer and #42 delivery unchanged.
- [x] Framing/consumer GREEN, compatibility and forced build. Status: four suites/35 tests plus separate four suites/14 tests passed naturally; forced build exited 0. Exact receipts below.
- [x] Two independent original-issue/API/diff/evidence/title reviews. Status: original production reviews PASS; test-only M1 follow-up was separately rereviewed by fix_supply15 and review_cert_conflict, both PASS. Root commit/integration remains pending.

Frozen signatures in DataStatePacket.ts:

```ts
type FixedHeaderResult =
    | {kind: "incomplete"}
    | {kind: "invalid"; reason: string}
    | {kind: "complete"; ctrlID: number; handlerID: number; firstSessionID: number};
static readFixedHeader(buffer: Buffer): FixedHeaderResult;
static fromBuffer(buffer: Buffer, format: "legacy" | "token"): {
    packet: DataStatePacket | undefined; remainBuffer: Buffer | undefined; error?: string;
};
```

Predictable invalid prefixes return diagnostics, not new throw/catch control flow.
Incomplete bytes retain their buffer. Legacy consumes exactly the original fixed
frame; token mode waits for uint16 length and the entire token. Explicit zero
length is decoded and remains subject to the existing binding-token rejection.
TunnelServer peeks only the validated fixed header, obtains its authenticated
pool, and pins/checks that pool object across fragments before full admission.
No raw-buffer-size mode guessing or fallback is permitted. Unknown/replaced pool
is rejected before publishing handler identity. Existing deadline/connection caps
remain authoritative.

The receiving observer wraps/delegates the actual TunnelServer data callback and
counts received bytes before allowing the test to send continuation. It does not
claim that arbitrary TCP writes create separate reads. Actual legacy/v2 controls,
DataStatePacket and endpoint echo reuse the reviewed #41 fixture. A pool-replacement
control may use a disclosed map alias/state fixture with real pool/socket objects;
it is not a normal production control-ID reuse or full network-load claim.

Allowed production: DataStatePacket.ts and TunnelServer handshake only. Existing
unit format migration: test/unit/commons/DataStatePacket.test.ts and
test/util/r2-req-02-buffer-endian.test.ts. Dedicated tests/fixture and ledger only.
Producer bytes, ClientHandlerPool, generic types, #42 payload delivery and #28/#29
remain untouched. #43 verifies parsed suffix/admission, not successful #42 delivery.

Initial run 55071 exited 1, nine failures/one control in 21.979 seconds. The
parser cases directly established premature token completion, legacy suffix
consumption and thrown invalid-prefix handling; missing fixed-header API was a
separate contract failure. Consumer evidence from this run is not accepted as
RED: focused diagnosis 77246 and 37171 found the observing fixture called an
instance method without its receiver, causing an unrelated TypeError on pool
lookup. The wrapper now delegates with the original TunnelServer as receiver.
Production is still unchanged; corrected actual-consumer RED must be rerun.
Diagnostic log: results/handshake/issue43-deadline-diagnostic.log.

Corrected full RED 34575 exited 1 naturally: eight failures/two controls in
22.632 seconds. Actual receiving barriers now delegate with the correct receiver:
v2 fixed-header completion deletes pending state prematurely, legacy coalesced
suffix prevents OpenSession, and replaced pool identity accepts an in-flight
handshake. Existing truncated-token deadline/sibling echo and producer-byte controls
pass. No production change preceded this corrected run.
Two additional pre-implementation consumer guards cover rejected-token auth marking
and unknown ctrlID's unvalidated session claim reaching terminal cleanup.

Additional RED 85309 exited 1 naturally: two failures in 9.719 seconds. Rejected
token was still marked authenticated and unknown ctrlID's unvalidated session
claim deleted a legitimate pending session. Both assertions are now guarded by
the parser/pool lookup before identity publication and the actual admission result
(existing synchronous isEnd state), without ClientHandlerPool edits.
Missing explicit format RED bcfaf8 exited 1 in 0.671 seconds (one selected case):
the baseline silently completed a legacy frame instead of returning a diagnostic.

## GREEN and compatibility receipts

Framing/consumer command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/commons/data-state-framing.test.ts test/component/server/data-handshake-framing.test.ts test/unit/commons/DataStatePacket.test.ts test/util/r2-req-02-buffer-endian.test.ts`.
Session 29277 exited 0 naturally: four suites/35 tests, 29.094 seconds. Both
existing unit files only add explicit format arguments; their byte/field assertions
remain intact. Producer toBuffer is unchanged. New direct tests enumerate every
two-part cut, byte-at-a-time token input, malformed/missing format results and
legacy arbitrary suffix bytes. Actual receiving-side observations gate token
continuation, and the valid v2 path completes OpenSession/result/ACK and echo.
Legacy suffix is retained byte-exact after admission; #42 delivery remains open.

Compatibility command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/ProtocolV2.test.ts test/component/server/legacy-handler-ids.test.ts test/unit/server/ClientHandlerPool.resource.test.ts test/unit/client/req-14-connect-race.test.ts`.
Session 92312 exited 0 naturally: four suites/14 tests, 51.150 seconds. This
preserves v2 wide IDs/token mismatch/legacy opt-in, #41 mixed-peer/late-arrival
echo, pending queue limits and the existing real connection-race test. These are
two separate passing commands, not an invented single 49-test run.

`npm run build -- --force` (3936c4) exited 0 after production and unit migration.
No fixture failed after the explicitly recorded receiving-wrapper correction.
The incomplete-token test shortens only its owned handler timeout through the
existing setTimeout API; it does not claim the default policy is 150 ms or change
production deadlines. Pool-replacement uses the disclosed actual-pool map alias
fixture and is not a claim that ordinary control IDs are naturally reused there.

Proposed exact title: `fix: 데이터 연결 프레임을 협상된 형식으로 해석`.
Eight scoped files: two production, two existing unit-call migrations, two new
test files, one receiving-observer fixture and this ledger. No ClientHandlerPool,
producer, generic type, #42 payload dispatch, #28 or held #29 changes. Files are
frozen and unstaged; root owns all commit/integration/notification gates.

## Independent reviewer receipt

review_wave0 final code/content/exact-title review: PASS, zero Critical/High/Medium/
Low findings. Original #43, approved explicit API and frozen diff were compared.
Negotiated pool identity, predictable-invalid result handling and producer bytes
are preserved; rejected admission is not marked authenticated. #42 suffix delivery
remains explicitly separate from this framing repair.

Independent command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/commons/data-state-framing.test.ts test/unit/commons/DataStatePacket.test.ts test/util/r2-req-02-buffer-endian.test.ts`.
Execution 86639e exited 0 naturally: three suites/29 tests PASS in 1.032 seconds.
This selected parser/unit run is distinct from the author's real-consumer and
compatibility commands. Separate fix_supply15 final review and root commit
authorization remain pending; source is frozen. Root coordinates independent
confirmation of this reviewer-authored record.

## Separate test-only coverage follow-up

Root assigned review_wave0 as a different test-only fixer after fix_supply15
identified missing actual-consumer invalid-prefix coverage. Original production
author remains review_cert_conflict. Only data-handshake-framing.test.ts and this
ledger changed; DataStatePacket/TunnelServer production is unchanged.

The new case keeps the data-channel delimiter and corrupts the following prefix
byte on an owned socket. It checks terminal state, zero authentication marking,
unauthenticated-registry cleanup, identical legitimate pending/queue objects and
preserved real queued bytes. An already-active sibling echoes before/after the
rejection; the legitimate pending session then completes handover and echoes its
retained marker and a later marker. The existing fixture owns and closes sockets
and restores its receiving observer; the authentication observer is restored in
finally. This strengthens coverage of existing behavior; no new production RED
is claimed. All original parser RED and fixture-diagnosis history remains above.

Consumer regression command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/data-handshake-framing.test.ts`.
Owned handle 5491 exited 0 naturally: one suite/seven consumer tests passed in
26.015 seconds. This includes the new malformed-prefix case and all existing
framing consumers. Source/test/ledger are now frozen for fix_supply15 and
review_cert_conflict independent rereviews. Earlier review_wave0 PASS concerns
the original production change; it is not self-verification of this new test.

## Final coverage rereview checkpoint

Status: M1 resolved; root confirmed both fix_supply15 and review_cert_conflict
independent rereviews PASS for review_wave0's separate test/ledger addition.
Original production author review_cert_conflict did not edit the follow-up test.
Its independent selected command was:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/data-handshake-framing.test.ts --testNamePattern 'actual malformed data prefix'`.
Execution 9c0f10 exited 0 naturally: one test PASS, six filtered out, 5.937 seconds.
This is a selected consumer check, not another full compatibility run. Current
DataStatePacket/TunnelServer blobs `1fc31d3`/`c1b51a9` match review_wave0's
pre-follow-up record. No production change or additional production RED is claimed.

Both final rereviews found no additional material findings. Exact title remains
`fix: 데이터 연결 프레임을 협상된 형식으로 해석`. Source and tests stay frozen;
root commit authorization, integration, push, closure and notification are pending.