# Issue #30 — Finite text rewrite eligibility

Status: implementation and independent test-only live-sibling correction passed both final rereviews; source/test frozen for root commit/integration. Original first-review and M1 history remain preserved.
Approved API: HttpUtil.canRewriteTextEncoding(HttpHeader):boolean; HttpHandler eligibility AND before framing/header commit. Scope: these two production hunks, dedicated tests/fixture and ledger only. #32/EOF29/pool/new codecs remain excluded.

- [x] Read approved body research and reuse. Status: existing findHeaders/raw path/codecs and withHttpDuplex reused; Node HTTP parser observes completion rather than FIN assumptions.
- [x] Observe actual finite bypass/codec/ambiguity RED. Status:20failed/4positive controls before source; detailed receipts below.
- [x] Minimum eligibility helper/integration. Status: only precommit AND predicate and helper; existing codecs/policies unchanged.
- [x] Focused regression/build. Status:24initialGREEN then26dedicated cases inside94-test regression/buildPASS.
- [x] Two independent reviews. Status: review_wave0 and fix_lint_diagnostics final M1 rereviews PASS, zero findings; existing exact title PASS. Root commit/integration pending.
- [x] First independent review. Status: review_wave0 code/content/exact-title PASS, zero Critical/High/Medium/Low findings. Second fix_lint_diagnostics review and root commit authorization remain pending.

## Independent reviewer receipt

review_wave0 compared original #30, approved encoding contract, final production
predicate/helper, dedicated tests and ledger. Result: PASS. Eligibility precedes
header commitment; actual Node HTTP finite completion, next exchange, opaque raw
bytes/framing and supported codec replacement are asserted. Some ambiguity cases
are direct helper tests, and no additional live sibling is created in the new
fixture; those limits remain explicit and are not a blocking gap for this
connection-local predicate change. Existing explicit header policies and codec/
decompression behavior remain unchanged; no EOF/#29 scope is inferred.

Independent command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-body-encoding.test.ts`.
Execution7dbbe4 exited0 naturally: one suite/26tests PASS,0.935seconds. This selected
run is separate from the author's94-test regression. Exact proposed title PASS.
Source/test files remain frozen; root coordinates second review and independent
confirmation of this reviewer-authored record before commit.

Contract: no or single supported coding identity/gzip/deflate/br; absent charset or one exact UTF-8 quoted/unquoted, case-insensitive and trimmed. Duplicate/empty/ambiguous Content-Type/Encoding/charset or unsupported/multi-codec/nonUTF8 returns false. Existing text MIME/rewrite/has-body/CL-or-chunked predicates remain ANDed. Bypass preserves body/framing/type/encoding, unrelated31/33/header policies unchanged. Supported codec errors and decompression-limit behavior unchanged.

RED29fa11 before production: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-body-encoding.test.ts`,exit1,20failed/4passed0.87seconds. Ten real finite opaque/charset cases fail byte/framing preservation, ten additive API contracts fail missing helper; four actual single-codec positive controls already pass. Node HTTP uses an owned existing fixture socket through a keep-alive Agent, observes response end/complete and sends a second request on that connection. Exact raw framed-byte equality is additional bypass evidence; upstream remains open. No EOF completion or native compression decoder behavior is replaced.

Before implementation, selected euc-kr diagnostic68a9d6 (`--testNamePattern 'opaque euc-kr'`) exited1,2failed/22filtered0.735s. Actual expected bytes176/161/255/0/128 became UTF8 replacement sequences, both CL/chunked; this confirms functional RED rather than setup failure. No source edits preceded either command.

Minimum helper reuses case-insensitive findHeaders, rejects duplicate type/encoding, unsupported/non-single encoding and invalid/duplicate/nonUTF8 charset. HttpHandler adds its boolean to existing eligibility before changeMode/header output. No codec/body/overflow/EOF behavior modified. e21d97 same focused command after changes:24PASS0.925s natural0. Two subsequent positive controls add actual absent-charset/no-encoding CL/chunked replacement, without source changes.

Final regression c55010:
`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-body-encoding.test.ts test/component/http-duplicate-host.test.ts test/component/http-host-header.test.ts test/component/http-directions.test.ts test/component/http-chunk-boundary.test.ts test/unit/server/http/HttpHandler.rewrite.test.ts test/unit/server/http/HttpUtil.branches.test.ts test/security/req-05-smuggling.test.ts`.
Eight suites94testsPASS2.787seconds natural0, including26new cases and existing31/33/direction/chunk/decompression-limit/smuggling controls. `npm run build -- --force`77ea80 exited0. Selected test agents/sockets are closed in finally through existing owned fixture; no real remote host is contacted (public.example is HTTP Host on supplied loopback socket only).

Evidence limits: duplicate-field/charset malformed variants have direct helper contracts, while euc-kr/zstd/multiple/duplicate-or-emptycharset finite bypass uses actual Node HTTP completion/raw bytes. Codec positives use real zlib decoding and sequential next-context checks; they do not claim browser coverage, EOF bodies or #32 overflow repair. No separate live sibling connection is created by the new fixture; existing unrelated HTTP regressions remain separate evidence. Source frozen for independent acceptance/coverage review; no full suite or timing experiment run. Exact proposed title: `fix: 지원하지 않는 본문 인코딩의 원본 바이트 보존`.

## Independent test-only live sibling correction

- [x] Add missing overlap contract. Status: review_cert_conflict changed only the dedicated encoding test and this ledger. Two additional CL/chunked cases reuse nested existing real duplex fixtures; original26cases remain. Observe opaque EUC-KR/zstd response's actual first byte and incomplete Node response, then complete a separate normal rewritten sibling and its second exchange while opaque input remains held. Assert opaque still incomplete with exactly its prefix after sibling completion, then release remaining owned bytes and verify exact raw framing/body, Node end/complete and original headers.
- [x] Selected verification. Status:f1ff43 naturalexit0,2PASS26filtered0.712seconds. This is coverage strengthening of unchanged production, not new production RED; no failing behavior was found.
- [x] Related verification. Status:ffbb9e naturalexit0,4suites43PASS1.821seconds (encoding, host-header, duplicate-host, existing rewrite unit). No EOF/remote endpoint or fixture duplication. Bounded conditions surface request/response/abort failures; no sleep establishes success.
- [x] Independent re-reviews. Status: review_wave0 and fix_lint_diagnostics final M1 rereviews PASS, zero findings; existing exact title PASS. Root commit/integration pending.

Before/after SHA256 (f1ff43/ffbb9e) identical: HttpHandler68C26EFA071B398E6EB90A1AABB0413B8799CA60232BDC554B2584014DC9CCD2; HttpUtil320B38ECFAA94A08579325C43CE54AEC8E58A0FAA16B97FD54FC904CE90E2C35. No source changed by this fixer. Selected command: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/component/http-body-encoding.test.ts --testNamePattern='live finite sibling'`. Related command adds test/component/http-host-header.test.ts, test/component/http-duplicate-host.test.ts and test/unit/server/http/HttpHandler.rewrite.test.ts without a name filter.

## Final live-sibling rereview receipts

Root confirmed review_wave0 and fix_lint_diagnostics final independent M1 rereviews PASS with zero Critical/High/Medium/Low findings and existing exact-title PASS. Neither reviewer executed additional tests for this final rereview. Original initial26PASS/first review and the subsequently requested M1 coverage remain separate history.
review_wave0 verified actual partial opaque input and incomplete response bracket the independent sibling rewrite/end/complete and next exchange; subsequent suffix release preserves exact opaque bytes/framing and completes normally. Error/abort conditions surface; production blobs match the prior reviewed source. Selected2PASS and related43PASS remain the separate fixer executions above, not a new production RED. Source/test files were not changed by this ledger update; root commit/integration remain pending.
