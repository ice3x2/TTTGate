# Issue #58 — Full original SRS traceability research

Status: original inventory independently reviewed and root-authorized immutable source import prepared at docs/plan/srs; imported bytes/provenance await independent review and commit. Semantic trace artifact/mapping remains unassigned. No tests, specification edits, deletion or source changes executed. #52 research remains frozen.
Original issue: https://github.com/ice3x2/TTTGate/issues/58.

- [x] Locate original366-item source rather than substituting remediation REQ IDs. Status: initially found in the original workspace and absent from the integration checkout; the later approved import is recorded below.
- [x] Count original sidecar IDs and inspect Markdown correspondence. Status:366 records/366 unique IDs, every sidecar ID occurs in the final Markdown; no duplicate sidecar ID.
- [x] Distinguish lexical mapping candidates from verified acceptance evidence. Status: artifact proposal below.
- [x] Confirm original-source inventory and approve immutable reference import. Status: independent review PASS/root approved two exact-byte files; originals untouched.
- [ ] Independently review imported references/provenance and commit. Status: copies prepared at docs/plan/srs/TTTGate.md and TTTGate.items.jsonl with provenance.md; no commit yet.
- [ ] Build all366 trace rows and independent semantic review. Status: not executed; no IDs dropped or marked obsolete by this research.
- [ ] Close trace gate after required actual verification and explicit uncovered dispositions. Status: pending #47/#49/#52/#53 and other applicable work.

## Original source inventory

At the initial inventory checkpoint, the issue's docs/plan/srs directory did not exist in the integration checkout.
It does exist at C:/Work/git/_Snoworca/TTTGate/docs/plan/srs/TTTGate.md in the
original workspace. That document identifies version1.0, date2026-04-24, branch
refactor/admin, total366 items and97 analyzed source files. Its SHA256 at inspection:
651898fa44ac7c3e037c4cc3706837062105871c7b8f41f92c66f728842b149d.
Associated original .TTTGate-work/srs_items.jsonl supplies the structured inventory;
it contains366 unique records and all IDs occur in the final Markdown.

| Sidecar type | Count |
| --- | --- |
| functional_req |59|
| nonfunctional_req |45|
| business_rule |40|
| constraint |36|
| interface |36|
| data_model |32|
| api_contract |28|
| use_case |26|
| glossary |21|
| verification |13|
| system_mode |10|
| actor |7|
| assumption |7|
| out_of_scope |6|

The366 inventory includes contextual/non-executable items as well as behavior;
retain all of them. A glossary/actor/out-of-scope item may need an explicit
document-review applicability rationale, not a fabricated executable test or
silent deletion. Mixed heading depths matter:198 IDs use level4 headings and
many FR/NFR/interface/API items use level5; a single-heading regex undercounts.
No record is presumed deprecated because current code differs from this snapshot.

Tracked docs/srs/backend-remediation-round1.md, round2.md and round3.md use a
different REQ-NN namespace. Lexical distinct REQ counts in those documents are
24/7/6 respectively; these counts include references, not independently parsed
requirement definitions. REQ-01 and other bare IDs recur across rounds and test
comments. Keys must include source document/version/scope, never join on REQ-NN
alone. Original SRS IDs such as FR/BR/CONSTR remain separate from round-scoped REQ
aliases and GitHub issue numbers.

Before implementation, root must approve how the original untracked/local source
becomes a durable reference in integration: preferably an unchanged hashed copy
of final Markdown and the inventory, with recorded provenance and no automatic
import of the whole hidden generation workspace. Do not overwrite or relocate the
original files. A machine-local absolute link alone is insufficient for future
reviewers after checkout; final trace artifacts must reference a durable source.

## Recommended trace artifacts

Use one machine-readable JSON matrix plus a generated Markdown view. One canonical
row per original scoped ID, with many-to-many test links; keep supplemental new
epic requirements in a separate namespace/list rather than changing the366 baseline.
Recommended fields:

- requirement key: source document/version/hash, original ID, category, exact anchor;
- verbatim acceptance or precise linked acceptance, applicable modes and conditions;
- implementation claim: paths/symbols and supported behavior, independent of tests;
- candidate links: round/document-qualified REQ aliases and GitHub issues, rationale;
- verification links: exact test path and describe/test title or parameter cases,
  command/selection, assertion-to-acceptance explanation and evidence technique;
- executed evidence: commit/tree, environment, actual result/exit/count/date and
  immutable receipt/report location; omitted/filtered/skipped cases explicit;
- state: candidate/unverified, partial, verified, uncovered, or non-executable
  document-reviewed with rationale and independent reviewer;
- gap/disposition: unmet clause, remaining issue, owner and required next gate.

Test filenames, REQ comments, imports, coverage hits and successful build are only
candidate associations. Review actual assertions and stimuli to connect each
acceptance clause. A mocked argument assertion cannot prove real TLS/transport
delivery; apply the current test-evidence policy. One test may support many rows
only with distinct defensible clause mappings. A large suite PASS does not prove
an individual requirement whose relevant case was skipped or never asserted.

## Exact completeness and final gate

Freeze the original366 ID set/hash before generating the matrix. Validate exactly
366 canonical rows, no missing or extra original IDs, no duplicate scoped keys,
valid source anchors and existing test links. Separately validate round-qualified
alias ambiguity rather than arbitrarily selecting one matching REQ comment.
Do not equate all-row presence with all requirements verified.

Review every row semantically with an independent verifier, prioritizing original
acceptance over implementation description. Record uncovered/partial honestly;
do not waive requirements, lower criteria or remove scope to achieve a green matrix.
For non-executable contextual items, document why executable testing is inapplicable
and what independent review supports them. Root must approve material interpretation
disputes before any specification change; this research approves none.

#47 full HTTP/TLS E2E, #49 actual ordinary/coverage natural shutdown, #52 whole-source
thresholds and #53 large-transfer/cache effects remain unverified until their exact
gates pass. Current component evidence may support partial clauses but cannot
substitute for those pending end-to-end obligations. Preserve #28/#40 decisions
and #29 held dependencies. Final #58 closure requires complete trace links and
truthful verification status across all366, with remaining unmet requirements
explicitly routed; it must not claim every item passed merely because links exist.

No original specification, test/helper, production source or historical receipt
was modified. No scanner, benchmark, installation, cleanup or process termination
was run. At that initial research checkpoint, the only new file was this research. The later approved reference import remains separately recorded below; independent review is required.

## Immutable checkout-byte preservation correction

- [x] Import commit/provenance status. Status: root confirmed bb500d05800639bedaa2d813ffc9d16abad239e7 pushed89b90c after two independent byte reviews. Semantic366 mapping remains unexecuted; this does not complete58.
- [x] Actual Git conversion RED before attributes. Status: dfe6e0 created a fresh no-checkout/no-hardlinks clone under C:/Users/beom/AppData/Local/Temp/tttgate58-checkout-4de816b778434f4d8221751560f3df54/repo; local core.autocrlf=true then actual checkout of HEAD attributes and the two SRS files. Both source hashes changed: Markdown FAA68344E6B4683A551E9D86F973F7BBE0BD0D9ACFEDC90449610C236ECF25F3, sidecar E6663B327B2FB3667CCBA822E8EA0C84AC9E9DA8229FE6554AA5083BADEB1227. Explicit same-byte contract c15dbe exited1, red.json preserved. This is Git checkout byte-stability RED, not a test/benchmark/product-runtime result.
- [x] Minimum attributes and GREEN. Status: add only exact docs/plan/srs/TTTGate.md -text and docs/plan/srs/TTTGate.items.jsonl -text, reusing existing64 raw-evidence pattern. Copy candidate attributes into that owned clone and export the same indexed source objects with actual git checkout-index into a NEW green output directory, retaining core.autocrlf=true. f10438 exit0/check-attr text:unset; both SHA match the original651898...49d and364071...657 exactly. green.json and red checkout remain preserved side by side.
- [ ] Independent review/root commit. Status: only .gitattributes, provenance.md and this research changed; imported Markdown/JSONL and original workspace files were never edited/moved/deleted. No commit by author, no npm/test/coverage/benchmark or process termination. Temporary clone/evidence retained for reviewers.

Exact byte evidence directory: C:/Users/beom/AppData/Local/Temp/tttgate58-checkout-4de816b778434f4d8221751560f3df54. RED git checkout HEAD used original attributes; GREEN git checkout-index --prefix=<new-green-dir>/ used candidate exact-path attributes against identical HEADbb500d0 blobs. The two commands exercise actual Git worktree conversion, not a text-copy simulation. No repository-wide EOL rule or source-content normalization was introduced.