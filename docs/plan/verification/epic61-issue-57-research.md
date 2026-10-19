# Issue57 TLS rejection evidence

Status: #57 complete; sourcee9ab13e -> main59f493f8a8c55eb5b136296bf58b2c53d0698df9 pushed/remote verified; CLOSED2026-09-08T11:39:02Z comment5584549126 Telegram3987(67/54); three suites/9tests PASS3.368seconds natural exit0/buildPASS. Original research/proposed-pending text is historical; current active status/counts SSOT is execution plan.

- [x] Read original57 and actual readiness events. Status: facts below.
- [x] Freeze native TLS establishment contract and test-only scope. Status: independent review PASS/root approval; wrapper TCP Connected and production TLS defaults remain unchanged.
- [ ] Observe actual verification-sensitivity RED and preserve limits. Status: planned, not executed.
- [x] Strengthen tests and independently review. Status: completed; exact execution/review/closure evidence in issue ledger.

## Existing assertions and event mismatch

Original57 identifies that test/component/client/TlsVerification.test.ts rejection
only waits for SocketState.Closed; successful TLS followed by closure could pass.
Its positive case waits for SocketState.Connected and absence of Closed, which is
also insufficient to prove trusted TLS establishment.

SocketHandler.connect (:244) calls tls.connect(options, connected), whose callback
is the native TLS completion callback. But initSocket (:343) independently handles
raw socket 'connect' and emits SocketState.Connected first. The later callback only
emits if state is None. Therefore SocketState.Connected can describe TCP connection
before trust verification, as already observed in #24 fixture classification.
Blindly adding `expect(events).not.toContain(Connected)` would test a separate
production event contract and can fail on correctly rejected TLS. Do not rename
that failure into a TLS rejection PASS or silently change SocketHandler semantics.

The underlying returned handler.socket is the actual TLSSocket. Observe its
secureConnect event, authorized and authorizationError as the client TLS completion
and trust signals; observe server secureConnection and actual application data as
peer evidence. TlsOptionsFactory defaults rejectUnauthorized=true and preserves
provided CA/serverName. Raw TCP 'connect' is transport progress only, not TLS success.

## Recommended bounded contract

1. Untrusted self-signed peer with default verification: actual client TLS failure
   and terminal close, zero native secureConnect, no authorized TLS state and no
   application Receive or server application bytes. Capture the bounded verification
   failure category rather than accepting any Closed (e.g. ECONNREFUSED is invalid
   fixture evidence). Keep a wrapper Connected observation separately and never
   call it authenticated/TLS-connected. Do not require server secureConnection0 as
   sole rejection evidence: server/client handshake observations can differ; client
   authenticated establishment and application bytes are the decisive conditions.
2. Matching explicitly trusted certificate: actual native secureConnect, authorized
   true, server secureConnection and exact nonempty application roundtrip before
   any test teardown. This prevents the current early-TCP positive false PASS.
3. Same owned TLS peer remains capable of a valid trusted exchange after the rejected
   connection. Trusted sibling/control is an actual TLS application exchange, not
   only successful listen or another TCP Connected event.

Attach native listeners immediately to the actual returned socket (before yielding
to event loop), register terminal/error observers before initiating application
work, and retain actual events/results until cleanup. Send an owned test marker
only after secureConnect and authorized=true; rejection send-attempt0 is then a
fixture scheduling property, while zero application bytes observed by both peers
is the actual data-safety evidence. Do not claim a test that simply never sends
anything proved an application's speculative preverification send behavior.

If the root insists original57 literally requires no SocketState.Connected, this
is not test-only: a separately approved SocketHandler readiness correction and its
control/data synchronous-connect compatibility RED would be needed. Recommend
close57 against explicit native TLS establishment semantics, while recording that
wrapper naming/ordering is a distinct known production issue, not fixed here.
No native trust/verification defaults should be weakened to satisfy assertions.

## Minimal write set and real test-first evidence

Initial writes after approval: existing TlsVerification.test.ts and ledger57 only;
extract a dedicated fixture only if necessary, reusing current node-forge self-signed
certificate generation and owned runtime-root helpers. Bind tls server directly to
loopback port0, then read its actual address; connect127.0.0.1 with serverName localhost
to avoid localhost IPv6 ambiguity. Track all accepted sockets (including handshake
failures), destroy only owned sockets in finally and await server close. Never print
private keys or use external certificates/hosts. Preserve existing denied roots.

A strengthened native rejection test may already pass on unchanged production.
Do not invent a new product RED. Demonstrate the original test's false-positive
sensitivity using a disclosed factory-delegating mutation which changes only
rejectUnauthorized=false for one owned rejection probe, restores it in finally,
and has the test peer close only after actual secure establishment. Under that
mutation the old Closed-only assertion passes, whereas the new no-secureConnect/
no-application-delivery contract must fail. This is test-quality/mutation RED,
not a default-trust production defect or an OS failure claim. Do not leave a test
which counts the deliberate insecure connection as successful rejection. Preserve
all mutation-run logs separately; normal final suite runs strict defaults.

- [ ] Owned negative/positive baseline. Status: inspect native event sequence and real verification error with the current factory unchanged; collect exact counters/endpoints and classify wrapper Connected separately.
- [ ] Sensitivity RED. Status: actual owned TLS bypass+close control exposes the old assertion weakness; strengthened negative must fail. Mutation scoped to one attempt, no global TLS environment flags or default changes.
- [ ] Final strict suite. Status: default untrusted fails TLS with native secure0/clientReceive0/serverBytes0; CA-trusted actual secure/authorized/echo passes; server remains healthy. Bound waits on real events/conditions, not arbitrary sleeps/fake clock; natural teardown and repeated run ownership preserved.
- [ ] Compatibility claims. Status: no blackhole timing, #23 keepalive, #24 pre-Connected classification, EOF29, benchmark, new heartbeat or shared production parser/socket changes. Any unexpected production defect is reported before source changes.

No process termination was performed. Future termination cannot target node.exe by
name; only a verified task PID/current command line/ownership can be terminated.
