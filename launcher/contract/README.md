# Launcher contract

The launcher (Rust) reads what the CLI prints. These files fix that shape.
`test/unit/launcher-contract.test.ts` checks that the CLI prints exactly this, and
`launcher/src-tauri/src/cli.rs` checks that the launcher reads it. Change both sides together.

- `status-*.json`: `TTTGate status --json`
- `join-*.json`: `TTTGate client join --json`
- `config-show.txt`: `TTTGate client config show` of an enrolled client (secrets shown as `(hidden)`)
