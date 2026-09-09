# Issue #40 — Server buffer lower-bound research

Status: read-only research complete; policy/scope and independent review pending. No production edits, tests or implementation authorization.

- [x] Read original issue and current consumers. Status: complete, source anchors below.
- [x] Compare UI and historical policy. Status: complete; zero is explicitly documented by the UI as unlimited, so rejecting it is a deliberate compatibility change.
- [x] Propose bounded RED and reuse. Status: proposed, not executed.
- [ ] Approve numeric/legacy-load policy and writable scope. Status: pending root and independent review.
- [ ] Write implementation ledger and observe RED before code. Status: pending separate assignment after #37.

## Evidence and meaning of zero

Original [issue #40](https://github.com/ice3x2/TTTGate/issues/40) recommends rejecting values at or below zero because they disable server read backpressure. Current `ServerOptionStore.ts:349-354` defaults omitted server/client limits to 8 MiB but accepts supplied values without a lower-bound/type check. `ExternalPortServerPool.ts:342-343` converts absent or less-than-one server values to -1; `SocketHandler.ts:144-150,767-793` then reports no local backpressure and does not pause reads on that criterion. Positive fractions below 1 also enter this consumer branch: a positive-only validation would leave that gap.

This is not an undocumented accidental meaning of zero: `admin/src/layout/TunnelOptionSetLayout.svelte:76-83` clamps below -1 to -1, accepts zero, and lines 556-569 label the unit MiB and explicitly state `0>=n : Unlimited memory buffer`. New UI rows use 10 MiB (217-218), whereas omitted backend values use 8 MiB. Historical `docs/plan/verification/evidence/hardened/phase-3/2026-04-20-phase-3.md:10` explicitly retains -1 as an unsafe override. Neither UI nor that historical evidence is authorization to keep the defect; both require an explicit migration decision rather than claiming unlimited mode never existed.

The issue's whole-memory-exhaustion statement is not proved by this read-only work. Current `QueueLimiter.ts:14-17` still considers global memory spill independently of the local limit; `test/unit/util/QueueLimiter.test.ts:24-35` covers local -1 with global spill. `SocketHandler.ts:774-779` also retains a per-handler file-cache policy. Local pause suppression is directly supported by code; it must not be described as absence of all global/cache protections. ADR-006 (`00-2.tech-decisions.md:54-60`) favors session containment with global quota as a final safeguard.

`TTTServer.ts:121-125` applies the same less-than-one conversion to the separate client limit. That related policy is outside a server-only fix unless separately authorized. SocketHandler's internal -1 is also used outside this configuration path; changing that primitive globally is unnecessary and would expand scope into unrelated consumers.

## Proposed minimum and decisions

Propose server configuration validation requiring a finite numeric value **at least 1 MiB**, with omission still normalized to 8. Do not require integer values without a separate reason: fractions at or above 1 already produce finite byte limits. Reject zero, negative values (including the documented -1 override), sub-one fractions and non-number/non-finite values with an ordinary validation result. This is a proposed intentional compatibility break, not an already approved policy. A new unlimited enum/flag is unnecessary to repair #40 and is not proposed.

Minimum likely production scope: `ServerOptionStore.ts` plus the server input/description in `TunnelOptionSetLayout.svelte`; dedicated store/API/browser tests and a small configuration migration note. Reuse `verificationTunnelingOption`, prepared candidate validation and the existing API failure envelope rather than duplicate validation in AdminServer. Preserve client field semantics and distinguish its help text if only the server field changes. No ExternalPortServerPool, SocketHandler, EOF, wire, or #29 changes are proposed.

There is a separate startup hazard to decide before implementation: `ServerOptionStore.ts:257-277` uses the same verifier for existing YAML, while constructor lines 227-231 replaces an invalid loaded file with defaults and saves it. Simply tightening the shared verifier can overwrite an existing configuration containing zero/-1. The implementation must not silently do that. Root must select and review a bounded legacy-load migration/rejection behavior that preserves the original file, or assign the necessary startup handling scope; silently exempting legacy zero would leave the file-input issue unresolved. No startup behavior change is authorized by this research.

## Proposed real RED and controls

1. Owned temp-root store tests: submit server 0, -1, a sub-one positive fraction and invalid numeric forms through existing candidate composition. Assert failure and unchanged actual YAML, revision and previous row. Controls: omitted=8, 1 and a finite fraction above 1 preserved; client policy unchanged. These assertions should fail on current source before implementation.
2. Existing `withConfigurationServer` real HTTP fixture: authenticated ordinary and compound saves with current revision and server zero must fail through the existing validation envelope, with actual config/certificate files, applied snapshot, revision/pending state and existing listener retained. A following valid save proves queue progress. Reuse #35/#37/#71 fixtures rather than new DI or a runtime mock.
3. Owned existing-YAML fixture: snapshot bytes with zero/-1, construct/load the real store and assert the explicitly approved rejection/migration outcome plus original-file preservation. RED must precede any startup adjustment; never use user configuration paths.
4. Browser regression against owned admin fixture: server zero cannot be submitted as a successful saved setting; server help no longer advertises unlimited while the client control retains its existing policy. Do not silently clamp a typed zero into a successful different value unless explicitly approved.
5. Positive-value consumer control may observe an actual accepted owned loopback handler's configured finite byte limit using existing lifecycle fixtures. It does not require editing the pool. A slow-reader pause/resume experiment is optional additional evidence with bounded payload/timeout and cleanup; do not claim a memory-exhaustion or throughput result from metadata alone.

After approved RED and minimal fix: targeted store/API/UI regressions, existing resource-policy controls and forced build, then two independent reviews. All listeners, children and files must be owned by the fixture and naturally cleaned up. No commands above have been run in this research task.

## Current decision audit (main df11da6)

Status: read-only audit; original issue and current source checked. No user selection between finite-only and explicit-risk unlimited was found in the supplied session or current execution record. Original issue recommends rejecting accidental zero but leaves intentional unlimited behavior open; historical unsafe overrides are compatibility evidence, not a current policy selection.

- [x] Update prerequisite fact. Status: approved72 now provides readServerOption readiness admission (ServerApp.ts75), non-ready mutation guards and existing-file preservation. The earlier paragraph describing constructor overwrite is historical and no longer a missing prerequisite. Reuse this infrastructure; no new ServerApp write scope is needed for the finite-only option.
- [x] Confirm remaining gap. Status: ServerOptionStore.ts406 still defaults omission to8 and accepts zero/sub-one inputs; ExternalPortServerPool.ts342 maps below1 to internal-1; UI still advertises unlimited. Global spill/file safeguards remain separate; no claim of total protection removal.
- [ ] Select server-buffer policy. Status: recommend finite numeric minimum1MiB, omitted8, valid fractions>=1 retained; invalid existing YAML is refused while original bytes remain untouched through72. Alternative: permit intentional unlimited only through a new explicit off-by-default risk setting, never accidental numeric0. The alternative changes schema/UI/migration and requires separately scoped propagation; current internal-1 is not sufficient authorization. No selection made.
- [ ] Freeze implementation/TDD after selection. Status: finite-only minimum scope ServerOptionStore validation and server input/help in TunnelOptionSetLayout; reuse ordinary/compound mutation rejection and72 startup refusal. Actual owned store/API/browser RED for0,-1,sub-one/nonfinite/type errors and file/revision/listener preservation; positive1/8/fraction and unchanged client-limit controls. No global SocketHandler semantic rewrite, client buffer policy change or29 EOF work.

#28 and finite-only #40 have disjoint expected production files and can be prepared independently after policy choices; serialize shared main integration and any heavy verification. Explicit-risk #40 needs a fresh overlap audit if shared types/consumers enter scope. Both remain separate from #29 hold.
