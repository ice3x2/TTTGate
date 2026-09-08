# Issue #41 — Legacy IDs and data-socket identity

Status: complete; source 94875b3, integration b6dbf014745a97b6a85805d1691abab5e9de4e50 pushed and remote verified; GitHub CLOSED 2026-09-08T03:34:05Z, comment 5578706583; root Telegram receipt 3966 (66/38). Integrated three suites/13 tests PASS in 42.105 seconds, natural exit 0; forced build PASS.
Owner review_cert_conflict; worktree `C:/Work/git/_Snoworca/TTTGate-epic61-control`,
branch `fix/epic61-legacy-handler-ids`, base `7a79df4`.
Root approved main `epic61-issue-41-research.md` and recorded exclusive ownership.

- [x] Read original issue and approved allocation/identity design. Status: complete.
- [x] Freeze capacity failure and reuse rules before RED. Status: contract below.
- [x] Observe legacy consumer wrap/collision/reuse and late-handover RED. Status: actual legacy peer/endpoint echo succeeded before wrap; wrap yielded 65535/0/65535, stale handover remained admitted and wrong-ID terminal cleanup deleted legitimate pending state.
- [x] Observe declared exhaustion fixture RED and preserve v2 controls. Status: full occupancy created one new control send and phantom pending/queue instead of one caller failure. Mixed legacy/v2 setup reached legacy zero-ID failure; full v2 controls rerun after implementation.
- [x] Minimum ClientHandlerPool implementation, regression and forced build. Status: final three suites/13 tests passed naturally in 39.971 seconds after lockfile installation; TypeScript 5.9.3 forced build passed.
- [x] Freeze for two independent reviews. Status: review_wave0 and fix_supply15 final code/content/title PASS, zero Critical/High/Medium/Low findings. Source/tests/ledger frozen, root commit authorization pending.

Capacity contract: if all IDs 1..65535 are occupied by pending or active handlers,
sendConnectEndPoint reports the requested session's existing close callback once
with endLength 0. It creates no pending/waiting entry, sends no NewDataHandler or
zero handler ID, does not throw for ordinary capacity, and does not change sibling
ownership. The public void method and negotiated v2 wide/token path remain intact.
Occupancy derives from both maps; unavailable pending entries remain reserved.
Choosing an ID and publishing pending state are synchronous before control send.

Incoming data-socket admission must match sessionID and handlerID. Its rejection
must also prevent terminal callbacks from trusting a mismatched claimed session
and cancelling a legitimate pending/active handler. Only the incoming socket is
closed; existing wire fields and consumers are unchanged.

Tests use actual TTTServer, raw control packets that intentionally ignore wide
metadata in legacy mode, actual DataStatePacket handover and a real endpoint echo.
The local RawControlClient in ProtocolV2.test.ts is not exported; a dedicated
small queue adapter reuses CtrlPacketStreamer rather than changing unrelated tests.
Cursor seeding is disclosed to exercise wrap without 55,000 connections. Exhaustion
uses explicit map occupancy and callback/send observation, not a 65,535-socket load.
No #28 encoding/policy, #29 held action or other consumer/source changes are allowed.

RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/legacy-handler-ids.test.ts`.
Session 9639 exited 1 naturally: five failures, 20.437 seconds. No production
change preceded this run. The late-arrival timeout is a failed liveness assertion,
not success; all fixture sockets/listeners were cleaned and Jest exited normally.

Minimum implementation: per-pool nonzero legacy cursor with pending/active map
occupancy, synchronous reservation, existing once-per-attempt close callback on
exhaustion; v2 continues its existing static wide counter and token generation.
Admission checks the incoming session and handler pair, and clears an unadmitted
session claim before terminal cleanup so an unrelated legitimate session survives.

Initial GREEN: same five-case command, session 13716, natural exit 0, 16.656
seconds. Full legacy OpenSession/result/ACK/echo completed across wrap/reuse,
late socket rejection and mixed legacy-v2 peers. A later test-only strengthening
also requires real queued payload bytes to survive late-arrival rejection and
echo after the legitimate handover; no additional production change was made.

## Compatibility and dependency checkpoint

Command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/legacy-handler-ids.test.ts test/component/server/ProtocolV2.test.ts test/unit/server/ClientHandlerPool.resource.test.ts`.
First broader run 56420 exited 0 naturally: three suites/13 tests, 39.403 seconds.
This covers raw legacy short-ID replies, simultaneous legacy/v2 authenticated
peers with full handover/ACK/endpoint echo, original v2 IDs above 65535, legacy
opt-in/disabled behavior, binding-token mismatch and existing queue accounting.

The first forced build (93177a) exited 1 with seven TS2345 diagnostics in unchanged
AdminServer.ts. Read-only investigation found this old worktree's node_modules
contained TypeScript 5.1.6 while the current manifest/lock require 5.9.3. Root
approved restoring the locked installation, without any AdminServer or dependency
source changes. `npm ci --no-audit --no-fund` (a3cb1c) exited 0, 580 packages;
the manifest and lockfile remain unchanged. Installed TypeScript is now 5.9.3.

After dependency alignment, `npm run build -- --force` (335dfb) exited 0.
The same three-suite command then ran again (45381), natural exit 0:
13 tests passed in 39.971 seconds. This preserves the earlier build failure and
explains the necessary rerun; no unrelated source fix or retry-until-green claim.

Proposed exact title: `fix: 레거시 핸들러 ID 순환과 세션 연결 검증`.
Four scoped files: ClientHandlerPool.ts, dedicated raw-peer fixture/test and this
ledger. All remaining test sockets/endpoint connections are owned and closed in
finally, and TTTServer/echo listeners are awaited. No mocked transport supplies
consumer evidence; cursor seeding and exhaustion-map/send/callback observation
are explicitly test-controlled state. No new wire field, transport consumer,
#28 policy or held #29 action changed. Nothing staged/committed/pushed by author.

## Independent reviewer receipt

review_wave0 compared original #41, approved research, actual diff, raw-peer fixture,
tests and ledger. Result: PASS, zero Critical/High/Medium/Low findings. Legacy
allocation reserves nonzero IDs synchronously and avoids both ownership maps;
negotiated v2 wide/token behavior is preserved. Dual-identity rejection clears the
unadmitted session claim before terminal cleanup, preserving the legitimate
pending/active owner. Exhaustion creates no phantom queue or control send.

Independent selected command:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/server/legacy-handler-ids.test.ts`.
Owned handle 6439 exited 0 naturally: one suite/five tests passed, 16.945 seconds.
Actual consumer cases include wrap, occupied-ID avoidance, release/reuse,
late-arrival rejection with queued-byte preservation and mixed legacy/v2 echo.
The capacity case remains explicitly declared state/callback instrumentation.
Exact proposed title passed scope, signature and progress-marker checks.
Both independent reviews are complete; root commit authorization remains pending. Root
coordinates independent confirmation of this reviewer-authored record; no source
edit, commit, push or closure was performed by this reviewer.

Root relayed fix_supply15's independent final code/content/exact-title PASS with
zero Critical/High/Medium/Low findings. That reviewer independently ran the late
cancelled-session and mixed legacy/v2 cases: handle 17413 exited 0 naturally,
two tests passed and three were filtered out, 8.581 seconds. This is selected
verification, not a second full thirteen-test run. Root owns subsequent commit,
integration, push, closure and notification.

## Operational completion

- [x] Commit/integration/push/closure/notification. Status: complete; source 94875b3, integration b6dbf014745a97b6a85805d1691abab5e9de4e50 pushed and remote verified; GitHub CLOSED 2026-09-08T03:34:05Z, comment 5578706583; root Telegram receipt 3966 (66/38). Integrated three suites/13 tests PASS in 42.105 seconds, natural exit 0; forced build PASS.
Current epic count is 38/66. Root supplied these operational receipts. Earlier authorization-pending statements and reviewer/author execution records remain historical. No remaining completion gate exists for #41; #37 continues under separate assignment, #28/#29 remain unresolved and the epic is incomplete.
