use std::env;

use super::super::common::{
    current_ai_review_config, resolve_env_file_path, upsert_env_key, DEFAULT_OPENCODE_PROVIDER,
    OPENAI_API_KEY_ENV, ROVEX_OPENCODE_MODEL_ENV, ROVEX_OPENCODE_PROVIDER_ENV,
    ROVEX_REVIEW_MODEL_ENV, ROVEX_REVIEW_PROVIDER_ENV,
};
use crate::backend::{AiReviewConfig, SetAiReviewApiKeyInput, SetAiReviewSettingsInput};

pub async fn get_ai_review_config() -> Result<AiReviewConfig, String> {
    Ok(current_ai_review_config())
}

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
