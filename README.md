# TTTGate

TTTGate exposes internal TCP/HTTP services through a server-client tunnel pair.

This branch is hardened around three defaults:

- the admin console binds to `127.0.0.1` and uses TLS by default
- protocol v2 client identity is the primary trust model
- new HTTP tunnel configs do **not** reflect `Origin` back as `Access-Control-Allow-Origin`

## Runtime Requirements

Use Node.js 24 LTS or newer (minimum `24.0.0`) for source installations and
building the server or admin UI. Run `nvm use` when using nvm, then install the
locked dependencies with `npm ci` and `npm ci --prefix admin`.

Standalone binaries embed Node.js 24 and do not require a separate Node install.
Build them with the locked `@yao-pkg/pkg` tool through `npm run pkg`; the supported
targets are Linux x64/ARM64, Windows x64/ARM64 and Alpine x64.

### Memory on a Small Server

The server keeps its in-memory buffers inside fixed process-wide budgets, so a 512 MB instance is enough:

| Budget | Default | What happens at the limit |
|---|---|---|
| Socket memory buffers (`globalMemCacheLimit`) | 128 MiB | Further data spills to the file cache on disk |
| Waiting queues of sessions that are still opening | 64 MiB for all clients, 32 MiB per client | Sources pause at 75 %; a session that would exceed a limit is closed |
| Bandwidth-limit queues (groups with a `rate_limit` preset) | 64 MiB for all sessions | Sessions with a queue pause their source at 75 % and resume at 50 % |
| HTTP body rewriting (`rewriteHostInTextBody`) | 32 MiB reserved at a time | Further responses are passed through without rewriting until a rewrite finishes |

The Node.js runtime itself uses about 60–100 MB. Body rewriting holds the decompressed body and a copy while it works, so its peak is about three times the reserved amount. Pending TLS handshakes (up to 1,024 per port) and per-connection header buffers (64 KiB) come on top. Together the worst case stays around 450 MB; keep swap enabled on a 512 MB instance for short peaks. These budgets are built-in defaults and are not set in `server.yaml`.

## Runtime Config Files

- server runtime config: `config/server.yaml`
- client runtime config: `config/client.yaml`
- tracked samples: `config/server.sample.yaml`, `config/client.sample.yaml`
- first-login bootstrap token: `config/.bootstrap-token`
- admin password hash: `config/.key`

The old repository-root `config.yaml` is no longer used.

## Server Startup

1. Build or extract the release bundle.
2. Prepare `config/server.yaml` from `config/server.sample.yaml`.
3. Replace placeholder secrets in `trustedClients`.
4. Start the server:

```shell
./TTTGate-linux-x64 server
```

Server options:

- `-adminPort [port]`: admin console port.
- `-keepAlive [ms]`: control listener TCP keepalive interval.
- `-allowLegacyAdminHttp`: allow legacy non-TLS admin mode for one process run.
- `-allowLegacyAdminRemote`: allow legacy non-loopback admin bind for one process run.
- `-trustXForwardedFor`: read the admin client address from `X-Forwarded-For`. Use it only behind a reverse proxy that you control.
- `-trustedProxyHops [n]`: number of trusted proxies in front of the admin server (1–16, default 1). The address is taken from the right end of `X-Forwarded-For`, skipping this many entries, because clients can write anything on the left.
  - Set it to the **exact** number of proxies. A larger value lets a client choose its own address again and evade the login lockout. A smaller value puts every admin behind the same proxy address, so one lockout locks out everyone and MFA tickets can fail when that address changes.
  - Let only the proxy reach the admin port. If clients can connect directly, they also control the rightmost value.
  - Upgrade note: earlier versions read the **leftmost** value. Check this setting when you upgrade.
- `-allowLegacyControlAuth`: allow legacy shared-key control authentication for one process run. **Risk:** legacy data connections carry no binding token, so anyone who guesses a data handler ID can take over a session and read or inject external user traffic. The server logs a warning at startup while this is on.
- `-reset [true|false]`: delete persisted server state only when explicitly `true`.
- `-daemon`: run with process monitoring.

### First Admin Login

On a fresh install, the server writes a one-time bootstrap token to `config/.bootstrap-token`.
Use that token when setting the first admin password through the admin API/UI. The token is deleted after the first successful password setup.

## Client Startup

1. Prepare `config/client.yaml` from `config/client.sample.yaml`.
2. Set `clientId` and `clientSecret` to a trusted client registered on the server.
3. Configure `ca` and `serverName` when the control listener uses TLS.
4. Start the client:

```shell
./TTTGate-linux-x64 client -addr example.com:9126
```

Client options:

- `-addr [host:port]`: server address.
- `-tls`: enable TLS on the control connection.
- `-name [name]`: local display name.
- `-clientId [id]`: protocol v2 client identifier.
- `-clientSecret [secret]`: protocol v2 shared secret.
- `-displayName [name]`: display-only name announced to the server.
- `-ca [pem]`: CA or pinned server certificate PEM path.
- `-serverName [name]`: expected TLS server name.
- `-allowLegacyFallback`: allow v1 fallback only when the server explicitly enables legacy auth. **Risk:** a fake server can answer with the legacy protocol and receive the shared key. The client logs a warning at startup while this is on.
- `-allowInsecureTls`: disable certificate verification. Keep this off outside break-glass scenarios.
- `-key [key]`: legacy shared key. Only used with explicit legacy control auth.
- `-keepAlive [ms]`: control connection TCP keepalive interval.
- `-bufferLimit [MiB]`: global memory buffer limit.
- `-save`: persist the resolved client config to `config/client.yaml`.
- `-daemon`: run with process monitoring.

## Upgrading an Existing Server

Read this before you replace a running server with this version.

**Steps that stop the server or the tunnels unless you act:**

1. **Admin console security policy.** Earlier versions served the admin console over plain HTTP on all interfaces. This version refuses to start (exit code 1) while `adminTls` is `false` or `adminBindHost` is not a loopback address. Do one of the following before you start it:
   - Set `adminTls: true` and `adminBindHost: 127.0.0.1` in `config/server.yaml`, and reach the console through an SSH tunnel. This is the recommended setup.
   - Or start with `-allowLegacyAdminHttp` and `-allowLegacyAdminRemote` for that run while you move to the setup above.
2. **Existing clients.** Clients of earlier versions authenticate with the shared key only. This version turns that off by default, so every tunnel disconnects until you either:
   - start the server with `-allowLegacyControlAuth` (or set `allowLegacyControlAuth: true`) for the rollout window, then upgrade the clients with `clientId` and `clientSecret` (see "Mixed-Version Rollout Policy" below), or
   - upgrade the clients first.

**Values that are adjusted automatically (a warning is logged at startup):**

- **Per-tunnel rate limiting** stays off for every tunnel saved without a `rateLimit` field. The protocol defaults are stored with it (TCP: 30 connections per 60 s, HTTP/HTTPS: 300; a 10-minute ban when exceeded), so you only switch it on per tunnel in the admin console. New tunnels start with it on.
- **Session idle TTL** stays off (`sessionTtlMs: 0`) when the file has no `sessionTtlMs`. New installations close a session after one hour without traffic; set `sessionTtlMs` (1000–3600000 ms) to turn it on. Long idle SSH or database connections without keepalive are closed when it is on. A `PUT /api/serverOption` call that omits `sessionTtlMs` sets it back to one hour; the admin console always sends the current value.
- **Server buffer** `-1` or `0` ("unlimited" in earlier versions) becomes the default 8 MiB. An unlimited buffer can exhaust the memory of a small server; data keeps flowing with backpressure once a session is open.

**Other changes to be aware of:**

- HTTP tunnels reject a request whose header block is larger than 64 KiB (earlier: 8 MiB) with `431`.

## HTTP Tunnel CORS Policy

`replaceAccessControlAllowOrigin` is a compatibility policy flag, not a security hotfix.

- new tunnel configs default to `false`
- existing saved configs with the field unset keep the legacy reflection behavior until you set the field explicitly
- credential-bearing backends should move to explicit allowlists instead of origin reflection

## Mixed-Version Rollout Policy

- default rollout target: `controlProtocolMode: mixed`
- secure target state: `controlProtocolMode: mtls-strict`
- legacy shared-key control auth stays off unless `-allowLegacyControlAuth` is used deliberately
- client-side `allowLegacyFallback` should remain `false` unless you are in an approved rollback window
- both legacy switches weaken session binding and key secrecy (see the option list above); turn them off when the rollback window ends
- unauthenticated tunnel connections, including those still in the TLS handshake, close at the handshake deadline (15 s by default, sized for a 0.5-core server that swaps); a session whose data connection does not arrive closes after 60 s, and the client gives up on an unreachable endpoint after 45 s

Recommended cutover order:

1. Register protocol v2 trusted clients on the server.
2. Upgrade clients with `clientId` and `clientSecret`.
3. Verify mixed-version connectivity and rollback path.
4. Disable legacy rollout exceptions.
5. Move the control listener to TLS + `mtls-strict` when the fleet is ready.

## Stop Background Processes

```shell
./TTTGate-linux-x64 stop
```
