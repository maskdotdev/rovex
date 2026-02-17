# Rovex

Tauri + Solid + TypeScript desktop app with a Turso-backed Rust backend.

## Backend (Turso)

The backend lives in `src-tauri/src/backend` and is exposed through Tauri commands.

### Environment

1. Copy `.env.example` to `.env`.
2. Set:
   - `TURSO_DATABASE_URL` (for example `libsql://<db-name>-<org>.turso.io`)
   - `TURSO_AUTH_TOKEN` (from `turso db tokens create <db-name>`)
   - `GITHUB_OAUTH_CLIENT_ID` (GitHub OAuth App client id used for device login)
   - Optional: `ROVEX_LOCAL_DATABASE_URL` (default fallback: `file:rovex-dev.db`)
   - Optional: `ROVEX_REPOSITORIES_DIR` (default clone destination: `~/rovex/repos`)
   - Optional: `GITHUB_OAUTH_SCOPE` (default: `repo`)
   - Optional: `ROVEX_REVIEW_MODEL` (default: `gpt-4.1-mini`)
   - Optional: `ROVEX_REVIEW_BASE_URL` (default: `https://api.openai.com/v1`)
   - Optional: `ROVEX_REVIEW_MAX_DIFF_CHARS` (default: `120000`)
   - Optional: `ROVEX_REVIEW_TIMEOUT_MS` (default: `120000`)

The app reads `.env` at startup and initializes tables automatically.
If Turso env vars are missing, the app falls back to a local libsql database instead of crashing.

### Available Tauri Commands

- `backend_health()`
- `create_thread({ title, workspace? })`
- `list_threads(limit?)`
- `add_thread_message({ threadId, role, content })`
- `list_thread_messages(threadId, limit?)`
- `connect_provider({ provider, accessToken })`
- `start_provider_device_auth({ provider })`
- `poll_provider_device_auth({ provider, deviceCode })`
- `get_provider_connection(provider)`
- `list_provider_connections()`
- `disconnect_provider(provider)`
- `clone_repository({ provider, repository, destinationRoot?, directoryName?, shallow? })`
- `generate_ai_review({ threadId, workspace, baseRef, mergeBase, head, filesChanged, insertions, deletions, diff, prompt? })`

`role` accepts `system`, `user`, or `assistant`.
`provider` currently accepts `github`.

## Provider Pattern

Provider implementations live under `src-tauri/src/backend/providers`.

- `ProviderClient` defines provider capabilities (token validation, repository parsing, clone URL, auth header).
- `provider_client(kind)` acts as a registry/dispatcher.
- Database stores connections in a provider-agnostic table (`provider_connections`) so new providers can reuse the same command surface.

To add GitLab later, create `providers/gitlab.rs`, implement `ProviderClient`, add a `ProviderKind` variant, and register it in `provider_client`.

## Run

```bash
bun install
bun tauri dev
```

## Hybrid Indexing (Backend)

Code-intelligence indexing now runs in the Rust backend (`src-tauri`) as a Tauri command:

- `run_code_intel_sync(input?)`

Behavior:

1. Graph + optional SCIP semantic graph -> KiteDB
2. Graph node index + vectors -> Turso/libSQL

### Required env for backend sync

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN` (required for remote Turso)
- `OPENAI_API_KEY` (or `CODE_INTEL_VECTOR_API_KEY`) for OpenAI-compatible embeddings

### Important ID contract

The backend sync stores `graph_node_id` in Turso as the canonical key:

- Syntax nodes/chunks use deterministic Tree-sitter IDs (for example `ts:function:...`).
- Semantic nodes use SCIP symbol IDs (for example `scip:...`).

This enables fast lookup in Turso and direct graph traversal in KiteDB with the same node id for impact/callees/callers.
