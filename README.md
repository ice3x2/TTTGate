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
- `-allowLegacyControlAuth`: allow legacy shared-key control authentication for one process run.
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
- `-allowLegacyFallback`: allow v1 fallback only when the server explicitly enables legacy auth.
- `-allowInsecureTls`: disable certificate verification. Keep this off outside break-glass scenarios.
- `-key [key]`: legacy shared key. Only used with explicit legacy control auth.
- `-keepAlive [ms]`: control connection TCP keepalive interval.
- `-bufferLimit [MiB]`: global memory buffer limit.
- `-save`: persist the resolved client config to `config/client.yaml`.
- `-daemon`: run with process monitoring.

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
