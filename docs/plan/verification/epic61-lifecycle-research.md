# Session lifecycle research (#24 -> #25 -> #23 -> #18)

Status: lifecycle24/25/23/18 complete; latest18 CLOSED2026-09-08T12:36:35Z/comment5585232482/Telegram3992(67/58), source9fe3728 -> remote-verified563795955855687f01f6644a8310278c764e42b8. Earlier design/assignment/RED-pending prose is historical; execution Status/Resume is current-progress SSOT.
At the initial research checkpoint, implementation assignment followed the joint #45/#46 milestone; that research performed no source, server, test or timing execution.
Researcher review_cert_conflict; initial inspection main `07c083d`; ownership paths
rechecked on current main `35a5d5f` including the #46 metadata changes.
Original issues #18/#23/#24/#25 were read. #45 control-owner work is distinguished
from remaining client-generation ownership below.

- [x] Read original issues and current timer/socket/callback owners. Status: findings below.
- [x] Identify reusable APIs and real short-duration verification boundaries. Status: proposed, not executed.
- [x] Root freeze #18/#23 operator defaults/disable semantics and serial order. Status: approved policy below; #24 -> #25 -> #23 -> #18, after joint #45/#46 completion. Detailed source assignment remains separate.
- [x] Assign next serial lifecycle owner. Status: root assigned #25 to review_cert_conflict/control fix/epic61-client-owner atc497ecd after reviewed #24 integration; successor23/18 gates remain pending.
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

### #18 final bounded design after #72 infrastructure

Status: read-only recheck against local integration a64a901. #72 regression/closure
and independent final design review precede separate #18 assignment. No #18 source
or test execution. Earlier startup-refusal investigation led to separate #72 and
is now replaced by this bounded scope; ServerApp is NOT a #18 writable file.

Exact production paths: src/types/TunnelingOption.ts (option/default/result validator),
src/server/ServerOptionStore.ts (TTL default and validation only),
src/server/TunnelServer.ts (effective policy and existing timer lifecycle),
src/server/TTTServer.ts (create/apply/capture/restore and TTL scope identity),
src/server/admin/AdminServer.ts (only necessary TTL update/scope result classification).
Dedicated tests/ledger plus explicit TTL cases in
 test/e2e/req-09-pool-swap-zombie.test.ts are the proposed test scope. No ServerApp,
ClientHandlerPool, File/Files, certificate, producer, UI widget or pool/EOF writes.

Proposed exact APIs for independent freeze:

```ts
// Existing shared option module. Optional input field preserves callers omitting it.
// ServerOption: sessionTtlMs?: number
resolveSessionTtlMs(value: unknown):
  {success: true; ttlMs: number} | {success: false; message: string};
// TunnelServer: detached read-only effective values, including explicit scan overrides.
get sessionTtlPolicy(): Readonly<{ttlMs: number; checkIntervalMs: number}>;
// Existing direct configuration signature retained.
configureSessionTtl(ttlMs: number, checkIntervalMs?: number): void;
```

Undefined selects shared default3600000. Only finite numbers are accepted:0 disables,
positive1000..3600000 is valid, negative/nonfinite/nonnumeric values fail by result.
Store uses this result before mutating its candidate and writes the normalized field
only on success. #72 already preserves existing invalid YAML/revision bytes and
blocks startup through readServerOption; reuse it without another load-status or
startup gate. API prepare failure remains400/updated:false before persistence.
No caught native TypeError/RangeError is used for normal file/API validation.

Direct configureSessionTtl keeps its established invalid-argument RangeError caller
contract. Validate the complete TTL/interval pair before changing either value or
timer. Explicit interval must remain finite100..60000 and below a positiveTTL;
with TTL0 it must still satisfy interval bounds. An implicit retained interval is
reused if valid; only when a positiveTTL is smaller, lower it to a valid value below
TTL within bounds (for example min(retained, ttlMs-1)). Do not silently repair an
explicit invalid interval. Add no exposed scan option or new scheduler API.

TunnelServer existing _closed/isRunning gate distinguishes live-disabled from
stopped. configure0 stops the existing unref timer. On a running server,0->positive
starts scans even with no previous timer; on a stopped server it only updates policy,
and start later schedules if positive. close stops it. Existing lastActivity is not
reset by policy change; next scan applies the new threshold. Already terminated
sessions never revive. A repeated start must not install duplicate timers.

TTTServer.createTunnelServer (:78) applies resolved startup TTL. controlOptionsChanged
(:186) must not include TTL. applyServerOption validates before memory/ACL or other
runtime mutation and updates the live policy on its non-restart path before recording
applied values. TTL-only global save preserves real control/admin/external listener
identities and active sessions, with a separate session-ttl applied-scope revision;
it does not claim pending admin configuration was applied.

captureRuntimeState (:193) adds the live sessionTtlPolicy pair; restoreRuntimeState
(:201) restores that pair both on reused and recreated control server paths, not
one reconstructed from committed option. Existing #35/#71 baseline tuple remains:
accepted committed files/currentRevision and pendingRestart survive; runtime restores
its actual LKG TTL/scan and applied scope identity. CandidateTTL is never treated as
LKG merely because commit succeeded. On restoration failure report a bounded
session-ttl failure and do not claim successful LKG recovery. Existing successful
scope restore gates remain. No timer object/pending scheduled callback is persisted.

AdminServer reuses prepare/commit/shared queue and existing rollback snapshot path;
update only TTL change/reporting classification needed for live apply and separate
scope. No new endpoint, queue or restart requirement. Valid existing configuration
without sessionTtlMs receives the new default through Store validation; malformed
or explicit invalid TTL follows #72's ready/result refusal and original-byte safety.

Original18's three core recommendations are longer default, disable and operator
exposure. Its additional control-packet-activity suggestion is deliberately NOT
included under the approved scope. Preserve existing valid data/session-open activity;
no new heartbeat or control-event refresh, and no metadata/identity/authentication
relaxation. Native keepalive from #23 remains distinct from application idleTTL.

- [ ] Store/API RED. Status: absent/default/0/positive/range/type rejection; invalid YAMLTTL byte/revision preservation through #72; no configuration mutation before result failure, no new #40 value policy.
- [ ] Owned real timer RED. Status: explicit1000/200 idle expiry, real data refresh, disabled survival beyond prior deadline with later echo, positive->0->positive and stopped/restarted lifecycle. Observe timer/session/socket outcomes under bounded real time, no fake clock or one-hour survival extrapolation.
- [ ] Live apply/recovery RED. Status: TTL-only no listener/control restart, retained lastActivity, actual explicit scan override captured, failure after candidate apply restores actualTTL/scan and scope with previously accepted committed/pending baseline intact; no terminated-session resurrection.
- [ ] Existing req09 amendment. Status: retain case(3) as explicitly configured1000/200 idle-expiry control and replace obsolete default60s comment. Case(3b) changes only0 rejection to valid disable assertion; retain999,3600001, explicit bad interval and other guard assertions. Add negative/nonfinite rejection and positive re-enable as needed. Do not delete shortTTL coverage, change pool/zombie semantics or weaken artifact ownership controls.
- [ ] Independent freeze and assignment. Status: root confirmed72complete and assigned review_cert_conflict/process fix/epic61-session-idle-policy ata64a901; five production paths above only.

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

### #23 exact source anchors and API clarification

Status: inspected current ClientApp/TunnelClient/shared normalization and native
factory; policy approved, source assignment only after #25 completion.

The existing export DEFAULT_CLIENT_KEEP_ALIVE (types/TunnelingOption.ts:101,190)
becomes10000, and ClientApp's initial option (ClientApp.ts:113-122) imports that
constant instead of its local0. Shared normalizationClientOption (:114-159) already
returns a shallow clone, preserves0, warns on negative/invalid and falls back to
that constant. Correct its obsolete comments claiming negative becomes disabled.
ClientApp.ts:144-153 currently warns negative means disabled before shared
normalization actually replaces it; remove that false claim or make the warning
accurately state fallback10000. Existing explicit0 parsing/config remains enabled
as a deliberate disabled setting, not a negative alias.

TunnelClient constructor (:110) currently stores the caller option by reference,
and makeConnectOpt (:114) omits keepalive while connect (:136) adds it only for
control. Both paths must use one shared resolved value via makeConnectOpt's existing
`keepalive` property; remove the redundant control-only assignment. Preserve all
TLS peer verification/credential fields. No ConnectOpt or factory signature change.

Root-selected contract: extract and export `resolveClientKeepAlive(value: unknown,
warn: NormalizationClientOptionWarner = defaultWarn): number` in the existing shared
option module. The optional existing warning callback keeps logger injection
compatible; ordinary callers may use resolveClientKeepAlive(value). Reuse exactly
the current keepalive validation/number conversion rules, replacing its default
with10000. Undefined chooses10000 silently; explicit0 remains0; negative/invalid
values warn once through this resolver and return10000. The resolver owns keepalive
validation warnings; ClientApp must not additionally issue its old negative-disabled
warning. Shared normalization invokes it with its existing injected warn callback;
TunnelClient invokes it once with its logger warning callback when capturing options.
Already normalized values do not generate another warning.

Direct TunnelClient.create/TTTClient.create callers use a shallow option clone with
only keepAlive resolved. Never invoke the whole-option normalizer in the direct
constructor: preserve its existing host/port/memory and all other option behavior.
Do not mutate the caller or duplicate numeric/fallback logic. ClientApp initial
DEFAULT_CLIENT_KEEP_ALIVE, shared normalization and direct construction converge
on this one resolver/default. Control and data use the captured value through
makeConnectOpt; no public callback, ConnectOpt or factory signature changes.

- [ ] Actual factory-bound RED. Status: use TlsOptionsFactoryRegistry's existing override, capturing options then delegating the original createClientSocketOptions unchanged. Establish actual authenticated owned control and data sockets, identify the two attempts by actual handler/connection observation, and assert both native option sets. Restore the registry in finally. No replacement SocketHandler return or fake native connection.
- [ ] Exact option matrix. Status: absent/default ->10000, explicit positive ->same value, explicit0 ->native keepAlive false on both, negative ->warning plus10000 both. Native initialDelay retains the existing min500 clamp;0 produces false even if the irrelevant delay field is500. Test caller object unchanged and keepalive-only clone/default/invalid normalization; unrelated host/port/memory values unchanged. CLI config/default/negative-warning verification remains distinct from direct create coverage.
- [ ] Honest transport bounds. Status: real authentication/data handshake and echo prove the observed options reach real sockets. These are native probe settings, not evidence of blackhole detection time. No new heartbeat, user-idle timeout, global firewall/route control, EOF/pool changes or #28/#29/#40 policy effect.

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

Status: exact proposal rechecked against main c497ecd after #24 integration;
root approval and independent review PASS; assigned review_cert_conflict in control fix/epic61-client-owner atc497ecd. Actual RED precedes source.
Initial production scope remains TTTClient.ts only plus dedicated tests/ledger.

Current start creates/replaces TunnelClient and EndPointClientPool and assigns
instance-wide callbacks. onCtrlStateCallback receives the originating TunnelClient
but ignores it. Endpoint callbacks carry only SID/state, and disposal can release
synchronous or deferred callbacks. #45 SocketHandler identity checks and #24 data
attempt identity do not guard this upper TTTClient owner pair.

### Proposed exact internal ownership/API freeze

Use one private optional owner record `{client: TunnelClient, pool: EndPointClientPool}`
and object identity, not a shared/public generation framework. All existing public
callback types and start/stop signatures remain unchanged. Proposed private helper:
`isCurrentOwner(owner: ClientOwner): boolean`, true only when not stopped and the
record is the currently published owner. A private `retireOwner(): void` first clears
that owner identity, then disposes its captured pool and destroys its captured
TunnelClient. Retain existing field aliases if consumers/tests use them; authorization
must depend on the owner record, never SID or those aliases alone.

Each callback closure captures the pair created by that start call. Control callback
also checks its supplied originating client equals captured owner.client before
calling the existing onCtrlStateCallback. Guard all tunnel callbacks (connected,
closed, endpoint-open, data-to-endpoint, endpoint-close) and both endpoint callbacks
(state/data and termination). After the guard, route through the captured pair, or
existing private handlers while that pair remains current. Do not read replacement
fields in a delayed closure before checking ownership. Private handler signatures
may accept the owner pair to avoid accidental fresh-object access; public callback
signatures must not change.

Exact start sequence: cancel any outstanding reconnect using the scheduler that
created it; invalidate old owner before any disposal; dispose old pool/destroy old
client; construct the new pair locally; publish the pair and bind every closure;
set stopped=false, tryConnect=true and online=false; only then invoke new.connect().
Synchronous Connected/Closed during connect sees the new published owner. No manual
reconnect loop or second session manager is introduced. Repeated explicit start
must dispose its predecessor rather than orphaning it.

Owned closed sequence: accept only the current client/pair; capture diagnostics,
set online/tryConnect false; invalidate that owner before disposal/destroy; then
schedule exactly one reconnect through the existing runtime scheduler. Capture the
scheduled handle/token and scheduler with the callback. The callback checks not
stopped and that it still owns the pending timer, clears that timer identity, then
calls start. A stale timer after cancellation or a later start does nothing. Store
cancellation ownership (the creating scheduler or a closure over it) instead of
assuming RuntimeRegistry.current() is still the same scheduler at cancellation.
No timer API or runtime default changes are needed.

Stop sequence: set stopped=true and flags false first, cancel/invalidate pending
reconnect, then invalidate/dispose the owner pair. Old connected must not set online;
old closed must not schedule reconnect; endpoint disposal callbacks must not act on
a replacement. Retirement handles an absent owner, repeated stop and synchronous
terminal callbacks without exceptions as normal control flow. Ordinary current
endpoint state/error handling and #24 session-local cleanup remain unchanged.

### Real RED and controls

- [ ] Upper-owner RED. Status: preserve a genuine old TunnelClient's registered upper callback, trigger its actual owned control loss/handshake failure, and let only the existing real scheduler create/authenticate a replacement. After fresh echo, release a held old upper connected/closed callback. This intentionally tests the upper object boundary; replaying a SocketHandler event already rejected by #45 is insufficient. Disclose any held/replayed callback and do not claim it is a second native network failure.
- [ ] Endpoint owner RED. Status: capture a real old EndPointClientPool callback and its deferred terminal delivery; after scheduler replacement, invoke/release it with the new live session's SID. Assert new data/endpoint maps and actual queue identity remain, fresh same-owner session and independent sibling echo succeed, no old bytes replay, and no extra reconnect timer/attempt appears. The matched SID argument is a disclosed stale-callback identity probe, not a claim the server naturally reuses that SID on demand. Include old endpoint Connected/Receive/End/Closed and termination callbacks so neither fresh sync/send nor fresh teardown can occur.
- [ ] Retirement/disposal controls. Status: observe old real sockets/pool interval/pending data work terminated before asserting success, one replacement only and no old-owner operation during disposal. Use the existing short configured reconnect interval with its real scheduler; wrap scheduler calls only to observe/delegate them, never fake elapsed success or construct a replacement manually.
- [ ] Stop-before-timer control. Status: after a real closed callback schedules reconnect, call stop before that owned deadline; use an owned real scheduler barrier after the deadline to observe no new connect and stopped flags/resources, plus a disclosed late saved timer callback to prove identity invalidation. Restore runtime overrides in finally. Also cover stop after fresh connect, repeated stop and explicit start replacing a live owner without leaked sockets. No timeout inflation or policy changes.

A deterministic naturally delayed old handshake terminal remains useful, but must
not weaken the upper-boundary controls if #45/#24 already absorb the native event.
Any missing cleanup requiring TunnelClient/EndPointClientPool edits must first be
shown by actual RED and separately approved; this proposal authorizes neither.
#28/#29/#40 remain independent and untouched.

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
- [x] Observe #24 RED and complete per-issue gates. Status: completed3980; no automatic approval for #25/#23/#18.
