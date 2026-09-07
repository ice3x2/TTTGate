# Epic #61 execution plan

Status: active; 2026-09-08; baseline `376b65c`; 58 tracked issues, five completed. Original child range: 5 through 60, plus discovered build issue 62 and user-directed Node 24 migration 63; unrelated issue 2 is excluded.

## Scope and decisions

Resolve every child of #61, plus defects discovered during this work. Preserve existing CLI, configuration, authentication, TLS and tunnel compatibility unless a documented decision requires change. Reference `docs/research/2026-09-05-tttgate-full-inspection.md`, `docs/plan/00-2.tech-decisions.md`, and existing phase plans. Previous session decision-file location has been requested; no new product policy is inferred from the unrelated RBAC roadmap.

Original workspace `../TTTGate` on `refactor/admin` contains pre-existing uncommitted admin upgrades and reports. Preserve those changes. Integration workspace: `../TTTGate-epic61`, branch `fix/epic-61`. Issue lanes are sibling worktrees forked from the latest reviewed integration commit. Changes are integrated serially; never share a writable lane.

Accepted current user decision: minimum Node.js version becomes `>=24.0.0` (24 LTS), replacing the earlier Node 18 baseline. ADR-011 and `verification/epic61-node24-decision.md` define #63. No further Node-major policy decision is pending. Preserve historical #14/#62/#15 evidence and notification denominators as sent; all subsequent notifications use total 58.

## Execution order and ownership

Each issue below appears once and is its own resumable checklist item. Items inside a lane run serially. Lanes in the same wave may run in parallel, up to three workers including reviewers; the orchestrator occupies the fourth slot. A completed wave means reviewed changes have been integrated and checked before the next wave starts, except the explicitly bounded early #9 lane below. Wave 0 remains the mandatory global barrier. Release gates run after both Wave 1 lanes and #63.

File ownership is exclusive during a wave, including test files. Serial cherry-picking alone does not make overlapping implementations safe. Before assignment, record the actual branch, worktree and writable paths in the issue evidence file. If a fix needs another active lane's file, defer that change until the owner is integrated, update this plan and rebase the waiting lane. Do not independently edit shared files and defer resolving their semantics until merge.

### Wave 0 — mandatory regression barrier

Status: complete; #14, #62 and #15 passed review, integration, push, closure and notification gates. Worktrees: `../TTTGate-epic61-ci` and `../TTTGate-epic61-supply`. CI owns the new code-test workflow, contract tests and root package manifests; supply owns supply-chain tests/helpers. Existing shared workflow changes have one owner and are integrated before the dependent lane resumes. No later-wave implementation starts until all three items pass independent review and integration checks.

- [x] #14 CI execution. Status: complete; commit `1df351f` pushed, issue closed, Telegram receipt 3893 (57/1).
- [x] #62 clean-install TypeScript build compatibility. Status: complete; commit `a35f53c` pushed, issue closed, Telegram receipt 3894 (57/2). Evidence: `verification/epic61-issue-62.md`.
- [x] #15 fail-closed supply-chain checks. Status: complete; commit `654a065` pushed, issue closed, Telegram receipt 3896 (57/3).

### Wave 1 — administrator deployment blockers

Status: assigned after Wave 0 completion. Lane A agent `fix_ci14`, worktree `../TTTGate-epic61-admin`, branch `fix/epic61-admin`, base `654a065`, owns `admin/`, root package manifests, code regression CI, `test/admin/` and bootstrap routing in `AdminServer.ts`. Inspect original dirty admin changes as input, but reproduce failures before adopting implementation. Lane B agent `fix_supply15`, worktree `../TTTGate-epic61-release`, branch `fix/epic61-release`, base `654a065`, owns `package-build.json`, release manifest generation and the release-manifest supply test; it does not change admin package files concurrently.

Lane A, serial:

- [x] #50 admin test runner. Status: complete; commit `d8cb6a7` pushed, issue closed, Telegram receipt 3898 (58/5).
- [ ] #5 SPA mount. Status: pending #50, #17 and serial #63 integration.
- [ ] #6 certificate lifecycle. Status: pending previous lane item.
- [ ] #7 CSRF integration. Status: pending previous lane item.
- [ ] #8 bootstrap UI and request. Status: pending previous lane item.
- [ ] #51 empty-key routing. Status: pending previous lane item.

Lane B, parallel with A:

- [x] #17 release manifest. Status: complete; commit `5cd4df0` pushed, issue closed, Telegram receipt 3897 (58/4).

Serial interlude after #50 and #17 integration, before Lane A continues with #5:

- [ ] #63 Node 24 minimum/runtime migration. Status: assigned to `fix_supply15` in `../TTTGate-epic61-node24`, branch `fix/epic61-node24`, base `d8cb6a7`; exclusive ownership of root/admin/distribution manifests, lockfiles, Node declarations, workflows and binary packaging. #50 may select Node 24 for its new CI harness; all remaining migration belongs here. Packaging research may run concurrently without edits. Rebase the admin lane onto reviewed #63 before continuing; #44 must verify actual Node 24 artifacts and supported platforms.

Wave completion gate, after A and B integration:

- [ ] #44 release type-check/test/install gates. Status: pending both Wave 1 lanes; exclusive release and package ownership.

### Wave 2 — termination and listener foundations

Status: pending Wave 1 except the bounded #9 early lane. Lane A exclusively owns `SocketHandler.ts`, `TCPServer.ts`, `CtrlPacket.ts`, `TunnelServer.ts`, `TunnelClient.ts`, `ClientHandlerPool.ts`, `ExternalPortServerPool.ts`, and HTTP cleanup changes. These cannot be divided into simultaneous protocol/listener writers. Lane B owns `Sentinel.ts`, `LogWriter.ts` and logging composition only. Lane C owns admin/config/certificate files and their tests; changes to external listeners or common transport are deferred to Wave 4.

Early #9 lane: after completed Wave 0, #9 may execute concurrently with #63. Actual issue scope is command payload validation in `src/commons/CtrlPacket.ts`, getter bounds and dedicated packet/consumer regression tests. These do not depend on administrator fixes or Node packaging. Exclusive writable paths are `src/commons/CtrlPacket.ts`, `test/unit/commons/CtrlPacket.test.ts`, dedicated #9 files under `test/commons/` and `test/component/`, and its issue ledger. Existing consumer/runtime files may be read; any required edits outside this set must be surfaced and ownership/schedule amended before writing. The #9 worker must not edit root/admin manifests, lockfiles, workflows, README, packaging scripts or shared test helpers owned by #63/admin. No other Wave 2 issue starts early. Integrate serially and rerun packet/consumer regression on the integrated Node 24 baseline. The orchestrator records the assigned worktree/branch before dispatch. This is a dependency-based parallel exception, not a relaxation of TDD or review gates.

Lane A, serial:

- [ ] #9 control payload boundary. Status: eligible for bounded early assignment in parallel with #63; Wave 0 complete, exclusive paths above.
- [ ] #28 large byte counts. Status: pending previous lane item.
- [ ] #10 inactive listener. Status: pending previous lane item.
- [ ] #39 TCPServer restart. Status: pending previous lane item.
- [ ] #26 control-handler cleanup. Status: pending previous lane item.
- [ ] #27 HTTP-handler cleanup. Status: pending previous lane item.

Lane B, parallel with A/C:

- [ ] #16 Sentinel self-termination. Status: pending Wave 1.
- [ ] #21 log retention. Status: pending previous lane item.

Lane C, parallel with A/B:

- [ ] #13 login limiter. Status: pending Wave 1.
- [ ] #34 optimistic concurrency. Status: pending previous lane item.
- [ ] #35 runtime rollback. Status: pending previous lane item; if transport changes are required, wait for Lane A integration before writing those files.
- [ ] #36 certificate path validation. Status: pending previous lane item.
- [ ] #38 unmatched methods. Status: pending previous lane item.

### Wave 3 — framing, lifecycle and HTTP

Status: pending Wave 2. Lane A exclusively owns shared transport, control/data packets, client/server lifecycle and pool files. Lane B owns `src/server/http/` and HTTP-specific unit/security tests. HTTP may consume transport APIs but must defer shared transport edits until A is integrated. Preserve explicit protocol negotiation and prohibit silent downgrade.

Lane A, serial:

- [ ] #41 v1 ID reuse. Status: pending Wave 2.
- [ ] #43 framed data handshake. Status: pending previous lane item.
- [ ] #42 trailing bytes. Status: pending previous lane item.
- [ ] #45 malformed frames. Status: pending previous lane item.
- [ ] #46 malformed metadata. Status: pending previous lane item.
- [ ] #18 idle-session lifetime. Status: pending previous lane item.
- [ ] #23 keepalive. Status: pending previous lane item.
- [ ] #24 data-handler teardown. Status: pending previous lane item.
- [ ] #25 stale callbacks. Status: pending previous lane item.

Lane B, parallel with A:

- [ ] #11 independent HTTP directions. Status: pending Wave 2.
- [ ] #12 chunk terminator. Status: pending previous lane item.
- [ ] #29 EOF body. Status: pending previous lane item.
- [ ] #30 binary/charset preservation. Status: pending previous lane item.
- [ ] #31 Host replacement. Status: pending previous lane item.
- [ ] #32 rewrite limit. Status: pending previous lane item.
- [ ] #33 duplicate Host. Status: pending previous lane item.
- [ ] #56 positive rewrite assertions. Status: pending previous lane item.

### Wave 4 — resource/configuration consistency and test artifacts

Status: pending Wave 3. Lane A serially owns `FileCache.ts`, `SocketHandler.ts`, `TCPServer.ts`, socket logging, `ServerOptionStore.ts`, `AdminServer.ts`, and `ExternalPortServerPool.ts`; combining these changes avoids cache/logging/lifecycle and normalization/backpressure writer conflicts. Lane B owns lint and artifact cleanup tests, including the existing pool-swap E2E test; it does not alter shared harness or runtime code concurrently.

Lane A, serial:

- [ ] #19 cache read failures. Status: pending Wave 3.
- [ ] #20 cache block identity. Status: pending previous lane item.
- [ ] #22 socket log sink. Status: pending previous lane item.
- [ ] #37 normalized hot apply. Status: pending previous lane item.
- [ ] #40 buffer lower bound. Status: pending previous lane item.

Lane B, parallel with A:

- [ ] #59 stable lint test. Status: pending Wave 3.
- [ ] #60 clean test artifacts. Status: pending previous lane item.

### Wave 5 — real roundtrip verification

Status: pending Wave 4. Lane A owns the shared tunnel harness and E2E/stress tests. Lane B owns the TLS rejection component test only. Lane C owns mock-policy reconciliation, keepalive/rewrite unit tests and Jest policy text; it defers any shared harness/runtime change until Lane A integration. Broader coverage configuration waits until Wave 6.

Lane A, serial:

- [ ] #48 retry-free roundtrip. Status: pending Wave 4.
- [ ] #54 multiple clients. Status: pending previous lane item.
- [ ] #47 HTTP/TLS E2E. Status: pending previous lane item.
- [ ] #53 large transfer/cache spill. Status: pending previous lane item.

Lane B, parallel with A/C:

- [ ] #57 strict TLS rejection. Status: pending Wave 4.

Lane C, parallel with A/B:

- [ ] #55 truthful mock policy. Status: pending Wave 4.

### Wave 6 — complete evidence and release audit

Status: pending Wave 5; one serial integration lane owns package scripts, final coverage configuration and requirement traceability.

- [ ] #49 remove forced exit and prove process shutdown. Status: pending Wave 5.
- [ ] #52 whole-source coverage gate. Status: pending previous lane item; lines >=64.26%, branches >=52.23%, without narrowing measured source scope.
- [ ] #58 all 366 requirement links. Status: pending previous lane item; preserve truthful uncovered/partial classifications rather than inventing links.
- [ ] Final: full backend/admin checks, E2E HTTP/TLS/multi-client/large transfer, whole-source coverage, independent requirement-by-requirement review, remote commit verification, close all children and epic. Status: pending all issues and notification receipts.

## Per-issue gates

1. Read issue, decisions, existing code and reuse opportunities.
2. Write failing regression first; record exact command and red result before implementation. If implementation accidentally precedes tests, remove that implementation and restart test-first.
3. Implement minimum fix in assigned worktree; record green and appropriate regression evidence.
4. Independent reviewer checks original requirements and diff. A different fixer handles findings, followed by independent re-review until no material findings remain. Record findings by critical/high/medium/low.
5. Review commit content/message independently, commit without signature or progress markers, integrate serially, run integration checks, push without force, verify remote hash, then close issue with evidence.
6. Send Telegram after each closed issue: `TDD Gate {issue number} {issue title} ({total issue count}/{completed issue count})`. Current total 58 (original 56 plus build issue #62 and user-directed Node 24 migration #63); add newly discovered in-scope issues explicitly. Persist delivery result to prevent duplicate reporting.

## Issue completion ledger

Five of 58 issues completed: #14, #62, #15, #17 and #50. Independent Wave 0 review evidence: `docs/plan/verification/epic61-wave0-review.md`. Each checklist item is completed only after all per-issue gates. Store its ledger in `docs/plan/verification/epic61-issue-N.md`, where N is the issue number. Required fields: original title/requirements, assigned agent/worktree/branch/writable paths, current status and next command, reuse findings, red command/result before implementation, green/regression commands/results, review findings and independent reviewer/fixer identity, integration commit, pushed remote hash, GitHub closure evidence, Telegram title/delivery receipt. Allowed states: pending, assigned, red, implementing, reviewing, integrating, pushed, closed, notified, complete, blocked. Update the checklist status when any state changes. Newly discovered defects receive their own issue, schedule item and ledger; update total count before subsequent notifications.

Plan review evidence: `docs/plan/verification/epic61-plan-review.md`. A different reviewer must rereview this amended plan before treating its findings as resolved.

## Resume

Inspect live Git/worktree/GitHub state and live agent handles before relying on this document; do not restart work based only on an expired observation or stale status. Current next action: execute assigned serial #63 in the Node 24 worktree; #50 and #17 are complete, #5 waits for #63 integration. Wave 0 combined build passed; full regression completed with 68 suites/306 tests passed and four online tests skipped (157.635 seconds). Remote HEAD observed after #50 completion is `d8cb6a73cdf8a359946465f816e2cfc48c9be5cd`. All original dirty files remain in the original workspace. After Wave 0, create each new lane from the latest reviewed integration commit and record its path in the ledger before assignment. Recheck current user-decision evidence before any policy-sensitive implementation.
