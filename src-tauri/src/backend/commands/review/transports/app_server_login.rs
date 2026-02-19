use std::{env, process::Stdio, time::Duration};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

use super::super::super::common::{
    parse_env_u64, DEFAULT_APP_SERVER_COMMAND, DEFAULT_APP_SERVER_STATUS_TIMEOUT_MS,
    ROVEX_APP_SERVER_COMMAND_ENV, ROVEX_REVIEW_TIMEOUT_MS_ENV,
};
use super::app_server::{
    parse_app_server_optional_string, wait_for_json_rpc_result, write_json_rpc_message,
};
use crate::backend::AppServerLoginStartResult;

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
