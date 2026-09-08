# Issue #43 — Public format lint alignment

Status: follow-up complete; source 369952c -> main 74eb213efaa96bea57a0a38457d70e706d8315e6 pushed and remote verified; root integration four suites/32 tests PASS, 1.106 seconds, natural exit 0; GitHub #43 follow-up comment 5579301164 posted.
Scope: two public format comparison comments in DataStatePacket.ts and this ledger only. Scanner rules, credentials and runtime behavior remain unchanged. Existing process #59 dirty work and denied temporary directories remain untouched.

- [x] Read root assignment/main plan and existing allow-comment mechanism. Status: `scanFile` skips a line bearing `lint-auth-compare-allow`; only the two public enum-like discriminator comparisons qualify.
- [x] Observe actual strict scanner RED. Status:84761a exit1,65files/two violations, before comments.
- [x] Add two explanations and run strict clean/credential control/parser regression. Status: source0violations exit0, credential control1violation exit1,29parser tests PASS naturally.
- [x] Two independent reviews. Status: review_wave0 and review_cert_conflict final code/content/title PASS, zero Critical/High/Medium/Low findings. Root commit/integration pending.

This is a test/lint alignment follow-up to #43, not a new issue or completion/Telegram increment. Root reports review_wave0 independently classified the two public `format`/`token` comparisons as false positives. It does not classify #59's historical abnormal process exit.

Owned evidence root: `C:/Users/beom/AppData/Local/Temp/tttgate-public-format-58d4003d73d04528a5a1b59fcb619720`. It was newly created for this follow-up and remains preserved, including RED/green/credential reports. No prior temporary root was deleted or used.

RED: `node scripts/lint-auth-compare.mjs src --strict --report-dir <owned-root>`; receipt84761a exit1,65files/two violations on DataStatePacket.ts65/72, both comparing public format to literal token. Only after this result, the two comparison lines received the existing allow marker and explicit public-discriminator/non-credential explanation.

GREEN: same source command with `<owned-root>/green`; ddb6c6 exit0,65files/zero violations. Control: actual newly written `<owned-root>/credential.ts` contains `authKey === expected`; scanner called with that absolute target and `<owned-root>/credential-report` returned12ce96 exit1,one scanned file/one violation. This expected rejection proves the scanner still identifies the credential fixture; no scanner rule or credential comparison was changed.

Parser regression: `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/commons/data-state-framing.test.ts test/unit/commons/DataStatePacket.test.ts test/util/r2-req-02-buffer-endian.test.ts`;0fa0b6 natural exit0,three suites/29tests PASS,3.234seconds. Runtime statements/producer bytes are unchanged.

Proposed title: `test: 공개 데이터 형식 비교의 린트 예외 근거 명시`. Two scoped files are frozen; review and root integration are pending. Do not count this as another #43 closure or Telegram delivery.

## Independent reviewer receipt

review_wave0 compared the original public-format semantics, two-line comment diff,
existing scanner allow-marker contract and this ledger. Result: PASS, zero
Critical/High/Medium/Low findings; exact title PASS. Both annotations apply only
to public discriminator comparisons; scanner rules, actual credential comparisons,
runtime statements and producer bytes are unchanged.

Without executing another scan or test, the reviewer directly read the preserved
reports: strict source 65 files/two violations before, 65 files/zero after, and
the actual authKey === expected fixture one file/one strict violation. The existing
three-suite/29-test PASS receipt was reviewed, not independently rerun. Both
reviews are complete; root integration remains pending. Root coordinates independent
confirmation of this reviewer-authored record; source comments remain frozen.

Root relayed review_cert_conflict's second independent code/content/exact-title
PASS with zero Critical/High/Medium/Low findings. No additional execution was
performed by that reviewer. Root owns subsequent commit and integration.

## Operational completion

- [x] Root integration/push and existing-issue follow-up. Status: source 369952c -> main 74eb213efaa96bea57a0a38457d70e706d8315e6 pushed and remote verified; root integration four suites/32 tests PASS, 1.106 seconds, natural exit 0; GitHub #43 follow-up comment 5579301164 posted.
Root supplied these operational receipts. Earlier commit/integration-pending statements describe completed handoffs. Original #43 closure, Telegram receipt and epic count 40/66 are unchanged. This supplement creates no new issue completion or notification. #59 final verification follows its separate supplement uptake; its initial failure is preserved.
