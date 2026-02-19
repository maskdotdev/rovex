use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::de::DeserializeOwned;

use crate::backend::{AiReviewConfig, MessageRole, ProviderKind};

pub(crate) const DEFAULT_LIMIT: i64 = 50;
pub(crate) const MAX_LIMIT: i64 = 200;
pub(crate) const DEFAULT_REPOSITORIES_DIR: &str = "rovex/repos";
pub(crate) const OPENAI_API_KEY_ENV: &str = "OPENAI_API_KEY";
pub(crate) const ROVEX_REVIEW_PROVIDER_ENV: &str = "ROVEX_REVIEW_PROVIDER";
pub(crate) const ROVEX_REVIEW_MODEL_ENV: &str = "ROVEX_REVIEW_MODEL";
pub(crate) const ROVEX_REVIEW_BASE_URL_ENV: &str = "ROVEX_REVIEW_BASE_URL";
pub(crate) const ROVEX_REVIEW_MAX_DIFF_CHARS_ENV: &str = "ROVEX_REVIEW_MAX_DIFF_CHARS";
pub(crate) const ROVEX_REVIEW_TIMEOUT_MS_ENV: &str = "ROVEX_REVIEW_TIMEOUT_MS";
pub(crate) const ROVEX_OPENCODE_MODEL_ENV: &str = "ROVEX_OPENCODE_MODEL";
pub(crate) const ROVEX_OPENCODE_HOSTNAME_ENV: &str = "ROVEX_OPENCODE_HOSTNAME";
pub(crate) const ROVEX_OPENCODE_PORT_ENV: &str = "ROVEX_OPENCODE_PORT";
pub(crate) const ROVEX_OPENCODE_SERVER_TIMEOUT_MS_ENV: &str = "ROVEX_OPENCODE_SERVER_TIMEOUT_MS";
pub(crate) const ROVEX_OPENCODE_PROVIDER_ENV: &str = "ROVEX_OPENCODE_PROVIDER";
pub(crate) const ROVEX_OPENCODE_AGENT_ENV: &str = "ROVEX_OPENCODE_AGENT";
pub(crate) const ROVEX_APP_SERVER_COMMAND_ENV: &str = "ROVEX_APP_SERVER_COMMAND";
pub(crate) const DEFAULT_REVIEW_PROVIDER: &str = "openai";
pub(crate) const DEFAULT_REVIEW_MODEL: &str = "gpt-4.1-mini";
pub(crate) const DEFAULT_REVIEW_BASE_URL: &str = "https://api.openai.com/v1";
pub(crate) const DEFAULT_REVIEW_MAX_DIFF_CHARS: usize = 120_000;
pub(crate) const DEFAULT_REVIEW_TIMEOUT_MS: u64 = 120_000;
pub(crate) const MAX_COMPARE_DIFF_BYTES: usize = 4_000_000;
pub(crate) const COMPARE_ENABLE_RENAMES: bool = true;
pub(crate) const DEFAULT_FOLLOW_UP_HISTORY_CHARS: usize = 40_000;
pub(crate) const MAX_FOLLOW_UP_MESSAGES: i64 = 40;
pub(crate) const DEFAULT_OPENCODE_HOSTNAME: &str = "127.0.0.1";
pub(crate) const DEFAULT_OPENCODE_PORT: u16 = 4096;
pub(crate) const DEFAULT_OPENCODE_SERVER_TIMEOUT_MS: u64 = 5_000;
pub(crate) const DEFAULT_OPENCODE_PROVIDER: &str = "openai";
pub(crate) const DEFAULT_OPENCODE_MODEL: &str = "openai/gpt-5";
pub(crate) const DEFAULT_OPENCODE_AGENT: &str = "plan";
pub(crate) const DEFAULT_APP_SERVER_COMMAND: &str = "codex";
pub(crate) const DEFAULT_APP_SERVER_STATUS_TIMEOUT_MS: u64 = 5_000;
pub(crate) const OPENCODE_SIDECAR_NAME: &str = "opencode";
pub(crate) const AI_REVIEW_PROGRESS_EVENT: &str = "rovex://ai-review-progress";
pub(crate) const MAX_CHUNK_FILE_CONTEXT_CHARS: usize = 6_000;
pub(crate) const MAX_CHUNK_FILE_CONTEXT_WINDOWS: usize = 8;
pub(crate) const MAX_PARALLEL_REVIEW_RUNS: usize = 8;
pub(crate) const MAX_PARALLEL_CHUNKS_PER_RUN: usize = 4;
pub(crate) const MAX_PROGRESS_EVENTS_PER_RUN: usize = 200;
pub(crate) const CHUNK_RETRY_MAX_ATTEMPTS: usize = 3;
pub(crate) const CHUNK_RETRY_BASE_DELAY_MS: u64 = 500;
pub(crate) const DEFAULT_REVIEWER_GOAL_PROMPT: &str = r#"You are a code reviewer. Your job is to review code changes and provide actionable feedback.

---

Input: review scope and diff context provided by Rovex.

---

## Gathering Context

Diffs alone are not enough. After getting the diff, read the entire file(s) being modified to understand the full context. Code that looks wrong in isolation may be correct given surrounding logic, and vice versa.

- Use the diff to identify which files changed.
- Use untracked-file context when available.
- Read the full file to understand existing patterns, control flow, and error handling.
- Check for existing style guide or conventions files (CONVENTIONS.md, AGENTS.md, .editorconfig, etc.).

## What to Look For

Bugs - Primary focus.
- Logic errors, off-by-one mistakes, incorrect conditionals.
- If-else guards: missing guards, incorrect branching, unreachable paths.
- Edge cases: null/empty/undefined inputs, error conditions, race conditions.
- Security issues: injection, auth bypass, data exposure.
- Broken error handling that swallows failures, throws unexpectedly, or returns error types that are not caught.

Structure - Does the code fit the codebase?
- Follow existing patterns and conventions.
- Use established abstractions where appropriate.
- Flag excessive nesting that should be flattened with early returns or extraction.

Performance - Only flag if obviously problematic.
- O(n^2) on unbounded data, N+1 queries, blocking I/O on hot paths.

## Before You Flag Something

Be certain. If you call something a bug, be confident it is a bug.

- Only review the changes. Do not review pre-existing unmodified code.
- Do not flag uncertain issues as definite.
- Do not invent hypothetical problems. Explain realistic break scenarios.
- If more context is needed, gather it before deciding.

Do not be a zealot about style.
- Verify the code is actually in violation.
- Accept pragmatic deviations when they are simpler and still clear.
- Excessive nesting is still a legitimate concern.
- Do not flag style preferences as issues unless they clearly violate established project conventions.

## Output

1. If there is a bug, be direct and clear about why it is a bug.
2. Clearly communicate severity; do not overstate it.
3. Explain the scenarios, environments, or inputs required for the bug to arise.
4. Use a matter-of-fact tone, not accusatory and not overly positive.
5. Write so the reader can quickly understand the issue.
6. Avoid flattery and non-actionable comments."#;

pub(crate) fn parse_limit(limit: Option<u32>) -> i64 {
    limit
        .map(i64::from)
        .map(|value| value.clamp(1, MAX_LIMIT))
        .unwrap_or(DEFAULT_LIMIT)
}

pub(crate) fn parse_message_role(value: String) -> Result<MessageRole, String> {
    match value.as_str() {
        "system" => Ok(MessageRole::System),
        "user" => Ok(MessageRole::User),
        "assistant" => Ok(MessageRole::Assistant),
        _ => Err(format!("Unexpected message role in database: {value}")),
    }
}

pub(crate) fn parse_provider_kind(value: String) -> Result<ProviderKind, String> {
    ProviderKind::from_str(&value)
        .ok_or_else(|| format!("Unexpected provider value in database: {value}"))
}

pub(crate) fn parse_env_u64(name: &str, fallback: u64, min: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value >= min)
        .unwrap_or(fallback)
}

pub(crate) fn parse_env_u16(name: &str, fallback: u16, min: u16) -> u16 {
    env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|value| *value >= min)
        .unwrap_or(fallback)
}

pub(crate) fn parse_env_usize(name: &str, fallback: usize, min: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value >= min)
        .unwrap_or(fallback)
}

pub(crate) fn truncate_utf8_by_bytes(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }

    let mut end = max_bytes.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }

    (value[..end].to_string(), true)
}

pub(crate) fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
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

pub(crate) fn as_non_empty_trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn snippet(value: &str, max_chars: usize) -> String {
    truncate_chars(value, max_chars).0
}

pub(crate) fn format_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub(crate) fn resolve_env_file_path() -> Option<PathBuf> {
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

pub(crate) fn upsert_env_key(path: &Path, key: &str, value: &str) -> Result<(), String> {
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

pub(crate) fn mask_secret(value: &str) -> Option<String> {
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

pub(crate) fn current_review_provider_value() -> String {
    let provider = env::var(ROVEX_REVIEW_PROVIDER_ENV)
        .ok()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_REVIEW_PROVIDER.to_string());
    match provider.as_str() {
        "openai" => "openai".to_string(),
        "opencode" => "opencode".to_string(),
        "app-server" | "app_server" | "codex" => "app-server".to_string(),
        _ => DEFAULT_REVIEW_PROVIDER.to_string(),
    }
}

pub(crate) fn current_ai_review_config() -> AiReviewConfig {
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

pub(crate) fn parse_json_vec_or_default<T: DeserializeOwned>(raw: &str) -> Vec<T> {
    serde_json::from_str::<Vec<T>>(raw).unwrap_or_default()
}

pub(crate) fn parse_optional_json_vec<T: DeserializeOwned>(raw: Option<String>) -> Vec<T> {
    raw.map(|value| parse_json_vec_or_default::<T>(&value))
        .unwrap_or_default()
}

pub(crate) fn parse_bool_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}
