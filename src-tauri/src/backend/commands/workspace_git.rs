use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::Instant,
};

use tauri::State;

use super::super::providers::provider_client;
use super::common::{
    format_path, truncate_utf8_by_bytes, COMPARE_ENABLE_RENAMES, DEFAULT_REPOSITORIES_DIR,
    MAX_COMPARE_DIFF_BYTES,
};
use super::providers::load_provider_connection_row;
use crate::backend::{
    AppState, CheckoutWorkspaceBranchInput, CheckoutWorkspaceBranchResult, CloneRepositoryInput,
    CloneRepositoryResult, CompareWorkspaceDiffInput, CompareWorkspaceDiffProfile,
    CompareWorkspaceDiffResult, CreateWorkspaceBranchInput, ListWorkspaceBranchesInput,
    ListWorkspaceBranchesResult, WorkspaceBranch,
};

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
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
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

pub(crate) fn resolve_base_ref(
    repo_path: &Path,
    requested_base_ref: &str,
) -> Result<String, String> {
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

pub async fn compare_workspace_diff(
    input: CompareWorkspaceDiffInput,
) -> Result<CompareWorkspaceDiffResult, String> {
    let started_at = Instant::now();
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
    let mut fetch_origin_ms = None;
    if should_fetch_origin {
        let fetch_started_at = Instant::now();
        run_git(&repo_path, &["fetch", "--quiet", "origin"], "fetch origin")?;
        fetch_origin_ms = Some(fetch_started_at.elapsed().as_millis() as u64);
    }

    let resolve_base_ref_started_at = Instant::now();
    let base_ref = resolve_base_ref(&repo_path, requested_base_ref)?;
    let resolve_base_ref_ms = resolve_base_ref_started_at.elapsed().as_millis() as u64;

    let resolve_head_started_at = Instant::now();
    let head = run_git_trimmed(&repo_path, &["rev-parse", "HEAD"], "resolve HEAD")?;
    let resolve_head_ms = resolve_head_started_at.elapsed().as_millis() as u64;

    let resolve_merge_base_started_at = Instant::now();
    let merge_base = run_git_trimmed(
        &repo_path,
        &["merge-base", "HEAD", base_ref.as_str()],
        "resolve merge-base",
    )?;
    let resolve_merge_base_ms = resolve_merge_base_started_at.elapsed().as_millis() as u64;

    let mut diff_args = vec![
        "diff",
        "--merge-base",
        base_ref.as_str(),
        "--no-color",
        "--no-ext-diff",
        "--patch",
    ];
    if COMPARE_ENABLE_RENAMES {
        diff_args.push("--find-renames");
    } else {
        diff_args.push("--no-renames");
    }

    let diff_started_at = Instant::now();
    let diff_output = run_git(&repo_path, &diff_args, "diff")?;
    let diff_ms = diff_started_at.elapsed().as_millis() as u64;
    let raw_diff = String::from_utf8_lossy(&diff_output.stdout).to_string();
    let diff_bytes_total = raw_diff.len();
    let (diff, diff_truncated) = truncate_utf8_by_bytes(&raw_diff, MAX_COMPARE_DIFF_BYTES);
    let diff_bytes_used = diff.len();

    let numstat_started_at = Instant::now();
    let numstat_output = run_git(
        &repo_path,
        &["diff", "--merge-base", base_ref.as_str(), "--numstat"],
        "diff --numstat",
    )?;
    let numstat_ms = numstat_started_at.elapsed().as_millis() as u64;
    let numstat = String::from_utf8_lossy(&numstat_output.stdout);
    let (files_changed, insertions, deletions) = parse_numstat(&numstat);
    let total_ms = started_at.elapsed().as_millis() as u64;

    let profile = CompareWorkspaceDiffProfile {
        fetch_origin_ms,
        resolve_base_ref_ms,
        resolve_head_ms,
        resolve_merge_base_ms,
        diff_ms,
        numstat_ms,
        total_ms,
    };

    Ok(CompareWorkspaceDiffResult {
        workspace: format_path(&repo_path),
        base_ref,
        merge_base,
        head,
        diff,
        files_changed,
        insertions,
        deletions,
        diff_truncated,
        diff_bytes_used,
        diff_bytes_total,
        profile,
    })
}

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
