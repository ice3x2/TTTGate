# Launcher JSON contract

The launcher (Rust) reads the JSON that the CLI prints. These files fix that shape.
`test/unit/launcher-contract.test.ts` checks that the CLI prints exactly this, and
`launcher/src-tauri/src/cli.rs` checks that the launcher reads it. Change both sides together.
