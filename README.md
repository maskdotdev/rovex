# Rovex

Tauri + Solid + TypeScript desktop app with a Turso-backed Rust backend.

## Backend (Turso)

The backend lives in `src-tauri/src/backend` and is exposed through Tauri commands.

### Environment

1. Copy `.env.example` to `.env`.
2. Set:
   - `TURSO_DATABASE_URL` (for example `libsql://<db-name>-<org>.turso.io`)
   - `TURSO_AUTH_TOKEN` (from `turso db tokens create <db-name>`)
   - Optional: `ROVEX_LOCAL_DATABASE_URL` (default fallback: `file:rovex-dev.db`)

The app reads `.env` at startup and initializes tables automatically.
If Turso env vars are missing, the app falls back to a local libsql database instead of crashing.

### Available Tauri Commands

- `backend_health()`
- `create_thread({ title, workspace? })`
- `list_threads(limit?)`
- `add_thread_message({ threadId, role, content })`
- `list_thread_messages(threadId, limit?)`

`role` accepts `system`, `user`, or `assistant`.

## Run

```bash
bun install
bun tauri dev
```
