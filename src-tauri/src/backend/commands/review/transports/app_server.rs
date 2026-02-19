use std::{env, process::Stdio, time::Duration};

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;

use super::super::super::common::{
    parse_env_u64, snippet, DEFAULT_APP_SERVER_COMMAND, DEFAULT_APP_SERVER_STATUS_TIMEOUT_MS,
    ROVEX_APP_SERVER_COMMAND_ENV, ROVEX_REVIEW_TIMEOUT_MS_ENV,
};
use crate::backend::{
    AppServerAccountStatus, AppServerCredits, AppServerRateLimitWindow, AppServerRateLimits,
};

fn resolve_app_server_model(review_model: &str) -> String {
    review_model.trim().to_string()
}

pub(crate) fn parse_app_server_optional_string(
    value: Option<&serde_json::Value>,
) -> Option<String> {
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

pub(crate) async fn write_json_rpc_message(
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

pub(crate) async fn wait_for_json_rpc_result<R: AsyncBufRead + Unpin>(
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

pub(crate) async fn generate_review_with_app_server(
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

#[cfg(test)]
mod tests {
    use super::parse_app_server_rate_limits_result;

    #[test]
    fn parse_app_server_rate_limits_prefers_codex_bucket() {
        let payload = serde_json::json!({
            "rateLimitsByLimitId": {
                "codex": {
                    "limitId": "codex",
                    "limitName": "Codex",
                    "planType": "pro",
                    "primary": { "usedPercent": 42, "resetsAt": 100, "windowDurationMins": 60 },
                    "secondary": { "usedPercent": 10, "resetsAt": 200, "windowDurationMins": 1440 },
                    "credits": { "balance": "$10", "hasCredits": true, "unlimited": false }
                }
            }
        });

        let parsed = parse_app_server_rate_limits_result(&payload).expect("parsed limits");
        assert_eq!(parsed.limit_id.as_deref(), Some("codex"));
        assert_eq!(parsed.plan_type.as_deref(), Some("pro"));
        assert_eq!(parsed.primary.as_ref().map(|v| v.used_percent), Some(42));
    }
}
