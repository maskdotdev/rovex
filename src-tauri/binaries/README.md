# OpenCode Sidecar Binaries

Tauri bundles sidecars from `tauri.conf.json > bundle.externalBin`.

Rovex expects these files at build/package time:

- `src-tauri/binaries/opencode-<target-triple>`
- Windows: `src-tauri/binaries/opencode-<target-triple>.exe`

Examples:

- `opencode-aarch64-apple-darwin`
- `opencode-x86_64-apple-darwin`
- `opencode-x86_64-unknown-linux-gnu`
- `opencode-x86_64-pc-windows-msvc.exe`

Build helper behavior (`src-tauri/build.rs`):

1. If the target sidecar already exists, it is used as-is.
2. Otherwise it attempts to copy from:
   - `ROVEX_OPENCODE_BIN` (if set)
   - `$HOME/.opencode/bin/opencode`

For CI or release packaging, set `ROVEX_OPENCODE_BIN` to a pinned OpenCode binary path.
