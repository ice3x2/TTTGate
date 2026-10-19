# Issue #12 — Complete chunked message boundaries

Status: complete; source `bf67b9e`, integration `494d72fcb19fcf5df6d2c1621d7d3dc09257e6d7` pushed and remote verified; GitHub CLOSED 2026-09-08T01:28:18Z; Telegram receipt 3955 (66/33). Integrated seven suites/66 tests passed in 1.705 seconds, natural exit 0.
Original title: chunked 응답의 종료 CRLF 가 하류로 전달되지 않아 클라이언트가 무한 대기함.
Owner: `fix_supply15`; branch `fix/epic61-http-chunk-boundary`;
worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-ui`; base `31f6131`.
Writable: minimum HttpPipe/HttpHandler/HttpUtil changes if required, dedicated
HTTP tests and this ledger. #29 EOF consumer/pool/types/wire and #35 are excluded.

- [x] Read original issue, approved HTTP research and current parser/fixtures. Status: complete; reuse #11 real-duplex fixture and direct HttpPipe callbacks.
- [x] Add and observe byte-exact RED for zero-size end, trailers, payload/CRLF and terminator splits. Status: six tests failed naturally before implementation; exact results below.
- [x] Implement minimum boundary handling without weakening framing rejection. Status: only HttpPipe changed; hold payload until its full CRLF, forward raw terminal CRLF/trailers after existing validation.
- [x] Run #11 duplex/upgrade/128 and smuggling/CRLF/chunk regressions, forced build and two independent reviews. Status: regression/build and both final reviews passed; independent test addition and receipts below.
- [x] Commit/integration/push/closure/notification. Status: complete; source `bf67b9e`, integration `494d72fcb19fcf5df6d2c1621d7d3dc09257e6d7` pushed and remote verified; GitHub CLOSED 2026-09-08T01:28:18Z; Telegram receipt 3955 (66/33). Integrated seven suites/66 tests passed in 1.705 seconds, natural exit 0.

Reuse findings: HttpPipe.readChunkedTrailer consumes the final CRLF/trailer block
without its raw onData callback. readChunkedData removes payload before confirming
its split CRLF, so a later write can lose that payload. Existing raw-versus-pure
delivery flag already distinguishes forwarded framing from decoded payload; reuse
it and existing trailer/header validation. No new buffering framework or EOF API.

## RED and GREEN evidence

RED: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-chunk-boundary.test.ts`.
Exit 1 naturally: six tests failed in 0.756 seconds before source edits. Raw zero
end omitted its final CRLF; trailer records were missing; real split response and
byte-at-a-time decoded mode lost hello payload. Tests were already written to
exercise every two-part split position, including the final terminator.

An intermediate patch accidentally matched the similarly named Content-Length
guard instead of the chunk-data guard. The regression run 73659 failed 11 tests
(51 passed) in 7.883 seconds; that unintended edit was reverted and the intended
chunk guard changed. The final diff does not change Content-Length parsing.

Final regression: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-chunk-boundary.test.ts test/component/http-directions.test.ts test/unit/server/http/HttpHandler.rewrite.test.ts test/unit/server/http/HttpUtil.branches.test.ts test/security/req-05-smuggling.test.ts test/security/req-06-crlf-injection.test.ts test/security/req-13-chunked-parse.test.ts`.
Exit 0 naturally: seven suites/65 tests passed in 1.649 seconds. New coverage also
includes actual chunked requests followed by another request and non-UTF8 binary
response payload bytes. Direct parser tests deterministically split each boundary;
real duplex tests establish actual transport byte preservation without claiming
that individual TCP writes always map to distinct receive events.

`npm run build -- --force` passed after the corrected production implementation.
Rewriting/pure-data mode retains payload-only output; raw mode preserves original
framing. Existing smuggling/CRLF/chunk-size rejection and #11 upgrade/termination/
128-context controls remain part of the passing regression.

Changed scope: `src/server/http/HttpPipe.ts`, one dedicated test file, this ledger.
No #29 EOF/pool/endpoint type, #35, manifests or wire-format change.
Approved exact title: `fix: chunked 본문과 종료 경계의 바이트 유실 방지`.
Both independent final reviews and root commit authorization received.

## Independent verification-only addition

Root assigned fix_ci14 as an independent test-only fixer after reviewer
review_cert_conflict found the real HTTP-client completion assertion missing.
Original production author remains fix_supply15; no production code changed in
this addition. A real Node http.request with a keep-alive Agent uses the existing
fixture's connected TCP socket and parses a chunked response with trailers.
Its end callback captures that the upstream is still readable/writable and not
destroyed; response.complete, decoded hello bytes and trailers are asserted.
No upstream end()/FIN is sent before that callback. Existing raw-byte assertions
remain intact. Timeout rejects the test and owned request/agent are cleaned up.

Verification command: `node node_modules/jest/bin/jest.js --runInBand --silent
--runTestsByPath test/component/http-chunk-boundary.test.ts
test/component/http-directions.test.ts test/security/req-13-chunked-parse.test.ts`.
Exit 0 naturally: three suites/29 tests passed in 1.414 seconds. This is an
authorized verification-strengthening GREEN on the already-reviewed fix, not a
new production behavior or a claimed additional RED. Test and ledger are frozen
for independent rereview; root controls subsequent commit/integration.

Final rereview receipts: review_cert_conflict confirmed that actual HTTP end while
upstream remains open resolves the MEDIUM finding. review_wave0 independently ran
the selected completion case: one test passed in 0.344 seconds, natural exit 0.
Both final code/content/title reviews PASS; root authorized this three-file commit
including the independent test fixer fix_ci14's addition. No #29 implementation or
push is authorized by this checkpoint.

## Current completion checkpoint

Status: complete; source `bf67b9e`, integration `494d72fcb19fcf5df6d2c1621d7d3dc09257e6d7` pushed and remote verified; GitHub CLOSED 2026-09-08T01:28:18Z; Telegram receipt 3955 (66/33). Integrated seven suites/66 tests passed in 1.705 seconds, natural exit 0. Main forced build passed at that recorded checkpoint. Earlier author/fixer assignments, pending handoffs and run receipts above are historical evidence. The recorded epic count at that operational checkpoint was 33/66; this issue has no remaining completion gate. The epic, #28 policy decision and other open issues remain unfinished.
