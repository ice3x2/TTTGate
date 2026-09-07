# Epic #61 execution plan

Status: active; 2026-09-08; baseline `376b65c`; 63 tracked issues, twenty-two completed. Original child range: 5 through 60, plus discovered build issue 62, user-directed Node 24 migration 63, timing verification issue 64 and release archive issue 65, odd-length hex validation issue 66 and development proxy origin issue 67 and source archive issue 68; unrelated issue 2 is excluded.

## Scope and decisions

Resolve every child of #61, plus defects discovered during this work. Preserve existing CLI, configuration, authentication, TLS and tunnel compatibility unless a documented decision requires change. Reference `docs/research/2026-09-05-tttgate-full-inspection.md`, `docs/plan/00-2.tech-decisions.md`, and existing phase plans. Previous session decision-file location has been requested; no new product policy is inferred from the unrelated RBAC roadmap.

Original workspace `../TTTGate` on `refactor/admin` contains pre-existing uncommitted admin upgrades and reports. Preserve those changes. Integration workspace: `../TTTGate-epic61`, branch `fix/epic-61`. Issue lanes are sibling worktrees forked from the latest reviewed integration commit. Changes are integrated serially; never share a writable lane.

Accepted current user decision: minimum Node.js version becomes `>=24.0.0` (24 LTS), replacing the earlier Node 18 baseline. ADR-011 and `verification/epic61-node24-decision.md` define #63. No further Node-major policy decision is pending. Preserve historical #14/#62/#15 evidence and notification denominators as sent; all subsequent notifications use total 63 after discovery of #68; already-sent notification denominators remain unchanged.

## Execution order and ownership

Each issue below appears once and is its own resumable checklist item. Items inside a lane run serially. Lanes in the same wave may run in parallel, up to three workers including reviewers; the orchestrator occupies the fourth slot. A completed wave means reviewed changes have been integrated and checked before the next wave starts, except the explicitly bounded early #9, #16/#21, #10/#39 paired #26/#27, backend #13 and serial cache #19/#20 lanes below. Wave 0 remains the mandatory global barrier. Release gates run after both Wave 1 lanes and #63.

File ownership is exclusive during a wave, including test files. Serial cherry-picking alone does not make overlapping implementations safe. Before assignment, record the actual branch, worktree and writable paths in the issue evidence file. If a fix needs another active lane's file, defer that change until the owner is integrated, update this plan and rebase the waiting lane. Do not independently edit shared files and defer resolving their semantics until merge.

### Wave 0 — mandatory regression barrier

Status: complete; #14, #62 and #15 passed review, integration, push, closure and notification gates. Worktrees: `../TTTGate-epic61-ci` and `../TTTGate-epic61-supply`. CI owns the new code-test workflow, contract tests and root package manifests; supply owns supply-chain tests/helpers. Existing shared workflow changes have one owner and are integrated before the dependent lane resumes. No later-wave implementation starts until all three items pass independent review and integration checks.

- [x] #14 CI execution. Status: complete; commit `1df351f` pushed, issue closed, Telegram receipt 3893 (57/1).
- [x] #62 clean-install TypeScript build compatibility. Status: complete; commit `a35f53c` pushed, issue closed, Telegram receipt 3894 (57/2). Evidence: `verification/epic61-issue-62.md`.
- [x] #15 fail-closed supply-chain checks. Status: complete; commit `654a065` pushed, issue closed, Telegram receipt 3896 (57/3).

### Wave 1 — administrator deployment blockers

Status: administrator prerequisites complete. Release owner `fix_ci14` is assigned #44 in `../TTTGate-epic61-release`, branch `fix/epic61-release-gates`, base `30599cf`; #65/#68 follow under the same owner serially. Exclusive scope covers deploy/root/admin install/type/build/test gates, release scripts/workflows, related documentation and dedicated tests. Cache #19 owns separate SocketHandler/FileCache paths; no shared writer.

Lane A, serial:

The #5 adoption checkpoint includes the original admin crypto-js removal: only LoginCtrl hashing, InputCertFile challenge generation, the shared hash utility and associated tests may change alongside SPA mounting and package upgrades. Preserve Node 24/TypeScript 5.9. Secure-context SHA-512 uses native Web Crypto; explicit pre-existing HTTP compatibility may use the already-shipped forge implementation with the same UTF-8 digest. Challenge randomness remains native CSPRNG-only. This does not authorize fixing #6 lifecycle or #8 login/bootstrap behavior early, and does not weaken production TLS defaults. Verify the intentional insecure-context fallback in a real browser context rather than by replacing browser crypto APIs.

- [x] #50 admin test runner. Status: complete; commit `d8cb6a7` pushed, issue closed, Telegram receipt 3898 (58/5).
- [x] #5 SPA mount. Status: complete; commit `6a3b94c` pushed, issue closed, Telegram receipt 3911 (61/11); Svelte 5/crypto-js removal preserves Node 24 and TypeScript 5.9.
- [x] #6 certificate lifecycle. Status: complete; commit `67d8123` pushed, issue closed, Telegram receipt 3915 (61/14).
- [x] #7 CSRF integration. Status: complete; commit `2b0a426` pushed, issue closed, Telegram receipt 3917 (62/16); native-launch failure and subsequent successful integration retained separately.
- [x] #67 development proxy Origin compatibility. Status: complete; commit `21ea55a` pushed, issue closed, Telegram receipt 3918 (62/17); dev/preview guard preserves backend Origin/CSRF policy.
- [x] #8 bootstrap UI and request. Status: complete; source `a9e6130`, integration `0e9ce88` pushed, issue closed, Telegram receipt 3922 (63/21).
- [x] #51 empty-key routing. Status: complete; source `1ee99c1`, integration `30599cf` pushed, issue closed, Telegram receipt 3925 (63/22); endpoint remains 404 and SessionStore unchanged.

Approved #51 scope: remove `LoginCtrl.isEmptyKey`, Login's obsolete onMount discovery request/state and the unused backend `onGetEmptyKey` handler; add dedicated browser absence/flow tests and its ledger. Continue using #8's login response flags. Preserve HTTP 404 for `/api/emptyKey`, existing SessionStore behavior and authentication/CSRF policy. This narrow AdminServer removal is authorized after #13 integration and is disjoint from #19's SocketHandler/FileCache work. Do not change unrelated backend routes or cache ownership.

Bounded #8/#13 parallel ownership: backend already accepts raw `key` plus `bootstrapToken`, returns bootstrap/weak-password/token-error flags and supports stored legacy-hash migration to bcrypt. #8 may change `admin/src/controller/LoginCtrl.ts`, `admin/src/layout/Login.svelte` and dedicated browser login fixtures/tests, including updating obsolete private-hash test references to actual wire/server compatibility. It must not write backend source. #13 exclusively owns AdminServer login limiter key/count/reset/delay call sites and existing/dedicated backend limiter tests. The submitted-password-derived bucket dimension is removed; existing threshold/window/backoff and trusted-proxy policy remain unchanged. `loginBackoff.ts` is read-only unless a failing regression establishes a required change and scope is explicitly amended. SessionStore, authentication/CSRF policy and response envelopes remain unchanged by #13.

Both lanes were dispatched from reviewed `bf6b790` and completed: #8 integrated as `0e9ce88`, #13 as `1caf4df`. The following ownership rules record that completed phase. #8 must handle 429 without automatic retries and use isolated test state; valid raw-password/bootstrap login, persisted bcrypt/legacy login after real restart and explicit browser session setup are required. Do not assume restarting the backend clears browser cookies. If #8 needs a backend change, defer that write until #13 integrates, rebase and amend ownership first; independent frontend work may continue. #51's backend dead-endpoint removal is likewise serialized after #13. Other Wave 2 admin/configuration work remains gated.

Approved #8 orphan cleanup is limited to removing unused `sha512Hex` and its forge import after raw-password login replaces client hashing. Keep native `randomHex` and certificate challenge behavior unchanged. Replace old private-hash browser fixtures/assertions with actual login-wire/server compatibility and native challenge tests; do not retain orphan production hashing solely to satisfy obsolete test fixtures. Backend #51 removal still waits for #13 integration.

Lane B, parallel with A:

- [x] #17 release manifest. Status: complete; commit `5cd4df0` pushed, issue closed, Telegram receipt 3897 (58/4).

Serial interlude after #50 and #17 integration, before Lane A continues with #5:

- [x] #63 Node 24 minimum/runtime migration. Status: complete; commit `b093dce` pushed, issue closed, Telegram receipt 3902 (61/7). All five targets preserved; future admin changes must retain Node 24 and TypeScript 5.9.

Runtime verification interlude: #63 configuration/artifact implementation precedes #64 investigation and repair; #64 completion then enables #63 final full-regression/closure gate. This is the ordered chain `#63 implementation -> #64 -> #63 final verification`, not a cyclic issue dependency. The runtime lane owns this sequence; the explicitly bounded independent-fixer delegation below separates script and runtime write sets. Do not weaken the 7% threshold, retry until green, or treat an isolated pass as resolution. Review the methodology proposal before implementation.

- [x] #64 timing benchmark verification reliability. Status: complete as verification-method repair; commit `b093dce` pushed, issue closed, Telegram receipt 3903 (61/8). First experiment FAIL and both diagnostics INCONCLUSIVE remain preserved; no empirical timing PASS or physical proof claimed.

- [x] #66 odd-length hex comparison validation. Status: complete; commit `b093dce` pushed, issue closed, Telegram receipt 3904 (61/9). Native padded comparison path preserved.

Bounded independent-fixer delegation in the existing Node 24 worktree is intentional: `fix_ci14` fixes only the #64 benchmark script and dedicated experiment tests, while `fix_supply15` owns #66's helper and dedicated regression test. These are disjoint write sets, not independent integration lanes. Neither edits the other's files. Freeze both before rebuilding and executing the preregistered timing diagnostic or integration checks. #64's first explicit experiment remains FAIL; no retries until green or retrospective threshold relaxation. The fixed diagnostic and the single preapproved affinity-condition comparison were both INCONCLUSIVE. Stop timing measurements and condition search. Root accepted #64 closure against its actual verification-method repair criteria after fresh ordinary full regression and honest evidence review; no conclusive empirical timing or physical constant-time claim is required or made. Preserve every FAIL/INCONCLUSIVE report. #63 closes only after #64/#66 acceptance and integrated full regression plus refreshed binary checks.

Wave completion gate, after A and B integration:

- [ ] #44 release type-check/test/install gates. Status: assigned to `fix_ci14` in `../TTTGate-epic61-release`, branch `fix/epic61-release-gates`, base `30599cf`; dedicated ledger and RED precede implementation.

Release execution constraints: preserve existing distribution outputs until install/type/build/test gates pass. Direct deploy bootstrap must not require missing third-party packages before its installation gate. Install the required browser/system dependencies for browser tests. Since browser preview tests can overwrite `admin/dist`, run the final ordinary production admin build after those tests and before copying release assets. #44/#65/#68 share one serial owner; no release publication is authorized by this local verification task. Cache source/accounting work remains separate. The release worker owns its detailed #44 ledger and RED-first execution plan.
- [ ] #65 release archive collection. Status: pending #44 reviewed integration, same release owner serially; exact five binary archive contents and missing/empty artifact failures required. Evidence: `verification/epic61-discovery-65.md`.
- [ ] #68 source archive contents and entrypoint. Status: pending #65 reviewed integration, same release owner serially; actual artifact RED, source JavaScript/manifest/web validation and fresh-directory documented startup required. Evidence: `verification/epic61-source-archive-discovery.md`.

### Wave 2 — termination and listener foundations

Status: pending Wave 1 except completed early work and the explicitly bounded #10/#39 and paired #26/#27 lanes. Lane A exclusively owns `SocketHandler.ts`, `TCPServer.ts`, `CtrlPacket.ts`, `TunnelServer.ts`, `TunnelClient.ts`, `ClientHandlerPool.ts`, `ExternalPortServerPool.ts`, and HTTP cleanup changes. These cannot be divided into simultaneous protocol/listener writers. Lane B owns `Sentinel.ts`, `LogWriter.ts` and logging composition only. Lane C owns admin/config/certificate files and their tests; changes to external listeners or common transport are deferred to Wave 4.

Early #9 lane: after completed Wave 0, #9 may execute concurrently with #63. Actual issue scope is command payload validation in `src/commons/CtrlPacket.ts`, getter bounds and dedicated packet/consumer regression tests. These do not depend on administrator fixes or Node packaging. Exclusive writable paths are `src/commons/CtrlPacket.ts`, `test/unit/commons/CtrlPacket.test.ts`, dedicated #9 files under `test/commons/` and `test/component/`, and its issue ledger. Existing consumer/runtime files may be read; any required edits outside this set must be surfaced and ownership/schedule amended before writing. The #9 worker must not edit root/admin manifests, lockfiles, workflows, README, packaging scripts or shared test helpers owned by #63/admin. No other Wave 2 issue starts early except the separately bounded #16/#21, #10/#39 paired #26/#27, backend #13 and serial cache #19/#20 lanes below. Integrate serially and rerun packet/consumer regression on the integrated Node 24 baseline. The orchestrator records the assigned worktree/branch before dispatch. This is a dependency-based parallel exception, not a relaxation of TDD or review gates.

Lane A, serial:

- [x] #9 control payload boundary. Status: complete; commit `a8ea15b` pushed, issue closed, Telegram receipt 3900 (61/6). Control lane changes are included in the runtime lane.

Bounded early listener lane: #10 may start alongside administrator #6 after the completed Wave 0/runtime barriers. It exclusively owns `src/server/ExternalPortServerPool.ts`, dedicated inactive-listener socket/process tests and its ledger. Verify real inactive-on-startup and activation-timeout rejection, no unhandled child exit, no phantom session/count/termination callback, and recovery to accepted connections. Existing TCPServer/SocketHandler helpers may be read, but runtime changes there need ownership expansion before writing. This prevents a fix that only avoids the undefined bundle while registering rejected sockets as real sessions.

After #10 reviewed integration, the same lane may handle #39 with exclusive `src/util/TCPServer.ts`, dedicated restart/error/listening/close tests and its ledger. Real restart/port-conflict tests must preserve observable errors and callback lifecycle, without a process-wide catch or weakened TLS. Root/admin manifests, workflows, admin sources, certificate lifecycle, HTTP handlers and shared helper edits remain outside both assignments. Record the lane worktree/branch before dispatch, rebase after integration and integrate serially. #28 and other transport/HTTP work remain under their existing gates; this allowance covers #10 then #39; paired #26/#27 has its separate bounded rule below.

- [ ] #28 large byte counts. Status: pending explicit compatibility-policy input; root asked whether oversized sessions require both peers upgraded or need further legacy-compatibility design. No dependent implementation is authorized before an answer. Research: `verification/epic61-issue-28-research.md`. This does not block other ongoing epic work; any early protocol lane requires a subsequent ownership/schedule amendment.
- [x] #10 inactive listener. Status: complete; commit `22d6a08` pushed, issue closed, Telegram receipt 3914 (61/13).
- [x] #39 TCPServer restart. Status: complete; source commit `cf38c9d` integrated before remote `2b0a426`, issue closed, Telegram receipt 3916 (62/15).
- [x] #26 control-handler cleanup. Status: complete; shared commit `bf6b790` pushed, issue closed, Telegram receipt 3919 (62/18).
- [x] #27 HTTP-handler cleanup. Status: complete; shared commit `bf6b790` pushed, issue closed, Telegram receipt 3920 (62/19).

Bounded paired #26/#27 lane: after #39 reviewed integration, one listener worker may handle these together alongside admin #67/#8. Both defects lose TCPServer registry cleanup when a consumer replaces SocketHandler's event callback. Write and observe separate control-pool shutdown and HTTP-wrapper RED cases before the shared implementation; retain per-issue evidence and completion notifications. Initially own `src/util/TCPServer.ts`, dedicated registry-lifecycle tests and both ledgers. ClientHandlerPool/HttpHandler are read-only consumers; no HTTP parsing or administrator edits belong here. Test natural end, explicit destruction/error, live-handler preservation and repeated cycles. SocketHandler removes native listeners before some terminal paths, so a naive native close-only hook cannot be assumed durable. Any required SocketHandler edit needs an independently reviewed minimal terminal-cleanup design and explicit ownership amendment before writing; do not introduce a general transport event framework. Integrate serially; no other transport issue is opened by this pair.

Approved #26/#27 ownership amendment: both real issue-specific REDs and a native-close-only failure were observed before shared implementation. `review_wave0` approved adding only a private one-shot owner-terminal callback through an optional third `SocketHandler.bound` parameter, extending writable scope narrowly to `src/util/SocketHandler.ts`. Store it before native listener setup; consume it before invoking at existing End/Closed transitions and before replaceable application callbacks. Preserve existing state/drain/queue sequencing; do not notify when `end_()` merely requests closure. TCPServer's callback receives the handler argument and only removes that ID. `connect` API and ClientHandlerPool/HttpHandler remain unchanged. Add exact-once/reentrancy contract RED before implementation. This replaces the earlier pending-design restriction only for this reviewed minimal hook.

Lane B, parallel with A/C:

Bounded early #16/#21 lane: after the reviewed Node 24/comparison changes are integrated, this lane may execute alongside administrator #5/#6/#7/#8/#51. Source inspection finds no dependency on SPA mounting, certificate UI or CSRF/bootstrap contracts. #16 exclusively owns `src/Sentinel.ts`, dedicated Sentinel test/driver files under `test/component/` or `test/unit/`, and its ledger. Use an isolated child and explicit failure fixture for RED; intercept/record dangerous signal destinations before they can leave the child, so the baseline never actually signals PID 1 or another process. The GREEN test must observe the intended child termination and preserve unrelated daemon behavior; a fixture must not be described as mock-free if it replaces a process lookup/signal boundary.

After #16 integration, #21 exclusively owns `src/util/logger/LogWriter.ts`, dedicated retention tests and its ledger. Test real temporary log files, retained recent/unrelated files and logger-name metacharacters. Existing logging composition may be read; any composition/configuration or shared-helper edit needs an ownership amendment before writing. Neither issue owns root/admin manifests, lockfiles, workflows, README, admin sources, transport primitives or packaging scripts. Record worktree/branch before dispatch and integrate changes serially with scoped and integrated regressions. This does not authorize early #11/HTTP or other Wave 2 work; existing overlap/dependency rules remain.

- [x] #16 Sentinel self-termination. Status: complete; commit `66d0323` pushed, issue closed, Telegram receipt 3908 (61/10).
- [x] #21 log retention. Status: complete; commit `9281bb2` pushed, issue closed, Telegram receipt 3912 (61/12).

Lane C, parallel with A/B:

- [x] #13 login limiter. Status: complete; source commit `34a931c`, integration `1caf4df` pushed, issue closed, Telegram receipt 3921 (63/20).
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

Status: pending Wave 3 except the bounded early #19/#20 lane below. Lane A serially owns `FileCache.ts`, `SocketHandler.ts`, `TCPServer.ts`, socket logging, `ServerOptionStore.ts`, `AdminServer.ts`, and `ExternalPortServerPool.ts`; combining these changes avoids cache/logging/lifecycle and normalization/backpressure writer conflicts. Lane B owns lint and artifact cleanup tests, including the existing pool-swap E2E test; it does not alter shared harness or runtime code concurrently.

Lane A, serial:

Bounded early cache exception: independent research and `review_wave0` review authorize #19 then #20 alongside UI #8/#51 after the integrated #26/#27 owner-terminal changes. Research: `verification/epic61-cache-lane-research.md`. #19 owns only SocketHandler cached dequeue, send-failure handling and per-item accounting, FileCache.readSync validation if a real failure proves it necessary, dedicated tests and its ledger. #20 then owns reusable-block ID allocation and dedicated tests. No other transport, administrator, HTTP or protocol writes are authorized; #28 remains pending user policy. Preserve successful cache-release timing. RED must cover failed/current/follower callbacks exactly once, last-item drain failure, surviving-handler global accounting, actual socket/owner cleanup, and successful spill bytes. Reproduce short reads with a real truncated file before implementing validation. This exception does not release the other Wave 4 items.

- [ ] #19 cache read failures. Status: assigned after independent early-lane review; agent `fix_supply15`, worktree `../TTTGate-epic61-listeners`, branch `fix/epic61-cache-read`, base `bacae6f`; write an issue ledger and observe RED before implementation.
- [ ] #20 cache block identity. Status: pending reviewed integration of #19; same cache owner, serial execution.
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
6. Send Telegram after each closed issue: `TDD Gate {issue number} {issue title} ({total issue count}/{completed issue count})`. Current total 63 (original 56 plus #62, #63, #64, #65, #66, #67 and #68); add newly discovered in-scope issues explicitly. Persist delivery result to prevent duplicate reporting.

## Issue completion ledger

Twenty-two of 63 issues completed: #14, #62, #15, #17, #50, #9, #63, #64, #66, #16, #5, #21, #10, #6, #39, #7, #67, #26, #27, #13, #8 and #51. Independent Wave 0 review evidence: `docs/plan/verification/epic61-wave0-review.md`. Each checklist item is completed only after all per-issue gates. Store its ledger in `docs/plan/verification/epic61-issue-N.md`, where N is the issue number. Required fields: original title/requirements, assigned agent/worktree/branch/writable paths, current status and next command, reuse findings, red command/result before implementation, green/regression commands/results, review findings and independent reviewer/fixer identity, integration commit, pushed remote hash, GitHub closure evidence, Telegram title/delivery receipt. Allowed states: pending, assigned, red, implementing, reviewing, integrating, pushed, closed, notified, complete, blocked. Update the checklist status when any state changes. Newly discovered defects receive their own issue, schedule item and ledger; update total count before subsequent notifications.

Plan review evidence: `docs/plan/verification/epic61-plan-review.md`. A different reviewer must rereview this amended plan before treating its findings as resolved.

## Resume

Inspect live Git/worktree/GitHub state and live agent handles before relying on this document; do not restart work based only on an expired observation or stale status. Current next action: progress assigned release #44 (`fix/epic61-release-gates`) alongside #19 (`fix/epic61-cache-read`); #65 then #68 follow serially after release gates, #20 follows #19 integration. #8/#13 are complete. #28 still awaits explicit policy input and no dependent implementation is authorized. #67/#26/#27 are complete; #51 is complete after #8/#13 integration. Runtime #63/#64/#66 is complete, with timing INCONCLUSIVE explicitly preserved. No further timing measurements. #9 is complete and integrated into the runtime lane. #50 and #17 are complete; #5 is complete after the Node 24 integration. Wave 0 combined build passed; full regression completed with 68 suites/306 tests passed and four online tests skipped (157.635 seconds). Remote `origin/fix/epic-61` HEAD observed after #51 completion is `30599cf59fa1507051469c9edd1c099ea139182f`. All original dirty files remain in the original workspace. After Wave 0, create each new lane from the latest reviewed integration commit and record its path in the ledger before assignment. Recheck current user-decision evidence before any policy-sensitive implementation.
