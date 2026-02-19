use std::env;

use tauri::{AppHandle, State};

use super::super::common::{
    as_non_empty_trimmed, parse_env_u64, parse_env_usize, truncate_chars,
    DEFAULT_FOLLOW_UP_HISTORY_CHARS, DEFAULT_REVIEW_BASE_URL, DEFAULT_REVIEW_MODEL,
    DEFAULT_REVIEW_TIMEOUT_MS, MAX_FOLLOW_UP_MESSAGES, OPENAI_API_KEY_ENV,
    ROVEX_REVIEW_BASE_URL_ENV, ROVEX_REVIEW_MAX_DIFF_CHARS_ENV, ROVEX_REVIEW_MODEL_ENV,
    ROVEX_REVIEW_TIMEOUT_MS_ENV,
};
use super::super::threads::{
    load_recent_thread_messages, load_thread_by_id, persist_thread_message,
};
use super::transports::{app_server, openai, opencode};
use super::ReviewProvider;
use crate::backend::{
    AppState, GenerateAiFollowUpInput, GenerateAiFollowUpResult, Message, MessageRole, Thread,
};

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

            let answer = openai::generate_review_with_openai(
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
            opencode::generate_review_with_opencode(
                &app,
                &workspace,
                &follow_up_prompt,
                timeout_ms,
                &model,
            )
            .await?
        }
        ReviewProvider::AppServer => {
            app_server::generate_review_with_app_server(
                &workspace,
                &follow_up_prompt,
                timeout_ms,
                &model,
            )
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
