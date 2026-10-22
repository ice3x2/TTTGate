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
## Proposed exact implementation artifacts and bounded semantic stages

Status: design proposal only; original366 references remain immutable. No validator,
trace matrix, test comment or test implementation was written/executed here.

Minimal artifact paths proposed for root freeze:

- docs/plan/traceability/original-srs-matrix.json: canonical366-row machine-readable matrix.
- docs/plan/traceability/original-srs-matrix.md: generated browsing view, explicitly showing unverified/gaps.
- test/srs-trace-index.json: test-side bridge, keyed by test path plus exact case title/parameter identity, linking to original scoped SRS IDs and any document-qualified legacy REQ aliases. This addresses the test-to-SRS direction without mass editing existing test comments before semantic review.
- scripts/validate-srs-trace.mjs: one read-only validator with optional explicit --write-view mode for deterministic Markdown/bridge rendering; default validation must not change files. Reuse one parsed model for checks/rendering rather than separate parsers.
- test/unit/tools/srs-trace-validator.test.ts: meaningful structural-contract RED/negative fixtures built under a new owned temporary root; original imported files never mutated. Dedicated ledger58 records structure and semantic batches separately.

The canonical matrix stores source manifest `{path, sidecarPath, documentVersion,
markdownSha256, sidecarSha256}` with the two approved original hashes. Every row:

```text
key: {sourceHash, originalId}             # document scoped; no bare REQ join
category: exact sidecar type
source: {markdownPath, headingLine, exactHeading, sidecarId}
acceptance: {descriptionRef: original sidecar ID, clauses: optional reviewed splits}
applicability: {kind: runtime | document | unresolved, modes, rationale}
implementation: {state: unverified | located | partial, links: [{path,symbol,rationale}]}
legacyAliases: [{documentPath, documentVersionOrHash, scope, id, rationale}]
verification: [{testPath, exactTitle, parameters, assertedClauseRefs,
                technique, rationale, state: candidate | verified,
                evidence: [{commitOrTreeHash, command, selection, resultPath,
                            resultHash, outcome, observedAt, skippedOrFiltered}]}]
review: {state: unreviewed | reviewed, reviewer, decision, rationale}
status: unverified | candidate | partial | verified | uncovered | document-reviewed
gaps: [{clauseRef, explanation, issueOrOwner, nextGate}]
```

Use exact heading text plus1-based line as the source anchor; validator must check
that immutable Markdown line contains this exact original ID as a full token, at
its actual heading depth, and that descriptionRef exists in sidecar. Generate source
links with original file/heading context and line information; do not invent new
anchors by editing imported Markdown. Sidecar source-code references are historical
metadata, not proof current implementation still matches. Do not copy them directly
into implementation located/verified status without checking current symbols.

Matrix is canonical; test/srs-trace-index.json and Markdown are deterministic views
of its links, carrying the same candidate/verified state. Validate exact reverse
consistency so a test-side index cannot claim a verified link absent from the row.
An existing test REQ comment maps through `{sourceDocument, scope, id}`, not REQ-01
alone. Case title must identify the actual describe/test hierarchy; parameterized
cases store their parameter identity rather than pretending one textual template
proves every row. Structural title existence can use parsed declarations/explicit
manifest, but dynamic titles that cannot be resolved without execution are marked
unresolved and cannot become verified from grep. No new test execution is implied.

Only after independent semantic review may a small existing test comment add a
reference to original ID or the bridge. Such edits are optional when the explicit
test-side bridge already makes the mapping discoverable; do not mass relabel tests,
rewrite legacy REQ comments or make original-SRS-looking labels imply acceptance.
Root decides any expanded test-comment write set before those files are touched.

### Genuine structural TDD

- [ ] Freeze validator CLI/schema before code. Status: proposal `node scripts/validate-srs-trace.mjs --matrix <path> --source-root <root>` returns0 only when structure is valid,1 with bounded path/ID diagnostics otherwise; --write-view is explicit. No network/runtime imports or coverage execution.
- [ ] Observe structural RED. Status: before validator implementation, contracts require complete366 unique scoped IDs from immutable source, valid hashes/headings/types, real test paths/titles, reverse bridge/view agreement and no verified row without required reviewed evidence metadata. A minimal valid generated fixture then deliberate missing ID, duplicate ID, changed source hash, wrong heading/type, nonexistent test, ambiguous legacy alias and false verified state must fail. Missing-module/setup errors alone are not accepted behavioral RED; preserve that distinction.
- [ ] Minimum validator and GREEN. Status: ensure each corruption is rejected and valid structure accepted; check deterministic outputs without importing app entrypoints. Structural PASS explicitly says nothing about semantic clause satisfaction or actual runtime evidence authenticity.

Evidence file/hash existence is checkable, but a JSON result saying PASS may not be
honest or relevant. The validator must never manufacture reviewer IDs, timestamps,
actual executions or requirement coverage. Semantic verification remains human/
independent-agent judgment against stimuli/assertions and actual immutable receipts.

### Bounded stages and review workload

1. Bootstrap all366 rows mechanically from original IDs/types/heading anchors with
   status unverified, applicability unresolved, no invented implementation/test links.
   Preserve contextual categories and expose empty links/gaps visibly. Import metadata
   and structure are independently reviewed before semantic assignment.
2. Generate lexical candidates only into candidate fields; no automatic verified
   upgrade from filename/comment/coverage hit. Freeze batches of at most25 original
   IDs, grouped by category/subsystem; keep a batch manifest listing every ID and
   reviewer status so no row disappears between iterations.
3. For each batch, independently inspect original acceptance, current implementation,
   actual test statements and receipts; promote only justified clauses. Actor/glossary/
   out-of-scope items may be document-reviewed with applicability rationale and reviewer,
   not given dummy runtime tests. Do not treat every contextual category as automatically
   non-runtime: decide per item and preserve any behavior-bearing clause.
4. Record unmet clauses as explicit gaps/partial/uncovered with next gate/owner/issue;
   mapping inventory completion and runtime acceptance completion remain separate.
   Required47/49/52/53 evidence and28/29/40 constraints cannot be waived by trace status.
   A verified item must cite its actual parameter cases and non-skipped execution.
5. Final independent reconciliation checks all366 scoped IDs, source provenance,
   bidirectional test bridge, semantic review completeness and unresolved dispositions.
   Root decides #58 closure against truthful trace completeness; never describe all366
   as implemented/verified while uncovered or policy-blocked rows remain.

This proposal separates initial durable artifacts from sustained semantic work. It
adds no SRS requirement, changes no original source bytes and authorizes no tests,
production implementation, benchmark, full coverage or cleanup operation.