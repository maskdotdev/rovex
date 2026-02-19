use std::{env, time::Duration};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

use super::super::super::common::{
    parse_env_u16, parse_env_u64, snippet, DEFAULT_OPENCODE_AGENT, DEFAULT_OPENCODE_HOSTNAME,
    DEFAULT_OPENCODE_MODEL, DEFAULT_OPENCODE_PORT, DEFAULT_OPENCODE_PROVIDER,
    DEFAULT_OPENCODE_SERVER_TIMEOUT_MS, DEFAULT_REVIEW_MODEL, OPENCODE_SIDECAR_NAME,
    ROVEX_OPENCODE_AGENT_ENV, ROVEX_OPENCODE_HOSTNAME_ENV, ROVEX_OPENCODE_MODEL_ENV,
    ROVEX_OPENCODE_PORT_ENV, ROVEX_OPENCODE_PROVIDER_ENV, ROVEX_OPENCODE_SERVER_TIMEOUT_MS_ENV,
};
use crate::backend::OpencodeSidecarStatus;

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

pub(crate) async fn generate_review_with_opencode(
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

#[cfg(test)]
mod tests {
    use super::{
        extract_latest_assistant_review_from_messages_body, extract_opencode_review_from_body,
    };

    #[test]
    fn extracts_opencode_review_from_sse_body() {
        let body = r#"data: {"parts":[{"type":"text","text":"Found bug A"}]}
data: {"parts":[{"type":"text","text":"Found bug B"}]}
data: [DONE]
"#;
        let review = extract_opencode_review_from_body(body).expect("review text");
        assert!(review.contains("Found bug A"));
        assert!(review.contains("Found bug B"));
    }

    #[test]
    fn extracts_latest_assistant_message() {
        let body = r#"[
          {"role":"user","parts":[{"type":"text","text":"question"}]},
          {"role":"assistant","parts":[{"type":"text","text":"answer one"}]},
          {"role":"assistant","parts":[{"type":"text","text":"answer two"}]}
        ]"#;
        let review =
            extract_latest_assistant_review_from_messages_body(body).expect("assistant text");
        assert_eq!(review, "answer two");
    }
}
