# Epic #61 execution plan

Status: active; 2026-09-08; baseline `376b65c`; 62 tracked issues, sixteen completed. Original child range: 5 through 60, plus discovered build issue 62, user-directed Node 24 migration 63, timing verification issue 64 and release archive issue 65, odd-length hex validation issue 66 and development proxy origin issue 67; unrelated issue 2 is excluded.

## Scope and decisions

Resolve every child of #61, plus defects discovered during this work. Preserve existing CLI, configuration, authentication, TLS and tunnel compatibility unless a documented decision requires change. Reference `docs/research/2026-09-05-tttgate-full-inspection.md`, `docs/plan/00-2.tech-decisions.md`, and existing phase plans. Previous session decision-file location has been requested; no new product policy is inferred from the unrelated RBAC roadmap.

Original workspace `../TTTGate` on `refactor/admin` contains pre-existing uncommitted admin upgrades and reports. Preserve those changes. Integration workspace: `../TTTGate-epic61`, branch `fix/epic-61`. Issue lanes are sibling worktrees forked from the latest reviewed integration commit. Changes are integrated serially; never share a writable lane.

Accepted current user decision: minimum Node.js version becomes `>=24.0.0` (24 LTS), replacing the earlier Node 18 baseline. ADR-011 and `verification/epic61-node24-decision.md` define #63. No further Node-major policy decision is pending. Preserve historical #14/#62/#15 evidence and notification denominators as sent; all subsequent notifications use total 62 after discovery of #67.

## Execution order and ownership

Each issue below appears once and is its own resumable checklist item. Items inside a lane run serially. Lanes in the same wave may run in parallel, up to three workers including reviewers; the orchestrator occupies the fourth slot. A completed wave means reviewed changes have been integrated and checked before the next wave starts, except the explicitly bounded early #9, #16/#21, #10/#39 and paired #26/#27 lanes below. Wave 0 remains the mandatory global barrier. Release gates run after both Wave 1 lanes and #63.

File ownership is exclusive during a wave, including test files. Serial cherry-picking alone does not make overlapping implementations safe. Before assignment, record the actual branch, worktree and writable paths in the issue evidence file. If a fix needs another active lane's file, defer that change until the owner is integrated, update this plan and rebase the waiting lane. Do not independently edit shared files and defer resolving their semantics until merge.

### Wave 0 — mandatory regression barrier

Status: complete; #14, #62 and #15 passed review, integration, push, closure and notification gates. Worktrees: `../TTTGate-epic61-ci` and `../TTTGate-epic61-supply`. CI owns the new code-test workflow, contract tests and root package manifests; supply owns supply-chain tests/helpers. Existing shared workflow changes have one owner and are integrated before the dependent lane resumes. No later-wave implementation starts until all three items pass independent review and integration checks.

- [x] #14 CI execution. Status: complete; commit `1df351f` pushed, issue closed, Telegram receipt 3893 (57/1).
- [x] #62 clean-install TypeScript build compatibility. Status: complete; commit `a35f53c` pushed, issue closed, Telegram receipt 3894 (57/2). Evidence: `verification/epic61-issue-62.md`.
- [x] #15 fail-closed supply-chain checks. Status: complete; commit `654a065` pushed, issue closed, Telegram receipt 3896 (57/3).

### Wave 1 — administrator deployment blockers

Status: assigned after Wave 0 completion. Lane A agent `fix_ci14`, worktree `../TTTGate-epic61-ui`, branch `fix/epic61-dev-origin`, base `2b0a426`, owns `admin/`, root package manifests, code regression CI, `test/admin/` and bootstrap routing in `AdminServer.ts`. Inspect original dirty admin changes as input, but reproduce failures before adopting implementation. Lane B agent `fix_supply15`, worktree `../TTTGate-epic61-release`, branch `fix/epic61-release`, base `654a065`, owns `package-build.json`, release manifest generation and the release-manifest supply test; it does not change admin package files concurrently.

Lane A, serial:

The #5 adoption checkpoint includes the original admin crypto-js removal: only LoginCtrl hashing, InputCertFile challenge generation, the shared hash utility and associated tests may change alongside SPA mounting and package upgrades. Preserve Node 24/TypeScript 5.9. Secure-context SHA-512 uses native Web Crypto; explicit pre-existing HTTP compatibility may use the already-shipped forge implementation with the same UTF-8 digest. Challenge randomness remains native CSPRNG-only. This does not authorize fixing #6 lifecycle or #8 login/bootstrap behavior early, and does not weaken production TLS defaults. Verify the intentional insecure-context fallback in a real browser context rather than by replacing browser crypto APIs.

- [x] #50 admin test runner. Status: complete; commit `d8cb6a7` pushed, issue closed, Telegram receipt 3898 (58/5).
- [x] #5 SPA mount. Status: complete; commit `6a3b94c` pushed, issue closed, Telegram receipt 3911 (61/11); Svelte 5/crypto-js removal preserves Node 24 and TypeScript 5.9.
- [x] #6 certificate lifecycle. Status: complete; commit `67d8123` pushed, issue closed, Telegram receipt 3915 (61/14).
- [x] #7 CSRF integration. Status: complete; commit `2b0a426` pushed, issue closed, Telegram receipt 3917 (62/16); native-launch failure and subsequent successful integration retained separately.
- [ ] #67 development proxy Origin compatibility. Status: assigned to `fix_ci14` in UI worktree, branch `fix/epic61-dev-origin`, base `2b0a426`; approved narrow dev and inherited-preview validation/adaptation, no backend weakening. Before #8.
- [ ] #8 bootstrap UI and request. Status: pending previous lane item.
- [ ] #51 empty-key routing. Status: pending previous lane item.

Lane B, parallel with A:

- [x] #17 release manifest. Status: complete; commit `5cd4df0` pushed, issue closed, Telegram receipt 3897 (58/4).

Serial interlude after #50 and #17 integration, before Lane A continues with #5:

- [x] #63 Node 24 minimum/runtime migration. Status: complete; commit `b093dce` pushed, issue closed, Telegram receipt 3902 (61/7). All five targets preserved; future admin changes must retain Node 24 and TypeScript 5.9.

Runtime verification interlude: #63 configuration/artifact implementation precedes #64 investigation and repair; #64 completion then enables #63 final full-regression/closure gate. This is the ordered chain `#63 implementation -> #64 -> #63 final verification`, not a cyclic issue dependency. The runtime lane owns this sequence; the explicitly bounded independent-fixer delegation below separates script and runtime write sets. Do not weaken the 7% threshold, retry until green, or treat an isolated pass as resolution. Review the methodology proposal before implementation.

- [x] #64 timing benchmark verification reliability. Status: complete as verification-method repair; commit `b093dce` pushed, issue closed, Telegram receipt 3903 (61/8). First experiment FAIL and both diagnostics INCONCLUSIVE remain preserved; no empirical timing PASS or physical proof claimed.

- [x] #66 odd-length hex comparison validation. Status: complete; commit `b093dce` pushed, issue closed, Telegram receipt 3904 (61/9). Native padded comparison path preserved.

Bounded independent-fixer delegation in the existing Node 24 worktree is intentional: `fix_ci14` fixes only the #64 benchmark script and dedicated experiment tests, while `fix_supply15` owns #66's helper and dedicated regression test. These are disjoint write sets, not independent integration lanes. Neither edits the other's files. Freeze both before rebuilding and executing the preregistered timing diagnostic or integration checks. #64's first explicit experiment remains FAIL; no retries until green or retrospective threshold relaxation. The fixed diagnostic and the single preapproved affinity-condition comparison were both INCONCLUSIVE. Stop timing measurements and condition search. Root accepted #64 closure against its actual verification-method repair criteria after fresh ordinary full regression and honest evidence review; no conclusive empirical timing or physical constant-time claim is required or made. Preserve every FAIL/INCONCLUSIVE report. #63 closes only after #64/#66 acceptance and integrated full regression plus refreshed binary checks.

Wave completion gate, after A and B integration:

- [ ] #44 release type-check/test/install gates. Status: pending both Wave 1 lanes; exclusive release and package ownership.
- [ ] #65 release archive collection. Status: pending #63 and administrator lane completion; same exclusive release lane alongside #44, serialized around shared workflow edits. Test actual `dist/bin/TTTGate-*` output names, all five archive contents, and fail on absent/empty artifacts. Evidence: `verification/epic61-discovery-65.md`.

### Wave 2 — termination and listener foundations

Status: pending Wave 1 except completed early work and the explicitly bounded #10/#39 and paired #26/#27 lanes. Lane A exclusively owns `SocketHandler.ts`, `TCPServer.ts`, `CtrlPacket.ts`, `TunnelServer.ts`, `TunnelClient.ts`, `ClientHandlerPool.ts`, `ExternalPortServerPool.ts`, and HTTP cleanup changes. These cannot be divided into simultaneous protocol/listener writers. Lane B owns `Sentinel.ts`, `LogWriter.ts` and logging composition only. Lane C owns admin/config/certificate files and their tests; changes to external listeners or common transport are deferred to Wave 4.

Early #9 lane: after completed Wave 0, #9 may execute concurrently with #63. Actual issue scope is command payload validation in `src/commons/CtrlPacket.ts`, getter bounds and dedicated packet/consumer regression tests. These do not depend on administrator fixes or Node packaging. Exclusive writable paths are `src/commons/CtrlPacket.ts`, `test/unit/commons/CtrlPacket.test.ts`, dedicated #9 files under `test/commons/` and `test/component/`, and its issue ledger. Existing consumer/runtime files may be read; any required edits outside this set must be surfaced and ownership/schedule amended before writing. The #9 worker must not edit root/admin manifests, lockfiles, workflows, README, packaging scripts or shared test helpers owned by #63/admin. No other Wave 2 issue starts early except the separately bounded #16/#21, #10/#39 and paired #26/#27 lanes below. Integrate serially and rerun packet/consumer regression on the integrated Node 24 baseline. The orchestrator records the assigned worktree/branch before dispatch. This is a dependency-based parallel exception, not a relaxation of TDD or review gates.

Lane A, serial:

- [x] #9 control payload boundary. Status: complete; commit `a8ea15b` pushed, issue closed, Telegram receipt 3900 (61/6). Control lane changes are included in the runtime lane.

Bounded early listener lane: #10 may start alongside administrator #6 after the completed Wave 0/runtime barriers. It exclusively owns `src/server/ExternalPortServerPool.ts`, dedicated inactive-listener socket/process tests and its ledger. Verify real inactive-on-startup and activation-timeout rejection, no unhandled child exit, no phantom session/count/termination callback, and recovery to accepted connections. Existing TCPServer/SocketHandler helpers may be read, but runtime changes there need ownership expansion before writing. This prevents a fix that only avoids the undefined bundle while registering rejected sockets as real sessions.

After #10 reviewed integration, the same lane may handle #39 with exclusive `src/util/TCPServer.ts`, dedicated restart/error/listening/close tests and its ledger. Real restart/port-conflict tests must preserve observable errors and callback lifecycle, without a process-wide catch or weakened TLS. Root/admin manifests, workflows, admin sources, certificate lifecycle, HTTP handlers and shared helper edits remain outside both assignments. Record the lane worktree/branch before dispatch, rebase after integration and integrate serially. #28 and other transport/HTTP work remain under their existing gates; this allowance covers #10 then #39; paired #26/#27 has its separate bounded rule below.

- [ ] #28 large byte counts. Status: pending Wave 1; not authorized by the early listener exception.
- [x] #10 inactive listener. Status: complete; commit `22d6a08` pushed, issue closed, Telegram receipt 3914 (61/13).
- [x] #39 TCPServer restart. Status: complete; source commit `cf38c9d` integrated before remote `2b0a426`, issue closed, Telegram receipt 3916 (62/15).
- [ ] #26 control-handler cleanup. Status: assigned to `fix_supply15` in listener worktree, branch `fix/epic61-handler-lifecycle`, base `2b0a426`, paired with #27; both specific RED cases precede shared implementation.
- [ ] #27 HTTP-handler cleanup. Status: assigned jointly with #26 to the same listener branch/base; HTTP wrapper RED before shared fix, initial TCPServer/test ownership only.

Bounded paired #26/#27 lane: after #39 reviewed integration, one listener worker may handle these together alongside admin #67/#8. Both defects lose TCPServer registry cleanup when a consumer replaces SocketHandler's event callback. Write and observe separate control-pool shutdown and HTTP-wrapper RED cases before the shared implementation; retain per-issue evidence and completion notifications. Initially own `src/util/TCPServer.ts`, dedicated registry-lifecycle tests and both ledgers. ClientHandlerPool/HttpHandler are read-only consumers; no HTTP parsing or administrator edits belong here. Test natural end, explicit destruction/error, live-handler preservation and repeated cycles. SocketHandler removes native listeners before some terminal paths, so a naive native close-only hook cannot be assumed durable. Any required SocketHandler edit needs an independently reviewed minimal terminal-cleanup design and explicit ownership amendment before writing; do not introduce a general transport event framework. Integrate serially; no other transport issue is opened by this pair.

Lane B, parallel with A/C:

Bounded early #16/#21 lane: after the reviewed Node 24/comparison changes are integrated, this lane may execute alongside administrator #5/#6/#7/#8/#51. Source inspection finds no dependency on SPA mounting, certificate UI or CSRF/bootstrap contracts. #16 exclusively owns `src/Sentinel.ts`, dedicated Sentinel test/driver files under `test/component/` or `test/unit/`, and its ledger. Use an isolated child and explicit failure fixture for RED; intercept/record dangerous signal destinations before they can leave the child, so the baseline never actually signals PID 1 or another process. The GREEN test must observe the intended child termination and preserve unrelated daemon behavior; a fixture must not be described as mock-free if it replaces a process lookup/signal boundary.

After #16 integration, #21 exclusively owns `src/util/logger/LogWriter.ts`, dedicated retention tests and its ledger. Test real temporary log files, retained recent/unrelated files and logger-name metacharacters. Existing logging composition may be read; any composition/configuration or shared-helper edit needs an ownership amendment before writing. Neither issue owns root/admin manifests, lockfiles, workflows, README, admin sources, transport primitives or packaging scripts. Record worktree/branch before dispatch and integrate changes serially with scoped and integrated regressions. This does not authorize early #11/HTTP or other Wave 2 work; existing overlap/dependency rules remain.

- [x] #16 Sentinel self-termination. Status: complete; commit `66d0323` pushed, issue closed, Telegram receipt 3908 (61/10).
- [x] #21 log retention. Status: complete; commit `9281bb2` pushed, issue closed, Telegram receipt 3912 (61/12).

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

Bounded #49 prerequisite cleanup: independent baseline probing of the untouched integration TLS hot-apply test's case (6) passed its assertion but retained the process beyond 25 seconds. That case creates an ExternalPortServerPool without disposal; case (5) stops a port but leaves the pool's cleanup interval. The isolated probe killed only its owned child. An independent fixer may now change only `test/security/req-08-admin-cert-hotapply.test.ts` to dispose owned pools in finally, plus dedicated lifecycle evidence, then prove the same tests exit naturally. This unblocks #39 broader regression without attributing the pre-existing fixture leak to #39 or treating passed assertions as process success. No root scripts, forced-exit flags or production cleanup change belongs to this partial task, and #49 must remain open until its full shutdown criteria are met.

- [ ] #49 remove forced exit and prove process shutdown. Status: bounded TLS fixture cleanup completed in `../TTTGate-epic61-tls-cleanup`, branch `fix/epic61-tls-cleanup`, base `67d8123`, independent fixer `research_schedule`; bounded fixture cleanup integrated as `8266c10`; full shutdown/forceExit work remains pending Wave 5.
- [ ] #52 whole-source coverage gate. Status: pending previous lane item; lines >=64.26%, branches >=52.23%, without narrowing measured source scope.
- [ ] #58 all 366 requirement links. Status: pending previous lane item; preserve truthful uncovered/partial classifications rather than inventing links.
- [ ] Final: full backend/admin checks, E2E HTTP/TLS/multi-client/large transfer, whole-source coverage, independent requirement-by-requirement review, remote commit verification, close all children and epic. Status: pending all issues and notification receipts.

## Per-issue gates

1. Read issue, decisions, existing code and reuse opportunities.
2. Write failing regression first; record exact command and red result before implementation. If implementation accidentally precedes tests, remove that implementation and restart test-first.
3. Implement minimum fix in assigned worktree; record green and appropriate regression evidence.
4. Independent reviewer checks original requirements and diff. A different fixer handles findings, followed by independent re-review until no material findings remain. Record findings by critical/high/medium/low.
5. Review commit content/message independently, commit without signature or progress markers, integrate serially, run integration checks, push without force, verify remote hash, then close issue with evidence.
6. Send Telegram after each closed issue: `TDD Gate {issue number} {issue title} ({total issue count}/{completed issue count})`. Current total 62 (original 56 plus #62, #63, #64, #65, #66 and #67); add newly discovered in-scope issues explicitly. Persist delivery result to prevent duplicate reporting.

## Issue completion ledger

Sixteen of 62 issues completed: #14, #62, #15, #17, #50, #9, #63, #64, #66, #16, #5, #21, #10, #6, #39 and #7. Independent Wave 0 review evidence: `docs/plan/verification/epic61-wave0-review.md`. Each checklist item is completed only after all per-issue gates. Store its ledger in `docs/plan/verification/epic61-issue-N.md`, where N is the issue number. Required fields: original title/requirements, assigned agent/worktree/branch/writable paths, current status and next command, reuse findings, red command/result before implementation, green/regression commands/results, review findings and independent reviewer/fixer identity, integration commit, pushed remote hash, GitHub closure evidence, Telegram title/delivery receipt. Allowed states: pending, assigned, red, implementing, reviewing, integrating, pushed, closed, notified, complete, blocked. Update the checklist status when any state changes. Newly discovered defects receive their own issue, schedule item and ledger; update total count before subsequent notifications.

Plan review evidence: `docs/plan/verification/epic61-plan-review.md`. A different reviewer must rereview this amended plan before treating its findings as resolved.

## Resume

Inspect live Git/worktree/GitHub state and live agent handles before relying on this document; do not restart work based only on an expired observation or stale status. Current next action: progress assigned administrator #67 and paired listener #26/#27 lanes from `2b0a426`; #7/#39 are complete. Runtime #63/#64/#66 is complete, with timing INCONCLUSIVE explicitly preserved. No further timing measurements. #9 is complete and integrated into the runtime lane. #50 and #17 are complete; #5 is complete after the Node 24 integration. Wave 0 combined build passed; full regression completed with 68 suites/306 tests passed and four online tests skipped (157.635 seconds). Remote HEAD observed after #39/#7 completion is `2b0a42690f6aa52046cc648cc7b1ec479b3f4c8f`. All original dirty files remain in the original workspace. After Wave 0, create each new lane from the latest reviewed integration commit and record its path in the ledger before assignment. Recheck current user-decision evidence before any policy-sensitive implementation.
