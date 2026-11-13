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
- [Windows Launcher](#windows-launcher)
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
4. A new server starts with the control port TLS off (`tls: false`). In **Server settings**, check **Tunnel TLS** and press **Apply**. It applies at once, without a restart. Or stop the server, set `tls: true` in `config/server.yaml`, and start it again. Also make sure that `controlProtocolMode` is not `mtls-strict`. In the console, open **Trusted clients**, add a client, and copy the command that the console shows.
5. On the client host, run the copied command, then start the client in the background:

   ```shell
   ./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
   ./TTTGate-linux-x64 client -daemon
   ```

6. Add tunnels in the console.

### Runtime Requirements

Use Node.js 24 LTS or newer (minimum `24.0.0`) for source installations and to build the server or the admin UI. When you use nvm, run `nvm use`. Then install the locked dependencies with `npm ci` and `npm ci --prefix admin`.

Standalone binaries embed Node.js 24. They do not need a separate Node install. Build them with the locked `@yao-pkg/pkg` tool through `npm run pkg`. The supported targets are Linux x64/ARM64, Windows x64/ARM64 and Alpine x64. `npm run pkg` alone leaves the Node.js icon on the Windows binaries. `npm run dist` sets the TTTGate icon. You can also run `npm run icon:exe` after `npm run pkg`.

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
| `config/identity.yaml` | Admin users, groups and two-factor settings |
| `config/.key` | Admin password hash of older versions. The server reads it only when `config/identity.yaml` does not exist or cannot be read. When `config/identity.yaml` does not exist, the server creates the `admin` account from `.key` |
| `config/server-ca.pem` | Server certificate that `client join` writes for the client |
| `config/launcher.json` | Settings of the [Windows Launcher](#windows-launcher), for example the mode that you chose |

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
- `-reset` is an action. It deletes the stored server state at that start. With `-daemon`, the sentinel restarts the app with the same options, so every automatic restart resets again. Do not combine `-reset` with `-daemon`.
- `server config save` writes settings to `config/server.yaml` without starting the server. See [Save Server Settings Without Starting](#save-server-settings-without-starting).

#### Save Server Settings Without Starting

`TTTGate server config save [options]` writes the given values to `config/server.yaml`. It does not start the server.

```shell
./TTTGate-linux-x64 server config save -adminPort 9400 -controlPort 9126 -controlTls
```

- It accepts `-adminPort`, `-adminBindHost`, `-adminAllowedOrigins`, `-controlPort`, `-controlTls`, `-controlProtocolMode` and `-allowLegacyAdminRemote`. See [Server Options](#server-options).
- Values that you do not give stay as they are. The command line does not accept an empty value, so `server config save` cannot clear `adminAllowedOrigins`. Clear the list in the admin console.
- If `server.yaml` does not exist, the defaults are created first.
- The command uses the same checks as a save in the admin console.
- On success, the last line is `Saved <path>`. Server log lines can come before it, and a server log file is written. It does not print the version banner.
- If a TTTGate server of this installation runs, the command saves nothing. This also applies when a running process has an unknown mode. Stop the server first with `TTTGate stop`. A running client of the same installation does not block the command.
- If the resulting `adminBindHost` is not loopback, the command saves nothing unless you add `-allowLegacyAdminRemote`. Then start the server later with the same `-allowLegacyAdminRemote`.

| Exit code | Meaning |
|---|---|
| 0 | Saved |
| 1 | A value is wrong. The message is on stderr. Nothing is saved, and no new file is left in `config/`. |
| 75 | A TTTGate server of this installation is running. Stop it first |
| 77 | The admin console would be reachable from other hosts, and `-allowLegacyAdminRemote` was not given. Nothing is saved, and no new file is left in `config/`. |

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

- a page with the `adminPort` port at one of these addresses: `127.0.0.1`, `localhost`, `[::1]`, or an IP address (IPv4 or IPv6) or a host name in `adminBindHost` (not `0.0.0.0` or `::`)
- a page whose origin is listed in `adminAllowedOrigins`

Other addresses get `403 Forbidden origin`. Write an IPv6 address in square brackets, for example `https://[::1]:9300`.

#### Console Language

The console shows its text in Korean or in English. It uses the first language in the language list of the browser (`navigator.languages`). If that list is empty, it uses `navigator.language`. If the language is `ko` or `ko-*` (for example `ko-KR`), the console is in Korean. For all other languages, the console is in English. For example, if the list is `en-US`, `ko-KR`, the console is in English, because `en-US` is first.

To change the language, move the language to the top of the language settings of your browser and reload the page. The console has no language menu. Server logs and the command line stay in English.

#### Open the Console from Another Computer

By default, the console listens only on the server host. Use one of these ways:

1. **SSH tunnel (recommended).** You do not change the server. On your computer, run:

   ```shell
   ssh -L 9300:127.0.0.1:9300 user@server.example.com
   ```

   Keep the SSH session open. Then open `https://127.0.0.1:9300/` on your computer. Use the same local port as `adminPort`. Another local port gets `403 Forbidden origin`.
2. **Expose the console port directly (not recommended).** Users open the console at the server address and the console port.
   1. Edit `config/server.yaml`. List every address that users open in the browser in `adminAllowedOrigins`: each IP address and each DNS name, with the port.

      ```yaml
      adminBindHost: 0.0.0.0
      adminTls: true
      adminAllowedOrigins:
        - "https://192.0.2.10:9300"
        - "https://admin.example.com:9300"
      ```

      - `0.0.0.0` (all IPv4 addresses) and `::` (all addresses) work only together with `adminAllowedOrigins`. Without an entry, the login fails with `403 Forbidden origin`. Only `127.0.0.1`, `localhost` and `[::1]` with the console port work without an entry.
      - When `adminBindHost` is one IP address (IPv4 or IPv6) or one host name of the server (for example `192.0.2.10`, `fd00::10` or `admin.example.com`), a page at that address and the console port (for example `https://192.0.2.10:9300` or `https://[fd00::10]:9300`) works without an entry. Other addresses, for example another DNS name, still need an entry.
      - The rules for entries are the same as in method 3: only `https://` origins, the exact scheme, host and port, no paths and no wildcards. Leave out the port only when it is 443. An entry that breaks these rules stops the server at startup with `server configuration is not ready`. This message does not name the entry. With `-daemon`, the message is in `logs/`, not in the terminal. When you see this message, check each entry against these rules.
   2. Start the server from the `bin` folder with `-allowLegacyAdminRemote`. The flag is not saved. Give it every time that you start the server. Without it, the server stops with `Refusing insecure admin policy: ...`. With `-daemon`, the sentinel restarts the app with the same options.

      ```shell
      cd ~/TTTGate/bin
      ./TTTGate-linux-x64 server -daemon -allowLegacyAdminRemote
      ```

      To stop the server, run `./TTTGate-linux-x64 stop` in the same folder.
   3. Allow the console port in the firewall of the operating system. On a cloud host, also add an inbound rule for the port to the cloud network rules. Examples are the network security group (Azure), the security group (AWS) and the security list (OCI). Other providers have the same kind of rule. Allow only the source addresses that need the console.
   - **Risk:** anyone who can reach the port can try passwords. The login lockout applies. Turn on two-factor authentication for admin accounts, keep `adminTls: true` and limit the source addresses.
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

`-trustXForwardedFor` changes the client address that the login lockout, the audit log, the session list and the binding of two-factor login tickets use. It also changes the address that the IP limit of a tunnel saves for you (see [Limit a Tunnel to the IPs That Turned It On](#limit-a-tunnel-to-the-ips-that-turned-it-on)). It does not change the country filter.

#### If the Console Does Not Open

| Symptom | Cause | What to do |
|---|---|---|
| The browser shows connection refused. | The server does not run, or the console listens only on the server host (`adminBindHost: 127.0.0.1`), or the port is wrong. | Start the server. Check `adminBindHost` and `adminPort` in `config/server.yaml`. Use an SSH tunnel, or expose the port (method 2 above). |
| The connection times out. | A firewall or a cloud network rule blocks the port, or the host is down. | Allow the console port in the firewall of the operating system and in the cloud network rule (Azure, AWS, OCI and others). |
| The login fails with `403 Forbidden origin`. | The address that you opened is not in `adminAllowedOrigins`. It is also not one of these addresses with the console port: `127.0.0.1`, `localhost`, `[::1]`, or an IP address or a host name in `adminBindHost` (not `0.0.0.0` or `::`). | Add the exact address (scheme, host and port) to `adminAllowedOrigins`, then restart the server. With an SSH tunnel, use the same local port as `adminPort`. |
| The server stops with `server configuration is not ready`. | A value in `config/server.yaml` breaks a rule, for example an `adminAllowedOrigins` entry. With `-daemon`, the message is only in `logs/`. | Check the `adminAllowedOrigins` entries against the rules in method 2 above. Fix the entry, then start the server again. |
| The server stops with `Refusing insecure admin policy: ...`. | `adminBindHost` is not a loopback address or `adminTls` is `false`, and the server started without the matching flag. | Start the server with the flag that the message names, for example `-allowLegacyAdminRemote`. For `adminTls: false`, set `adminTls: true` instead if you can. |
| The browser shows a certificate warning. | The console uses the self-signed certificate that the server created. | When you open the console from outside the server host, use your own certificate (see [Open the Console](#open-the-console)). Do not get used to skipping the warning on a console that other hosts can reach. On the server host or through an SSH tunnel, make sure that you opened the correct address, then continue. |

#### First Admin Login

On a fresh install, the server has no admin account. It writes a one-time bootstrap token to `config/.bootstrap-token`. When it creates the token, it writes the file path to the log. The token stays the same when you restart the server before the first setup.

1. Open the admin console.
2. Enter a username for the first superuser and a password, then press **OK**.
   - Username: 3–32 characters (letters, digits, `.`, `_`, `-`). Upper-case letters are changed to lower case. An empty username means `admin`.
   - Password: at least 8 characters and at most 1024 characters, not counting spaces at the start and the end.
3. The **Bootstrap token** field appears. On the server, read the token. In the installation folder (the parent of `bin`), run `cat config/.bootstrap-token`. In the `bin` folder, run `cat ../config/.bootstrap-token`. Paste the token into the field and press **OK** again.
4. The server creates the superuser, deletes `config/.bootstrap-token`, and signs you in. Next time, sign in with the username and password.

Where to find the token:

- The server creates the `config` folder next to the `bin` folder when it starts. When the binary is `~/TTTGate/bin/TTTGate-linux-x64`, the token file is `~/TTTGate/config/.bootstrap-token`.
- When the server creates the token, the server log in `logs/` shows the full path in the line `Bootstrap token created at <path>`. A restart that reuses the token does not write this line again.
- On a remote server, read the token over SSH. Sign in as the account that runs the server, because only that account (and root) can read the file. Keep the quotes, so that the server expands `~`:

  ```shell
  ssh user@server.example.com 'cat ~/TTTGate/config/.bootstrap-token'
  ```

- When a service account without a login shell runs the server, sign in with your own account and use `sudo`. Write the full path, because `~` is your home folder, not the home folder of the service account: `ssh -t user@server.example.com 'sudo cat /opt/TTTGate/config/.bootstrap-token'`.

Who can do the first setup:

- Only a person who knows the token. On Linux the file mode is 0600, so only the account that runs the server (and root) can read the token. In practice, only an operator of the server host can set the first password.
- The server does not check where the request comes from. With the default `adminBindHost: 127.0.0.1`, the console is reachable only on the server host or through an SSH tunnel. If you open the console to other hosts, the token still protects the first setup.
- Every failed attempt counts as a failed login. This includes the first **OK** without a token. After 5 failed logins within 1 minute from one address range (IPv4 /24, IPv6 /64), the server answers `429` for 1 minute.

#### Recover Admin Accounts

Use the first case that matches.

1. **You know your password.** Open **My account** and press **Change password**. If you lost your authenticator app, choose **Use a recovery code instead** at the two-factor step of the login. After you sign in, open **My account**. Under **Two-factor authentication**, press **Disable** and enter your password. Then press **Set up** and register a new app. Or press **Replace app** to register the new app in one step. Each recovery code works only once. If two-factor authentication is required for your account (`mfaRequiredForSuperusers`, or **Require two-factor authentication** on your group) and the app is your only method, **Disable** stays off. Use **Replace app** instead. If no recovery code is left, follow case 2. If no other superuser can sign in either, follow case 3.
2. **Another superuser can sign in.** That superuser opens **Users**, selects your account and presses **Reset password**.
   - The console shows a temporary password once. Give it to the user in a safe way.
   - The server ends the sessions of that user. At the next login, the user must set a new password.
   - The audit log records `temp_password_issued`.
   - If the user also lost the authenticator app, the superuser presses **Reset MFA** on the same screen. This also ends the sessions of that user.
3. **No superuser can sign in (the password is forgotten, or two-factor authentication is lost and no recovery code is left).** Reset the account store on the server host. Then the server starts the first admin setup again. The commands below use `~/TTTGate`. Replace `~/TTTGate` with your installation folder, for example `/opt/TTTGate`. If `cp` or `rm` reports `No such file or directory`, the folder is wrong. Stop and fix the path. If `.key` is not deleted, the old `admin` account comes back. `config/identity.yaml` has file mode 0600. If a service account runs the server, run the commands as that account, or use `sudo` with full paths, for example `/opt/TTTGate/config/identity.yaml`. Keep the backup in a folder that only administrators can read.

   Before you do this, read these warnings:

   - All users, groups and two-factor settings are lost. Create them again after the setup.
   - Tunnels and trusted clients in `config/server.yaml` stay. But the tunnel owner refers to a user that no longer exists. Check the owner of each tunnel, and give each tunnel to a new owner.
   - Delete `config/.key` too. When `config/identity.yaml` does not exist and `config/.key` exists, the server creates the `admin` account with the old password from `.key`.
   - Do not use `-reset` for this. `-reset` deletes every file in `config/`, including `server.yaml` with the tunnels and trusted clients, and the stored certificates.

   1. Stop the server: `./TTTGate-linux-x64 stop` in the `bin` folder. If a service manager such as systemd runs the server, stop the service with that manager instead, so that it does not start the server again.
   2. Copy `config/identity.yaml` to a safe place. The time in the file name keeps an older copy safe. The file contains password hashes and two-factor secrets. Keep the copy safe and delete it when you no longer need it.

      ```shell
      cp -p ~/TTTGate/config/identity.yaml ~/identity.yaml.$(date +%Y%m%d%H%M%S).bak
      ```

   3. Delete `config/identity.yaml`. If `config/.key` exists, delete it too.

      ```shell
      rm ~/TTTGate/config/identity.yaml
      rm -f ~/TTTGate/config/.key
      ```

   4. Start the server again with the same options as usual, for example `-allowLegacyAdminRemote` for method 2. The server creates a new token in `config/.bootstrap-token`. Do the [First Admin Login](#first-admin-login). When `mfaRequiredForSuperusers` is on in `server.yaml`, the new superuser must set up two-factor authentication at the first login.

You cannot change a username. To use a new name, create a new superuser and sign in with it. Give the tunnels of the old account to another owner, then delete the old account. The server does not delete a user who owns tunnels. It also does not delete, disable or demote the last active superuser.

#### Turn Tunnels On and Off

After you sign in, the console opens the **Tunnels** list. This is the same for every role. Each row shows the tunnel name, one status line and a switch.

- **Turn on:** tap the switch. The console turns the tunnel on at once with no time limit. If your group has a time limit, the server applies it.
- **Turn off:** tap the switch. If the tunnel has open connections, the console asks first, because turning off cuts them at once (`2 connections will be cut.`). Without open connections, it turns the tunnel off at once.
- **Undo:** after each change, a message with **Undo** stays for 5 seconds. Undo of a turn-off turns the tunnel on again with the time that was left. It does not bring back cut connections.
- **Status line:** `On`, `Off`, `client offline` (no connected client may serve this tunnel), the time left, `Can't open port <port>`, the owner of a tunnel that is not yours, and `cert not verified`. A tunnel that you can only view shows a lock instead of a switch.
- **Name:** give a tunnel a name in its edit screen (**Name**, optional, up to 40 characters). Without a name, the row shows the port and the destination. Saving only a new name does not restart the tunnel, so open connections stay.
- **IP limit:** the button below the status line shows whether the tunnel accepts only the IPs of the people who turned it on, and the refresh button next to it updates your IP. See [Limit a Tunnel to the IPs That Turned It On](#limit-a-tunnel-to-the-ips-that-turned-it-on).
- **Connections:** below the status line, a tunnel that is on shows its connection count, how long it has been on and its traffic (`On for 2h, 5m · RX 58.1KiB · TX 59.5KiB`, sizes in bytes). If you can change the tunnel, the **Connections N** button opens the list of open connections with their addresses; the × button disconnects one (**Disconnect**, no question asked), and a superuser can **Block** an address after a confirmation (this tunnel only, or all tunnels). The row also shows which clients may serve the tunnel (`Clients: Office PC`; ● connected, ○ not connected; `Any` when no client is chosen). A new block also ends the connections that are already open from that address, here and in **Security**.
- **Details:** tap a row to open its edit screen. Its **Status** area shows how long the tunnel has been on, its connections, traffic, rejected connections and the **Turns off in** timer. Only tunnels that you can change open an edit screen.

#### Sign In with a Passkey

A passkey lets you sign in with the PIN, fingerprint or face check of your device instead of your username and password. A passkey sign-in does not ask for the two-factor code.

Conditions:

- Open the console with a domain name, for example `https://tttgate.example.com:9300`. A passkey cannot use an IP address such as `https://192.168.0.10:9300`. `http://localhost` also works, for example through an SSH tunnel.
- The browser must trust the HTTPS certificate. A self-signed certificate works only when the device trusts it, for example after you install your private CA on the device. A page that you opened after you skipped a certificate warning cannot use passkeys.
- Add the console address to `adminAllowedOrigins` in `server.yaml`, for example `adminAllowedOrigins: ["https://tttgate.example.com:9300"]`. See [Open the Console from Another Computer](#open-the-console-from-another-computer).
- A passkey works only at the domain name where you added it. If you open the console at another name, add a passkey there too.

Add a passkey on each device:

1. Sign in with your password, then open **My account**.
2. Under **Passkeys**, press **Add a passkey**.
3. Enter a name for the device and your password, then press **Continue**.
4. Confirm with the PIN, fingerprint or face check of the device.

You can add up to 20 passkeys. A passkey that your phone or password manager synchronizes shows `synced`.

Sign in: on the sign-in screen, press **Sign in with a passkey** and choose the passkey. You do not enter a username. After a passkey sign-in or registration on a device, that device shows the passkey button first and folds the password fields behind **Use password**.

Remove a passkey: press **Remove** next to it in **My account**. If you lost a device, sign in on another device and remove its passkey. A superuser can remove all passkeys of a user: open **Users**, select the user and press **Remove passkeys**. This also ends the sessions of that user. The audit log records `passkey_registered`, `passkey_removed` and `passkey_reset`. A passkey sign-in records `login_success` or `login_failure` with `method: passkey`.

#### Require Two-Factor Authentication for a Group

A superuser can require two-factor authentication for all members of a group. Open **Groups**, select the group and turn on **Require two-factor authentication** in the **Sign-in** card. When some members have no two-factor method, the console shows how many before it saves.

- A passkey or an authenticator app counts as two-factor authentication.
- A member without either must set one up the next time they use the console. Until then, only **My account** opens. This also applies to members who are signed in now.
- A member who has only passkeys must sign in with a passkey. A password alone does not work. Passkeys do not work at an IP address, so such a member also needs an authenticator app to sign in from an IP address.
- A member cannot remove their last two-factor method. **Disable** and **Remove** stay off and show the reason.
- In **Users**, the page of such a member shows **Required** next to the two-factor status.
- Superusers follow the server setting `mfaRequiredForSuperusers` instead. The same rules apply to them: a passkey counts, and the setting applies to sessions that are open now.

A member lost the phone with the authenticator app:

- If a recovery code is left, the member signs in with it, opens **My account** and presses **Replace app**. After the password check, they scan the new QR code and enter a code. The old app keeps working until they finish.
- Otherwise, a superuser opens **Users**, selects the member and presses **Reset password**. Keep **Also reset two-factor authentication and passkeys** on. The server removes the authenticator app and all passkeys of the member and ends their sessions. Send the temporary password to the member. At the next sign-in, the member sets a new password and then sets up two-factor authentication again. The audit log records `temp_password_issued` with `secondFactorsReset: true`.

#### Toggle-Only Groups and Shared Tunnels

A group can let its members only turn tunnels on and off. In **Groups**, set **Tunnel access** to **Toggle only** (`tunnel_crud: toggle`). Members of this group see the tunnels they own or that are shared with them and turn them on and off. They cannot add, change or remove tunnels, so the list has no **Add tunneling service** button and its rows do not open an edit screen. A superuser assigns a tunnel to such a member with **Change owner** in the edit screen.

Share a tunnel with other users:

1. Open the edit screen of a tunnel that you can change. A superuser can do this for every tunnel.
2. In **Shared with**, type at least 2 characters of a username or display name. Pick a user from the list with the arrow keys and Enter, or with the mouse. Esc closes the list.
3. A picked user appears as a chip. Press the **×** on the chip to remove the user. Then save the tunnel.

- A shared user sees the tunnel and turns it on and off, unless their group has **Tunnel access** set to **None**. A shared user cannot change or remove the tunnel. Users of a **Read only** group can turn on tunnels shared with them, but not their own.
- A tunnel can be shared with up to 50 users. The search finds active users in all groups. It does not show superusers to other users, because superusers can turn on every tunnel. Only superusers and **Full** members can search.
- Only users who can change the tunnel see its share list.
- Saving only a new share list does not restart the tunnel, so open connections stay.
- When you delete a user, the server removes the user from every share list.
- Time limit: when someone turns on a tunnel, the server uses the shorter limit of the owner's group and of that person's group. A superuser, a group with no limit and a `system:migrated` owner add no limit. The limit stays when the owner saves the tunnel later. When another user turns the tunnel on again, for example with the **Turns off in** timer, the limit of that user applies.
- The audit log records the owner as `ownerId` for `tunnel_activated` and `tunnel_deactivated`. For a changed share list, `tunnel_updated` records `sharedUsersAdded` and `sharedUsersRemoved`.

#### Limit a Tunnel to the IPs That Turned It On

Tunnels that stay open for a long time, such as RDP, get many password-guessing attempts. With the IP limit on, a tunnel accepts connections only from the IP address of each person who turned it on. The server closes connections from other addresses before it reads any data.

- **Setting:** each tunnel has the setting `activatorIpOnly`. In the edit screen, it is **Allowed IP** → **Only from the IP of whoever turned it on**. New tunnels have it on. Tunnels that you saved with an earlier version have it off, so an upgrade does not cut connections that are open. Turn it on for each tunnel.
- **Allowed IPs:** the server keeps one IP address for each user of a tunnel (`activatorIps` in `config/server.yaml`). When you turn a tunnel on in the console, the server sets your entry to the address of your browser. The entries of other users stay. This also applies when you turn on a tunnel that is already on, for example with the **Turns off in** timer. Turning a tunnel off, the end of its time limit and a server restart do not clear the list.
- **In the tunnel list:** each row that you can turn on shows the IP limit button below the status line. Gray **IP limit off** means the limit is off. Green shows your allowed IP, with `+N` when other users have entries. An orange `My IP not set` means that the list has no entry for you. The refresh button next to it (**Update to my IP**) sets your entry to your current address. It works while the tunnel is off. The console highlights it when your current address is not your allowed IP. The buttons stay available when the tunnel is off.
- **Who can change it:** everyone who can turn the tunnel on can turn the limit on and update their own IP. Only users who can change the tunnel can turn the limit off. A shared user sees a limit that is on with a small lock and cannot turn it off. One shared user cannot remove the protection for all users.
- **Refused connections:** on a TLS tunnel, the server closes the connection before the TLS handshake. The denial shows as `activator-ip` (**IP limit**) in [Denied Connections](#denied-connections). The server uses the address of the TCP connection. It does not use `X-Forwarded-For` or other request headers, because the client sets them.
- **Removed entries:** the server removes the entry of a user when you remove the user from the share list, when you delete the user, and when you move the tunnel to another owner and the old owner can no longer turn it on. Entries of disabled users and of users who lost the permission stay in the file, but they do not allow connections. When an entry changes, the server also closes open connections from addresses that are no longer allowed.
- **Audit log:** `tunnel_ip_limit_updated` records `enabled`. `tunnel_ip_refreshed` records `allowedIpBefore` and `allowedIp`. When turning a tunnel on changes your entry, `tunnel_activated` records the same two values. When a save in the edit screen changes the limit, `tunnel_updated` records `activatorIpOnly`.
- **API:** `PUT /api/tunneling/<port>/activatorIpOnly` with `{"enabled": true}` or `{"enabled": false}`, and `POST /api/tunneling/<port>/activatorIp` to update your IP. `GET /api/externalServerStatuses` returns `activatorIpOnly`, `myAllowedIp` and `allowedIpCount` for each tunnel, and your current address as `requesterIp`. Only superusers get the entries of all users (`allowedIps`).

Before you rely on it:

- A superuser who creates a tunnel for another user adds only the superuser's own IP. The owner must turn the tunnel on or press **Update to my IP** before they can connect.
- Behind a reverse proxy, start the server with `-trustXForwardedFor` (and `-trustedProxyHops`), so that the server sees the address of the browser. Otherwise every user gets the address of the proxy. Through an SSH tunnel, the console sees `127.0.0.1`, so connections from the internet are refused. Then open the console another way, or turn the limit off.
- When you turn a tunnel on with your phone and connect from a PC, the two addresses can differ. Press **Update to my IP** on the PC.
- One PC can open the console over IPv6 and the tunnel over IPv4 (dual stack). The two addresses then differ and the connection is refused. Open the console and the tunnel the same way, for example both with an IPv4 address.
- An address that other people also use, for example in a café or a hotel, stays allowed until you update your IP. Press **Update to my IP** when you use another network.
- Do not use the limit for an HTTP or HTTPS tunnel behind a CDN or a reverse proxy. Every connection then comes from the proxy, so the server refuses all of them.
- If console requests and tunnel connections reach the server from the same NAT or proxy address (for example the Docker `userland-proxy` or a reverse proxy on the same host), the server saves that shared address as your IP, so the limit lets every connection in.

### Client

#### Enroll with a Code

This is the recommended way. The control port must use TLS (`tls: true` in `config/server.yaml`), and `controlProtocolMode` must not be `mtls-strict`. Otherwise the server does not issue a code.

1. In the admin console, open **Trusted clients**, add the client, and copy the command that it shows. You can also press **Enrollment code** on an existing client. The code works once and, by default, expires after 15 minutes. To change this, choose another value in **Code expires after** in the same window: 15 minutes, 1 hour, 24 hours, 7 days, 30 days or **Never expires**. The console issues a new code with that expiry, and the old code stops working.
   - A code with **Never expires** stays valid until it is used, a new code is issued for the client, the client gets a new secret (**New secret**), the client is deleted, the tunnel server settings (port, TLS, key, etc.) change, or the server restarts. Codes are kept only in memory. Treat such a code like a password.
   - The console gets each code in two steps. First it gets a code that is valid for 15 minutes. When the window shows the code, the console applies the expiry that you chose. If the window closes or the response is lost before the code is shown, the longer expiry does not apply, and the code expires after 15 minutes.
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

For scripts, add `-json`. Then `client join` prints only one JSON line on stdout:

- Success: `{"ok":true,"clientId":"...","server":"host:port"}`
- Failure: `{"ok":false,"category":"...","message":"..."}`. The category is `argument`, `exists`, `write`, `rejected`, `proof`, `network`, `throttled` or `unavailable`.

The exit codes do not change (0, 1, 2, 78). The enrollment code never appears in the output.

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

### Windows Launcher

`bin/TTTGate-launcher-win-x64.exe` is a window program for Windows. It is portable: it needs no installer and no administrator rights. Double-click it to start it.

- Keep it in the same `bin` folder as `TTTGate-win-x64.exe` or `TTTGate-win-arm64.exe`. The launcher uses the one for this PC. If only the other one is there, it uses that one.
- The launcher only controls the command line program (CLI). The CLI does the tunnelling.
- It is in both Windows release zip files. On Windows on Arm, the x64 launcher runs under emulation.
- It needs Windows 10 version 1709 or later (x64, or Arm64 through emulation). It uses Microsoft Edge WebView2. WebView2 is included in Windows 11 and in current Windows 10. If WebView2 is missing, the launcher shows a message with the download link https://go.microsoft.com/fwlink/p/?LinkId=2124703 and stops. The command line still works.
- It loads nothing from the network. Its screens are inside the exe.
- Its text is Korean when the Windows display language is Korean. Otherwise it is English.
- If the launcher version and the CLI version differ, the window shows a warning. Use the files of one release together.

#### First Start

Choose server mode or client mode. The launcher saves the choice in `config/launcher.json`. To change it later, press **Change mode** at the bottom of the window. You can do this only while TTTGate is stopped.

#### Client Mode

- If this PC is already enrolled (`client config show` has a `clientId` and a secret), the window shows the client ID and the server. Press **Run in the background** to start the client. The launcher skips enrollment.
- Otherwise, enter the server address and the enrollment code from the admin console, then press **Enroll**. The launcher runs `client join --code-stdin --json` and shows the result as a sentence.
- A client that uses the old shared-key method (no `clientId` in `client.yaml`) cannot run from the launcher. Enroll it with a code, or keep running it from the command line.
- If `config/client.yaml` exists but cannot be read, or uses the old shared-key method, the launcher asks whether to enroll again with the code. When you agree, it replaces the file and keeps the old one as `client.yaml.bak`.
- **Enroll with another server** enrolls this PC again. If TTTGate runs, the launcher stops it first. It replaces `client.yaml` and keeps the old file as `client.yaml.bak`.
- After 3 or more failed connections in a row, the window says that the server may have removed this client or changed its secret. Then enroll again with a new code.

#### Server Mode

The window shows a form with these settings:

- Admin console port
- Listen address: keep the current setting, this PC only (`127.0.0.1`), or other PCs too (`0.0.0.0`)
- Allowed origins, one per line
- Control port, TLS and protocol mode

Empty fields keep the current settings. Change all other settings in the admin console. When `server.yaml` does not exist yet, **TLS** of the control port starts as **On**, because clients can enroll with a code only over TLS and a new `server.yaml` has it off. When the file exists, TLS starts as **Keep current**.

**Save and start** runs `server config save` and then `server -daemon`. If the admin console would be reachable from other PCs, the launcher first explains the risk and asks you. After you confirm, it adds `-allowLegacyAdminRemote` and remembers this for later starts.

#### While TTTGate Runs

- The window shows the state. For a client, it shows the connection state.
- For a server, the window has **Open admin console**, which opens the default browser. On the first start, it also shows the bootstrap token with a **Copy** button.
- The tray (notification area) icon is the red tunnel icon. Click it to open the window. Its menu has **Open**, **Open admin console**, **Stop**, **Restart**, **Open logs folder** and **Quit**.
- If you close the window while TTTGate runs, the window only goes to the tray. If TTTGate is stopped, closing the window ends the launcher.
- **Quit** asks whether to stop TTTGate or keep it running.
- If you open the launcher again, it finds a running TTTGate and continues to manage it.
- Only one launcher runs at a time on a PC, even across TTTGate folders. If you start a second one, the first window comes to the front. If the second one belongs to another TTTGate folder, the window also says so. Quit the first launcher before you use the other folder.

#### Start at Sign-In

**Start when I sign in to Windows** is off by default. When you turn it on, the launcher writes a `TTTGate Launcher (<hash>)` value in the `Run` registry key of the current user. The hash comes from the launcher path, so each TTTGate folder has its own value. At sign-in, the launcher starts in the tray without a window. If TTTGate is not running, the launcher starts it in the saved mode.

#### Security Notes

- The launcher and the CLI are not code-signed yet. Windows SmartScreen can show a warning at the first start. To continue, select **More info**, then **Run anyway**.
- The launcher gives the enrollment code to `client join` through standard input (`--code-stdin`), not on the command line. So the code does not appear in the process list or in process-creation audit logs.

#### Build the Launcher

- `npm run launcher:build` builds the launcher. It runs `node scripts/build-launcher.cjs dist/bin`, which runs `cargo build --release --locked --target x86_64-pc-windows-msvc` in `launcher/src-tauri` and copies `target/x86_64-pc-windows-msvc/release/TTTGate-launcher.exe` to `dist/bin/TTTGate-launcher-win-x64.exe`.
- The build uses Rust. `launcher/src-tauri/rust-toolchain.toml` pins Rust 1.96.0 and the x64 target. Install Rust with rustup.
- On Windows, `npm run dist` builds the launcher after the CLI binaries. So `npm run dist` on Windows needs Rust. Without it, the build stops and tells you to install Rust from https://rustup.rs. On other systems, this step prints `Windows launcher skipped` and succeeds.
- The release workflow builds the launcher on a Windows runner and adds it to the Windows zip files.

### Command-Line Reference

The general form is:

```
TTTGate <server|client|stop|status> [command] [options]
```

#### Argument Syntax

- **Mode word.** The first word that is not an option and not an option value is the mode: `server`, `client`, `stop` or `status`. Options can come before or after the mode. `TTTGate -adminPort 9400 server` and `TTTGate server -adminPort 9400` are the same. Write the mode in lower case.
- **Commands.** `client` has the commands `run`, `join <addr>`, `config show` and `config save`. `server` has one command: `config save`. Write a command right after its mode. `stop` and `status` have no commands. Any other extra word is an error (`unexpected argument '...'`).
- **Dashes.** An option can start with any number of dashes. `-addr`, `--addr` and `---addr` are the same. The help shows one dash, and two dashes when the name contains a dash (`--yes-insecure`). The help options are an exception: the help always shows `--help`, `--help-advanced` and `--version` with two dashes.
- **Names are case-sensitive.** `-adminport` is an unknown option. The program suggests `-adminPort`.
- **Values.** An option that takes a value reads the next word (`-addr gw.example.com`) or the text after `=` (`-addr=gw.example.com`). The next word is used even when it starts with a dash, so `-bufferLimit -1` works. An empty value is an error (`option '-addr' needs a value`).
- **Flags.** A flag without a value is on. A flag also accepts one truth word, as the next word or after `=`: `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off` (any case). `false`, `0`, `no` and `off` turn the flag off. Examples: `-tls false`, `-reset=no`, `-requireCsrfHeader off`. Any other value after `=` is an error.
- **Exact options.** Write `-daemon` exactly like this: one dash, no value, no `=`. `--daemon` and `-daemon=true` are errors.
- **Options without a mode.** Without a mode, only `-h`, `--help`, `--help-advanced` and `--version` are allowed. Other options give `option '...' needs a mode (server, client, stop or status)`.
- **Options in the wrong place.** An option of another mode is an error (`option '-adminPort' is not available in client mode`). An option of another command is also an error (`option '-save' is not available in 'client join'`).
- **Unknown options.** An unknown option stops the program. When an option of that mode is close to it (2 or fewer changed letters, case ignored), the program names it: `unknown option '-adr'. Did you mean '-addr'?`.
- **Whole-line check.** The program checks the whole command line before it starts anything. It prints each error as `TTTGate: <error>`, then `Run 'TTTGate <mode> --help' for usage.`, and exits with code 2.

#### Modes and Commands

| Mode or command | What it does | Accepted options | Notes |
|---|---|---|---|
| `server` | Start the tunnel server and the admin console. | [Server options](#server-options) that are accepted at start, `-daemon` | `TTTGate server --help` shows the options. |
| `server config save` | Save the given values to `config/server.yaml` without starting the server. | `-adminPort`, `-adminBindHost`, `-adminAllowedOrigins`, `-controlPort`, `-controlTls`, `-controlProtocolMode`, `-allowLegacyAdminRemote` | Prints `Saved <path>`. Exit codes 0, 1, 75 and 77. See [Save Server Settings Without Starting](#save-server-settings-without-starting). |
| `client` | Start a tunnel client. | [Client options](#client-options) except `--code`, `--code-stdin`, `--force` and `-json` | Reads `config/client.yaml` when it exists. |
| `client run` | The same as `client`. | The same as `client` | Use it when a script needs an explicit command. |
| `client join <addr>` | Enroll this client with a code from the admin console. Write `config/client.yaml` (mode 0600) and `config/server-ca.pem`, then stop. | `--code` (required), `--force`, `-json` | `<addr>` uses the `-addr` format. The default port is 9126. `tcp://` is refused: the control port must use TLS. It does not connect a tunnel and does not write pid files. With `-json`, it prints one JSON line (see [Enroll with a Code](#enroll-with-a-code)). |
| `client config show` | Print the resolved client options and the source of each value (`default`, `client.yaml`, `environment`, `file`, `command line`, `inferred`). | Client options except `-daemon`, `-save`, `--code`, `--code-stdin`, `--force`, `-json` | Does not connect. Shows `clientSecret`, `key` and `privateKey` as `(hidden)` and PEM text as `(PEM text)`. When `client.yaml` holds insecure fields, it prints a warning and still shows the values (exit code 0). |
| `client config save` | Save the resolved client options to `config/client.yaml` without connecting. | The same as `client config show` | Prints `Saved <path>`. Saves the same content as `-save` (see [Client Options](#client-options)). |
| `stop` | Stop the TTTGate processes that this installation recorded: daemons and foreground runs, server and client. | Only the help options | See [Stop Background Processes](#stop-background-processes). |
| `status` | Show whether a TTTGate server or client of this installation runs, as a daemon or in the foreground. | `-json`, the help options | Exit code 0 when TTTGate runs, 3 when it does not. See [Check Whether TTTGate Runs](#check-whether-tttgate-runs). |

`client join`, `client config show`, `client config save`, `server config save` and `status` do not print the version banner. Scripts can read their output.

#### Server Options

Each option applies to the `server` mode. Some options are accepted only when the server starts (`server`). Others are accepted only by `server config save`. Each row tells which. An option in the wrong command is an error (exit code 2).

- At start and by `server config save`: `-adminPort`, `-allowLegacyAdminRemote`.
- Only by `server config save`: `-adminBindHost`, `-adminAllowedOrigins`, `-controlPort`, `-controlTls`, `-controlProtocolMode`.
- Only at start: all other server options.

| Option | Value | Default | How long it lasts | Details |
|---|---|---|---|---|
| `-adminPort <port>` | Whole number 1–65535 | `9300` | Saved to `server.yaml` (`adminPort`) | Port of the admin console. Accepted at start and by `server config save`. A bad value stops the server with exit code 1 (`Invalid admin port number (1 ~ 65535)`). Example: `server -adminPort 9400`. |
| `-adminBindHost <host>` | Host name or IP address | `127.0.0.1` | Saved to `server.yaml` (`adminBindHost`) | Address that the admin console listens on. Only `server config save`. A value that is not loopback needs `-allowLegacyAdminRemote` (otherwise exit code 77). Example: `server config save -adminBindHost 0.0.0.0 -allowLegacyAdminRemote`. |
| `-adminAllowedOrigins <origins>` | Origins, comma separated | Empty list | Saved to `server.yaml` (`adminAllowedOrigins`) | Other addresses that may open the admin console, for example through a reverse proxy. Only `server config save`. An empty value is an error (exit code 2); clear the list in the admin console. Example: `server config save -adminAllowedOrigins https://admin.example.com`. |
| `-controlPort <port>` | Whole number 1–65535 | The value in `server.yaml` | Saved to `server.yaml` (`port`) | Control port that tunnel clients connect to. Only `server config save`. A bad value gives exit code 1. |
| `-controlTls` | Flag | The value in `server.yaml` | Saved to `server.yaml` (`tls`) | Use TLS on the control port. Only `server config save`. `-controlTls false` turns TLS off. [Enroll with a Code](#enroll-with-a-code) needs TLS. |
| `-controlProtocolMode <mode>` | `legacy`, `mixed` or `mtls-strict` | The value in `server.yaml` | Saved to `server.yaml` (`controlProtocolMode`) | Control protocol mode. Only `server config save`. Another value gives exit code 1. |
| `-keepAlive <ms>` | Whole number, 0 or more | `10000` | Saved to `server.yaml` (`keepAlive`) | TCP keepalive interval of the control listener. A negative or non-numeric value stops the server with exit code 1 (`Invalid keep alive time`). Example: `server -keepAlive 30000`. |
| `-trustXForwardedFor` | Flag | Off | This run only | Read the admin client address from `X-Forwarded-For`. Use it only behind a reverse proxy that you control. To open the console through the proxy, also add the address that users open (for example `https://admin.example.com`) to `adminAllowedOrigins`. The server logs a warning at startup while it is on. Example: `server -trustXForwardedFor -trustedProxyHops 1`. |
| `-trustedProxyHops <n>` | Whole number 1–16 | `1` | This run only | Number of trusted proxies in front of the admin server. See the notes below. A bad value gives a startup warning, and the server uses 1. Without `-trustXForwardedFor`, it has no effect and gives a warning. |
| `-reset` | Flag | Off | Action at this start | Delete every file in the `config/` directory (`server.yaml`, `.key`, `.bootstrap-token` and the other stored state) and the stored certificates, then start with defaults. `-reset` and `-reset true` reset. `-reset false` does nothing. **Risk:** tunnels, trusted clients and admin accounts are lost. With `-daemon`, the sentinel restarts the app with the same options, so every automatic restart resets again. Do not combine `-reset` with `-daemon`. |
| `-allowLegacyAdminHttp` | Flag | Off | This run only | Allow `adminTls: false` (legacy non-TLS admin mode). **Risk:** the admin console and its session cookies travel in plain text. Shown by `--help-advanced`. |
| `-allowLegacyAdminRemote` | Flag | Off | This run only | Allow a non-loopback `adminBindHost`. Accepted at start and by `server config save`. With `server config save`, it allows saving such an `adminBindHost`. The flag itself is not saved, so start the server with it too. **Risk:** the admin console is reachable from other hosts. Shown by `--help-advanced`. |
| `-allowLegacyControlAuth` | Flag | Off (`allowLegacyControlAuth: false`) | Saved to `server.yaml` (`allowLegacyControlAuth`) | Allow legacy shared-key control authentication. It stays on in later runs until you start once with `-allowLegacyControlAuth false` or edit `server.yaml`. **Risk:** legacy data connections carry no binding token. Anyone who guesses a data handler ID can take over a session. That person can then read or inject external user traffic. The server logs a warning at startup while it is on. Shown by `--help-advanced`. |
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
| `-tls` | Run commands | Flag | Off | Saved by `-save` | Use TLS on the control connection. `-ca`, `-serverName`, `-cert` and `-privateKey` on the command line also turn TLS on. These four options together with `-tls false` or `tcp://` are an error (exit code 2). |
| `-clientId <id>` | Run commands | Text | None | Saved by `-save` | Protocol v2 client identifier. It must match a trusted client on the server. |
| `-clientSecret <secret>` | Run commands | Text | None | Saved by `-save` | Protocol v2 shared secret. Not recommended: other users of the host can read command lines, and the client logs a warning. You cannot use it together with `-clientSecretFile` (exit code 2). |
| `-clientSecretFile <path>` | Run commands | File path. A relative path starts at the working directory. | None | The secret (not the path) is saved by `-save` | Read the protocol v2 shared secret from a file. The file holds only the secret. Spaces and line breaks at the ends are removed. A missing, unreadable or empty file stops the client with exit code 78. Example: `-clientSecretFile /etc/tttgate/client-a.secret`. |
| `-name <name>` | Run commands | Text | A random tunnel name | Saved by `-save` | Client name for legacy connections and local logs. A v2 server always shows the name registered for the `clientId`. Alias: `-displayName` (deprecated, gives a warning). Different values for `-name` and `-displayName` are an error (exit code 2). |
| `-ca <path\|pem>` | Run commands | File path or PEM text | None | Saved by `-save` (a path as a path, PEM text as text) | Trusted CA or pinned server certificate. Turns TLS on. A relative path on the command line starts at the working directory. A relative path in `client.yaml` starts at the `config/` directory. A file that is missing or has no certificate stops the client with exit code 78. |
| `-serverName <name>` | Run commands | Text | None | Saved by `-save` | Expected TLS server name. Turns TLS on. Clients that pin the control port certificate use `tttgate-control`. |
| `-cert <path\|pem>` | Run commands | File path or PEM text | None | Saved by `-save` (a path as a path, PEM text as text) | Client certificate for mutual TLS. Turns TLS on. The path rules of `-ca` apply. |
| `-privateKey <path\|pem>` | Run commands | File path or PEM text | None | Saved by `-save` (a path as a path, PEM text as text) | Private key of `-cert`. Turns TLS on. The path rules of `-ca` apply. Error messages do not show the path, because the value can be key text that was put in the wrong place. |
| `-save` | `client`, `client run` | Flag | Off | Writes `config/client.yaml` | Save the resolved options to `config/client.yaml`, then start the client. See the notes below. `-save false` writes nothing. |
| `--code <code>` | `client join` | 12 Crockford Base32 characters, for example `7Q4K-M2XP-AB01` | None (required) | Used once | Enrollment code from the admin console. It uses digits and the letters A–Z except `I`, `L`, `O` and `U`. When you type it, `I` and `L` are read as `1`, and `O` as `0`. Dashes, spaces and case are ignored. The code works once and, by default, expires after 15 minutes. Choose another expiry in **Code expires after** in the console, up to 30 days or **Never expires**. The `ttlMinutes` field of the admin API takes 1–43200 (30 days), or `null` for no expiry. A script can send `ttlMinutes` alone. The console also sends `provisional: true`. Then an expiry longer than 15 minutes applies only after `POST /api/trustedClients/<id>/enrollmentCode/confirm` with the `issueId` from the response. |
| `--code-stdin` | `client join` | Flag | Off | This run only | Read the enrollment code from the first line of standard input instead of `--code`. Pipe the code in. A terminal is refused with exit code 2, because reading it would wait for the end of input. The code then does not appear in the process list or in process-creation audit logs. Using it together with `--code`, or giving an empty first line, is an error (exit code 2). Example: `echo 7Q4K-M2XP-AB01 \| TTTGate client join gw.example.com --code-stdin`. |
| `--force` | `client join` | Flag | Off | This run only | Replace an existing `config/client.yaml`. The old file is kept as `client.yaml.bak`. Without it, an existing file stops `client join` with exit code 78. |
| `-json` | `client join` (also `status`) | Flag | Off | This run only | Print the result as one JSON line on stdout. See [Enroll with a Code](#enroll-with-a-code) and [Check Whether TTTGate Runs](#check-whether-tttgate-runs). Other commands do not accept it. |
| `-bufferLimit <MiB>` | Run commands | `-1` (no limit) or a whole number 16–1048576 | `128` | Saved by `-save` (as `globalMemCacheLimit`) | Memory buffer limit. Another value is an error (exit code 2). Example: `-bufferLimit 256`. |
| `-keepAlive <ms>` | Run commands | Whole number, 0 or more | `10000` | Saved by `-save` | TCP keepalive interval of the control connection. A bad or negative value gives a warning, and the client uses 10000. |
| `-key <key>` | Run commands | Text | Built-in legacy key | Saved by `-save` | Legacy shared key. It is used only with explicit legacy control auth. **Risk:** the key is sent to any server that answers with the legacy protocol. On the command line, it gives a warning. Shown by `--help-advanced`. |
| `-allowLegacyFallback` | Run commands | Flag | Off | This run only. Never saved | Allow v1 fallback, only when the server explicitly enables legacy auth. **Risk:** a fake server can answer with the legacy protocol and receive the shared key. The client logs a warning at startup while it is on. Shown by `--help-advanced`. |
| `-allowInsecureTls` | Run commands | Flag | Off | This run only. Never saved | Disable certificate verification. **Risk:** anyone on the network path can impersonate the server. Keep it off except in an emergency. Shown by `--help-advanced`. |
| `--yes-insecure` | Run commands | Flag | Off | This run only | Accept `allowInsecureTls` or `allowLegacyFallback` written in `client.yaml` for this run. Without it, such a file stops the client with exit code 78 (`REFUSE-INSECURE-YAML`). Alias: `--yesInsecure`. Shown by `--help-advanced`. |
| `-daemon` | `client`, `client run` | Exact flag | Off | This run only | Run in the background with process monitoring. See [Run in the Background](#run-in-the-background). |

Notes on `-save` and `client config save`:

- They write the resolved options, not only the options that you typed. This includes the secret from `-clientSecret`, `-clientSecretFile` or `TTTGATE_CLIENT_SECRET`.
- `allowInsecureTls` and `allowLegacyFallback` are never saved.
- The file keeps paths, not file contents. PEM text that you give directly is saved as text. A relative path from the command line is saved as an absolute path, so the next start finds the same file.
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

The server reads its options from `config/server.yaml`. `-adminPort`, `-keepAlive` and `-allowLegacyControlAuth` first write their value to that file. The other server options apply only to that run. `server config save` writes values to that file without starting the server.

#### Run in the Background

`-daemon` starts two background processes: the app and a sentinel that watches it.

- Before it starts them, the program checks the options and the config file. For the server, it checks `server.yaml` (YAML syntax and admin security policy). For the client, it resolves all options and files. Errors show in your terminal.
- When this installation recorded a TTTGate process (an old daemon or a foreground run), the program first stops it. It stops the process only when it confirms that it is the recorded process.
- The sentinel checks the app every 3 seconds. When the app is gone, the sentinel starts it again after 3 seconds.
- A daemon whose app stops with a configuration error is not restarted. The reason is in `logs/`. Fix the configuration and start again.
- Stop the daemon with `TTTGate stop`.

#### Help and Version

| Command | Output |
|---|---|
| `TTTGate` (no arguments) | The version and the list of modes |
| `TTTGate --help`, `TTTGate -h` | The list of modes |
| `TTTGate server --help` | Server commands and options in groups: Admin, Control port, Proxy, Identity, Run, Tuning. Risky options appear only with `--help-advanced` |
| `TTTGate client --help` | Client commands and options in groups: Connection, Identity, TLS trust, Run, Tuning |
| `TTTGate stop --help` | The `stop` usage |
| `TTTGate status --help` | The `status` usage and `-json` |
| `--help-advanced` | The same as `--help`, plus legacy and risky options with a `RISK:` line, and aliases |
| `--version` | `TTTGate v<version> (<build>)` |

Help and version do not start anything. They exit with code 0.

#### Errors and Exit Codes

The program checks the whole command line before it starts anything. With `-daemon`, the program checks the options and the config file before it starts the background processes, so the errors show in your terminal.

| Code | Meaning |
|---|---|
| 0 | Normal end, help, version. `status`: TTTGate runs |
| 1 | Error while running. Server option errors also use 1. `client join`: the server refused the code, too many failed attempts from this address (wait 15 minutes), the server does not accept enrollment, the answer could not be verified, or a network error. `server config save`: a value is wrong |
| 2 | Command-line error: unknown option or mode, missing or bad value, options that conflict |
| 3 | `status`: TTTGate does not run (the LSB convention) |
| 75 | `server config save`: a TTTGate server of this installation is running |
| 77 | `server config save`: the admin console would be reachable from other hosts, and `-allowLegacyAdminRemote` was not given |
| 78 | Configuration file error: insecure fields in `client.yaml`, a CA, certificate, key or secret file that is missing or not valid. `client join`: `client.yaml` exists without `--force`, or the files cannot be written |

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

Save server settings without starting the server, then start it:

```shell
./TTTGate-linux-x64 server config save -adminPort 9400 -controlPort 9126 -controlTls -controlProtocolMode mixed
./TTTGate-linux-x64 server -daemon
```

Check whether TTTGate runs, as a sentence and as JSON:

```shell
./TTTGate-linux-x64 status
./TTTGate-linux-x64 status -json
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

#### Denied Connections

The server refuses a connection for one of six reasons:

| Reason | Shown as | Meaning |
|---|---|---|
| `geo-deny` | Country blocked | The country filter refused the address. |
| `ip-blocklist` | Blocklist | The address is on the admin blocklist. |
| `rate-limit-ban` | Temporarily banned | The address is banned for a time after too many connections. |
| `rate-limit-exceeded` | Rate limit exceeded | The address made too many connections in the rate-limit window. |
| `concurrency-limit` | Connection limit | The tunnel owner's group reached its limit of connections at the same time. |
| `activator-ip` | IP limit | The tunnel accepts only the IPs of the people who turned it on, and the address is not one of them. See [Limit a Tunnel to the IPs That Turned It On](#limit-a-tunnel-to-the-ips-that-turned-it-on). |

You can see denials in three places:

- **Denials by port** (admin console → **Security**): the number of denials for each port and reason, and the number of banned addresses. The admin console itself appears as `admin`; only the country filter can refuse it. The counts start at 0 when the server starts. They do not reset when you change or remove a tunnel. `GET /api/security/stats` returns the same numbers.
- **Recent denials** (admin console → **Security**): the latest 200 denials with time, IP, country, port and reason. They are kept only in memory and are lost when the server restarts. Countries are shown only while the country filter is on. `GET /api/security/denials` returns the same list. Both tables refresh every 10 seconds.
- **Denial log files**: `logs/denial-YYYY.MM.DD.log`, next to the server logs. They are for reading over SSH when you investigate a problem. The admin console does not show them, and the lines do not go to the console or to `logs/server-*.log`.

Each line of a denial log file groups the denials of one IP, port and reason over one minute:

```text
2026-11-05T01:01:30.004Z [INFO] Denial:: first=2026-11-05T01:00:00.000Z last=2026-11-05T01:00:41.512Z ip=203.0.113.7 country=CN port=8080 reason=geo-deny count=5
```

- Times are UTC. The file name uses the server's local date. A line is written in the file of the day it is written, so a group that crosses midnight can have a `first` date of the day before.
- `port=admin` is the admin console. `country=-` means the country is not known or the country filter is off.
- When more than 10,000 different IP, port and reason groups are open at the same time, the others are merged into one line per port and reason with `ip=*`.
- A line is written within about 90 seconds after its minute ends. When the server process stops, groups not yet written are lost.
- Writing is asynchronous. If the disk cannot keep up, lines are dropped and a `Dropped N log lines ...` line records how many.

`denialLogRetentionDays` in `config/server.yaml` sets how many days the files are kept. The default is 20.

- With `N` days, a file is deleted on day `N + 1`, counting the day of the file as day 1. With 20, `denial-2026.11.01.log` is kept until 2026-11-20 and deleted on 2026-11-21. With 1, only today's file is kept.
- Old files are deleted when the server starts, when a new day's file opens, when you save a value of 1 or more, and every hour.
- A value of 0 or less turns the denial log off. Nothing is written, and files that already exist are not deleted. The admin console tables still work.
- The value must be a whole number no larger than 3650. Change it in the admin console (**Server settings** → **Denial log retention (days)**) or with `POST`/`PUT /api/serverOption`. The new value applies from the next denial. You do not need to restart the server.
- If a `PUT /api/serverOption` body leaves out `denialLogRetentionDays`, the value goes back to the default 20. A denial log that you turned off is then on again.

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

#### Check Whether TTTGate Runs

```shell
./TTTGate-linux-x64 status
./TTTGate-linux-x64 status -json
```

`status` shows whether a TTTGate server or client of this installation runs, as a daemon or in the foreground. It does not create pid or log files, and it does not print the version banner. It exits with code 0 when TTTGate runs and with code 3 when it does not (the LSB convention).

Without `-json`, it prints one sentence, for example `TTTGate server is running in the background (pid 1234)` or `TTTGate is not running`.

With `-json`, it prints one JSON line with these fields:

| Field | Meaning |
|---|---|
| `version` | Version of this TTTGate |
| `running` | `true` when TTTGate runs |
| `mode` | `server`, `client` or `null`. It is `null` for a process that an older version started, because its pid file has no mode |
| `pid` | Process ID, or `null` |
| `daemon` | `true` when the process was started with `-daemon` |
| `client` | For a running client: `state` (`connecting`, `connected` or `reconnecting`), `since` (time of the last change, in milliseconds since the epoch) and `failures`. Otherwise `null` |
| `server` | For a running server: `adminUrl`, `bootstrapRequired` and `bootstrapTokenFile`. Otherwise `null` |

- `adminUrl` is the address to open on this PC. A wildcard bind (`0.0.0.0`, `::` or empty) becomes `127.0.0.1`. The scheme is `https` when `adminTls` is true.
- The running client writes `bin/.status_client` when its connection changes. `status` reads this file.
- `failures` counts the connections in a row that ended within 30 seconds. Such a connection counts as a failure even if it was `connected` for a moment. The reason: the server closes a connection that fails authentication and does not tell the reason. A connection that lasts 30 seconds or more resets the count to 0.
- Pid file lines now also record the mode.

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
3. **Tunnels to a destination with an untrusted certificate.** A client of this version verifies the certificate of the destination server. Clients of earlier versions (1.0.10 and older) did not. This applies to tunnels with **Use TLS (external port and destination)** checked (`tls: true`) and to every HTTPS tunnel. After you upgrade a client, such a tunnel fails when its destination has a self-signed (or otherwise untrusted) certificate. The error is a certificate error, for example `self-signed certificate`. If you have such tunnels, do one of these:
   - Upgrade the server first, with `-allowLegacyControlAuth` as in step 2, so that 1.0.10 clients stay connected. In the admin console, open each such tunnel and check **Skip certificate verification (allow self-signed)** (`allowSelfSignedDestinationCert: true`). Then upgrade the clients with `clientId` and `clientSecret` as in step 2. A server of an earlier version cannot send this option, so do not upgrade the clients first.
   - Give the destination a certificate from a public CA that Node.js trusts, and that matches the destination host of the tunnel. The client's `-ca` option applies only to the control connection, not to destinations. A certificate for a DNS name fails when the tunnel uses an IP address, and the other way round.

   With the option checked, the client accepts any certificate from the destination server. Use it only on a trusted network. The tunnel list marks these tunnels with **cert not verified**.

#### Values That Are Adjusted Automatically

The server logs a warning at startup for each of these:

- **Per-tunnel rate limiting** stays off for every tunnel that was saved without a `rateLimit` field. The protocol defaults are stored with it (TCP: 30 connections per 60 s, HTTP/HTTPS: 300; a 10-minute ban when exceeded), so you only switch it on per tunnel in the admin console. New tunnels start with it on.
- **Session idle TTL** stays off (`sessionTtlMs: 0`) when the file has no `sessionTtlMs`. New installations close a session after one hour without traffic. Set `sessionTtlMs` (1000–3600000 ms) to turn it on. When it is on, long idle SSH or database connections without keepalive are closed. A `PUT /api/serverOption` call that omits `sessionTtlMs` sets it back to one hour. The admin console always sends the current value.
- **Server buffer** `-1` or `0` ("unlimited" in earlier versions) becomes the default 8 MiB. An unlimited buffer can exhaust the memory of a small server. Data keeps flowing with backpressure once a session is open.

#### Other Changes to Be Aware Of

- Saving an **Online** tunnel (a new port, other settings or a new certificate) keeps its activation switch and its timer. In 1.0.10, saving reset them: a tunnel with **Inactive on startup** checked was switched off, any other tunnel was switched on, and the timer started again. **Inactive on startup** applies when the server starts and when a tunnel is created. It also applies when you save a tunnel that is not **Online** (the tunnel list shows `Can't open port <port>`, for example after a port bind failure).
- HTTP tunnels reject a request whose header block is larger than 64 KiB (earlier: 8 MiB) with `431`.
- Admin passwords are limited to 1024 characters (leading and trailing whitespace is not counted). A longer password cannot be set, and a login with a longer password fails without a password check. If you use a longer password, change it before you upgrade.
- The admin server handles at most 5 login requests (`/api/login` and `/api/login/mfa` together) at the same time from one network (IPv4 /24, IPv6 /64). More requests get `429` with code `login_concurrency_limit`. Try again after the earlier requests finish.
- Tunnels that you saved with an earlier version have the IP limit (`activatorIpOnly`) off after the upgrade, so connections that are open are not cut. New tunnels have it on. Turn it on for each existing tunnel. See [Limit a Tunnel to the IPs That Turned It On](#limit-a-tunnel-to-the-ips-that-turned-it-on).
- The admin server keeps at most 20 login sessions per user and 10,000 in total. A new login closes the session that was used least recently and records a `session_killed` audit event with actor `system`. Scripts that log in to the admin API must call `POST /api/logout` when they finish. Otherwise each run closes an older session of the same account, for example a browser session.

### Mixed-Version Rollout Policy

- Default rollout target: `controlProtocolMode: mixed`.
- Secure target state: `controlProtocolMode: mtls-strict`.
- Legacy shared-key control auth stays off unless you use `-allowLegacyControlAuth` deliberately.
- Keep client-side `allowLegacyFallback` set to `false` unless you are in an approved rollback window.
- Both legacy switches weaken session binding and key secrecy (see [Command-Line Reference](#command-line-reference)). Turn them off when the rollback window ends.
- Unauthenticated tunnel connections close at the handshake deadline. This includes connections that are still in the TLS handshake. The deadline is 15 s by default, sized for a 0.5-core server that swaps.
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
- Move credential-bearing backends to explicit allowlists instead of origin reflection.

## 한국어

### 목차

- [개요](#개요)
- [빠른 시작](#빠른-시작)
- [실행 환경](#실행-환경)
- [설정 파일](#설정-파일)
- [서버](#서버)
- [웹 관리 화면](#웹-관리-화면)
- [클라이언트](#클라이언트)
- [Windows 런처](#windows-런처)
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
4. 새 서버는 제어 포트 TLS 가 꺼진 상태(`tls: false`)로 시작한다. **Server settings** 에서 **Tunnel TLS** 를 켜고 **Apply** 를 누른다. 서버를 다시 시작하지 않아도 바로 적용된다. 또는 서버를 멈추고 `config/server.yaml` 에 `tls: true` 를 정한 뒤 다시 시작한다. `controlProtocolMode` 가 `mtls-strict` 가 아닌지도 확인한다. 관리 화면에서 **Trusted clients** 를 열고 클라이언트를 추가한 뒤, 화면에 나온 명령을 복사한다.
5. 클라이언트 호스트에서 복사한 명령을 실행하고, 클라이언트를 백그라운드로 시작한다.

   ```shell
   ./TTTGate-linux-x64 client join gw.example.com:9126 --code 7Q4K-M2XP-AB01
   ./TTTGate-linux-x64 client -daemon
   ```

6. 관리 화면에서 터널을 추가한다.

### 실행 환경

소스로 설치하거나 서버·관리 UI 를 빌드할 때는 Node.js 24 LTS 이상(최소 `24.0.0`)을 쓴다. nvm 을 쓴다면 `nvm use` 를 먼저 실행한다. 그다음 `npm ci` 와 `npm ci --prefix admin` 으로 잠근 버전의 의존성을 설치한다.

단독 실행 파일에는 Node.js 24 가 들어 있어서 Node 를 따로 설치하지 않아도 된다. 실행 파일은 잠근 버전의 `@yao-pkg/pkg` 도구로 `npm run pkg` 를 실행해 만든다. 지원 대상은 Linux x64/ARM64, Windows x64/ARM64, Alpine x64 다. `npm run pkg` 만 실행하면 Windows 실행 파일에 Node.js 아이콘이 남는다. TTTGate 아이콘은 `npm run dist` 가 넣는다. `npm run pkg` 뒤에 `npm run icon:exe` 를 실행해도 된다.

#### 작은 서버의 메모리

서버는 메모리 버퍼를 프로세스 전체에 정해 둔 예산 안에서만 쓴다. 그래서 512 MB 인스턴스로도 충분하다.

| 예산 | 기본값 | 한도에 닿으면 |
|---|---|---|
| 소켓 메모리 버퍼(`globalMemCacheLimit`) | 128 MiB | 넘치는 데이터는 디스크의 파일 캐시로 옮겨 간다 |
| 아직 열리는 중인 세션의 대기열 | 모든 클라이언트 합쳐 64 MiB, 클라이언트마다 32 MiB | 75 % 에서 보내는 쪽을 멈추고, 한도를 넘길 세션은 닫는다 |
| 대역폭 제한 대기열(`rate_limit` 프리셋이 있는 그룹) | 모든 세션 합쳐 64 MiB | 대기열이 있는 세션은 75 % 에서 보내는 쪽을 멈추고 50 % 에서 다시 보낸다 |
| HTTP 본문 바꾸기(`rewriteHostInTextBody`) | 한 번에 32 MiB 예약 | 진행 중인 본문 바꾸기가 끝날 때까지 다른 응답은 바꾸지 않고 그대로 넘긴다 |

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
| `config/identity.yaml` | 관리자 사용자, 그룹, 2단계 인증 설정 |
| `config/.key` | 예전 버전의 관리자 비밀번호 해시. 서버는 `config/identity.yaml` 이 없거나 읽을 수 없을 때만 이 파일을 읽는다. `config/identity.yaml` 이 없으면 `.key` 로 `admin` 계정을 만든다 |
| `config/server-ca.pem` | `client join` 이 클라이언트에 써 두는 서버 인증서 |
| `config/launcher.json` | [Windows 런처](#windows-런처)의 설정. 예: 고른 모드 |

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
- `-reset` 은 동작이다. 그 실행을 시작할 때 저장된 서버 상태를 지운다. `-daemon` 과 함께 쓰면 감시 프로세스가 같은 옵션으로 앱을 다시 띄우므로, 자동 재시작 때마다 다시 초기화된다. `-daemon` 과 함께 쓰지 않는다.
- `server config save` 는 서버를 시작하지 않고 설정을 `config/server.yaml` 에 쓴다. [서버를 시작하지 않고 설정 저장하기](#서버를-시작하지-않고-설정-저장하기)를 참고한다.

#### 서버를 시작하지 않고 설정 저장하기

`TTTGate server config save [options]` 는 준 값을 `config/server.yaml` 에 쓴다. 서버는 시작하지 않는다.

```shell
./TTTGate-linux-x64 server config save -adminPort 9400 -controlPort 9126 -controlTls
```

- 받는 옵션은 `-adminPort`, `-adminBindHost`, `-adminAllowedOrigins`, `-controlPort`, `-controlTls`, `-controlProtocolMode`, `-allowLegacyAdminRemote` 다. [서버 옵션](#서버-옵션)을 참고한다.
- 주지 않은 값은 그대로 둔다. 명령줄은 빈 값을 받지 않으므로 `server config save` 로는 `adminAllowedOrigins` 를 비울 수 없다. 목록은 관리 화면에서 비운다.
- `server.yaml` 이 없으면 기본값으로 먼저 만든다.
- 관리 화면에서 저장할 때와 같은 검사를 거친다.
- 저장하면 마지막 줄에 `Saved <path>` 를 출력한다. 그 앞에 서버 로그 줄이 나올 수 있고, 서버 로그 파일도 쓴다. 버전 배너는 출력하지 않는다.
- 이 설치본의 TTTGate 서버가 돌고 있으면 아무것도 저장하지 않는다. 실행 중인 프로세스의 모드를 알 수 없을 때도 마찬가지다. 먼저 `TTTGate stop` 으로 서버를 멈춘다. 같은 설치본에서 클라이언트가 돌고 있는 것은 상관없다.
- 저장할 `adminBindHost` 가 루프백이 아니면, `-allowLegacyAdminRemote` 를 붙이지 않는 한 아무것도 저장하지 않는다. 붙여서 저장했다면 나중에 서버를 시작할 때도 같은 `-allowLegacyAdminRemote` 를 붙인다.

| 종료 코드 | 뜻 |
|---|---|
| 0 | 저장했다 |
| 1 | 값이 잘못되었다. 메시지는 stderr 에 나온다. 아무것도 저장하지 않고, `config/` 에 새 파일도 남기지 않는다. |
| 75 | 이 설치본의 TTTGate 서버가 돌고 있다. 먼저 멈춘다 |
| 77 | 관리 화면이 다른 호스트에서 접근 가능해지는데 `-allowLegacyAdminRemote` 가 없다. 아무것도 저장하지 않고, `config/` 에 새 파일도 남기지 않는다. |

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

- 주소가 `127.0.0.1`, `localhost`, `[::1]` 또는 `adminBindHost` 에 적은 IP 주소(IPv4·IPv6)나 호스트 이름(`0.0.0.0`, `::` 제외)이고, 포트가 `adminPort` 인 페이지
- origin 이 `adminAllowedOrigins` 에 있는 페이지

그 밖의 주소에는 `403 Forbidden origin` 으로 답한다. IPv6 주소는 대괄호로 감싸 적는다. 예: `https://[::1]:9300`.

#### 관리 화면 언어

관리 화면은 한국어나 영어로 보인다. 브라우저 언어 목록(`navigator.languages`)의 첫 언어를 따르고, 목록이 비어 있으면 `navigator.language` 를 따른다. 그 언어가 `ko` 나 `ko-*`(예: `ko-KR`)이면 한국어로, 그 밖의 언어면 영어로 보인다. 예를 들어 목록이 `en-US`, `ko-KR` 순서이면 `en-US` 가 첫 언어이므로 영어로 보인다.

언어를 바꾸려면 브라우저 언어 설정에서 원하는 언어를 맨 위로 옮긴 뒤 페이지를 새로 고친다. 관리 화면에는 언어 선택 메뉴가 없다. 서버 로그와 명령줄 출력은 영어 그대로다.

#### 다른 컴퓨터에서 관리 화면 열기

관리 화면은 기본으로 서버 호스트에서만 열린다. 다음 방법 가운데 하나를 쓴다.

1. **SSH 터널(권장).** 서버 설정을 바꾸지 않아도 된다. 내 컴퓨터에서 다음을 실행한다.

   ```shell
   ssh -L 9300:127.0.0.1:9300 user@server.example.com
   ```

   SSH 세션을 열어 둔 채로 내 컴퓨터에서 `https://127.0.0.1:9300/` 을 연다. 로컬 포트는 `adminPort` 와 같아야 한다. 다른 로컬 포트로 열면 `403 Forbidden origin` 이 난다.
2. **관리 화면 포트를 직접 열기(권장하지 않음).** 사용자가 서버 주소와 관리 화면 포트로 관리 화면을 바로 연다.
   1. `config/server.yaml` 을 고친다. 사용자가 브라우저에 입력하는 주소를 모두 `adminAllowedOrigins` 에 적는다. IP 주소와 DNS 이름마다 포트까지 적는다.

      ```yaml
      adminBindHost: 0.0.0.0
      adminTls: true
      adminAllowedOrigins:
        - "https://192.0.2.10:9300"
        - "https://admin.example.com:9300"
      ```

      - `0.0.0.0`(모든 IPv4 주소)와 `::`(모든 주소)는 `adminAllowedOrigins` 와 함께 써야 동작한다. 목록에 없는 주소로 열면 로그인이 `403 Forbidden origin` 으로 실패한다. `adminAllowedOrigins` 에 적지 않아도 되는 주소는 관리 화면 포트를 쓰는 `127.0.0.1`, `localhost`, `[::1]` 뿐이다.
      - `adminBindHost` 가 서버의 IP 주소(IPv4·IPv6)나 호스트 이름 하나(예: `192.0.2.10`, `fd00::10`, `admin.example.com`)이면, 그 주소와 관리 화면 포트로 연 페이지(예: `https://192.0.2.10:9300`, `https://[fd00::10]:9300`)는 목록에 없어도 된다. 다른 DNS 이름처럼 다른 주소로 열려면 목록에 적어야 한다.
      - 항목 규칙은 방법 3과 같다. `https://` origin 만 받고, 스킴·호스트·포트가 정확히 같아야 하며, 경로와 와일드카드는 받지 않는다. 포트는 443일 때만 생략한다. 규칙에 맞지 않는 항목이 있으면 서버가 시작할 때 `server configuration is not ready` 를 남기고 멈춘다. 이 메시지는 어느 항목이 틀렸는지 알려 주지 않는다. `-daemon` 으로 시작했다면 메시지는 터미널이 아니라 `logs/` 에 남는다. 이 메시지를 보면 항목마다 위 규칙에 맞는지 확인한다.
   2. `bin` 폴더에서 서버를 `-allowLegacyAdminRemote` 와 함께 시작한다. 이 플래그는 저장되지 않으므로 서버를 시작할 때마다 줘야 한다. 빠뜨리면 서버가 `Refusing insecure admin policy: ...` 를 출력하고 멈춘다. `-daemon` 으로 시작하면 감시 프로세스가 같은 옵션으로 앱을 다시 시작한다.

      ```shell
      cd ~/TTTGate/bin
      ./TTTGate-linux-x64 server -daemon -allowLegacyAdminRemote
      ```

      서버를 멈출 때는 같은 폴더에서 `./TTTGate-linux-x64 stop` 을 실행한다.
   3. 운영체제 방화벽에서 관리 화면 포트를 허용한다. 클라우드 호스트라면 클라우드 네트워크 규칙에서도 이 포트의 인바운드를 허용해야 한다. Azure 는 네트워크 보안 그룹, AWS 는 보안 그룹, OCI 는 보안 목록이고, 다른 클라우드에도 같은 역할의 규칙이 있다. 접속하는 쪽 주소는 관리 화면이 필요한 곳만 허용한다.
   - **위험:** 포트에 닿을 수 있는 누구나 비밀번호를 시도할 수 있다. 로그인 잠금은 적용된다. 관리자 계정에 2단계 인증을 켜고, `adminTls: true` 를 유지하고, 접속하는 쪽 주소를 제한한다.
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

`-trustXForwardedFor` 는 로그인 잠금, 감사 로그, 세션 목록이 쓰는 클라이언트 주소와 2단계 로그인 티켓을 묶어 두는 클라이언트 주소를 바꾼다. 터널의 IP 제한이 내 IP 로 저장하는 주소도 바꾼다([켠 사람의 IP 에서만 연결 받기](#켠-사람의-ip-에서만-연결-받기) 참고). 국가 필터는 바꾸지 않는다.

#### 관리 화면이 열리지 않을 때

| 증상 | 원인 | 조치 |
|---|---|---|
| 브라우저가 연결 거부를 알린다. | 서버가 실행 중이 아니거나, 관리 화면이 서버 호스트에서 오는 연결만 받거나(`adminBindHost: 127.0.0.1`), 포트가 틀렸다. | 서버를 시작한다. `config/server.yaml` 의 `adminBindHost` 와 `adminPort` 를 확인한다. SSH 터널을 쓰거나 포트를 직접 연다(위의 방법 2). |
| 연결이 시간 초과로 끝난다. | 방화벽이나 클라우드 네트워크 규칙이 포트를 막고 있거나, 호스트가 꺼져 있다. | 운영체제 방화벽과 클라우드 네트워크 규칙(Azure, AWS, OCI 등)에서 관리 화면 포트를 허용한다. |
| 로그인이 `403 Forbidden origin` 으로 실패한다. | 연 주소가 관리 화면 포트를 쓰는 `127.0.0.1`, `localhost`, `[::1]`, `adminBindHost` 에 적은 IP 주소나 호스트 이름(`0.0.0.0`, `::` 제외)이 아니고, `adminAllowedOrigins` 에도 없다. | 연 주소를 스킴·호스트·포트까지 정확히 `adminAllowedOrigins` 에 넣고 서버를 다시 시작한다. SSH 터널이면 로컬 포트를 `adminPort` 와 같게 한다. |
| 서버가 `server configuration is not ready` 를 남기고 멈춘다. | `config/server.yaml` 의 값이 규칙에 맞지 않는다. 예를 들면 `adminAllowedOrigins` 항목이 틀렸다. `-daemon` 으로 시작했다면 메시지는 `logs/` 에만 남는다. | `adminAllowedOrigins` 항목이 위의 방법 2에 적은 규칙에 맞는지 확인한다. 항목을 고친 뒤 서버를 다시 시작한다. |
| 서버가 `Refusing insecure admin policy: ...` 를 출력하고 멈춘다. | `adminBindHost` 가 루프백 주소가 아니거나 `adminTls` 가 `false` 인데, 그에 맞는 플래그 없이 시작했다. | 메시지가 알려 주는 플래그(예: `-allowLegacyAdminRemote`)를 붙여 다시 시작한다. 원인이 `adminTls: false` 라면 되도록 `adminTls: true` 로 되돌린다. |
| 브라우저에 인증서 경고가 뜬다. | 서버가 만든 자체 서명 인증서를 쓰고 있다. | 서버 호스트 밖에서 관리 화면을 연다면 직접 준비한 인증서를 쓴다([관리 화면 열기](#관리-화면-열기) 참고). 다른 호스트가 접속할 수 있는 관리 화면에서 경고를 넘기는 습관을 들이지 않는다. 서버 호스트에서 열거나 SSH 터널로 열 때는 올바른 주소인지 확인한 뒤 계속 진행한다. |

#### 첫 관리자 로그인

새로 설치하면 서버에는 관리자 계정이 없다. 서버는 일회용 부트스트랩 토큰을 `config/.bootstrap-token` 에 쓰고, 토큰을 만들 때 파일 경로를 로그에 남긴다. 첫 설정을 마치기 전에는 서버를 다시 시작해도 토큰이 바뀌지 않는다.

1. 관리 화면을 연다.
2. 첫 슈퍼유저의 사용자 이름과 비밀번호를 넣고 **OK** 를 누른다.
   - 사용자 이름: 3–32자(영문자, 숫자, `.`, `_`, `-`). 대문자는 소문자로 바뀐다. 비워 두면 `admin` 이 된다.
   - 비밀번호: 앞뒤 공백을 빼고 8자 이상 1024자 이하.
3. **Bootstrap token** 입력란이 나타난다. 서버에서 토큰을 읽는다. 설치 폴더(`bin` 의 상위 폴더)에서는 `cat config/.bootstrap-token`, `bin` 폴더에서는 `cat ../config/.bootstrap-token` 을 실행한다. 읽은 토큰을 입력란에 붙여 넣고 **OK** 를 다시 누른다.
4. 서버가 슈퍼유저를 만들고, `config/.bootstrap-token` 을 지우고, 로그인시킨다. 다음부터는 사용자 이름과 비밀번호로 로그인한다.

토큰 파일 찾기:

- 서버는 시작할 때 `bin` 폴더 옆에 `config` 폴더를 만든다. 실행 파일이 `~/TTTGate/bin/TTTGate-linux-x64` 이면 토큰 파일은 `~/TTTGate/config/.bootstrap-token` 이다.
- 서버가 토큰을 만들 때 `logs/` 의 서버 로그에 `Bootstrap token created at <path>` 줄로 전체 경로를 남긴다. 기존 토큰을 다시 쓰는 재시작에서는 이 줄을 다시 남기지 않는다.
- 원격 서버에서는 SSH 로 토큰을 읽는다. 파일은 서버를 실행하는 계정(과 root)만 읽을 수 있으므로 그 계정으로 접속한다. `~` 를 서버가 해석하도록 따옴표를 그대로 둔다.

  ```shell
  ssh user@server.example.com 'cat ~/TTTGate/config/.bootstrap-token'
  ```

- 로그인 셸이 없는 서비스 계정이 서버를 실행한다면, 내 계정으로 접속해 `sudo` 로 읽는다. 이때 `~` 는 서비스 계정이 아니라 내 홈 폴더를 가리키므로 전체 경로를 쓴다. 예: `ssh -t user@server.example.com 'sudo cat /opt/TTTGate/config/.bootstrap-token'`.

첫 설정을 할 수 있는 사람:

- 토큰을 아는 사람만 할 수 있다. Linux 에서는 파일 권한이 0600 이라서 서버를 실행하는 계정(과 root)만 토큰을 읽을 수 있다. 결국 서버 호스트의 운영자만 첫 비밀번호를 정할 수 있다.
- 서버는 요청이 어디서 왔는지 보지 않는다. 기본값 `adminBindHost: 127.0.0.1` 이면 관리 화면은 서버 호스트에서나 SSH 터널로만 열린다. 관리 화면을 다른 호스트에 열어도 첫 설정은 토큰이 지킨다.
- 실패한 시도는 모두 로그인 실패로 센다. 토큰 없이 처음 누른 **OK** 도 마찬가지다. 한 주소 대역(IPv4 /24, IPv6 /64)에서 1분 안에 로그인이 5번 실패하면, 서버는 1분 동안 `429` 로 답한다.

#### 관리자 계정 복구

아래에서 처음으로 들어맞는 경우를 따른다.

1. **비밀번호를 안다.** **My account** 에서 **Change password** 를 누른다. 인증 앱을 잃어버렸다면 로그인 중 2단계 인증 화면에서 **Use a recovery code instead** 를 고른다. 로그인한 뒤 **My account** 의 **Two-factor authentication** 에서 **Disable** 을 누르고 비밀번호를 넣는다. 그다음 **Set up** 을 눌러 새 앱을 등록한다. **Replace app** 을 누르면 한 번에 새 앱으로 바꿀 수 있다. 복구 코드는 하나당 한 번만 쓸 수 있다. 내 계정에 2단계 인증이 필수이고(`mfaRequiredForSuperusers`, 또는 그룹의 **Require two-factor authentication**) 인증 앱이 유일한 수단이면 **Disable** 은 꺼져 있다. 이때는 **Replace app** 을 쓴다. 남은 복구 코드가 없으면 2번 경우를 따른다. 로그인할 수 있는 다른 슈퍼유저도 없으면 3번 경우를 따른다.
2. **로그인할 수 있는 다른 슈퍼유저가 있다.** 그 슈퍼유저가 **Users** 에서 해당 계정을 고르고 **Reset password** 를 누른다.
   - 관리 화면은 임시 비밀번호를 한 번만 보여 준다. 안전한 방법으로 사용자에게 전한다.
   - 서버는 그 사용자의 세션을 모두 끊는다. 사용자는 다음 로그인 때 새 비밀번호를 정해야 한다.
   - 감사 로그에 `temp_password_issued` 가 남는다.
   - 사용자가 인증 앱도 잃어버렸다면, 슈퍼유저가 같은 화면에서 **Reset MFA** 를 누른다. 이때도 그 사용자의 세션이 모두 끊긴다.
3. **로그인할 수 있는 슈퍼유저가 없다(비밀번호를 잊었거나, 2단계 인증을 잃었고 남은 복구 코드도 없다).** 서버 호스트에서 계정 저장소를 초기화한다. 그러면 서버가 첫 관리자 설정을 다시 시작한다. 아래 명령은 `~/TTTGate` 를 기준으로 한다. `~/TTTGate` 는 실제 설치 폴더로 바꾼다(예: `/opt/TTTGate`). `cp` 나 `rm` 이 `No such file or directory` 를 출력하면 폴더가 틀린 것이다. 멈추고 경로를 고친다. `.key` 가 지워지지 않으면 예전 `admin` 계정이 되살아난다. `config/identity.yaml` 의 파일 권한은 0600 이다. 서비스 계정이 서버를 실행한다면 그 계정으로 명령을 실행하거나, `sudo` 와 함께 전체 경로(예: `/opt/TTTGate/config/identity.yaml`)를 쓴다. 백업은 관리자만 읽을 수 있는 폴더에 둔다.

   진행하기 전에 다음 주의 사항을 읽는다.

   - 모든 사용자, 그룹, 2단계 인증 설정이 사라진다. 첫 설정을 마친 뒤 다시 만든다.
   - `config/server.yaml` 의 터널과 신뢰 클라이언트는 남는다. 다만 터널 소유자가 더는 없는 사용자를 가리킨다. 터널마다 소유자를 확인하고 새 소유자를 정한다.
   - `config/.key` 도 반드시 지운다. `config/identity.yaml` 이 없고 `config/.key` 가 있으면, 서버는 `.key` 의 예전 비밀번호로 `admin` 계정을 다시 만든다.
   - 이 작업에 `-reset` 은 쓰지 않는다. `-reset` 은 `config/` 의 모든 파일(터널과 신뢰 클라이언트가 든 `server.yaml` 포함)과 저장된 인증서를 지운다.

   1. 서버를 멈춘다. `bin` 폴더에서 `./TTTGate-linux-x64 stop` 을 실행한다. systemd 같은 서비스 관리자가 서버를 실행한다면, 서버가 다시 뜨지 않도록 그 관리자로 서비스를 멈춘다.
   2. `config/identity.yaml` 을 안전한 곳에 복사해 둔다. 파일 이름에 시각을 넣으면 예전 사본을 덮어쓰지 않는다. 이 파일에는 비밀번호 해시와 2단계 인증 비밀값이 들어 있다. 사본은 안전하게 보관하고, 더 필요 없으면 지운다.

      ```shell
      cp -p ~/TTTGate/config/identity.yaml ~/identity.yaml.$(date +%Y%m%d%H%M%S).bak
      ```

   3. `config/identity.yaml` 을 지운다. `config/.key` 가 있으면 그것도 지운다.

      ```shell
      rm ~/TTTGate/config/identity.yaml
      rm -f ~/TTTGate/config/.key
      ```

   4. 평소와 같은 옵션으로 서버를 다시 시작한다(예: 방법 2라면 `-allowLegacyAdminRemote`). 서버가 `config/.bootstrap-token` 에 새 토큰을 만든다. [첫 관리자 로그인](#첫-관리자-로그인)을 진행한다. `server.yaml` 에서 `mfaRequiredForSuperusers` 가 켜져 있으면, 새 슈퍼유저는 첫 로그인 때 2단계 인증을 설정해야 한다.

사용자 이름은 바꿀 수 없다. 새 이름을 쓰려면 새 슈퍼유저를 만들고 그 계정으로 로그인한다. 예전 계정이 소유한 터널의 소유자를 바꾼 뒤 예전 계정을 지운다. 터널을 소유한 사용자는 지울 수 없다. 서버는 마지막 활성 슈퍼유저도 지우거나, 비활성으로 바꾸거나, 일반 사용자로 내리지 않는다.

#### 터널 켜고 끄기

로그인하면 관리 화면은 역할과 관계없이 **Tunnels** 목록을 먼저 보인다. 터널마다 이름, 상태 한 줄, 스위치가 있다.

- **켜기:** 스위치를 누른다. 시간 제한 없이 바로 켠다. 그룹에 사용 시간 상한이 있으면 서버가 적용한다.
- **끄기:** 스위치를 누른다. 끄면 진행 중인 연결이 바로 끊기므로, 연결이 있으면 먼저 묻는다(`2 connections will be cut.`). 연결이 없으면 바로 끈다.
- **되돌리기:** 바꿀 때마다 **Undo** 가 붙은 알림이 5초 동안 보인다. 끄기를 되돌리면 끈 순간에 남아 있던 시간으로 다시 켠다. 끊긴 연결은 돌아오지 않는다.
- **상태 줄:** `On`, `Off`, `client offline`(이 터널을 맡을 수 있는 클라이언트가 연결되어 있지 않음), 남은 시간, `Can't open port <포트>`, 내 것이 아닌 터널의 소유자, `cert not verified` 를 보인다. 보기만 허락된 터널은 스위치 대신 자물쇠를 보인다.
- **이름:** 터널 편집 화면의 **Name**(선택, 40자까지)에 이름을 넣는다. 이름이 없으면 포트와 목적지를 보인다. 이름만 바꿔 저장하면 터널을 다시 시작하지 않으므로 진행 중인 연결이 남는다.
- **IP 제한:** 상태 줄 아래 버튼은 그 터널이 켠 사람의 IP 에서만 연결을 받는지 보이고, 옆의 갱신 버튼은 내 IP 를 지금 주소로 바꾼다. [켠 사람의 IP 에서만 연결 받기](#켠-사람의-ip-에서만-연결-받기)를 읽는다.
- **연결:** 켜진 터널은 상태 줄 아래에 연결 수, 켜진 지 얼마인지, 주고받은 양을 보인다(`켜진 지 2시간 5분 · RX 58.1KiB · TX 59.5KiB`, 크기는 바이트 단위). 고칠 수 있는 터널이면 **연결 N** 버튼이 열린 연결의 주소 목록을 연다. × 버튼은 그 연결을 바로 끊고(**연결 끊기**, 묻지 않음), 슈퍼유저는 확인 창을 거쳐 그 주소를 **차단**한다(이 터널만, 또는 모든 터널). 줄에는 이 터널을 맡을 수 있는 클라이언트도 보인다(`클라이언트: 사무실 PC`, ● 연결됨, ○ 연결 안 됨, 고른 클라이언트가 없으면 `모두`). 차단을 더하면 이미 들어와 있는 연결도 끊는다. **Security** 화면에서 더한 차단도 같다.
- **자세히:** 줄을 누르면 편집 화면이 열린다. **Status** 영역에 켜진 지 얼마인지, 연결 수, 트래픽, 거절 수, **자동 꺼짐까지** 타이머가 있다. 편집 화면은 고칠 수 있는 터널에서만 열린다.

#### 패스키로 로그인

패스키를 쓰면 사용자 이름과 비밀번호 대신 기기의 PIN·지문·얼굴 확인으로 로그인한다. 패스키로 로그인하면 2단계 인증 코드를 묻지 않는다.

조건:

- 관리 화면을 도메인 이름으로 연다(예: `https://tttgate.example.com:9300`). `https://192.168.0.10:9300` 같은 IP 주소에서는 패스키를 쓸 수 없다. `http://localhost` 는 쓸 수 있다(예: SSH 터널).
- 브라우저가 HTTPS 인증서를 신뢰해야 한다. 자체 서명 인증서는 기기가 신뢰할 때만 쓸 수 있다(예: 사설 CA 를 기기에 설치한 경우). 인증서 경고를 무시하고 들어간 페이지에서는 패스키를 쓸 수 없다.
- `server.yaml` 의 `adminAllowedOrigins` 에 관리 화면 주소를 넣는다(예: `adminAllowedOrigins: ["https://tttgate.example.com:9300"]`). [다른 컴퓨터에서 관리 화면 열기](#다른-컴퓨터에서-관리-화면-열기)를 참고한다.
- 패스키는 등록한 도메인 이름에서만 쓸 수 있다. 다른 이름으로 관리 화면을 열면 그 이름에서도 패스키를 등록한다.

기기마다 패스키 등록:

1. 비밀번호로 로그인한 뒤 **My account** 를 연다.
2. **Passkeys** 에서 **Add a passkey** 를 누른다.
3. 기기 이름과 비밀번호를 넣고 **Continue** 를 누른다.
4. 기기의 PIN·지문·얼굴 확인을 한다.

패스키는 20개까지 등록할 수 있다. 휴대폰이나 비밀번호 관리자가 동기화하는 패스키에는 `synced` 가 붙는다.

로그인: 로그인 화면에서 **Sign in with a passkey** 를 누르고 패스키를 고른다. 사용자 이름은 넣지 않는다. 어떤 기기에서 패스키로 로그인하거나 패스키를 등록한 뒤에는, 그 기기의 로그인 화면이 패스키 버튼을 먼저 보이고 비밀번호 칸은 **Use password** 뒤에 접어 둔다.

패스키 삭제: **My account** 에서 그 패스키 옆의 **Remove** 를 누른다. 기기를 잃어버렸으면 다른 기기로 로그인해 그 기기의 패스키를 지운다. 슈퍼유저는 한 사용자의 패스키를 모두 지울 수 있다. **Users** 에서 사용자를 고르고 **Remove passkeys** 를 누른다. 이때 그 사용자의 세션도 모두 끊긴다. 감사 로그에는 `passkey_registered`, `passkey_removed`, `passkey_reset` 이 남는다. 패스키 로그인은 `method: passkey` 가 붙은 `login_success` 또는 `login_failure` 로 남는다.

#### 그룹에 2단계 인증 강제하기

슈퍼유저는 그룹의 모든 구성원에게 2단계 인증을 요구할 수 있다. **Groups** 에서 그룹을 고르고 **Sign-in** 카드의 **Require two-factor authentication** 을 켠다. 2단계 인증 수단이 없는 구성원이 있으면 저장하기 전에 그 인원을 보여 준다.

- 패스키와 인증 앱은 모두 2단계 인증으로 인정한다.
- 둘 다 없는 구성원은 다음에 관리 화면을 쓸 때 하나를 등록해야 한다. 등록하기 전에는 **My account** 만 열린다. 지금 로그인해 있는 구성원에게도 적용된다.
- 패스키만 가진 구성원은 패스키로 로그인해야 한다. 비밀번호만으로는 로그인할 수 없다. 패스키는 IP 주소에서 쓸 수 없으므로, IP 주소로 로그인하려면 인증 앱도 등록해 둔다.
- 구성원은 마지막 2단계 인증 수단을 지울 수 없다. **Disable** 과 **Remove** 가 꺼진 채 이유를 보인다.
- **Users** 에서 이런 구성원의 화면을 열면 2단계 인증 상태 옆에 **Required** 가 보인다.
- 슈퍼유저에게는 그룹 설정 대신 서버 설정 `mfaRequiredForSuperusers` 가 적용된다. 규칙은 같다. 패스키를 인정하고, 지금 열린 세션에도 적용된다.

구성원이 인증 앱이 든 휴대폰을 잃어버렸다면:

- 남은 복구 코드가 있으면 그 코드로 로그인한 뒤 **My account** 에서 **Replace app** 을 누른다. 비밀번호를 확인한 뒤 새 QR 코드를 찍고 코드를 넣는다. 교체를 마칠 때까지 예전 앱도 그대로 쓸 수 있다.
- 복구 코드가 없으면 슈퍼유저가 **Users** 에서 그 구성원을 고르고 **Reset password** 를 누른다. **Also reset two-factor authentication and passkeys** 를 켠 채로 둔다. 서버가 그 구성원의 인증 앱과 모든 패스키를 지우고 세션을 끝낸다. 임시 비밀번호를 구성원에게 전한다. 구성원은 다음 로그인 때 새 비밀번호를 정한 뒤 2단계 인증을 다시 등록한다. 감사 로그에는 `temp_password_issued` 가 `secondFactorsReset: true` 와 함께 남는다.

#### 켜기·끄기만 하는 그룹과 터널 공유

그룹 구성원에게 터널을 켜고 끄는 일만 맡길 수 있다. **Groups** 에서 **Tunnel access** 를 **Toggle only**(`tunnel_crud: toggle`)로 정한다. 이 그룹 구성원은 자기가 소유했거나 자기에게 공유된 터널을 보고 켜고 끈다. 터널을 더하거나 고치거나 지울 수는 없으므로, 목록에 **Add tunneling service** 버튼이 없고 줄을 눌러도 편집 화면이 열리지 않는다. 이런 구성원에게 터널을 맡기려면 슈퍼유저가 편집 화면의 **Change owner** 로 소유자를 바꾼다.

다른 사용자에게 터널을 공유하려면:

1. 고칠 수 있는 터널의 편집 화면을 연다. 슈퍼유저는 모든 터널을 고칠 수 있다.
2. **Shared with** 칸에 사용자 이름이나 표시 이름을 2자 이상 입력한다. 목록에서 위·아래 화살표와 Enter, 또는 마우스로 사용자를 고른다. Esc 를 누르면 목록이 닫힌다.
3. 고른 사용자는 칩으로 보인다. 칩의 **×** 를 누르면 뺀다. 그다음 터널을 저장한다.

- 공유받은 사용자는 그 터널을 보고 켜고 끈다. 단, 그 사용자 그룹의 **Tunnel access** 가 **None** 이면 쓸 수 없다. 공유만으로는 터널을 고치거나 지울 수 없다. **Read only** 그룹 사용자는 자기 터널은 켤 수 없지만 공유받은 터널은 켤 수 있다.
- 한 터널은 50명까지 공유할 수 있다. 검색은 모든 그룹의 활성 사용자에서 찾는다. 슈퍼유저는 모든 터널을 켤 수 있으므로 다른 사용자의 검색 결과에 나오지 않는다. 검색은 슈퍼유저와 **Full** 구성원만 쓸 수 있다.
- 공유 목록은 그 터널을 고칠 수 있는 사용자에게만 보인다.
- 공유 목록만 바꿔 저장하면 터널을 다시 시작하지 않으므로 진행 중인 연결이 남는다.
- 사용자를 지우면 서버가 모든 공유 목록에서 그 사용자를 뺀다.
- 사용 시간 상한: 터널을 켜면 소유자 그룹 상한과 켠 사람 그룹 상한 가운데 짧은 값을 쓴다. 슈퍼유저, 상한이 없는 그룹, `system:migrated` 소유자는 비교에서 빠진다. 나중에 소유자가 터널을 저장해도 이 상한은 그대로다. 다른 사용자가 다시 켜면(예: **자동 꺼짐까지** 타이머) 그 사용자의 상한을 쓴다.
- 감사 로그의 `tunnel_activated`·`tunnel_deactivated` 에는 소유자가 `ownerId` 로 남는다. 공유 목록이 바뀌면 `tunnel_updated` 에 `sharedUsersAdded`·`sharedUsersRemoved` 가 남는다.

#### 켠 사람의 IP 에서만 연결 받기

RDP 처럼 오래 열어 두는 터널에는 비밀번호를 무작위로 넣어 보는 공격이 계속 들어온다. IP 제한을 켜면 터널을 켠 사람의 IP 주소에서 오는 연결만 받는다. 다른 주소의 연결은 데이터를 읽기 전에 닫는다.

- **설정:** 터널마다 `activatorIpOnly` 설정이 있다. 편집 화면에서는 **Allowed IP** → **Only from the IP of whoever turned it on** 이다. 새 터널은 켜진 채 만들어진다. 이전 버전에서 저장한 터널은 꺼져 있으므로, 업그레이드해도 열려 있는 연결이 끊기지 않는다. 터널마다 직접 켠다.
- **허용 IP:** 서버는 터널마다 사용자별로 IP 주소를 하나씩 둔다(`config/server.yaml` 의 `activatorIps`). 관리 화면에서 터널을 켜면 내 항목이 지금 브라우저의 주소로 바뀐다. 다른 사용자의 항목은 그대로다. 이미 켜진 터널을 다시 켤 때(예: **자동 꺼짐까지** 타이머)도 같다. 터널을 끄거나, 사용 시간이 끝나거나, 서버를 다시 시작해도 목록은 지워지지 않는다.
- **터널 목록:** 켤 수 있는 터널의 줄에는 상태 줄 아래에 IP 제한 버튼이 있다. 회색 **IP limit off** 는 꺼진 상태다. 초록색은 내 허용 IP 를 보이고, 다른 사용자의 항목이 있으면 `+N` 을 붙인다. 주황색 `My IP not set` 은 목록에 내 항목이 없다는 뜻이다. 옆의 갱신 버튼(**Update to my IP**)을 누르면 내 항목이 지금 주소로 바뀐다. 터널이 꺼져 있어도 된다. 지금 주소가 내 허용 IP 와 다르면 갱신 버튼이 강조된다. 터널이 꺼져도 두 버튼은 그대로 쓸 수 있다.
- **바꿀 수 있는 사람:** 터널을 켤 수 있는 사람은 누구나 IP 제한을 켜고 자기 IP 를 갱신할 수 있다. IP 제한을 끄는 것은 터널을 고칠 수 있는 사람만 할 수 있다. 공유받은 사용자에게는 켜진 IP 제한이 작은 자물쇠와 함께 보이고, 끌 수 없다. 공유받은 사용자 한 명이 모두의 보호를 풀지 못하게 하기 위해서다.
- **거절된 연결:** TLS 터널에서는 TLS 핸드셰이크 전에 연결을 닫는다. 거절은 [거절된 연결](#거절된-연결)에 `activator-ip`(**IP limit**)로 남는다. 서버는 TCP 연결의 주소를 쓴다. `X-Forwarded-For` 같은 요청 헤더는 접속하는 쪽이 마음대로 정할 수 있으므로 쓰지 않는다.
- **지워지는 항목:** 공유 목록에서 사용자를 빼거나, 사용자를 지우거나, 소유자를 바꿔 이전 소유자가 더는 터널을 켤 수 없으면 서버가 그 사용자의 항목을 지운다. 비활성 사용자와 권한을 잃은 사용자의 항목은 파일에 남지만 연결을 허용하지 않는다. 항목이 바뀌면 더는 허용되지 않는 주소에서 열려 있던 연결도 닫는다.
- **감사 로그:** `tunnel_ip_limit_updated` 에 `enabled` 가 남는다. `tunnel_ip_refreshed` 에 `allowedIpBefore`·`allowedIp` 가 남는다. 터널을 켜서 내 항목이 바뀌면 `tunnel_activated` 에 같은 두 값이 남는다. 편집 화면의 저장으로 IP 제한이 바뀌면 `tunnel_updated` 에 `activatorIpOnly` 가 남는다.
- **API:** `PUT /api/tunneling/<port>/activatorIpOnly` 에 `{"enabled": true}` 나 `{"enabled": false}` 를 보낸다. 내 IP 갱신은 `POST /api/tunneling/<port>/activatorIp` 다. `GET /api/externalServerStatuses` 는 터널마다 `activatorIpOnly`, `myAllowedIp`, `allowedIpCount` 를, 최상위에 지금 내 주소 `requesterIp` 를 준다. 모든 사용자의 항목(`allowedIps`)은 슈퍼유저에게만 준다.

쓰기 전에 알아 둘 점:

- 슈퍼유저가 다른 사용자의 터널을 만들어 바로 켜면 슈퍼유저의 IP 만 들어 있다. 소유자는 터널을 켜거나 **Update to my IP** 를 눌러야 연결할 수 있다.
- 관리 화면이 역방향 프록시 뒤에 있으면 `-trustXForwardedFor`(와 `-trustedProxyHops`)로 서버를 시작해야 서버가 브라우저의 주소를 본다. 그러지 않으면 모든 사용자의 IP 가 프록시 주소가 된다. SSH 터널로 관리 화면을 열면 서버에는 `127.0.0.1` 로 보이므로 인터넷에서 오는 연결이 모두 거절된다. 이때는 다른 방법으로 관리 화면을 열거나 IP 제한을 끈다.
- 휴대폰으로 터널을 켜고 PC 에서 접속하면 두 주소가 다를 수 있다. 이때 PC 에서 **Update to my IP** 를 누른다.
- 같은 PC 라도 관리 화면은 IPv6 로, 터널 연결은 IPv4 로 나갈 수 있다(듀얼 스택). 그러면 두 주소가 달라 연결이 거절된다. 관리 화면과 터널을 같은 방식으로 연다. 예를 들어 둘 다 IPv4 주소로 연다.
- 카페나 호텔처럼 여러 사람이 함께 쓰는 주소는 내가 IP 를 갱신할 때까지 허용된다. 다른 네트워크로 옮기면 **Update to my IP** 를 누른다.
- CDN 이나 역방향 프록시 뒤에 있는 HTTP·HTTPS 터널에는 IP 제한을 쓰지 않는다. 모든 연결이 프록시에서 오므로 서버가 모두 거절한다.
- 관리 화면 요청과 터널 연결이 같은 NAT·프록시 주소로 서버에 들어오면(예: Docker `userland-proxy`, 같은 호스트의 역방향 프록시) 서버가 그 공유 주소를 내 IP 로 저장하므로, IP 제한이 모든 연결을 받아들인다.

### 클라이언트

#### 코드로 등록하기

권장하는 방법이다. 제어 포트가 TLS 를 써야 하고(`config/server.yaml` 의 `tls: true`), `controlProtocolMode` 가 `mtls-strict` 가 아니어야 한다. 그렇지 않으면 서버가 코드를 발급하지 않는다.

1. 관리 화면에서 **Trusted clients** 를 열고 클라이언트를 추가한 뒤, 화면에 나온 명령을 복사한다. 이미 있는 클라이언트라면 **Enrollment code** 를 눌러도 된다. 코드는 한 번만 쓸 수 있고 기본으로 15분 뒤에 만료된다. 기한을 바꾸려면 같은 창의 **Code expires after** 에서 15분, 1시간, 24시간, 7일, 30일, **Never expires**(만료 없음) 가운데 하나를 고른다. 그러면 그 기한으로 새 코드를 발급하고, 이전 코드는 더 이상 쓸 수 없다.
   - **Never expires** 코드는 쓰이거나, 그 클라이언트에 새 코드를 발급하거나, 비밀값을 바꾸거나(**New secret**), 클라이언트를 지우거나, 터널 서버 설정(포트·TLS·인증 키 등)이 바뀌거나, 서버를 다시 시작할 때까지 유효하다. 코드는 메모리에만 있다. 이런 코드는 비밀번호처럼 다룬다.
   - 관리 화면은 코드를 두 단계로 받는다. 먼저 15분 동안 유효한 코드를 받고, 창에 코드를 보여 줄 때 고른 기한을 적용한다. 코드를 보여 주기 전에 창이 닫히거나 응답이 사라지면 긴 기한은 적용되지 않고, 코드는 15분 뒤 만료된다.
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

스크립트에서 쓸 때는 `-json` 을 붙인다. 그러면 `client join` 은 stdout 에 JSON 한 줄만 출력한다.

- 성공: `{"ok":true,"clientId":"...","server":"host:port"}`
- 실패: `{"ok":false,"category":"...","message":"..."}`. `category` 는 `argument`, `exists`, `write`, `rejected`, `proof`, `network`, `throttled`, `unavailable` 가운데 하나다.

종료 코드는 그대로다(0, 1, 2, 78). 등록 코드는 출력에 나오지 않는다.

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

### Windows 런처

`bin/TTTGate-launcher-win-x64.exe` 는 Windows 용 창 프로그램이다. 설치 프로그램과 관리자 권한이 필요 없는 포터블 프로그램이라, 두 번 클릭하면 바로 실행된다.

- `TTTGate-win-x64.exe` 나 `TTTGate-win-arm64.exe` 와 같은 `bin` 폴더에 둔다. 런처는 이 PC 에 맞는 쪽을 쓰고, 다른 쪽만 있으면 그것을 쓴다.
- 런처는 명령줄 프로그램(CLI)을 조작할 뿐이다. 터널링은 CLI 가 한다.
- 두 Windows 릴리스 zip 파일에 모두 들어 있다. Windows on Arm 에서는 x64 런처가 에뮬레이션으로 돈다.
- Windows 10 1709 이상이 필요하다(x64, 또는 에뮬레이션으로 도는 Arm64). Microsoft Edge WebView2 를 쓴다. WebView2 는 Windows 11 과 최신 Windows 10 에 들어 있다. WebView2 가 없으면 다운로드 링크 https://go.microsoft.com/fwlink/p/?LinkId=2124703 를 담은 메시지를 보여 주고 끝난다. 이때도 명령줄은 그대로 쓸 수 있다.
- 네트워크에서 아무것도 받아 오지 않는다. 화면은 모두 exe 안에 들어 있다.
- Windows 표시 언어가 한국어면 한국어로, 그 밖에는 영어로 보여 준다.
- 런처와 CLI 의 버전이 다르면 창에 경고를 보여 준다. 같은 릴리스의 파일을 함께 쓴다.

#### 처음 시작할 때

서버 모드와 클라이언트 모드 가운데 하나를 고른다. 고른 모드는 `config/launcher.json` 에 저장된다. 나중에 바꾸려면 창 아래의 **모드 바꾸기**(**Change mode**)를 누른다. TTTGate 가 멈춰 있을 때만 바꿀 수 있다.

#### 클라이언트 모드

- 이 PC 가 이미 등록되어 있으면(`client config show` 에 `clientId` 와 비밀값이 있으면) 창에 클라이언트 ID 와 서버를 보여 준다. **데몬으로 실행**(**Run in the background**)을 누르면 클라이언트가 시작된다. 등록 단계는 건너뛴다.
- 등록되어 있지 않으면 서버 주소와 관리 화면에서 받은 등록 코드를 넣고 **등록**(**Enroll**)을 누른다. 런처는 `client join --code-stdin --json` 을 실행하고 결과를 문장으로 보여 준다.
- 예전 공유 키 방식의 클라이언트(`client.yaml` 에 `clientId` 가 없음)는 런처로 실행할 수 없다. 코드로 등록하거나 계속 명령줄에서 실행한다.
- `config/client.yaml` 이 있지만 읽을 수 없거나 예전 공유 키 방식이면, 런처는 이 코드로 다시 등록할지 묻는다. 동의하면 파일을 바꾸고 이전 파일은 `client.yaml.bak` 으로 남긴다.
- **다른 서버로 다시 등록**(**Enroll with another server**)은 이 PC 를 다시 등록한다. TTTGate 가 돌고 있으면 먼저 멈춘다. `client.yaml` 을 바꾸고, 이전 파일은 `client.yaml.bak` 으로 남긴다.
- 연결이 3번 이상 잇달아 실패하면, 서버가 이 클라이언트를 지웠거나 비밀값을 바꿨을 수 있다고 알려 준다. 그렇다면 새 코드로 다시 등록한다.

#### 서버 모드

창에 다음 설정을 넣는 입력 양식이 나온다.

- 관리 화면 포트
- 열 주소: 지금 설정 유지, 이 PC 에서만(`127.0.0.1`), 다른 PC 에서도(`0.0.0.0`)
- 허용 주소(origin). 한 줄에 하나씩 쓴다
- 제어 포트, TLS, 프로토콜 모드

비워 둔 값은 지금 설정을 그대로 쓴다. 나머지 설정은 관리 화면에서 바꾼다. `server.yaml` 이 아직 없으면 제어 포트의 **TLS** 는 **켬** 으로 골라져 있다. 클라이언트는 TLS 로만 등록 코드를 쓸 수 있는데, 새 `server.yaml` 은 이 값이 꺼져 있기 때문이다. 파일이 있으면 **지금 설정 유지** 로 골라져 있다.

**저장하고 시작**(**Save and start**)은 `server config save` 를 실행한 뒤 `server -daemon` 을 실행한다. 관리 화면이 다른 PC 에서도 열리게 되는 설정이면, 런처가 먼저 위험을 설명하고 묻는다. 확인하면 `-allowLegacyAdminRemote` 를 붙이고, 다음 시작부터도 이 선택을 기억한다.

#### TTTGate 가 실행 중일 때

- 창에 실행 상태를 보여 준다. 클라이언트라면 연결 상태도 보여 준다.
- 서버라면 기본 브라우저로 관리 화면을 여는 **관리 화면 열기**(**Open admin console**) 버튼이 있다. 처음 시작했을 때는 부트스트랩 토큰과 **복사**(**Copy**) 버튼도 보여 준다.
- 트레이(알림 영역) 아이콘은 붉은 터널 아이콘이다. 아이콘을 클릭하면 창이 열린다. 메뉴에는 **창 열기**, **관리 화면 열기**, **멈추기**, **다시 시작**, **로그 폴더 열기**, **끝내기** 가 있다(영어: **Open**, **Open admin console**, **Stop**, **Restart**, **Open logs folder**, **Quit**).
- TTTGate 가 실행 중일 때 창을 닫으면 창만 트레이로 숨는다. TTTGate 가 멈춰 있으면 창을 닫을 때 런처도 끝난다.
- **끝내기** 를 누르면 TTTGate 를 멈출지, 계속 둘지 묻는다.
- 런처를 다시 열면 실행 중인 TTTGate 를 찾아 이어서 관리한다.
- 런처는 TTTGate 폴더가 달라도 한 PC 에서 하나만 돈다. 두 번째로 실행하면 이미 떠 있는 창이 앞으로 나온다. 두 번째가 다른 TTTGate 폴더의 런처이면 창에 그 사실도 알린다. 다른 폴더를 쓰려면 먼저 떠 있는 런처를 끝낸다.

#### Windows 로그인 때 자동 시작

**Windows 로그인 때 자동 시작**(**Start when I sign in to Windows**)은 기본으로 꺼져 있다. 켜면 런처가 현재 사용자의 `Run` 레지스트리 키에 `TTTGate Launcher (<해시>)` 값을 쓴다. 해시는 런처 경로로 만들므로 TTTGate 폴더마다 값이 따로 있다. 로그인하면 런처가 창 없이 트레이에서 시작하고, TTTGate 가 돌고 있지 않으면 저장된 모드로 시작한다.

#### 보안 참고 사항

- 런처와 CLI 는 아직 코드 서명이 되어 있지 않다. 처음 실행할 때 Windows SmartScreen 이 경고할 수 있다. 계속하려면 **추가 정보**(**More info**)를 누른 뒤 **실행**(**Run anyway**)을 누른다.
- 런처는 등록 코드를 명령줄이 아니라 표준 입력(`--code-stdin`)으로 `client join` 에 넘긴다. 그래서 코드가 프로세스 목록이나 프로세스 생성 감사 로그에 남지 않는다.

#### 런처 빌드하기

- `npm run launcher:build` 로 런처를 빌드한다. 이 명령은 `node scripts/build-launcher.cjs dist/bin` 을 실행한다. 이 스크립트는 `launcher/src-tauri` 에서 `cargo build --release --locked --target x86_64-pc-windows-msvc` 를 돌리고, `target/x86_64-pc-windows-msvc/release/TTTGate-launcher.exe` 를 `dist/bin/TTTGate-launcher-win-x64.exe` 로 복사한다.
- 빌드에는 Rust 가 필요하다. Rust 버전(1.96.0)과 x64 타깃은 `launcher/src-tauri/rust-toolchain.toml` 이 고정한다. Rust 는 rustup 으로 설치한다.
- Windows 에서는 `npm run dist` 가 CLI 바이너리를 만든 뒤 런처도 빌드한다. 그래서 Windows 에서 `npm run dist` 를 돌리려면 Rust 가 있어야 한다. 없으면 빌드가 멈추고 https://rustup.rs 에서 Rust 를 설치하라고 알린다. 다른 운영체제에서는 이 단계가 `Windows launcher skipped` 를 출력하고 성공으로 끝난다.
- 릴리스 워크플로는 Windows 러너에서 런처를 빌드해 Windows zip 파일에 넣는다.

### 명령줄 레퍼런스

기본 형식은 다음과 같다.

```
TTTGate <server|client|stop|status> [command] [options]
```

#### 인자 문법

- **모드 단어.** 옵션도 아니고 옵션의 값도 아닌 첫 단어가 모드다. 모드는 `server`, `client`, `stop`, `status` 가운데 하나다. 옵션은 모드 앞에 와도 되고 뒤에 와도 된다. `TTTGate -adminPort 9400 server` 와 `TTTGate server -adminPort 9400` 은 같다. 모드는 소문자로 쓴다.
- **명령.** `client` 에는 `run`, `join <addr>`, `config show`, `config save` 명령이 있다. `server` 에는 `config save` 명령 하나가 있다. 명령은 모드 바로 뒤에 쓴다. `stop` 과 `status` 에는 명령이 없다. 그 밖의 단어가 남으면 오류다(`unexpected argument '...'`).
- **대시.** 옵션 앞의 대시 개수는 상관없다. `-addr`, `--addr`, `---addr` 은 같다. 도움말은 대시 하나로 보여 주고, 이름에 대시가 들어간 옵션만 대시 둘로 보여 준다(`--yes-insecure`). 다만 `--help`, `--help-advanced`, `--version` 은 예외로, 도움말에서 언제나 대시 둘로 보여 준다.
- **이름은 대소문자를 가린다.** `-adminport` 는 모르는 옵션이다. 프로그램은 `-adminPort` 를 제안한다.
- **값.** 값을 받는 옵션은 다음 단어(`-addr gw.example.com`)나 `=` 뒤의 글자(`-addr=gw.example.com`)를 값으로 읽는다. 다음 단어가 대시로 시작해도 값으로 읽으므로 `-bufferLimit -1` 이 동작한다. 값이 비어 있으면 오류다(`option '-addr' needs a value`).
- **플래그.** 값 없이 쓴 플래그는 켜진다. 플래그는 다음 단어나 `=` 뒤에 진릿값 단어 하나를 받을 수 있다. `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`(대소문자 무관) 가운데 하나이고, `false`, `0`, `no`, `off` 는 플래그를 끈다. 예: `-tls false`, `-reset=no`, `-requireCsrfHeader off`. `=` 뒤에 그 밖의 값을 쓰면 오류다.
- **정확히 써야 하는 옵션.** `-daemon` 은 대시 하나에 값과 `=` 없이 이대로만 쓴다. `--daemon`, `-daemon=true` 는 오류다.
- **모드 없이 쓸 수 있는 옵션.** 모드가 없으면 `-h`, `--help`, `--help-advanced`, `--version` 만 쓸 수 있다. 다른 옵션은 `option '...' needs a mode (server, client, stop or status)` 오류가 난다.
- **맞지 않는 곳에 쓴 옵션.** 다른 모드의 옵션을 쓰면 오류다(`option '-adminPort' is not available in client mode`). 다른 명령의 옵션도 오류다(`option '-save' is not available in 'client join'`).
- **모르는 옵션.** 모르는 옵션이 있으면 프로그램이 멈춘다. 그 모드의 옵션 가운데 비슷한 것(대소문자를 무시하고 두 글자 이하 차이)이 있으면 알려 준다. 예: `unknown option '-adr'. Did you mean '-addr'?`.
- **전체 검사.** 프로그램은 무엇이든 시작하기 전에 명령줄 전체를 검사한다. 오류마다 `TTTGate: <error>` 를 출력하고, 이어서 `Run 'TTTGate <mode> --help' for usage.` 를 출력한 뒤 종료 코드 2 로 끝난다.

#### 모드와 명령

| 모드 또는 명령 | 하는 일 | 받는 옵션 | 참고 |
|---|---|---|---|
| `server` | 터널 서버와 관리 화면을 시작한다. | 시작할 때 받는 [서버 옵션](#서버-옵션), `-daemon` | `TTTGate server --help` 로 옵션을 볼 수 있다. |
| `server config save` | 서버를 시작하지 않고 준 값을 `config/server.yaml` 에 저장한다. | `-adminPort`, `-adminBindHost`, `-adminAllowedOrigins`, `-controlPort`, `-controlTls`, `-controlProtocolMode`, `-allowLegacyAdminRemote` | `Saved <path>` 를 출력한다. 종료 코드는 0, 1, 75, 77 이다. [서버를 시작하지 않고 설정 저장하기](#서버를-시작하지-않고-설정-저장하기)를 참고한다. |
| `client` | 터널 클라이언트를 시작한다. | `--code`, `--code-stdin`, `--force`, `-json` 을 뺀 [클라이언트 옵션](#클라이언트-옵션) | `config/client.yaml` 이 있으면 읽는다. |
| `client run` | `client` 와 같다. | `client` 와 같다 | 스크립트에서 명령을 명시해야 할 때 쓴다. |
| `client join <addr>` | 관리 화면에서 받은 코드로 이 클라이언트를 등록한다. `config/client.yaml`(권한 0600)과 `config/server-ca.pem` 을 쓰고 끝난다. | `--code`(필수), `--force`, `-json` | `<addr>` 는 `-addr` 과 같은 형식이고 기본 포트는 9126 이다. 제어 포트가 TLS 를 써야 하므로 `tcp://` 는 받지 않는다. 터널을 연결하지 않고 pid 파일도 쓰지 않는다. `-json` 을 붙이면 JSON 한 줄을 출력한다([코드로 등록하기](#코드로-등록하기) 참고). |
| `client config show` | 최종 클라이언트 옵션과 각 값의 출처(`default`, `client.yaml`, `environment`, `file`, `command line`, `inferred`)를 출력한다. | `-daemon`, `-save`, `--code`, `--code-stdin`, `--force`, `-json` 을 뺀 클라이언트 옵션 | 연결하지 않는다. `clientSecret`, `key`, `privateKey` 는 `(hidden)`, PEM 본문은 `(PEM text)` 로 보여 준다. `client.yaml` 에 안전하지 않은 필드가 있으면 경고를 출력하고 값은 그대로 보여 준다(종료 코드 0). |
| `client config save` | 연결하지 않고 최종 클라이언트 옵션을 `config/client.yaml` 에 저장한다. | `client config show` 와 같다 | `Saved <path>` 를 출력한다. `-save` 와 같은 내용을 저장한다([클라이언트 옵션](#클라이언트-옵션) 참고). |
| `stop` | 이 설치본이 기록한 TTTGate 프로세스를 멈춘다. 데몬과 포그라운드 실행, 서버와 클라이언트를 모두 포함한다. | 도움말 옵션만 | [백그라운드 프로세스 멈추기](#백그라운드-프로세스-멈추기)를 참고한다. |
| `status` | 이 설치본의 TTTGate 서버나 클라이언트가 데몬이나 포그라운드로 돌고 있는지 보여 준다. | `-json`, 도움말 옵션 | TTTGate 가 돌고 있으면 종료 코드 0, 아니면 3 이다. [TTTGate 실행 여부 확인하기](#tttgate-실행-여부-확인하기)를 참고한다. |

`client join`, `client config show`, `client config save`, `server config save`, `status` 는 버전 배너를 출력하지 않는다. 그래서 스크립트가 출력을 그대로 읽을 수 있다.

#### 서버 옵션

모든 옵션은 `server` 모드에 적용된다. 어떤 옵션은 서버를 시작할 때(`server`)만 받고, 어떤 옵션은 `server config save` 에서만 받는다. 각 행에 어느 쪽인지 적었다. 맞지 않는 명령에 쓰면 오류다(종료 코드 2).

- 시작할 때와 `server config save` 모두: `-adminPort`, `-allowLegacyAdminRemote`
- `server config save` 에서만: `-adminBindHost`, `-adminAllowedOrigins`, `-controlPort`, `-controlTls`, `-controlProtocolMode`
- 시작할 때만: 나머지 서버 옵션 전부

| 옵션 | 값 | 기본값 | 유지 범위 | 설명 |
|---|---|---|---|---|
| `-adminPort <port>` | 정수 1–65535 | `9300` | `server.yaml` 에 저장(`adminPort`) | 관리 화면의 포트. 시작할 때와 `server config save` 모두 받는다. 잘못된 값이면 서버가 종료 코드 1 로 멈춘다(`Invalid admin port number (1 ~ 65535)`). 예: `server -adminPort 9400`. |
| `-adminBindHost <host>` | 호스트 이름 또는 IP 주소 | `127.0.0.1` | `server.yaml` 에 저장(`adminBindHost`) | 관리 화면이 연결을 받을 주소. `server config save` 에서만 받는다. 루프백이 아닌 값은 `-allowLegacyAdminRemote` 가 있어야 저장된다(없으면 종료 코드 77). 예: `server config save -adminBindHost 0.0.0.0 -allowLegacyAdminRemote`. |
| `-adminAllowedOrigins <origins>` | 쉼표로 구분한 origin 목록 | 빈 목록 | `server.yaml` 에 저장(`adminAllowedOrigins`) | 역방향 프록시 등을 거쳐 관리 화면을 열 수 있는 다른 주소. `server config save` 에서만 받는다. 빈 값은 오류다(종료 코드 2). 목록은 관리 화면에서 비운다. 예: `server config save -adminAllowedOrigins https://admin.example.com`. |
| `-controlPort <port>` | 정수 1–65535 | `server.yaml` 의 값 | `server.yaml` 에 저장(`port`) | 터널 클라이언트가 연결하는 제어 포트. `server config save` 에서만 받는다. 잘못된 값이면 종료 코드 1 이다. |
| `-controlTls` | 플래그 | `server.yaml` 의 값 | `server.yaml` 에 저장(`tls`) | 제어 포트에 TLS 를 쓴다. `server config save` 에서만 받는다. `-controlTls false` 는 TLS 를 끈다. [코드로 등록하기](#코드로-등록하기)에는 TLS 가 필요하다. |
| `-controlProtocolMode <mode>` | `legacy`, `mixed`, `mtls-strict` | `server.yaml` 의 값 | `server.yaml` 에 저장(`controlProtocolMode`) | 제어 프로토콜 모드. `server config save` 에서만 받는다. 그 밖의 값이면 종료 코드 1 이다. |
| `-keepAlive <ms>` | 0 이상의 정수 | `10000` | `server.yaml` 에 저장(`keepAlive`) | 제어 리스너의 TCP keepalive 간격. 음수나 숫자가 아닌 값이면 서버가 종료 코드 1 로 멈춘다(`Invalid keep alive time`). 예: `server -keepAlive 30000`. |
| `-trustXForwardedFor` | 플래그 | 꺼짐 | 이번 실행만 | 관리 화면 클라이언트의 주소를 `X-Forwarded-For` 에서 읽는다. 직접 관리하는 역방향 프록시 뒤에서만 쓴다. 프록시를 거쳐 관리 화면을 열려면 사용자가 여는 주소(예: `https://admin.example.com`)도 `adminAllowedOrigins` 에 넣는다. 켜져 있으면 시작할 때 경고를 남긴다. 예: `server -trustXForwardedFor -trustedProxyHops 1`. |
| `-trustedProxyHops <n>` | 정수 1–16 | `1` | 이번 실행만 | 관리 서버 앞에 있는 신뢰 프록시의 수. 아래 참고 사항을 읽는다. 잘못된 값이면 시작할 때 경고를 남기고 1 을 쓴다. `-trustXForwardedFor` 없이 쓰면 효과가 없고 경고를 남긴다. |
| `-reset` | 플래그 | 꺼짐 | 이번 시작 때 한 번 동작 | `config/` 디렉터리의 모든 파일(`server.yaml`, `.key`, `.bootstrap-token` 등 저장된 상태)과 저장된 인증서를 지우고 기본값으로 시작한다. `-reset` 과 `-reset true` 는 초기화하고, `-reset false` 는 아무것도 하지 않는다. **위험:** 터널, 신뢰 클라이언트, 관리자 계정이 모두 사라진다. `-daemon` 과 함께 쓰면 감시 프로세스가 같은 옵션으로 앱을 다시 띄우므로, 자동 재시작 때마다 다시 초기화된다. `-daemon` 과 함께 쓰지 않는다. |
| `-allowLegacyAdminHttp` | 플래그 | 꺼짐 | 이번 실행만 | `adminTls: false`(TLS 없는 레거시 관리 모드)를 허용한다. **위험:** 관리 화면과 세션 쿠키가 평문으로 오간다. `--help-advanced` 에 나온다. |
| `-allowLegacyAdminRemote` | 플래그 | 꺼짐 | 이번 실행만 | 루프백이 아닌 `adminBindHost` 를 허용한다. 시작할 때와 `server config save` 모두 받는다. `server config save` 에서는 그런 `adminBindHost` 를 저장할 수 있게 한다. 이 플래그 자체는 저장되지 않으므로, 서버를 시작할 때도 붙인다. **위험:** 다른 호스트에서 관리 화면에 접근할 수 있다. `--help-advanced` 에 나온다. |
| `-allowLegacyControlAuth` | 플래그 | 꺼짐(`allowLegacyControlAuth: false`) | `server.yaml` 에 저장(`allowLegacyControlAuth`) | 레거시 공유 키 제어 인증을 허용한다. `-allowLegacyControlAuth false` 로 한 번 시작하거나 `server.yaml` 을 고치기 전까지는 다음 실행에서도 켜진 채로 남는다. **위험:** 레거시 데이터 연결에는 바인딩 토큰이 없다. 그래서 데이터 핸들러 ID 를 맞힌 사람은 누구나 세션을 가로채 외부 사용자의 트래픽을 읽거나 끼워 넣을 수 있다. 켜져 있으면 시작할 때 경고를 남긴다. `--help-advanced` 에 나온다. |
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
| `-tls` | 실행 계열 명령 | 플래그 | 꺼짐 | `-save` 로 저장 | 제어 연결에 TLS 를 쓴다. 명령줄의 `-ca`, `-serverName`, `-cert`, `-privateKey` 도 TLS 를 켠다. 이 네 옵션을 `-tls false` 나 `tcp://` 와 함께 쓰면 오류다(종료 코드 2). |
| `-clientId <id>` | 실행 계열 명령 | 문자열 | 없음 | `-save` 로 저장 | 프로토콜 v2 클라이언트 식별자. 서버의 신뢰 클라이언트와 같아야 한다. |
| `-clientSecret <secret>` | 실행 계열 명령 | 문자열 | 없음 | `-save` 로 저장 | 프로토콜 v2 공유 비밀값. 권장하지 않는다. 같은 호스트의 다른 사용자가 명령줄을 볼 수 있고, 클라이언트가 경고를 남긴다. `-clientSecretFile` 과 함께 쓸 수 없다(종료 코드 2). |
| `-clientSecretFile <path>` | 실행 계열 명령 | 파일 경로. 상대 경로는 작업 디렉터리 기준이다. | 없음 | `-save` 로 저장(경로가 아니라 비밀값) | 프로토콜 v2 공유 비밀값을 파일에서 읽는다. 파일에는 비밀값만 둔다. 앞뒤 공백과 줄바꿈은 지운다. 파일이 없거나 읽을 수 없거나 비어 있으면 클라이언트가 종료 코드 78 로 멈춘다. 예: `-clientSecretFile /etc/tttgate/client-a.secret`. |
| `-name <name>` | 실행 계열 명령 | 문자열 | 무작위 터널 이름 | `-save` 로 저장 | 레거시 연결과 로컬 로그에 쓰는 클라이언트 이름. v2 서버는 언제나 그 `clientId` 로 등록된 이름을 보여 준다. 별칭: `-displayName`(폐기 예정, 경고가 난다). `-name` 과 `-displayName` 의 값이 다르면 오류다(종료 코드 2). |
| `-ca <path\|pem>` | 실행 계열 명령 | 파일 경로 또는 PEM 본문 | 없음 | `-save` 로 저장(경로는 경로로, PEM 본문은 본문으로) | 신뢰할 CA 또는 고정할 서버 인증서. TLS 를 켠다. 명령줄의 상대 경로는 작업 디렉터리 기준이고, `client.yaml` 의 상대 경로는 `config/` 디렉터리 기준이다. 파일이 없거나 인증서가 들어 있지 않으면 클라이언트가 종료 코드 78 로 멈춘다. |
| `-serverName <name>` | 실행 계열 명령 | 문자열 | 없음 | `-save` 로 저장 | 기대하는 TLS 서버 이름. TLS 를 켠다. 제어 포트 인증서를 고정한 클라이언트는 `tttgate-control` 을 쓴다. |
| `-cert <path\|pem>` | 실행 계열 명령 | 파일 경로 또는 PEM 본문 | 없음 | `-save` 로 저장(경로는 경로로, PEM 본문은 본문으로) | 상호 TLS 에 쓰는 클라이언트 인증서. TLS 를 켠다. 경로 규칙은 `-ca` 와 같다. |
| `-privateKey <path\|pem>` | 실행 계열 명령 | 파일 경로 또는 PEM 본문 | 없음 | `-save` 로 저장(경로는 경로로, PEM 본문은 본문으로) | `-cert` 의 개인 키. TLS 를 켠다. 경로 규칙은 `-ca` 와 같다. 잘못 넣은 키 본문일 수도 있으므로 오류 메시지에 경로를 보여 주지 않는다. |
| `-save` | `client`, `client run` | 플래그 | 꺼짐 | `config/client.yaml` 에 씀 | 최종 옵션을 `config/client.yaml` 에 저장한 뒤 클라이언트를 시작한다. 아래 참고 사항을 읽는다. `-save false` 는 아무것도 쓰지 않는다. |
| `--code <code>` | `client join` | Crockford Base32 글자 12개. 예: `7Q4K-M2XP-AB01` | 없음(필수) | 한 번 사용 | 관리 화면에서 받은 등록 코드. 숫자와, `I`·`L`·`O`·`U` 를 뺀 영문자 A–Z 로 이루어진다. 입력할 때 `I` 와 `L` 은 `1` 로, `O` 는 `0` 으로 읽는다. 대시, 공백, 대소문자는 무시한다. 코드는 한 번만 쓸 수 있고 기본으로 15분 뒤에 만료된다. 관리 화면의 **Code expires after** 에서 30일까지, 또는 **Never expires**(만료 없음)로 바꿀 수 있다. 관리 API 의 `ttlMinutes` 는 1–43200(30일) 또는 만료 없음을 뜻하는 `null` 을 받는다. 스크립트는 `ttlMinutes` 만 보내도 된다. 관리 화면은 `provisional: true` 도 함께 보낸다. 이때 15분보다 긴 기한은 응답의 `issueId` 로 `POST /api/trustedClients/<id>/enrollmentCode/confirm` 을 보낸 뒤에 적용된다. |
| `--code-stdin` | `client join` | 플래그 | 꺼짐 | 이번 실행만 | 등록 코드를 `--code` 대신 표준 입력의 첫 줄에서 읽는다. 코드는 파이프로 넘긴다. 터미널 입력은 입력의 끝을 기다리며 멈추므로 받지 않고 종료 코드 2 로 끝낸다. 그러면 코드가 프로세스 목록이나 프로세스 생성 감사 로그에 남지 않는다. `--code` 와 함께 쓰거나 첫 줄이 비어 있으면 오류다(종료 코드 2). 예: `echo 7Q4K-M2XP-AB01 \| TTTGate client join gw.example.com --code-stdin`. |
| `--force` | `client join` | 플래그 | 꺼짐 | 이번 실행만 | 이미 있는 `config/client.yaml` 을 바꾼다. 이전 파일은 `client.yaml.bak` 으로 남는다. 이 옵션이 없으면 파일이 이미 있을 때 `client join` 이 종료 코드 78 로 멈춘다. |
| `-json` | `client join`(그리고 `status`) | 플래그 | 꺼짐 | 이번 실행만 | 결과를 stdout 에 JSON 한 줄로 출력한다. [코드로 등록하기](#코드로-등록하기)와 [TTTGate 실행 여부 확인하기](#tttgate-실행-여부-확인하기)를 참고한다. 다른 명령에서는 받지 않는다. |
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
- 파일 내용이 아니라 경로를 저장한다. 직접 준 PEM 본문은 본문 그대로 저장한다. 명령줄에서 준 상대 경로는 절대 경로로 저장해서, 다음 실행에서도 같은 파일을 찾게 한다.
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

서버는 `config/server.yaml` 에서 옵션을 읽는다. `-adminPort`, `-keepAlive`, `-allowLegacyControlAuth` 는 먼저 그 값을 이 파일에 쓴다. 나머지 서버 옵션은 그 실행에만 적용된다. `server config save` 는 서버를 시작하지 않고 이 파일에 값을 쓴다.

#### 백그라운드로 실행하기

`-daemon` 은 백그라운드 프로세스 두 개를 띄운다. 하나는 앱이고, 다른 하나는 앱을 지켜보는 감시 프로세스(sentinel)다.

- 띄우기 전에 옵션과 설정 파일을 검사한다. 서버는 `server.yaml`(YAML 문법과 관리 화면 보안 정책)을, 클라이언트는 모든 옵션과 참조 파일을 검사한다. 오류는 터미널에 그대로 보인다.
- 이 설치본이 기록한 TTTGate 프로세스(이전 데몬이나 포그라운드 실행)가 있으면, 기록한 그 프로세스라고 확인될 때만 먼저 멈춘다.
- 감시 프로세스는 3초마다 앱을 확인한다. 앱이 사라지면 3초 뒤에 다시 띄운다.
- 앱이 설정 오류로 멈추면 데몬은 다시 띄우지 않는다. 이유는 `logs/` 에 있다. 설정을 고친 뒤 다시 시작한다.
- 데몬은 `TTTGate stop` 으로 멈춘다.

#### 도움말과 버전

| 명령 | 출력 |
|---|---|
| `TTTGate`(인자 없음) | 버전과 모드 목록 |
| `TTTGate --help`, `TTTGate -h` | 모드 목록 |
| `TTTGate server --help` | 서버 명령과 옵션을 Admin, Control port, Proxy, Identity, Run, Tuning 묶음으로 보여 준다. 위험한 옵션은 `--help-advanced` 에만 나온다 |
| `TTTGate client --help` | 클라이언트 명령과 옵션을 Connection, Identity, TLS trust, Run, Tuning 묶음으로 보여 준다 |
| `TTTGate stop --help` | `stop` 사용법 |
| `TTTGate status --help` | `status` 사용법과 `-json` |
| `--help-advanced` | `--help` 내용에 더해 레거시 옵션과 위험한 옵션(`RISK:` 줄 포함), 별칭을 보여 준다 |
| `--version` | `TTTGate v<version> (<build>)` |

도움말과 버전은 아무것도 시작하지 않고 종료 코드 0 으로 끝난다.

#### 오류와 종료 코드

프로그램은 무엇이든 시작하기 전에 명령줄 전체를 검사한다. `-daemon` 을 쓰면 백그라운드 프로세스를 띄우기 전에 옵션과 설정 파일을 검사하므로, 오류가 터미널에 보인다.

| 코드 | 뜻 |
|---|---|
| 0 | 정상 종료, 도움말, 버전. `status`: TTTGate 가 돌고 있음 |
| 1 | 실행 중 오류. 서버 옵션 오류도 1 을 쓴다. `client join`: 서버가 코드를 거부했거나, 이 주소에서 실패가 너무 많았거나(15분 뒤 다시 시도), 서버가 등록을 받지 않거나, 응답을 검증하지 못했거나, 네트워크 오류. `server config save`: 값이 잘못됨 |
| 2 | 명령줄 오류: 모르는 옵션이나 모드, 빠지거나 잘못된 값, 서로 충돌하는 옵션 |
| 3 | `status`: TTTGate 가 돌고 있지 않음(LSB 관례) |
| 75 | `server config save`: 이 설치본의 TTTGate 서버가 돌고 있음 |
| 77 | `server config save`: 관리 화면이 다른 호스트에서 접근 가능해지는데 `-allowLegacyAdminRemote` 가 없음 |
| 78 | 설정 파일 오류: `client.yaml` 의 안전하지 않은 필드, 없거나 올바르지 않은 CA·인증서·키·비밀값 파일. `client join`: `--force` 없이 `client.yaml` 이 이미 있거나, 파일을 쓸 수 없음 |

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

서버를 시작하지 않고 서버 설정을 저장한 뒤 시작한다.

```shell
./TTTGate-linux-x64 server config save -adminPort 9400 -controlPort 9126 -controlTls -controlProtocolMode mixed
./TTTGate-linux-x64 server -daemon
```

TTTGate 가 돌고 있는지 문장과 JSON 으로 확인한다.

```shell
./TTTGate-linux-x64 status
./TTTGate-linux-x64 status -json
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

#### 거절된 연결

서버는 여섯 가지 사유로 연결을 거절한다.

| 사유 | 화면 표기 | 뜻 |
|---|---|---|
| `geo-deny` | Country blocked | 국가 필터가 그 주소를 막았다. |
| `ip-blocklist` | Blocklist | 관리자 차단 목록에 있는 주소다. |
| `rate-limit-ban` | Temporarily banned | 연결이 너무 많아 일정 시간 동안 차단된 주소다. |
| `rate-limit-exceeded` | Rate limit exceeded | 연결 횟수 제한의 측정 구간 안에서 연결이 너무 많았다. |
| `concurrency-limit` | Connection limit | 터널 소유자 그룹의 동시 연결 한도에 닿았다. |
| `activator-ip` | IP limit | 터널을 켠 사람의 IP 만 받는 터널인데, 그 주소가 아니다. [켠 사람의 IP 에서만 연결 받기](#켠-사람의-ip-에서만-연결-받기)를 읽는다. |

거절은 세 곳에서 볼 수 있다.

- **Denials by port**(관리 화면 → **Security**): 포트·사유별 거절 건수와 지금 차단된 주소 수다. 관리 화면 자체는 `admin` 으로 보이며, 국가 필터만 막을 수 있다. 건수는 서버가 시작할 때 0 에서 시작한다. 터널을 바꾸거나 지워도 0 으로 돌아가지 않는다. `GET /api/security/stats` 가 같은 값을 준다.
- **Recent denials**(관리 화면 → **Security**): 최근 거절 200건의 시각, IP, 국가, 포트, 사유다. 메모리에만 두므로 서버를 다시 시작하면 지워진다. 국가는 국가 필터가 켜져 있을 때만 보인다. `GET /api/security/denials` 가 같은 목록을 준다. 두 표는 10초마다 다시 읽는다.
- **거절 로그 파일**: 서버 로그와 같은 곳의 `logs/denial-YYYY.MM.DD.log` 다. 문제가 생겼을 때 SSH 로 접속해 읽는 용도다. 관리 화면에는 보이지 않고, 콘솔과 `logs/server-*.log` 에도 나오지 않는다.

거절 로그 파일의 한 줄은 같은 IP·포트·사유의 1분 동안의 거절을 묶는다.

```text
2026-11-05T01:01:30.004Z [INFO] Denial:: first=2026-11-05T01:00:00.000Z last=2026-11-05T01:00:41.512Z ip=203.0.113.7 country=CN port=8080 reason=geo-deny count=5
```

- 시각은 UTC 다. 파일 이름은 서버의 현지 날짜를 쓴다. 줄은 쓰는 날의 파일에 들어가므로, 자정에 걸친 묶음은 `first` 가 전날일 수 있다.
- `port=admin` 은 관리 화면이다. `country=-` 는 국가를 모르거나 국가 필터가 꺼져 있다는 뜻이다.
- 동시에 열린 IP·포트·사유 묶음이 10,000개를 넘으면, 넘는 것은 포트·사유별로 `ip=*` 한 줄로 합친다.
- 줄은 그 1분이 끝난 뒤 약 90초 안에 쓴다. 서버 프로세스가 멈추면 아직 쓰지 않은 묶음은 잃는다.
- 쓰기는 비동기다. 디스크가 따라오지 못하면 줄을 버리고, 버린 수를 `Dropped N log lines ...` 한 줄로 남긴다.

`config/server.yaml` 의 `denialLogRetentionDays` 는 파일을 며칠 보관할지 정한다. 기본값은 20 이다.

- `N` 일이면, 파일 날짜를 1일째로 셀 때 `N + 1` 일째에 지운다. 20 이면 `denial-2026.11.01.log` 는 2026-11-20 까지 남고 2026-11-21 에 지워진다. 1 이면 오늘 파일만 남는다.
- 서버가 시작할 때, 새 날짜의 파일을 열 때, 1 이상의 값을 저장할 때, 그리고 한 시간마다 오래된 파일을 지운다.
- 0 이하이면 거절 로그를 끈다. 아무것도 쓰지 않고, 이미 있는 파일도 지우지 않는다. 관리 화면의 두 표는 그대로 동작한다.
- 값은 3650 이하의 정수다. 관리 화면(**Server settings** → **Denial log retention (days)**)이나 `POST`/`PUT /api/serverOption` 으로 바꾼다. 새 값은 다음 거절부터 적용된다. 서버를 다시 시작하지 않아도 된다.
- `PUT /api/serverOption` 본문에서 `denialLogRetentionDays` 를 빼면 기본값 20 으로 돌아간다. 꺼 둔 거절 로그가 다시 켜진다.

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

- **같은 사용자로 실행한다.** TTTGate 를 시작한 사용자와 같은 사용자로 멈추고 다시 시작한다. 관리자 권한이 없는 사용자는 관리자가 시작한 데몬을 멈출 수 없고, Windows 에서는 그 데몬을 확인할 수도 없다.
- **이전 데몬이 돌고 있으면 시작을 거부한다.** `-daemon` 이 멈추지 못한 TTTGate 프로세스를 찾으면 두 번째 쌍을 띄우지 않는다(포트가 부딪친다). pid 와 pid 파일을 알려 주고 종료 코드 1 로 끝난다. 그 프로세스를 멈추거나, 그 pid 가 TTTGate 가 아니면 pid 파일을 지운 뒤 다시 시작한다.

#### TTTGate 실행 여부 확인하기

```shell
./TTTGate-linux-x64 status
./TTTGate-linux-x64 status -json
```

`status` 는 이 설치본의 TTTGate 서버나 클라이언트가 데몬이나 포그라운드로 돌고 있는지 보여 준다. pid 파일이나 로그 파일을 만들지 않고, 버전 배너도 출력하지 않는다. TTTGate 가 돌고 있으면 종료 코드 0, 아니면 3 으로 끝난다(LSB 관례).

`-json` 이 없으면 한 문장을 출력한다. 예: `TTTGate server is running in the background (pid 1234)`, `TTTGate is not running`.

`-json` 을 붙이면 다음 필드를 담은 JSON 한 줄을 출력한다.

| 필드 | 뜻 |
|---|---|
| `version` | 이 TTTGate 의 버전 |
| `running` | TTTGate 가 돌고 있으면 `true` |
| `mode` | `server`, `client`, `null` 가운데 하나. 이전 버전이 시작한 프로세스는 pid 파일에 모드가 없으므로 `null` 이다 |
| `pid` | 프로세스 ID. 없으면 `null` |
| `daemon` | `-daemon` 으로 시작한 프로세스면 `true` |
| `client` | 실행 중인 클라이언트의 `state`(`connecting`, `connected`, `reconnecting`), `since`(마지막으로 바뀐 시각, 에포크 기준 밀리초), `failures`. 클라이언트가 아니면 `null` |
| `server` | 실행 중인 서버의 `adminUrl`, `bootstrapRequired`, `bootstrapTokenFile`. 서버가 아니면 `null` |

- `adminUrl` 은 이 PC 에서 열 주소다. 모든 주소에 묶인 경우(`0.0.0.0`, `::`, 빈 값)는 `127.0.0.1` 로 바꾼다. `adminTls` 가 true 면 `https` 를 쓴다.
- 실행 중인 클라이언트는 연결 상태가 바뀔 때마다 `bin/.status_client` 를 쓴다. `status` 는 이 파일을 읽는다.
- `failures` 는 30초 안에 끝난 연결이 잇달아 몇 번인지 센다. 이렇게 빨리 끝난 연결은 잠깐 `connected` 였더라도 실패로 센다. 서버는 인증에 실패한 연결을 이유를 알려 주지 않고 닫기 때문이다. 30초 이상 이어진 연결이 있으면 0 으로 돌아간다.
- 이제 pid 파일의 각 줄에 모드도 기록한다.

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
3. **신뢰할 수 없는 인증서를 쓰는 대상으로 가는 터널.** 이 버전의 클라이언트는 대상 서버의 인증서를 검증한다. 이전 버전(1.0.10 이하)의 클라이언트는 검증하지 않았다. **Use TLS (external port and destination)** 를 켠 터널(`tls: true`)과 모든 HTTPS 터널이 해당한다. 클라이언트를 업그레이드하면, 자체 서명 인증서(또는 그 밖의 신뢰할 수 없는 인증서)를 쓰는 대상으로 가는 터널은 `self-signed certificate` 같은 인증서 오류로 실패한다. 그런 터널이 있으면 다음 가운데 하나를 한다.
   - 2단계처럼 `-allowLegacyControlAuth` 로 서버를 먼저 업그레이드해서 1.0.10 클라이언트의 연결을 유지한다. 관리 화면에서 그런 터널을 하나씩 열어 **Skip certificate verification (allow self-signed)**(`allowSelfSignedDestinationCert: true`)를 켠다. 그다음 2단계처럼 클라이언트를 `clientId` 와 `clientSecret` 을 쓰도록 업그레이드한다. 이전 버전의 서버는 이 옵션을 보낼 수 없으므로 클라이언트를 먼저 업그레이드하지 않는다.
   - 대상에 Node.js 가 신뢰하는 공인 CA 의 인증서를 두고, 그 인증서가 터널의 대상 호스트와 맞게 한다. 클라이언트의 `-ca` 옵션은 제어 연결에만 적용되고 대상에는 적용되지 않는다. DNS 이름용 인증서는 터널이 IP 주소를 쓰면 실패하고, 그 반대도 마찬가지다.

   이 옵션을 켜면 클라이언트는 대상 서버의 어떤 인증서든 받아들인다. 신뢰할 수 있는 네트워크에서만 쓴다. 터널 목록은 이런 터널에 **cert not verified** 를 표시한다.

#### 자동으로 조정되는 값

서버는 시작할 때 다음 값을 조정하면 값마다 경고를 남긴다.

- **터널별 연결 횟수 제한**은 `rateLimit` 필드 없이 저장된 터널에서는 꺼진 채로 남는다. 프로토콜 기본값(TCP: 60초에 연결 30개, HTTP/HTTPS: 300개, 넘으면 10분 차단)이 함께 저장되므로, 관리 화면에서 터널마다 켜기만 하면 된다. 새 터널은 켜진 상태로 시작한다.
- **세션 유휴 TTL** 은 파일에 `sessionTtlMs` 가 없으면 꺼진 채로 남는다(`sessionTtlMs: 0`). 새로 설치하면 트래픽이 한 시간 없을 때 세션을 닫는다. 켜려면 `sessionTtlMs`(1000–3600000 ms)를 정한다. 켜면 keepalive 없이 오래 쉬는 SSH 나 데이터베이스 연결이 닫힌다. `sessionTtlMs` 를 빼고 `PUT /api/serverOption` 을 호출하면 값이 한 시간으로 돌아간다. 관리 화면은 언제나 현재 값을 보낸다.
- **서버 버퍼** 값 `-1` 이나 `0`(이전 버전의 "제한 없음")은 기본값 8 MiB 로 바뀐다. 제한 없는 버퍼는 작은 서버의 메모리를 다 쓸 수 있다. 세션이 열린 뒤에는 배압(backpressure)을 걸며 데이터가 계속 흐른다.

#### 그 밖에 알아 둘 변경

- **Online** 터널을 저장해도(새 포트, 다른 설정, 새 인증서) 활성화 스위치와 타이머가 그대로 유지된다. 1.0.10 에서는 저장하면 둘 다 초기화되었다. **Inactive on startup** 을 켠 터널은 꺼지고, 다른 터널은 켜지고, 타이머는 처음부터 다시 돌았다. **Inactive on startup** 은 서버가 시작할 때, 터널을 만들 때, **Online** 이 아닌 터널(예: 포트 바인드에 실패해 터널 목록에 `Can't open port <포트>` 로 보이는 터널)을 저장할 때 적용된다.
- HTTP 터널은 헤더 블록이 64 KiB(이전: 8 MiB)보다 큰 요청을 `431` 로 거부한다.
- 관리자 비밀번호는 1024자까지다(앞뒤 공백은 세지 않는다). 더 긴 비밀번호는 정할 수 없고, 더 긴 비밀번호로 로그인하면 비밀번호를 확인하지 않고 실패한다. 더 긴 비밀번호를 쓰고 있다면 업그레이드하기 전에 바꾼다.
- 관리 서버는 한 네트워크(IPv4 /24, IPv6 /64)에서 동시에 오는 로그인 요청(`/api/login` 과 `/api/login/mfa` 합계)을 5개까지만 처리한다. 그보다 많은 요청은 코드 `login_concurrency_limit` 와 함께 `429` 를 받는다. 앞선 요청이 끝난 뒤 다시 시도한다.
- 이전 버전에서 저장한 터널은 업그레이드한 뒤 IP 제한(`activatorIpOnly`)이 꺼져 있으므로 열려 있는 연결이 끊기지 않는다. 새 터널은 켜진 채 만들어진다. 기존 터널은 터널마다 직접 켠다. [켠 사람의 IP 에서만 연결 받기](#켠-사람의-ip-에서만-연결-받기)를 읽는다.
- 관리 서버는 사용자마다 로그인 세션을 20개, 전체로는 10,000개까지 유지한다. 새로 로그인하면 가장 오래 쓰지 않은 세션을 닫고, 행위자 `system` 으로 `session_killed` 감사 이벤트를 남긴다. 관리 API 에 로그인하는 스크립트는 끝날 때 반드시 `POST /api/logout` 을 호출한다. 그러지 않으면 실행할 때마다 같은 계정의 오래된 세션(예: 브라우저 세션)이 닫힌다.

### 버전 혼합 배포 정책

- 기본 배포 목표: `controlProtocolMode: mixed`.
- 안전한 최종 상태: `controlProtocolMode: mtls-strict`.
- 레거시 공유 키 제어 인증은 `-allowLegacyControlAuth` 를 일부러 쓰지 않는 한 꺼져 있다.
- 클라이언트 쪽 `allowLegacyFallback` 은 승인된 롤백 기간이 아니면 `false` 로 둔다.
- 두 레거시 스위치는 모두 세션 바인딩과 키의 비밀성을 약하게 만든다([명령줄 레퍼런스](#명령줄-레퍼런스) 참고). 롤백 기간이 끝나면 끈다.
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
