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

**Kernel socket buffers.** Linux also charges TCP socket buffers to the server process. When receivers read slowly, the kernel can hold up to the `tcp_rmem`/`tcp_wmem` maximum per socket (by default 6 MiB / 4 MiB), which is outside the budgets above. On a 512 MB instance, cap them:

```
# /etc/sysctl.d/90-tttgate.conf
net.ipv4.tcp_rmem = 4096 131072 1048576
net.ipv4.tcp_wmem = 4096 16384 1048576
```

Apply with `sudo sysctl --system`. This keeps throughput for normal links and stops slow readers from filling memory.

**Measured on a 512 MB / 0.5-core limit** (cgroup v2: `MemoryMax=512M`, `MemorySwapMax=4G`, `CPUQuota=50%`, default kernel socket buffers, loopback):

| Load | Result | Server memory peak |
|---|---|---|
| 200 concurrent connections, 256 KiB round trip each | 200/200, p95 4.2 s | 69 MiB |
| 3,000 short connections, 50 at a time | 3,000/3,000, p95 119 ms | 76 MiB |
| 4 parallel 100 MiB streams | 4/4 intact, 3.4 s each | 142 MiB |
| Client restart during load | tunnel back after 133 ms, 3,000/3,000 | 142 MiB |
| 50 connections × 20 MiB with the reader paused for 5 s | 50/50, no OOM | 512 MiB (process heap 135 MiB, kernel socket buffers 501 MiB), 113 MiB swap |

The last case is what the socket buffer cap above prevents.

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
3. Replace placeholder secrets in `trustedClients`, or remove them and add clients in the admin console (**Trusted clients**).
4. Start the server:

```shell
./TTTGate-linux-x64 server
```

Server options:

- `-adminPort [port]`: admin console port. The new port is saved to `server.yaml`. See [Admin Web Console](#admin-web-console).
- `-keepAlive [ms]`: control listener TCP keepalive interval.
- `-allowLegacyAdminHttp`: allow legacy non-TLS admin mode for one process run.
- `-allowLegacyAdminRemote`: allow legacy non-loopback admin bind for one process run.
- `-trustXForwardedFor`: read the admin client address from `X-Forwarded-For`. Use it only behind a reverse proxy that you control. To open the console through the proxy, also add the proxy address to `adminAllowedOrigins` (see [Admin Web Console](#admin-web-console)).
- `-trustedProxyHops [n]`: number of trusted proxies in front of the admin server (1–16, default 1). The address is taken from the right end of `X-Forwarded-For`, skipping this many entries, because clients can write anything on the left.
  - Set it to the **exact** number of proxies. A larger value lets a client choose its own address again and evade the login lockout. A smaller value puts every admin behind the same proxy address, so one lockout locks out everyone and MFA tickets can fail when that address changes.
  - Let only the proxy reach the admin port. If clients can connect directly, they also control the rightmost value.
  - Upgrade note: earlier versions read the **leftmost** value. Check this setting when you upgrade.
- `-allowLegacyControlAuth`: allow legacy shared-key control authentication for one process run. **Risk:** legacy data connections carry no binding token, so anyone who guesses a data handler ID can take over a session and read or inject external user traffic. The server logs a warning at startup while this is on.
- `-reset [true|false]`: delete persisted server state only when explicitly `true`.
- `-daemon`: run with process monitoring.
- `-requireCsrfHeader false`: turn off the CSRF header check of the admin API. **Risk:** other web pages can send admin requests with the session cookie.

`TTTGate server --help` lists the common options. `--help-advanced` adds the legacy and risky options.

### Log Level

`logLevel` in `config/server.yaml` sets which server logs are written. The values are `error`, `warn`, `info` (default) and `debug`. A missing value means `info`.

- Change it in the admin console (**Server settings** → **Log level**) or with `POST`/`PUT /api/serverOption`.
- The new level applies at once to all log output (files and console). You do not need to restart the server.
- Any other value is rejected with `400`, and `server.yaml` does not change.
- Use `debug` only while you investigate a problem. It writes much more and can fill the disk.
- Audit logs (`logs/audit`) are not affected.
- A wrong value written directly in `server.yaml` fails config validation at startup.
- Upgrade note: earlier versions also wrote `debug` lines by default. Set `logLevel: debug` to keep that output.

### Connection Close Timeouts

When the server closes a tunnelled connection, it first sends the remaining output and then waits for the peer to close. Two options in `config/server.yaml` limit these waits:

| Option | Meaning | Range (ms) | Default (ms) |
|---|---|---|---|
| `closeStallMs` | How long the remaining output can make no progress. Each write that completes starts the time again. | 1000–600000 | 60000 |
| `closeGraceMs` | How long to wait for the peer to close after FIN was sent or received. | 1000–120000 | 10000 |

- When a timeout ends, the server closes the connection by force.
- Change them in the admin console (**Server settings** → **Connection close**) or with `POST`/`PUT /api/serverOption`. You do not need to restart the server.
  - A new `closeStallMs` applies to connections that start to close after the change.
  - A new `closeGraceMs` applies to connections that send or receive FIN after the change.
- A missing value means the default.
- A value outside the range is rejected with `400`, and `server.yaml` does not change. A wrong value written directly in `server.yaml` fails config validation at startup.
- These options apply only to the server process. The client always uses the defaults.
- Increase `closeStallMs` when slow users download large files. The slowest reader the server waits for is about (one third of the kernel send buffer) / `closeStallMs`. On Linux with the default 60000 this is about 25 KiB/s.
- Decrease them on a small server to free connections sooner.

## Admin Web Console

The server includes a web admin console. Use it to manage tunnels, users and groups, trusted clients, certificates and server settings.

### Open the Console

These keys in `config/server.yaml` control the console:

| Key | Default | Meaning |
|---|---|---|
| `adminPort` | `9300` | Port of the console. `-adminPort <port>` changes it and saves the new port to `server.yaml`. |
| `adminBindHost` | `127.0.0.1` | Address the console listens on. Only a loopback address (`127.0.0.1`, `::1`, `localhost`) is allowed, unless you start the server with `-allowLegacyAdminRemote`. |
| `adminTls` | `true` | Serve the console over HTTPS. `false` is allowed only with `-allowLegacyAdminHttp`. |
| `adminAllowedOrigins` | `[]` | Extra page addresses (origins) that can use the console, for a reverse proxy or a domain name. See [Open the Console from Another Computer](#open-the-console-from-another-computer). |

With these defaults, open `https://127.0.0.1:9300/` in a browser on the server host.

When no admin certificate is stored (for example on the first start), the server creates a self-signed certificate for the console (`Testing CA - DO NOT TRUST`, valid for one year). It is not renewed automatically. The browser shows a certificate warning. Make sure that you opened the correct address, then continue.

To remove the warning, use your own certificate. In **Server settings**, keep **Admin TLS** checked and select the private key (**Key**) and the certificate (**Cert**) files. **CA** is optional. When the key and the certificate match, the server uses the new certificate at once. You do not need to press **Apply** or restart the server.

If `adminBindHost` is not a loopback address or `adminTls` is `false`, the server does not start without the matching flag. It prints the reason and the flags it needs, for example `Refusing insecure admin policy: ...`. The flags apply only to the run that you start with them.

The console accepts a login or a change only from a page whose address is `127.0.0.1`, `::1`, `localhost` or the `adminBindHost` address, with the `adminPort` port, or from an origin listed in `adminAllowedOrigins`. Other addresses get `403 Forbidden origin`.

### Open the Console from Another Computer

The console listens only on the server host by default. Use one of these ways:

1. **SSH tunnel (recommended).** You do not change the server. On your computer, run:

   ```shell
   ssh -L 9300:127.0.0.1:9300 user@server.example.com
   ```

   Keep the SSH session open, then open `https://127.0.0.1:9300/` on your computer. Use the same local port as `adminPort`. Another local port gets `403 Forbidden origin`.
2. **Bind to the server IP address (not recommended).** Set `adminBindHost` to an IP address of the server that other hosts can reach (for example `192.168.0.10`) and start the server with `-allowLegacyAdminRemote`. Open the console with exactly that address and port (`https://192.168.0.10:9300/`).
   - `0.0.0.0`, `::` and host names do not work: the server starts, but the login fails with `403 Forbidden origin`.
   - **Risk:** anyone who can reach the port can try passwords. The login lockout applies. Turn on two-factor authentication for admin accounts, keep `adminTls: true` and limit the port with a firewall.
3. **Reverse proxy with a domain name.** Keep `adminBindHost: 127.0.0.1` and let an HTTPS proxy on the same host forward to the console.
   1. Add the address that users open to `config/server.yaml`. Use the exact scheme, host and port. Only `https://` origins are accepted, because the session cookie of an HTTPS console is `Secure` and browsers drop it on `http://` pages. Paths and wildcards are not accepted.

      ```yaml
      adminAllowedOrigins:
        - "https://admin.example.com"
      ```

   2. Configure the proxy. Example for nginx:

      ```nginx
      server {
          listen 443 ssl;
          server_name admin.example.com;
          # ssl_certificate and ssl_certificate_key for admin.example.com

          location / {
              proxy_pass https://127.0.0.1:9300;
              proxy_ssl_verify off;   # the console uses a self-signed certificate by default
              proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
              proxy_hide_header Strict-Transport-Security;
          }
      }
      ```

   3. Start the server with `-trustXForwardedFor -trustedProxyHops 1` (one proxy), so that the login lockout and the audit log use the real client address.
   - Restart the server after you edit `server.yaml`. A change made through the server option API (`/api/serverOption`) applies to the next request without a restart. The **Server settings** screen keeps the list as it is.
   - The console sends `Strict-Transport-Security` with `includeSubDomains`. The example hides it, so that it does not apply to every subdomain of the proxy domain. Send your own HSTS header from the proxy if you need one.
   - Use a host name whose other subdomains you control. A page on another subdomain of the same site can set cookies for the console.
   - Serve the console at the root path `/`. The console calls `/api/...` and sets its cookies for the path `/`.

With an SSH tunnel or a reverse proxy, the console sees every connection from `127.0.0.1`. The country filter of the admin console (**Security** → **Apply to admin console**) therefore decides on the proxy or tunnel address, not on the real client address. Apply country limits on the proxy instead (for example nginx `allow`/`deny` or a GeoIP module). `-trustXForwardedFor` changes the client address that the login lockout, the audit log, the session list and the binding of two-factor login tickets use. It does not change the country filter.

### First Admin Login

On a fresh install, the server has no admin account. It writes a one-time bootstrap token to `config/.bootstrap-token`. When it creates the token, it writes the file path to the log. The token stays the same when you restart the server before the first setup.

1. Open the admin console.
2. Enter a username for the first superuser and a password, then press **OK**.
   - Username: 3–32 characters (letters, digits, `.`, `_`, `-`). Upper-case letters are changed to lower case. An empty username means `admin`.
   - Password: at least 8 characters and at most 1024 characters, not counting spaces at the start and the end.
3. The **Bootstrap token** field appears. On the server, read the token (`cat config/.bootstrap-token`), paste it into the field, and press **OK** again.
4. The server creates the superuser, deletes `config/.bootstrap-token`, and signs you in. Next time, sign in with the username and password.

Who can do the first setup:

- Only a person who knows the token. On Linux the file mode is 0600, so only the account that runs the server (and root) can read the token. In practice, only an operator of the server host can set the first password.
- The server does not check where the request comes from. With the default `adminBindHost: 127.0.0.1`, the console is reachable only on the server host or through an SSH tunnel. If you open the console to other hosts, the token still protects the first setup.
- Every failed attempt counts as a failed login, also the first **OK** without a token. After 5 failed logins within 1 minute from one address range (IPv4 /24, IPv6 /64), the server answers `429` for 1 minute.

## Client Startup

### Enroll with a code (recommended)

The control port must use TLS (`tls: true` in `config/server.yaml`).

1. In the admin console, open **Trusted clients**, add the client, and copy the command it shows. You can also press **Enrollment code** on an existing client. The code works once and expires after 15 minutes.
2. On the client host, run the command:

```shell
./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
```

`client join` writes `config/client.yaml` (mode 0600) and `config/server-ca.pem`, then stops. It does not overwrite an existing `client.yaml` unless you add `--force`; the old file is kept as `client.yaml.bak`.

3. Start the client. No options are needed:

```shell
./TTTGate-linux-x64 client          # or: client -daemon
```

The code never travels over the network. The client derives a lookup value and a key from it, and the server seals its answer with that key. If another host is in the middle, the answer does not open, and `client join` writes nothing.

Other client commands:

- `client config show`: print the resolved options and where each value comes from. Secrets are hidden.
- `client config save [options]`: save options to `config/client.yaml` without connecting.
- `client run [options]`: the same as `client [options]`.

### Set up by hand

1. Prepare `config/client.yaml` from `config/client.sample.yaml`.
2. Set `clientId` to a trusted client registered on the server. Give its secret in one of these ways (first match wins):
   1. `-clientSecret <secret>`. Not recommended: other users of the host can read command lines.
   2. `-clientSecretFile <path>`: the file holds only the secret.
   3. The `TTTGATE_CLIENT_SECRET` environment variable.
   4. `clientSecret` in `config/client.yaml`.
3. When the control listener uses TLS, set `ca` and `serverName`.
4. Start the client:

```shell
TTTGATE_CLIENT_SECRET=... ./TTTGate-linux-x64 client -addr tls://example.com:9126 -clientId client-a -ca /etc/tttgate/ca.pem
```

`TTTGate client --help` lists the options in groups. `--help-advanced` adds the legacy and risky options.

Client options:

- Connection
  - `-addr <host:port>`: server address. The port is optional. IPv6 addresses go in brackets: `[2001:db8::7]:9126`. A `tls://` or `tcp://` prefix selects the transport.
  - `-tls`: use TLS on the control connection.
- Identity
  - `-clientId <id>`: protocol v2 client identifier.
  - `-clientSecret <secret>`, `-clientSecretFile <path>`: protocol v2 shared secret (see step 2).
  - `-name <name>`: client name for legacy connections and local logs. A v2 server always shows the name registered for the `clientId`. `-displayName` is a deprecated alias.
- TLS trust (each of these turns TLS on)
  - `-ca <path|pem>`: trusted CA or pinned server certificate, as a file path or PEM text. A relative path on the command line is relative to the working directory. A relative path in `client.yaml` is relative to the `config/` directory.
  - `-serverName <name>`: expected TLS server name.
  - `-cert <path|pem>`, `-privateKey <path|pem>`: client certificate and key for mutual TLS.
- Run
  - `-save`: save the resolved options to `config/client.yaml`. The file keeps paths, not file contents. A relative path from the command line is saved as an absolute path, so the next start finds the same file. On Linux the file mode is 0600.
  - `-daemon`: run in the background with process monitoring.
- Tuning
  - `-keepAlive <ms>`: control connection TCP keepalive interval.
  - `-bufferLimit <MiB>`: memory buffer limit, `-1` (no limit) or 16–1048576.
- Legacy and risky (shown by `--help-advanced`)
  - `-allowLegacyFallback`: allow v1 fallback only when the server explicitly enables legacy auth. **Risk:** a fake server can answer with the legacy protocol and receive the shared key. The client logs a warning at startup while this is on.
  - `-allowInsecureTls`: disable certificate verification. Keep this off outside break-glass scenarios.
  - `-key <key>`: legacy shared key. Only used with explicit legacy control auth.
  - `--yes-insecure`: accept `allowInsecureTls` or `allowLegacyFallback` written in `client.yaml` for this run.

### Command-line errors and exit codes

The program checks the whole command line before it starts anything. An unknown option stops the program and names the closest option, for example `unknown option '-adr'. Did you mean '-addr'?`. With `-daemon`, the program checks the options and `client.yaml` before it starts the background processes, so the errors show in your terminal.

| Code | Meaning |
|---|---|
| 0 | Normal end, help, version |
| 1 | Error while running. Server option errors also use 1 |
| 2 | Command-line error: unknown option or mode, missing or bad value, options that conflict |
| 78 | Configuration file error: insecure fields in `client.yaml`, a CA, certificate, key or secret file that is missing or not valid |

A daemon whose app stops with a configuration error is not restarted. The reason is in `logs/`. Fix the configuration and start again.

## Upgrading an Existing Server

**Changes in the client command line and trusted clients:**

- The control port certificate is now stored in `cert/control.cert.pem` and kept across restarts. Its only name is `tttgate-control`. Clients that pin it use `serverName: tttgate-control`. `client join` sets both for you.
  - The certificate is valid for one year. The server makes a new one at start when fewer than 30 days remain. After that, every client must enroll again (or pin the new certificate), so restart the server at a planned time before the year ends.
- Trusted clients can no longer be changed through `POST /api/serverOption`. Use `/api/trustedClients` or the **Trusted clients** screen. `GET /api/serverOption` shows `********` in place of client secrets. Sending the masked list back keeps the stored secrets.
- Adding or removing a trusted client no longer restarts the control listener. Only the removed client, or a client whose secret was renewed, is disconnected.
- The control connection now has a heartbeat. A client pings every 10 seconds, and either side closes the control connection after 30 seconds without any control packet. The client then reconnects. This finds connections that are cut without a FIN or RST (a pulled cable, an expired NAT entry). The heartbeat is used only when both sides support it, so older servers and clients work as before.
- The client stops with an error for options it does not know (exit code 2), and for a `-ca`, `-cert`, `-privateKey` or `-clientSecretFile` file that it cannot read (exit code 78). Check your service scripts.
- `stop` now stops only the processes that it can confirm as the TTTGate processes it recorded. Before, it stopped every pid in the pid files, including old pids that the system may have given to another program. See [Stop Background Processes](#stop-background-processes). The pid files now hold one JSON object per line (for example `{"pid":1234,"start":…}`) in place of a bare pid. If your own scripts read them, read the `pid` field. Older pid files are still read.

Read this before you replace a running server with this version.

**Steps that stop the server or the tunnels unless you act:**

1. **Admin console security policy.** Earlier versions served the admin console over plain HTTP on all interfaces. This version refuses to start (exit code 1) while `adminTls` is `false` or `adminBindHost` is not a loopback address. Do one of the following before you start it:
   - Set `adminTls: true` and `adminBindHost: 127.0.0.1` in `config/server.yaml`, and reach the console through an SSH tunnel. This is the recommended setup.
   - Or start with `-allowLegacyAdminHttp` and `-allowLegacyAdminRemote` for that run while you move to the setup above.
2. **Existing clients.** Clients of earlier versions (1.0.10 and older) authenticate with the shared key only. This version turns that off by default, so every tunnel disconnects until you either:
   - start the server with `-allowLegacyControlAuth` (or set `allowLegacyControlAuth: true`) for the rollout window, then upgrade the clients with `clientId` and `clientSecret` (see "Mixed-Version Rollout Policy" below), or
   - upgrade the clients first (not when you have the tunnels in step 3).
3. **Tunnels to a destination with an untrusted certificate.** A client of this version verifies the certificate of the destination server. Clients of earlier versions (1.0.10 and older) did not. This applies to tunnels with **Secure tunneling Server/Client** checked (`tls: true`) and to every HTTPS tunnel. After you upgrade a client, such a tunnel to a destination with a self-signed (or otherwise untrusted) certificate fails with a certificate error, for example `self-signed certificate`. If you have such tunnels, do one of the following:
   - Upgrade the server first, with `-allowLegacyControlAuth` as in step 2 so that 1.0.10 clients stay connected. In the admin console, open each such tunnel and check **Skip certificate verification (allow self-signed)** (`allowSelfSignedDestinationCert: true`). Then upgrade the clients with `clientId` and `clientSecret` as in step 2. A server of an earlier version cannot send this option, so do not upgrade the clients first.
   - Give the destination a certificate from a public CA that Node.js trusts, and that matches the destination host of the tunnel. The client's `-ca` option applies only to the control connection, not to destinations. A certificate for a DNS name fails when the tunnel uses an IP address, and the other way round.

   With the option checked, the client accepts any certificate from the destination server. Use it only on a trusted network. The tunnel list marks these tunnels with **cert not verified**.

**Values that are adjusted automatically (a warning is logged at startup):**

- **Per-tunnel rate limiting** stays off for every tunnel saved without a `rateLimit` field. The protocol defaults are stored with it (TCP: 30 connections per 60 s, HTTP/HTTPS: 300; a 10-minute ban when exceeded), so you only switch it on per tunnel in the admin console. New tunnels start with it on.
- **Session idle TTL** stays off (`sessionTtlMs: 0`) when the file has no `sessionTtlMs`. New installations close a session after one hour without traffic; set `sessionTtlMs` (1000–3600000 ms) to turn it on. Long idle SSH or database connections without keepalive are closed when it is on. A `PUT /api/serverOption` call that omits `sessionTtlMs` sets it back to one hour; the admin console always sends the current value.
- **Server buffer** `-1` or `0` ("unlimited" in earlier versions) becomes the default 8 MiB. An unlimited buffer can exhaust the memory of a small server; data keeps flowing with backpressure once a session is open.

**Other changes to be aware of:**

- Saving an **Online** tunnel (a new port, other settings or a new certificate) keeps its activation switch and its timer. In 1.0.10, saving reset them: a tunnel with **Inactive on startup** checked was switched off, any other tunnel was switched on, and the timer started again. **Inactive on startup** applies when the server starts, when a tunnel is created, and when you save a tunnel that is not **Online** (the tunnel list shows **Error**, for example after a port bind failure).
- HTTP tunnels reject a request whose header block is larger than 64 KiB (earlier: 8 MiB) with `431`.
- Admin passwords are limited to 1024 characters (leading and trailing whitespace is not counted). A longer password cannot be set, and a login with a longer password fails without a password check. If you use a longer password, change it before you upgrade.
- The admin server handles at most 5 login requests (`/api/login` and `/api/login/mfa` together) at the same time from one network (IPv4 /24, IPv6 /64). More requests get `429` with code `login_concurrency_limit`; try again after the earlier requests finish.
- The admin server keeps at most 20 login sessions per user and 10,000 in total. A new login closes the session that was used least recently and records a `session_killed` audit event with actor `system`. Scripts that log in to the admin API must call `POST /api/logout` when they finish; otherwise each run closes an older session of the same account, for example a browser session.

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

`stop` reads the pid files in the `bin` folder (`.pid_sentinel`, `.pid_app`, `.pid_foreground`). It stops a process only when it can confirm that the process is the one that TTTGate recorded:

- On Linux, it compares the start time in `/proc/<pid>/stat` and the executable.
- On Windows, it asks `Get-Process` for the start time and the executable.

If it cannot confirm a process, it does not stop it and writes a warning with the pid and the pid file.

- **Use the same user.** Stop and start TTTGate as the user that started it. A user without administrator rights cannot stop, or on Windows identify, a daemon that an administrator started.
- **A start is refused while an old daemon runs.** If `-daemon` finds a TTTGate process that it could not stop, it does not start a second pair (the ports would collide). It names the pid and the pid file and exits with code 1. Stop that process, or delete the pid file if that pid is not TTTGate, and start again.
