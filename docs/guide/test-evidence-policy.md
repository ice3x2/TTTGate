# Test evidence policy

Current policy, 2026-09-08. Tests must state what they demonstrate and which behavior they replace or control. Unit doubles and pure algorithm tests are permitted for their stated contracts. Transport, security and lifecycle acceptance still requires actual owned consumer/integration evidence; substituted behavior alone cannot satisfy those requirements.

| Test technique | Supported claim | Evidence limit |
| --- | --- | --- |
| Pure algorithm test | Concrete input/output, parser or state-transition contract using the actual algorithm | Does not establish socket, TLS, persistence or end-to-end behavior |
| Unit stub/mock | Arguments, branch selection, returned result or error handling at the declared boundary | A fake TCPServer or socket does not prove native connection settings or byte delivery |
| Delegating observer/spy | The original implementation ran and its actual call, event or output was observed | Identify the observer and what it forwards; a substituted return value is not a real operation |
| Fault injection | Recovery from the specific injected failure, with other real components identified | Does not prove the OS naturally produced the error or explain a historical incident |
| Actual owned integration/E2E | Specific peer handshake, delivered bytes, persisted bytes, resource state and completion observed through real consumers | Name the exercised path and assertions; creating a harness or calling setup is insufficient |
| Mutation sensitivity | Assertions reject the deliberately broken controlled case | A mutant failure is not a production defect or production RED when the original already passes |

For example, `TunnelServer.keepalive.test.ts` replaces TCPServer.create and proves argument propagation. A separate real control/data connection test is needed to support native keepalive application. The rewrite guardrail unit injects a decompression-limit error; it demonstrates the response to that error, not an actual decompression resource failure. Actual Node HTTP completion plus decoded body equality in the component tests supplies a different kind of evidence.

A mixed test may combine real sockets with a held callback or injected filesystem error. Record both parts rather than label the whole suite “mock-free.” Use that label only for a precisely bounded path whose claimed effects are not replaced. State whether bytes were actually received, a write was merely requested, a callback was held, a peer completed its response, or an assertion inspected only metadata. Native keepalive timing, blackhole detection, throughput and security claims require their own relevant observations; argument checks cannot stand in for them.

Behavior changes require a valid observed failing test before implementation, followed by minimum repair and regression checks. A setup/import/fixture failure is not behavior RED. Preserve failed runs and distinguish them from later executions. A documentation-only policy correction does not require a fabricated RED and does not authorize weakening tests, skipping assertions or rewriting historical evidence. Existing plans and receipts retain their original wording and context; this document states the current policy.

Independent reviewers compare original requirements, changes and factual evidence. Another fixer addresses findings, followed by independent rereview. An author observing a command's exit code or test count is not an independent acceptance review. Describe fault/mutation boundaries to reviewers without presenting a desired conclusion as evidence.

The following gates remain separate and mandatory:

- #48: retry-free roundtrip assertions. Retries must not conceal dropped data or turn an unexplained failure into success.
- #47: real HTTP/TLS end-to-end verification.
- #54: multiple-client behavior through actual consumers.
- #53: large transfer and actual cache-spill behavior.
- #52: whole-source coverage with honest uncovered/partial labels. Coverage percentages do not prove integration and this policy changes no thresholds or source scope.
- #58: requirement-to-test traceability. Unit evidence must not be substituted for a missing end-to-end obligation.

Use owned loopback peers, temporary roots and bounded test processes. Restore observers and fault controls, clean only verified task-owned resources, and preserve failure evidence. Never terminate Node processes by name; any termination requires the exact current-task PID, current command line and ownership verification. This policy grants no permission to operate on denied artifact paths or bypass held work. EOF/#29, benchmark and other issue-specific execution restrictions remain in effect.

## Test layers and harness selection

| Layer | Directories | Script | CI job |
| --- | --- | --- | --- |
| unit | `test/unit test/commons test/util` | `npm run test:unit` | `fast` |
| component | `test/component test/security test/supply-chain test/ci` | `npm run test:component` | `fast` |
| admin | `test/admin` | `npm run test:admin` | `browser-e2e` |
| e2e (in-process) | `test/e2e/tunnel test/e2e/target test/e2e/req-09-pool-swap-zombie.test.ts` | `npm run test:e2e` | `browser-e2e` |
| browser e2e | `test/e2e/browser` | `npm run test:e2e:browser` | `browser-e2e` |
| stress | `test/stress` | `npm run test:stress` | not in CI |

`npm run build` must precede `test:component`, `test:e2e` and `test:e2e:browser`; the process harness fails with `Run npm run build first` otherwise.

Harness selection: use `test/helpers/tunnelHarness.ts` (`createTunnelHarness`) when the claim is about `TTTServer`/`TTTClient` behaviour inside one process and the test needs direct object access (`getServer()`); use `test/helpers/processTunnelHarness.ts` (`createProcessTunnelHarness`) when the claim crosses the process boundary (CLI arguments, `config/*.yaml`, PID files, signals, restart, browser access).

The self-hosted target service (`test/e2e/target/targetService.ts`) exposes the following paths for process and browser end-to-end tests:

| Path | Response | Targeted tunnel feature |
| --- | --- | --- |
| `GET /` | 200, `text/html; charset=utf-8`. `<title>Target OK</title>`, `<span id="host">{req.headers.host}</span>`, `<script src="/assets/a1.js"></script>` … `a40.js` (40 scripts), `<img src="/assets/i1.png">` … `i10.png` (10 images), finally `<div id="ready"></div>` and an inline script `window.addEventListener('load', function(){ document.getElementById('ready').textContent = 'ready'; });` | Multiple connections / keep-alive |
| `GET /assets/a{n}.js` (1 ≤ n ≤ 40) | 200, `application/javascript`, `Cache-Control: no-store`, body `window.__loaded=(window.__loaded||0)+1;` | |
| `GET /assets/i{n}.png` (1 ≤ n ≤ 10) | 200, `image/png`, `Cache-Control: no-store`, 1×1 PNG bytes (signature starting `89 50 4E 47 0D 0A 1A 0A`) | |
| `GET /absolute` | 200, HTML. `<a id="link" href="http://{req.headers.host}/absolute-target">go</a>` and `<p id="text">http://{req.headers.host}</p>` | Host rewriting (`rewriteHostInTextBody`) |
| `GET /api/cors` | 200, `application/json`, body `{"ok":true}`, header `Access-Control-Allow-Origin: http://target.invalid` | ACAO rewriting |
| `GET /headers` | 200, `application/json`, body is the `req.headers` object as-is (Node lower-cases keys) | Custom request headers |
| `GET /custom-response` | 200, `text/plain`, header `X-Target: original`, body `original-body` | Custom response header/body substitution |
| `GET /big?mb=N` | 400 unless `N` is an integer in 1..1024. Otherwise 200, `application/octet-stream`, `Content-Length: N*1048576`, streamed as `bigPayloadChunk` in 64KiB chunks (backpressure: waits for `drain` when `res.write` returns false) | Large transfer / buffer limits |
| `GET /slow?ms=N` | After `N` ms (default `slowDelayMs`), 200, `text/plain`, body `slow-done` | Timeout / keep-alive |
| `POST /echo-post` | 200, echoes the request's `Content-Type` and body verbatim. 405 for GET | Request body delivery |
| `GET /ws` (Upgrade) | Upgraded via `ws.WebSocketServer({noServer: true})`. Echoes received text `m` back as `echo:` + `m`. Sends `tick:1` … `tick:5` at 1-second intervals right after connecting (stops if the connection closes first) | WebSocket upgrade / bidirectional messaging |
| `GET /ws-page` | 200, HTML. `<div id="ws-result"></div>` and a script that opens `new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')`, sends `hello` on `open`, and sets `#ws-result` to `ok` once it has received all 5 `tick:` messages and one `echo:hello`, or to `fail:<reason>` on `error` or an early `close` | Browser WebSocket |
| anything else | 404, `text/plain`, `not found` | |

Browser test rules: launch `chromium` per file in `beforeAll`; use the default viewport (1280×720) unless the test states otherwise; collect `pageerror` into `errors` and assert `expect(errors).toEqual([])`; close the browser, then the harness, then the target in `afterAll` inside `finally`; every readiness check polls an observable (`#ready` text, an admin API) and never sleeps for a fixed time except a documented idle wait.
