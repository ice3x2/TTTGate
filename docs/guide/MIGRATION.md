# TTTGate RBAC migration guide

## 1. Audience and summary

Read this if you operate a TTTGate server that was installed before the RBAC release and authenticates its
administrator with `config/.key`. After the upgrade that single administrator becomes a superuser account
named `admin`, and **the password does not change**: the bcrypt hash in `config/.key` is copied verbatim into
the new `config/identity.yaml` as that account's `passwordHash`.

Nothing has to be typed, generated or reset for the upgrade itself. The promotion happens once, during the
first start of the new binary, and is recorded in `config/identity.yaml`. From then on `config/.key` is only a
fallback artifact — the server reads it again only if `identity.yaml` is deleted, and it is never rewritten.

Everything below assumes a POSIX install rooted at `/opt/tttgate`, so the configuration directory is
`/opt/tttgate/config`. On Windows the same files live under the installation directory's `config` folder, for
example `C:\TTTGate\config`. Substitute your own installation root in every command.

## 2. Upgrade procedure

1. Stop the running server.

   ```
   systemctl stop tttgate
   ```

2. Replace the binary. Keep the previous one; section 4 needs it for a rollback.

   ```
   cp /opt/tttgate/bin/tttgate /opt/tttgate/bin/tttgate.previous
   install -m 0755 ./tttgate /opt/tttgate/bin/tttgate
   ```

3. Start the server.

   ```
   systemctl start tttgate
   ```

4. Confirm the promotion in the log. The message appears exactly once, on the start that performs the
   promotion, and never again on later starts.

   ```
   grep -c 'identity migrated from legacy admin key' /opt/tttgate/logs/server.log
   ```

5. Sign in to the admin UI with the username `admin` and the password you used before the upgrade. Until
   issue #102 adds a username field to the sign-in form, the form asks for the password only and the server
   resolves the account as `admin`.

6. The first page after signing in shows a migration banner. It is driven by `GET /api/me`, whose
   `migrationBanner` field is `true` while the promoted account has not acknowledged it. Acknowledging the
   banner (`POST /api/me/acknowledge-migration`) only clears the notice; it changes no permission.

## 3. Files created and preserved

| Path | When it appears | Mode | Lifecycle |
| --- | --- | --- | --- |
| `/opt/tttgate/config/identity.yaml` | First start of the new binary | `0600` | The new source of truth for users and groups. Not rewritten on later starts. |
| `/opt/tttgate/config/.key` | Already present before the upgrade | unchanged | Preserved as-is. **Do not delete it** unless you intend to trigger section 7's password recovery. The server never removes or rewrites it. |
| `/opt/tttgate/config/.bootstrap-token` | Fresh installs only (no `.key`, no `identity.yaml`) | `0600` | Deleted by the server as soon as a superuser exists. An upgraded server never creates it. |
| `/opt/tttgate/config/server.yaml.bak` | The first save that writes a new configuration field | `0600` | Written once, in the same atomic batch as that save. Never rotated, never deleted by the server. |
| `/opt/tttgate/config/.server.state.json.bak` | Same save as above, when the state file exists | `0600` | Same lifecycle. |

The two `.bak` files hold the configuration as it was on disk immediately before the first save that added a
new field (`connectionSecurity`, `mfaRequiredForSuperusers`, `auditRetentionDays`, `auditQueueSize`, `logLevel`,
`closeStallMs`, `closeGraceMs`, `adminAllowedOrigins`, or a tunnel's `ownerId` or `rateLimit`). Keeping them is a manual decision: **retain them for at least 14 days**
after the upgrade, and remove them yourself once you have accepted the new configuration.

Note that `.server.state.json.bak` records the revision state at that same moment, which the server may
already have touched during startup (it marks the loaded revision as last-known-good). It is therefore the
pre-save state, not necessarily a byte copy of the file the previous binary last wrote.

## 4. Rollback procedure

The previous binary still reads a `server.yaml` that contains the new fields: `verificationServerOption` in
`src/server/ServerOptionStore.ts` has no key allow-list, so unknown top-level and per-tunnel fields pass
validation and are preserved. Restoring the `.bak` files is therefore **not** required to downgrade. It is the
procedure for discarding the new fields and every configuration change made after the upgrade.

1. Stop the server.

   ```
   systemctl stop tttgate
   ```

2. Copy both backups back over their originals.

   ```
   cp /opt/tttgate/config/server.yaml.bak /opt/tttgate/config/server.yaml
   cp /opt/tttgate/config/.server.state.json.bak /opt/tttgate/config/.server.state.json
   ```

3. Put the previous binary back and start it.

   ```
   install -m 0755 /opt/tttgate/bin/tttgate.previous /opt/tttgate/bin/tttgate
   systemctl start tttgate
   ```

4. Sign in with the password from `config/.key`. The previous binary knows nothing about `identity.yaml`, so
   leaving that file in place is harmless; it is simply ignored.

**Warning — accounts created after the upgrade are lost.** A superuser created through the bootstrap-token
flow has no entry in `config/.key`. Downgrading leaves the previous binary with no credential for that
account, and because `.key` is then absent the bootstrap-token flow starts over on the next upgrade. The same
applies to every regular user and group: they live only in `identity.yaml`, which the previous binary does not
read. Export or write down whatever you need before downgrading.

### What was verified, and what was not

The restore itself was exercised against the current binary: starting from a pre-upgrade `server.yaml` with no
new fields, one save through `POST /api/tunnelingOption` produced both `.bak` files with `server.yaml.bak`
byte-identical to the original; copying the two backups back and restarting restored the pre-upgrade revision
number, left the tunnel's owner reading as `system:migrated` again, and authenticated with the `config/.key`
password. `config/.key` and `config/identity.yaml` both survived, and the promotion message did not reappear.

**Not verified here: a build of the previous binary reading the upgraded `server.yaml`.** The claim rests on
reading `verificationServerOption`, not on running commit `5f772fc`. Confirm it yourself before you rely on a
downgrade:

```
git worktree add /tmp/tttgate-5f772fc 5f772fc
cd /tmp/tttgate-5f772fc && npm ci --include=dev && npm run build
cp -r /opt/tttgate/config /tmp/tttgate-5f772fc-root/config
cd /tmp/tttgate-5f772fc-root && node /tmp/tttgate-5f772fc/build/src/app.js server
curl -sk https://127.0.0.1:9300/api/version
```

The server must start and answer `/api/version` with 200. If it instead logs a configuration validation
failure, do not downgrade without restoring the `.bak` files first.

## 5. Legacy-fallback mode

If `identity.yaml` exists but cannot be read or parsed, the server does not refuse to start. It enters
legacy-fallback mode and keeps authenticating from `config/.key` alone. The symptoms are:

- the log line `identity.yaml unreadable (<reason>); falling back to legacy admin key`, followed by
  `identity store unavailable (<reason>); continuing with legacy admin key only`;
- `GET /api/users` and the other user and group routes answer `503` with the code `identity_store_unavailable`;
- `GET /api/me` reports `user.id` as `legacy-admin` and `migrationBanner` as `false`.

To recover, stop the server and either fix `identity.yaml` or remove it:

```
systemctl stop tttgate
# Keep a copy of the unreadable file before removing it.
mv /opt/tttgate/config/identity.yaml /root/identity.yaml.broken
systemctl start tttgate
```

With `identity.yaml` gone and `config/.key` still in place, the next start promotes `admin` again exactly as
in section 2, and the promotion message appears once more. Users and groups that existed only in the removed
file do not come back.

## 6. Downtime rehearsal

PRD goal K1 asks for a zero-downtime upgrade. The upgrade itself writes `identity.yaml` once and does not
block startup, but restarting the process is still a process restart: whether the admin port stays reachable
through it depends on whether your service manager hands the listening socket over. Measure it on a staging
server rather than assuming it.

Run this probe on the staging host while you perform steps 1 to 3 of section 2:

```
while true; do curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:9300/api/version; sleep 1; done | tee /tmp/k1-probe.log
```

Replace `9300` with your `adminPort`. When the upgrade is done, stop the loop and count the lines that are not
`200`:

```
grep -cv '^200$' /tmp/k1-probe.log
```

Record that number together with your service manager's socket-handover setting. The target is `0`. A non-zero
count is the restart gap, not a migration failure; report it as the measured gap for your deployment.

## 7. Frequently asked questions

**I forgot the administrator password.** Stop the server, delete `config/identity.yaml`, and start it again.
The next start re-promotes `admin` from `config/.key`, so the password becomes whatever `.key` holds — which is
the password you had before the upgrade. Users and groups created after the upgrade are lost with the file.

```
systemctl stop tttgate
rm /opt/tttgate/config/identity.yaml
systemctl start tttgate
```

**I forgot the password and `config/.key` is gone too.** Then no credential remains. Stop the server, remove
`config/identity.yaml`, and start it: with neither file present the server writes
`config/.bootstrap-token` and logs `Bootstrap token created at /opt/tttgate/config/.bootstrap-token`. Read that
token, then set the first superuser's username and password through the sign-in form's bootstrap-token field.
The server deletes the token file as soon as that account exists.

**Can I delete `config/.key` after a successful upgrade?** You can, but then the recovery in the first answer
is no longer available and you would fall back to the bootstrap-token flow. Keep it.

**Do I need to back up `identity.yaml` before an upgrade?** No. Its schema version is `1` and there is no
upward migration of the file, so the server never creates `identity.yaml.bak`. Back it up with your ordinary
configuration backups.

**Why is every tunnel owned by `system:migrated`?** Tunnels that existed before the upgrade carry no `ownerId`,
and the server reports them with that placeholder owner. Superusers see and edit them as before; regular users
see none of them. Reassign a tunnel with `PUT /api/tunnelingOption/<forwardPort>/owner` when you want a
regular user to manage it.
