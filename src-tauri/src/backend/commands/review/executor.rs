use std::{
    collections::VecDeque,
    env,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use tauri::{AppHandle, State};
use tokio::{sync::mpsc, task::JoinSet};

use super::super::common::{
    as_non_empty_trimmed, parse_env_u64, parse_env_usize, snippet, truncate_chars,
    CHUNK_RETRY_BASE_DELAY_MS, CHUNK_RETRY_MAX_ATTEMPTS, DEFAULT_REVIEW_BASE_URL,
    DEFAULT_REVIEW_MAX_DIFF_CHARS, DEFAULT_REVIEW_MODEL, DEFAULT_REVIEW_TIMEOUT_MS,
    MAX_PARALLEL_CHUNKS_PER_RUN, OPENAI_API_KEY_ENV, ROVEX_REVIEW_BASE_URL_ENV,
    ROVEX_REVIEW_MAX_DIFF_CHARS_ENV, ROVEX_REVIEW_MODEL_ENV, ROVEX_REVIEW_TIMEOUT_MS_ENV,
};
use super::super::threads::{load_thread_by_id, persist_thread_message};
use super::diff_chunks::{
    build_chunk_review_prompt, format_workspace_file_context, normalize_annotation_side,
    normalize_severity, parse_chunk_review_payload, parse_diff_file_chunks,
    resolve_line_number_for_chunk, DiffChunk,
};
use super::transports::{app_server, openai, opencode};
use super::{emit_ai_review_progress, emit_and_persist_ai_review_progress, ReviewProvider};
use crate::backend::{
    AiReviewChunk, AiReviewFinding, AiReviewProgressEvent, AppState, GenerateAiReviewInput,
    GenerateAiReviewResult, MessageRole, StartAiReviewRunInput,
};

struct ChunkWorkerResult {
    chunk: DiffChunk,
    raw_chunk_review: String,
    model: String,
}

struct ChunkWorkerError {
    chunk: DiffChunk,
    message: String,
}

pub(crate) struct RunExecutionOutcome {
    pub(crate) result: GenerateAiReviewResult,
    pub(crate) had_errors: bool,
}

fn build_description_review_prompt(
    reviewer_goal: &str,
    workspace: &str,
    base_ref: &str,
    merge_base: &str,
    head: &str,
    diff_for_review: &str,
    diff_truncated: bool,
) -> String {
    format!(
        "Write a high-level code review description for this change set.\n\nFocus: {reviewer_goal}\nWorkspace: {workspace}\nBase ref: {base_ref}\nMerge base: {merge_base}\nHead: {head}\nDiff content truncated: {}\n\nReturn markdown with sections:\n1) Overview\n2) Important files\n3) Top risks\n4) Recommended next checks\n\nRules:\n- Keep this as a concise high-level narrative, not a per-file issue list.\n- Mention only the most important files and changes.\n- Avoid style nits.\n\nUnified diff:\n```diff\n{diff_for_review}\n```",
        if diff_truncated { "yes" } else { "no" }
    )
}

async fn generate_description_review_with_streaming<F>(
    app: &AppHandle,
    provider: ReviewProvider,
    workspace: &str,
    model: &str,
    timeout_ms: u64,
    openai_api_key: Option<&str>,
    openai_base_url: Option<&str>,
    prompt: &str,
    on_delta: &mut F,
) -> Result<(String, String), String>
where
    F: FnMut(&str),
{
    match provider {
        ReviewProvider::OpenAi => {
            let api_key = openai_api_key.ok_or_else(|| {
                format!("Missing {OPENAI_API_KEY_ENV}. Add it to .env to enable AI review.")
            })?;
            let base_url = openai_base_url.unwrap_or(DEFAULT_REVIEW_BASE_URL);
            let review = openai::generate_review_with_openai_streaming(
                model, base_url, timeout_ms, api_key, prompt, on_delta,
            )
            .await?;
            Ok((review, model.to_string()))
        }
        ReviewProvider::Opencode => {
            let (review, resolved_model) =
                opencode::generate_review_with_opencode(app, workspace, prompt, timeout_ms, model)
                    .await?;
            if !review.is_empty() {
                for token in review.split_inclusive(char::is_whitespace) {
                    on_delta(token);
                }
            }
            Ok((review, resolved_model))
        }
        ReviewProvider::AppServer => {
            app_server::generate_review_with_app_server_streaming(
                workspace, prompt, timeout_ms, model, on_delta,
            )
            .await
        }
    }
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
                openai::generate_chunk_with_openai(model, base_url, timeout_ms, api_key, prompt)
                    .await?;
            Ok((review, model.to_string()))
        }
        ReviewProvider::Opencode => {
            opencode::generate_review_with_opencode(app, workspace, prompt, timeout_ms, model).await
        }
        ReviewProvider::AppServer => {
            app_server::generate_review_with_app_server(workspace, prompt, timeout_ms, model).await
        }
    }
}

pub(crate) fn is_transient_chunk_error(message: &str) -> bool {
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

pub(crate) fn as_generate_ai_review_input(input: &StartAiReviewRunInput) -> GenerateAiReviewInput {
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

pub(crate) async fn execute_ai_review_generation(
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
    let diff_chunks = parse_diff_file_chunks(raw_diff);
    if diff_chunks.is_empty() {
        return Err("No reviewable changed files were found in this diff.".to_string());
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

    let reviewer_goal = as_non_empty_trimmed(input.prompt.as_deref()).unwrap_or_else(|| {
        "Review the changed files and report real bugs with actionable fixes.".to_string()
    });
    let request_summary = as_non_empty_trimmed(input.prompt.as_deref())
        .map(|focus| format!("AI review request. Focus: {focus}"))
        .unwrap_or_else(|| "AI review request for current diff.".to_string());

    persist_thread_message(state, input.thread_id, MessageRole::User, &request_summary).await?;

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
    let (description_diff_for_review, description_diff_truncated) =
        truncate_chars(raw_diff, max_diff_chars);
    diff_truncated |= description_diff_truncated;
    let description_prompt = build_description_review_prompt(
        &reviewer_goal,
        workspace,
        base_ref,
        merge_base,
        head,
        &description_diff_for_review,
        description_diff_truncated,
    );

    let started_event = AiReviewProgressEvent {
        run_id: run_id_owned.clone(),
        thread_id: input.thread_id,
        status: "started".to_string(),
        message: format!(
            "Started review. Description stream and file issue checks are running for {} file(s).",
            total_chunks
        ),
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

    let description_started_event = AiReviewProgressEvent {
        run_id: run_id_owned.clone(),
        thread_id: input.thread_id,
        status: "description-start".to_string(),
        message: "Generating high-level description...".to_string(),
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
            emit_and_persist_ai_review_progress(app, state, run_id, description_started_event)
                .await;
        }
    } else {
        emit_ai_review_progress(app, &description_started_event);
    }

    let (description_tx, mut description_rx) = mpsc::unbounded_channel::<String>();
    let app_for_description = app.clone();
    let workspace_for_description = workspace.to_string();
    let model_for_description = model.clone();
    let prompt_for_description = description_prompt.clone();
    let openai_api_key_for_description = openai_api_key.clone();
    let openai_base_url_for_description = openai_base_url.clone();
    let description_provider = review_provider;
    let mut description_task = tokio::spawn(async move {
        let sender = description_tx;
        let mut on_delta = move |delta: &str| {
            if !delta.is_empty() {
                let _ = sender.send(delta.to_string());
            }
        };
        generate_description_review_with_streaming(
            &app_for_description,
            description_provider,
            &workspace_for_description,
            &model_for_description,
            timeout_ms,
            openai_api_key_for_description.as_deref(),
            openai_base_url_for_description.as_deref(),
            &prompt_for_description,
            &mut on_delta,
        )
        .await
    });
    let mut description_task_done = false;
    let mut description_stream_open = true;
    let mut description_text = String::new();
    let mut description_model: Option<String> = None;
    let mut description_error: Option<String> = None;

    let mut join_set: JoinSet<Result<ChunkWorkerResult, ChunkWorkerError>> = JoinSet::new();

    while !prepared_chunks.is_empty()
        || !join_set.is_empty()
        || !description_task_done
        || description_stream_open
    {
        if cancel_flag
            .map(|flag| flag.load(Ordering::Relaxed))
            .unwrap_or(false)
        {
            join_set.abort_all();
            if !description_task_done {
                description_task.abort();
            }
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
                    "Reviewing {} (file {} of {}).",
                    chunk_for_event.file_path, chunk_for_event.chunk_index, total_chunks
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
                    emit_and_persist_ai_review_progress(app, state, run_id, chunk_start_event)
                        .await;
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

        tokio::select! {
            maybe_delta = description_rx.recv(), if description_stream_open => {
                match maybe_delta {
                    Some(delta) => {
                        description_text.push_str(&delta);
                        let delta_event = AiReviewProgressEvent {
                            run_id: run_id_owned.clone(),
                            thread_id: input.thread_id,
                            status: "description-delta".to_string(),
                            message: delta,
                            total_chunks,
                            completed_chunks,
                            chunk_id: None,
                            file_path: None,
                            chunk_index: None,
                            finding_count: Some(findings.len()),
                            chunk: None,
                            finding: None,
                        };
                        emit_ai_review_progress(app, &delta_event);
                    }
                    None => {
                        description_stream_open = false;
                    }
                }
            }
            description_result = &mut description_task, if !description_task_done => {
                description_task_done = true;
                match description_result {
                    Ok(Ok((review, model_used))) => {
                        if description_text.trim().is_empty() {
                            description_text = review;
                        }
                        description_model = Some(model_used);
                        let description_complete_event = AiReviewProgressEvent {
                            run_id: run_id_owned.clone(),
                            thread_id: input.thread_id,
                            status: "description-complete".to_string(),
                            message: "Generated high-level description.".to_string(),
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
                                emit_and_persist_ai_review_progress(
                                    app,
                                    state,
                                    run_id,
                                    description_complete_event,
                                )
                                .await;
                            }
                        } else {
                            emit_ai_review_progress(app, &description_complete_event);
                        }
                    }
                    Ok(Err(error)) => {
                        description_error = Some(error.clone());
                        let description_failed_event = AiReviewProgressEvent {
                            run_id: run_id_owned.clone(),
                            thread_id: input.thread_id,
                            status: "description-failed".to_string(),
                            message: format!("Description stream failed: {}", snippet(error.trim(), 300)),
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
                                emit_and_persist_ai_review_progress(
                                    app,
                                    state,
                                    run_id,
                                    description_failed_event,
                                )
                                .await;
                            }
                        } else {
                            emit_ai_review_progress(app, &description_failed_event);
                        }
                    }
                    Err(join_error) => {
                        let message = format!("Description stream worker failed: {join_error}");
                        description_error = Some(message.clone());
                        let description_failed_event = AiReviewProgressEvent {
                            run_id: run_id_owned.clone(),
                            thread_id: input.thread_id,
                            status: "description-failed".to_string(),
                            message,
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
                                emit_and_persist_ai_review_progress(
                                    app,
                                    state,
                                    run_id,
                                    description_failed_event,
                                )
                                .await;
                            }
                        } else {
                            emit_ai_review_progress(app, &description_failed_event);
                        }
                    }
                }
            }
            join_result = join_set.join_next(), if !join_set.is_empty() => {
                let Some(join_result) = join_result else {
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
                            for (finding_index, payload_finding) in payload_findings.into_iter().enumerate()
                            {
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
                                    .unwrap_or_else(|| {
                                        "Potential issue detected in this diff chunk.".to_string()
                                    });
                                let side =
                                    normalize_annotation_side(payload_finding.side.as_deref()).to_string();
                                let line_number = resolve_line_number_for_chunk(
                                    &chunk,
                                    &side,
                                    payload_finding.line_number.or(payload_finding.line),
                                );
                                let Some(line_number) = line_number else {
                                    continue;
                                };

                                let finding = AiReviewFinding {
                                    id: format!(
                                        "{}:{}:{}:{}",
                                        chunk.id,
                                        side,
                                        line_number,
                                        finding_index + 1
                                    ),
                                    file_path: chunk.file_path.clone(),
                                    chunk_id: chunk.id.clone(),
                                    chunk_index: chunk.chunk_index,
                                    hunk_header: chunk.hunk_header.clone(),
                                    side: side.clone(),
                                    line_number,
                                    title,
                                    body,
                                    severity: normalize_severity(payload_finding.severity.as_deref())
                                        .to_string(),
                                    confidence: payload_finding
                                        .confidence
                                        .map(|value| value.clamp(0.0, 1.0)),
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
                                "Completed {} with {} finding(s).",
                                chunk.file_path,
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
                        let condensed_error = snippet(worker_error.message.trim(), 320);
                        let failed_event = AiReviewProgressEvent {
                            run_id: run_id_owned.clone(),
                            thread_id: input.thread_id,
                            status: "chunk-failed".to_string(),
                            message: format!(
                                "File review failed for {} (file {}): {}",
                                worker_error.chunk.file_path,
                                worker_error.chunk.chunk_index,
                                condensed_error
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

    let mut review = description_text.trim().to_string();
    if review.is_empty() {
        review = format!(
            "Analyzed {} file(s). Found {} issue(s).",
            total_chunks,
            findings.len()
        );
    }
    if failed_chunks > 0 || description_error.is_some() {
        review.push_str("\n\n## Run Notes");
        if failed_chunks > 0 {
            review.push_str(&format!(
                "\n- {failed_chunks} file(s) failed during issue checks and were skipped after retries."
            ));
        }
        if let Some(error) = description_error.as_ref() {
            review.push_str(&format!(
                "\n- High-level description stream failed: {}",
                snippet(error.trim(), 240)
            ));
        }
    }
    persist_thread_message(state, input.thread_id, MessageRole::Assistant, &review).await?;

    let had_errors = failed_chunks > 0 || description_error.is_some();
    let completed_status = if had_errors {
        "completed_with_errors"
    } else {
        "completed"
    };
    let completed_event = AiReviewProgressEvent {
        run_id: run_id_owned.clone(),
        thread_id: input.thread_id,
        status: completed_status.to_string(),
        message: format!(
            "File review complete: {} file(s), {} finding(s), {} failed file(s).",
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
            model: description_model.unwrap_or(resolved_model),
            review,
            diff_chars_used,
            diff_chars_total,
            diff_truncated,
            chunks: chunk_reviews,
            findings,
        },
        had_errors,
    })
}

pub async fn generate_ai_review(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateAiReviewInput,
) -> Result<GenerateAiReviewResult, String> {
    let outcome = execute_ai_review_generation(&app, &state, &input, None, None, false).await?;
    Ok(outcome.result)
}
