use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::Duration,
};

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

use super::{
    providers::{provider_client, ProviderDeviceAuthorizationPoll},
    AddThreadMessageInput, AiReviewConfig, AppState, BackendHealth, CheckoutWorkspaceBranchInput,
    CheckoutWorkspaceBranchResult, CloneRepositoryInput, CloneRepositoryResult, CodeIntelSyncInput,
    CodeIntelSyncResult, CompareWorkspaceDiffInput, CompareWorkspaceDiffResult,
    ConnectProviderInput, CreateThreadInput, CreateWorkspaceBranchInput, GenerateAiFollowUpInput,
    GenerateAiFollowUpResult, GenerateAiReviewInput, GenerateAiReviewResult,
    ListWorkspaceBranchesInput, ListWorkspaceBranchesResult, Message, MessageRole,
    OpencodeSidecarStatus, PollProviderDeviceAuthInput, PollProviderDeviceAuthResult,
    ProviderConnection, ProviderDeviceAuthStatus, ProviderKind, SetAiReviewApiKeyInput,
    SetAiReviewSettingsInput, StartProviderDeviceAuthInput, StartProviderDeviceAuthResult, Thread,
    WorkspaceBranch,
};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;
const DEFAULT_REPOSITORIES_DIR: &str = "rovex/repos";
const OPENAI_API_KEY_ENV: &str = "OPENAI_API_KEY";
const ROVEX_REVIEW_PROVIDER_ENV: &str = "ROVEX_REVIEW_PROVIDER";
const ROVEX_REVIEW_MODEL_ENV: &str = "ROVEX_REVIEW_MODEL";
const ROVEX_REVIEW_BASE_URL_ENV: &str = "ROVEX_REVIEW_BASE_URL";
const ROVEX_REVIEW_MAX_DIFF_CHARS_ENV: &str = "ROVEX_REVIEW_MAX_DIFF_CHARS";
const ROVEX_REVIEW_TIMEOUT_MS_ENV: &str = "ROVEX_REVIEW_TIMEOUT_MS";
const ROVEX_OPENCODE_MODEL_ENV: &str = "ROVEX_OPENCODE_MODEL";
const ROVEX_OPENCODE_HOSTNAME_ENV: &str = "ROVEX_OPENCODE_HOSTNAME";
const ROVEX_OPENCODE_PORT_ENV: &str = "ROVEX_OPENCODE_PORT";
const ROVEX_OPENCODE_SERVER_TIMEOUT_MS_ENV: &str = "ROVEX_OPENCODE_SERVER_TIMEOUT_MS";
const ROVEX_OPENCODE_PROVIDER_ENV: &str = "ROVEX_OPENCODE_PROVIDER";
const DEFAULT_REVIEW_PROVIDER: &str = "openai";
const DEFAULT_REVIEW_MODEL: &str = "gpt-4.1-mini";
const DEFAULT_REVIEW_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_REVIEW_MAX_DIFF_CHARS: usize = 120_000;
const DEFAULT_REVIEW_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_FOLLOW_UP_HISTORY_CHARS: usize = 40_000;
const MAX_FOLLOW_UP_MESSAGES: i64 = 40;
const DEFAULT_OPENCODE_HOSTNAME: &str = "127.0.0.1";
const DEFAULT_OPENCODE_PORT: u16 = 4096;
const DEFAULT_OPENCODE_SERVER_TIMEOUT_MS: u64 = 5_000;
const DEFAULT_OPENCODE_PROVIDER: &str = "openai";
const DEFAULT_OPENCODE_MODEL: &str = "openai/gpt-5";
const OPENCODE_SIDECAR_NAME: &str = "opencode";

struct ProviderConnectionRow {
    provider: ProviderKind,
    account_login: String,
    avatar_url: Option<String>,
    access_token: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Copy)]
enum ReviewProvider {
    OpenAi,
    Opencode,
}

impl ReviewProvider {
    fn from_env() -> Result<Self, String> {
        let provider = env::var(ROVEX_REVIEW_PROVIDER_ENV)
            .ok()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_REVIEW_PROVIDER.to_string());
        match provider.as_str() {
            "openai" => Ok(Self::OpenAi),
            "opencode" => Ok(Self::Opencode),
            other => Err(format!(
                "Unsupported {ROVEX_REVIEW_PROVIDER_ENV} value '{other}'. Use 'openai' or 'opencode'."
            )),
        }
    }
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

fn summarize_process_output(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "Unknown process failure.".to_string()
    }
}

fn run_git(repo_path: &Path, args: &[&str], context: &str) -> Result<Output, String> {
    let output = Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run git {context}: {error}"))?;

    if output.status.success() {
        Ok(output)
    } else {
        Err(format!(
            "git {context} failed: {}",
            summarize_process_output(&output)
        ))
    }
}

fn run_git_trimmed(repo_path: &Path, args: &[&str], context: &str) -> Result<String, String> {
    let output = run_git(repo_path, args, context)?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn resolve_workspace_repo_path(workspace: &str) -> Result<PathBuf, String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace path must not be empty.".to_string());
    }

    let repo_path = PathBuf::from(workspace);
    if !repo_path.exists() {
        return Err(format!(
            "Workspace does not exist: {}",
            format_path(&repo_path)
        ));
    }
    if !repo_path.is_dir() {
        return Err(format!(
            "Workspace is not a directory: {}",
            format_path(&repo_path)
        ));
    }

    Ok(repo_path)
}

fn ensure_git_repository(repo_path: &Path) -> Result<(), String> {
    let is_git_repo = run_git_trimmed(
        repo_path,
        &["rev-parse", "--is-inside-work-tree"],
        "rev-parse",
    )?;
    if is_git_repo != "true" {
        return Err(format!(
            "Workspace is not a git repository: {}",
            format_path(repo_path)
        ));
    }

    Ok(())
}

fn parse_branch_name(value: &str) -> Result<String, String> {
    let branch_name = value.trim();
    if branch_name.is_empty() {
        return Err("Branch name must not be empty.".to_string());
    }
    Ok(branch_name.to_string())
}

fn validate_branch_name(repo_path: &Path, branch_name: &str) -> Result<(), String> {
    run_git(
        repo_path,
        &["check-ref-format", "--branch", branch_name],
        "check-ref-format",
    )?;
    Ok(())
}

fn branch_sort_priority(name: &str) -> i32 {
    match name {
        "main" => 0,
        "master" => 1,
        "develop" => 2,
        _ => 3,
    }
}

fn git_ref_exists(repo_path: &Path, reference: &str) -> bool {
    let commit_reference = format!("{reference}^{{commit}}");
    Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-C")
        .arg(repo_path)
        .arg("rev-parse")
        .arg("--verify")
        .arg("--quiet")
        .arg(commit_reference)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn resolve_base_ref(repo_path: &Path, requested_base_ref: &str) -> Result<String, String> {
    let mut candidates = vec![requested_base_ref.to_string()];
    if requested_base_ref == "origin/main" {
        candidates.push("origin/master".to_string());
        candidates.push("main".to_string());
        candidates.push("master".to_string());
    }

    for candidate in candidates {
        if git_ref_exists(repo_path, &candidate) {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Unable to resolve base ref '{requested_base_ref}'. Make sure the branch exists and has been fetched."
    ))
}

fn parse_numstat(diff_numstat: &str) -> (i64, i64, i64) {
    let mut files_changed = 0i64;
    let mut insertions = 0i64;
    let mut deletions = 0i64;

    for line in diff_numstat
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let mut columns = line.splitn(3, '\t');
        let Some(additions) = columns.next() else {
            continue;
        };
        let Some(removals) = columns.next() else {
            continue;
        };
        let Some(_path) = columns.next() else {
            continue;
        };

        files_changed += 1;
        insertions += additions.parse::<i64>().unwrap_or(0);
        deletions += removals.parse::<i64>().unwrap_or(0);
    }

    (files_changed, insertions, deletions)
}

fn parse_env_u64(name: &str, fallback: u64, min: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value >= min)
        .unwrap_or(fallback)
}

fn parse_env_u16(name: &str, fallback: u16, min: u16) -> u16 {
    env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|value| *value >= min)
        .unwrap_or(fallback)
}

fn parse_env_usize(name: &str, fallback: usize, min: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value >= min)
        .unwrap_or(fallback)
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    if max_chars == 0 {
        return (String::new(), !value.is_empty());
    }

    let mut end = value.len();
    let mut count = 0usize;
    for (index, _) in value.char_indices() {
        if count == max_chars {
            end = index;
            break;
        }
        count += 1;
    }

    if count < max_chars {
        (value.to_string(), false)
    } else {
        (
            value[..end].to_string(),
            value[end..].chars().next().is_some(),
        )
    }
}

fn as_non_empty_trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn snippet(value: &str, max_chars: usize) -> String {
    truncate_chars(value, max_chars).0
}

fn resolve_env_file_path() -> Option<PathBuf> {
    if let Ok(configured) = env::var("ROVEX_ENV_FILE") {
        let configured = configured.trim();
        if !configured.is_empty() {
            return Some(PathBuf::from(configured));
        }
    }

    let cwd = env::current_dir().ok()?;
    let direct = cwd.join(".env");
    if direct.exists() {
        return Some(direct);
    }

    let parent = cwd.parent().map(|value| value.join(".env"));
    if let Some(parent) = parent {
        if parent.exists() {
            return Some(parent);
        }
    }

    Some(direct)
}

fn upsert_env_key(path: &Path, key: &str, value: &str) -> Result<(), String> {
    let existing = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Failed to read {}: {error}", format_path(path))),
    };

    let mut lines: Vec<String> = existing.lines().map(ToOwned::to_owned).collect();
    let mut updated = false;

    for line in &mut lines {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            continue;
        }
        let Some((name, _)) = line.split_once('=') else {
            continue;
        };
        if name.trim() == key {
            *line = format!("{key}={value}");
            updated = true;
            break;
        }
    }

    if !updated {
        lines.push(format!("{key}={value}"));
    }

    let mut next = lines.join("\n");
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }

    fs::write(path, next).map_err(|error| format!("Failed to write {}: {error}", format_path(path)))
}

fn mask_secret(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }

    let char_count = normalized.chars().count();
    if char_count <= 8 {
        return Some("*".repeat(char_count.max(4)));
    }

    let prefix: String = normalized.chars().take(4).collect();
    let suffix: String = normalized
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<char>>()
        .into_iter()
        .rev()
        .collect();
    Some(format!("{prefix}...{suffix}"))
}

fn current_review_provider_value() -> String {
    env::var(ROVEX_REVIEW_PROVIDER_ENV)
        .ok()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| value == "openai" || value == "opencode")
        .unwrap_or_else(|| DEFAULT_REVIEW_PROVIDER.to_string())
}

fn current_ai_review_config() -> AiReviewConfig {
    let api_key = env::var(OPENAI_API_KEY_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let review_model = env::var(ROVEX_REVIEW_MODEL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_REVIEW_MODEL.to_string());
    let opencode_provider = env::var(ROVEX_OPENCODE_PROVIDER_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_OPENCODE_PROVIDER.to_string());
    let opencode_model = env::var(ROVEX_OPENCODE_MODEL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| Some(DEFAULT_OPENCODE_MODEL.to_string()));
    let env_file_path = resolve_env_file_path().map(|path| format_path(path.as_path()));
    AiReviewConfig {
        has_api_key: api_key.is_some(),
        api_key_preview: api_key.as_deref().and_then(mask_secret),
        env_file_path,
        review_provider: current_review_provider_value(),
        review_model,
        opencode_provider,
        opencode_model,
    }
}

fn extract_chat_response_text(body: &serde_json::Value) -> Option<String> {
    let content = body
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?;

    if let Some(text) = content.as_str() {
        let normalized = text.trim();
        if !normalized.is_empty() {
            return Some(normalized.to_string());
        }
        return None;
    }

    let mut text_parts = Vec::new();
    for part in content.as_array()? {
        if let Some(text) = part.as_str() {
            if !text.trim().is_empty() {
                text_parts.push(text.trim().to_string());
            }
            continue;
        }

        if let Some(text) = part.get("text").and_then(|value| value.as_str()) {
            if !text.trim().is_empty() {
                text_parts.push(text.trim().to_string());
            }
            continue;
        }

        if let Some(text) = part
            .get("text")
            .and_then(|value| value.get("value"))
            .and_then(|value| value.as_str())
        {
            if !text.trim().is_empty() {
                text_parts.push(text.trim().to_string());
            }
        }
    }

    if text_parts.is_empty() {
        None
    } else {
        Some(text_parts.join("\n\n"))
    }
}

async fn persist_thread_message(
    state: &AppState,
    thread_id: i64,
    role: MessageRole,
    content: &str,
) -> Result<(), String> {
    let normalized = content.trim();
    if normalized.is_empty() {
        return Ok(());
    }

    let conn = state.connection()?;
    conn.execute(
        "INSERT INTO messages (thread_id, role, content) VALUES (?1, ?2, ?3)",
        (thread_id, role.as_str(), normalized.to_string()),
    )
    .await
    .map_err(|error| format!("Failed to persist thread message: {error}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
struct OpenAiChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Serialize)]
struct OpenAiChatRequest<'a> {
    model: &'a str,
    temperature: f32,
    messages: Vec<OpenAiChatMessage<'a>>,
}

struct ResolvedOpencodeModel {
    provider_id: String,
    model_id: String,
    display: String,
}

#[derive(Debug, Deserialize)]
struct OpencodeSessionResponse {
    id: String,
}

#[derive(Debug, Serialize)]
struct OpencodeModelRef<'a> {
    #[serde(rename = "providerID")]
    provider_id: &'a str,
    #[serde(rename = "modelID")]
    model_id: &'a str,
}

#[derive(Debug, Serialize)]
struct OpencodeTextPartInput<'a> {
    #[serde(rename = "type")]
    part_type: &'static str,
    text: &'a str,
}

#[derive(Debug, Serialize)]
struct OpencodePromptRequest<'a> {
    model: OpencodeModelRef<'a>,
    parts: Vec<OpencodeTextPartInput<'a>>,
}

fn resolve_opencode_model(review_model: &str) -> Result<ResolvedOpencodeModel, String> {
    let configured_model = env::var(ROVEX_OPENCODE_MODEL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if review_model.contains('/') {
                review_model.to_string()
            } else if review_model == DEFAULT_REVIEW_MODEL {
                DEFAULT_OPENCODE_MODEL.to_string()
            } else {
                let provider = env::var(ROVEX_OPENCODE_PROVIDER_ENV)
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| DEFAULT_OPENCODE_PROVIDER.to_string());
                format!("{provider}/{review_model}")
            }
        });

    let (provider_id, model_id) = configured_model.split_once('/').ok_or_else(|| {
        format!(
            "Invalid OpenCode model '{configured_model}'. Set {ROVEX_OPENCODE_MODEL_ENV} as '<provider>/<model>'."
        )
    })?;
    let provider_id = provider_id.trim();
    let model_id = model_id.trim();
    if provider_id.is_empty() || model_id.is_empty() {
        return Err(format!(
            "Invalid OpenCode model '{configured_model}'. Set {ROVEX_OPENCODE_MODEL_ENV} as '<provider>/<model>'."
        ));
    }

    Ok(ResolvedOpencodeModel {
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
        display: format!("{provider_id}/{model_id}"),
    })
}

fn extract_opencode_server_url(line: &str) -> Option<String> {
    if !line.contains("opencode server listening") {
        return None;
    }

    let start = line.find("http://").or_else(|| line.find("https://"))?;
    let url = line[start..].split_whitespace().next()?.trim();
    if url.is_empty() {
        return None;
    }

    Some(url.trim_end_matches('/').to_string())
}

fn extract_opencode_text_from_parts_value(value: &serde_json::Value) -> Option<String> {
    let mut parts = Vec::new();
    for item in value.as_array()? {
        if let Some(text) = item.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
            continue;
        }

        let part_type = item.get("type").and_then(|part| part.as_str());
        if let Some(text) = item.get("text").and_then(|part| part.as_str()) {
            if part_type == Some("text") || part_type.is_none() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed.to_string());
                }
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

fn extract_opencode_text_from_json(value: &serde_json::Value) -> Option<String> {
    if let Some(parts) = value.get("parts") {
        if let Some(text) = extract_opencode_text_from_parts_value(parts) {
            return Some(text);
        }
    }
    if let Some(parts) = value.pointer("/message/parts") {
        if let Some(text) = extract_opencode_text_from_parts_value(parts) {
            return Some(text);
        }
    }
    if let Some(parts) = value.pointer("/response/parts") {
        if let Some(text) = extract_opencode_text_from_parts_value(parts) {
            return Some(text);
        }
    }
    if let Some(parts) = value.pointer("/result/parts") {
        if let Some(text) = extract_opencode_text_from_parts_value(parts) {
            return Some(text);
        }
    }

    let role = value.get("role").and_then(|item| item.as_str());
    let part_type = value.get("type").and_then(|item| item.as_str());
    if (role == Some("assistant") || role.is_none())
        && (part_type == Some("text") || part_type.is_none())
    {
        if let Some(text) = value.get("text").and_then(|item| item.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    if let Some(array) = value.as_array() {
        let mut collected = Vec::new();
        for entry in array {
            if let Some(text) = extract_opencode_text_from_json(entry) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    collected.push(trimmed.to_string());
                }
            }
        }
        if !collected.is_empty() {
            return Some(collected.join("\n\n"));
        }
    }

    None
}

fn extract_opencode_review_from_body(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(text) = extract_opencode_text_from_json(&value) {
            return Some(text);
        }
    }

    let mut chunks = Vec::new();
    for line in trimmed.lines() {
        let normalized = line.trim();
        if normalized.is_empty() {
            continue;
        }
        let payload = normalized
            .strip_prefix("data:")
            .map(str::trim)
            .unwrap_or(normalized);
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
            if let Some(text) = extract_opencode_text_from_json(&value) {
                let trimmed_text = text.trim();
                if !trimmed_text.is_empty() {
                    chunks.push(trimmed_text.to_string());
                }
            }
        }
    }

    let looks_structured =
        trimmed.starts_with('{') || trimmed.starts_with('[') || trimmed.starts_with("data:");
    if chunks.is_empty() {
        if looks_structured {
            None
        } else {
            Some(trimmed.to_string())
        }
    } else {
        Some(chunks.join("\n\n"))
    }
}

fn extract_latest_assistant_review_from_messages_body(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }

    let value = serde_json::from_str::<serde_json::Value>(trimmed).ok()?;
    let items: Vec<&serde_json::Value> = if let Some(array) = value.as_array() {
        array.iter().collect()
    } else {
        vec![&value]
    };

    for item in items.into_iter().rev() {
        let role = item
            .pointer("/info/role")
            .and_then(|entry| entry.as_str())
            .or_else(|| item.get("role").and_then(|entry| entry.as_str()));
        if role != Some("assistant") {
            continue;
        }

        if let Some(parts) = item.get("parts") {
            if let Some(text) = extract_opencode_text_from_parts_value(parts) {
                return Some(text);
            }
        }
        if let Some(text) = extract_opencode_text_from_json(item) {
            let normalized = text.trim();
            if !normalized.is_empty() {
                return Some(normalized.to_string());
            }
        }
    }

    None
}

fn format_follow_up_history(messages: &[Message], max_chars: usize) -> (String, bool) {
    let mut entries = Vec::new();
    for message in messages {
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        let role = match message.role {
            MessageRole::System => "System",
            MessageRole::User => "User",
            MessageRole::Assistant => "Assistant",
        };
        entries.push(format!("{role}: {content}"));
    }

    let joined = entries.join("\n\n");
    truncate_chars(&joined, max_chars)
}

fn build_follow_up_prompt(
    thread: &Thread,
    workspace: &str,
    question: &str,
    history: &str,
    history_truncated: bool,
) -> String {
    format!(
        "Continue this code review conversation.\n\nThread: {}\nWorkspace: {}\nConversation history truncated: {}\n\nConversation history:\n{}\n\nUser follow-up question:\n{}\n\nAnswer only based on available context. If context is missing, say exactly what is missing. Keep the answer concise and actionable.",
        thread.title,
        workspace,
        if history_truncated { "yes" } else { "no" },
        history,
        question
    )
}

async fn validate_opencode_model_available(
    client: &Client,
    base_url: &str,
    workspace: &str,
    model: &ResolvedOpencodeModel,
) -> Result<(), String> {
    let endpoint = format!("{}/provider", base_url.trim_end_matches('/'));
    let response = client
        .get(&endpoint)
        .query(&[("directory", workspace)])
        .send()
        .await
        .map_err(|error| format!("Failed to validate OpenCode model: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "OpenCode provider listing failed with {status}: {}",
            snippet(body.trim(), 300)
        ));
    }

    let body = response.text().await.unwrap_or_default();
    let value = serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|error| format!("Failed to parse OpenCode provider listing: {error}"))?;
    let providers = value
        .get("all")
        .and_then(|entry| entry.as_array())
        .ok_or_else(|| "OpenCode provider listing did not include 'all'.".to_string())?;

    let provider = providers
        .iter()
        .find(|entry| entry.get("id").and_then(|entry| entry.as_str()) == Some(&model.provider_id))
        .ok_or_else(|| {
            let available = providers
                .iter()
                .filter_map(|entry| entry.get("id").and_then(|entry| entry.as_str()))
                .take(12)
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "OpenCode provider '{}' is not available. Available providers: {}",
                model.provider_id, available
            )
        })?;

    let models = provider
        .get("models")
        .and_then(|entry| entry.as_object())
        .ok_or_else(|| {
            format!(
                "OpenCode provider '{}' does not expose models.",
                model.provider_id
            )
        })?;

    if models.contains_key(&model.model_id) {
        return Ok(());
    }

    let suggestions = models
        .keys()
        .take(12)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "OpenCode model '{}' is not available for provider '{}'. Available models include: {}",
        model.model_id, model.provider_id, suggestions
    ))
}

async fn generate_review_with_openai(
    model: &str,
    base_url: &str,
    timeout_ms: u64,
    api_key: &str,
    prompt: &str,
) -> Result<String, String> {
    let system_prompt = "You are a senior code reviewer. Review the diff and provide concise, high-signal findings. Prioritize functional bugs, regressions, security risks, and missing tests. Use markdown with sections: Summary, Findings, Suggested Tests. If no issues, say that clearly.";

    let request = OpenAiChatRequest {
        model,
        temperature: 0.2,
        messages: vec![
            OpenAiChatMessage {
                role: "system",
                content: system_prompt,
            },
            OpenAiChatMessage {
                role: "user",
                content: prompt,
            },
        ],
    };

    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| format!("Failed to initialize HTTP client: {error}"))?;

    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("Failed to reach AI provider: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(format!(
            "AI provider rejected the API key. Check {OPENAI_API_KEY_ENV}."
        ));
    }

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "AI provider returned {status}. Response: {}",
            snippet(body.trim(), 300)
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse AI provider response: {error}"))?;
    let review = extract_chat_response_text(&body)
        .ok_or_else(|| "AI provider returned an empty response.".to_string())?;
    Ok(review)
}

async fn wait_for_opencode_server(
    app: &AppHandle,
    hostname: &str,
    port: u16,
    startup_timeout_ms: u64,
) -> Result<(String, tauri_plugin_shell::process::CommandChild), String> {
    let command = app
        .shell()
        .sidecar(OPENCODE_SIDECAR_NAME)
        .map_err(|error| format!("Failed to prepare bundled OpenCode sidecar: {error}"))?
        .args([
            "serve".to_string(),
            format!("--hostname={hostname}"),
            format!("--port={port}"),
        ]);
    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("Failed to start bundled OpenCode sidecar: {error}"))?;
    let mut child = Some(child);
    let mut output_lines: Vec<String> = Vec::new();
    let start = tokio::time::Instant::now();
    let startup_timeout = Duration::from_millis(startup_timeout_ms);

    loop {
        let elapsed = start.elapsed();
        if elapsed >= startup_timeout {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
            let output = output_lines.join("\n");
            return Err(format!(
                "Timed out waiting for OpenCode sidecar startup after {startup_timeout_ms}ms. Output: {}",
                snippet(output.trim(), 400)
            ));
        }
        let remaining = startup_timeout.saturating_sub(elapsed);
        let event = tokio::time::timeout(remaining, events.recv())
            .await
            .map_err(|_| {
                if let Some(child) = child.take() {
                    let _ = child.kill();
                }
                let output = output_lines.join("\n");
                format!(
                    "Timed out waiting for OpenCode sidecar startup after {startup_timeout_ms}ms. Output: {}",
                    snippet(output.trim(), 400)
                )
            })?;

        let Some(event) = event else {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
            let output = output_lines.join("\n");
            return Err(format!(
                "OpenCode sidecar closed before startup completed. Output: {}",
                snippet(output.trim(), 400)
            ));
        };

        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                if line.is_empty() {
                    continue;
                }
                if output_lines.len() >= 30 {
                    output_lines.remove(0);
                }
                if let Some(url) = extract_opencode_server_url(&line) {
                    let child = child.take().ok_or_else(|| {
                        "Internal error: missing OpenCode sidecar handle.".to_string()
                    })?;
                    return Ok((url, child));
                }
                output_lines.push(line);
            }
            CommandEvent::Error(message) => {
                let line = message.trim();
                if !line.is_empty() {
                    if output_lines.len() >= 30 {
                        output_lines.remove(0);
                    }
                    output_lines.push(line.to_string());
                }
            }
            CommandEvent::Terminated(payload) => {
                if let Some(child) = child.take() {
                    let _ = child.kill();
                }
                let output = output_lines.join("\n");
                return Err(format!(
                    "OpenCode sidecar terminated before startup (code: {:?}). Output: {}",
                    payload.code,
                    snippet(output.trim(), 400)
                ));
            }
            _ => {}
        }
    }
}

async fn generate_review_with_opencode(
    app: &AppHandle,
    workspace: &str,
    prompt: &str,
    timeout_ms: u64,
    review_model: &str,
) -> Result<(String, String), String> {
    let resolved_model = resolve_opencode_model(review_model)?;
    let hostname = env::var(ROVEX_OPENCODE_HOSTNAME_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_OPENCODE_HOSTNAME.to_string());
    let port = parse_env_u16(ROVEX_OPENCODE_PORT_ENV, DEFAULT_OPENCODE_PORT, 1);
    let server_timeout_ms = parse_env_u64(
        ROVEX_OPENCODE_SERVER_TIMEOUT_MS_ENV,
        DEFAULT_OPENCODE_SERVER_TIMEOUT_MS,
        1_000,
    );

    let (server_url, sidecar_child) =
        wait_for_opencode_server(app, &hostname, port, server_timeout_ms).await?;
    let base_url = server_url.trim_end_matches('/').to_string();
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| format!("Failed to initialize OpenCode HTTP client: {error}"))?;
    validate_opencode_model_available(&client, &base_url, workspace, &resolved_model).await?;
    let mut session_id: Option<String> = None;

    let review_result: Result<(String, String), String> = async {
        let session_endpoint = format!("{base_url}/session");
        let session_response = client
            .post(&session_endpoint)
            .query(&[("directory", workspace)])
            .send()
            .await
            .map_err(|error| format!("Failed to create OpenCode session: {error}"))?;
        if !session_response.status().is_success() {
            let status = session_response.status();
            let body = session_response.text().await.unwrap_or_default();
            return Err(format!(
                "OpenCode session creation failed with {status}: {}",
                snippet(body.trim(), 300)
            ));
        }
        let session: OpencodeSessionResponse = session_response
            .json()
            .await
            .map_err(|error| format!("Failed to parse OpenCode session response: {error}"))?;
        session_id = Some(session.id.clone());

        let prompt_endpoint = format!("{base_url}/session/{}/message", session.id);
        let prompt_response = client
            .post(&prompt_endpoint)
            .query(&[("directory", workspace)])
            .json(&OpencodePromptRequest {
                model: OpencodeModelRef {
                    provider_id: &resolved_model.provider_id,
                    model_id: &resolved_model.model_id,
                },
                parts: vec![OpencodeTextPartInput {
                    part_type: "text",
                    text: prompt,
                }],
            })
            .send()
            .await
            .map_err(|error| format!("Failed to request OpenCode review: {error}"))?;
        if !prompt_response.status().is_success() {
            let status = prompt_response.status();
            let body = prompt_response.text().await.unwrap_or_default();
            return Err(format!(
                "OpenCode review request failed with {status}: {}",
                snippet(body.trim(), 300)
            ));
        }
        let prompt_body = prompt_response.text().await.unwrap_or_default();
        let review = if let Some(review) = extract_opencode_review_from_body(&prompt_body) {
            review
        } else {
            let messages_endpoint = format!("{base_url}/session/{}/message", session.id);
            let poll_started = tokio::time::Instant::now();
            let poll_timeout = Duration::from_millis(timeout_ms);

            loop {
                let messages_response = client
                    .get(&messages_endpoint)
                    .query(&[("directory", workspace), ("limit", "40")])
                    .send()
                    .await
                    .map_err(|error| format!("Failed to poll OpenCode messages: {error}"))?;

                let status = messages_response.status();
                let body = messages_response.text().await.unwrap_or_default();
                if !status.is_success() {
                    return Err(format!(
                        "OpenCode messages poll failed with {status}: {}",
                        snippet(body.trim(), 300)
                    ));
                }

                if let Some(review) = extract_latest_assistant_review_from_messages_body(&body) {
                    break review;
                }

                if poll_started.elapsed() >= poll_timeout {
                    let initial = snippet(prompt_body.trim(), 200);
                    let polled = snippet(body.trim(), 200);
                    return Err(format!(
                        "Failed to parse OpenCode review response body. Initial response: {initial}. Latest polled messages: {polled}"
                    ));
                }

                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        };

        Ok((review, resolved_model.display.clone()))
    }
    .await;

    if let Some(session_id) = &session_id {
        let endpoint = format!("{base_url}/session/{session_id}");
        let _ = client
            .delete(endpoint)
            .query(&[("directory", workspace)])
            .send()
            .await;
    }
    let _ = sidecar_child.kill();

    review_result
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

async fn upsert_provider_connection(
    state: &AppState,
    provider: ProviderKind,
    access_token: &str,
) -> Result<ProviderConnection, String> {
    let token = access_token.trim();
    if token.is_empty() {
        return Err("Provider access token must not be empty.".to_string());
    }

    let client = provider_client(provider);
    let identity = client.validate_access_token(token).await?;

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
            provider.as_str(),
            identity.account_login,
            identity.avatar_url,
            token.to_string(),
        ),
    )
    .await
    .map_err(|error| format!("Failed to store provider connection: {error}"))?;

    let connection = load_provider_connection_row(state, provider)
        .await?
        .ok_or_else(|| "Provider connection was not found after connect.".to_string())?;
    Ok(to_provider_connection(&connection))
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

async fn load_recent_thread_messages(
    state: &AppState,
    thread_id: i64,
    limit: i64,
) -> Result<Vec<Message>, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT id, thread_id, role, content, created_at FROM messages WHERE thread_id = ?1 ORDER BY created_at DESC LIMIT ?2",
            (thread_id, limit),
        )
        .await
        .map_err(|error| format!("Failed to load thread messages: {error}"))?;

    let mut messages = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read thread message rows: {error}"))?
    {
        let role: String = row
            .get(2)
            .map_err(|error| format!("Failed to parse thread message role: {error}"))?;
        messages.push(Message {
            id: row
                .get(0)
                .map_err(|error| format!("Failed to parse thread message id: {error}"))?,
            thread_id: row
                .get(1)
                .map_err(|error| format!("Failed to parse thread message thread_id: {error}"))?,
            role: parse_message_role(role)?,
            content: row
                .get(3)
                .map_err(|error| format!("Failed to parse thread message content: {error}"))?,
            created_at: row
                .get(4)
                .map_err(|error| format!("Failed to parse thread message created_at: {error}"))?,
        });
    }

    messages.reverse();
    Ok(messages)
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
pub async fn delete_thread(state: State<'_, AppState>, thread_id: i64) -> Result<bool, String> {
    let _ = load_thread_by_id(&state, thread_id).await?;
    let conn = state.connection()?;

    conn.execute("DELETE FROM threads WHERE id = ?1", [thread_id])
        .await
        .map_err(|error| format!("Failed to delete thread: {error}"))?;

    Ok(true)
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
    upsert_provider_connection(&state, input.provider, &input.access_token).await
}

#[tauri::command]
pub async fn start_provider_device_auth(
    input: StartProviderDeviceAuthInput,
) -> Result<StartProviderDeviceAuthResult, String> {
    let client = provider_client(input.provider);
    let flow = client.start_device_authorization().await?;

    Ok(StartProviderDeviceAuthResult {
        provider: input.provider,
        device_code: flow.device_code,
        user_code: flow.user_code,
        verification_uri: flow.verification_uri,
        verification_uri_complete: flow.verification_uri_complete,
        expires_in: flow.expires_in,
        interval: flow.interval,
    })
}

#[tauri::command]
pub async fn poll_provider_device_auth(
    state: State<'_, AppState>,
    input: PollProviderDeviceAuthInput,
) -> Result<PollProviderDeviceAuthResult, String> {
    let device_code = input.device_code.trim();
    if device_code.is_empty() {
        return Err("Device code must not be empty.".to_string());
    }

    let client = provider_client(input.provider);
    let poll_result = client.poll_device_authorization(device_code).await?;

    match poll_result {
        ProviderDeviceAuthorizationPoll::Pending => Ok(PollProviderDeviceAuthResult {
            status: ProviderDeviceAuthStatus::Pending,
            connection: None,
        }),
        ProviderDeviceAuthorizationPoll::SlowDown => Ok(PollProviderDeviceAuthResult {
            status: ProviderDeviceAuthStatus::SlowDown,
            connection: None,
        }),
        ProviderDeviceAuthorizationPoll::Complete { access_token } => {
            let connection =
                upsert_provider_connection(&state, input.provider, &access_token).await?;
            Ok(PollProviderDeviceAuthResult {
                status: ProviderDeviceAuthStatus::Complete,
                connection: Some(connection),
            })
        }
        ProviderDeviceAuthorizationPoll::Expired => Err(format!(
            "{} device authorization expired. Start the connection flow again.",
            input.provider.as_str()
        )),
        ProviderDeviceAuthorizationPoll::Denied => Err(format!(
            "{} device authorization was denied.",
            input.provider.as_str()
        )),
    }
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
pub async fn compare_workspace_diff(
    input: CompareWorkspaceDiffInput,
) -> Result<CompareWorkspaceDiffResult, String> {
    let repo_path = resolve_workspace_repo_path(&input.workspace)?;
    ensure_git_repository(&repo_path)?;

    let requested_base_ref = input
        .base_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("origin/main");

    let should_fetch_origin =
        input.fetch_remote.unwrap_or(true) && requested_base_ref.starts_with("origin/");
    if should_fetch_origin {
        run_git(&repo_path, &["fetch", "--quiet", "origin"], "fetch origin")?;
    }

    let base_ref = resolve_base_ref(&repo_path, requested_base_ref)?;
    let head = run_git_trimmed(&repo_path, &["rev-parse", "HEAD"], "resolve HEAD")?;
    let merge_base = run_git_trimmed(
        &repo_path,
        &["merge-base", "HEAD", base_ref.as_str()],
        "resolve merge-base",
    )?;

    let diff_output = run_git(
        &repo_path,
        &[
            "diff",
            "--merge-base",
            base_ref.as_str(),
            "--no-color",
            "--patch",
            "--find-renames",
            "--full-index",
            "--binary",
        ],
        "diff",
    )?;
    let diff = String::from_utf8_lossy(&diff_output.stdout).to_string();

    let numstat_output = run_git(
        &repo_path,
        &["diff", "--merge-base", base_ref.as_str(), "--numstat"],
        "diff --numstat",
    )?;
    let numstat = String::from_utf8_lossy(&numstat_output.stdout);
    let (files_changed, insertions, deletions) = parse_numstat(&numstat);

    Ok(CompareWorkspaceDiffResult {
        workspace: format_path(&repo_path),
        base_ref,
        merge_base,
        head,
        diff,
        files_changed,
        insertions,
        deletions,
    })
}

#[tauri::command]
pub async fn get_ai_review_config() -> Result<AiReviewConfig, String> {
    Ok(current_ai_review_config())
}

#[tauri::command]
pub async fn set_ai_review_api_key(
    input: SetAiReviewApiKeyInput,
) -> Result<AiReviewConfig, String> {
    let api_key = input.api_key.trim();
    if api_key.is_empty() {
        return Err("API key must not be empty.".to_string());
    }

    env::set_var(OPENAI_API_KEY_ENV, api_key);

    if input.persist_to_env.unwrap_or(true) {
        let env_path =
            resolve_env_file_path().ok_or_else(|| "Unable to resolve .env path.".to_string())?;
        upsert_env_key(&env_path, OPENAI_API_KEY_ENV, api_key)?;
    }

    Ok(current_ai_review_config())
}

#[tauri::command]
pub async fn set_ai_review_settings(
    input: SetAiReviewSettingsInput,
) -> Result<AiReviewConfig, String> {
    let review_provider = input.review_provider.trim().to_lowercase();
    if review_provider != "openai" && review_provider != "opencode" {
        return Err("Review provider must be 'openai' or 'opencode'.".to_string());
    }

    let review_model = input.review_model.trim();
    if review_model.is_empty() {
        return Err("Review model must not be empty.".to_string());
    }

    let opencode_provider = input
        .opencode_provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_OPENCODE_PROVIDER);
    let opencode_model = input
        .opencode_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    env::set_var(ROVEX_REVIEW_PROVIDER_ENV, &review_provider);
    env::set_var(ROVEX_REVIEW_MODEL_ENV, review_model);
    env::set_var(ROVEX_OPENCODE_PROVIDER_ENV, opencode_provider);
    if let Some(model) = &opencode_model {
        env::set_var(ROVEX_OPENCODE_MODEL_ENV, model);
    }

    if input.persist_to_env.unwrap_or(true) {
        let env_path =
            resolve_env_file_path().ok_or_else(|| "Unable to resolve .env path.".to_string())?;
        upsert_env_key(&env_path, ROVEX_REVIEW_PROVIDER_ENV, &review_provider)?;
        upsert_env_key(&env_path, ROVEX_REVIEW_MODEL_ENV, review_model)?;
        upsert_env_key(&env_path, ROVEX_OPENCODE_PROVIDER_ENV, opencode_provider)?;
        if let Some(model) = &opencode_model {
            upsert_env_key(&env_path, ROVEX_OPENCODE_MODEL_ENV, model)?;
        }
    }

    Ok(current_ai_review_config())
}

#[tauri::command]
pub async fn get_opencode_sidecar_status(app: AppHandle) -> Result<OpencodeSidecarStatus, String> {
    let command = match app.shell().sidecar(OPENCODE_SIDECAR_NAME) {
        Ok(command) => command,
        Err(error) => {
            return Ok(OpencodeSidecarStatus {
                available: false,
                version: None,
                detail: Some(format!("Bundled sidecar is unavailable: {error}")),
            });
        }
    };

    let output = match command.arg("--version").output().await {
        Ok(output) => output,
        Err(error) => {
            return Ok(OpencodeSidecarStatus {
                available: false,
                version: None,
                detail: Some(format!("Failed to run bundled OpenCode sidecar: {error}")),
            });
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        return Ok(OpencodeSidecarStatus {
            available: false,
            version: None,
            detail: Some(if detail.is_empty() {
                "Bundled OpenCode sidecar exited with a non-zero status.".to_string()
            } else {
                snippet(detail, 300)
            }),
        });
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(OpencodeSidecarStatus {
        available: true,
        version: if version.is_empty() {
            None
        } else {
            Some(version)
        },
        detail: None,
    })
}

#[tauri::command]
pub async fn generate_ai_review(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateAiReviewInput,
) -> Result<GenerateAiReviewResult, String> {
    let _ = load_thread_by_id(&state, input.thread_id).await?;

    let workspace = input.workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace path must not be empty.".to_string());
    }

    let base_ref = input.base_ref.trim();
    let merge_base = input.merge_base.trim();
    let head = input.head.trim();
    if base_ref.is_empty() || merge_base.is_empty() || head.is_empty() {
        return Err("Comparison metadata is incomplete. Refresh diff and try again.".to_string());
    }

    let raw_diff = input.diff.trim();
    if raw_diff.is_empty() {
        return Err("There are no changes to review.".to_string());
    }

    let review_provider = ReviewProvider::from_env()?;
    let model = env::var(ROVEX_REVIEW_MODEL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_REVIEW_MODEL.to_string());
    let timeout_ms = parse_env_u64(
        ROVEX_REVIEW_TIMEOUT_MS_ENV,
        DEFAULT_REVIEW_TIMEOUT_MS,
        1_000,
    );
    let max_diff_chars = parse_env_usize(
        ROVEX_REVIEW_MAX_DIFF_CHARS_ENV,
        DEFAULT_REVIEW_MAX_DIFF_CHARS,
        1_000,
    );

    let (diff_for_review, diff_truncated) = truncate_chars(raw_diff, max_diff_chars);
    let diff_chars_total = raw_diff.chars().count();
    let diff_chars_used = diff_for_review.chars().count();

    let reviewer_goal = as_non_empty_trimmed(input.prompt.as_deref())
        .unwrap_or_else(|| "Perform a full code review for this patch.".to_string());
    let review_prompt = format!(
        "Review this patch.\n\nReviewer goal: {reviewer_goal}\nWorkspace: {workspace}\nBase ref: {base_ref}\nMerge base: {merge_base}\nHead: {head}\nDiff summary: {} files changed, +{}, -{}\nDiff truncated: {} ({} of {} chars)\n\nDiff:\n```diff\n{}\n```",
        input.files_changed,
        input.insertions,
        input.deletions,
        if diff_truncated { "yes" } else { "no" },
        diff_chars_used,
        diff_chars_total,
        diff_for_review
    );

    persist_thread_message(
        &state,
        input.thread_id,
        MessageRole::User,
        &format!("AI review request: {reviewer_goal}"),
    )
    .await?;

    let (review, resolved_model) = match review_provider {
        ReviewProvider::OpenAi => {
            let api_key = env::var(OPENAI_API_KEY_ENV)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    format!("Missing {OPENAI_API_KEY_ENV}. Add it to .env to enable AI review.")
                })?;
            let base_url = env::var(ROVEX_REVIEW_BASE_URL_ENV)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_REVIEW_BASE_URL.to_string());

            let review = generate_review_with_openai(
                &model,
                &base_url,
                timeout_ms,
                &api_key,
                &review_prompt,
            )
            .await?;
            (review, model.clone())
        }
        ReviewProvider::Opencode => {
            generate_review_with_opencode(&app, workspace, &review_prompt, timeout_ms, &model)
                .await?
        }
    };

    persist_thread_message(&state, input.thread_id, MessageRole::Assistant, &review).await?;

    Ok(GenerateAiReviewResult {
        thread_id: input.thread_id,
        workspace: workspace.to_string(),
        base_ref: base_ref.to_string(),
        merge_base: merge_base.to_string(),
        head: head.to_string(),
        files_changed: input.files_changed,
        insertions: input.insertions,
        deletions: input.deletions,
        model: resolved_model,
        review,
        diff_chars_used,
        diff_chars_total,
        diff_truncated,
    })
}

#[tauri::command]
pub async fn generate_ai_follow_up(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateAiFollowUpInput,
) -> Result<GenerateAiFollowUpResult, String> {
    let thread = load_thread_by_id(&state, input.thread_id).await?;
    let workspace = as_non_empty_trimmed(Some(input.workspace.as_str()))
        .or_else(|| as_non_empty_trimmed(thread.workspace.as_deref()))
        .ok_or_else(|| "Workspace path must not be empty.".to_string())?;
    let question = input.question.trim();
    if question.is_empty() {
        return Err("Question must not be empty.".to_string());
    }

    let recent_messages =
        load_recent_thread_messages(&state, input.thread_id, MAX_FOLLOW_UP_MESSAGES).await?;
    if !recent_messages
        .iter()
        .any(|message| matches!(message.role, MessageRole::Assistant))
    {
        return Err("Start review before asking follow-up questions.".to_string());
    }

    let history_limit = parse_env_usize(
        ROVEX_REVIEW_MAX_DIFF_CHARS_ENV,
        DEFAULT_FOLLOW_UP_HISTORY_CHARS,
        1_000,
    );
    let (history, history_truncated) = format_follow_up_history(&recent_messages, history_limit);
    if history.trim().is_empty() {
        return Err("No conversation history available for follow-up.".to_string());
    }

    let follow_up_prompt =
        build_follow_up_prompt(&thread, &workspace, question, &history, history_truncated);
    let review_provider = ReviewProvider::from_env()?;
    let model = env::var(ROVEX_REVIEW_MODEL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_REVIEW_MODEL.to_string());
    let timeout_ms = parse_env_u64(
        ROVEX_REVIEW_TIMEOUT_MS_ENV,
        DEFAULT_REVIEW_TIMEOUT_MS,
        1_000,
    );

    persist_thread_message(&state, input.thread_id, MessageRole::User, question).await?;

    let (answer, resolved_model) = match review_provider {
        ReviewProvider::OpenAi => {
            let api_key = env::var(OPENAI_API_KEY_ENV)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    format!("Missing {OPENAI_API_KEY_ENV}. Add it to .env to enable AI review.")
                })?;
            let base_url = env::var(ROVEX_REVIEW_BASE_URL_ENV)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_REVIEW_BASE_URL.to_string());

            let answer = generate_review_with_openai(
                &model,
                &base_url,
                timeout_ms,
                &api_key,
                &follow_up_prompt,
            )
            .await?;
            (answer, model.clone())
        }
        ReviewProvider::Opencode => {
            generate_review_with_opencode(&app, &workspace, &follow_up_prompt, timeout_ms, &model)
                .await?
        }
    };

    persist_thread_message(&state, input.thread_id, MessageRole::Assistant, &answer).await?;

    Ok(GenerateAiFollowUpResult {
        thread_id: input.thread_id,
        workspace,
        model: resolved_model,
        answer,
    })
}

#[tauri::command]
pub async fn list_workspace_branches(
    input: ListWorkspaceBranchesInput,
) -> Result<ListWorkspaceBranchesResult, String> {
    let repo_path = resolve_workspace_repo_path(&input.workspace)?;
    ensure_git_repository(&repo_path)?;

    if input.fetch_remote.unwrap_or(false) {
        run_git(&repo_path, &["fetch", "--quiet", "origin"], "fetch origin")?;
    }

    let current_branch = run_git_trimmed(
        &repo_path,
        &["branch", "--show-current"],
        "branch --show-current",
    )?;
    let current_branch = if current_branch.is_empty() {
        None
    } else {
        Some(current_branch)
    };

    let branch_output = run_git(
        &repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        "for-each-ref",
    )?;
    let raw_branches = String::from_utf8_lossy(&branch_output.stdout);
    let mut branch_names: Vec<String> = raw_branches
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    branch_names.sort_by(|left, right| {
        branch_sort_priority(left)
            .cmp(&branch_sort_priority(right))
            .then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
    });
    branch_names.dedup();

    let branches = branch_names
        .into_iter()
        .map(|name| WorkspaceBranch {
            is_current: current_branch.as_deref() == Some(name.as_str()),
            name,
        })
        .collect();

    Ok(ListWorkspaceBranchesResult {
        workspace: format_path(&repo_path),
        current_branch,
        branches,
    })
}

#[tauri::command]
pub async fn checkout_workspace_branch(
    input: CheckoutWorkspaceBranchInput,
) -> Result<CheckoutWorkspaceBranchResult, String> {
    let repo_path = resolve_workspace_repo_path(&input.workspace)?;
    ensure_git_repository(&repo_path)?;

    let branch_name = parse_branch_name(&input.branch_name)?;
    validate_branch_name(&repo_path, &branch_name)?;
    run_git(
        &repo_path,
        &["checkout", branch_name.as_str()],
        "checkout branch",
    )?;

    Ok(CheckoutWorkspaceBranchResult {
        workspace: format_path(&repo_path),
        branch_name,
    })
}

#[tauri::command]
pub async fn create_workspace_branch(
    input: CreateWorkspaceBranchInput,
) -> Result<CheckoutWorkspaceBranchResult, String> {
    let repo_path = resolve_workspace_repo_path(&input.workspace)?;
    ensure_git_repository(&repo_path)?;

    let branch_name = parse_branch_name(&input.branch_name)?;
    validate_branch_name(&repo_path, &branch_name)?;

    let from_ref = input
        .from_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(from_ref) = from_ref {
        run_git(
            &repo_path,
            &["checkout", "-b", branch_name.as_str(), from_ref],
            "checkout -b",
        )?;
    } else {
        run_git(
            &repo_path,
            &["checkout", "-b", branch_name.as_str()],
            "checkout -b",
        )?;
    }

    Ok(CheckoutWorkspaceBranchResult {
        workspace: format_path(&repo_path),
        branch_name,
    })
}

#[tauri::command]
pub async fn run_code_intel_sync(
    input: Option<CodeIntelSyncInput>,
) -> Result<CodeIntelSyncResult, String> {
    super::code_intel::run_code_intel_sync(input).await
}
