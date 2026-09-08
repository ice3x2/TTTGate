# Discovery #69

Status: independently reproduced and draft reviewed; root created [issue #69](https://github.com/ice3x2/TTTGate/issues/69), currently OPEN. Implementation follows the serialized release plan.

## Observation and reproduction

The actual #65 Windows x64 archive `TTTGate-v-issue65-verification-win-x64.zip` contains only `TTTGate-win-x64.exe` at its root. Archive SHA-256: `793447c8b75da0348050f4aed5de071d9cddfd3835e63c85adda4b45f1405ce2`.

`Environment.ts` derives a packaged executable's runtime root two path levels above the executable, with `bin` and `web` underneath that root. This matches the normal `dist/bin/executable` plus `dist/web` layout, but not the flat executable archive. Package configuration does not embed the administrator web files.

Independent local reproduction used an owned outer temporary directory and extracted the unchanged archive into its `extract` child, so even the parent-derived runtime paths remained within the owned directory. Ephemeral admin/control ports and an explicit test-only `-allowLegacyAdminHttp` option were used; production TLS defaults were not changed.

1. Actual native server child PID 54620 exited before HTTP startup with ENOENT writing `<owned outer>/bin/.pid_foreground`. That directory is absent from the archive layout.
2. A separate diagnostic supplied only the missing owned `bin` directory, retaining the same flat archive contents and no web assets. Native server child PID 108216 started on the temporary ports, remained alive, and GET `/` returned **404 `Not Found /`**. The expected runtime `web` directory was absent.

Only owned child processes were terminated and owned temporary fixtures removed. The original archive was not changed. Earlier `--help`/usage startup checks do not prove the administrator UI works. No Linux/ARM execution is claimed.

## Acceptance criteria

- First reproduce the actual extracted binary startup/layout failure with a regression before implementation.
- Package each platform's executable and required production web assets in a layout consistent with runtime-root discovery, such as `bin/<executable>` and `web/`, or make an explicitly reviewed equivalent layout change.
- Update binary extraction/start instructions to the actual packaged paths. Merely adding `web` beside a flat executable is insufficient if root discovery still chooses its parent.
- Fail packaging for missing/empty required runtime assets.
- Extract the native Windows archive into a fresh owned directory, start the actual server on bounded test ports and verify administrator HTML/assets are served; preserve authentication/TLS defaults and document test-only allowances.
- Validate all five platform archive layouts/content hashes, while honestly distinguishing executable native tests from cross-platform inspection.
- Independently review, commit, push, close and notify.

Parent: #61. Discovered during #65 actual archive verification. Distinct from #65's filename/collection repair and #68's JavaScript source archive. Use the same release owner serially; do not claim #65 alone makes extracted binary distributions fully usable.
