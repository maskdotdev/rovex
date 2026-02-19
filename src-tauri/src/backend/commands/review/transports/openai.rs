use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Serialize;

use super::super::super::common::{snippet, OPENAI_API_KEY_ENV};

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

pub(crate) async fn generate_review_with_openai(
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

pub(crate) async fn generate_chunk_with_openai(
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
