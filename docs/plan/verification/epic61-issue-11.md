# Issue #11 — Independent HTTP directions

Status: complete; source `9a15f5a`, integration `31f61313c3271916f7c3a4a3392419999a4fe01f` pushed and remote verified; GitHub CLOSED 2026-09-08T00:58:39Z; Telegram receipt 3950 (66/31). Integrated six suites/56 tests passed in 1.852 seconds, natural exit 0.
Original title: 요청과 응답이 하나의 HttpPipe 를 공유해 응답 본문에 다음 요청의 바이트가 섞임.
Owner fix_ci14; worktree C:/Work/git/_Snoworca/TTTGate-epic61-ui;
branch fix/epic61-http-directions; baseline 9007917.
Writable production: HttpHandler.ts, HttpPipe.ts, HttpUtil.ts only. Dedicated
HTTP socket fixtures/tests and this ledger are owned. Pool/types/wire #28 and
administrator #35/#71 files remain read-only; #12 onward is not assigned yet.

- [x] Read approved plan/research and existing handlers/parser/tests. Status: complete; reuse bound SocketHandler, real net sockets and HttpPipe callbacks, no mock transport.
- [x] Observe real duplex/body/early-response/context-tail/128-limit RED. Status: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-directions.test.ts` handle 72729 exited 1 naturally: all nine tests failed in 18.826 seconds before production edits. Actual upstream barriers show next requests/uploads/tails do not arrive or responses fail to complete; the baseline's shared parser prevents the later queue-limit checkpoints too. These are test failures, not timeout-as-success claims.
- [x] Minimal independent parser/context implementation and focused GREEN. Status: independent request/response pipes, immutable header-time FIFO (128), interim context retention, final-response slot release and tail-preserving same-direction reset implemented. Overflow logs and destroys without forwarding the 129th request or writing an out-of-order HTTP response. All 11 real-socket cases plus existing HTTP/security regressions passed: six suites/53 tests, 1.276s, natural exit 0. `npm run build -- --force` also exited 0.
- [x] Independent code/behavior/title reviews and regression checkpoint. Status: final review_cert_conflict and review_wave0 PASS; exact title approved and objective results below.
- [x] Commit/integration/push/closure/notification. Status: complete; source `9a15f5a`, integration `31f61313c3271916f7c3a4a3392419999a4fe01f` pushed and remote verified; GitHub CLOSED 2026-09-08T00:58:39Z; Telegram receipt 3950 (66/31). Integrated six suites/56 tests passed in 1.852 seconds, natural exit 0.

Approved policy: immutable request metadata captured at valid headers before
upstream forwarding, 1xx retains FIFO context, final responses consume contexts;
request upload parsing remains independent. At 128 outstanding contexts, reject
the next request before forwarding, log and terminate the connection without an
out-of-order synthetic HTTP response. No new configurable scheduler.
Tests must prove original body bytes/directions, coalesced and split messages,
100 Continue and early final responses while upload is unfinished, context host
association, slot reuse and cleanup. Fixture setup/teardown owns all sockets from
allocation time and cleans partial setup. No fake PASS from timeout/retry.

## Additional test-first checkpoint and final evidence

After the initial nine cases turned GREEN, HEAD/no-body and actual upgrade
controls were added. Before applying their implementation, both changed
production files were fully restored to baseline (temporary implementation patch
retained only under ignored results/http), then all eleven tests were rerun.
Handle 95343 exited 1 naturally: ten failed/one upgrade control passed in 20.79s.
Only after this complete baseline RED was the minimal implementation reapplied
and HEAD rewrite suppression completed. This does not adopt untested production
behavior after the fact; the full implementation was removed before the expanded
test-first cycle. Final 53-test command includes http-directions, existing
HttpHandler.rewrite/HttpUtil.branches and req-05/06/13 security tests.

Actual fixture paths: test/component/http-duplex-fixture.ts and
test/component/http-directions.test.ts. Both peer directions cross real net
sockets and actual SocketHandler/HttpHandler instances; no mock sendData or
decompressor supplies acceptance evidence. Test barriers observe upstream/client
bytes rather than assuming TCP segmentation. Cleanup destroys only owned sockets
and awaits both listeners; owner callback once-only behavior is asserted.

Only HttpHandler.ts and HttpPipe.ts changed in production. Later chunk trailer,
EOF consumer, encoding/header policy, rewrite-limit and duplicate-Host issues
remain separately assigned after #11; pool/types/administrator/wire files are
unchanged. Proposed exact title: `fix: HTTP 요청과 응답 파서 및 대기 문맥 분리`.

## Independent-fixer checkpoint

Reviewer `review_cert_conflict` reported MEDIUM: a WebSocket request turns on the
connection-wide raw bypass before acceptance, so final rejection leaves the next
Host request outside the FIFO. Root assigned different fixer `fix_supply15` only
HttpHandler/HttpPipe and dedicated tests/ledger. The #35 listeners worktree remains
frozen and is not mixed with this change. Added real-duplex rejected upgrade ->
different Host normal request/response regression before the fix; RED result and
repair evidence are recorded below.

Additional MEDIUM from independent `review_wave0`: after accepted 101 and client
close, owner termination occurs but WebSocket early-return suppresses HTTP context
cleanup and upstream EOF/close propagation. Root assigned this to the same separate
fixer; an accepted-upgrade EOF/context/upstream/owner regression is added before
modifying that terminal path. #35 production remains frozen in its separate tree.

First MEDIUM RED command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-directions.test.ts --testNamePattern 'rejected WebSocket'`.
Exit 1 naturally in 0.454 seconds: the next request retained Host: next.example
upstream instead of being parsed/rewritten. Only after RED, request-specific
WebSocket candidacy was retained in immutable FIFO context; connection raw mode
is activated by 101, and HttpPipe no longer enters raw mode at request headers.
Added both next-request-before-rejection and after-rejection controls. The existing
unit raw-frame assertion is preserved with a valid accepted 101 response fixture,
replacing its obsolete request-header-only assumption as root approved.

Second MEDIUM RED command uses the same file with
`--testNamePattern 'accepted upgrade EOF'`. Exit 1 naturally in 0.487 seconds:
one request context remained after actual client close despite ownerCalls=1.
Only after RED, removed the WebSocket early return that suppressed terminal
notification and cleanup. GREEN checks context count 0, WebSocket flag false,
actual upstream socket termination, and owner callback count 1 after repeat destroy.

Final fixer regression: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-directions.test.ts test/unit/server/http/HttpHandler.rewrite.test.ts test/unit/server/http/HttpUtil.branches.test.ts test/security/req-05-smuggling.test.ts test/security/req-06-crlf-injection.test.ts test/security/req-13-chunked-parse.test.ts`.
Exit 0 naturally: six suites/56 tests passed in 1.487 seconds. `npm run build -- --force`
also exited 0 after both repairs. The fixture remains real duplex sockets and
existing owner callbacks; no transport mock, pool/type/wire or #35 edit is included.
The exact title remains unchanged. Root reported both final independent rereviews
PASS: review_cert_conflict ran all 14 real-duplex cases in 1.169 seconds and
review_wave0 ran all 14 in 1.119 seconds, each with natural exit 0. Both MEDIUM
findings are resolved. Root authorized committing the original author changes and
the separate fixer's repairs together under `fix: HTTP 요청과 응답 파서 및 대기 문맥 분리`.
No #35 files belong to this commit; that lane is now being revised by fix_ci14.

## Current completion checkpoint

Status: complete; source `9a15f5a`, integration `31f61313c3271916f7c3a4a3392419999a4fe01f` pushed and remote verified; GitHub CLOSED 2026-09-08T00:58:39Z; Telegram receipt 3950 (66/31). Integrated six suites/56 tests passed in 1.852 seconds, natural exit 0. Main forced build passed at that recorded checkpoint. Earlier author/fixer assignments, pending handoffs and run receipts above are historical evidence. The recorded epic count at that operational checkpoint was 33/66; this issue has no remaining completion gate. The epic, #28 policy decision and other open issues remain unfinished.
