# TTTGate

TTTGate exposes internal TCP/HTTP services through a server-client tunnel pair.

**Language:** [English](#english) | [한국어](#한국어)

## English

### Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Runtime Requirements](#runtime-requirements)
- [Configuration Files](#configuration-files)
- [Server](#server)
- [Admin Web Console](#admin-web-console)
- [Client](#client)
- [Command-Line Reference](#command-line-reference)
- [Operations](#operations)
- [Upgrading an Existing Server](#upgrading-an-existing-server)
- [Mixed-Version Rollout Policy](#mixed-version-rollout-policy)
- [HTTP Tunnel CORS Policy](#http-tunnel-cors-policy)

### Overview

TTTGate has two parts:

- The **server** runs on a host that users can reach. It opens the tunnel ports and serves the admin web console.
- The **client** runs inside the internal network, for example behind NAT. It connects out to the server and forwards tunnel traffic to the internal services.

This version is hardened around three defaults:

- The admin console binds to `127.0.0.1` and uses TLS by default.
- Protocol v2 client identity (`clientId` and `clientSecret`) is the primary trust model.
- New HTTP tunnel configs do **not** reflect `Origin` back as `Access-Control-Allow-Origin`.

In the examples, `./TTTGate-linux-x64` is the Linux x64 binary. Use the binary for your platform.

### Quick Start

1. On the server host, start the server:

   ```shell
   ./TTTGate-linux-x64 server
   ```

2. On the server host, open `https://127.0.0.1:9300/`. From another computer, open an SSH tunnel first (see [Open the Console from Another Computer](#open-the-console-from-another-computer)).
3. Create the first admin account with the token in `config/.bootstrap-token` (see [First Admin Login](#first-admin-login)).
4. Make sure that the control port uses TLS (`tls: true` in `config/server.yaml`). In the console, open **Trusted clients**, add a client, and copy the command that the console shows.
5. On the client host, run the copied command, then start the client in the background:

   ```shell
   ./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
   ./TTTGate-linux-x64 client -daemon
   ```

6. Add tunnels in the console.

### Runtime Requirements

Use Node.js 24 LTS or newer (minimum `24.0.0`) for source installations and to build the server or the admin UI. When you use nvm, run `nvm use`. Then install the locked dependencies with `npm ci` and `npm ci --prefix admin`.

Standalone binaries embed Node.js 24. They do not need a separate Node install. Build them with the locked `@yao-pkg/pkg` tool through `npm run pkg`. The supported targets are Linux x64/ARM64, Windows x64/ARM64 and Alpine x64.

#### Memory on a Small Server

The server keeps its in-memory buffers inside fixed process-wide budgets. A 512 MB instance is therefore enough:

| Budget | Default | What happens at the limit |
|---|---|---|
| Socket memory buffers (`globalMemCacheLimit`) | 128 MiB | Further data spills to the file cache on disk |
| Waiting queues of sessions that are still opening | 64 MiB for all clients, 32 MiB per client | Sources pause at 75 %; a session that would exceed a limit is closed |
| Bandwidth-limit queues (groups with a `rate_limit` preset) | 64 MiB for all sessions | Sessions with a queue pause their source at 75 % and resume at 50 % |
| HTTP body rewriting (`rewriteHostInTextBody`) | 32 MiB reserved at a time | Further responses are passed through without rewriting until a rewrite finishes |

- The Node.js runtime itself uses about 60–100 MB.
- Body rewriting holds the decompressed body and a copy while it works. Its peak is therefore about three times the reserved amount.
- Pending TLS handshakes (up to 1,024 per port) and per-connection header buffers (64 KiB) come on top.
- Together, the worst case stays around 450 MB. Keep swap enabled on a 512 MB instance for short peaks.
- These budgets are built-in defaults. You do not set them in `server.yaml`.

**Kernel socket buffers.** Linux also charges TCP socket buffers to the server process. When receivers read slowly, the kernel can hold up to the `tcp_rmem`/`tcp_wmem` maximum per socket (by default 6 MiB / 4 MiB). This memory is outside the budgets above. On a 512 MB instance, cap them:

```
# /etc/sysctl.d/90-tttgate.conf
net.ipv4.tcp_rmem = 4096 131072 1048576
net.ipv4.tcp_wmem = 4096 16384 1048576
```

Apply the file with `sudo sysctl --system`. This keeps throughput for normal links and stops slow readers from filling memory.

**Measured on a 512 MB / 0.5-core limit** (cgroup v2: `MemoryMax=512M`, `MemorySwapMax=4G`, `CPUQuota=50%`, default kernel socket buffers, loopback):

| Load | Result | Server memory peak |
|---|---|---|
| 200 concurrent connections, 256 KiB round trip each | 200/200, p95 4.2 s | 69 MiB |
| 3,000 short connections, 50 at a time | 3,000/3,000, p95 119 ms | 76 MiB |
| 4 parallel 100 MiB streams | 4/4 intact, 3.4 s each | 142 MiB |
| Client restart during load | tunnel back after 133 ms, 3,000/3,000 | 142 MiB |
| 50 connections × 20 MiB with the reader paused for 5 s | 50/50, no OOM | 512 MiB (process heap 135 MiB, kernel socket buffers 501 MiB), 113 MiB swap |

The socket buffer cap above prevents the last case.

### Configuration Files

| File | Content |
|---|---|
| `config/server.yaml` | Server runtime config |
| `config/client.yaml` | Client runtime config |
| `config/server.sample.yaml`, `config/client.sample.yaml` | Tracked samples |
| `config/.bootstrap-token` | One-time token for the first admin login |
| `config/.key` | Admin password hash |
| `config/server-ca.pem` | Server certificate that `client join` writes for the client |

The old repository-root `config.yaml` is no longer used.

### Server

#### Start the Server

1. Build or extract the release bundle.
2. Prepare `config/server.yaml` from `config/server.sample.yaml`.
3. Replace the placeholder secrets in `trustedClients`. Or remove them and add clients in the admin console (**Trusted clients**).
4. Start the server:

   ```shell
   ./TTTGate-linux-x64 server
   ```

5. To run the server in the background with process monitoring, add `-daemon`. To stop it, run `./TTTGate-linux-x64 stop` (see [Stop Background Processes](#stop-background-processes)).

`TTTGate server --help` lists the common options. `--help-advanced` adds the legacy and risky options. The [Server Options](#server-options) table describes every server option.

#### Which Server Options Are Saved

- `-adminPort`, `-keepAlive` and `-allowLegacyControlAuth` write their value to `config/server.yaml`. The next start uses the saved value without the option.
- All other server options apply only to the run that you start with them.
- `-reset` is an action. It deletes the stored server state at that start.

### Admin Web Console

The server includes a web admin console. Use it to manage tunnels, users and groups, trusted clients, certificates and server settings.

#### Open the Console

These keys in `config/server.yaml` control the console:

| Key | Default | Meaning |
|---|---|---|
| `adminPort` | `9300` | Port of the console. `-adminPort <port>` changes it and saves the new port to `server.yaml`. |
| `adminBindHost` | `127.0.0.1` | Address the console listens on. Only a loopback address (`127.0.0.1`, `::1`, `localhost`) is allowed, unless you start the server with `-allowLegacyAdminRemote`. |
| `adminTls` | `true` | Serve the console over HTTPS. `false` is allowed only with `-allowLegacyAdminHttp`. |
| `adminAllowedOrigins` | `[]` | Extra page addresses (origins) that can use the console, for a reverse proxy or a domain name. See [Open the Console from Another Computer](#open-the-console-from-another-computer). |

With these defaults, open `https://127.0.0.1:9300/` in a browser on the server host.

When no admin certificate is stored (for example on the first start), the server creates a self-signed certificate for the console (`Testing CA - DO NOT TRUST`, valid for one year). The server does not renew it automatically. The browser shows a certificate warning. Make sure that you opened the correct address, then continue.

To remove the warning, use your own certificate. In **Server settings**, keep **Admin TLS** checked and select the private key (**Key**) and the certificate (**Cert**) files. **CA** is optional. When the key and the certificate match, the server uses the new certificate at once. You do not need to press **Apply** or restart the server.

If `adminBindHost` is not a loopback address or `adminTls` is `false`, the server does not start without the matching flag. It prints the reason and the flags it needs, for example `Refusing insecure admin policy: ...`. The flags apply only to the run that you start with them.

The console accepts a login or a change only from these pages:

- a page whose address is `127.0.0.1`, `::1`, `localhost` or the `adminBindHost` address, with the `adminPort` port
- a page whose origin is listed in `adminAllowedOrigins`

Other addresses get `403 Forbidden origin`.

#### Open the Console from Another Computer

By default, the console listens only on the server host. Use one of these ways:

1. **SSH tunnel (recommended).** You do not change the server. On your computer, run:

   ```shell
   ssh -L 9300:127.0.0.1:9300 user@server.example.com
   ```

   Keep the SSH session open. Then open `https://127.0.0.1:9300/` on your computer. Use the same local port as `adminPort`. Another local port gets `403 Forbidden origin`.
2. **Bind to the server IP address (not recommended).** Set `adminBindHost` to an IP address of the server that other hosts can reach (for example `192.168.0.10`). Start the server with `-allowLegacyAdminRemote`. Open the console with exactly that address and port (`https://192.168.0.10:9300/`).
   - `0.0.0.0`, `::` and host names do not work. The server starts, but the login fails with `403 Forbidden origin`.
   - **Risk:** anyone who can reach the port can try passwords. The login lockout applies. Turn on two-factor authentication for admin accounts, keep `adminTls: true` and limit the port with a firewall.
3. **Reverse proxy with a domain name.** Keep `adminBindHost: 127.0.0.1`. Let an HTTPS proxy on the same host forward to the console.
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

   3. Start the server with `-trustXForwardedFor -trustedProxyHops 1` (one proxy). Then the login lockout and the audit log use the real client address.
   - Restart the server after you edit `server.yaml`. A change made through the server option API (`/api/serverOption`) applies to the next request without a restart. The **Server settings** screen keeps the list as it is.
   - The console sends `Strict-Transport-Security` with `includeSubDomains`. The example hides it, so that it does not apply to every subdomain of the proxy domain. If you need HSTS, send your own header from the proxy.
   - Use a host name whose other subdomains you control. A page on another subdomain of the same site can set cookies for the console.
   - Serve the console at the root path `/`. The console calls `/api/...` and sets its cookies for the path `/`.

With an SSH tunnel or a reverse proxy, the console sees every connection from `127.0.0.1`. The country filter of the admin console (**Security** → **Apply to admin console**) therefore decides on the proxy or tunnel address, not on the real client address. Apply country limits on the proxy instead (for example nginx `allow`/`deny` or a GeoIP module).

`-trustXForwardedFor` changes the client address that the login lockout, the audit log, the session list and the binding of two-factor login tickets use. It does not change the country filter.

#### First Admin Login

On a fresh install, the server has no admin account. It writes a one-time bootstrap token to `config/.bootstrap-token`. When it creates the token, it writes the file path to the log. The token stays the same when you restart the server before the first setup.

1. Open the admin console.
2. Enter a username for the first superuser and a password, then press **OK**.
   - Username: 3–32 characters (letters, digits, `.`, `_`, `-`). Upper-case letters are changed to lower case. An empty username means `admin`.
   - Password: at least 8 characters and at most 1024 characters, not counting spaces at the start and the end.
3. The **Bootstrap token** field appears. On the server, read the token (`cat config/.bootstrap-token`). Paste it into the field and press **OK** again.
4. The server creates the superuser, deletes `config/.bootstrap-token`, and signs you in. Next time, sign in with the username and password.

Who can do the first setup:

- Only a person who knows the token. On Linux the file mode is 0600, so only the account that runs the server (and root) can read the token. In practice, only an operator of the server host can set the first password.
- The server does not check where the request comes from. With the default `adminBindHost: 127.0.0.1`, the console is reachable only on the server host or through an SSH tunnel. If you open the console to other hosts, the token still protects the first setup.
- Every failed attempt counts as a failed login. This includes the first **OK** without a token. After 5 failed logins within 1 minute from one address range (IPv4 /24, IPv6 /64), the server answers `429` for 1 minute.

### Client

#### Enroll with a Code

This is the recommended way. The control port must use TLS (`tls: true` in `config/server.yaml`).

1. In the admin console, open **Trusted clients**, add the client, and copy the command that it shows. You can also press **Enrollment code** on an existing client. The code works once and expires after 15 minutes.
2. On the client host, run the command:

   ```shell
   ./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
   ```

   `client join` writes `config/client.yaml` (mode 0600) and `config/server-ca.pem`, then stops. It does not overwrite an existing `client.yaml` unless you add `--force`. With `--force`, the old file is kept as `client.yaml.bak`.
3. Start the client. No options are needed:

   ```shell
   ./TTTGate-linux-x64 client          # or: client -daemon
   ```

The code never travels over the network. The client derives a lookup value and a key from it, and the server seals its answer with that key. If another host is in the middle, the answer does not open, and `client join` writes nothing.

`client join` writes these values to `client.yaml`: `host`, `port`, `tls: true`, `name` and `clientId` (both the client ID), `clientSecret`, `serverName` and `ca: server-ca.pem`. A relative `ca` path in `client.yaml` starts at the `config/` directory.

#### Set Up by Hand

1. Prepare `config/client.yaml` from `config/client.sample.yaml`.
2. Set `clientId` to a trusted client that is registered on the server. Give its secret in one of these ways (first match wins):
   1. `-clientSecret <secret>`. Not recommended: other users of the host can read command lines.
   2. `-clientSecretFile <path>`: the file holds only the secret.
   3. The `TTTGATE_CLIENT_SECRET` environment variable.
   4. `clientSecret` in `config/client.yaml`.
3. When the control listener uses TLS, set `ca` and `serverName`.
4. Start the client:

   ```shell
   TTTGATE_CLIENT_SECRET=... ./TTTGate-linux-x64 client -addr tls://example.com:9126 -clientId client-a -ca /etc/tttgate/ca.pem
   ```

`TTTGate client --help` lists the options in groups. `--help-advanced` adds the legacy and risky options. The [Client Options](#client-options) table describes every client option.

#### Check and Save the Client Settings

- `client config show [options]`: print the resolved options and where each value comes from. Secrets are hidden.
- `client config save [options]`: save the resolved options to `config/client.yaml` without connecting.
- `client run [options]`: the same as `client [options]`.

See [Modes and Commands](#modes-and-commands) for details.

### Command-Line Reference

The general form is:

```
TTTGate <server|client|stop> [command] [options]
```

#### Argument Syntax

- **Mode word.** The first word that is not an option and not an option value is the mode: `server`, `client` or `stop`. Options can come before or after the mode. `TTTGate -adminPort 9400 server` and `TTTGate server -adminPort 9400` are the same. Write the mode in lower case.
- **Commands.** Only `client` has commands: `run`, `join <addr>`, `config show` and `config save`. Write them right after `client`. Any other extra word is an error (`unexpected argument '...'`).
- **Dashes.** An option can start with any number of dashes. `-addr`, `--addr` and `---addr` are the same. The help shows one dash, and two dashes when the name contains a dash (`--yes-insecure`).
- **Names are case-sensitive.** `-adminport` is an unknown option. The program suggests `-adminPort`.
- **Values.** An option that takes a value reads the next word (`-addr gw.example.com`) or the text after `=` (`-addr=gw.example.com`). The next word is used even when it starts with a dash, so `-bufferLimit -1` works. An empty value is an error (`option '-addr' needs a value`).
- **Flags.** A flag without a value is on. A flag also accepts one truth word, as the next word or after `=`: `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off` (any case). `false`, `0`, `no` and `off` turn the flag off. Examples: `-tls false`, `-reset=no`, `-requireCsrfHeader off`. Any other value after `=` is an error.
- **Exact options.** Write `-daemon` exactly like this: one dash, no value, no `=`. `--daemon` and `-daemon=true` are errors.
- **Options without a mode.** Without a mode, only `-h`, `--help`, `--help-advanced` and `--version` are allowed. Other options give `option '...' needs a mode (server, client or stop)`.
- **Options in the wrong place.** An option of another mode is an error (`option '-adminPort' is not available in client mode`). An option of another command is also an error (`option '-save' is not available in 'client join'`).
- **Unknown options.** An unknown option stops the program. When an option of that mode is close to it (2 or fewer changed letters, case ignored), the program names it: `unknown option '-adr'. Did you mean '-addr'?`.
- **Whole-line check.** The program checks the whole command line before it starts anything. It prints each error as `TTTGate: <error>`, then `Run 'TTTGate <mode> --help' for usage.`, and exits with code 2.

#### Modes and Commands

| Mode or command | What it does | Accepted options | Notes |
|---|---|---|---|
| `server` | Start the tunnel server and the admin console. | All [server options](#server-options), `-daemon` | `TTTGate server --help` shows the options. |
| `client` | Start a tunnel client. | [Client options](#client-options) except `--code` and `--force` | Reads `config/client.yaml` when it exists. |
| `client run` | The same as `client`. | The same as `client` | Use it when a script needs an explicit command. |
| `client join <addr>` | Enroll this client with a code from the admin console. Write `config/client.yaml` (mode 0600) and `config/server-ca.pem`, then stop. | `--code` (required), `--force` | `<addr>` uses the `-addr` format. The default port is 9126. `tcp://` is refused: the control port must use TLS. It does not connect a tunnel and does not write pid files. |
| `client config show` | Print the resolved client options and the source of each value (`default`, `client.yaml`, `environment`, `file`, `command line`, `inferred`). | Client options except `-daemon`, `-save`, `--code`, `--force` | Does not connect. Shows `clientSecret`, `key` and `privateKey` as `(hidden)` and PEM text as `(PEM text)`. When `client.yaml` holds insecure fields, it prints a warning and still shows the values (exit code 0). |
| `client config save` | Save the resolved client options to `config/client.yaml` without connecting. | The same as `client config show` | Prints `Saved <path>`. Saves the same content as `-save` (see [Client Options](#client-options)). |
| `stop` | Stop the TTTGate processes that this installation recorded: daemons and foreground runs, server and client. | Only the help options | See [Stop Background Processes](#stop-background-processes). |

`client join`, `client config show` and `client config save` do not print the version banner. Scripts can read their output.

#### Server Options

Each option applies to the `server` mode.

| Option | Value | Default | How long it lasts | Details |
|---|---|---|---|---|
| `-adminPort <port>` | Whole number 1–65535 | `9300` | Saved to `server.yaml` (`adminPort`) | Port of the admin console. A bad value stops the server with exit code 1 (`Invalid admin port number (1 ~ 65535)`). Example: `server -adminPort 9400`. |
| `-keepAlive <ms>` | Whole number, 0 or more | `10000` | Saved to `server.yaml` (`keepAlive`) | TCP keepalive interval of the control listener. A negative or non-numeric value stops the server with exit code 1 (`Invalid keep alive time`). Example: `server -keepAlive 30000`. |
| `-trustXForwardedFor` | Flag | Off | This run only | Read the admin client address from `X-Forwarded-For`. Use it only behind a reverse proxy that you control. To open the console through the proxy, also add the proxy address to `adminAllowedOrigins`. The server logs a warning at startup while it is on. Example: `server -trustXForwardedFor -trustedProxyHops 1`. |
| `-trustedProxyHops <n>` | Whole number 1–16 | `1` | This run only | Number of trusted proxies in front of the admin server. See the notes below. A bad value gives a startup warning, and the server uses 1. Without `-trustXForwardedFor`, it has no effect and gives a warning. |
| `-reset` | Flag | Off | Action at this start | Delete every file in the `config/` directory (`server.yaml`, `.key`, `.bootstrap-token` and the other stored state) and the stored certificates, then start with defaults. `-reset` and `-reset true` reset. `-reset false` does nothing. **Risk:** tunnels, trusted clients and admin accounts are lost. |
| `-allowLegacyAdminHttp` | Flag | Off | This run only | Allow `adminTls: false` (legacy non-TLS admin mode). **Risk:** the admin console and its session cookies travel in plain text. Shown by `--help-advanced`. |
| `-allowLegacyAdminRemote` | Flag | Off | This run only | Allow a non-loopback `adminBindHost`. **Risk:** the admin console is reachable from other hosts. Shown by `--help-advanced`. |
| `-allowLegacyControlAuth` | Flag | Off (`allowLegacyControlAuth: false`) | Saved to `server.yaml` (`allowLegacyControlAuth`) | Allow legacy shared-key control authentication. It stays on in later runs until you start once with `-allowLegacyControlAuth false` or edit `server.yaml`. **Risk:** legacy data connections carry no binding token, so anyone who guesses a data handler ID can take over a session and read or inject external user traffic. The server logs a warning at startup while it is on. Shown by `--help-advanced`. |
| `-requireCsrfHeader false` | Flag | On | This run only | `-requireCsrfHeader false` turns off the CSRF header check of the admin API. **Risk:** other web pages can send admin requests with the session cookie. Shown by `--help-advanced`. |
| `-daemon` | Exact flag | Off | This run only | Run in the background with process monitoring. See [Run in the Background](#run-in-the-background). |

Notes on `-trustedProxyHops`:

- The admin client address is taken from the right end of `X-Forwarded-For`, skipping this many entries. Clients can write anything on the left.
- Set it to the **exact** number of proxies. A larger value lets a client choose its own address again and evade the login lockout. A smaller value puts every admin behind the same proxy address. Then one lockout locks out everyone, and MFA tickets can fail when that address changes.
- Let only the proxy reach the admin port. If clients can connect directly, they also control the rightmost value.
- Upgrade note: earlier versions read the **leftmost** value. Check this setting when you upgrade.

#### Client Options

"Run commands" means `client`, `client run`, `client config show` and `client config save`. "Saved by `-save`" means that `-save` and `client config save` write the resolved value to `config/client.yaml`. Without them, the value lasts for this run only.

| Option | Commands | Value | Default | How long it lasts | Details |
|---|---|---|---|---|---|
| `-addr <host:port>` | Run commands | `host`, `host:port`, `IPv4:port`, `[IPv6]:port` or an IPv6 address without a port. An optional `tls://` or `tcp://` prefix selects the transport. Port 1–65535. No path or query. | Host `localhost`, port `9126` | Saved by `-save` (as `host` and `port`) | Server address. Example: `-addr tls://gw.example.com:9126`, `-addr [2001:db8::7]:9126`. A bad address, or a prefix that disagrees with `-tls`, is an error (exit code 2). |
| `-tls` | Run commands | Flag | Off | Saved by `-save` | Use TLS on the control connection. `-ca`, `-serverName`, `-cert` and `-privateKey` on the command line also turn TLS on. Together with `-tls false` or `tcp://`, they are an error (exit code 2). |
| `-clientId <id>` | Run commands | Text | None | Saved by `-save` | Protocol v2 client identifier. It must match a trusted client on the server. |
| `-clientSecret <secret>` | Run commands | Text | None | Saved by `-save` | Protocol v2 shared secret. Not recommended: other users of the host can read command lines, and the client logs a warning. You cannot use it together with `-clientSecretFile` (exit code 2). |
| `-clientSecretFile <path>` | Run commands | File path. A relative path starts at the working directory. | None | The secret (not the path) is saved by `-save` | Read the protocol v2 shared secret from a file. The file holds only the secret. Spaces and line breaks at the ends are removed. A missing, unreadable or empty file stops the client with exit code 78. Example: `-clientSecretFile /etc/tttgate/client-a.secret`. |
| `-name <name>` | Run commands | Text | A random tunnel name | Saved by `-save` | Client name for legacy connections and local logs. A v2 server always shows the name registered for the `clientId`. Alias: `-displayName` (deprecated, gives a warning). Different values for `-name` and `-displayName` are an error (exit code 2). |
| `-ca <path\|pem>` | Run commands | File path or PEM text | None | Saved by `-save` (as a path) | Trusted CA or pinned server certificate. Turns TLS on. A relative path on the command line starts at the working directory. A relative path in `client.yaml` starts at the `config/` directory. A file that is missing or has no certificate stops the client with exit code 78. |
| `-serverName <name>` | Run commands | Text | None | Saved by `-save` | Expected TLS server name. Turns TLS on. Clients that pin the control port certificate use `tttgate-control`. |
| `-cert <path\|pem>` | Run commands | File path or PEM text | None | Saved by `-save` (as a path) | Client certificate for mutual TLS. Turns TLS on. The path rules of `-ca` apply. |
| `-privateKey <path\|pem>` | Run commands | File path or PEM text | None | Saved by `-save` (as a path) | Private key of `-cert`. Turns TLS on. The path rules of `-ca` apply. Error messages do not show the path, because the value can be key text that was put in the wrong place. |
| `-save` | `client`, `client run` | Flag | Off | Writes `config/client.yaml` | Save the resolved options to `config/client.yaml`, then start the client. See the notes below. `-save false` writes nothing. |
| `--code <code>` | `client join` | 12 letters or digits, for example `7Q4K-M2XP-AB01` | None (required) | Used once | Enrollment code from the admin console. Dashes and spaces are ignored, and case does not matter. `O` is read as `0`, and `I` and `L` as `1`. The code works once and expires after 15 minutes. |
| `--force` | `client join` | Flag | Off | This run only | Replace an existing `config/client.yaml`. The old file is kept as `client.yaml.bak`. Without it, an existing file stops `client join` with exit code 78. |
| `-bufferLimit <MiB>` | Run commands | `-1` (no limit) or a whole number 16–1048576 | `128` | Saved by `-save` (as `globalMemCacheLimit`) | Memory buffer limit. Another value is an error (exit code 2). Example: `-bufferLimit 256`. |
| `-keepAlive <ms>` | Run commands | Whole number, 0 or more | `10000` | Saved by `-save` | TCP keepalive interval of the control connection. A bad or negative value gives a warning, and the client uses 10000. |
| `-key <key>` | Run commands | Text | Built-in legacy key | Saved by `-save` | Legacy shared key. It is used only with explicit legacy control auth. **Risk:** the key is sent to any server that answers with the legacy protocol. On the command line, it gives a warning. Shown by `--help-advanced`. |
| `-allowLegacyFallback` | Run commands | Flag | Off | This run only. Never saved | Allow v1 fallback, only when the server explicitly enables legacy auth. **Risk:** a fake server can answer with the legacy protocol and receive the shared key. The client logs a warning at startup while it is on. Shown by `--help-advanced`. |
| `-allowInsecureTls` | Run commands | Flag | Off | This run only. Never saved | Disable certificate verification. **Risk:** anyone on the network path can impersonate the server. Keep it off outside break-glass scenarios. Shown by `--help-advanced`. |
| `--yes-insecure` | Run commands | Flag | Off | This run only | Accept `allowInsecureTls` or `allowLegacyFallback` written in `client.yaml` for this run. Without it, such a file stops the client with exit code 78 (`REFUSE-INSECURE-YAML`). Alias: `--yesInsecure`. Shown by `--help-advanced`. |
| `-daemon` | `client`, `client run` | Exact flag | Off | This run only | Run in the background with process monitoring. See [Run in the Background](#run-in-the-background). |

Notes on `-save` and `client config save`:

- They write the resolved options, not only the options that you typed. This includes the secret from `-clientSecret`, `-clientSecretFile` or `TTTGATE_CLIENT_SECRET`.
- `allowInsecureTls` and `allowLegacyFallback` are never saved.
- The file keeps paths, not file contents. A relative path from the command line is saved as an absolute path, so the next start finds the same file.
- On Linux the file mode is 0600.

#### Where Client Values Come From

The client builds its options in this order. A later step overwrites an earlier one.

1. Built-in defaults.
2. `config/client.yaml`, when it exists.
3. The `TTTGATE_CLIENT_SECRET` environment variable (secret only).
4. `-clientSecretFile` (secret only).
5. Other command-line options.

For the secret, the result is: `-clientSecret`, then `-clientSecretFile`, then `TTTGATE_CLIENT_SECRET`, then `clientSecret` in `client.yaml`. The client reads no other environment variables for its options.

More rules:

- When `client.yaml` sets `ca`, `serverName`, `cert` or `privateKey` but `tls` is `false`, the client does not use them and logs a warning. Set `tls: true` to use them.
- `displayName` in `client.yaml` is read as `name` when `name` is missing. When both are set and differ, the client uses `name` and logs a warning.
- `client config show` prints the source of each value.

The server reads its options from `config/server.yaml`. `-adminPort`, `-keepAlive` and `-allowLegacyControlAuth` first write their value to that file. The other server options apply only to that run.

#### Run in the Background

`-daemon` starts two background processes: the app and a sentinel that watches it.

- Before it starts them, the program checks the options and the config file. For the server, it checks `server.yaml` (YAML syntax and admin security policy). For the client, it resolves all options and files. Errors show in your terminal.
- It first stops the TTTGate processes that this installation recorded (an old daemon or a foreground run), when it can confirm them.
- The sentinel checks the app every 3 seconds. When the app is gone, the sentinel starts it again after 3 seconds.
- A daemon whose app stops with a configuration error is not restarted. The reason is in `logs/`. Fix the configuration and start again.
- Stop the daemon with `TTTGate stop`.

#### Help and Version

| Command | Output |
|---|---|
| `TTTGate` (no arguments) | The version and the list of modes |
| `TTTGate --help`, `TTTGate -h` | The list of modes |
| `TTTGate server --help` | Server options in groups: Admin, Proxy, Identity, Run, Tuning |
| `TTTGate client --help` | Client commands and options in groups: Connection, Identity, TLS trust, Run, Tuning |
| `TTTGate stop --help` | The `stop` usage |
| `--help-advanced` | The same as `--help`, plus legacy and risky options with a `RISK:` line, and aliases |
| `--version` | `TTTGate v<version> (<build>)` |

Help and version do not start anything. They exit with code 0.

#### Errors and Exit Codes

The program checks the whole command line before it starts anything. With `-daemon`, the program checks the options and the config file before it starts the background processes, so the errors show in your terminal.

| Code | Meaning |
|---|---|
| 0 | Normal end, help, version |
| 1 | Error while running. Server option errors also use 1. `client join`: the server refused the code, the answer could not be verified, or a network error |
| 2 | Command-line error: unknown option or mode, missing or bad value, options that conflict |
| 78 | Configuration file error: insecure fields in `client.yaml`, a CA, certificate, key or secret file that is missing or not valid. `client join`: `client.yaml` exists without `--force`, or the files cannot be written |

A daemon whose app stops with a configuration error is not restarted. The reason is in `logs/`. Fix the configuration and start again.

#### Command-Line Examples

Start a server in the foreground:

```shell
./TTTGate-linux-x64 server
```

Start a server in the background, then stop it:

```shell
./TTTGate-linux-x64 server -daemon
./TTTGate-linux-x64 stop
```

Change the admin console port. The new port is saved, so later starts use 9400 without the option:

```shell
./TTTGate-linux-x64 server -adminPort 9400
```

Run the server behind one reverse proxy that you control:

```shell
./TTTGate-linux-x64 server -trustXForwardedFor -trustedProxyHops 1
```

Enroll a client with a code, then start it in the background:

```shell
./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
./TTTGate-linux-x64 client -daemon
```

Enroll again and replace the existing `client.yaml`:

```shell
./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01 --force
```

Run a client by hand with TLS and a secret file:

```shell
./TTTGate-linux-x64 client -addr tls://gw.example.com:9126 -clientId client-a \
    -clientSecretFile /etc/tttgate/client-a.secret -ca /etc/tttgate/server-ca.pem -serverName tttgate-control
```

Check the resolved client settings, then save them without connecting:

```shell
./TTTGate-linux-x64 client config show -addr tls://gw.example.com:9126 -clientId client-a
./TTTGate-linux-x64 client config save -addr tls://gw.example.com:9126 -clientId client-a \
    -clientSecretFile /etc/tttgate/client-a.secret -ca /etc/tttgate/server-ca.pem
```

### Operations

#### Log Level

`logLevel` in `config/server.yaml` sets which server logs are written. The values are `error`, `warn`, `info` (default) and `debug`. A missing value means `info`.

- Change it in the admin console (**Server settings** → **Log level**) or with `POST`/`PUT /api/serverOption`.
- The new level applies at once to all log output (files and console). You do not need to restart the server.
- Any other value is rejected with `400`, and `server.yaml` does not change.
- Use `debug` only while you investigate a problem. It writes much more and can fill the disk.
- Audit logs (`logs/audit`) are not affected.
- A wrong value written directly in `server.yaml` fails config validation at startup.
- Upgrade note: earlier versions also wrote `debug` lines by default. Set `logLevel: debug` to keep that output.

#### Connection Close Timeouts

When the server closes a tunnelled connection, it first sends the remaining output. Then it waits for the peer to close. Two options in `config/server.yaml` limit these waits:

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
- Increase `closeStallMs` when slow users download large files. The slowest reader that the server waits for is about (one third of the kernel send buffer) / `closeStallMs`. On Linux with the default 60000, this is about 25 KiB/s.
- Decrease them on a small server to free connections sooner.

#### Stop Background Processes

```shell
./TTTGate-linux-x64 stop
```

`stop` reads the pid files in the `bin` folder (`.pid_sentinel`, `.pid_app`, `.pid_foreground`). It stops the sentinel first, then the app, then foreground runs. It stops a process only when it can confirm that the process is the one that TTTGate recorded:

- On Linux, it compares the start time in `/proc/<pid>/stat` and the executable.
- On Windows, it asks `Get-Process` for the start time and the executable.

If it cannot confirm a process, it does not stop it. It writes a warning with the pid and the pid file.

- **Use the same user.** Stop and start TTTGate as the user that started it. A user without administrator rights cannot stop, or on Windows identify, a daemon that an administrator started.
- **A start is refused while an old daemon runs.** If `-daemon` finds a TTTGate process that it could not stop, it does not start a second pair (the ports would collide). It names the pid and the pid file and exits with code 1. Stop that process, or delete the pid file if that pid is not TTTGate, and start again.

### Upgrading an Existing Server

Read this before you replace a running server with this version.

#### Changes in the Client Command Line and Trusted Clients

- The control port certificate is now stored in `cert/control.cert.pem` and kept across restarts. Its only name is `tttgate-control`. Clients that pin it use `serverName: tttgate-control`. `client join` sets both for you.
  - The certificate is valid for one year. The server makes a new one at start when fewer than 30 days remain. After that, every client must enroll again (or pin the new certificate). Restart the server at a planned time before the year ends.
- Trusted clients can no longer be changed through `POST /api/serverOption`. Use `/api/trustedClients` or the **Trusted clients** screen. `GET /api/serverOption` shows `********` in place of client secrets. When you send the masked list back, the stored secrets are kept.
- Adding or removing a trusted client no longer restarts the control listener. Only the removed client, or a client whose secret was renewed, is disconnected.
- The control connection now has a heartbeat. A client pings every 10 seconds. Either side closes the control connection after 30 seconds without any control packet, and the client then reconnects. This finds connections that are cut without a FIN or RST (a pulled cable, an expired NAT entry). The heartbeat is used only when both sides support it, so older servers and clients work as before.
- The client stops with an error for options that it does not know (exit code 2). It also stops for a `-ca`, `-cert`, `-privateKey` or `-clientSecretFile` file that it cannot read (exit code 78). Check your service scripts.
- `stop` now stops only the processes that it can confirm as the TTTGate processes it recorded. Before, it stopped every pid in the pid files, including old pids that the system may have given to another program. See [Stop Background Processes](#stop-background-processes).
  - The pid files now hold one JSON object per line (for example `{"pid":1234,"start":…}`) in place of a bare pid. If your own scripts read them, read the `pid` field. Older pid files are still read.

#### Steps That Stop the Server or the Tunnels Unless You Act

1. **Admin console security policy.** Earlier versions served the admin console over plain HTTP on all interfaces. This version refuses to start (exit code 1) while `adminTls` is `false` or `adminBindHost` is not a loopback address. Do one of these before you start it:
   - Set `adminTls: true` and `adminBindHost: 127.0.0.1` in `config/server.yaml`, and reach the console through an SSH tunnel. This is the recommended setup.
   - Or start with `-allowLegacyAdminHttp` and `-allowLegacyAdminRemote` for that run while you move to the setup above.
2. **Existing clients.** Clients of earlier versions (1.0.10 and older) authenticate with the shared key only. This version turns that off by default, so every tunnel disconnects until you do one of these:
   - Start the server with `-allowLegacyControlAuth` (or set `allowLegacyControlAuth: true`) for the rollout window. Then upgrade the clients with `clientId` and `clientSecret` (see [Mixed-Version Rollout Policy](#mixed-version-rollout-policy)). The flag saves `allowLegacyControlAuth: true` to `server.yaml`. When the window ends, start once with `-allowLegacyControlAuth false` or set the value to `false`.
   - Upgrade the clients first. Do not do this when you have the tunnels in step 3.
3. **Tunnels to a destination with an untrusted certificate.** A client of this version verifies the certificate of the destination server. Clients of earlier versions (1.0.10 and older) did not. This applies to tunnels with **Secure tunneling Server/Client** checked (`tls: true`) and to every HTTPS tunnel. After you upgrade a client, such a tunnel to a destination with a self-signed (or otherwise untrusted) certificate fails with a certificate error, for example `self-signed certificate`. If you have such tunnels, do one of these:
   - Upgrade the server first, with `-allowLegacyControlAuth` as in step 2, so that 1.0.10 clients stay connected. In the admin console, open each such tunnel and check **Skip certificate verification (allow self-signed)** (`allowSelfSignedDestinationCert: true`). Then upgrade the clients with `clientId` and `clientSecret` as in step 2. A server of an earlier version cannot send this option, so do not upgrade the clients first.
   - Give the destination a certificate from a public CA that Node.js trusts, and that matches the destination host of the tunnel. The client's `-ca` option applies only to the control connection, not to destinations. A certificate for a DNS name fails when the tunnel uses an IP address, and the other way round.

   With the option checked, the client accepts any certificate from the destination server. Use it only on a trusted network. The tunnel list marks these tunnels with **cert not verified**.

#### Values That Are Adjusted Automatically

The server logs a warning at startup for each of these:

- **Per-tunnel rate limiting** stays off for every tunnel that was saved without a `rateLimit` field. The protocol defaults are stored with it (TCP: 30 connections per 60 s, HTTP/HTTPS: 300; a 10-minute ban when exceeded), so you only switch it on per tunnel in the admin console. New tunnels start with it on.
- **Session idle TTL** stays off (`sessionTtlMs: 0`) when the file has no `sessionTtlMs`. New installations close a session after one hour without traffic. Set `sessionTtlMs` (1000–3600000 ms) to turn it on. When it is on, long idle SSH or database connections without keepalive are closed. A `PUT /api/serverOption` call that omits `sessionTtlMs` sets it back to one hour. The admin console always sends the current value.
- **Server buffer** `-1` or `0` ("unlimited" in earlier versions) becomes the default 8 MiB. An unlimited buffer can exhaust the memory of a small server. Data keeps flowing with backpressure once a session is open.

#### Other Changes to Be Aware Of

- Saving an **Online** tunnel (a new port, other settings or a new certificate) keeps its activation switch and its timer. In 1.0.10, saving reset them: a tunnel with **Inactive on startup** checked was switched off, any other tunnel was switched on, and the timer started again. **Inactive on startup** applies when the server starts, when a tunnel is created, and when you save a tunnel that is not **Online** (the tunnel list shows **Error**, for example after a port bind failure).
- HTTP tunnels reject a request whose header block is larger than 64 KiB (earlier: 8 MiB) with `431`.
- Admin passwords are limited to 1024 characters (leading and trailing whitespace is not counted). A longer password cannot be set, and a login with a longer password fails without a password check. If you use a longer password, change it before you upgrade.
- The admin server handles at most 5 login requests (`/api/login` and `/api/login/mfa` together) at the same time from one network (IPv4 /24, IPv6 /64). More requests get `429` with code `login_concurrency_limit`. Try again after the earlier requests finish.
- The admin server keeps at most 20 login sessions per user and 10,000 in total. A new login closes the session that was used least recently and records a `session_killed` audit event with actor `system`. Scripts that log in to the admin API must call `POST /api/logout` when they finish. Otherwise each run closes an older session of the same account, for example a browser session.

### Mixed-Version Rollout Policy

- Default rollout target: `controlProtocolMode: mixed`.
- Secure target state: `controlProtocolMode: mtls-strict`.
- Legacy shared-key control auth stays off unless you use `-allowLegacyControlAuth` deliberately.
- Client-side `allowLegacyFallback` should remain `false` unless you are in an approved rollback window.
- Both legacy switches weaken session binding and key secrecy (see [Command-Line Reference](#command-line-reference)). Turn them off when the rollback window ends.
- Unauthenticated tunnel connections, including those still in the TLS handshake, close at the handshake deadline (15 s by default, sized for a 0.5-core server that swaps).
- A session whose data connection does not arrive closes after 60 s.
- The client gives up on an unreachable endpoint after 45 s.

Recommended cutover order:

1. Register protocol v2 trusted clients on the server.
2. Upgrade clients with `clientId` and `clientSecret`.
3. Verify mixed-version connectivity and the rollback path.
4. Disable legacy rollout exceptions.
5. Move the control listener to TLS + `mtls-strict` when the fleet is ready.

### HTTP Tunnel CORS Policy

`replaceAccessControlAllowOrigin` is a compatibility policy flag, not a security hotfix.

- New tunnel configs default to `false`.
- Existing saved configs with the field unset keep the legacy reflection behavior until you set the field explicitly.
- Credential-bearing backends should move to explicit allowlists instead of origin reflection.

## 한국어

### 목차

- [개요](#개요)
- [빠른 시작](#빠른-시작)
- [실행 환경](#실행-환경)
- [설정 파일](#설정-파일)
- [서버](#서버)
- [웹 관리 화면](#웹-관리-화면)
- [클라이언트](#클라이언트)
- [명령줄 레퍼런스](#명령줄-레퍼런스)
- [운영](#운영)
- [기존 서버 업그레이드](#기존-서버-업그레이드)
- [버전 혼합 배포 정책](#버전-혼합-배포-정책)
- [HTTP 터널 CORS 정책](#http-터널-cors-정책)

### 개요

TTTGate 는 서버와 클라이언트가 짝을 이뤄 내부망의 TCP/HTTP 서비스를 터널로 바깥에 내보내는 도구다.

- **서버**는 사용자가 접속할 수 있는 호스트에서 돈다. 터널 포트를 열고 웹 관리 화면을 제공한다.
- **클라이언트**는 NAT 뒤 같은 내부망에서 돈다. 서버로 먼저 연결한 뒤, 터널로 들어온 트래픽을 내부 서비스로 넘긴다.

이 버전은 기본값을 세 가지 면에서 안전하게 잡았다.

- 관리 화면은 기본으로 `127.0.0.1` 에만 열리고 TLS 를 쓴다.
- 클라이언트는 프로토콜 v2 클라이언트 신원(`clientId` 와 `clientSecret`)으로 신뢰를 확인한다.
- 새로 만든 HTTP 터널은 요청의 `Origin` 을 `Access-Control-Allow-Origin` 으로 되돌려 주지 **않는다**.

예시의 `./TTTGate-linux-x64` 는 Linux x64 실행 파일이다. 쓰는 플랫폼에 맞는 실행 파일로 바꿔 실행한다.

### 빠른 시작

1. 서버 호스트에서 서버를 시작한다.

   ```shell
   ./TTTGate-linux-x64 server
   ```

2. 서버 호스트에서 `https://127.0.0.1:9300/` 을 연다. 다른 컴퓨터에서 열려면 먼저 SSH 터널을 만든다([다른 컴퓨터에서 관리 화면 열기](#다른-컴퓨터에서-관리-화면-열기) 참고).
3. `config/.bootstrap-token` 의 토큰으로 첫 관리자 계정을 만든다([첫 관리자 로그인](#첫-관리자-로그인) 참고).
4. 제어 포트가 TLS 를 쓰는지 확인한다(`config/server.yaml` 의 `tls: true`). 관리 화면에서 **Trusted clients** 를 열고 클라이언트를 추가한 뒤, 화면에 나온 명령을 복사한다.
5. 클라이언트 호스트에서 복사한 명령을 실행하고, 클라이언트를 백그라운드로 시작한다.

   ```shell
   ./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
   ./TTTGate-linux-x64 client -daemon
   ```

6. 관리 화면에서 터널을 추가한다.

### 실행 환경

소스로 설치하거나 서버·관리 UI 를 빌드할 때는 Node.js 24 LTS 이상(최소 `24.0.0`)을 쓴다. nvm 을 쓴다면 `nvm use` 를 먼저 실행한다. 그다음 `npm ci` 와 `npm ci --prefix admin` 으로 잠근 버전의 의존성을 설치한다.

단독 실행 파일에는 Node.js 24 가 들어 있어서 Node 를 따로 설치하지 않아도 된다. 실행 파일은 잠근 버전의 `@yao-pkg/pkg` 도구로 `npm run pkg` 를 실행해 만든다. 지원 대상은 Linux x64/ARM64, Windows x64/ARM64, Alpine x64 다.

#### 작은 서버의 메모리

서버는 메모리 버퍼를 프로세스 전체에 정해 둔 예산 안에서만 쓴다. 그래서 512 MB 인스턴스로도 충분하다.

| 예산 | 기본값 | 한도에 닿으면 |
|---|---|---|
| 소켓 메모리 버퍼(`globalMemCacheLimit`) | 128 MiB | 넘치는 데이터는 디스크의 파일 캐시로 옮겨 간다 |
| 아직 열리는 중인 세션의 대기열 | 모든 클라이언트 합쳐 64 MiB, 클라이언트마다 32 MiB | 75 % 에서 보내는 쪽을 멈추고, 한도를 넘길 세션은 닫는다 |
| 대역폭 제한 대기열(`rate_limit` 프리셋이 있는 그룹) | 모든 세션 합쳐 64 MiB | 대기열이 있는 세션은 75 % 에서 보내는 쪽을 멈추고 50 % 에서 다시 보낸다 |
| HTTP 본문 다시 쓰기(`rewriteHostInTextBody`) | 한 번에 32 MiB 예약 | 진행 중인 다시 쓰기가 끝날 때까지 다른 응답은 다시 쓰지 않고 그대로 넘긴다 |

- Node.js 런타임 자체가 약 60–100 MB 를 쓴다.
- 본문을 다시 쓰는 동안에는 압축을 푼 본문과 그 사본을 함께 들고 있다. 그래서 최대 사용량은 예약량의 약 세 배다.
- 진행 중인 TLS 핸드셰이크(포트마다 최대 1,024개)와 연결마다 쓰는 헤더 버퍼(64 KiB)는 따로 더해진다.
- 모두 합쳐도 최악의 경우 약 450 MB 다. 512 MB 인스턴스에서는 짧은 순간의 최대치를 견디도록 스왑을 켜 둔다.
- 이 예산은 코드에 들어 있는 기본값이며 `server.yaml` 에서 설정하지 않는다.

**커널 소켓 버퍼.** Linux 는 TCP 소켓 버퍼도 서버 프로세스의 메모리로 계산한다. 받는 쪽이 느리게 읽으면 커널은 소켓마다 `tcp_rmem`/`tcp_wmem` 의 최대값(기본 6 MiB / 4 MiB)까지 버퍼를 잡는다. 이 메모리는 위 예산 밖이다. 512 MB 인스턴스에서는 상한을 낮춘다.

```
# /etc/sysctl.d/90-tttgate.conf
net.ipv4.tcp_rmem = 4096 131072 1048576
net.ipv4.tcp_wmem = 4096 16384 1048576
```

`sudo sysctl --system` 으로 적용한다. 보통 회선의 처리량은 그대로 두면서, 느리게 읽는 쪽이 메모리를 채우지 못하게 막는다.

**512 MB / 0.5코어 제한에서 잰 결과** (cgroup v2: `MemoryMax=512M`, `MemorySwapMax=4G`, `CPUQuota=50%`, 커널 소켓 버퍼 기본값, 루프백):

| 부하 | 결과 | 서버 메모리 최대치 |
|---|---|---|
| 동시 연결 200개, 연결마다 256 KiB 왕복 | 200/200, p95 4.2 s | 69 MiB |
| 짧은 연결 3,000개, 한 번에 50개씩 | 3,000/3,000, p95 119 ms | 76 MiB |
| 100 MiB 스트림 4개 병렬 | 4/4 손상 없음, 각 3.4 s | 142 MiB |
| 부하 중 클라이언트 재시작 | 133 ms 뒤 터널 복구, 3,000/3,000 | 142 MiB |
| 연결 50개 × 20 MiB, 읽는 쪽 5초 멈춤 | 50/50, OOM 없음 | 512 MiB(프로세스 힙 135 MiB, 커널 소켓 버퍼 501 MiB), 스왑 113 MiB |

마지막 경우는 위의 소켓 버퍼 상한으로 막을 수 있다.

### 설정 파일

| 파일 | 내용 |
|---|---|
| `config/server.yaml` | 서버 실행 설정 |
| `config/client.yaml` | 클라이언트 실행 설정 |
| `config/server.sample.yaml`, `config/client.sample.yaml` | 저장소에 포함된 샘플 |
| `config/.bootstrap-token` | 첫 관리자 로그인에 쓰는 일회용 토큰 |
| `config/.key` | 관리자 비밀번호 해시 |
| `config/server-ca.pem` | `client join` 이 클라이언트에 써 두는 서버 인증서 |

예전에 저장소 최상위에 두던 `config.yaml` 은 더 이상 쓰지 않는다.

### 서버

#### 서버 시작하기

1. 릴리스 묶음을 빌드하거나 압축을 푼다.
2. `config/server.sample.yaml` 을 바탕으로 `config/server.yaml` 을 만든다.
3. `trustedClients` 의 예시 비밀값을 실제 값으로 바꾼다. 또는 그 항목을 지우고 관리 화면(**Trusted clients**)에서 클라이언트를 추가한다.
4. 서버를 시작한다.

   ```shell
   ./TTTGate-linux-x64 server
   ```

5. 프로세스 감시와 함께 백그라운드로 돌리려면 `-daemon` 을 붙인다. 멈출 때는 `./TTTGate-linux-x64 stop` 을 실행한다([백그라운드 프로세스 멈추기](#백그라운드-프로세스-멈추기) 참고).

`TTTGate server --help` 는 자주 쓰는 옵션을 보여 준다. `--help-advanced` 는 레거시 옵션과 위험한 옵션까지 보여 준다. 모든 서버 옵션은 [서버 옵션](#서버-옵션) 표에 있다.

#### 저장되는 서버 옵션

- `-adminPort`, `-keepAlive`, `-allowLegacyControlAuth` 는 값을 `config/server.yaml` 에 저장한다. 다음에는 옵션 없이 시작해도 저장된 값을 쓴다.
- 나머지 서버 옵션은 그 옵션을 주고 시작한 실행에만 적용된다.
- `-reset` 은 동작이다. 그 실행을 시작할 때 저장된 서버 상태를 지운다.

### 웹 관리 화면

서버에는 웹 관리 화면이 들어 있다. 터널, 사용자와 그룹, 신뢰 클라이언트, 인증서, 서버 설정을 여기서 관리한다.

#### 관리 화면 열기

`config/server.yaml` 의 다음 키가 관리 화면을 정한다.

| 키 | 기본값 | 뜻 |
|---|---|---|
| `adminPort` | `9300` | 관리 화면의 포트. `-adminPort <port>` 로 바꾸면 새 포트가 `server.yaml` 에 저장된다. |
| `adminBindHost` | `127.0.0.1` | 관리 화면이 듣는 주소. 서버를 `-allowLegacyAdminRemote` 로 시작하지 않으면 루프백 주소(`127.0.0.1`, `::1`, `localhost`)만 쓸 수 있다. |
| `adminTls` | `true` | 관리 화면을 HTTPS 로 제공한다. `false` 는 `-allowLegacyAdminHttp` 와 함께일 때만 쓸 수 있다. |
| `adminAllowedOrigins` | `[]` | 역방향 프록시나 도메인 이름으로 관리 화면을 쓸 때, 추가로 허용할 페이지 주소(origin). [다른 컴퓨터에서 관리 화면 열기](#다른-컴퓨터에서-관리-화면-열기)를 참고한다. |

기본값 그대로라면 서버 호스트의 브라우저에서 `https://127.0.0.1:9300/` 을 연다.

저장된 관리자 인증서가 없으면(예: 처음 시작할 때) 서버가 관리 화면용 자체 서명 인증서(`Testing CA - DO NOT TRUST`, 유효 기간 1년)를 만든다. 이 인증서는 자동으로 갱신되지 않는다. 브라우저에 인증서 경고가 뜨면, 올바른 주소를 열었는지 확인한 뒤 계속 진행한다.

경고를 없애려면 직접 준비한 인증서를 쓴다. **Server settings** 에서 **Admin TLS** 를 켠 상태로 개인 키(**Key**)와 인증서(**Cert**) 파일을 고른다. **CA** 는 선택 사항이다. 키와 인증서가 짝이 맞으면 서버는 새 인증서를 바로 쓴다. **Apply** 를 누르거나 서버를 다시 시작할 필요가 없다.

`adminBindHost` 가 루프백 주소가 아니거나 `adminTls` 가 `false` 이면, 그에 맞는 플래그 없이는 서버가 시작되지 않는다. 서버는 이유와 필요한 플래그를 출력한다. 예: `Refusing insecure admin policy: ...`. 이 플래그는 그 플래그를 주고 시작한 실행에만 적용된다.

관리 화면은 다음 페이지에서 온 로그인과 변경만 받는다.

- 주소가 `127.0.0.1`, `::1`, `localhost` 또는 `adminBindHost` 이고 포트가 `adminPort` 인 페이지
- origin 이 `adminAllowedOrigins` 에 있는 페이지

그 밖의 주소에는 `403 Forbidden origin` 으로 답한다.

#### 다른 컴퓨터에서 관리 화면 열기

관리 화면은 기본으로 서버 호스트에서만 열린다. 다음 방법 가운데 하나를 쓴다.

1. **SSH 터널(권장).** 서버 설정을 바꾸지 않아도 된다. 내 컴퓨터에서 다음을 실행한다.

   ```shell
   ssh -L 9300:127.0.0.1:9300 user@server.example.com
   ```

   SSH 세션을 열어 둔 채로 내 컴퓨터에서 `https://127.0.0.1:9300/` 을 연다. 로컬 포트는 `adminPort` 와 같아야 한다. 다른 로컬 포트로 열면 `403 Forbidden origin` 이 난다.
2. **서버 IP 주소에 바인드(권장하지 않음).** `adminBindHost` 를 다른 호스트가 접근할 수 있는 서버의 IP 주소(예: `192.168.0.10`)로 바꾸고, 서버를 `-allowLegacyAdminRemote` 로 시작한다. 관리 화면은 정확히 그 주소와 포트(`https://192.168.0.10:9300/`)로 연다.
   - `0.0.0.0`, `::`, 호스트 이름은 쓸 수 없다. 서버는 시작되지만 로그인이 `403 Forbidden origin` 으로 실패한다.
   - **위험:** 포트에 닿을 수 있는 누구나 비밀번호를 시도할 수 있다. 로그인 잠금은 적용된다. 관리자 계정에 2단계 인증을 켜고, `adminTls: true` 를 유지하고, 방화벽으로 포트를 제한한다.
3. **도메인 이름과 역방향 프록시.** `adminBindHost: 127.0.0.1` 은 그대로 두고, 같은 호스트의 HTTPS 프록시가 관리 화면으로 요청을 넘기게 한다.
   1. 사용자가 여는 주소를 `config/server.yaml` 에 추가한다. 스킴, 호스트, 포트를 정확히 쓴다. `https://` origin 만 받는다. HTTPS 관리 화면의 세션 쿠키는 `Secure` 라서 브라우저가 `http://` 페이지에서는 쿠키를 버리기 때문이다. 경로와 와일드카드는 받지 않는다.

      ```yaml
      adminAllowedOrigins:
        - "https://admin.example.com"
      ```

   2. 프록시를 설정한다. nginx 예시:

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

   3. 서버를 `-trustXForwardedFor -trustedProxyHops 1`(프록시 하나)로 시작한다. 그래야 로그인 잠금과 감사 로그가 실제 클라이언트 주소를 쓴다.
   - `server.yaml` 을 고친 뒤에는 서버를 다시 시작한다. 서버 옵션 API(`/api/serverOption`)로 바꾼 값은 다시 시작하지 않아도 다음 요청부터 적용된다. **Server settings** 화면은 이 목록을 건드리지 않는다.
   - 관리 화면은 `Strict-Transport-Security` 를 `includeSubDomains` 와 함께 보낸다. 예시는 이 헤더를 숨겨서, 프록시 도메인의 모든 하위 도메인에 적용되지 않게 한다. HSTS 가 필요하면 프록시에서 직접 헤더를 보낸다.
   - 다른 하위 도메인까지 직접 관리하는 호스트 이름을 쓴다. 같은 사이트의 다른 하위 도메인에 있는 페이지가 관리 화면의 쿠키를 설정할 수 있다.
   - 관리 화면은 루트 경로 `/` 에 둔다. 관리 화면은 `/api/...` 를 호출하고 쿠키를 경로 `/` 에 설정한다.

SSH 터널이나 역방향 프록시를 거치면 관리 화면에는 모든 연결이 `127.0.0.1` 에서 온 것으로 보인다. 그래서 관리 화면의 국가 필터(**Security** → **Apply to admin console**)는 실제 클라이언트 주소가 아니라 프록시나 터널의 주소로 판정한다. 국가 제한은 프록시에서 건다(예: nginx `allow`/`deny` 나 GeoIP 모듈).

`-trustXForwardedFor` 는 로그인 잠금, 감사 로그, 세션 목록, 2단계 로그인 티켓의 묶음이 쓰는 클라이언트 주소를 바꾼다. 국가 필터는 바꾸지 않는다.

#### 첫 관리자 로그인

새로 설치하면 서버에는 관리자 계정이 없다. 서버는 일회용 부트스트랩 토큰을 `config/.bootstrap-token` 에 쓰고, 토큰을 만들 때 파일 경로를 로그에 남긴다. 첫 설정을 마치기 전에는 서버를 다시 시작해도 토큰이 바뀌지 않는다.

1. 관리 화면을 연다.
2. 첫 슈퍼유저의 사용자 이름과 비밀번호를 넣고 **OK** 를 누른다.
   - 사용자 이름: 3–32자(영문자, 숫자, `.`, `_`, `-`). 대문자는 소문자로 바뀐다. 비워 두면 `admin` 이 된다.
   - 비밀번호: 앞뒤 공백을 빼고 8자 이상 1024자 이하.
3. **Bootstrap token** 입력란이 나타난다. 서버에서 토큰을 읽어(`cat config/.bootstrap-token`) 입력란에 붙여 넣고 **OK** 를 다시 누른다.
4. 서버가 슈퍼유저를 만들고, `config/.bootstrap-token` 을 지우고, 로그인시킨다. 다음부터는 사용자 이름과 비밀번호로 로그인한다.

첫 설정을 할 수 있는 사람:

- 토큰을 아는 사람만 할 수 있다. Linux 에서는 파일 권한이 0600 이라서 서버를 실행하는 계정(과 root)만 토큰을 읽을 수 있다. 결국 서버 호스트의 운영자만 첫 비밀번호를 정할 수 있다.
- 서버는 요청이 어디서 왔는지 보지 않는다. 기본값 `adminBindHost: 127.0.0.1` 이면 관리 화면은 서버 호스트에서나 SSH 터널로만 열린다. 관리 화면을 다른 호스트에 열어도 첫 설정은 토큰이 지킨다.
- 실패한 시도는 모두 로그인 실패로 센다. 토큰 없이 처음 누른 **OK** 도 마찬가지다. 한 주소 대역(IPv4 /24, IPv6 /64)에서 1분 안에 로그인이 5번 실패하면, 서버는 1분 동안 `429` 로 답한다.

### 클라이언트

#### 코드로 등록하기

권장하는 방법이다. 제어 포트가 TLS 를 써야 한다(`config/server.yaml` 의 `tls: true`).

1. 관리 화면에서 **Trusted clients** 를 열고 클라이언트를 추가한 뒤, 화면에 나온 명령을 복사한다. 이미 있는 클라이언트라면 **Enrollment code** 를 눌러도 된다. 코드는 한 번만 쓸 수 있고 15분 뒤에 만료된다.
2. 클라이언트 호스트에서 그 명령을 실행한다.

   ```shell
   ./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
   ```

   `client join` 은 `config/client.yaml`(권한 0600)과 `config/server-ca.pem` 을 쓰고 끝난다. 이미 `client.yaml` 이 있으면 `--force` 를 붙이지 않는 한 덮어쓰지 않는다. `--force` 를 붙이면 이전 파일은 `client.yaml.bak` 으로 남는다.
3. 클라이언트를 시작한다. 옵션은 필요 없다.

   ```shell
   ./TTTGate-linux-x64 client          # or: client -daemon
   ```

코드는 네트워크로 전송되지 않는다. 클라이언트는 코드에서 조회 값과 키를 만들고, 서버는 그 키로 응답을 봉인한다. 중간에 다른 호스트가 끼어들면 응답이 열리지 않고 `client join` 은 아무것도 쓰지 않는다.

`client join` 이 `client.yaml` 에 쓰는 값은 `host`, `port`, `tls: true`, `name` 과 `clientId`(둘 다 클라이언트 ID), `clientSecret`, `serverName`, `ca: server-ca.pem` 이다. `client.yaml` 에 적힌 `ca` 의 상대 경로는 `config/` 디렉터리를 기준으로 한다.

#### 직접 설정하기

1. `config/client.sample.yaml` 을 바탕으로 `config/client.yaml` 을 만든다.
2. `clientId` 를 서버에 등록된 신뢰 클라이언트의 ID 로 정한다. 비밀값은 다음 가운데 하나로 준다(앞의 것이 우선한다).
   1. `-clientSecret <secret>`. 권장하지 않는다. 같은 호스트의 다른 사용자가 명령줄을 볼 수 있다.
   2. `-clientSecretFile <path>`: 비밀값만 들어 있는 파일.
   3. `TTTGATE_CLIENT_SECRET` 환경 변수.
   4. `config/client.yaml` 의 `clientSecret`.
3. 제어 리스너가 TLS 를 쓰면 `ca` 와 `serverName` 을 정한다.
4. 클라이언트를 시작한다.

   ```shell
   TTTGATE_CLIENT_SECRET=... ./TTTGate-linux-x64 client -addr tls://example.com:9126 -clientId client-a -ca /etc/tttgate/ca.pem
   ```

`TTTGate client --help` 는 옵션을 묶음별로 보여 준다. `--help-advanced` 는 레거시 옵션과 위험한 옵션까지 보여 준다. 모든 클라이언트 옵션은 [클라이언트 옵션](#클라이언트-옵션) 표에 있다.

#### 클라이언트 설정 확인과 저장

- `client config show [options]`: 최종 옵션 값과 각 값의 출처를 출력한다. 비밀값은 가린다.
- `client config save [options]`: 연결하지 않고 최종 옵션 값을 `config/client.yaml` 에 저장한다.
- `client run [options]`: `client [options]` 와 같다.

자세한 내용은 [모드와 명령](#모드와-명령)에 있다.

### 명령줄 레퍼런스

기본 형식은 다음과 같다.

```
TTTGate <server|client|stop> [command] [options]
```

#### 인자 문법

- **모드 단어.** 옵션도 아니고 옵션의 값도 아닌 첫 단어가 모드다. 모드는 `server`, `client`, `stop` 가운데 하나다. 옵션은 모드 앞에 와도 되고 뒤에 와도 된다. `TTTGate -adminPort 9400 server` 와 `TTTGate server -adminPort 9400` 은 같다. 모드는 소문자로 쓴다.
- **명령.** 명령이 있는 모드는 `client` 뿐이다. `run`, `join <addr>`, `config show`, `config save` 를 `client` 바로 뒤에 쓴다. 그 밖의 단어가 남으면 오류다(`unexpected argument '...'`).
- **대시.** 옵션 앞의 대시 개수는 상관없다. `-addr`, `--addr`, `---addr` 은 같다. 도움말은 대시 하나로 보여 주고, 이름에 대시가 들어간 옵션만 대시 둘로 보여 준다(`--yes-insecure`).
- **이름은 대소문자를 가린다.** `-adminport` 는 모르는 옵션이다. 프로그램은 `-adminPort` 를 제안한다.
- **값.** 값을 받는 옵션은 다음 단어(`-addr gw.example.com`)나 `=` 뒤의 글자(`-addr=gw.example.com`)를 값으로 읽는다. 다음 단어가 대시로 시작해도 값으로 읽으므로 `-bufferLimit -1` 이 동작한다. 값이 비어 있으면 오류다(`option '-addr' needs a value`).
- **플래그.** 값 없이 쓴 플래그는 켜진다. 플래그는 다음 단어나 `=` 뒤에 진릿값 단어 하나를 받을 수 있다. `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`(대소문자 무관) 가운데 하나이고, `false`, `0`, `no`, `off` 는 플래그를 끈다. 예: `-tls false`, `-reset=no`, `-requireCsrfHeader off`. `=` 뒤에 그 밖의 값을 쓰면 오류다.
- **정확히 써야 하는 옵션.** `-daemon` 은 대시 하나에 값과 `=` 없이 이대로만 쓴다. `--daemon`, `-daemon=true` 는 오류다.
- **모드 없이 쓸 수 있는 옵션.** 모드가 없으면 `-h`, `--help`, `--help-advanced`, `--version` 만 쓸 수 있다. 다른 옵션은 `option '...' needs a mode (server, client or stop)` 오류가 난다.
- **맞지 않는 곳에 쓴 옵션.** 다른 모드의 옵션을 쓰면 오류다(`option '-adminPort' is not available in client mode`). 다른 명령의 옵션도 오류다(`option '-save' is not available in 'client join'`).
- **모르는 옵션.** 모르는 옵션이 있으면 프로그램이 멈춘다. 그 모드의 옵션 가운데 비슷한 것(대소문자를 무시하고 두 글자 이하 차이)이 있으면 알려 준다. 예: `unknown option '-adr'. Did you mean '-addr'?`.
- **전체 검사.** 프로그램은 무엇이든 시작하기 전에 명령줄 전체를 검사한다. 오류마다 `TTTGate: <error>` 를 출력하고, 이어서 `Run 'TTTGate <mode> --help' for usage.` 를 출력한 뒤 종료 코드 2 로 끝난다.

#### 모드와 명령

| 모드 또는 명령 | 하는 일 | 받는 옵션 | 참고 |
|---|---|---|---|
| `server` | 터널 서버와 관리 화면을 시작한다. | 모든 [서버 옵션](#서버-옵션), `-daemon` | `TTTGate server --help` 로 옵션을 볼 수 있다. |
| `client` | 터널 클라이언트를 시작한다. | `--code`, `--force` 를 뺀 [클라이언트 옵션](#클라이언트-옵션) | `config/client.yaml` 이 있으면 읽는다. |
| `client run` | `client` 와 같다. | `client` 와 같다 | 스크립트에서 명령을 명시해야 할 때 쓴다. |
| `client join <addr>` | 관리 화면에서 받은 코드로 이 클라이언트를 등록한다. `config/client.yaml`(권한 0600)과 `config/server-ca.pem` 을 쓰고 끝난다. | `--code`(필수), `--force` | `<addr>` 는 `-addr` 과 같은 형식이고 기본 포트는 9126 이다. 제어 포트가 TLS 를 써야 하므로 `tcp://` 는 받지 않는다. 터널을 연결하지 않고 pid 파일도 쓰지 않는다. |
| `client config show` | 최종 클라이언트 옵션과 각 값의 출처(`default`, `client.yaml`, `environment`, `file`, `command line`, `inferred`)를 출력한다. | `-daemon`, `-save`, `--code`, `--force` 를 뺀 클라이언트 옵션 | 연결하지 않는다. `clientSecret`, `key`, `privateKey` 는 `(hidden)`, PEM 본문은 `(PEM text)` 로 보여 준다. `client.yaml` 에 안전하지 않은 필드가 있으면 경고를 출력하고 값은 그대로 보여 준다(종료 코드 0). |
| `client config save` | 연결하지 않고 최종 클라이언트 옵션을 `config/client.yaml` 에 저장한다. | `client config show` 와 같다 | `Saved <path>` 를 출력한다. `-save` 와 같은 내용을 저장한다([클라이언트 옵션](#클라이언트-옵션) 참고). |
| `stop` | 이 설치본이 기록한 TTTGate 프로세스를 멈춘다. 데몬과 포그라운드 실행, 서버와 클라이언트를 모두 포함한다. | 도움말 옵션만 | [백그라운드 프로세스 멈추기](#백그라운드-프로세스-멈추기)를 참고한다. |

`client join`, `client config show`, `client config save` 는 버전 배너를 출력하지 않는다. 그래서 스크립트가 출력을 그대로 읽을 수 있다.

#### 서버 옵션

모든 옵션은 `server` 모드에 적용된다.

| 옵션 | 값 | 기본값 | 유지 범위 | 설명 |
|---|---|---|---|---|
| `-adminPort <port>` | 정수 1–65535 | `9300` | `server.yaml` 에 저장(`adminPort`) | 관리 화면의 포트. 잘못된 값이면 서버가 종료 코드 1 로 멈춘다(`Invalid admin port number (1 ~ 65535)`). 예: `server -adminPort 9400`. |
| `-keepAlive <ms>` | 0 이상의 정수 | `10000` | `server.yaml` 에 저장(`keepAlive`) | 제어 리스너의 TCP keepalive 간격. 음수나 숫자가 아닌 값이면 서버가 종료 코드 1 로 멈춘다(`Invalid keep alive time`). 예: `server -keepAlive 30000`. |
| `-trustXForwardedFor` | 플래그 | 꺼짐 | 이번 실행만 | 관리 화면 클라이언트의 주소를 `X-Forwarded-For` 에서 읽는다. 직접 관리하는 역방향 프록시 뒤에서만 쓴다. 프록시를 거쳐 관리 화면을 열려면 프록시 주소도 `adminAllowedOrigins` 에 넣는다. 켜져 있으면 시작할 때 경고를 남긴다. 예: `server -trustXForwardedFor -trustedProxyHops 1`. |
| `-trustedProxyHops <n>` | 정수 1–16 | `1` | 이번 실행만 | 관리 서버 앞에 있는 신뢰 프록시의 수. 아래 참고 사항을 읽는다. 잘못된 값이면 시작할 때 경고를 남기고 1 을 쓴다. `-trustXForwardedFor` 없이 쓰면 효과가 없고 경고를 남긴다. |
| `-reset` | 플래그 | 꺼짐 | 이번 시작 때 한 번 동작 | `config/` 디렉터리의 모든 파일(`server.yaml`, `.key`, `.bootstrap-token` 등 저장된 상태)과 저장된 인증서를 지우고 기본값으로 시작한다. `-reset` 과 `-reset true` 는 초기화하고, `-reset false` 는 아무것도 하지 않는다. **위험:** 터널, 신뢰 클라이언트, 관리자 계정이 모두 사라진다. |
| `-allowLegacyAdminHttp` | 플래그 | 꺼짐 | 이번 실행만 | `adminTls: false`(TLS 없는 레거시 관리 모드)를 허용한다. **위험:** 관리 화면과 세션 쿠키가 평문으로 오간다. `--help-advanced` 에 나온다. |
| `-allowLegacyAdminRemote` | 플래그 | 꺼짐 | 이번 실행만 | 루프백이 아닌 `adminBindHost` 를 허용한다. **위험:** 다른 호스트에서 관리 화면에 접근할 수 있다. `--help-advanced` 에 나온다. |
| `-allowLegacyControlAuth` | 플래그 | 꺼짐(`allowLegacyControlAuth: false`) | `server.yaml` 에 저장(`allowLegacyControlAuth`) | 레거시 공유 키 제어 인증을 허용한다. `-allowLegacyControlAuth false` 로 한 번 시작하거나 `server.yaml` 을 고치기 전까지는 다음 실행에서도 켜진 채로 남는다. **위험:** 레거시 데이터 연결에는 묶음 토큰이 없다. 그래서 데이터 핸들러 ID 를 맞힌 사람은 누구나 세션을 가로채 외부 사용자의 트래픽을 읽거나 끼워 넣을 수 있다. 켜져 있으면 시작할 때 경고를 남긴다. `--help-advanced` 에 나온다. |
| `-requireCsrfHeader false` | 플래그 | 켜짐 | 이번 실행만 | `-requireCsrfHeader false` 는 관리 API 의 CSRF 헤더 검사를 끈다. **위험:** 다른 웹 페이지가 세션 쿠키를 실어 관리 요청을 보낼 수 있다. `--help-advanced` 에 나온다. |
| `-daemon` | 정확히 써야 하는 플래그 | 꺼짐 | 이번 실행만 | 프로세스 감시와 함께 백그라운드로 돌린다. [백그라운드로 실행하기](#백그라운드로-실행하기)를 참고한다. |

`-trustedProxyHops` 참고 사항:

- 관리 화면 클라이언트의 주소는 `X-Forwarded-For` 의 오른쪽 끝에서 이 수만큼 건너뛴 값을 쓴다. 왼쪽 값은 클라이언트가 마음대로 쓸 수 있기 때문이다.
- 프록시 수와 **정확히** 같게 정한다. 더 크면 클라이언트가 다시 자기 주소를 고를 수 있어 로그인 잠금을 피해 간다. 더 작으면 모든 관리자가 같은 프록시 주소로 보인다. 그러면 한 번의 잠금으로 모두가 잠기고, 그 주소가 바뀔 때 MFA 티켓이 실패할 수 있다.
- 관리 포트에는 프록시만 접근하게 한다. 클라이언트가 직접 연결할 수 있으면 가장 오른쪽 값도 클라이언트가 정할 수 있다.
- 업그레이드 참고: 이전 버전은 **가장 왼쪽** 값을 읽었다. 업그레이드할 때 이 설정을 확인한다.

#### 클라이언트 옵션

"실행 계열 명령"은 `client`, `client run`, `client config show`, `client config save` 를 말한다. "`-save` 로 저장"은 `-save` 나 `client config save` 가 최종 값을 `config/client.yaml` 에 쓴다는 뜻이다. 그렇게 저장하지 않으면 값은 이번 실행에만 적용된다.

| 옵션 | 명령 | 값 | 기본값 | 유지 범위 | 설명 |
|---|---|---|---|---|---|
| `-addr <host:port>` | 실행 계열 명령 | `host`, `host:port`, `IPv4:port`, `[IPv6]:port`, 또는 포트 없는 IPv6 주소. 앞에 `tls://` 나 `tcp://` 를 붙여 전송 방식을 고를 수 있다. 포트는 1–65535. 경로와 쿼리는 쓸 수 없다. | 호스트 `localhost`, 포트 `9126` | `-save` 로 저장(`host` 와 `port`) | 서버 주소. 예: `-addr tls://gw.example.com:9126`, `-addr [2001:db8::7]:9126`. 잘못된 주소나 `-tls` 와 어긋나는 접두사는 오류다(종료 코드 2). |
| `-tls` | 실행 계열 명령 | 플래그 | 꺼짐 | `-save` 로 저장 | 제어 연결에 TLS 를 쓴다. 명령줄의 `-ca`, `-serverName`, `-cert`, `-privateKey` 도 TLS 를 켠다. 이 옵션을 `-tls false` 나 `tcp://` 와 함께 쓰면 오류다(종료 코드 2). |
| `-clientId <id>` | 실행 계열 명령 | 문자열 | 없음 | `-save` 로 저장 | 프로토콜 v2 클라이언트 식별자. 서버의 신뢰 클라이언트와 같아야 한다. |
| `-clientSecret <secret>` | 실행 계열 명령 | 문자열 | 없음 | `-save` 로 저장 | 프로토콜 v2 공유 비밀값. 권장하지 않는다. 같은 호스트의 다른 사용자가 명령줄을 볼 수 있고, 클라이언트가 경고를 남긴다. `-clientSecretFile` 과 함께 쓸 수 없다(종료 코드 2). |
| `-clientSecretFile <path>` | 실행 계열 명령 | 파일 경로. 상대 경로는 작업 디렉터리 기준이다. | 없음 | `-save` 로 저장(경로가 아니라 비밀값) | 프로토콜 v2 공유 비밀값을 파일에서 읽는다. 파일에는 비밀값만 둔다. 앞뒤 공백과 줄바꿈은 지운다. 파일이 없거나 읽을 수 없거나 비어 있으면 클라이언트가 종료 코드 78 로 멈춘다. 예: `-clientSecretFile /etc/tttgate/client-a.secret`. |
| `-name <name>` | 실행 계열 명령 | 문자열 | 무작위 터널 이름 | `-save` 로 저장 | 레거시 연결과 로컬 로그에 쓰는 클라이언트 이름. v2 서버는 언제나 그 `clientId` 로 등록된 이름을 보여 준다. 별칭: `-displayName`(폐기 예정, 경고가 난다). `-name` 과 `-displayName` 의 값이 다르면 오류다(종료 코드 2). |
| `-ca <path\|pem>` | 실행 계열 명령 | 파일 경로 또는 PEM 본문 | 없음 | `-save` 로 저장(경로로) | 신뢰할 CA 또는 고정할 서버 인증서. TLS 를 켠다. 명령줄의 상대 경로는 작업 디렉터리 기준이고, `client.yaml` 의 상대 경로는 `config/` 디렉터리 기준이다. 파일이 없거나 인증서가 들어 있지 않으면 클라이언트가 종료 코드 78 로 멈춘다. |
| `-serverName <name>` | 실행 계열 명령 | 문자열 | 없음 | `-save` 로 저장 | 기대하는 TLS 서버 이름. TLS 를 켠다. 제어 포트 인증서를 고정한 클라이언트는 `tttgate-control` 을 쓴다. |
| `-cert <path\|pem>` | 실행 계열 명령 | 파일 경로 또는 PEM 본문 | 없음 | `-save` 로 저장(경로로) | 상호 TLS 에 쓰는 클라이언트 인증서. TLS 를 켠다. 경로 규칙은 `-ca` 와 같다. |
| `-privateKey <path\|pem>` | 실행 계열 명령 | 파일 경로 또는 PEM 본문 | 없음 | `-save` 로 저장(경로로) | `-cert` 의 개인 키. TLS 를 켠다. 경로 규칙은 `-ca` 와 같다. 잘못 넣은 키 본문일 수도 있으므로 오류 메시지에 경로를 보여 주지 않는다. |
| `-save` | `client`, `client run` | 플래그 | 꺼짐 | `config/client.yaml` 에 씀 | 최종 옵션을 `config/client.yaml` 에 저장한 뒤 클라이언트를 시작한다. 아래 참고 사항을 읽는다. `-save false` 는 아무것도 쓰지 않는다. |
| `--code <code>` | `client join` | 영문자나 숫자 12개. 예: `7Q4K-M2XP-AB01` | 없음(필수) | 한 번 사용 | 관리 화면에서 받은 등록 코드. 대시와 공백은 무시하고 대소문자는 가리지 않는다. `O` 는 `0` 으로, `I` 와 `L` 은 `1` 로 읽는다. 코드는 한 번만 쓸 수 있고 15분 뒤에 만료된다. |
| `--force` | `client join` | 플래그 | 꺼짐 | 이번 실행만 | 이미 있는 `config/client.yaml` 을 바꾼다. 이전 파일은 `client.yaml.bak` 으로 남는다. 이 옵션이 없으면 파일이 이미 있을 때 `client join` 이 종료 코드 78 로 멈춘다. |
| `-bufferLimit <MiB>` | 실행 계열 명령 | `-1`(제한 없음) 또는 정수 16–1048576 | `128` | `-save` 로 저장(`globalMemCacheLimit`) | 메모리 버퍼 상한. 그 밖의 값은 오류다(종료 코드 2). 예: `-bufferLimit 256`. |
| `-keepAlive <ms>` | 실행 계열 명령 | 0 이상의 정수 | `10000` | `-save` 로 저장 | 제어 연결의 TCP keepalive 간격. 잘못된 값이나 음수면 경고를 남기고 10000 을 쓴다. |
| `-key <key>` | 실행 계열 명령 | 문자열 | 내장 레거시 키 | `-save` 로 저장 | 레거시 공유 키. 레거시 제어 인증을 명시적으로 켰을 때만 쓴다. **위험:** 레거시 프로토콜로 답하는 어떤 서버에게든 키를 보낸다. 명령줄에 쓰면 경고가 난다. `--help-advanced` 에 나온다. |
| `-allowLegacyFallback` | 실행 계열 명령 | 플래그 | 꺼짐 | 이번 실행만. 저장되지 않음 | 서버가 레거시 인증을 명시적으로 켰을 때만 v1 으로 내려가는 것을 허용한다. **위험:** 가짜 서버가 레거시 프로토콜로 답해 공유 키를 받아 갈 수 있다. 켜져 있으면 시작할 때 경고를 남긴다. `--help-advanced` 에 나온다. |
| `-allowInsecureTls` | 실행 계열 명령 | 플래그 | 꺼짐 | 이번 실행만. 저장되지 않음 | 인증서 검증을 끈다. **위험:** 네트워크 경로에 있는 누구나 서버를 사칭할 수 있다. 비상 상황이 아니면 꺼 둔다. `--help-advanced` 에 나온다. |
| `--yes-insecure` | 실행 계열 명령 | 플래그 | 꺼짐 | 이번 실행만 | `client.yaml` 에 적힌 `allowInsecureTls` 나 `allowLegacyFallback` 을 이번 실행에서만 받아들인다. 이 옵션이 없으면 그런 파일이 있을 때 클라이언트가 종료 코드 78 로 멈춘다(`REFUSE-INSECURE-YAML`). 별칭: `--yesInsecure`. `--help-advanced` 에 나온다. |
| `-daemon` | `client`, `client run` | 정확히 써야 하는 플래그 | 꺼짐 | 이번 실행만 | 프로세스 감시와 함께 백그라운드로 돌린다. [백그라운드로 실행하기](#백그라운드로-실행하기)를 참고한다. |

`-save` 와 `client config save` 참고 사항:

- 입력한 옵션만이 아니라 최종 옵션 전체를 쓴다. `-clientSecret`, `-clientSecretFile`, `TTTGATE_CLIENT_SECRET` 에서 온 비밀값도 함께 저장된다.
- `allowInsecureTls` 와 `allowLegacyFallback` 은 저장하지 않는다.
- 파일 내용이 아니라 경로를 저장한다. 명령줄에서 준 상대 경로는 절대 경로로 저장해서, 다음 실행에서도 같은 파일을 찾게 한다.
- Linux 에서 파일 권한은 0600 이다.

#### 클라이언트 값의 우선순위

클라이언트는 다음 순서로 옵션을 합친다. 뒤의 단계가 앞의 값을 덮어쓴다.

1. 내장 기본값
2. `config/client.yaml`(있을 때)
3. `TTTGATE_CLIENT_SECRET` 환경 변수(비밀값만)
4. `-clientSecretFile`(비밀값만)
5. 그 밖의 명령줄 옵션

그래서 비밀값의 우선순위는 `-clientSecret`, `-clientSecretFile`, `TTTGATE_CLIENT_SECRET`, `client.yaml` 의 `clientSecret` 순서다. 클라이언트는 이 밖의 환경 변수로 옵션을 읽지 않는다.

그 밖의 규칙:

- `client.yaml` 에 `ca`, `serverName`, `cert`, `privateKey` 가 있어도 `tls` 가 `false` 면 그 값을 쓰지 않고 경고를 남긴다. 쓰려면 `tls: true` 로 정한다.
- `client.yaml` 에 `name` 이 없으면 `displayName` 을 `name` 으로 읽는다. 둘 다 있고 값이 다르면 `name` 을 쓰고 경고를 남긴다.
- `client config show` 는 각 값의 출처를 보여 준다.

서버는 `config/server.yaml` 에서 옵션을 읽는다. `-adminPort`, `-keepAlive`, `-allowLegacyControlAuth` 는 먼저 그 값을 이 파일에 쓴다. 나머지 서버 옵션은 그 실행에만 적용된다.

#### 백그라운드로 실행하기

`-daemon` 은 백그라운드 프로세스 두 개를 띄운다. 하나는 앱이고, 다른 하나는 앱을 지켜보는 감시 프로세스(sentinel)다.

- 띄우기 전에 옵션과 설정 파일을 검사한다. 서버는 `server.yaml`(YAML 문법과 관리 화면 보안 정책)을, 클라이언트는 모든 옵션과 참조 파일을 검사한다. 오류는 터미널에 그대로 보인다.
- 이 설치본이 기록한 TTTGate 프로세스(이전 데몬이나 포그라운드 실행)가 있으면, 확인할 수 있는 것부터 먼저 멈춘다.
- 감시 프로세스는 3초마다 앱을 확인한다. 앱이 사라지면 3초 뒤에 다시 띄운다.
- 앱이 설정 오류로 멈추면 데몬은 다시 띄우지 않는다. 이유는 `logs/` 에 있다. 설정을 고친 뒤 다시 시작한다.
- 데몬은 `TTTGate stop` 으로 멈춘다.

#### 도움말과 버전

| 명령 | 출력 |
|---|---|
| `TTTGate`(인자 없음) | 버전과 모드 목록 |
| `TTTGate --help`, `TTTGate -h` | 모드 목록 |
| `TTTGate server --help` | 서버 옵션을 Admin, Proxy, Identity, Run, Tuning 묶음으로 보여 준다 |
| `TTTGate client --help` | 클라이언트 명령과 옵션을 Connection, Identity, TLS trust, Run, Tuning 묶음으로 보여 준다 |
| `TTTGate stop --help` | `stop` 사용법 |
| `--help-advanced` | `--help` 내용에 더해 레거시 옵션과 위험한 옵션(`RISK:` 줄 포함), 별칭을 보여 준다 |
| `--version` | `TTTGate v<version> (<build>)` |

도움말과 버전은 아무것도 시작하지 않고 종료 코드 0 으로 끝난다.

#### 오류와 종료 코드

프로그램은 무엇이든 시작하기 전에 명령줄 전체를 검사한다. `-daemon` 을 쓰면 백그라운드 프로세스를 띄우기 전에 옵션과 설정 파일을 검사하므로, 오류가 터미널에 보인다.

| 코드 | 뜻 |
|---|---|
| 0 | 정상 종료, 도움말, 버전 |
| 1 | 실행 중 오류. 서버 옵션 오류도 1 을 쓴다. `client join`: 서버가 코드를 거부했거나, 응답을 검증하지 못했거나, 네트워크 오류 |
| 2 | 명령줄 오류: 모르는 옵션이나 모드, 빠지거나 잘못된 값, 서로 충돌하는 옵션 |
| 78 | 설정 파일 오류: `client.yaml` 의 안전하지 않은 필드, 없거나 올바르지 않은 CA·인증서·키·비밀값 파일. `client join`: `--force` 없이 `client.yaml` 이 이미 있거나, 파일을 쓸 수 없음 |

앱이 설정 오류로 멈추면 데몬은 다시 띄우지 않는다. 이유는 `logs/` 에 있다. 설정을 고친 뒤 다시 시작한다.

#### 명령줄 예시

서버를 포그라운드로 시작한다.

```shell
./TTTGate-linux-x64 server
```

서버를 백그라운드로 시작했다가 멈춘다.

```shell
./TTTGate-linux-x64 server -daemon
./TTTGate-linux-x64 stop
```

관리 화면의 포트를 바꾼다. 새 포트가 저장되므로 다음부터는 옵션 없이도 9400 을 쓴다.

```shell
./TTTGate-linux-x64 server -adminPort 9400
```

직접 관리하는 역방향 프록시 하나 뒤에서 서버를 돌린다.

```shell
./TTTGate-linux-x64 server -trustXForwardedFor -trustedProxyHops 1
```

코드로 클라이언트를 등록하고 백그라운드로 시작한다.

```shell
./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
./TTTGate-linux-x64 client -daemon
```

다시 등록하면서 기존 `client.yaml` 을 바꾼다.

```shell
./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01 --force
```

TLS 와 비밀값 파일로 클라이언트를 직접 실행한다.

```shell
./TTTGate-linux-x64 client -addr tls://gw.example.com:9126 -clientId client-a \
    -clientSecretFile /etc/tttgate/client-a.secret -ca /etc/tttgate/server-ca.pem -serverName tttgate-control
```

최종 클라이언트 설정을 확인한 뒤, 연결하지 않고 저장한다.

```shell
./TTTGate-linux-x64 client config show -addr tls://gw.example.com:9126 -clientId client-a
./TTTGate-linux-x64 client config save -addr tls://gw.example.com:9126 -clientId client-a \
    -clientSecretFile /etc/tttgate/client-a.secret -ca /etc/tttgate/server-ca.pem
```

### 운영

#### 로그 레벨

`config/server.yaml` 의 `logLevel` 은 서버가 어떤 로그를 남길지 정한다. 값은 `error`, `warn`, `info`(기본값), `debug` 가운데 하나다. 값이 없으면 `info` 다.

- 관리 화면(**Server settings** → **Log level**)이나 `POST`/`PUT /api/serverOption` 으로 바꾼다.
- 새 레벨은 모든 로그 출력(파일과 콘솔)에 바로 적용된다. 서버를 다시 시작하지 않아도 된다.
- 그 밖의 값은 `400` 으로 거부하고 `server.yaml` 도 바꾸지 않는다.
- `debug` 는 문제를 조사하는 동안에만 쓴다. 로그가 훨씬 많아져 디스크를 채울 수 있다.
- 감사 로그(`logs/audit`)에는 영향이 없다.
- `server.yaml` 에 잘못된 값을 직접 쓰면 시작할 때 설정 검증에서 실패한다.
- 업그레이드 참고: 이전 버전은 기본으로 `debug` 줄도 남겼다. 그 출력을 유지하려면 `logLevel: debug` 로 정한다.

#### 연결 닫기 기한

서버는 터널 연결을 닫을 때 남은 출력을 먼저 보내고, 그다음 상대가 닫기를 기다린다. `config/server.yaml` 의 두 옵션이 이 기다림의 한도를 정한다.

| 옵션 | 뜻 | 범위(ms) | 기본값(ms) |
|---|---|---|---|
| `closeStallMs` | 남은 출력이 전혀 진행되지 않아도 기다리는 시간. 쓰기 하나가 끝날 때마다 시간을 새로 잰다. | 1000–600000 | 60000 |
| `closeGraceMs` | FIN 을 보내거나 받은 뒤 상대가 닫기를 기다리는 시간. | 1000–120000 | 10000 |

- 기한이 지나면 서버는 연결을 강제로 닫는다.
- 관리 화면(**Server settings** → **Connection close**)이나 `POST`/`PUT /api/serverOption` 으로 바꾼다. 서버를 다시 시작하지 않아도 된다.
  - 새 `closeStallMs` 는 바꾼 뒤에 닫기 시작하는 연결부터 적용된다.
  - 새 `closeGraceMs` 는 바꾼 뒤에 FIN 을 보내거나 받는 연결부터 적용된다.
- 값이 없으면 기본값을 쓴다.
- 범위 밖의 값은 `400` 으로 거부하고 `server.yaml` 도 바꾸지 않는다. `server.yaml` 에 잘못된 값을 직접 쓰면 시작할 때 설정 검증에서 실패한다.
- 이 옵션은 서버 프로세스에만 적용된다. 클라이언트는 언제나 기본값을 쓴다.
- 느린 사용자가 큰 파일을 내려받는다면 `closeStallMs` 를 늘린다. 서버가 기다려 주는 가장 느린 읽기 속도는 약 (커널 송신 버퍼의 3분의 1) / `closeStallMs` 다. Linux 에서 기본값 60000 이면 약 25 KiB/s 다.
- 작은 서버에서는 값을 줄여 연결을 더 빨리 풀어 준다.

#### 백그라운드 프로세스 멈추기

```shell
./TTTGate-linux-x64 stop
```

`stop` 은 `bin` 폴더의 pid 파일(`.pid_sentinel`, `.pid_app`, `.pid_foreground`)을 읽는다. 감시 프로세스, 앱, 포그라운드 실행 순서로 멈춘다. 그 프로세스가 TTTGate 가 기록한 바로 그 프로세스라고 확인할 수 있을 때만 멈춘다.

- Linux 에서는 `/proc/<pid>/stat` 의 시작 시각과 실행 파일을 비교한다.
- Windows 에서는 `Get-Process` 로 시작 시각과 실행 파일을 확인한다.

확인하지 못한 프로세스는 멈추지 않고, pid 와 pid 파일을 담은 경고를 남긴다.

- **같은 사용자로 실행한다.** TTTGate 는 시작한 사용자와 같은 사용자로 멈추고 시작한다. 관리자 권한이 없는 사용자는 관리자가 시작한 데몬을 멈출 수 없고, Windows 에서는 그 데몬을 확인할 수도 없다.
- **이전 데몬이 돌고 있으면 시작을 거부한다.** `-daemon` 이 멈추지 못한 TTTGate 프로세스를 찾으면 두 번째 쌍을 띄우지 않는다(포트가 부딪친다). pid 와 pid 파일을 알려 주고 종료 코드 1 로 끝난다. 그 프로세스를 멈추거나, 그 pid 가 TTTGate 가 아니면 pid 파일을 지운 뒤 다시 시작한다.

### 기존 서버 업그레이드

돌고 있는 서버를 이 버전으로 바꾸기 전에 읽는다.

#### 클라이언트 명령줄과 신뢰 클라이언트의 변경

- 제어 포트 인증서는 이제 `cert/control.cert.pem` 에 저장되고 다시 시작해도 유지된다. 이름은 `tttgate-control` 하나뿐이다. 이 인증서를 고정하는 클라이언트는 `serverName: tttgate-control` 을 쓴다. `client join` 은 둘 다 알아서 설정한다.
  - 인증서는 1년 동안 유효하다. 남은 기간이 30일보다 짧으면 서버가 시작할 때 새 인증서를 만든다. 그러면 모든 클라이언트가 다시 등록해야 한다(또는 새 인증서를 고정한다). 1년이 끝나기 전에 계획한 시각에 서버를 다시 시작한다.
- 신뢰 클라이언트는 더 이상 `POST /api/serverOption` 으로 바꿀 수 없다. `/api/trustedClients` 나 **Trusted clients** 화면을 쓴다. `GET /api/serverOption` 은 클라이언트 비밀값 대신 `********` 를 보여 준다. 가린 목록을 그대로 다시 보내면 저장된 비밀값이 유지된다.
- 신뢰 클라이언트를 추가하거나 지워도 제어 리스너가 다시 시작되지 않는다. 지운 클라이언트와 비밀값을 새로 받은 클라이언트만 연결이 끊긴다.
- 제어 연결에 하트비트가 생겼다. 클라이언트는 10초마다 핑을 보낸다. 30초 동안 제어 패킷이 하나도 없으면 어느 쪽이든 제어 연결을 닫고, 클라이언트는 다시 연결한다. FIN 이나 RST 없이 끊긴 연결(뽑힌 케이블, 만료된 NAT 항목)을 이렇게 찾아낸다. 하트비트는 양쪽이 모두 지원할 때만 쓰므로, 이전 서버와 클라이언트는 예전처럼 동작한다.
- 클라이언트는 모르는 옵션이 있으면 오류로 멈춘다(종료 코드 2). 읽을 수 없는 `-ca`, `-cert`, `-privateKey`, `-clientSecretFile` 파일이 있어도 멈춘다(종료 코드 78). 서비스 스크립트를 확인한다.
- `stop` 은 이제 기록해 둔 TTTGate 프로세스라고 확인할 수 있는 프로세스만 멈춘다. 예전에는 pid 파일의 모든 pid 를 멈췄고, 시스템이 다른 프로그램에 다시 준 오래된 pid 까지 멈췄다. [백그라운드 프로세스 멈추기](#백그라운드-프로세스-멈추기)를 참고한다.
  - pid 파일에는 이제 pid 숫자 대신 한 줄에 JSON 객체 하나(예: `{"pid":1234,"start":…}`)가 들어 있다. 직접 만든 스크립트가 이 파일을 읽는다면 `pid` 필드를 읽게 바꾼다. 예전 형식의 pid 파일도 그대로 읽는다.

#### 조치하지 않으면 서버나 터널이 멈추는 단계

1. **관리 화면 보안 정책.** 이전 버전은 관리 화면을 모든 인터페이스에서 평문 HTTP 로 제공했다. 이 버전은 `adminTls` 가 `false` 이거나 `adminBindHost` 가 루프백 주소가 아니면 시작을 거부한다(종료 코드 1). 시작하기 전에 다음 가운데 하나를 한다.
   - `config/server.yaml` 에서 `adminTls: true` 와 `adminBindHost: 127.0.0.1` 로 정하고, SSH 터널로 관리 화면에 접속한다. 권장하는 설정이다.
   - 또는 위 설정으로 옮기는 동안 그 실행에만 `-allowLegacyAdminHttp` 와 `-allowLegacyAdminRemote` 를 붙여 시작한다.
2. **기존 클라이언트.** 이전 버전(1.0.10 이하)의 클라이언트는 공유 키로만 인증한다. 이 버전은 그 방식을 기본으로 꺼 두므로, 다음 가운데 하나를 할 때까지 모든 터널이 끊긴다.
   - 배포 기간에는 서버를 `-allowLegacyControlAuth` 로 시작한다(또는 `allowLegacyControlAuth: true` 로 정한다). 그다음 클라이언트를 `clientId` 와 `clientSecret` 을 쓰도록 업그레이드한다([버전 혼합 배포 정책](#버전-혼합-배포-정책) 참고). 이 플래그는 `allowLegacyControlAuth: true` 를 `server.yaml` 에 저장한다. 배포 기간이 끝나면 `-allowLegacyControlAuth false` 로 한 번 시작하거나 값을 `false` 로 바꾼다.
   - 클라이언트를 먼저 업그레이드한다. 3단계의 터널이 있으면 이 방법을 쓰지 않는다.
3. **신뢰할 수 없는 인증서를 쓰는 대상으로 가는 터널.** 이 버전의 클라이언트는 대상 서버의 인증서를 검증한다. 이전 버전(1.0.10 이하)의 클라이언트는 검증하지 않았다. **Secure tunneling Server/Client** 를 켠 터널(`tls: true`)과 모든 HTTPS 터널이 해당한다. 클라이언트를 업그레이드하면, 자체 서명 인증서(또는 그 밖의 신뢰할 수 없는 인증서)를 쓰는 대상으로 가는 터널은 `self-signed certificate` 같은 인증서 오류로 실패한다. 그런 터널이 있으면 다음 가운데 하나를 한다.
   - 2단계처럼 `-allowLegacyControlAuth` 로 서버를 먼저 업그레이드해서 1.0.10 클라이언트의 연결을 유지한다. 관리 화면에서 그런 터널을 하나씩 열어 **Skip certificate verification (allow self-signed)**(`allowSelfSignedDestinationCert: true`)를 켠다. 그다음 2단계처럼 클라이언트를 `clientId` 와 `clientSecret` 을 쓰도록 업그레이드한다. 이전 버전의 서버는 이 옵션을 보낼 수 없으므로 클라이언트를 먼저 업그레이드하지 않는다.
   - 대상에 Node.js 가 신뢰하는 공인 CA 의 인증서를 두고, 그 인증서가 터널의 대상 호스트와 맞게 한다. 클라이언트의 `-ca` 옵션은 제어 연결에만 적용되고 대상에는 적용되지 않는다. DNS 이름용 인증서는 터널이 IP 주소를 쓰면 실패하고, 그 반대도 마찬가지다.

   이 옵션을 켜면 클라이언트는 대상 서버의 어떤 인증서든 받아들인다. 신뢰할 수 있는 네트워크에서만 쓴다. 터널 목록은 이런 터널에 **cert not verified** 를 표시한다.

#### 자동으로 조정되는 값

다음 값을 조정할 때마다 서버는 시작할 때 경고를 남긴다.

- **터널별 속도 제한**은 `rateLimit` 필드 없이 저장된 터널에서는 꺼진 채로 남는다. 프로토콜 기본값(TCP: 60초에 연결 30개, HTTP/HTTPS: 300개, 넘으면 10분 차단)이 함께 저장되므로, 관리 화면에서 터널마다 켜기만 하면 된다. 새 터널은 켜진 상태로 시작한다.
- **세션 유휴 TTL** 은 파일에 `sessionTtlMs` 가 없으면 꺼진 채로 남는다(`sessionTtlMs: 0`). 새로 설치하면 트래픽이 한 시간 없을 때 세션을 닫는다. 켜려면 `sessionTtlMs`(1000–3600000 ms)를 정한다. 켜면 keepalive 없이 오래 쉬는 SSH 나 데이터베이스 연결이 닫힌다. `sessionTtlMs` 를 빼고 `PUT /api/serverOption` 을 호출하면 값이 한 시간으로 돌아간다. 관리 화면은 언제나 현재 값을 보낸다.
- **서버 버퍼** 값 `-1` 이나 `0`(이전 버전의 "제한 없음")은 기본값 8 MiB 로 바뀐다. 제한 없는 버퍼는 작은 서버의 메모리를 다 쓸 수 있다. 세션이 열린 뒤에는 배압(backpressure)을 걸며 데이터가 계속 흐른다.

#### 그 밖에 알아 둘 변경

- **Online** 터널을 저장해도(새 포트, 다른 설정, 새 인증서) 활성화 스위치와 타이머가 그대로 유지된다. 1.0.10 에서는 저장하면 둘 다 초기화되었다. **Inactive on startup** 을 켠 터널은 꺼지고, 다른 터널은 켜지고, 타이머는 처음부터 다시 돌았다. **Inactive on startup** 은 서버가 시작할 때, 터널을 만들 때, **Online** 이 아닌 터널(예: 포트 바인드에 실패해 터널 목록에 **Error** 로 보이는 터널)을 저장할 때 적용된다.
- HTTP 터널은 헤더 블록이 64 KiB(이전: 8 MiB)보다 큰 요청을 `431` 로 거부한다.
- 관리자 비밀번호는 1024자까지다(앞뒤 공백은 세지 않는다). 더 긴 비밀번호는 정할 수 없고, 더 긴 비밀번호로 로그인하면 비밀번호를 확인하지 않고 실패한다. 더 긴 비밀번호를 쓰고 있다면 업그레이드하기 전에 바꾼다.
- 관리 서버는 한 네트워크(IPv4 /24, IPv6 /64)에서 동시에 오는 로그인 요청(`/api/login` 과 `/api/login/mfa` 합계)을 5개까지만 처리한다. 그보다 많은 요청은 코드 `login_concurrency_limit` 와 함께 `429` 를 받는다. 앞선 요청이 끝난 뒤 다시 시도한다.
- 관리 서버는 사용자마다 로그인 세션을 20개, 전체로는 10,000개까지 유지한다. 새로 로그인하면 가장 오래 쓰지 않은 세션을 닫고, 행위자 `system` 으로 `session_killed` 감사 이벤트를 남긴다. 관리 API 에 로그인하는 스크립트는 끝날 때 반드시 `POST /api/logout` 을 호출한다. 그러지 않으면 실행할 때마다 같은 계정의 오래된 세션(예: 브라우저 세션)이 닫힌다.

### 버전 혼합 배포 정책

- 기본 배포 목표: `controlProtocolMode: mixed`.
- 안전한 최종 상태: `controlProtocolMode: mtls-strict`.
- 레거시 공유 키 제어 인증은 `-allowLegacyControlAuth` 를 일부러 쓰지 않는 한 꺼져 있다.
- 클라이언트 쪽 `allowLegacyFallback` 은 승인된 롤백 기간이 아니면 `false` 로 둔다.
- 두 레거시 스위치는 모두 세션 묶음과 키의 비밀성을 약하게 만든다([명령줄 레퍼런스](#명령줄-레퍼런스) 참고). 롤백 기간이 끝나면 끈다.
- 인증되지 않은 터널 연결은 TLS 핸드셰이크 중인 것까지 포함해 핸드셰이크 기한에 닫힌다(기본 15초, 스왑을 쓰는 0.5코어 서버에 맞춘 값).
- 데이터 연결이 오지 않는 세션은 60초 뒤에 닫힌다.
- 클라이언트는 닿지 않는 엔드포인트를 45초 뒤에 포기한다.

권장하는 전환 순서:

1. 서버에 프로토콜 v2 신뢰 클라이언트를 등록한다.
2. 클라이언트를 `clientId` 와 `clientSecret` 을 쓰도록 업그레이드한다.
3. 버전이 섞인 상태의 연결과 롤백 경로를 확인한다.
4. 레거시 배포 예외를 끈다.
5. 모든 클라이언트가 준비되면 제어 리스너를 TLS + `mtls-strict` 로 옮긴다.

### HTTP 터널 CORS 정책

`replaceAccessControlAllowOrigin` 은 호환성 정책 플래그이며, 보안 핫픽스가 아니다.

- 새 터널 설정의 기본값은 `false` 다.
- 이 필드를 정하지 않고 저장된 기존 설정은, 필드를 명시적으로 정하기 전까지 예전처럼 Origin 을 되돌려 준다.
- 자격 증명을 다루는 백엔드는 Origin 을 되돌려 주는 방식 대신 명시적인 허용 목록으로 옮긴다.
