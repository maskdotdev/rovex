use std::env;

use libsql::{Builder, Database};

const DATABASE_URL_ENV: &str = "TURSO_DATABASE_URL";
const AUTH_TOKEN_ENV: &str = "TURSO_AUTH_TOKEN";
const LOCAL_DATABASE_URL_ENV: &str = "ROVEX_LOCAL_DATABASE_URL";
const DEFAULT_LOCAL_DATABASE_URL: &str = "file:rovex-dev.db";

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  workspace TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id_created_at
ON messages(thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,
  account_login TEXT NOT NULL,
  avatar_url TEXT,
  access_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_review_runs (
  run_id TEXT PRIMARY KEY,
  thread_id INTEGER NOT NULL,
  workspace TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  merge_base TEXT NOT NULL,
  head TEXT NOT NULL,
  files_changed INTEGER NOT NULL,
  insertions INTEGER NOT NULL,
  deletions INTEGER NOT NULL,
  prompt TEXT,
  scope_label TEXT,
  status TEXT NOT NULL,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  completed_chunks INTEGER NOT NULL DEFAULT 0,
  failed_chunks INTEGER NOT NULL DEFAULT 0,
  finding_count INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  review TEXT,
  diff_chars_used INTEGER,
  diff_chars_total INTEGER,
  diff_truncated INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  chunks_json TEXT NOT NULL DEFAULT '[]',
  findings_json TEXT NOT NULL DEFAULT '[]',
  progress_events_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  ended_at TEXT,
  canceled_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_review_runs_thread_created
ON ai_review_runs(thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_review_runs_status_created
ON ai_review_runs(status, created_at ASC);
"#;

pub async fn open_database_from_env() -> Result<(String, Database), String> {
    dotenvy::dotenv().ok();

    let database_url = env::var(DATABASE_URL_ENV).map_err(|_| {
        format!(
            "Missing {DATABASE_URL_ENV}. Set it to your Turso URL (example: libsql://your-db.turso.io)."
        )
    })?;

    if database_url.starts_with("libsql://") || database_url.starts_with("https://") {
        let auth_token = env::var(AUTH_TOKEN_ENV).map_err(|_| {
            format!(
                "Missing {AUTH_TOKEN_ENV}. Generate one with `turso db tokens create <db-name>`."
            )
        })?;

        let db = Builder::new_remote(database_url.clone(), auth_token)
            .build()
            .await
            .map_err(|error| format!("Failed to connect to Turso: {error}"))?;

        return Ok((database_url, db));
    }

    let local_path = database_url.strip_prefix("file:").unwrap_or(&database_url);
    let db = Builder::new_local(local_path)
        .build()
        .await
        .map_err(|error| {
            format!("Failed to open local libsql database at {local_path}: {error}")
        })?;

    Ok((database_url, db))
}

pub async fn open_local_database() -> Result<(String, Database), String> {
    dotenvy::dotenv().ok();

    let database_url =
        env::var(LOCAL_DATABASE_URL_ENV).unwrap_or_else(|_| DEFAULT_LOCAL_DATABASE_URL.to_string());

    let local_path = database_url.strip_prefix("file:").unwrap_or(&database_url);
    let db = Builder::new_local(local_path)
        .build()
        .await
        .map_err(|error| {
            format!("Failed to open local fallback database at {local_path}: {error}")
        })?;

    Ok((database_url, db))
}

pub async fn initialize_schema(db: &Database) -> Result<(), String> {
    let conn = db
        .connect()
        .map_err(|error| format!("Failed to open database connection: {error}"))?;

    conn.execute_batch(SCHEMA_SQL)
        .await
        .map_err(|error| format!("Failed to initialize schema: {error}"))?;

    Ok(())
}
