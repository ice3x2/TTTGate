## Observation

During #63 actual five-platform binary generation, independent review found that `.github/workflows/build-release-binaries.yml` searches under `dist` for lowercase `tttgate-*` filenames. Actual configured build outputs are under `dist/bin` with names `TTTGate-linux-x64`, `TTTGate-linux-arm64`, `TTTGate-win-x64.exe`, `TTTGate-win-arm64.exe`, and `TTTGate-alpine-x64`.

The workflow's conditional file-existence branches silently skip missing expected names. Successful binary generation therefore does not prove that release archives are produced or uploaded.

Original #44 addresses missing install/type/test gates. This is a distinct artifact collection defect, to be implemented by the same release lane after #63 and alongside #44.

## Acceptance criteria

- First reproduce the mismatch with regression tests using the actual packaging output contract.
- Produce the intended archives for all five configured platforms, using exact output paths/names or one shared manifest.
- Missing/empty binaries or archives fail the packaging/upload flow instead of silently skipping.
- Verify archive contents and native execution where supported; report cross-platform execution limits honestly.
- Preserve the Node 24 minimum and all intended platforms; independently review, commit, push and close with evidence.

Parent: #61. Discovered during #63 packaging verification.
