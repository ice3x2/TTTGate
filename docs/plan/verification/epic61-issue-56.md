# Issue #56 — Existing positive HTTP body rewrite evidence

Status: two independent audits PASS; evidence-only resolution prepared. Documentation review/commit/integration/GitHub closure/notification pending. Current epic remains51CLOSED/51notified of66; #56 is not yet counted complete.
Recorder: fix_supply15 in main worktree `C:/Work/git/_Snoworca/TTTGate-epic61`. This records root-confirmed independent results; it is not the research author's self-approval. No source/test change, new test, new RED or test execution by this recorder.

- [x] Map original56 recommendation to existing explicit positive assertions. Status: exact anchors below.
- [x] Independent audits and selected existing-test verification. Status: review_wave0 and fix_lint_diagnostics each C0/H0/M0/L0; separate receipts below.
- [x] Root choose evidence-only resolution. Status: existing integrated tests satisfy original recommendation; optional matrix expansion is not required for this closure.
- [ ] Independently review evidence documents/title and integrate. Status: prepared, no stage/commit authorized.
- [ ] Root GitHub closure and per-issue notification. Status: pending; no external write made.

## Requirement and direct assertion mapping

Original [#56](https://github.com/ice3x2/TTTGate/issues/56) asks for a normal within-limit body test that asserts actual hostname replacement. The older unit `test/unit/server/http/HttpHandler.rewrite.test.ts:100-146` remains a mocked decompression-limit bypass control. Its negative expectation is preserved and is not used as positive evidence.

Integrated `test/component/http-body-encoding.test.ts` already fills the requested gap:

- Line6 supplies `http://internal.example/path` as the real input body. Line38 decodes the actual received body with the selected identity/gzip/deflate/br decoder and requires exact equality with `http://public.example/path`. That full equality also excludes internal.example from this tested body; no substring-only or line-hit inference is needed.
- Lines21-25 collect bytes from an actual Node IncomingMessage and resolve only on `end`; line35 requires `complete === true`. These use owned loopback sockets through the existing fixture; the Host name does not trigger external DNS/socket access.
- Lines57-58 supply four positive single-codec cases (identity, gzip, deflate, br), with actual zlib encoding/decoding and finite input Content-Length. Lines60-61 supply two positive absent-charset/no-coding cases, one Content-Length and one chunked. These are the six selected positive cases.
- Lines45-49 then complete a second request, verify its exact `OK` body and complete=true, empty pending FIFO and upstream still open. The second opaque response is context/lifecycle evidence, not another hostname-rewrite assertion.

## TDD and execution provenance

The four codec positives already passed in #30's baseline run29fa11 (20failed/4passed0.87s). That baseline's failures concerned opaque/charset preservation and the new eligibility helper; they were not failures of positive hostname rewriting. The two absent-coding positives were later coverage additions on working code. Therefore #56 introduces no implementation and claims no newly reproduced positive-path RED. Existing negative/bypass RED, its diagnostic and later GREEN remain recorded separately in ledger30.

Historical #30 source `8f90534` integrated as `1b329daab74c9981479a4875ccbd455c88d57d54`; root recorded eight suites/96tests PASS3.354seconds naturalexit0, forced build PASS and verified push. This is historical integration evidence for the tests, not a new96-test execution for #56.

Root supplied two independent audit verdicts, each C0/H0/M0/L0, against original56, current source/assertions and the research:

1. review_wave0 independently selected the six existing finite positive cases:6PASS/22filtered,0.528seconds,naturalexit0. The selection covers test names `supported ... UTF8 has actual decoded replacement and finite Node completion` and `absent charset and coding retains supported rewrite ...`. This is a selected six-case execution, not all28 encoding tests or a whole-suite run.
2. fix_lint_diagnostics independently reviewed the original requirement and explicit assertions read-only, with no additional test execution. No second runtime receipt is inferred.

The root approved evidence-only resolution after these audits. Recorder fix_supply15 authored the original research/earlier #30 work; both acceptance judgments above are from other agents, as required.

## Limits and pending gates

Compressed chunked-input positives, Korean UTF-8/multiple URL occurrences and a second rewritten Host context remain optional matrix extensions identified in `epic61-issue-56-research.md`. They are broader than the original request for a positive within-limit assertion and are not silently claimed covered. Existing cases use a single ASCII HTTP URL/text/plain. No production fix is proposed from this audit.

Close-delimited/unknown-length body completion remains outside finite evidence and held by #29. No held UI/pool/EOF work, benchmark, denied temporary-path operation, dependency or process operation occurred. #28/#40 decisions remain separate. Proposed exact documentation title: `docs: HTTP 본문 치환 정상 경로 검증 근거 기록`. Root must complete documentation gates and then individually close/notify #56 before changing the completed count.
