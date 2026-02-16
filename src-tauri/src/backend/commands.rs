use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use tauri::State;

use super::{
    providers::provider_client, AddThreadMessageInput, AppState, BackendHealth,
    CloneRepositoryInput, CloneRepositoryResult, CodeIntelSyncInput, CodeIntelSyncResult,
    ConnectProviderInput, CreateThreadInput, Message, MessageRole, ProviderConnection,
    ProviderKind, Thread,
};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;
const DEFAULT_REPOSITORIES_DIR: &str = "rovex/repos";

struct ProviderConnectionRow {
    provider: ProviderKind,
    account_login: String,
    avatar_url: Option<String>,
    access_token: String,
    created_at: String,
    updated_at: String,
}

fn parse_limit(limit: Option<u32>) -> i64 {
    limit
        .map(i64::from)
        .map(|value| value.clamp(1, MAX_LIMIT))
        .unwrap_or(DEFAULT_LIMIT)
}

fn parse_message_role(value: String) -> Result<MessageRole, String> {
    match value.as_str() {
        "system" => Ok(MessageRole::System),
        "user" => Ok(MessageRole::User),
        "assistant" => Ok(MessageRole::Assistant),
        _ => Err(format!("Unexpected message role in database: {value}")),
    }
}

fn parse_provider_kind(value: String) -> Result<ProviderKind, String> {
    ProviderKind::from_str(&value)
        .ok_or_else(|| format!("Unexpected provider value in database: {value}"))
}

fn parse_clone_directory_name(
    explicit_name: Option<&str>,
    repository_name: &str,
) -> Result<String, String> {
    let raw_value = explicit_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(repository_name)
        .trim();
    if raw_value.is_empty() {
        return Err("Clone directory name must not be empty.".to_string());
    }

    let is_safe = raw_value.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || character == '-'
            || character == '_'
            || character == '.'
    });
    if !is_safe || raw_value.starts_with('.') || raw_value.contains("..") {
        return Err(
            "Clone directory name can only contain letters, numbers, '-', '_' and '.'.".to_string(),
        );
    }

    Ok(raw_value.to_string())
}

fn resolve_repository_root(explicit_root: Option<&str>) -> Result<PathBuf, String> {
    if let Some(root) = explicit_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(root));
    }

    if let Ok(custom_root) = env::var("ROVEX_REPOSITORIES_DIR") {
        let trimmed = custom_root.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map_err(|_| {
            "Unable to determine a home directory. Provide destinationRoot.".to_string()
        })?;
    Ok(PathBuf::from(home).join(DEFAULT_REPOSITORIES_DIR))
}

fn format_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn to_provider_connection(connection: &ProviderConnectionRow) -> ProviderConnection {
    ProviderConnection {
        provider: connection.provider,
        account_login: connection.account_login.clone(),
        avatar_url: connection.avatar_url.clone(),
        created_at: connection.created_at.clone(),
        updated_at: connection.updated_at.clone(),
    }
}

async fn load_provider_connection_row(
    state: &AppState,
    provider: ProviderKind,
) -> Result<Option<ProviderConnectionRow>, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT provider, account_login, avatar_url, access_token, created_at, updated_at FROM provider_connections WHERE provider = ?1 LIMIT 1",
            [provider.as_str()],
        )
        .await
        .map_err(|error| format!("Failed to load provider connection: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read provider connection row: {error}"))?
    else {
        return Ok(None);
    };

    let provider_value: String = row
        .get(0)
        .map_err(|error| format!("Failed to parse provider value: {error}"))?;
    let provider = parse_provider_kind(provider_value)?;

    Ok(Some(ProviderConnectionRow {
        provider,
        account_login: row
            .get(1)
            .map_err(|error| format!("Failed to parse provider account login: {error}"))?,
        avatar_url: row
            .get(2)
            .map_err(|error| format!("Failed to parse provider avatar URL: {error}"))?,
        access_token: row
            .get(3)
            .map_err(|error| format!("Failed to parse provider access token: {error}"))?,
        created_at: row
            .get(4)
            .map_err(|error| format!("Failed to parse provider created_at: {error}"))?,
        updated_at: row
            .get(5)
            .map_err(|error| format!("Failed to parse provider updated_at: {error}"))?,
    }))
}

async fn load_thread_by_id(state: &AppState, thread_id: i64) -> Result<Thread, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT id, title, workspace, created_at FROM threads WHERE id = ?1 LIMIT 1",
            [thread_id],
        )
        .await
        .map_err(|error| format!("Failed to load thread: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read thread row: {error}"))?
    else {
        return Err(format!("Thread {thread_id} was not found."));
    };

    Ok(Thread {
        id: row
            .get(0)
            .map_err(|error| format!("Failed to parse thread id: {error}"))?,
        title: row
            .get(1)
            .map_err(|error| format!("Failed to parse thread title: {error}"))?,
        workspace: row
            .get(2)
            .map_err(|error| format!("Failed to parse thread workspace: {error}"))?,
        created_at: row
            .get(3)
            .map_err(|error| format!("Failed to parse thread created_at: {error}"))?,
    })
}

async fn load_message_by_id(state: &AppState, message_id: i64) -> Result<Message, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT id, thread_id, role, content, created_at FROM messages WHERE id = ?1 LIMIT 1",
            [message_id],
        )
        .await
        .map_err(|error| format!("Failed to load message: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read message row: {error}"))?
    else {
        return Err(format!("Message {message_id} was not found."));
    };

    let role: String = row
        .get(2)
        .map_err(|error| format!("Failed to parse message role: {error}"))?;

    Ok(Message {
        id: row
            .get(0)
            .map_err(|error| format!("Failed to parse message id: {error}"))?,
        thread_id: row
            .get(1)
            .map_err(|error| format!("Failed to parse message thread_id: {error}"))?,
        role: parse_message_role(role)?,
        content: row
            .get(3)
            .map_err(|error| format!("Failed to parse message content: {error}"))?,
        created_at: row
            .get(4)
            .map_err(|error| format!("Failed to parse message created_at: {error}"))?,
    })
}

#[tauri::command]
pub async fn backend_health(state: State<'_, AppState>) -> Result<BackendHealth, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query("SELECT COUNT(*) FROM threads", ())
        .await
        .map_err(|error| format!("Failed to query health check: {error}"))?;

    let thread_count = if let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read health check row: {error}"))?
    {
        row.get(0)
            .map_err(|error| format!("Failed to parse thread count: {error}"))?
    } else {
        0
    };

    Ok(BackendHealth {
        status: "ok".to_string(),
        database_url: state.database_url().to_string(),
        thread_count,
    })
}

#[tauri::command]
pub async fn create_thread(
    state: State<'_, AppState>,
    input: CreateThreadInput,
) -> Result<Thread, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Thread title must not be empty.".to_string());
    }

    let workspace = input
        .workspace
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let conn = state.connection()?;
    conn.execute(
        "INSERT INTO threads (title, workspace) VALUES (?1, ?2)",
        (title.to_owned(), workspace),
    )
    .await
    .map_err(|error| format!("Failed to create thread: {error}"))?;

    let mut rows = conn
        .query("SELECT last_insert_rowid()", ())
        .await
        .map_err(|error| format!("Failed to fetch new thread id: {error}"))?;
    let thread_id = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read thread id row: {error}"))?
        .ok_or_else(|| "Missing last_insert_rowid result after create_thread.".to_string())?
        .get(0)
        .map_err(|error| format!("Failed to parse new thread id: {error}"))?;

    load_thread_by_id(&state, thread_id).await
}

#[tauri::command]
pub async fn list_threads(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<Thread>, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT id, title, workspace, created_at FROM threads ORDER BY created_at DESC LIMIT ?1",
            [parse_limit(limit)],
        )
        .await
        .map_err(|error| format!("Failed to list threads: {error}"))?;

    let mut threads = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read thread rows: {error}"))?
    {
        threads.push(Thread {
            id: row
                .get(0)
                .map_err(|error| format!("Failed to parse thread id: {error}"))?,
            title: row
                .get(1)
                .map_err(|error| format!("Failed to parse thread title: {error}"))?,
            workspace: row
                .get(2)
                .map_err(|error| format!("Failed to parse thread workspace: {error}"))?,
            created_at: row
                .get(3)
                .map_err(|error| format!("Failed to parse thread created_at: {error}"))?,
        });
    }

    Ok(threads)
}

#[tauri::command]
pub async fn add_thread_message(
    state: State<'_, AppState>,
    input: AddThreadMessageInput,
) -> Result<Message, String> {
    let content = input.content.trim();
    if content.is_empty() {
        return Err("Message content must not be empty.".to_string());
    }

    let _ = load_thread_by_id(&state, input.thread_id).await?;

    let conn = state.connection()?;
    conn.execute(
        "INSERT INTO messages (thread_id, role, content) VALUES (?1, ?2, ?3)",
        (input.thread_id, input.role.as_str(), content.to_owned()),
    )
    .await
    .map_err(|error| format!("Failed to add thread message: {error}"))?;

    let mut rows = conn
        .query("SELECT last_insert_rowid()", ())
        .await
        .map_err(|error| format!("Failed to fetch new message id: {error}"))?;
    let message_id = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read message id row: {error}"))?
        .ok_or_else(|| "Missing last_insert_rowid result after add_thread_message.".to_string())?
        .get(0)
        .map_err(|error| format!("Failed to parse new message id: {error}"))?;

    load_message_by_id(&state, message_id).await
}

#[tauri::command]
pub async fn list_thread_messages(
    state: State<'_, AppState>,
    thread_id: i64,
    limit: Option<u32>,
) -> Result<Vec<Message>, String> {
    let _ = load_thread_by_id(&state, thread_id).await?;
    let conn = state.connection()?;

    let mut rows = conn
        .query(
            "SELECT id, thread_id, role, content, created_at FROM messages WHERE thread_id = ?1 ORDER BY created_at ASC LIMIT ?2",
            (thread_id, parse_limit(limit)),
        )
        .await
        .map_err(|error| format!("Failed to list thread messages: {error}"))?;

    let mut messages = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read message rows: {error}"))?
    {
        let role: String = row
            .get(2)
            .map_err(|error| format!("Failed to parse message role: {error}"))?;

        messages.push(Message {
            id: row
                .get(0)
                .map_err(|error| format!("Failed to parse message id: {error}"))?,
            thread_id: row
                .get(1)
                .map_err(|error| format!("Failed to parse message thread_id: {error}"))?,
            role: parse_message_role(role)?,
            content: row
                .get(3)
                .map_err(|error| format!("Failed to parse message content: {error}"))?,
            created_at: row
                .get(4)
                .map_err(|error| format!("Failed to parse message created_at: {error}"))?,
        });
    }

    Ok(messages)
}

#[tauri::command]
pub async fn connect_provider(
    state: State<'_, AppState>,
    input: ConnectProviderInput,
) -> Result<ProviderConnection, String> {
    let access_token = input.access_token.trim();
    if access_token.is_empty() {
        return Err("Provider access token must not be empty.".to_string());
    }

    let client = provider_client(input.provider);
    let identity = client.validate_access_token(access_token).await?;

    let conn = state.connection()?;
    conn.execute(
        "INSERT INTO provider_connections (provider, account_login, avatar_url, access_token, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(provider)
         DO UPDATE SET
           account_login = excluded.account_login,
           avatar_url = excluded.avatar_url,
           access_token = excluded.access_token,
           updated_at = CURRENT_TIMESTAMP",
        (
            input.provider.as_str(),
            identity.account_login,
            identity.avatar_url,
            access_token.to_string(),
        ),
    )
    .await
    .map_err(|error| format!("Failed to store provider connection: {error}"))?;

    let connection = load_provider_connection_row(&state, input.provider)
        .await?
        .ok_or_else(|| "Provider connection was not found after connect.".to_string())?;
    Ok(to_provider_connection(&connection))
}

#[tauri::command]
pub async fn get_provider_connection(
    state: State<'_, AppState>,
    provider: ProviderKind,
) -> Result<Option<ProviderConnection>, String> {
    let connection = load_provider_connection_row(&state, provider).await?;
    Ok(connection.as_ref().map(to_provider_connection))
}

#[tauri::command]
pub async fn list_provider_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConnection>, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT provider, account_login, avatar_url, created_at, updated_at FROM provider_connections ORDER BY updated_at DESC",
            (),
        )
        .await
        .map_err(|error| format!("Failed to list provider connections: {error}"))?;

    let mut connections = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read provider connection rows: {error}"))?
    {
        let provider_value: String = row
            .get(0)
            .map_err(|error| format!("Failed to parse provider value: {error}"))?;
        let provider = parse_provider_kind(provider_value)?;

        connections.push(ProviderConnection {
            provider,
            account_login: row
                .get(1)
                .map_err(|error| format!("Failed to parse provider account login: {error}"))?,
            avatar_url: row
                .get(2)
                .map_err(|error| format!("Failed to parse provider avatar URL: {error}"))?,
            created_at: row
                .get(3)
                .map_err(|error| format!("Failed to parse provider created_at: {error}"))?,
            updated_at: row
                .get(4)
                .map_err(|error| format!("Failed to parse provider updated_at: {error}"))?,
        });
    }

    Ok(connections)
}

#[tauri::command]
pub async fn disconnect_provider(
    state: State<'_, AppState>,
    provider: ProviderKind,
) -> Result<bool, String> {
    let conn = state.connection()?;
    let affected = conn
        .execute(
            "DELETE FROM provider_connections WHERE provider = ?1",
            [provider.as_str()],
        )
        .await
        .map_err(|error| format!("Failed to disconnect provider: {error}"))?;

    Ok(affected > 0)
}

#[tauri::command]
pub async fn clone_repository(
    state: State<'_, AppState>,
    input: CloneRepositoryInput,
) -> Result<CloneRepositoryResult, String> {
    let connection = load_provider_connection_row(&state, input.provider)
        .await?
        .ok_or_else(|| format!("{} is not connected.", input.provider.as_str()))?;
    let client = provider_client(input.provider);
    let repository = client.parse_repository(&input.repository)?;

    let destination_root = resolve_repository_root(input.destination_root.as_deref())?;
    fs::create_dir_all(&destination_root).map_err(|error| {
        format!(
            "Failed to create clone destination {}: {error}",
            format_path(&destination_root)
        )
    })?;

    let directory_name =
        parse_clone_directory_name(input.directory_name.as_deref(), &repository.name)?;
    let destination_path = destination_root.join(directory_name);
    if destination_path.exists() {
        return Err(format!(
            "Destination already exists: {}",
            format_path(&destination_path)
        ));
    }

    let auth_header = client.clone_auth_header(&connection.access_token)?;
    let clone_url = client.clone_url(&repository);
    let mut command = Command::new("git");
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-c")
        .arg(format!("http.extraHeader={auth_header}"))
        .arg("clone");

    if input.shallow.unwrap_or(true) {
        command.arg("--depth").arg("1");
    }

    let output = command
        .arg(&clone_url)
        .arg(&destination_path)
        .output()
        .map_err(|error| format!("Failed to run git clone: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let summary = if !stderr.is_empty() { stderr } else { stdout };
        let detail = if summary.is_empty() {
            "Unknown git error.".to_string()
        } else {
            summary
        };
        return Err(format!("git clone failed: {detail}"));
    }

    Ok(CloneRepositoryResult {
        provider: input.provider,
        repository: repository.slug(),
        workspace: format_path(&destination_path),
    })
}

#[tauri::command]
pub async fn run_code_intel_sync(
    input: Option<CodeIntelSyncInput>,
) -> Result<CodeIntelSyncResult, String> {
    super::code_intel::run_code_intel_sync(input).await
}
