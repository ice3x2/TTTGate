# Incomplete data-handshake terminal observation research

Status: #74 implemented and final full verification complete; push/closure pending. Sourced983302 integrated asd5a321f, final independent code reviews C/H/M/L0. Ordinary971PASS/4skip and coverage970PASS/5skip naturally exited0 on11cabaf; [final verification](epic61-final-verification.md) records actual receipts and skipped scope.

- [x] Inspect existing fixture and production lifecycle. Status: source evidence below supports an observation-order gap; it does not prove the full runtime correction yet.
- [x] Register the discovered issue and retain the full-run failure receipt. Status: [issue #74](https://github.com/ice3x2/TTTGate/issues/74) created and registered in parent #61 by root; RED receipt retained below.
- [x] Observe the existing case after root releases runtime ownership. Status: original failure inspected; selected corrected case passed with the150ms timeout and existing h.until deadline unchanged.
- [x] Apply the minimal test-only observation correction, run focused regression and obtain independent review. Status: selected1PASS/focused24PASS, final independent code reviews C/H/M/L0, sourced983302->integrationd5a321f; final ordinary and coverage passed on11cabaf. Push and closure remain pending.

## Evidence and scope

`test/component/server/data-handshake-framing.test.ts` (incomplete token extension case, around line100) writes only the fixed frame plus one token-length byte, observes those bytes at the real receiver, confirms membership in `_unauthenticatedHandlerIds`, and applies the existing `handler.setTimeout(150)` API. It then waits only for the client-side `h.socket.destroyed` before immediately asserting server-side registration removal. These are different sockets and terminal callbacks; observing client termination alone is insufficient evidence that server cleanup has completed.

`test/component/server/data-handshake-fixture.ts` observes actual receiver calls and exposes the server handler. Its finally block destroys owned sockets. Therefore the registration and terminal assertions must complete inside the case, before finally/dispose can make them pass through fixture cleanup.

`src/server/TunnelServer.ts` registers unknown handlers in `onClientHandlerBound` and removes entries through `clearUnauthenticatedHandler`. `markHandlerAuthenticated` also removes the registration, so observing absence alone cannot establish that an incomplete token was rejected rather than authenticated. The fixture already uses a call-through observer for this method in adjacent malformed/wrong-token cases; reuse that pattern with handler-identity filtering.

`src/util/SocketHandler.ts` applies the native socket timeout and closes through its existing handler lifecycle. No timeout policy, parser, authentication path or production terminal behavior needs to change based on the currently available evidence.

## Proposed minimal correction and acceptance

1. Install a call-through `markHandlerAuthenticated` observer around the partial-token operation and retain the original method for finally restoration. Count calls only for the observed incoming handler, so successful sibling authentication is not misclassified.
2. Preserve `handler.setTimeout(150)` exactly. Use one existing `h.until` deadline (3000ms,5ms polling in `legacy-handler-id-fixture.ts:15`) to await client destroyed **and** server native socket destroyed/handler terminal **and** `_unauthenticatedHandlerIds` absence. Do not increase fixture deadlines, add retry loops outside h.until, or force-close the handler to obtain the result.
3. Assert server terminal state, registry absence, zero authentication marks for the partial-token handler, unchanged policy and preserved pending-session behavior before fixture disposal. Retain the real sibling handshake and echo already present in the case.
4. Record the original full-run failure as the RED receipt. If a diagnostic observer is added temporarily, disclose its exact predicates and timestamps; no repeat-until-PASS claim. Run the case and complete data-handshake-framing suite once after the correction, then independently review the diff and runtime receipts.

Expected implementation scope: only `test/component/server/data-handshake-framing.test.ts`, plus the discovered issue/evidence records. Any evidence of a production leak, successful partial-token authentication or sibling regression requires separate triage rather than weakening these predicates.

## Runtime receipts

- Original RED precedes test edits: `C:/Users/beom/AppData/Local/Temp/epic61-final-ea4d5809/ordinary.log`, lines 40546-40562, reports expected false / received true for `_unauthenticatedHandlerIds.has(handler.id)` at the old line100 after waiting only for client destruction. Root confirmed that run terminated before releasing runtime ownership.
- Correction installs a call-through authentication observer before writing the partial frame and records handler identities, including callbacks that could occur before receiver observation. Assertions filter for the incoming handler; the successful sibling remains independently admissible. A single existing `h.until` now awaits client destruction, server native destruction, server handler terminal state and registration removal. Pending-session identity, policy equality and absence of incoming authentication are asserted before fixture disposal; the sibling performs its real handshake and echo before the observer is restored in finally. No source or timeout changes.
- Selected GREEN: `node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles test/component/server/data-handshake-framing.test.ts -t 'incomplete token extension'`; 1 suite PASS,1 test PASS,6 skipped,5.914s, native exit0. Log: `C:/Users/beom/AppData/Local/Temp/epic61-handshake-selected.log`.
- Focused regression GREEN: `node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles test/component/server/data-handshake-framing.test.ts test/component/server/data-handshake-payload.test.ts test/component/client/control-framing.test.ts`; 3 suites PASS,24 tests PASS,79.765s, native exit0. Log: `C:/Users/beom/AppData/Local/Temp/epic61-handshake-regression.log`. Both invocations ran once after the correction; no production change, deadline increase or process termination was used.
