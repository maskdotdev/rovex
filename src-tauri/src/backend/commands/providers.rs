use tauri::State;

use super::super::providers::{provider_client, ProviderDeviceAuthorizationPoll};
use super::common::parse_provider_kind;
use crate::backend::{
    AppState, ConnectProviderInput, PollProviderDeviceAuthInput, PollProviderDeviceAuthResult,
    ProviderConnection, ProviderDeviceAuthStatus, ProviderKind, StartProviderDeviceAuthInput,
    StartProviderDeviceAuthResult,
};

pub(crate) struct ProviderConnectionRow {
    provider: ProviderKind,
    account_login: String,
    avatar_url: Option<String>,
    pub(crate) access_token: String,
    created_at: String,
    updated_at: String,
}

fn to_provider_connection(connection: &ProviderConnectionRow) -> ProviderConnection {
    ProviderConnection {
        provider: connection.provider,
        account_login: connection.account_login.clone(),
        avatar_url: connection.avatar_url.clone(),
        created_at: connection.created_at.clone(),
        updated_at: connection.updated_at.clone(),
    }
}

pub(crate) async fn upsert_provider_connection(
    state: &AppState,
    provider: ProviderKind,
    access_token: &str,
) -> Result<ProviderConnection, String> {
    let token = access_token.trim();
    if token.is_empty() {
        return Err("Provider access token must not be empty.".to_string());
    }

    let client = provider_client(provider);
    let identity = client.validate_access_token(token).await?;

    let conn = state.connection()?;
    conn.execute(
        "INSERT INTO provider_connections (provider, account_login, avatar_url, access_token, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(provider)
         DO UPDATE SET
           account_login = excluded.account_login,
           avatar_url = excluded.avatar_url,
           access_token = excluded.access_token,
           updated_at = CURRENT_TIMESTAMP",
        (
            provider.as_str(),
            identity.account_login,
            identity.avatar_url,
            token.to_string(),
        ),
    )
    .await
    .map_err(|error| format!("Failed to store provider connection: {error}"))?;

    let connection = load_provider_connection_row(state, provider)
        .await?
        .ok_or_else(|| "Provider connection was not found after connect.".to_string())?;
    Ok(to_provider_connection(&connection))
}

pub(crate) async fn load_provider_connection_row(
    state: &AppState,
    provider: ProviderKind,
) -> Result<Option<ProviderConnectionRow>, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT provider, account_login, avatar_url, access_token, created_at, updated_at FROM provider_connections WHERE provider = ?1 LIMIT 1",
            [provider.as_str()],
        )
        .await
        .map_err(|error| format!("Failed to load provider connection: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read provider connection row: {error}"))?
    else {
        return Ok(None);
    };

    let provider_value: String = row
        .get(0)
        .map_err(|error| format!("Failed to parse provider value: {error}"))?;
    let provider = parse_provider_kind(provider_value)?;

    Ok(Some(ProviderConnectionRow {
        provider,
        account_login: row
            .get(1)
            .map_err(|error| format!("Failed to parse provider account login: {error}"))?,
        avatar_url: row
            .get(2)
            .map_err(|error| format!("Failed to parse provider avatar URL: {error}"))?,
        access_token: row
            .get(3)
            .map_err(|error| format!("Failed to parse provider access token: {error}"))?,
        created_at: row
            .get(4)
            .map_err(|error| format!("Failed to parse provider created_at: {error}"))?,
        updated_at: row
            .get(5)
            .map_err(|error| format!("Failed to parse provider updated_at: {error}"))?,
    }))
}

pub async fn connect_provider(
    state: State<'_, AppState>,
    input: ConnectProviderInput,
) -> Result<ProviderConnection, String> {
    upsert_provider_connection(&state, input.provider, &input.access_token).await
}

pub async fn start_provider_device_auth(
    input: StartProviderDeviceAuthInput,
) -> Result<StartProviderDeviceAuthResult, String> {
    let client = provider_client(input.provider);
    let flow = client.start_device_authorization().await?;

    Ok(StartProviderDeviceAuthResult {
        provider: input.provider,
        device_code: flow.device_code,
        user_code: flow.user_code,
        verification_uri: flow.verification_uri,
        verification_uri_complete: flow.verification_uri_complete,
        expires_in: flow.expires_in,
        interval: flow.interval,
    })
}

pub async fn poll_provider_device_auth(
    state: State<'_, AppState>,
    input: PollProviderDeviceAuthInput,
) -> Result<PollProviderDeviceAuthResult, String> {
    let device_code = input.device_code.trim();
    if device_code.is_empty() {
        return Err("Device code must not be empty.".to_string());
    }

    let client = provider_client(input.provider);
    let poll_result = client.poll_device_authorization(device_code).await?;

    match poll_result {
        ProviderDeviceAuthorizationPoll::Pending => Ok(PollProviderDeviceAuthResult {
            status: ProviderDeviceAuthStatus::Pending,
            connection: None,
        }),
        ProviderDeviceAuthorizationPoll::SlowDown => Ok(PollProviderDeviceAuthResult {
            status: ProviderDeviceAuthStatus::SlowDown,
            connection: None,
        }),
        ProviderDeviceAuthorizationPoll::Complete { access_token } => {
            let connection =
                upsert_provider_connection(&state, input.provider, &access_token).await?;
            Ok(PollProviderDeviceAuthResult {
                status: ProviderDeviceAuthStatus::Complete,
                connection: Some(connection),
            })
        }
        ProviderDeviceAuthorizationPoll::Expired => Err(format!(
            "{} device authorization expired. Start the connection flow again.",
            input.provider.as_str()
        )),
        ProviderDeviceAuthorizationPoll::Denied => Err(format!(
            "{} device authorization was denied.",
            input.provider.as_str()
        )),
    }
}

pub async fn get_provider_connection(
    state: State<'_, AppState>,
    provider: ProviderKind,
) -> Result<Option<ProviderConnection>, String> {
    let connection = load_provider_connection_row(&state, provider).await?;
    Ok(connection.as_ref().map(to_provider_connection))
}

pub async fn list_provider_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConnection>, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT provider, account_login, avatar_url, created_at, updated_at FROM provider_connections ORDER BY updated_at DESC",
            (),
        )
        .await
        .map_err(|error| format!("Failed to list provider connections: {error}"))?;

    let mut connections = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read provider connection rows: {error}"))?
    {
        let provider_value: String = row
            .get(0)
            .map_err(|error| format!("Failed to parse provider value: {error}"))?;
        let provider = parse_provider_kind(provider_value)?;

        connections.push(ProviderConnection {
            provider,
            account_login: row
                .get(1)
                .map_err(|error| format!("Failed to parse provider account login: {error}"))?,
            avatar_url: row
                .get(2)
                .map_err(|error| format!("Failed to parse provider avatar URL: {error}"))?,
            created_at: row
                .get(3)
                .map_err(|error| format!("Failed to parse provider created_at: {error}"))?,
            updated_at: row
                .get(4)
                .map_err(|error| format!("Failed to parse provider updated_at: {error}"))?,
        });
    }

    Ok(connections)
}

pub async fn disconnect_provider(
    state: State<'_, AppState>,
    provider: ProviderKind,
) -> Result<bool, String> {
    let conn = state.connection()?;
    let affected = conn
        .execute(
            "DELETE FROM provider_connections WHERE provider = ?1",
            [provider.as_str()],
        )
        .await
        .map_err(|error| format!("Failed to disconnect provider: {error}"))?;

    Ok(affected > 0)
}
