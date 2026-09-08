# Session lifecycle research (#24 -> #25 -> #23 -> #18)

Status: independent design PASS and root approved only #24; owner fix_supply15, branch fix/epic61-data-terminal, base35a5d5f. Exact scope: TunnelClient.ts and dedicated tests/fixture/ledger24 only; successors25/23/18 require separate gates. Original research below is historical; current progress SSOT is execution plan.
review and implementation assignment after the joint #45/#46 milestone. No source, server, test or timing run executed.
Researcher review_cert_conflict; initial inspection main `07c083d`; ownership paths
rechecked on current main `35a5d5f` including the #46 metadata changes.
Original issues #18/#23/#24/#25 were read. #45 control-owner work is distinguished
from remaining client-generation ownership below.

- [x] Read original issues and current timer/socket/callback owners. Status: findings below.
- [x] Identify reusable APIs and real short-duration verification boundaries. Status: proposed, not executed.
- [x] Root freeze #18/#23 operator defaults/disable semantics and serial order. Status: approved policy below; #24 -> #25 -> #23 -> #18, after joint #45/#46 completion. Detailed source assignment remains separate.
- [ ] Assign one serial lifecycle owner after the #45/#46 shared-file milestone. Status: pending.
- [ ] Observe each issue's actual RED before implementation, independently review and integrate serially. Status: unassigned; no subsequent issue or policy gate is released by this document.

## Current behavior and distinct clocks

TunnelServer's session TTL defaults to 60000 ms. configureSessionTtl permits only
1000..3600000 ms and checks an explicit scan interval of 100..60000 ms below the
TTL. The unref'd timer uses real Date.now and stops on server close. Activity is
recorded at session open, data send and the shared data receive path (including
#42's admitted initial payload). Native TCP keepalive probes are not application
payload events and therefore do not refresh this map. The timer is idle-session
eviction, not a wire heartbeat, despite the existing heartbeat naming/comments.

ClientApp's startup object and the shared normalizationClientOption in
types/TunnelingOption.ts both default client keepAlive to 0. The normalizer's
negative-value comment says -1, but actual code warns and uses DEFAULT_CLIENT_KEEP_ALIVE
(currently 0). TunnelClient.connect explicitly adds the option to control ConnectOpt;
makeConnectOpt used for data channels omits it. TlsOptionsFactory consequently
disables control keepalive for 0 while missing data keepalive receives its 60000-ms
fallback. Server TCPServer's 10000-ms default is another initial-delay setting,
not a promise that a silent network outage is detected within exactly ten seconds.

TunnelClient's data connection callback handles Connected/Receive only. Its
existing deleteDataHandler/terminateEndPointSession/clearWaitBuffer operations can
release maps/accounting and notify the upper endpoint owner, but native End/Closed
and connect failure do not consistently reach them. SocketHandler maps actual I/O
errors into its terminal event; no new synthetic error enum is needed.

At main07c083d, #45 already checks the control SocketHandler identity inside one
TunnelClient and funnels owned terminal/framing failure through closeControlHandler.
It clears data/wait queues and notifies the upper owner once. This is NOT the
#25 boundary: TTTClient.onCtrlStateCallback still ignores its originating `client`
argument, start replaces its TunnelClient/EndPointClientPool, and old callbacks can
target the new objects. failHandshake still reports closed before native termination.
Endpoint callbacks also lack originating-owner arguments; EndPointClientPool's
setImmediate termination callback can outlive disposal. Merely replaying an old
SocketHandler terminal already rejected by #45 does not reproduce the remaining #25.

## #18: operator-controlled session idle lifetime

Root-frozen contract: server option `sessionTtlMs`, milliseconds, default 3600000.
Only 0 disables expiry; negative and nonfinite values are rejected, positive values
retain the existing 1000..3600000 range. Expose through configuration file and admin
API. No UI widget, new heartbeat or expanded control-packet activity tracking.
Existing lastActivity timestamps survive policy changes; positive policies take
effect at the next scan, so already-idle live sessions may expire then. Disabling or
restoring a policy does not resurrect terminated sessions. This is unrelated to
#40's buffer policy.

Proposed minimal source set: server option declaration/normalizer, TunnelServer
TTL configuration, TTTServer's option propagation/effective-state snapshot and
restore, and only necessary AdminServer apply classification, plus dedicated tests
and configuration guidance. File/API exposure can satisfy operator adjustment;
an admin UI widget is excluded. Reuse configureSessionTtl,
markSessionActivity and existing timer start/stop rather than introducing a scheduler.

#35/#71/#37 still govern publication and rollback. Changing TTL alone must not
restart unrelated listeners/control. Capture the actual effective TTL/check policy,
not just the latest committed candidate; a failed later apply restores that policy
with acknowledged pending state intact. Validate user values through the existing
configuration result path, retaining original invalid files on rejected load/write.
New programmatic disable semantics require deliberate updates to the old 0-rejection
test while preserving remaining invalid-range controls.

Effective scan policy is part of rollback, not just sessionTtlMs. Preserve the
existing explicit interval validation (100..60000 ms, below a positive TTL).
For 0, stop the timer while retaining the last valid effective scan interval; on
re-enable start the timer even if none currently exists. Only for a positive TTL with an implicit interval, reuse a valid retained interval
or lower it below that TTL when necessary within the existing scan bounds. An
explicit invalid interval remains rejected rather than silently clamped. Snapshot and restore the resulting effective pair,
including disabled timer state, through #35/#71 committed/applied/pending recovery.
TTL-only apply must retain listener and control identities. API/config input uses
explicit validation; the established direct configureSessionTtl invalid-call
RangeError contract is retained without using throws as normal config control flow.

- [ ] #18 RED/default propagation. Status: planned; verify approved absent/default/explicit/disable/range values in actual config and effective runtime, on startup and hot apply, with rejected writes and rollback. Cover positive -> 0 -> positive, rollback of effective scan policy, original invalid-file preservation, and unchanged listener identities. Do not claim one-hour survival from a numeric default assertion.
- [ ] #18 real idle tests. Status: planned; existing configureSessionTtl(1000,200) provides a short real timer. Keep a live owned TCP echo socket open: idle expiration must occur, actual data before expiry must refresh activity, and an approved disabled policy must preserve the socket beyond the previously configured deadline and permit later echo. Observe real timer/socket/state conditions, not a fake clock or sleep-only PASS.
- [ ] #18 shutdown/failed apply. Status: planned; timer stops at owned server shutdown, no stale scan affects replacement state, and pending/config/effective timer policy survive approved failure recovery. Existing test/helpers and post-apply fault pattern are reused and disclosed.

## #23: consistent native keepalive defaults and propagation

Root-frozen contract: one shared default 10000 ms on both control and data
connections. Explicit 0 disables both. Negative input warns and falls back to the
shared default. Correct ClientApp's existing disabled-keepalive warning so normal
positive startup no longer reports keepalive disabled; explicit 0 still reflects
actual disabled behavior. This is a native probe initial delay, not a promised
blackhole detection deadline. TLS verification remains unchanged.

Proposed minimal source set: ClientApp startup default, shared client normalization
constant and TunnelClient.makeConnectOpt/control override, with focused tests/docs.
Reuse one shared default; avoid two new literals or changing unrelated memory/port
normalization. The normal startup and direct/programmatic omitted-option contract
must be explicit. TlsOptionsFactory and SocketHandler need no initial writes: they
already accept the setting. Test control and data connections, not only the former.

- [ ] #23 RED through actual default/explicit startup and connections. Status: planned; an observer delegates the existing TlsOptionsFactory while actual owned sockets connect/authenticate/open a data channel. Assert real options passed to native creation on both paths; retain TLS/explicit-value controls. The current keepalive test replaces SocketHandler.connect and is not real transport evidence.
- [ ] Separate settings from outage claims. Status: planned; a real FIN/RST proves terminal/reconnect behavior, not keepalive blackhole detection. A paused Node stream or silent echo server still has a live kernel TCP connection. Existing APIs do not provide a portable few-second proof of packet loss without FIN/RST; any actual packet-drop/network-isolation fixture needs separate ownership/platform approval. Do not modify global firewall/routes, unplug a host, fake a clock or call socket.setTimeout to manufacture keepalive success.

## #24: one data-handler termination without global reconnect

Initial production scope: TunnelClient data connection/terminal cleanup only,
dedicated tests and ledger. Reuse deleteDataHandler, clearWaitBuffer and existing
endpoint-close/control-notification callbacks; expand TTTClient/EndPointClientPool
only if an actual RED proves a missing propagation boundary. Preserve existing
small-byte close/drain semantics and notify only the failing session. No #28 count
encoding or #29 HTTP EOF consumer change is needed.

### #24 exact internal ownership/API proposal

At main35a5d5f, `connectDataHandler(handlerID: number, sessionID: number,
bindingToken?: string): void` registers in the active map only on Connected
(TunnelClient.ts:407). `deleteDataHandler(handler: TunnelDataHandler): void`
(TunnelClient.ts:241) currently deletes by session ID, clears bytes, calls
`_onEndPointCloseCallback(sessionID, 0)`, then destroys. `terminateEndPointSession`
(TunnelClient.ts:232) is the upper endpoint's later acknowledgement. Preserve these
existing signatures and callback types; no shared type, wire or consumer edits.

Proposed additional private entry point, confined to TunnelClient:
`onDataHandlerTerminated(handler: TunnelDataHandler, sessionID: number,
handlerID: number): void`. Route both End and Closed through it. Capture IDs from
the existing connect request, not from a post-return variable. Before any callback
branch, initialize the callback handler's identity exactly as the current Connected
branch does; retain #14 synchronous-connect compatibility.

Keep a private pending-attempt owner per session, installed before calling
SocketHandler.connect, with its actual handler bound on the first callback (or
post-return fallback) and a settled flag. Connected transfers that same attempt to
the active map. A terminal is actionable only for the matching pending attempt or
matching active handler; a stale handler may destroy its own socket but cannot
clear a replacement's map, queue or endpoint. Compare the captured attempt identity
as well as handler identity when no handler has yet been published. Do not register
a pre-Connected failure as an active session to make cleanup appear successful.

Before cleanup, capture DataHandlerState, handlerID and sessionID from the owned
attempt/handler. Select the peer notification from this captured state, never by
looking up the map or reading the state after deleteDataHandler has changed them:

- pre-Connected / None / Initializing / ConnectingEndPoint: send the existing
  FailOfOpenSession packet via `CtrlPacket.resultOfOpenSession(handlerID, sessionID,
  false, {handlerID})` on the live control owner. Preserve wide handler ID metadata.
- OnlineSession: use the existing CloseSession producer/path and encoding.
- Already Terminated: perform any still-owned local cleanup without a duplicate
  peer notification.

On the first owned terminal, settle/remove ownership before invoking callbacks or
destroying, clear only its wait queue through clearWaitBuffer, mark Terminated and
notify the existing endpoint-close callback with `(sessionID, 0)` once. A failure
before Connected must reach this callback despite having no active map entry.
Local cleanup does not wait for packet send completion, a server ACK or a later
server CloseSession; capture the notification decision first and keep local cleanup
independent of those asynchronous outcomes. Repeated native terminal, server close
and endpoint acknowledgement must be idempotent. This native data-terminal contract
does not weaken existing small-byte/drain behavior or the explicit endpoint-close
path. Retain the independent held server CloseSession barrier described below so
server-driven cleanup cannot make a missing local branch appear correct.
Global destruction must invalidate/clear pending attempts as well as active
handlers, so later connect callbacks cannot republish an already-destroyed owner's
session.

The pending owner and helper are a concrete design proposal for independent API
review before source assignment, not an implemented or observed fix. Reuse the
existing deletion routine for cleanup instead of duplicating byte accounting;
identity checks must also protect its existing delayed send-failure callers.

### #24 actual failure isolation and completion barriers

Sibling ownership is explicitly within the same TunnelClient and authenticated
control connection: target session A and an unaffected active session must coexist
there. An echo through a separate client/control alone is not a substitute. Where
the greeting barrier permits, also retain a second real queued session B on that
same owner. Observe actual A greeting bytes (the existing 33-byte marker) and B's
own nonzero greeting bytes before A terminates; after A cleanup the aggregate must
equal B's unchanged bytes, B's queue/handler identities must remain, and B must
complete its normal ACK and echo with exact once-only greeting delivery. Continue
the same-owner active sibling echo as well. This is ownership evidence, not a new
buffer policy or permission to populate counters directly.


The real server observes a data-channel termination too and can send CloseSession
before the client-local fault assertion. Install a narrowly disclosed observer on
that actual authenticated server pool's control send path, holding only the target
session's CloseSession packet and its completion callback. Record held packet
count/identity; pass sibling and all other traffic through unchanged. Release the
held notification only after local cleanup/once-only notification assertions, then
verify that delayed server close causes no second cleanup. Do not claim the held
notification was delivered. Release or cancel owned held work in finally.

Use the existing positive configureSessionTtl with a TTL longer than the bounded
fault assertion window, record no TTL expiration during that window, and assert
same TTTClient/TunnelClient/control identity and no global reconnect before checking
healthy sibling echo. Those conditions prevent server cleanup, TTL and reconnect
from masking the local RED. Observe client data-terminal receipt before evaluating
cleanup. Assertions occur before fixture stop/dispose.

For nonzero pending bytes, reuse the real endpoint greeting plus held successful
open-result/ACK barrier from #45: observe actual received greeting bytes enter the
client wait queue, retain the queue reference and total, then end/reset only the
owned data socket while endpoint/control remain alive. Assert retained queue bytes
and contents become zero, map/total accounting and endpoint ownership clear, one
notification occurs, and released delayed work never replays old bytes. Do not
assign counters or create a queue directly. Separately exercise an online channel.
For pre-Connected failure, route only that data attempt to a newly owned TCP peer
which rejects TLS before secureConnect; retain the actual native handler and
confirm Connected was never emitted. Observe the negative result at the actual
server and the local once-only callback despite no active registration. Any factory
routing override delegates real socket creation and is disclosed as fault routing.
Same-session replacement/late-terminal controls must preserve the actual replacement
handler and its queue; synthetic callback replay may supplement actual transport
coverage but cannot replace it.

- [ ] #24 real data-only RED. Status: planned; keep authenticated control and a sibling echo alive while closing/resetting only one actual data channel. Require the failed session's data/endpoint sockets, map entries and real nonzero pending bytes to clear once, before TTL or global reconnect can mask leakage. Assert control identity remains unchanged and sibling echo continues.
- [ ] #24 initial connection failure/late terminal. Status: planned; an owned failed connection/TLS-handshake fixture must observe terminal-before-Connected without touching a foreign port. Disclose any delegate routing only that data attempt to the owned failure endpoint. Reuse actual connection-race tests; do not supply fake SocketHandlers as sole evidence.
- [ ] #24 pending-byte cleanup. Status: planned; reuse the reviewed #45 greeting-endpoint/control-result barrier pattern to create actual queued bytes, not counters assigned by the test. Preserve byte/drain/error visibility and test once-only close callbacks with actual terminal events.

## #25: TTTClient generation ownership and old callbacks

Proposed initial production scope: TTTClient lifecycle/callback wiring only, with
dedicated tests and ledger. Use the existing callback's client identity and captured
TunnelClient/EndPointClientPool object identities for callbacks that otherwise carry
only a session ID. Invalidate the old owner before disposing it; then publish/wire
the new owner before connecting. Reuse existing scheduler/stop/dispose paths, avoid
a generic generation framework, and ensure stop clears pending reconnect work.

Do not simply call old destroy while it still owns current callbacks: synchronous
terminal events could schedule another reconnect or dispose the newly published
endpoint pool. Guard both closed and connected notifications, and old endpoint/data
termination callbacks that otherwise target the new instance. Any required narrow
dispose callback change outside TTTClient needs explicit scope review after RED.

- [ ] #25 real generation RED. Status: planned; preserve a genuine old TunnelClient and its callback, let the existing real scheduler create/authenticate a replacement, then release an explicitly held old native terminal/callback after new echo succeeds. For the original handshake-failure case, use an owned peer/barrier to delay its native end after early failHandshake notification. Do not manually manufacture a replacement or claim #45's already-guarded old SocketHandler replay proves this case.
- [ ] #25 endpoint and timer controls. Status: planned; delayed old endpoint termination must not touch the new client's matching session, flags or pool. Confirm one reconnect, no old queue replay, actual new/sibling echo, old resource disposal and stop-before-reconnect cancellation. Use TTTClientRuntimeRegistry's existing short reconnect interval with its real scheduler; no fake-clock success or timeout inflation.

## Dependencies that can hide defects

Use one serial owner in the root-approved #24 -> #25 -> #23 -> #18 order after
the joint #45/#46 milestone. Each issue receives its own RED, review and integration
before the next issue begins. #18/#23 share option declarations; #23/#24
share TunnelClient, while #25 owns the upper lifecycle those callbacks reach.
Review/integrate each bounded change and retain separate RED, not a broad rewrite.

- [ ] Prevent TTL masking #24. Status: planned; set an existing positive TTL longer than the short data-fault observation window, without relying on the future #18 disabled policy. Assert cleanup before test teardown, not only after client.stop destroys everything.
- [ ] Prevent reconnect masking data-local failure. Status: planned; #24 keeps its control connection healthy; #23 probe settings and #25 global reconnect cannot substitute for session-local cleanup.
- [ ] Protect combined rollout. Status: planned; raising/disabling TTL can expose #24 leaks for longer. Do not use TTL as a leak workaround or claim operational lifecycle readiness until all relevant session cleanup controls pass.
- [ ] Respect shared-file dependencies. Status: planned; #45 handles control SocketHandler ownership, #46 handles metadata packet-local errors, and #25 still handles TTTClient generation. If a prior open defect blocks a later test, preserve that failing result and request a narrow dependency amendment instead of changing expected output or silently expanding scope.

All execution requires root assignment and observed RED first. Existing policy
APIs allow real short TTL/reconnect/data-terminal tests; they do not justify new
timeout defaults or empirical native keepalive detection claims. No statistical
timing benchmark is needed or authorized. #28 wire-count policy, held #29 action,
and #40 buffer/unlimited decision remain independent and untouched.

- [x] Address independent #24 state-to-peer-notification finding M1. Status: capture state/IDs before cleanup; all pre-online states use existing FailOfOpenSession, online uses existing CloseSession, already-Terminated sends no duplicate. Local cleanup does not wait for transmission/ACK. Source and test execution remain unassigned.

## Current bounded #24 assignment

- [x] Independent design review and root assignment. Status: approved; fix_supply15 on fix/epic61-data-terminal at35a5d5f; TunnelClient.ts and dedicated tests/fixture/ledger24 only; successors25/23/18 require separate gates.
- [ ] Observe actual RED before production changes and complete independent per-issue gates. Status: assigned; no successor approval follows automatically. Preserve all original state/ownership/security/test constraints above.
