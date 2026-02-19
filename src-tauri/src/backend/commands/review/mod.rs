pub(crate) mod config;
pub(crate) mod diff_chunks;
pub(crate) mod executor;
#[cfg(test)]
mod executor_tests;
pub(crate) mod follow_up;
pub(crate) mod run_queue;
pub(crate) mod store;
pub(crate) mod transports;

use std::env;

use tauri::{AppHandle, Emitter};

use self::store::append_ai_review_run_progress;
use super::common::{AI_REVIEW_PROGRESS_EVENT, DEFAULT_REVIEW_PROVIDER, ROVEX_REVIEW_PROVIDER_ENV};
use crate::backend::{AiReviewProgressEvent, AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewProvider {
    OpenAi,
    Opencode,
    AppServer,
}

impl ReviewProvider {
    pub(crate) fn from_env() -> Result<Self, String> {
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
pub(crate) fn emit_ai_review_progress(app: &AppHandle, event: &AiReviewProgressEvent) {
    let _ = app.emit(AI_REVIEW_PROGRESS_EVENT, event);
}

pub(crate) async fn emit_and_persist_ai_review_progress(
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
