# HTTP exact-limit body completion observation

Status: issue75 draft; root owns registration and closure. Test-only correction implemented after diagnostic RED; selected pair and focused HTTP regression GREEN; independent review pending. No production or configured Jest timeout changes.

- [x] Preserve original full-run failure and inspect observation scope. Status: root reported exact-limit chunked response timeout at the fixture's2000ms polling deadline; no full-run PASS inferred.
- [x] Run one approved diagnostic pair before correction. Status:2FAIL/8skip,5.115s,native exit1; exact raw receipts retained below.
- [x] Replace exact-pair body polling with explicit completion. Status: request readiness remains the existing2s f.until; completion listeners attach before upstream write and accept only actual response end, rejecting request/response error, abort or premature close. Original exact status/end/complete/aborted/16MiB assertions remain.
- [ ] Complete focused regression and independent review. Status: after cancellation review correction, selected3PASS/8skip and13-file HTTP regression143PASS, natural exit0. Independent re-review pending; earlier candidate receipts preserved below.
- [ ] Integrate, verify, push, close and notify. Status: root-owned later gates; no closure or delivery claimed.

## Scope and deadline disclosure

Only test/component/http-body-limit.test.ts and this ledger change. The existing observer exposes its actual ClientRequest; the exact-limit pair and stalled-response regression register completion promises. Existing cases that intentionally abort create no rejection promise. Added request/response listeners are removed before existing fixture disposal. No retries, payload changes, production changes, configured Jest timeout changes or weakened assertions were introduced. The new completion timer is documented below.

This changes the body operation's effective deadline: previously the body had a separate2s polling limit; the final completion helper has an absolute4500ms deadline measured from case start, including setup/readiness. Its timer rejects the awaited promise and removes its listeners, allowing finally cleanup within the remaining500ms of the unchanged Jest5s budget. It does not rely on Jest timeout to cancel network work. This is an explicit observation-policy change, not proof that the transfer meets2s. The fixture's2s request-readiness polling remains unchanged. Reuse review found existing observeHttp and withHttpDuplex cover real socket/Node response setup and teardown; the same local responseCompletion helper serves the positive pair and the stalled-response regression.

## RED and diagnostic facts

One diagnostic-only run used the original production code,16MiB payload, exact assertions and2000ms fixture polling. Raw log and before-disposal JSON are in `C:/Users/beom/AppData/Local/Temp/epic61-body-limit-diagnostic-fb7dafeba97948789b583a755b01692d`: run.log, exact-false.json and exact-true.json. Result:2FAIL,8skip,5.115s,natural exit1. Temporary call-through delegates counted bytes/calls and first/last timestamps; one final snapshot preceded teardown. No per-chunk logs or extra repeated Buffer.concat were added. Delegates/listeners were restored; diagnostic instrumentation was removed from final test code after preserving these files.

At2046.782/2058.099ms (Content-Length/chunked), Node had received14008320/12525568 body bytes, with status200,end=false,complete=false,aborted=false. All upstream input had reached the handler by653.357/671.266ms; all16793678 output bytes were enqueued by727.036/769.994ms. Parser state0 and parser/body buffers0 showed no retained parser/body data at that snapshot. Raw memory output backlog was2189407/3673607bytes; native writableLength16400 in both, outputDrained=false, sockets open. Those snapshots show ongoing output drain at the old observation deadline; they do not themselves establish eventual successful completion.

## GREEN receipts

- Selected once: `node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles test/component/http-body-limit.test.ts -t 'exact encoded limit'`;2PASS,8skip,1suite PASS,5.417s,natural exit0. Evidence: `C:/Users/beom/AppData/Local/Temp/epic61-body-completion-81bd2c6ef4ff44309fd8db20125fb288/selected.log`.
- Focused regression once: `node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles 'test/component/http-.*\.test\.ts$' test/unit/server/http test/security/req-05-smuggling.test.ts test/component/handler-map-lifecycle.test.ts`;13suites PASS,142tests PASS,19.027s,natural exit0. Raw output: same evidence directory/http-regression.log.

## Independent review correction: cancellable deadline

Both independent reviewers identified MEDIUM: the first event-completion candidate relied on Jest's5s budget, which reports failure without cancelling the awaited promise, so a stalled peer could prevent finally cleanup. The preceding2PASS/142PASS receipts describe that earlier candidate only.

Before implementing cancellation, the existing completion behavior was extracted unchanged into a shared local helper and a real stalled-peer regression was added. The peer advertises2bytes and writes1byte. An external4700ms guard resolves only the test observer and guarantees RED cleanup; it does not make helper completion pass. The new test expected a deadline rejection and restored request error-listener count. RED:1FAIL/10skip,5.36s,native exit1, receiving 'external cleanup guard' instead of 'Response completion deadline exceeded'. Evidence: same directory/stalled-red.log.

Only after that RED, the helper gained the absolute4500ms timer. Success, request/response error, abort, premature close and timeout remove all helper listeners and clear the timer. Timeout rejects; it never resolves success. The existing disposal remains idempotent in finally. The stalled test verifies deadline rejection before its4700ms guard, restored error-listener count before disposal, and actual owned client destruction after fixture cleanup. No configured Jest deadline increase, production change or retry.

Selected GREEN after repair: exact pair plus stalled case,3PASS/8skip,9.686s,natural exit0; same directory/completion-green.log. Same HTTP regression command after repair:13suites PASS,143tests PASS,20.535s,natural exit0; http-regression-after-review.log. Each post-repair invocation ran once; later indentation-only alignment does not change semantics.
