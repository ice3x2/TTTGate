# Discovery #65: release archive paths do not match build output

Status: open; assigned to the future release lane alongside #44. Parent: #61.

Independent inspection during #63 found actual binaries in `dist/bin`: `TTTGate-linux-x64`, `TTTGate-linux-arm64`, `TTTGate-win-x64.exe`, `TTTGate-win-arm64.exe` and `TTTGate-alpine-x64`. The binary release workflow changes directory to `dist` and conditionally checks lowercase `tttgate-*` names, including names without the x64 suffix. Its missing-file branches silently omit archives. This is independently observable from generated artifacts and workflow code; it is separate from #44's installation/type/test gates.

- [ ] Write failing archive regression using the actual five-target output contract. Status: pending release lane.
- [ ] Correct collection paths and require nonempty binaries/archives. Status: pending.
- [ ] Verify all five archive contents and upload failure behavior; execute native artifacts where supported and disclose cross-platform limits. Status: pending.
- [ ] Independent review and normal commit/push/closure/notification gates. Status: pending.

Preserve Node 24 and all five target platforms. Serialize this issue with #44 workflow edits under one release owner after runtime and administrator work is integrated.
