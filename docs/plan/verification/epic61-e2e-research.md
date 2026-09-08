# E2E prerequisites — #48 → #54 → #47 → #53

Status: #48 complete3990; exact #54 API independently PASS/root approved and assigned fix_supply15/listeners fix/epic61-multi-client-harness at eb546cd. Only tunnelHarness.ts and dedicated tests/fixture/ledger54; network.ts read-only, actual RED before behavior edits. #47/#53 later separate gates; current progress SSOT is execution plan.

- [x] Read original48/54/47/53 and current helper/data paths. Status: concrete findings below.
- [x] Separate readiness, byte fidelity, multiple owners and protocol/cache evidence. Status: proposed serial order below.
- [x] Identify policy dependencies and independent finite scopes. Status: #18/#28/#29/#40 are not blanket blockers.
- [ ] Independently review/freeze first-stage API and writable files. Status: pending.
- [x] Execute/review/integrate #48. Status: complete3990; successors #54/#47/#53 remain separately gated.

## Current reusable paths and gaps

Original issues: [#48](https://github.com/ice3x2/TTTGate/issues/48), [#54](https://github.com/ice3x2/TTTGate/issues/54), [#47](https://github.com/ice3x2/TTTGate/issues/47), [#53](https://github.com/ice3x2/TTTGate/issues/53).

`test/helpers/tunnelHarness.ts:169-180` wraps the complete sendTcpAndReceive call and byte comparison in waitFor; `network.ts:99-116` catches any error and repeats. Thus a corrupt first payload can disappear behind a later successful connection. Separately, `network.ts:67-80` resolves as soon as length reaches expected and slices excess bytes away; merely removing retry is not proof of byte-exact once-only delivery. The low-level helper has no own wall-clock deadline. Preserve these findings separately; do not claim they are new production transport bugs.

The harness hardcodes one client option/TTTClient variable, one trusted identity and readiness `statuses.length === 1`; startup and shutdown also own only that client/echo server. Its existing override objects are useful configuration inputs, but do not by themselves create multiple real clients/endpoints. `waitFor` may remain for readiness polling, but expected not-ready state should use explicit predicates/results rather than normal exception-driven flow in new code. No payload transmission belongs inside readiness polling.

Reuse `createTestRoot/applyTestRoot/cleanupTestRoot`, native scheduler through TTTClientRuntimeRegistry, actual TTTServer/TTTClient and existing certificate helper. ResourceStats records global memory/file-cache counters and directory sizes; a nonzero file size alone may be preallocation and is not proof of bytes spilled/read back. Per-handler pendingFileCacheBytes and delegating actual FileCache write/read observations can supply concrete lifecycle evidence. #19/#20 already repaired cached reads/identity, #42 retained initial bytes, #24 local data teardown and #25 client-owner callbacks; E2E tests should exercise their integrated paths instead of implementing duplicates.

Recent HTTP component tests (#11/#12/#30/#31/#32/#33) exercise real HttpHandler sockets and Node HTTP completion. They do not traverse authenticated tunnel control/data plus TTTClient endpoint forwarding, so they cannot alone satisfy #47. The old issue's claim that no test references FileCache is historical; current cache tests exist, but that does not prove a large payload crossed the complete tunnel and used the cache.

## #48 first: readiness and one actual exchange

Minimum candidate ownership: tunnelHarness.ts and, only as needed for a correct bounded byte result, network.ts; dedicated regression/driver and ledger48. Keep legacy helper callers in mind before changing a shared network helper. Prefer a narrowly named one-attempt exchange used by the tunnel harness if a changed return/closure contract would affect unrelated suites. No production writer initially.

Root-proposed exact API: `sendTcpAndReceiveOnce({host, port, payload, timeoutMs}): Promise<Buffer>`.
Wait for identity-specific actual control readiness separately, then initiate one
data connection and one payload write. Accumulate all response bytes until the
peer's actual `end` event; return the complete Buffer without expected-prefix
truncation. The helper has no expected-response argument and does not classify
content mismatches. Its harness caller compares the entire result with expected
using Buffer.equals and fails on mismatch or extras, without retry. Close before
end, socket error and the owned wall-clock deadline reject; release the owned timer
and socket on every outcome. A response prefix or quiet sleep never proves completion.

Add only a narrow opt-in finite-response mode to the existing owned echo fixture:
accumulate the declared expected request length, then end(response), rather than
echoing each received chunk forever. Keep existing helper callers' echo semantics
unchanged. The response and connection/request counters belong to that owned
fixture. Actual peer FIN must reach this TCP test consumer; this is not HTTP
endResponseInput or a #29 EOF/pool workaround. If real tunnel FIN behavior prevents
the approved contract, retain that RED and request separate production scope before
any runtime edit. No wire count/layout change is proposed.

Readiness polling may retry identity observation only, never payload transmission.
Initial writable proposal is network.ts, necessary tunnelHarness/owned echo-fixture
hunks, dedicated contract tests/driver and ledger48. No production changes until
their own actual RED and separate approval.

Actual RED: an owned endpoint records connection/request counts, deliberately corrupts or truncates only the first exchange and would answer correctly on a second. Current harness retries and passes; the new harness caller must reject that first completed result and counts remain one. Add an actual expected-prefix-plus-extra response followed by FIN: helper returns every byte and caller rejects equality. A peer that sends a plausible complete prefix but never ends must fail by deadline, not resolve. Also require close-without-end/error and normal full-response/FIN controls with cleanup. Fault behavior is a deliberate fixture, not discovered production corruption. Positive control waits for genuine authenticated readiness then completes exact bytes once. Reconnect tests await the new control owner before beginning their single payload attempt; never resend until success.

## #54 second: multiple real clients and owner isolation

Status: root froze the exact API/fixture policies below; independent rereview and
branch/implementation assignment pending. No source/test execution or test creation.

After #48 integration, extend the same harness with a small explicit list of client identities/options and endpoint/tunnel mappings, preserving the existing one-client default. Register all trusted identities and own all TTTClient instances/endpoints. Readiness verifies the requested identity set, not just a total count that could be satisfied by the wrong clients. Expose a bounded per-client stop and per-tunnel one-shot exchange, not a generic scenario framework. Proposed writes remain helper plus dedicated tests/ledger; unrelated shared production stays read-only.

RED contract before changing helper: request two distinct clients and two explicitly ACL-routed forward ports, observe actual authenticated identities and endpoint markers; current single-client harness cannot satisfy this. Concurrent A/B payloads must reach only their endpoints with exact independent counts/hashes. Stop A while B has a live session and verify B's control/handler identity, queued bytes where observable and one-shot exchange survive; no global restart or reconfiguration of shared registries between A and B. Real native A cleanup must occur before final fixture disposal. Treat existing #24/#25 failure disclosures as regressions to reuse, not permission to broaden lifecycle code.

### Exact proposed helper API and compatibility

Initial production write set is empty. Freeze test writes to
`test/helpers/tunnelHarness.ts`, a dedicated multi-client test/fixture and ledger54.
`network.ts` is read-only reuse of integrated sendTcpAndReceiveOnce and the existing
finite echo mode; amend scope first if a proven fixture limitation requires a change.
`runtime.ts`, resourceStats, certificate helpers and production lifecycle remain
read-only. Do not duplicate the tunnel harness or add a general scenario framework.

```ts
type HarnessClientSpec = {
    clientId: string;
    clientSecret: string;
    name?: string;
    clientOptionOverride?: Partial<ClientOption>;
    tunnelingOptionOverride?: Partial<TunnelingOption>;
};
// Add to existing TunnelHarnessOptions:
clients?: HarnessClientSpec[];

// Add to existing TunnelHarness:
clients: ReadonlyArray<{clientId: string; forwardPort: number; endpointPort: number}>;
stopClient(clientId: string): Promise<void>;
// Extend existing signatures compatibly:
waitForClientOnline(expectedClientIds?: readonly string[]): Promise<void>;
sendAndReceive(payload: Buffer | string, clientId?: string): Promise<Buffer>;
```

Omitting clients preserves the current one-client construction, top-level overrides,
rootDir/serverPort/forwardPort, start/restartServer/shutdown/dispose/getServer/
collectResourceStats signatures and behavior. Existing callers need no migration.
The legacy forwardPort field remains an alias to the first mapping's forward-port
metadata only; it is not permission to choose a first client implicitly for a
multi-client operation. Omitting the send target is allowed only when clients is
omitted (legacy single mode) or contains exactly one explicit spec. With two or
more specs, sendAndReceive requires clientId, even after all but one member stop.
Unknown or intentionally stopped targets are rejected; no fallback to the first,
remaining or newly connected identity is permitted.
Explicit clients must be nonempty with unique nonempty IDs/secrets, and own one
distinct default echo endpoint plus one forward option per spec. For this first
stage, reject conflicting clientId/clientSecret/name fields in per-client overrides
and ambiguous mixing of clients with old top-level clientName/clientOptionOverride/
tunnelingOptionOverride instead of silently changing precedence. Common scalar
serverOptionOverride fields remain usable; reject explicit trustedClients or
tunnelingOptions replacement alongside clients, because that could silently erase
the advertised identity/ACL mapping. These are fixture input-contract failures,
not changes to production configuration policy. These multi-mode restrictions
and the target-selection rule above
are now root-approved test-fixture policy, not production API/configuration policy.

Each declared ID maps to its own resolved client option, TTTClient reference, owned
endpoint and tunnel forward port. The default ACL is exactly allowedClientIds:[id],
with no name fallback. In multi mode, per-client tunnel overrides must not override
that allowedClientIds mapping or add a conflicting allowedClientNames selector;
tests should fail unsupported conflicting fixture input rather than publish a
misleading mapping. Destination override still supports a test-owned distinct
endpoint; that external fixture owns its disposal, while the harness disposes its
own default echo. Exposed mapping is detached metadata, not mutable arrays or a
public registry of raw instances. Controlled identity/queue observations may use
existing getServer and disclosed test-only private snapshots.

start creates the common server, starts every configured client, and waits for the
exact authenticated clientId set returned by actual server.clientStatus. Duplicate,
missing or unexpected IDs do not count as readiness. The default expected set is
all clients not explicitly stopped; a supplied set permits bounded phase checks
without transmitting payload. Poll a boolean/state predicate with a deadline;
avoid normal not-ready exceptions and never repeat exchanges inside that poll.
No separate public startClient API is needed for #54: start starts the declared
set, stopClient stops a member, and server restart uses the existing client-native
reconnect mechanism for remaining members. Restart must not revive a stopped member.

stopClient marks the member intentionally stopped before calling its actual stop,
then waits for that identity's control removal; it does not dispose the server,
other clients, global runtime state or shared endpoint mappings. Repeated stop is
idempotent; unknown IDs are explicit fixture misuse, never an instruction to stop
all clients. B must retain its genuine control/data ownership and remain usable.
Whole shutdown marks every member stopped, stops each once, closes server and owned
endpoints; dispose then cleans the single root. No registry reset occurs per client.

sendAndReceive selects the declared member, configures only its owned echo's finite
request length, performs exactly one #48 sendTcpAndReceiveOnce on that forward port,
and compares the entire FIN-completed Buffer. Do not fallback to a different client
or resend after corruption. Simultaneous exchanges are supported across different
members; same-member overlapping calls with different finite lengths are outside
this initial fixture contract and must not be claimed supported. The sender socket
is owned/settled by the existing once helper, with no second prefix-only path.

### Root-frozen result and misuse contract

Preserve the existing Promise-based helper API; add no result framework or new
exception-driven routing. createTunnelHarness returns its existing Promise of a
harness, while invalid explicit fixture configuration rejects with a bounded Error
before allocating resources. Validate configuration with ordinary conditions.
sendAndReceive returns Promise<Buffer> on the selected client's exact full response;
missing ID in explicit multi mode, unknown ID or stopped target rejects that
Promise with a specific bounded Error before connection or payload write. The
same existing rejection contract carries actual mismatch/network/deadline failure;
none is caught to select another client or retry data. These Errors signal test
programmer misuse or failed verification, not normal not-ready control flow.

stopClient resolves Promise<void> once that declared identity has stopped; repeated
stop of the same known member resolves without repeating native stop. An unknown
ID rejects with a bounded Error before affecting any owner. waitForClientOnline
rejects invalid requested IDs before polling, otherwise observes readiness via
explicit predicates and resolves only on the required actual identity set; its
bounded deadline rejects instead of manufacturing readiness. Deliberately stopped
IDs cannot be requested as ready without a separately approved restart API, which
is not proposed. Lifecycle cleanup handles real failures with context and preserves
the original failure; this is not a catch-based normal identity-selection loop.

Root approves the remaining bounded ownership design: one shared server/root,
distinct per-client actual endpoint/client/ACL mapping, exact authenticated ID set,
local stop that cannot reset B, stopped-owner exclusion on server restart, and
partial-start cleanup of every resource registered immediately at creation.
This is design approval only; independent rereview, root branch assignment and
actual RED still precede helper/source changes.

### Partial startup and exact RED fixtures

Register resources for cleanup immediately as each root/endpoint/server/client is
created, including before async start completes. If creation or start fails before
the caller receives a usable harness, clean all resources created so far, restore
the single runtime root state, and propagate the original failure; report cleanup
failure as well rather than suppressing it. Do not mark shutdown complete before
all ownership is accounted for. A successfully returned harness still supports
idempotent dispose after failed start or stop. Use existing close/stop APIs and
natural exit, not broad process termination.

Mandatory tests before helper behavior changes:

1. Two specs A/B with different actual client IDs, forward ports and owned endpoint
   ports; observe exact authenticated set and ACL rows. Old one-client construction
   cannot fulfill the requested mapping/readiness. Keep single-default baseline
   test unchanged as a compatibility control. Invalid/conflicting fixture options
   need focused contract RED before enforcing the new multi-only restrictions.
   Explicit multi missing ID, unknown ID and stopped ID must each reject before
   any endpoint accept/write; legacy implicit and explicit-singleton omission stay
   successful. Keep the first forwardPort metadata alias separately asserted so
   compatibility cannot accidentally restore implicit multi target selection.
2. Each endpoint records exact accepted connection/request payload and returns its
   finite response with FIN. Send different A/B markers once concurrently; assert
   exact destination/count/bytes. A deliberately corrupted first response that
   would pass on a second attempt must still fail with one request (#48 preserved).
3. Keep a real B session open through a disclosed endpoint response-release barrier,
   stop only A and observe A actual control removal, then B's unchanged authenticated
   control/handler and exact one-shot response after release. A separate live B echo
   can be used only within the declared non-overlap constraint (release the first
   exchange first). Also exercise a later B exchange and idempotent stop/dispose.
4. Inject a clearly identified setup/start failure after one real endpoint/client
   has been created, then assert that actual listener ports no longer accept and
   owned client/server/socket state is terminal, including paths where the factory
   itself rejects. This is a declared failure-boundary test, not an OS fault claim.
   Preserve the original injected error and final resource facts. A failed helper
   setup is not a successful E2E result.

Use real client and endpoint events before final cleanup as acceptance evidence;
post-dispose zeros alone cannot prove A/B isolation. Configure a positive existing
TTL beyond the bounded observation and retain default #23 keepalive semantics or
explicit0 only where already supported. No fake counters, manual reconnect,
producer changes, new global clock or Node process kill is needed. Any runtime
failure uncovered remains a separate approval boundary before production edits.

## #47 third: complete HTTP/TLS and mixed finite modes

Reuse multi-owner mapping and one-shot fidelity helpers. Add owned actual HTTP/1.1 endpoint servers and raw finite responses where necessary; external requests traverse public forwarding listener → server data/control → real TTTClient → endpoint and back. Assert endpoint-observed method/Host/body and Node client status/headers/decoded body/end/complete. Start with finite CL and chunked, keep-alive two-request contexts, HTTP mode and TCP mode simultaneously. #30 codec/component proof remains distinct from full-tunnel proof.

TLS must specify which legs are exercised: encrypted control/data channels, encrypted public listener and/or TLS internal endpoint are different contracts. Existing `generateSelfSignedCert` issues localhost/127.0.0.1 SAN certificates; reuse it and actual CertificationStore/option APIs. Positive peers trust that exact test CA with hostname verification on; assert actual secure connection/authorized peer plus bytes, and include a wrong-CA or wrong-host negative control with no plaintext fallback. Do not set blanket rejectUnauthorized=false or label a tls:true option assertion as a completed TLS handshake. Internal TLS endpoint verification may reveal a distinct production policy issue; report rather than silently weaken or expand scope.

Server restart is a distinct phase: existing session terminal/cleanup must be observed, then existing scheduler reconnect readiness and a new one-shot request succeed. Do not require an in-flight payload to survive restart unless an existing requirement guarantees that; do not hide its interruption with resend. Any new test that passes existing source is coverage strengthening, not a fabricated production RED. Missing capability/weak mutation controls must be described honestly.

## #53 fourth: real large transfer, spill and recovery

Use a bounded deterministic payload in the tens of MiB (for example32MiB), incremental hashing and exact total received bytes; keep it well below4GiB. Transmit once through the actual tunnel. Sender and receiver hash/length must match, including first/tail markers. Schedule explicit writes across owned buffers without claiming TCP write boundaries equal receive segments.

Use positive supported per-session buffer sizes (for example1MiB) and an explicitly bounded positive global budget through existing options, not zero/-1. Pause an owned receiving peer and release it on an observed condition, with a deadline/failure exit, so genuine backpressure/cache spill occurs. Record real per-handler/global cached-byte high-water values plus delegated successful FileCache writes/reads and a file under the owned cache root. Require nonzero spill before releasing the reader; otherwise the test has not exercised spill and must fail rather than report payload size alone as evidence. Do not fabricate counters, inject QueueLimiter success or reduce production limits.

After release, verify exact one-shot hash/length and resource counters return to the recorded baseline, with no owned sessions/queued cache bytes left. Check before whole fixture teardown so cleanup does not hide a live leak. File blocks may remain allocated until existing disposal; distinguish logical cached bytes from allocated disk length and verify actual deletion only at its defined lifecycle. Run a small sibling exchange during pressure to assess isolation, and a later one after recovery. RSS/handle counts are diagnostics, not deterministic leak proof by themselves. Instrumentation calls must delegate the real storage operation; an injected read failure is a separate recovery test, not successful-spill evidence.

## Dependencies, limits and execution ownership

| Pending work | What can proceed independently | What remains excluded |
| --- | --- | --- |
| #18 TTL | Use an existing positive TTL longer than each bounded active exchange; record elapsed/activity and prove no timeout masked cleanup. | Disabled/new-default TTL semantics until separately approved/integrated. |
| #28 close count | Finite payloads and total per-session counts comfortably below4GiB, using unchanged encoding. | Overflow/4GiB policy or widened wire fields. |
| #29 EOF hold | HTTP/1.1 explicit CL/chunked and their actual end/complete; raw TCP owned completion is a distinct transport fixture. | Close-delimited HTTP response completion, held UI/pool edits or alternate-route bypass. |
| #40 buffer policy | Explicit currently valid positive limits and positive cache budgets. | Deciding zero/unlimited migration or changing option validation. |

Serial helper ownership is #48→#54→#47→#53, with separate ledgers, actual preimplementation RED for behavior changes, independent review/fixer loops and integration gates before successors. An existing passing E2E test can supply evidence; no invented RED is needed merely to add coverage. Initial writes are tests/helpers/fixtures only; a real production failure requires root-approved exact additional scope before edits. No parallel writers to tunnelHarness/network/global test runtime state. Other disjoint work can continue, but resource-heavy #53 should run without another heavy benchmark/build load and must record actual conditions without claiming an isolated host by assumption.

All resources belong to fresh owned roots and loopback listeners, with tracked callbacks/sockets/clients/server and bounded teardown. Preserve actual failed receipts and injected-fault provenance. No node.exe-wide termination: only exact current-task PID plus current command line/ownership can justify terminating a child. No benchmark, denied-path cleanup, code change or test execution was performed for this research. Root must freeze the first helper API and assign a branch before any execution.

## Current #48 assignment boundary

- [x] Root approve exact API and create first-stage branch. Status: independent exact API PASS; fix_supply15/listeners fix/epic61-roundtrip-once at61f60f1.
- [x] Freeze #48 paths and observe RED before edits. Status: completed; exact execution and two-path command correction retained in ledger48.

## Current #54 assignment

- [x] Root approve exact multi-client API and create branch. Status: fix_supply15/listeners fix/epic61-multi-client-harness at eb546cd assigned after independent API PASS.
- [ ] Observe assignment then actual multi-client and partial-startup RED. Status: required before harness edits; exact clients[]/identity/detached-map/stopClient/alias/option-conflict contract above and actual two-endpoint/ACL/held-sibling/no-revive/finite-once checks remain mandatory. No network helper or production writes.
