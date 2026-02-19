use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use reqwest::{Client, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::sync::{Notify, Semaphore};
use tokio::task::JoinSet;

use super::{
    providers::{provider_client, ProviderDeviceAuthorizationPoll},
    AddThreadMessageInput, AiReviewChunk, AiReviewConfig, AiReviewFinding, AiReviewProgressEvent,
    AiReviewRun, AppServerAccountStatus, AppServerCredits, AppServerLoginStartResult,
    AppServerRateLimitWindow, AppServerRateLimits, AppState, BackendHealth, CancelAiReviewRunInput,
    CancelAiReviewRunResult, CheckoutWorkspaceBranchInput, CheckoutWorkspaceBranchResult,
    CloneRepositoryInput, CloneRepositoryResult, CodeIntelSyncInput, CodeIntelSyncResult,
    CompareWorkspaceDiffInput, CompareWorkspaceDiffResult, ConnectProviderInput, CreateThreadInput,
    CreateWorkspaceBranchInput, GenerateAiFollowUpInput, GenerateAiFollowUpResult,
    GenerateAiReviewInput, GenerateAiReviewResult, GetAiReviewRunInput, ListAiReviewRunsInput,
    ListAiReviewRunsResult, ListWorkspaceBranchesInput, ListWorkspaceBranchesResult, Message,
    MessageRole, OpencodeSidecarStatus, PollProviderDeviceAuthInput, PollProviderDeviceAuthResult,
    ProviderConnection, ProviderDeviceAuthStatus, ProviderKind, SetAiReviewApiKeyInput,
    SetAiReviewSettingsInput, StartAiReviewRunInput, StartAiReviewRunResult,
    StartProviderDeviceAuthInput, StartProviderDeviceAuthResult, Thread, WorkspaceBranch,
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
const ROVEX_OPENCODE_AGENT_ENV: &str = "ROVEX_OPENCODE_AGENT";
const ROVEX_APP_SERVER_COMMAND_ENV: &str = "ROVEX_APP_SERVER_COMMAND";
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
const DEFAULT_OPENCODE_AGENT: &str = "plan";
const DEFAULT_APP_SERVER_COMMAND: &str = "codex";
const DEFAULT_APP_SERVER_STATUS_TIMEOUT_MS: u64 = 5_000;
const OPENCODE_SIDECAR_NAME: &str = "opencode";
const AI_REVIEW_PROGRESS_EVENT: &str = "rovex://ai-review-progress";
const MAX_CHUNK_FILE_CONTEXT_CHARS: usize = 6_000;
const MAX_CHUNK_FILE_CONTEXT_WINDOWS: usize = 8;
const MAX_PARALLEL_REVIEW_RUNS: usize = 8;
const MAX_PARALLEL_CHUNKS_PER_RUN: usize = 4;
const MAX_PROGRESS_EVENTS_PER_RUN: usize = 200;
const CHUNK_RETRY_MAX_ATTEMPTS: usize = 3;
const CHUNK_RETRY_BASE_DELAY_MS: u64 = 500;
const DEFAULT_REVIEWER_GOAL_PROMPT: &str = r#"You are a code reviewer. Your job is to review code changes and provide actionable feedback.

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

struct ProviderConnectionRow {
    provider: ProviderKind,
    account_login: String,
    avatar_url: Option<String>,
    access_token: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone)]
struct ActiveRunHandle {
    cancel_flag: Arc<AtomicBool>,
    cancel_notify: Arc<Notify>,
}

static REVIEW_RUN_COUNTER: AtomicU64 = AtomicU64::new(1);
static REVIEW_RUN_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();
static ACTIVE_REVIEW_RUNS: OnceLock<Mutex<HashMap<String, ActiveRunHandle>>> = OnceLock::new();

fn review_run_slots() -> &'static Arc<Semaphore> {
    REVIEW_RUN_SLOTS.get_or_init(|| Arc::new(Semaphore::new(MAX_PARALLEL_REVIEW_RUNS)))
}

fn active_review_runs() -> &'static Mutex<HashMap<String, ActiveRunHandle>> {
    ACTIVE_REVIEW_RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_review_run_id() -> String {
    let counter = REVIEW_RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!("run-{millis}-{counter}")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReviewProvider {
    OpenAi,
    Opencode,
    AppServer,
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
            "app-server" | "app_server" | "codex" => Ok(Self::AppServer),
            other => Err(format!(
                "Unsupported {ROVEX_REVIEW_PROVIDER_ENV} value '{other}'. Use 'openai', 'opencode', or 'app-server'."
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

fn ref_sort_priority(name: &str) -> i32 {
    let normalized = name
        .strip_prefix("origin/")
        .or_else(|| name.split_once('/').map(|(_, remainder)| remainder))
        .unwrap_or(name);
    branch_sort_priority(normalized)
}

fn read_git_trimmed_if_success(repo_path: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        return None;
    }
    Some(value)
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

fn resolve_suggested_base_ref(
    repo_path: &Path,
    upstream_branch: Option<&str>,
    remote_branch_names: &[String],
    local_branch_names: &[String],
) -> String {
    if let Some(origin_head) = read_git_trimmed_if_success(
        repo_path,
        &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    ) {
        if origin_head != "origin/HEAD" && git_ref_exists(repo_path, &origin_head) {
            return origin_head;
        }
    }

    for candidate in ["origin/main", "origin/master", "main", "master"] {
        if git_ref_exists(repo_path, candidate) {
            return candidate.to_string();
        }
    }

    if let Some(upstream) = upstream_branch {
        if git_ref_exists(repo_path, upstream) {
            return upstream.to_string();
        }
    }

    if let Some(remote_branch) = remote_branch_names
        .iter()
        .find(|candidate| git_ref_exists(repo_path, candidate))
    {
        return remote_branch.clone();
    }

    if let Some(local_branch) = local_branch_names
        .iter()
        .find(|candidate| git_ref_exists(repo_path, candidate))
    {
        return local_branch.clone();
    }

    "origin/main".to_string()
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

fn emit_ai_review_progress(app: &AppHandle, event: &AiReviewProgressEvent) {
    let _ = app.emit(AI_REVIEW_PROGRESS_EVENT, event);
}

async fn emit_and_persist_ai_review_progress(
    app: &AppHandle,
    state: &AppState,
    run_id: &str,
    event: AiReviewProgressEvent,
) {
    emit_ai_review_progress(app, &event);
    if let Err(error) = append_ai_review_run_progress(state, run_id, &event).await {
        eprintln!("[backend] Failed to persist AI review progress for {run_id}: {error}");
    }
}

fn normalize_patch_path(value: &str) -> Option<String> {
    let normalized = value.trim().trim_matches('"');
    if normalized.is_empty() || normalized == "/dev/null" {
        return None;
    }
    let without_prefix = normalized
        .strip_prefix("a/")
        .or_else(|| normalized.strip_prefix("b/"))
        .unwrap_or(normalized);
    Some(without_prefix.to_string())
}

fn parse_hunk_line_start(spec: &str, prefix: char) -> Option<i64> {
    let trimmed = spec.trim();
    let rest = trimmed.strip_prefix(prefix)?;
    let (start, _) = rest.split_once(',').unwrap_or((rest, ""));
    start.trim().parse::<i64>().ok()
}

fn parse_hunk_positions(header: &str) -> Option<(i64, i64)> {
    if !header.starts_with("@@") {
        return None;
    }
    let mut parts = header.split_whitespace();
    let marker = parts.next()?;
    if marker != "@@" {
        return None;
    }
    let old_spec = parts.next()?;
    let new_spec = parts.next()?;
    let old_start = parse_hunk_line_start(old_spec, '-')?;
    let new_start = parse_hunk_line_start(new_spec, '+')?;
    Some((old_start, new_start))
}

fn parse_diff_chunks(diff: &str) -> Vec<DiffChunk> {
    #[derive(Default)]
    struct FileState {
        file_path: Option<String>,
        previous_path: Option<String>,
        headers: Vec<String>,
        chunk_count: usize,
    }
    struct HunkState {
        header: String,
        lines: Vec<String>,
        old_line: i64,
        new_line: i64,
        addition_lines: BTreeSet<i64>,
        deletion_lines: BTreeSet<i64>,
    }

    fn finalize_hunk(
        chunks: &mut Vec<DiffChunk>,
        file_state: &mut FileState,
        hunk_state: Option<HunkState>,
    ) {
        let Some(hunk_state) = hunk_state else {
            return;
        };
        let Some(file_path) = file_state.file_path.clone() else {
            return;
        };
        file_state.chunk_count += 1;
        let chunk_index = file_state.chunk_count;
        let chunk_id = format!("{file_path}#chunk-{chunk_index}");
        let mut patch_parts = Vec::new();
        patch_parts.extend(file_state.headers.clone());
        patch_parts.push(hunk_state.header.clone());
        patch_parts.extend(hunk_state.lines.clone());
        let patch = if patch_parts.is_empty() {
            String::new()
        } else {
            let mut joined = patch_parts.join("\n");
            joined.push('\n');
            joined
        };

        chunks.push(DiffChunk {
            id: chunk_id,
            file_path,
            previous_path: file_state.previous_path.clone(),
            chunk_index,
            hunk_header: hunk_state.header,
            patch,
            addition_lines: hunk_state.addition_lines.into_iter().collect(),
            deletion_lines: hunk_state.deletion_lines.into_iter().collect(),
        });
    }

    let mut chunks = Vec::new();
    let mut file_state = FileState::default();
    let mut hunk_state: Option<HunkState> = None;

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            finalize_hunk(&mut chunks, &mut file_state, hunk_state.take());
            file_state = FileState::default();
            file_state.headers.push(line.to_string());

            let mut parts = line.split_whitespace();
            let _ = parts.next();
            let _ = parts.next();
            let old_path = parts.next().and_then(normalize_patch_path);
            let new_path = parts.next().and_then(normalize_patch_path);
            file_state.previous_path = old_path;
            file_state.file_path = new_path.or_else(|| file_state.previous_path.clone());
            continue;
        }

        if line.starts_with("@@ ") && line.contains(" @@") {
            finalize_hunk(&mut chunks, &mut file_state, hunk_state.take());
            let (old_start, new_start) = parse_hunk_positions(line).unwrap_or((1, 1));
            hunk_state = Some(HunkState {
                header: line.to_string(),
                lines: Vec::new(),
                old_line: old_start.max(1),
                new_line: new_start.max(1),
                addition_lines: BTreeSet::new(),
                deletion_lines: BTreeSet::new(),
            });
            continue;
        }

        if let Some(hunk) = hunk_state.as_mut() {
            hunk.lines.push(line.to_string());
            if let Some(prefix) = line.chars().next() {
                match prefix {
                    '+' => {
                        if !line.starts_with("+++") {
                            hunk.addition_lines.insert(hunk.new_line.max(1));
                            hunk.new_line += 1;
                        }
                    }
                    '-' => {
                        if !line.starts_with("---") {
                            hunk.deletion_lines.insert(hunk.old_line.max(1));
                            hunk.old_line += 1;
                        }
                    }
                    ' ' => {
                        hunk.old_line += 1;
                        hunk.new_line += 1;
                    }
                    '\\' => {}
                    _ => {}
                }
            }
            continue;
        }

        if file_state.file_path.is_some() {
            if line.starts_with("--- ") {
                file_state.previous_path = normalize_patch_path(line.trim_start_matches("--- "));
            } else if line.starts_with("+++ ") {
                let new_path = normalize_patch_path(line.trim_start_matches("+++ "));
                if new_path.is_some() {
                    file_state.file_path = new_path;
                }
            }
            file_state.headers.push(line.to_string());
        }
    }

    finalize_hunk(&mut chunks, &mut file_state, hunk_state.take());
    chunks
}

fn merge_line_windows(line_numbers: &[i64], max_line: i64) -> Vec<(i64, i64)> {
    let mut windows: Vec<(i64, i64)> = Vec::new();
    let mut sorted_lines = line_numbers
        .iter()
        .copied()
        .filter(|line| *line > 0)
        .collect::<Vec<_>>();
    sorted_lines.sort_unstable();
    sorted_lines.dedup();

    for line in sorted_lines {
        let start = (line - 10).max(1);
        let end = (line + 10).min(max_line.max(1));
        if let Some((_, previous_end)) = windows.last_mut() {
            if start <= *previous_end + 2 {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        windows.push((start, end));
        if windows.len() >= MAX_CHUNK_FILE_CONTEXT_WINDOWS {
            break;
        }
    }

    windows
}

fn format_workspace_file_context(workspace: &str, chunk: &DiffChunk) -> Option<String> {
    let repo_path = Path::new(workspace);
    let primary_path = repo_path.join(&chunk.file_path);
    let (context_path, source) = if primary_path.exists() {
        (primary_path, chunk.file_path.clone())
    } else if let Some(previous_path) = &chunk.previous_path {
        let fallback = repo_path.join(previous_path);
        if fallback.exists() {
            (fallback, previous_path.clone())
        } else {
            return None;
        }
    } else {
        return None;
    };

    let content = fs::read_to_string(&context_path).ok()?;
    let lines = content.lines().collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }

    let target_lines = if chunk.addition_lines.is_empty() {
        vec![1]
    } else {
        chunk.addition_lines.clone()
    };
    let windows = merge_line_windows(&target_lines, lines.len() as i64);
    if windows.is_empty() {
        return None;
    }

    let mut sections = Vec::new();
    for (start, end) in windows {
        sections.push(format!("Lines {start}-{end}:"));
        for line in start..=end {
            let index = (line - 1) as usize;
            if let Some(value) = lines.get(index) {
                sections.push(format!("{line:>5} | {value}"));
            }
        }
        sections.push(String::new());
    }

    let rendered = format!(
        "Current workspace snapshot for {source}\n{}",
        sections.join("\n")
    );
    let (truncated, did_truncate) = truncate_chars(&rendered, MAX_CHUNK_FILE_CONTEXT_CHARS);
    Some(if did_truncate {
        format!("{truncated}\n[...truncated...]")
    } else {
        truncated
    })
}

fn normalize_annotation_side(value: Option<&str>) -> &'static str {
    let normalized = value
        .map(str::trim)
        .map(str::to_lowercase)
        .unwrap_or_else(|| "additions".to_string());
    match normalized.as_str() {
        "deletion" | "deletions" | "old" | "left" | "minus" | "removed" => "deletions",
        _ => "additions",
    }
}

fn normalize_severity(value: Option<&str>) -> &'static str {
    let normalized = value
        .map(str::trim)
        .map(str::to_lowercase)
        .unwrap_or_else(|| "medium".to_string());
    match normalized.as_str() {
        "critical" => "critical",
        "high" => "high",
        "low" => "low",
        _ => "medium",
    }
}

fn resolve_line_number_for_chunk(
    chunk: &DiffChunk,
    side: &str,
    requested: Option<i64>,
) -> Option<i64> {
    let lines = if side == "deletions" {
        &chunk.deletion_lines
    } else {
        &chunk.addition_lines
    };
    if lines.is_empty() {
        return None;
    }

    let candidate = requested.unwrap_or(lines[0]).max(1);
    if lines.contains(&candidate) {
        return Some(candidate);
    }

    lines
        .iter()
        .min_by_key(|line| (candidate - **line).abs())
        .copied()
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&raw[start..=end])
}

fn parse_chunk_review_payload(raw: &str) -> ChunkReviewPayload {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return ChunkReviewPayload {
            summary: Some("No output returned for this chunk.".to_string()),
            findings: Some(Vec::new()),
        };
    }

    if let Ok(payload) = serde_json::from_str::<ChunkReviewPayload>(trimmed) {
        return payload;
    }
    if let Some(json_slice) = extract_json_object(trimmed) {
        if let Ok(payload) = serde_json::from_str::<ChunkReviewPayload>(json_slice) {
            return payload;
        }
    }

    ChunkReviewPayload {
        summary: Some(snippet(trimmed, 1_200)),
        findings: Some(Vec::new()),
    }
}

fn build_chunk_review_prompt(
    reviewer_goal: &str,
    workspace: &str,
    base_ref: &str,
    merge_base: &str,
    head: &str,
    chunk: &DiffChunk,
    patch_for_review: &str,
    patch_truncated: bool,
    workspace_context: Option<&str>,
) -> String {
    let additions = if chunk.addition_lines.is_empty() {
        "none".to_string()
    } else {
        chunk
            .addition_lines
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    };
    let deletions = if chunk.deletion_lines.is_empty() {
        "none".to_string()
    } else {
        chunk
            .deletion_lines
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    };

    let context_block = workspace_context
        .map(|value| format!("\nWorkspace file context:\n```\n{value}\n```\n"))
        .unwrap_or_default();

    format!(
        "You are reviewing one diff chunk for bugs.\n\nReviewer goal: {reviewer_goal}\nWorkspace: {workspace}\nBase ref: {base_ref}\nMerge base: {merge_base}\nHead: {head}\nChunk ID: {}\nFile path: {}\nChunk index: {}\nHunk header: {}\nAllowed addition line numbers: {additions}\nAllowed deletion line numbers: {deletions}\nDiff chunk truncated: {}\n\nIMPORTANT:\n1) Treat this as a bug-finding task only (functional bugs, regressions, security, data loss, missing tests that hide bugs).\n2) If you are running in a tool-enabled environment, inspect relevant files in the workspace before deciding.\n3) Return STRICT JSON only. No markdown.\n4) JSON schema:\n{{\n  \"summary\": \"short chunk summary\",\n  \"findings\": [\n    {{\n      \"title\": \"short bug title\",\n      \"body\": \"why this is a bug and concrete fix/test guidance\",\n      \"severity\": \"critical|high|medium|low\",\n      \"confidence\": 0.0,\n      \"side\": \"additions|deletions\",\n      \"lineNumber\": 123\n    }}\n  ]\n}}\n5) Use an empty findings array when there is no clear bug.\n\nDiff chunk:\n```diff\n{patch_for_review}\n```{context_block}",
        chunk.id,
        chunk.file_path,
        chunk.chunk_index,
        chunk.hunk_header,
        if patch_truncated { "yes" } else { "no" }
    )
}

fn build_chunk_review_markdown(
    reviewer_goal: &str,
    chunks: &[AiReviewChunk],
    findings: &[AiReviewFinding],
    diff_truncated: bool,
) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "Chunked review complete for goal: {reviewer_goal}. {} chunk(s) analyzed.",
        chunks.len()
    ));
    lines.push(format!(
        "Findings: {}. Diff input truncated: {}.",
        findings.len(),
        if diff_truncated { "yes" } else { "no" }
    ));
    lines.push(String::new());
    lines.push("## Findings By Chunk".to_string());

    if findings.is_empty() {
        lines.push("- No clear bugs found in reviewed chunks.".to_string());
    }

    for chunk in chunks {
        lines.push(String::new());
        lines.push(format!(
            "### {} (chunk {}, {})",
            chunk.file_path, chunk.chunk_index, chunk.id
        ));
        if !chunk.summary.trim().is_empty() {
            lines.push(format!("- Summary: {}", chunk.summary.trim()));
        }
        if chunk.findings.is_empty() {
            lines.push("- No bug findings in this chunk.".to_string());
            continue;
        }
        for finding in &chunk.findings {
            lines.push(format!(
                "- [{}] {} [{}:{}] {}",
                finding.severity, finding.title, finding.side, finding.line_number, finding.body
            ));
        }
    }

    lines.join("\n")
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

fn parse_json_vec_or_default<T: DeserializeOwned>(raw: &str) -> Vec<T> {
    serde_json::from_str::<Vec<T>>(raw).unwrap_or_default()
}

fn parse_optional_json_vec<T: DeserializeOwned>(raw: Option<String>) -> Vec<T> {
    raw.map(|value| parse_json_vec_or_default::<T>(&value))
        .unwrap_or_default()
}

fn parse_bool_i64(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn parse_ai_review_run_from_row(row: &libsql::Row) -> Result<AiReviewRun, String> {
    let chunks_json: Option<String> = row
        .get(22)
        .map_err(|error| format!("Failed to parse run chunks_json: {error}"))?;
    let findings_json: Option<String> = row
        .get(23)
        .map_err(|error| format!("Failed to parse run findings_json: {error}"))?;
    let progress_events_json: Option<String> = row
        .get(24)
        .map_err(|error| format!("Failed to parse run progress_events_json: {error}"))?;
    let diff_truncated: i64 = row
        .get(20)
        .map_err(|error| format!("Failed to parse run diff_truncated: {error}"))?;
    let total_chunks: i64 = row
        .get(12)
        .map_err(|error| format!("Failed to parse run total_chunks: {error}"))?;
    let completed_chunks: i64 = row
        .get(13)
        .map_err(|error| format!("Failed to parse run completed_chunks: {error}"))?;
    let failed_chunks: i64 = row
        .get(14)
        .map_err(|error| format!("Failed to parse run failed_chunks: {error}"))?;
    let finding_count: i64 = row
        .get(15)
        .map_err(|error| format!("Failed to parse run finding_count: {error}"))?;
    let diff_chars_used: Option<i64> = row
        .get(18)
        .map_err(|error| format!("Failed to parse run diff_chars_used: {error}"))?;
    let diff_chars_total: Option<i64> = row
        .get(19)
        .map_err(|error| format!("Failed to parse run diff_chars_total: {error}"))?;

    Ok(AiReviewRun {
        run_id: row
            .get(0)
            .map_err(|error| format!("Failed to parse run_id: {error}"))?,
        thread_id: row
            .get(1)
            .map_err(|error| format!("Failed to parse run thread_id: {error}"))?,
        workspace: row
            .get(2)
            .map_err(|error| format!("Failed to parse run workspace: {error}"))?,
        base_ref: row
            .get(3)
            .map_err(|error| format!("Failed to parse run base_ref: {error}"))?,
        merge_base: row
            .get(4)
            .map_err(|error| format!("Failed to parse run merge_base: {error}"))?,
        head: row
            .get(5)
            .map_err(|error| format!("Failed to parse run head: {error}"))?,
        files_changed: row
            .get(6)
            .map_err(|error| format!("Failed to parse run files_changed: {error}"))?,
        insertions: row
            .get(7)
            .map_err(|error| format!("Failed to parse run insertions: {error}"))?,
        deletions: row
            .get(8)
            .map_err(|error| format!("Failed to parse run deletions: {error}"))?,
        prompt: row
            .get(9)
            .map_err(|error| format!("Failed to parse run prompt: {error}"))?,
        scope_label: row
            .get(10)
            .map_err(|error| format!("Failed to parse run scope_label: {error}"))?,
        status: row
            .get(11)
            .map_err(|error| format!("Failed to parse run status: {error}"))?,
        total_chunks: total_chunks.max(0) as usize,
        completed_chunks: completed_chunks.max(0) as usize,
        failed_chunks: failed_chunks.max(0) as usize,
        finding_count: finding_count.max(0) as usize,
        model: row
            .get(16)
            .map_err(|error| format!("Failed to parse run model: {error}"))?,
        review: row
            .get(17)
            .map_err(|error| format!("Failed to parse run review: {error}"))?,
        diff_chars_used: diff_chars_used.map(|value| value.max(0) as usize),
        diff_chars_total: diff_chars_total.map(|value| value.max(0) as usize),
        diff_truncated: diff_truncated != 0,
        error: row
            .get(21)
            .map_err(|error| format!("Failed to parse run error: {error}"))?,
        chunks: parse_optional_json_vec(chunks_json),
        findings: parse_optional_json_vec(findings_json),
        progress_events: parse_optional_json_vec(progress_events_json),
        created_at: row
            .get(25)
            .map_err(|error| format!("Failed to parse run created_at: {error}"))?,
        started_at: row
            .get(26)
            .map_err(|error| format!("Failed to parse run started_at: {error}"))?,
        ended_at: row
            .get(27)
            .map_err(|error| format!("Failed to parse run ended_at: {error}"))?,
        canceled_at: row
            .get(28)
            .map_err(|error| format!("Failed to parse run canceled_at: {error}"))?,
    })
}

async fn insert_ai_review_run(
    state: &AppState,
    run_id: &str,
    input: &StartAiReviewRunInput,
    reviewer_goal: &str,
    total_chunks: usize,
) -> Result<(), String> {
    let conn = state.connection()?;
    conn.execute(
        "INSERT INTO ai_review_runs (
            run_id, thread_id, workspace, base_ref, merge_base, head, files_changed, insertions, deletions,
            prompt, scope_label, status, total_chunks, completed_chunks, failed_chunks, finding_count,
            diff_chars_total
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'queued', ?12, 0, 0, 0, ?13)",
        (
            run_id.to_string(),
            input.thread_id,
            input.workspace.trim().to_string(),
            input.base_ref.trim().to_string(),
            input.merge_base.trim().to_string(),
            input.head.trim().to_string(),
            input.files_changed,
            input.insertions,
            input.deletions,
            Some(reviewer_goal.to_string()),
            input.scope_label.clone(),
            i64::try_from(total_chunks).unwrap_or(i64::MAX),
            i64::try_from(input.diff.chars().count()).unwrap_or(i64::MAX),
        ),
    )
    .await
    .map_err(|error| format!("Failed to insert AI review run: {error}"))?;
    Ok(())
}

async fn load_ai_review_run_by_id(state: &AppState, run_id: &str) -> Result<AiReviewRun, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT
              run_id, thread_id, workspace, base_ref, merge_base, head, files_changed, insertions, deletions,
              prompt, scope_label, status, total_chunks, completed_chunks, failed_chunks, finding_count,
              model, review, diff_chars_used, diff_chars_total, diff_truncated, error,
              chunks_json, findings_json, progress_events_json,
              created_at, started_at, ended_at, canceled_at
             FROM ai_review_runs
             WHERE run_id = ?1
             LIMIT 1",
            [run_id.to_string()],
        )
        .await
        .map_err(|error| format!("Failed to query AI review run: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read AI review run row: {error}"))?
    else {
        return Err(format!("AI review run '{run_id}' was not found."));
    };

    parse_ai_review_run_from_row(&row)
}

async fn list_ai_review_runs_internal(
    state: &AppState,
    thread_id: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<AiReviewRun>, String> {
    let conn = state.connection()?;
    let requested_limit = parse_limit(limit);
    let mut rows = if let Some(thread_id) = thread_id {
        conn.query(
            "SELECT
              run_id, thread_id, workspace, base_ref, merge_base, head, files_changed, insertions, deletions,
              prompt, scope_label, status, total_chunks, completed_chunks, failed_chunks, finding_count,
              model, review, diff_chars_used, diff_chars_total, diff_truncated, error,
              chunks_json, findings_json, progress_events_json,
              created_at, started_at, ended_at, canceled_at
             FROM ai_review_runs
             WHERE thread_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
            (thread_id, requested_limit),
        )
        .await
        .map_err(|error| format!("Failed to list AI review runs: {error}"))?
    } else {
        conn.query(
            "SELECT
              run_id, thread_id, workspace, base_ref, merge_base, head, files_changed, insertions, deletions,
              prompt, scope_label, status, total_chunks, completed_chunks, failed_chunks, finding_count,
              model, review, diff_chars_used, diff_chars_total, diff_truncated, error,
              chunks_json, findings_json, progress_events_json,
              created_at, started_at, ended_at, canceled_at
             FROM ai_review_runs
             ORDER BY created_at DESC
             LIMIT ?1",
            [requested_limit],
        )
        .await
        .map_err(|error| format!("Failed to list AI review runs: {error}"))?
    };

    let mut runs = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read AI review run rows: {error}"))?
    {
        runs.push(parse_ai_review_run_from_row(&row)?);
    }
    Ok(runs)
}

async fn set_ai_review_run_status(
    state: &AppState,
    run_id: &str,
    status: &str,
    error: Option<&str>,
    mark_started: bool,
    mark_ended: bool,
    mark_canceled: bool,
) -> Result<(), String> {
    let conn = state.connection()?;
    conn.execute(
        "UPDATE ai_review_runs
         SET status = ?2,
             error = ?3,
             started_at = CASE WHEN ?4 = 1 AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
             ended_at = CASE WHEN ?5 = 1 THEN CURRENT_TIMESTAMP ELSE ended_at END,
             canceled_at = CASE WHEN ?6 = 1 THEN CURRENT_TIMESTAMP ELSE canceled_at END
         WHERE run_id = ?1",
        (
            run_id.to_string(),
            status.to_string(),
            error.map(ToOwned::to_owned),
            parse_bool_i64(mark_started),
            parse_bool_i64(mark_ended),
            parse_bool_i64(mark_canceled),
        ),
    )
    .await
    .map_err(|error| format!("Failed to update AI review run status: {error}"))?;
    Ok(())
}

async fn append_ai_review_run_progress(
    state: &AppState,
    run_id: &str,
    event: &AiReviewProgressEvent,
) -> Result<(), String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT chunks_json, findings_json, progress_events_json, failed_chunks
             FROM ai_review_runs WHERE run_id = ?1 LIMIT 1",
            [run_id.to_string()],
        )
        .await
        .map_err(|error| format!("Failed to load run progress state: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read run progress row: {error}"))?
    else {
        return Ok(());
    };

    let mut chunks: Vec<AiReviewChunk> =
        parse_json_vec_or_default(&row.get::<String>(0).unwrap_or_else(|_| "[]".to_string()));
    let mut findings: Vec<AiReviewFinding> =
        parse_json_vec_or_default(&row.get::<String>(1).unwrap_or_else(|_| "[]".to_string()));
    let mut events: Vec<AiReviewProgressEvent> =
        parse_json_vec_or_default(&row.get::<String>(2).unwrap_or_else(|_| "[]".to_string()));
    let mut failed_chunks: i64 = row.get(3).unwrap_or(0);

    if let Some(chunk) = &event.chunk {
        if let Some(index) = chunks.iter().position(|entry| entry.id == chunk.id) {
            chunks[index] = chunk.clone();
        } else {
            chunks.push(chunk.clone());
        }
        chunks.sort_by(|left, right| {
            left.file_path
                .cmp(&right.file_path)
                .then(left.chunk_index.cmp(&right.chunk_index))
        });
    }
    if let Some(finding) = &event.finding {
        if !findings.iter().any(|entry| entry.id == finding.id) {
            findings.push(finding.clone());
        }
    }
    if event.status == "chunk-failed" {
        failed_chunks += 1;
    }

    events.push(event.clone());
    if events.len() > MAX_PROGRESS_EVENTS_PER_RUN {
        let start = events.len() - MAX_PROGRESS_EVENTS_PER_RUN;
        events = events.split_off(start);
    }

    let chunks_json = serde_json::to_string(&chunks)
        .map_err(|error| format!("Failed to serialize chunk progress: {error}"))?;
    let findings_json = serde_json::to_string(&findings)
        .map_err(|error| format!("Failed to serialize findings progress: {error}"))?;
    let events_json = serde_json::to_string(&events)
        .map_err(|error| format!("Failed to serialize event progress: {error}"))?;

    conn.execute(
        "UPDATE ai_review_runs
         SET chunks_json = ?2,
             findings_json = ?3,
             progress_events_json = ?4,
             completed_chunks = ?5,
             total_chunks = ?6,
             finding_count = ?7,
             failed_chunks = ?8
         WHERE run_id = ?1",
        (
            run_id.to_string(),
            chunks_json,
            findings_json,
            events_json,
            i64::try_from(event.completed_chunks).unwrap_or(i64::MAX),
            i64::try_from(event.total_chunks).unwrap_or(i64::MAX),
            i64::try_from(findings.len()).unwrap_or(i64::MAX),
            failed_chunks,
        ),
    )
    .await
    .map_err(|error| format!("Failed to persist run progress: {error}"))?;
    Ok(())
}

async fn finalize_ai_review_run(
    state: &AppState,
    run_id: &str,
    result: &GenerateAiReviewResult,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let conn = state.connection()?;
    conn.execute(
        "UPDATE ai_review_runs
         SET status = ?2,
             model = ?3,
             review = ?4,
             diff_chars_used = ?5,
             diff_chars_total = ?6,
             diff_truncated = ?7,
             error = ?8,
             chunks_json = ?9,
             findings_json = ?10,
             completed_chunks = ?11,
             total_chunks = ?12,
             finding_count = ?13,
             ended_at = CURRENT_TIMESTAMP
         WHERE run_id = ?1",
        (
            run_id.to_string(),
            status.to_string(),
            Some(result.model.clone()),
            Some(result.review.clone()),
            i64::try_from(result.diff_chars_used).unwrap_or(i64::MAX),
            i64::try_from(result.diff_chars_total).unwrap_or(i64::MAX),
            parse_bool_i64(result.diff_truncated),
            error.map(ToOwned::to_owned),
            serde_json::to_string(&result.chunks)
                .map_err(|serialize_error| format!("Failed to serialize final chunks: {serialize_error}"))?,
            serde_json::to_string(&result.findings)
                .map_err(|serialize_error| format!("Failed to serialize final findings: {serialize_error}"))?,
            i64::try_from(result.chunks.len()).unwrap_or(i64::MAX),
            i64::try_from(result.chunks.len()).unwrap_or(i64::MAX),
            i64::try_from(result.findings.len()).unwrap_or(i64::MAX),
        ),
    )
    .await
    .map_err(|error| format!("Failed to finalize AI review run: {error}"))?;
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

fn resolve_app_server_model(review_model: &str) -> String {
    review_model.trim().to_string()
}

fn parse_app_server_optional_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|entry| entry.as_str())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_app_server_optional_i64(value: Option<&serde_json::Value>) -> Option<i64> {
    value.and_then(|entry| {
        entry
            .as_i64()
            .or_else(|| entry.as_u64().and_then(|number| i64::try_from(number).ok()))
    })
}

fn parse_app_server_rate_limit_window(
    value: Option<&serde_json::Value>,
) -> Option<AppServerRateLimitWindow> {
    let entry = value?.as_object()?;
    let used_percent = parse_app_server_optional_i64(entry.get("usedPercent"))?;
    Some(AppServerRateLimitWindow {
        used_percent,
        resets_at: parse_app_server_optional_i64(entry.get("resetsAt")),
        window_duration_mins: parse_app_server_optional_i64(entry.get("windowDurationMins")),
    })
}

fn parse_app_server_credits(value: Option<&serde_json::Value>) -> Option<AppServerCredits> {
    let entry = value?.as_object()?;
    Some(AppServerCredits {
        balance: parse_app_server_optional_string(entry.get("balance")),
        has_credits: entry
            .get("hasCredits")
            .and_then(|field| field.as_bool())
            .unwrap_or(false),
        unlimited: entry
            .get("unlimited")
            .and_then(|field| field.as_bool())
            .unwrap_or(false),
    })
}

fn parse_app_server_rate_limits(value: &serde_json::Value) -> Option<AppServerRateLimits> {
    let entry = value.as_object()?;
    Some(AppServerRateLimits {
        limit_id: parse_app_server_optional_string(entry.get("limitId")),
        limit_name: parse_app_server_optional_string(entry.get("limitName")),
        plan_type: parse_app_server_optional_string(entry.get("planType")),
        primary: parse_app_server_rate_limit_window(entry.get("primary")),
        secondary: parse_app_server_rate_limit_window(entry.get("secondary")),
        credits: parse_app_server_credits(entry.get("credits")),
    })
}

fn parse_app_server_rate_limits_result(result: &serde_json::Value) -> Option<AppServerRateLimits> {
    if let Some(entries) = result
        .get("rateLimitsByLimitId")
        .and_then(|value| value.as_object())
    {
        if let Some(codex_limits) = entries.get("codex").and_then(parse_app_server_rate_limits) {
            return Some(codex_limits);
        }

        for value in entries.values() {
            if let Some(parsed) = parse_app_server_rate_limits(value) {
                return Some(parsed);
            }
        }
    }

    result
        .get("rateLimits")
        .and_then(parse_app_server_rate_limits)
}

fn json_rpc_id_matches(message: &serde_json::Value, expected_id: i64) -> bool {
    message
        .get("id")
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_u64().and_then(|id| i64::try_from(id).ok()))
                .or_else(|| value.as_str().and_then(|id| id.parse::<i64>().ok()))
        })
        .map(|id| id == expected_id)
        .unwrap_or(false)
}

fn extract_json_rpc_error_message(message: &serde_json::Value) -> Option<String> {
    let error = message.get("error")?;
    let code = error.get("code").and_then(|value| value.as_i64());
    let detail = error
        .get("message")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("request failed");
    Some(match code {
        Some(code) => format!("Codex app-server error {code}: {detail}"),
        None => format!("Codex app-server error: {detail}"),
    })
}

fn normalize_text_fragment(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let normalized = text.trim();
        if !normalized.is_empty() {
            return Some(normalized.to_string());
        }
        return None;
    }

    if let Some(text) = value.get("text").and_then(|entry| entry.as_str()) {
        let normalized = text.trim();
        if !normalized.is_empty() {
            return Some(normalized.to_string());
        }
    }

    if let Some(text) = value
        .get("text")
        .and_then(|entry| entry.get("value"))
        .and_then(|entry| entry.as_str())
    {
        let normalized = text.trim();
        if !normalized.is_empty() {
            return Some(normalized.to_string());
        }
    }

    if let Some(output) = value.get("output") {
        if let Some(text) = normalize_text_fragment(output) {
            return Some(text);
        }
    }

    None
}

fn extract_app_server_item_text(item: &serde_json::Value) -> Option<String> {
    if let Some(text) = normalize_text_fragment(item) {
        return Some(text);
    }

    let mut parts = Vec::new();
    for key in ["content", "parts"] {
        let Some(entries) = item.get(key).and_then(|value| value.as_array()) else {
            continue;
        };
        for entry in entries {
            if let Some(text) = normalize_text_fragment(entry) {
                parts.push(text);
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

fn json_value_id(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .or_else(|| value.as_i64().map(|id| id.to_string()))
        .or_else(|| value.as_u64().map(|id| id.to_string()))
}

fn json_ids_equal(left: &serde_json::Value, right: &serde_json::Value) -> bool {
    match (json_value_id(left), json_value_id(right)) {
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}

fn remaining_until(deadline: tokio::time::Instant) -> Result<Duration, String> {
    let now = tokio::time::Instant::now();
    if now >= deadline {
        return Err("Timed out waiting for Codex app-server response.".to_string());
    }
    Ok(deadline.saturating_duration_since(now))
}

async fn read_json_rpc_message<R: AsyncBufRead + Unpin>(
    lines: &mut tokio::io::Lines<R>,
    deadline: tokio::time::Instant,
) -> Result<serde_json::Value, String> {
    loop {
        let remaining = remaining_until(deadline)?;
        let next_line = tokio::time::timeout(remaining, lines.next_line())
            .await
            .map_err(|_| "Timed out waiting for Codex app-server response.".to_string())?;
        let line = next_line
            .map_err(|error| format!("Failed to read Codex app-server output: {error}"))?
            .ok_or_else(|| "Codex app-server exited before returning a response.".to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let message = serde_json::from_str::<serde_json::Value>(trimmed).map_err(|error| {
            format!(
                "Received invalid JSON from Codex app-server: {error}. Payload: {}",
                snippet(trimmed, 200)
            )
        })?;
        return Ok(message);
    }
}

async fn write_json_rpc_message(
    stdin: &mut tokio::process::ChildStdin,
    payload: &serde_json::Value,
) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(payload)
        .map_err(|error| format!("Failed to encode JSON-RPC request: {error}"))?;
    bytes.push(b'\n');
    stdin
        .write_all(&bytes)
        .await
        .map_err(|error| format!("Failed to write to Codex app-server: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("Failed to flush Codex app-server request: {error}"))
}

async fn wait_for_json_rpc_result<R: AsyncBufRead + Unpin>(
    lines: &mut tokio::io::Lines<R>,
    request_id: i64,
    deadline: tokio::time::Instant,
) -> Result<serde_json::Value, String> {
    loop {
        let message = read_json_rpc_message(lines, deadline).await?;
        if !json_rpc_id_matches(&message, request_id) {
            continue;
        }
        if let Some(error) = extract_json_rpc_error_message(&message) {
            return Err(error);
        }
        return Ok(message
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null));
    }
}

struct ResolvedOpencodeModel {
    provider_id: String,
    model_id: String,
    display: String,
}

#[derive(Debug, Clone)]
struct DiffChunk {
    id: String,
    file_path: String,
    previous_path: Option<String>,
    chunk_index: usize,
    hunk_header: String,
    patch: String,
    addition_lines: Vec<i64>,
    deletion_lines: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkFindingPayload {
    title: Option<String>,
    body: Option<String>,
    severity: Option<String>,
    confidence: Option<f64>,
    side: Option<String>,
    line_number: Option<i64>,
    line: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkReviewPayload {
    summary: Option<String>,
    findings: Option<Vec<ChunkFindingPayload>>,
}

struct ChunkWorkerResult {
    chunk: DiffChunk,
    raw_chunk_review: String,
    model: String,
}

struct ChunkWorkerError {
    chunk: DiffChunk,
    message: String,
}

struct RunExecutionOutcome {
    result: GenerateAiReviewResult,
    failed_chunks: usize,
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
    agent: &'a str,
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

async fn generate_openai_chat_completion(
    model: &str,
    base_url: &str,
    timeout_ms: u64,
    api_key: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
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

async fn generate_review_with_openai(
    model: &str,
    base_url: &str,
    timeout_ms: u64,
    api_key: &str,
    prompt: &str,
) -> Result<String, String> {
    let system_prompt = "You are a senior code reviewer. Review the diff and provide concise, high-signal findings. Prioritize functional bugs, regressions, security risks, and missing tests. Use markdown with sections: Summary, Findings, Suggested Tests. If no issues, say that clearly.";
    generate_openai_chat_completion(model, base_url, timeout_ms, api_key, system_prompt, prompt)
        .await
}

async fn generate_chunk_with_openai(
    model: &str,
    base_url: &str,
    timeout_ms: u64,
    api_key: &str,
    prompt: &str,
) -> Result<String, String> {
    let system_prompt = "You are a senior code reviewer focused on bug detection for a single diff chunk. Inspect context carefully, avoid style nits, and return strict JSON only.";
    generate_openai_chat_completion(model, base_url, timeout_ms, api_key, system_prompt, prompt)
        .await
}

async fn generate_review_with_app_server(
    workspace: &str,
    prompt: &str,
    timeout_ms: u64,
    review_model: &str,
) -> Result<(String, String), String> {
    let command_name = env::var(ROVEX_APP_SERVER_COMMAND_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_APP_SERVER_COMMAND.to_string());
    let resolved_model = resolve_app_server_model(review_model);

    let mut child = TokioCommand::new(&command_name)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start Codex app-server with '{} app-server': {error}",
                command_name
            )
        })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdout.".to_string())?;
    let mut lines = BufReader::new(stdout).lines();

    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
    let review_result: Result<(String, String), String> = async {
        let initialize_request_id = 1i64;
        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": initialize_request_id,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "clientInfo": {
                        "name": "rovex",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": {},
                }
            }),
        )
        .await?;
        let _ = wait_for_json_rpc_result(&mut lines, initialize_request_id, deadline).await?;

        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "initialized",
                "params": {},
            }),
        )
        .await?;

        let thread_start_request_id = 2i64;
        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": thread_start_request_id,
                "method": "thread/start",
                "params": {
                    "cwd": workspace,
                    "model": resolved_model,
                }
            }),
        )
        .await?;
        let thread_result =
            wait_for_json_rpc_result(&mut lines, thread_start_request_id, deadline).await?;
        let thread_id = thread_result
            .pointer("/thread/id")
            .and_then(|value| value.as_str())
            .or_else(|| {
                thread_result
                    .get("threadId")
                    .and_then(|value| value.as_str())
            })
            .or_else(|| thread_result.get("id").and_then(|value| value.as_str()))
            .ok_or_else(|| "Codex app-server did not return a thread id.".to_string())?;

        let turn_start_request_id = 3i64;
        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": turn_start_request_id,
                "method": "turn/start",
                "params": {
                    "threadId": thread_id,
                    "cwd": workspace,
                    "input": prompt,
                }
            }),
        )
        .await?;
        let turn_result =
            wait_for_json_rpc_result(&mut lines, turn_start_request_id, deadline).await?;
        let expected_turn_id = turn_result
            .pointer("/turn/id")
            .cloned()
            .or_else(|| turn_result.get("turnId").cloned())
            .or_else(|| turn_result.get("id").cloned());

        let mut latest_text: Option<String> = None;
        loop {
            let message = read_json_rpc_message(&mut lines, deadline).await?;
            if let Some(error) = extract_json_rpc_error_message(&message) {
                return Err(error);
            }

            let method = message.get("method").and_then(|value| value.as_str());
            match method {
                Some("item/completed") => {
                    let Some(item) = message.pointer("/params/item") else {
                        continue;
                    };
                    let item_type = item.get("type").and_then(|value| value.as_str());
                    if matches!(item_type, Some("agentMessage") | Some("message")) {
                        if let Some(text) = extract_app_server_item_text(item) {
                            latest_text = Some(text);
                        }
                    }
                }
                Some("turn/completed") => {
                    if let Some(expected_turn_id) = expected_turn_id.as_ref() {
                        if let Some(actual_turn_id) = message.pointer("/params/turn/id") {
                            if !json_ids_equal(actual_turn_id, expected_turn_id) {
                                continue;
                            }
                        }
                    }

                    let turn_status = message
                        .pointer("/params/turn/status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("completed");
                    if turn_status != "completed" {
                        let detail = message
                            .pointer("/params/turn/error/message")
                            .and_then(|value| value.as_str())
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .unwrap_or("turn did not complete successfully");
                        return Err(format!("Codex app-server turn failed: {detail}"));
                    }
                    break;
                }
                _ => {}
            }
        }

        let review = latest_text
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "Codex app-server completed without returning assistant output.".to_string()
            })?;
        Ok((review, resolved_model.clone()))
    }
    .await;

    let _ = child.kill().await;
    let _ = child.wait().await;
    review_result
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
    let agent = env::var(ROVEX_OPENCODE_AGENT_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_OPENCODE_AGENT.to_string());

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
                agent: &agent,
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

async fn generate_chunk_review(
    app: &AppHandle,
    provider: ReviewProvider,
    workspace: &str,
    model: &str,
    timeout_ms: u64,
    openai_api_key: Option<&str>,
    openai_base_url: Option<&str>,
    prompt: &str,
) -> Result<(String, String), String> {
    match provider {
        ReviewProvider::OpenAi => {
            let api_key = openai_api_key.ok_or_else(|| {
                format!("Missing {OPENAI_API_KEY_ENV}. Add it to .env to enable AI review.")
            })?;
            let base_url = openai_base_url.unwrap_or(DEFAULT_REVIEW_BASE_URL);
            let review =
                generate_chunk_with_openai(model, base_url, timeout_ms, api_key, prompt).await?;
            Ok((review, model.to_string()))
        }
        ReviewProvider::Opencode => {
            generate_review_with_opencode(app, workspace, prompt, timeout_ms, model).await
        }
        ReviewProvider::AppServer => {
            generate_review_with_app_server(workspace, prompt, timeout_ms, model).await
        }
    }
}

fn is_transient_chunk_error(message: &str) -> bool {
    let normalized = message.to_lowercase();
    [
        "429",
        "too many requests",
        "timeout",
        "timed out",
        "temporarily unavailable",
        "connection reset",
        "connection refused",
        "503",
        "502",
        "504",
        "rate limit",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

async fn generate_chunk_review_with_retries(
    app: &AppHandle,
    provider: ReviewProvider,
    workspace: &str,
    model: &str,
    timeout_ms: u64,
    openai_api_key: Option<&str>,
    openai_base_url: Option<&str>,
    prompt: &str,
    cancel_flag: Option<&Arc<AtomicBool>>,
) -> Result<(String, String), String> {
    let mut last_error = String::new();
    for attempt in 1..=CHUNK_RETRY_MAX_ATTEMPTS {
        if cancel_flag
            .map(|flag| flag.load(Ordering::Relaxed))
            .unwrap_or(false)
        {
            return Err("Run canceled.".to_string());
        }

        match generate_chunk_review(
            app,
            provider,
            workspace,
            model,
            timeout_ms,
            openai_api_key,
            openai_base_url,
            prompt,
        )
        .await
        {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = error;
                if attempt >= CHUNK_RETRY_MAX_ATTEMPTS || !is_transient_chunk_error(&last_error) {
                    break;
                }
                let factor = 1u64 << (attempt - 1);
                let delay_ms = CHUNK_RETRY_BASE_DELAY_MS.saturating_mul(factor).min(30_000);
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    }
    Err(last_error)
}

fn as_generate_ai_review_input(input: &StartAiReviewRunInput) -> GenerateAiReviewInput {
    GenerateAiReviewInput {
        thread_id: input.thread_id,
        workspace: input.workspace.clone(),
        base_ref: input.base_ref.clone(),
        merge_base: input.merge_base.clone(),
        head: input.head.clone(),
        files_changed: input.files_changed,
        insertions: input.insertions,
        deletions: input.deletions,
        diff: input.diff.clone(),
        prompt: input.prompt.clone(),
    }
}

async fn execute_ai_review_generation(
    app: &AppHandle,
    state: &AppState,
    input: &GenerateAiReviewInput,
    run_id: Option<&str>,
    cancel_flag: Option<&Arc<AtomicBool>>,
    persist_progress: bool,
) -> Result<RunExecutionOutcome, String> {
    let _ = load_thread_by_id(state, input.thread_id).await?;

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
    let diff_chunks = parse_diff_chunks(raw_diff);
    if diff_chunks.is_empty() {
        return Err("No reviewable diff hunks were found in this diff.".to_string());
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
    let diff_chars_total = raw_diff.chars().count();

    let reviewer_goal = if let Some(additional_focus) = as_non_empty_trimmed(input.prompt.as_deref())
    {
        format!(
            "{DEFAULT_REVIEWER_GOAL_PROMPT}\n\n---\n\nAdditional requested focus:\n{additional_focus}"
        )
    } else {
        DEFAULT_REVIEWER_GOAL_PROMPT.to_string()
    };

    persist_thread_message(
        state,
        input.thread_id,
        MessageRole::User,
        &format!("AI review request: {reviewer_goal}"),
    )
    .await?;

    let (openai_api_key, openai_base_url): (Option<String>, Option<String>) =
        if review_provider == ReviewProvider::OpenAi {
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
            (Some(api_key), Some(base_url))
        } else {
            (None, None)
        };

    struct PreparedChunk {
        chunk: DiffChunk,
        chunk_prompt: String,
    }

    let mut prepared_chunks = VecDeque::with_capacity(diff_chunks.len());
    let mut diff_truncated = false;
    let mut diff_chars_used = 0usize;
    for chunk in &diff_chunks {
        let (chunk_patch_for_review, chunk_truncated) =
            truncate_chars(&chunk.patch, max_diff_chars);
        diff_truncated |= chunk_truncated;
        diff_chars_used += chunk_patch_for_review.chars().count();
        let workspace_context = format_workspace_file_context(workspace, chunk);
        let chunk_prompt = build_chunk_review_prompt(
            &reviewer_goal,
            workspace,
            base_ref,
            merge_base,
            head,
            chunk,
            &chunk_patch_for_review,
            chunk_truncated,
            workspace_context.as_deref(),
        );
        prepared_chunks.push_back(PreparedChunk {
            chunk: chunk.clone(),
            chunk_prompt,
        });
    }

    let total_chunks = prepared_chunks.len();
    let mut chunk_reviews: Vec<AiReviewChunk> = Vec::with_capacity(total_chunks);
    let mut findings: Vec<AiReviewFinding> = Vec::new();
    let mut completed_chunks = 0usize;
    let mut failed_chunks = 0usize;
    let mut resolved_model = model.clone();
    let run_id_owned = run_id.map(ToOwned::to_owned);

    let started_event = AiReviewProgressEvent {
        run_id: run_id_owned.clone(),
        thread_id: input.thread_id,
        status: "started".to_string(),
        message: format!("Started chunked review for {} chunk(s).", total_chunks),
        total_chunks,
        completed_chunks,
        chunk_id: None,
        file_path: None,
        chunk_index: None,
        finding_count: None,
        chunk: None,
        finding: None,
    };
    if persist_progress {
        if let Some(run_id) = run_id {
            emit_and_persist_ai_review_progress(app, state, run_id, started_event).await;
        }
    } else {
        emit_ai_review_progress(app, &started_event);
    }

    let mut join_set: JoinSet<Result<ChunkWorkerResult, ChunkWorkerError>> = JoinSet::new();

    while !prepared_chunks.is_empty() || !join_set.is_empty() {
        if cancel_flag
            .map(|flag| flag.load(Ordering::Relaxed))
            .unwrap_or(false)
        {
            join_set.abort_all();
            return Err("AI review run canceled.".to_string());
        }

        while join_set.len() < MAX_PARALLEL_CHUNKS_PER_RUN && !prepared_chunks.is_empty() {
            let Some(prepared) = prepared_chunks.pop_front() else {
                break;
            };
            let chunk_for_event = prepared.chunk.clone();
            let chunk_start_event = AiReviewProgressEvent {
                run_id: run_id_owned.clone(),
                thread_id: input.thread_id,
                status: "chunk-start".to_string(),
                message: format!(
                    "Reviewing {} chunk {}.",
                    chunk_for_event.file_path, chunk_for_event.chunk_index
                ),
                total_chunks,
                completed_chunks,
                chunk_id: Some(chunk_for_event.id.clone()),
                file_path: Some(chunk_for_event.file_path.clone()),
                chunk_index: Some(chunk_for_event.chunk_index),
                finding_count: None,
                chunk: None,
                finding: None,
            };
            if persist_progress {
                if let Some(run_id) = run_id {
                    emit_and_persist_ai_review_progress(app, state, run_id, chunk_start_event).await;
                }
            } else {
                emit_ai_review_progress(app, &chunk_start_event);
            }

            let app_handle = app.clone();
            let workspace_owned = workspace.to_string();
            let model_owned = model.clone();
            let prompt = prepared.chunk_prompt;
            let chunk = prepared.chunk;
            let chunk_for_error = chunk.clone();
            let cancel = cancel_flag.cloned();
            let openai_api_key = openai_api_key.clone();
            let openai_base_url = openai_base_url.clone();
            join_set.spawn(async move {
                if cancel
                    .as_ref()
                    .map(|flag| flag.load(Ordering::Relaxed))
                    .unwrap_or(false)
                {
                    return Err(ChunkWorkerError {
                        chunk,
                        message: "Run canceled.".to_string(),
                    });
                }
                generate_chunk_review_with_retries(
                    &app_handle,
                    review_provider,
                    &workspace_owned,
                    &model_owned,
                    timeout_ms,
                    openai_api_key.as_deref(),
                    openai_base_url.as_deref(),
                    &prompt,
                    cancel.as_ref(),
                )
                .await
                .map(|(raw_chunk_review, chunk_model)| ChunkWorkerResult {
                    chunk,
                    raw_chunk_review,
                    model: chunk_model,
                })
                .map_err(|message| ChunkWorkerError {
                    chunk: chunk_for_error,
                    message,
                })
            });
        }

        let Some(join_result) = join_set.join_next().await else {
            continue;
        };

        match join_result {
            Ok(Ok(worker_result)) => {
                let chunk = worker_result.chunk;
                resolved_model = worker_result.model;
                let payload = parse_chunk_review_payload(&worker_result.raw_chunk_review);
                let summary = payload
                    .summary
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| {
                        if worker_result.raw_chunk_review.trim().is_empty() {
                            "No output returned for this chunk.".to_string()
                        } else {
                            snippet(worker_result.raw_chunk_review.trim(), 1_200)
                        }
                    });

                let mut chunk_findings = Vec::new();
                if let Some(payload_findings) = payload.findings {
                    for (finding_index, payload_finding) in payload_findings.into_iter().enumerate() {
                        let title = payload_finding
                            .title
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(ToOwned::to_owned)
                            .unwrap_or_else(|| "Potential bug".to_string());
                        let body = payload_finding
                            .body
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(ToOwned::to_owned)
                            .unwrap_or_else(|| "Potential issue detected in this diff chunk.".to_string());
                        let side = normalize_annotation_side(payload_finding.side.as_deref()).to_string();
                        let line_number = resolve_line_number_for_chunk(
                            &chunk,
                            &side,
                            payload_finding.line_number.or(payload_finding.line),
                        );
                        let Some(line_number) = line_number else {
                            continue;
                        };

                        let finding = AiReviewFinding {
                            id: format!("{}:{}:{}:{}", chunk.id, side, line_number, finding_index + 1),
                            file_path: chunk.file_path.clone(),
                            chunk_id: chunk.id.clone(),
                            chunk_index: chunk.chunk_index,
                            hunk_header: chunk.hunk_header.clone(),
                            side: side.clone(),
                            line_number,
                            title,
                            body,
                            severity: normalize_severity(payload_finding.severity.as_deref()).to_string(),
                            confidence: payload_finding.confidence.map(|value| value.clamp(0.0, 1.0)),
                        };
                        chunk_findings.push(finding.clone());
                        let finding_event = AiReviewProgressEvent {
                            run_id: run_id_owned.clone(),
                            thread_id: input.thread_id,
                            status: "finding".to_string(),
                            message: format!(
                                "{}:{} {}",
                                finding.file_path, finding.line_number, finding.title
                            ),
                            total_chunks,
                            completed_chunks,
                            chunk_id: Some(chunk.id.clone()),
                            file_path: Some(chunk.file_path.clone()),
                            chunk_index: Some(chunk.chunk_index),
                            finding_count: Some(chunk_findings.len()),
                            chunk: None,
                            finding: Some(finding),
                        };
                        if persist_progress {
                            if let Some(run_id) = run_id {
                                emit_and_persist_ai_review_progress(
                                    app,
                                    state,
                                    run_id,
                                    finding_event,
                                )
                                .await;
                            }
                        } else {
                            emit_ai_review_progress(app, &finding_event);
                        }
                    }
                }

                let chunk_review = AiReviewChunk {
                    id: chunk.id.clone(),
                    file_path: chunk.file_path.clone(),
                    chunk_index: chunk.chunk_index,
                    hunk_header: chunk.hunk_header.clone(),
                    summary,
                    findings: chunk_findings.clone(),
                };
                completed_chunks += 1;
                findings.extend(chunk_findings);
                chunk_reviews.push(chunk_review.clone());
                let chunk_complete_event = AiReviewProgressEvent {
                    run_id: run_id_owned.clone(),
                    thread_id: input.thread_id,
                    status: "chunk-complete".to_string(),
                    message: format!(
                        "Completed {} chunk {} with {} finding(s).",
                        chunk.file_path,
                        chunk.chunk_index,
                        chunk_review.findings.len()
                    ),
                    total_chunks,
                    completed_chunks,
                    chunk_id: Some(chunk.id.clone()),
                    file_path: Some(chunk.file_path.clone()),
                    chunk_index: Some(chunk.chunk_index),
                    finding_count: Some(chunk_review.findings.len()),
                    chunk: Some(chunk_review),
                    finding: None,
                };
                if persist_progress {
                    if let Some(run_id) = run_id {
                        emit_and_persist_ai_review_progress(
                            app,
                            state,
                            run_id,
                            chunk_complete_event,
                        )
                        .await;
                    }
                } else {
                    emit_ai_review_progress(app, &chunk_complete_event);
                }
            }
            Ok(Err(worker_error)) => {
                completed_chunks += 1;
                failed_chunks += 1;
                let failed_event = AiReviewProgressEvent {
                    run_id: run_id_owned.clone(),
                    thread_id: input.thread_id,
                    status: "chunk-failed".to_string(),
                    message: format!(
                        "Chunk review failed for {} chunk {}: {}",
                        worker_error.chunk.file_path, worker_error.chunk.chunk_index, worker_error.message
                    ),
                    total_chunks,
                    completed_chunks,
                    chunk_id: Some(worker_error.chunk.id.clone()),
                    file_path: Some(worker_error.chunk.file_path.clone()),
                    chunk_index: Some(worker_error.chunk.chunk_index),
                    finding_count: None,
                    chunk: None,
                    finding: None,
                };
                if persist_progress {
                    if let Some(run_id) = run_id {
                        emit_and_persist_ai_review_progress(app, state, run_id, failed_event).await;
                    }
                } else {
                    emit_ai_review_progress(app, &failed_event);
                }
            }
            Err(join_error) => {
                completed_chunks += 1;
                failed_chunks += 1;
                let failed_event = AiReviewProgressEvent {
                    run_id: run_id_owned.clone(),
                    thread_id: input.thread_id,
                    status: "chunk-failed".to_string(),
                    message: format!("Chunk review worker failed: {join_error}"),
                    total_chunks,
                    completed_chunks,
                    chunk_id: None,
                    file_path: None,
                    chunk_index: None,
                    finding_count: None,
                    chunk: None,
                    finding: None,
                };
                if persist_progress {
                    if let Some(run_id) = run_id {
                        emit_and_persist_ai_review_progress(app, state, run_id, failed_event).await;
                    }
                } else {
                    emit_ai_review_progress(app, &failed_event);
                }
            }
        }
    }

    chunk_reviews.sort_by(|left, right| {
        left.file_path
            .cmp(&right.file_path)
            .then(left.chunk_index.cmp(&right.chunk_index))
    });
    findings.sort_by(|left, right| {
        left.file_path
            .cmp(&right.file_path)
            .then(left.line_number.cmp(&right.line_number))
            .then(left.id.cmp(&right.id))
    });

    let mut review =
        build_chunk_review_markdown(&reviewer_goal, &chunk_reviews, &findings, diff_truncated);
    if failed_chunks > 0 {
        review.push_str(&format!(
            "\n\n## Run Notes\n- {failed_chunks} chunk(s) failed during review and were skipped after retries."
        ));
    }
    persist_thread_message(state, input.thread_id, MessageRole::Assistant, &review).await?;

    let completed_status = if failed_chunks > 0 {
        "completed_with_errors"
    } else {
        "completed"
    };
    let completed_event = AiReviewProgressEvent {
        run_id: run_id_owned.clone(),
        thread_id: input.thread_id,
        status: completed_status.to_string(),
        message: format!(
            "Chunked review complete: {} chunk(s), {} finding(s), {} failed chunk(s).",
            total_chunks,
            findings.len(),
            failed_chunks
        ),
        total_chunks,
        completed_chunks,
        chunk_id: None,
        file_path: None,
        chunk_index: None,
        finding_count: Some(findings.len()),
        chunk: None,
        finding: None,
    };
    if persist_progress {
        if let Some(run_id) = run_id {
            emit_and_persist_ai_review_progress(app, state, run_id, completed_event).await;
        }
    } else {
        emit_ai_review_progress(app, &completed_event);
    }

    let diff_chars_used = if diff_truncated {
        diff_chars_used.min(diff_chars_total)
    } else {
        diff_chars_total
    };

    Ok(RunExecutionOutcome {
        result: GenerateAiReviewResult {
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
            chunks: chunk_reviews,
            findings,
        },
        failed_chunks,
    })
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
    let review_provider = match input.review_provider.trim().to_lowercase().as_str() {
        "openai" => "openai".to_string(),
        "opencode" => "opencode".to_string(),
        "app-server" | "app_server" | "codex" => "app-server".to_string(),
        _ => {
            return Err(
                "Review provider must be 'openai', 'opencode', or 'app-server'.".to_string(),
            )
        }
    };

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
pub async fn get_app_server_account_status() -> Result<AppServerAccountStatus, String> {
    let unavailable = |detail: String| AppServerAccountStatus {
        available: false,
        requires_openai_auth: false,
        account_type: None,
        email: None,
        plan_type: None,
        rate_limits: None,
        detail: Some(detail),
    };

    let command_name = env::var(ROVEX_APP_SERVER_COMMAND_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_APP_SERVER_COMMAND.to_string());

    let mut child = match TokioCommand::new(&command_name)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return Ok(unavailable(format!(
                "Failed to start Codex app-server with '{} app-server': {error}",
                command_name
            )))
        }
    };

    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Ok(unavailable(
                "Failed to open Codex app-server stdin.".to_string(),
            ));
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Ok(unavailable(
                "Failed to open Codex app-server stdout.".to_string(),
            ));
        }
    };
    let mut lines = BufReader::new(stdout).lines();

    let timeout_ms = parse_env_u64(
        ROVEX_REVIEW_TIMEOUT_MS_ENV,
        DEFAULT_APP_SERVER_STATUS_TIMEOUT_MS,
        500,
    );
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);

    let status_result: Result<AppServerAccountStatus, String> = async {
        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "clientInfo": {
                        "name": "rovex",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": {},
                }
            }),
        )
        .await?;
        let _ = wait_for_json_rpc_result(&mut lines, 1, deadline).await?;

        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "initialized",
                "params": {},
            }),
        )
        .await?;

        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "account/read",
                "params": {
                    "refreshToken": true,
                }
            }),
        )
        .await?;
        let account_result = wait_for_json_rpc_result(&mut lines, 2, deadline).await?;

        let requires_openai_auth = account_result
            .get("requiresOpenaiAuth")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let account = account_result
            .get("account")
            .and_then(|value| value.as_object());
        let account_type =
            parse_app_server_optional_string(account.and_then(|value| value.get("type")));
        let email = parse_app_server_optional_string(account.and_then(|value| value.get("email")));
        let account_plan_type =
            parse_app_server_optional_string(account.and_then(|value| value.get("planType")));

        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "account/rateLimits/read",
                "params": serde_json::Value::Null,
            }),
        )
        .await?;
        let (rate_limits, rate_limit_detail) =
            match wait_for_json_rpc_result(&mut lines, 3, deadline).await {
                Ok(rate_limits_result) => (
                    parse_app_server_rate_limits_result(&rate_limits_result),
                    None,
                ),
                Err(error) => (
                    None,
                    Some(format!("Unable to load Codex rate limits: {error}")),
                ),
            };

        let plan_type = account_plan_type.clone().or_else(|| {
            rate_limits
                .as_ref()
                .and_then(|limits| limits.plan_type.clone())
        });

        Ok(AppServerAccountStatus {
            available: true,
            requires_openai_auth,
            account_type,
            email,
            plan_type,
            rate_limits,
            detail: rate_limit_detail,
        })
    }
    .await;

    let _ = child.kill().await;
    let _ = child.wait().await;

    match status_result {
        Ok(status) => Ok(status),
        Err(error) => Ok(unavailable(error)),
    }
}

#[tauri::command]
pub async fn start_app_server_account_login() -> Result<AppServerLoginStartResult, String> {
    let command_name = env::var(ROVEX_APP_SERVER_COMMAND_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_APP_SERVER_COMMAND.to_string());

    let mut child = TokioCommand::new(&command_name)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start Codex app-server with '{} app-server': {error}",
                command_name
            )
        })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdout.".to_string())?;
    let mut lines = BufReader::new(stdout).lines();

    let timeout_ms = parse_env_u64(
        ROVEX_REVIEW_TIMEOUT_MS_ENV,
        DEFAULT_APP_SERVER_STATUS_TIMEOUT_MS,
        500,
    );
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);

    let login_result: Result<AppServerLoginStartResult, String> = async {
        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "clientInfo": {
                        "name": "rovex",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": {},
                }
            }),
        )
        .await?;
        let _ = wait_for_json_rpc_result(&mut lines, 1, deadline).await?;

        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "initialized",
                "params": {},
            }),
        )
        .await?;

        write_json_rpc_message(
            &mut stdin,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "account/login/start",
                "params": {
                    "type": "chatgpt",
                }
            }),
        )
        .await?;
        let result = wait_for_json_rpc_result(&mut lines, 2, deadline).await?;

        let login_id = parse_app_server_optional_string(result.get("loginId"))
            .ok_or_else(|| "Codex app-server did not return a login id.".to_string())?;
        let auth_url = parse_app_server_optional_string(result.get("authUrl"))
            .ok_or_else(|| "Codex app-server did not return an auth URL.".to_string())?;

        Ok(AppServerLoginStartResult { login_id, auth_url })
    }
    .await;

    let _ = child.kill().await;
    let _ = child.wait().await;

    login_result
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
pub async fn start_ai_review_run(
    app: AppHandle,
    state: State<'_, AppState>,
    input: StartAiReviewRunInput,
) -> Result<StartAiReviewRunResult, String> {
    let _ = load_thread_by_id(&state, input.thread_id).await?;
    let raw_diff = input.diff.trim();
    if raw_diff.is_empty() {
        return Err("There are no changes to review.".to_string());
    }
    let total_chunks = parse_diff_chunks(raw_diff).len();
    if total_chunks == 0 {
        return Err("No reviewable diff hunks were found in this diff.".to_string());
    }

    let reviewer_goal = if let Some(additional_focus) = as_non_empty_trimmed(input.prompt.as_deref())
    {
        format!(
            "{DEFAULT_REVIEWER_GOAL_PROMPT}\n\n---\n\nAdditional requested focus:\n{additional_focus}"
        )
    } else {
        DEFAULT_REVIEWER_GOAL_PROMPT.to_string()
    };

    let run_id = next_review_run_id();
    insert_ai_review_run(&state, &run_id, &input, &reviewer_goal, total_chunks).await?;
    let queued_event = AiReviewProgressEvent {
        run_id: Some(run_id.clone()),
        thread_id: input.thread_id,
        status: "queued".to_string(),
        message: "Review queued and waiting for an execution slot.".to_string(),
        total_chunks,
        completed_chunks: 0,
        chunk_id: None,
        file_path: None,
        chunk_index: None,
        finding_count: None,
        chunk: None,
        finding: None,
    };
    emit_and_persist_ai_review_progress(&app, &state, &run_id, queued_event).await;

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let cancel_notify = Arc::new(Notify::new());
    let completed_notify = Arc::new(Notify::new());
    {
        let mut runs = active_review_runs()
            .lock()
            .map_err(|_| "Failed to access active review runs.".to_string())?;
        runs.insert(
            run_id.clone(),
            ActiveRunHandle {
                cancel_flag: cancel_flag.clone(),
                cancel_notify: cancel_notify.clone(),
            },
        );
    }

    let app_handle = app.clone();
    let run_id_for_task = run_id.clone();
    let review_input = as_generate_ai_review_input(&input);
    tauri::async_runtime::spawn(async move {
        let acquire = review_run_slots().clone().acquire_owned();
        tokio::pin!(acquire);
        let permit = tokio::select! {
            _ = cancel_notify.notified() => {
                let state = app_handle.state::<AppState>();
                let _ = set_ai_review_run_status(&state, &run_id_for_task, "canceled", Some("Run canceled before execution."), false, true, true).await;
                let canceled_event = AiReviewProgressEvent {
                    run_id: Some(run_id_for_task.clone()),
                    thread_id: review_input.thread_id,
                    status: "canceled".to_string(),
                    message: "Run canceled before execution.".to_string(),
                    total_chunks,
                    completed_chunks: 0,
                    chunk_id: None,
                    file_path: None,
                    chunk_index: None,
                    finding_count: None,
                    chunk: None,
                    finding: None,
                };
                emit_and_persist_ai_review_progress(&app_handle, &state, &run_id_for_task, canceled_event).await;
                if let Ok(mut runs) = active_review_runs().lock() {
                    runs.remove(&run_id_for_task);
                }
                completed_notify.notify_waiters();
                return;
            }
            permit = &mut acquire => permit,
        };
        let Ok(permit) = permit else {
            if let Ok(mut runs) = active_review_runs().lock() {
                runs.remove(&run_id_for_task);
            }
            completed_notify.notify_waiters();
            return;
        };
        let _permit = permit;

        let state = app_handle.state::<AppState>();

        if cancel_flag.load(Ordering::Relaxed) {
            let _ = set_ai_review_run_status(
                &state,
                &run_id_for_task,
                "canceled",
                Some("Run canceled before execution."),
                false,
                true,
                true,
            )
            .await;
            if let Ok(mut runs) = active_review_runs().lock() {
                runs.remove(&run_id_for_task);
            }
            completed_notify.notify_waiters();
            return;
        }

        let _ = set_ai_review_run_status(
            &state,
            &run_id_for_task,
            "running",
            None,
            true,
            false,
            false,
        )
        .await;

        let outcome = execute_ai_review_generation(
            &app_handle,
            &state,
            &review_input,
            Some(&run_id_for_task),
            Some(&cancel_flag),
            true,
        )
        .await;

        match outcome {
            Ok(outcome) => {
                let status = if outcome.failed_chunks > 0 {
                    "completed_with_errors"
                } else {
                    "completed"
                };
                let _ = finalize_ai_review_run(&state, &run_id_for_task, &outcome.result, status, None)
                    .await;
            }
            Err(error) => {
                if error.to_lowercase().contains("canceled") {
                    let _ = set_ai_review_run_status(
                        &state,
                        &run_id_for_task,
                        "canceled",
                        Some(error.as_str()),
                        false,
                        true,
                        true,
                    )
                    .await;
                    let canceled_event = AiReviewProgressEvent {
                        run_id: Some(run_id_for_task.clone()),
                        thread_id: review_input.thread_id,
                        status: "canceled".to_string(),
                        message: error.clone(),
                        total_chunks,
                        completed_chunks: 0,
                        chunk_id: None,
                        file_path: None,
                        chunk_index: None,
                        finding_count: None,
                        chunk: None,
                        finding: None,
                    };
                    emit_and_persist_ai_review_progress(
                        &app_handle,
                        &state,
                        &run_id_for_task,
                        canceled_event,
                    )
                    .await;
                } else {
                    let _ = set_ai_review_run_status(
                        &state,
                        &run_id_for_task,
                        "failed",
                        Some(error.as_str()),
                        false,
                        true,
                        false,
                    )
                    .await;
                    let failed_event = AiReviewProgressEvent {
                        run_id: Some(run_id_for_task.clone()),
                        thread_id: review_input.thread_id,
                        status: "failed".to_string(),
                        message: error.clone(),
                        total_chunks,
                        completed_chunks: 0,
                        chunk_id: None,
                        file_path: None,
                        chunk_index: None,
                        finding_count: None,
                        chunk: None,
                        finding: None,
                    };
                    emit_and_persist_ai_review_progress(
                        &app_handle,
                        &state,
                        &run_id_for_task,
                        failed_event,
                    )
                    .await;
                }
            }
        }

        if let Ok(mut runs) = active_review_runs().lock() {
            runs.remove(&run_id_for_task);
        }
        completed_notify.notify_waiters();
    });

    let run = load_ai_review_run_by_id(&state, &run_id).await?;
    Ok(StartAiReviewRunResult { run })
}

#[tauri::command]
pub async fn cancel_ai_review_run(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CancelAiReviewRunInput,
) -> Result<CancelAiReviewRunResult, String> {
    let run_id = input.run_id.trim();
    if run_id.is_empty() {
        return Err("Run id must not be empty.".to_string());
    }

    let run = load_ai_review_run_by_id(&state, run_id).await?;
    let active = active_review_runs()
        .lock()
        .map_err(|_| "Failed to access active review runs.".to_string())?
        .get(run_id)
        .cloned();

    if let Some(active) = active {
        active.cancel_flag.store(true, Ordering::Relaxed);
        active.cancel_notify.notify_waiters();
        if run.status == "queued" {
            set_ai_review_run_status(
                &state,
                run_id,
                "canceled",
                Some("Run canceled before execution."),
                false,
                true,
                true,
            )
            .await?;
            let canceled_event = AiReviewProgressEvent {
                run_id: Some(run_id.to_string()),
                thread_id: run.thread_id,
                status: "canceled".to_string(),
                message: "Run canceled before execution.".to_string(),
                total_chunks: run.total_chunks,
                completed_chunks: run.completed_chunks,
                chunk_id: None,
                file_path: None,
                chunk_index: None,
                finding_count: Some(run.finding_count),
                chunk: None,
                finding: None,
            };
            emit_and_persist_ai_review_progress(&app, &state, run_id, canceled_event).await;
        }
        let status = if run.status == "queued" {
            "canceled".to_string()
        } else {
            "canceling".to_string()
        };
        return Ok(CancelAiReviewRunResult {
            run_id: run_id.to_string(),
            canceled: true,
            status,
        });
    }

    Ok(CancelAiReviewRunResult {
        run_id: run_id.to_string(),
        canceled: false,
        status: run.status,
    })
}

#[tauri::command]
pub async fn list_ai_review_runs(
    state: State<'_, AppState>,
    input: ListAiReviewRunsInput,
) -> Result<ListAiReviewRunsResult, String> {
    let runs = list_ai_review_runs_internal(&state, input.thread_id, input.limit).await?;
    Ok(ListAiReviewRunsResult { runs })
}

#[tauri::command]
pub async fn get_ai_review_run(
    state: State<'_, AppState>,
    input: GetAiReviewRunInput,
) -> Result<AiReviewRun, String> {
    let run_id = input.run_id.trim();
    if run_id.is_empty() {
        return Err("Run id must not be empty.".to_string());
    }
    load_ai_review_run_by_id(&state, run_id).await
}

#[tauri::command]
pub async fn generate_ai_review(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateAiReviewInput,
) -> Result<GenerateAiReviewResult, String> {
    let outcome = execute_ai_review_generation(&app, &state, &input, None, None, false).await?;
    Ok(outcome.result)
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
        ReviewProvider::AppServer => {
            generate_review_with_app_server(&workspace, &follow_up_prompt, timeout_ms, &model)
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

    let upstream_branch = if let Some(current_branch_name) = current_branch.as_deref() {
        let current_branch_ref = format!("refs/heads/{current_branch_name}");
        let upstream = run_git_trimmed(
            &repo_path,
            &[
                "for-each-ref",
                "--format=%(upstream:short)",
                current_branch_ref.as_str(),
            ],
            "resolve branch upstream",
        )?;
        if upstream.is_empty() {
            None
        } else {
            Some(upstream)
        }
    } else {
        None
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
        ref_sort_priority(left)
            .cmp(&ref_sort_priority(right))
            .then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
    });
    branch_names.dedup();

    let remote_branch_output = run_git(
        &repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
        "for-each-ref remotes",
    )?;
    let raw_remote_branches = String::from_utf8_lossy(&remote_branch_output.stdout);
    let mut remote_branch_names: Vec<String> = raw_remote_branches
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.ends_with("/HEAD"))
        .map(ToOwned::to_owned)
        .collect();
    remote_branch_names.sort_by(|left, right| {
        ref_sort_priority(left)
            .cmp(&ref_sort_priority(right))
            .then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
    });
    remote_branch_names.dedup();

    let suggested_base_ref = resolve_suggested_base_ref(
        &repo_path,
        upstream_branch.as_deref(),
        &remote_branch_names,
        &branch_names,
    );

    let branches = branch_names
        .into_iter()
        .map(|name| WorkspaceBranch {
            is_current: current_branch.as_deref() == Some(name.as_str()),
            name,
        })
        .collect();

    let remote_branches = remote_branch_names
        .into_iter()
        .map(|name| WorkspaceBranch {
            is_current: upstream_branch.as_deref() == Some(name.as_str()),
            name,
        })
        .collect();

    Ok(ListWorkspaceBranchesResult {
        workspace: format_path(&repo_path),
        current_branch,
        branches,
        upstream_branch,
        remote_branches,
        suggested_base_ref,
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
