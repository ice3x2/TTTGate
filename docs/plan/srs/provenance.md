# Original SRS reference provenance

Status: immutable import byte/provenance reviewed PASS by two independent reviewers and committed/pushed as bb500d05800639bedaa2d813ffc9d16abad239e7 (root89b90c). Checkout-byte preservation correction now awaits independent review; semantic traceability mapping remains unexecuted.

- [x] Locate and independently review original reference inventory. Status: original366 records/366 unique IDs reviewed; all occur in final Markdown.
- [x] Copy approved source bytes into durable integration paths. Status: new byte copies created without altering original workspace; hashes below were checked before copying. Existing differing targets would be preserved rather than overwritten.
- [x] Independently verify imported bytes and provenance. Status: root confirmed two independent byte/provenance reviews PASS; both source hashes preserved.
- [x] Commit immutable references after review. Status: root committed/pushed bb500d05800639bedaa2d813ffc9d16abad239e7, verified89b90c.
- [ ] Build/review all366 semantic trace rows. Status: not assigned or executed by this import.

| Imported path | Original absolute path | SHA256 |
| --- | --- | --- |
| TTTGate.md | C:/Work/git/_Snoworca/TTTGate/docs/plan/srs/TTTGate.md |651898fa44ac7c3e037c4cc3706837062105871c7b8f41f92c66f728842b149d|
| TTTGate.items.jsonl | C:/Work/git/_Snoworca/TTTGate/docs/plan/srs/.TTTGate-work/srs_items.jsonl |364071a1f67e07501e7277e15ebdac057eb17ae8e6c2e076a3a550d916625657|

The original Markdown declares version1.0, date2026-04-24, branch refactor/admin,
366 requirements/items and97 source files analyzed. Its original producing Git
commit is unknown; the branch/date are document assertions, not a verified commit
attribution. No historical generation artifacts beyond the two approved references
were imported. The .TTTGate-work directory was not moved or rewritten.

Current #58 research found68 files under integration src, unlike the historical97
analyzed-file declaration. Those counts concern different snapshots/possibly
different source boundaries; they do not justify removing requirements or asserting
29 files disappeared. Preserve the complete original366 inventory, including
contextual items. New epic requirements and later implementation evidence remain
separate from the immutable source snapshot.

The copies preserve exact bytes, including original line endings and metadata.
Do not normalize or edit them to fit current code. Any future source revision needs
an explicitly versioned reference and reviewed provenance. This import establishes
a portable reference only, not verified implementation, test coverage or completed
trace links. Original workspace files remain unchanged.

- [ ] Independently review checkout-byte preservation. Status: actual fresh Git core.autocrlf=true checkout initially changed both hashes; exact-path -text attributes restored both original hashes in new owned output. Details and RED/GREEN receipts in research58; no original/imported source bytes changed. Attribute correction commit remains root-owned/pending.