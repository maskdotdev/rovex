use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
};

use tauri::{AppHandle, Manager, State};
use tokio::sync::{Notify, Semaphore};

use super::super::common::{as_non_empty_trimmed, MAX_PARALLEL_REVIEW_RUNS};
use super::super::threads::load_thread_by_id;
use super::diff_chunks::parse_diff_file_chunks;
use super::emit_and_persist_ai_review_progress;
use super::{executor, store};
use crate::backend::{
    AiReviewProgressEvent, AiReviewRun, AppState, CancelAiReviewRunInput, CancelAiReviewRunResult,
    CreateInlineReviewCommentInput, GetAiReviewRunInput, InlineReviewComment,
    ListAiReviewRunsInput, ListAiReviewRunsResult, ListInlineReviewCommentsInput,
    ListInlineReviewCommentsResult, StartAiReviewRunInput, StartAiReviewRunResult,
};

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
    let total_chunks = parse_diff_file_chunks(raw_diff).len();
    if total_chunks == 0 {
        return Err("No reviewable changed files were found in this diff.".to_string());
    }

    let reviewer_goal = as_non_empty_trimmed(input.prompt.as_deref())
        .unwrap_or_else(|| "Review changed files and report actionable bugs.".to_string());

    let run_id = next_review_run_id();
    store::insert_ai_review_run(&state, &run_id, &input, &reviewer_goal, total_chunks).await?;
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
    let review_input = executor::as_generate_ai_review_input(&input);
    tauri::async_runtime::spawn(async move {
        let acquire = review_run_slots().clone().acquire_owned();
        tokio::pin!(acquire);
        let permit = tokio::select! {
            _ = cancel_notify.notified() => {
                let state = app_handle.state::<AppState>();
                let _ = store::set_ai_review_run_status(&state, &run_id_for_task, "canceled", Some("Run canceled before execution."), false, true, true).await;
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
            let _ = store::set_ai_review_run_status(
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

        let _ = store::set_ai_review_run_status(
            &state,
            &run_id_for_task,
            "running",
            None,
            true,
            false,
            false,
        )
        .await;

        let outcome = executor::execute_ai_review_generation(
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
                let status = if outcome.had_errors {
                    "completed_with_errors"
                } else {
                    "completed"
                };
                let _ = store::finalize_ai_review_run(
                    &state,
                    &run_id_for_task,
                    &outcome.result,
                    status,
                    None,
                )
                .await;
            }
            Err(error) => {
                if error.to_lowercase().contains("canceled") {
                    let _ = store::set_ai_review_run_status(
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
                    let _ = store::set_ai_review_run_status(
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

    let run = store::load_ai_review_run_by_id(&state, &run_id).await?;
    Ok(StartAiReviewRunResult { run })
}

pub async fn cancel_ai_review_run(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CancelAiReviewRunInput,
) -> Result<CancelAiReviewRunResult, String> {
    let run_id = input.run_id.trim();
    if run_id.is_empty() {
        return Err("Run id must not be empty.".to_string());
    }

    let run = store::load_ai_review_run_by_id(&state, run_id).await?;
    let active = active_review_runs()
        .lock()
        .map_err(|_| "Failed to access active review runs.".to_string())?
        .get(run_id)
        .cloned();

    if let Some(active) = active {
        active.cancel_flag.store(true, Ordering::Relaxed);
        active.cancel_notify.notify_waiters();
        if run.status == "queued" {
            store::set_ai_review_run_status(
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

pub async fn list_ai_review_runs(
    state: State<'_, AppState>,
    input: ListAiReviewRunsInput,
) -> Result<ListAiReviewRunsResult, String> {
    let runs = store::list_ai_review_runs_internal(&state, input.thread_id, input.limit).await?;
    Ok(ListAiReviewRunsResult { runs })
}

pub async fn get_ai_review_run(
    state: State<'_, AppState>,
    input: GetAiReviewRunInput,
) -> Result<AiReviewRun, String> {
    let run_id = input.run_id.trim();
    if run_id.is_empty() {
        return Err("Run id must not be empty.".to_string());
    }
    store::load_ai_review_run_by_id(&state, run_id).await
}

pub async fn create_inline_review_comment(
    state: State<'_, AppState>,
    input: CreateInlineReviewCommentInput,
) -> Result<InlineReviewComment, String> {
    let _ = load_thread_by_id(&state, input.thread_id).await?;
    store::insert_inline_review_comment(&state, &input).await
}

pub async fn list_inline_review_comments(
    state: State<'_, AppState>,
    input: ListInlineReviewCommentsInput,
) -> Result<ListInlineReviewCommentsResult, String> {
    let _ = load_thread_by_id(&state, input.thread_id).await?;
    let comments = store::list_inline_review_comments_internal(&state, &input).await?;
    Ok(ListInlineReviewCommentsResult { comments })
}
