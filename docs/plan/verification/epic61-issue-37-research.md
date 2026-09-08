# Issue #37 — Apply the normalized committed tunnel option

Status: independently rereviewed PASS by review_cert_conflict after M1 ownership clarification; root approved assignment after completed #38. Owner fix_supply15, listeners worktree, branch fix/epic61-normalized-apply, base 7c765a7. The operational count at this assignment checkpoint was 37/66; current progress is tracked in the execution plan. This research records no executed implementation/tests.
Researcher: review_wave0. Original issue: https://github.com/ice3x2/TTTGate/issues/37.

- [x] Read original issue and latest normalization/apply paths. Status: both ordinary and compound handlers still pass the unnormalized request to runtime.
- [x] Identify minimal reuse and recovery boundary. Status: recommendation below; no new normalization policy proposed.
- [x] Independently review and approve ownership/schedule. Status: review_cert_conflict rereview PASS; root approved the bounded AdminServer/test/ledger-only assignment after #38 integration.
- [ ] Create assigned ledger and observe both-path actual RED before implementation. Status: branch prepared and assigned above; actual RED remains mandatory.
- [ ] Implement minimum change, regress, independently review and integrate. Status: pending RED.

## Current source evidence

ServerOptionStore.composeServerOptionWithTunnelingOption clones the input, runs
verificationTunnelingOption, and replaces the matching row in a cloned server
option. That verifier defaults buffer limits to 8, keepAlive to -1, startup/ACL
values, destination ports (http 80 / https 443), and HTTPS TLS to true. It also
normalizes HTTP options, including the intentionally different new-config and
legacy-load CORS defaults. Do not replace or weaken that distinction.

AdminServer.onUpdateTunnelingOption commits the composed normalized option, but
its applyTunnelingOption call (around line 636) receives tunnelingOption from the
request. The newer applyCompoundTunnelingOption similarly batches/publishes the
prepared normalized row, then passes raw option to applyTunnelingOption (around
line 729). Both paths therefore need coverage; fixing only the original route
would leave #71 compound saves inconsistent.

TTTServer.applyTunnelingOption forwards nextOption into the actual pool start,
restores active status, sets ACL and records the applied snapshot. Pool start
uses TLS directly; constructor normalization does not normalize this hot-apply
call. Socket/keepAlive lower-level normalization is existing runtime behavior;
do not demand every effective OS value numerically equal its config sentinel.

## Minimum recommendation

Initially own only AdminServer.ts, dedicated tests/fixture and ledger37. Reuse the
matching normalized row in the prepared/committed server option for the target
port, inside the existing shared mutation queue. Pass that row to runtime in both
ordinary and compound flows. Keep previousOption from the actual prior snapshot
and keep the compound staged certificate argument. Existing getTunnelingOption
returns a clone and can avoid sharing mutable runtime references with committed
memory; prefer this reuse over a second normalizer or generic helper framework.

Do not reorder durable publication, memory publication or runtime compensation.
#35's committed candidate/current revision, actual applied LKG and pending-restart
tuple remains authoritative. #71's dual admission, rename source/target checks,
certificate batch and rollback must remain intact. Route #38 owns the same file,
so #37 implementation must wait for its reviewed integration and use a fresh base.
No ServerOptionStore, TTTServer, ExternalPortServerPool, HTTP parser, manifest or
wire edits are initially needed; expand only after concrete RED and scope review.

## Required actual RED before source changes

Reuse withConfigurationServer, real-file/fresh-TLS probes and compound test
helpers; do not prove this only with a spy on applyTunnelingOption arguments.

1. Ordinary authenticated save of protocol=https with tls omitted and an existing
   valid certificate. Verify persisted YAML and store say TLS=true, then require a
   fresh TLS handshake with that certificate on the hot-applied external port.
   On baseline, show the actual runtime mismatch; bounded handshake failure is
   a RED result, never accepted as success.
2. Repeat through the compound request with matching config/certificate tokens
   and supplied PEM, omitting tls. Assert matching persisted and freshly served
   certificate and normalized configuration. Preserve both-path RED before the
   shared source fix.
3. Omit destinationPort, buffer limits, keepAlive and HTTP-option defaults. This
   default-port case observes only the actual listener/session-bound option,
   captured applied snapshot or emitted control metadata against the normalized
   store row. Do not start an endpoint connection to the inferred 80/443 port.
   Use existing instrumentation only as observation, not a replacement runtime;
   distinguish config sentinels from effective lower-level socket values.
   Separate actual I/O and TLS cases use an explicitly allocated owned loopback
   service port. If a test specifically needs actual I/O on 80 or 443, first bind
   and own that exact loopback service successfully; never connect to an existing
   occupant. Bind failure is unavailable coverage, not a passing I/O assertion.
4. Explicit TCP tls=false and existing valid explicit values remain unchanged.
   Include initial save and edit/restart of an existing port. A reload/restart
   comparison must use an owned runtime and preserve TLS identity; do not claim
   process-restart evidence if only a store reload was exercised.
5. Inject the existing declared post-publication apply failure and verify #35's
   complete baseline tuple, pending values and actual prior listener/certificate
   recover. Include compound failure and retain existing #71 stale/invalid/token
   and #36 unsafe-name rejection regressions.

Use owned loopback ports/files/listeners and bounded waits; dispose all fixtures
and retain natural exit. Run the relevant normalization, rollback, compound TLS,
filename and routing tests plus forced build, then independent reviews. No full
new transport harness is needed. No experiment has run in this research phase.

## Policy and parallelism

This repairs propagation of existing normalization, not a new TLS/default policy.
It does not choose #28's unresolved 4 GiB compatibility behavior or touch #29's
platform-held EOF work. #41 ClientHandlerPool allocation and logger-only work are
disjoint in source, but all integration stays serial. Actual administrator writes
must remain serialized after #38; root has approved this #37 assignment only, not any successor. The preceding research recommendations and required RED boundaries remain the implementation contract.
