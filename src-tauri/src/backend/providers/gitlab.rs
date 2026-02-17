use std::env;

use async_trait::async_trait;
use base64::Engine as _;
use reqwest::{Client, StatusCode};
use serde::Deserialize;

use super::{
    ProviderClient, ProviderDeviceAuthorizationPoll, ProviderDeviceAuthorizationStart,
    ProviderIdentity, RepositoryRef,
};

const GITLAB_DEFAULT_BASE_URL: &str = "https://gitlab.com";
const GITLAB_DEFAULT_OAUTH_SCOPE: &str = "read_user read_repository";
const GITLAB_OAUTH_CLIENT_ID_ENV: &str = "GITLAB_OAUTH_CLIENT_ID";
const ROVEX_GITLAB_OAUTH_CLIENT_ID_ENV: &str = "ROVEX_GITLAB_OAUTH_CLIENT_ID";
const GITLAB_OAUTH_SCOPE_ENV: &str = "GITLAB_OAUTH_SCOPE";
const ROVEX_GITLAB_OAUTH_SCOPE_ENV: &str = "ROVEX_GITLAB_OAUTH_SCOPE";
const GITLAB_BASE_URL_ENV: &str = "GITLAB_BASE_URL";
const ROVEX_GITLAB_BASE_URL_ENV: &str = "ROVEX_GITLAB_BASE_URL";
const USER_AGENT: &str = "rovex-provider";

pub struct GitLabProviderClient;

#[derive(Debug, Deserialize)]
struct GitLabUserResponse {
    username: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitLabDeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GitLabDeviceTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn gitlab_base_url() -> String {
    let configured = env::var(GITLAB_BASE_URL_ENV)
        .or_else(|_| env::var(ROVEX_GITLAB_BASE_URL_ENV))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| GITLAB_DEFAULT_BASE_URL.to_string());

    let with_scheme = if configured.starts_with("http://") || configured.starts_with("https://") {
        configured
    } else {
        format!("https://{configured}")
    };
    with_scheme.trim_end_matches('/').to_string()
}

fn gitlab_host(base_url: &str) -> String {
    let without_scheme = base_url
        .strip_prefix("https://")
        .or_else(|| base_url.strip_prefix("http://"))
        .unwrap_or(base_url);

    without_scheme
        .split('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("gitlab.com")
        .to_string()
}

fn gitlab_oauth_client_id() -> Result<String, String> {
    let value = env::var(GITLAB_OAUTH_CLIENT_ID_ENV)
        .or_else(|_| env::var(ROVEX_GITLAB_OAUTH_CLIENT_ID_ENV))
        .map_err(|_| {
            format!(
                "Missing GitLab OAuth client ID. Set {GITLAB_OAUTH_CLIENT_ID_ENV} in your .env."
            )
        })?;

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!(
            "GitLab OAuth client ID is empty. Set {GITLAB_OAUTH_CLIENT_ID_ENV} in your .env."
        ));
    }

    Ok(trimmed.to_string())
}

fn gitlab_oauth_scope() -> String {
    env::var(GITLAB_OAUTH_SCOPE_ENV)
        .or_else(|_| env::var(ROVEX_GITLAB_OAUTH_SCOPE_ENV))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| GITLAB_DEFAULT_OAUTH_SCOPE.to_string())
}

async fn parse_gitlab_user_response(
    response: reqwest::Response,
    response_context: &str,
) -> Result<ProviderIdentity, String> {
    let user: GitLabUserResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse {response_context}: {error}"))?;

    Ok(ProviderIdentity {
        account_login: user.username,
        avatar_url: user.avatar_url,
    })
}

#[async_trait]
impl ProviderClient for GitLabProviderClient {
    fn parse_repository(&self, value: &str) -> Result<RepositoryRef, String> {
        let base_url = gitlab_base_url();
        let https_prefix = format!("{base_url}/");
        let ssh_prefix = format!("git@{}:", gitlab_host(&base_url));

        let mut normalized = value.trim();
        if normalized.is_empty() {
            return Err("Repository must not be empty.".to_string());
        }

        if let Some(stripped) = normalized.strip_prefix(&https_prefix) {
            normalized = stripped;
        } else if let Some(stripped) = normalized.strip_prefix(&ssh_prefix) {
            normalized = stripped;
        }

        normalized = normalized
            .split(['?', '#'])
            .next()
            .unwrap_or(normalized)
            .trim_start_matches('/')
            .trim_end_matches('/');

        if let Some(stripped) = normalized.strip_suffix(".git") {
            normalized = stripped;
        }

        let segments: Vec<&str> = normalized
            .split('/')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect();
        if segments.len() < 2 {
            return Err(
                "Repository must be in the format namespace/repository (subgroups are supported)."
                    .to_string(),
            );
        }

        let owner = segments[..segments.len() - 1].join("/");
        let name = segments[segments.len() - 1];

        Ok(RepositoryRef {
            owner,
            name: name.to_string(),
        })
    }

    fn clone_url(&self, repository: &RepositoryRef) -> String {
        let base_url = gitlab_base_url();
        format!("{base_url}/{}.git", repository.slug())
    }

    fn clone_auth_header(&self, access_token: &str) -> Result<String, String> {
        let token = access_token.trim();
        if token.is_empty() {
            return Err("Provider access token must not be empty.".to_string());
        }

        let encoded = base64::engine::general_purpose::STANDARD.encode(format!("oauth2:{token}"));
        Ok(format!("Authorization: Basic {encoded}"))
    }

    async fn validate_access_token(&self, access_token: &str) -> Result<ProviderIdentity, String> {
        let token = access_token.trim();
        if token.is_empty() {
            return Err("Provider access token must not be empty.".to_string());
        }

        let base_url = gitlab_base_url();
        let endpoint = format!("{base_url}/api/v4/user");
        let client = Client::new();

        let bearer_response = client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", USER_AGENT)
            .send()
            .await
            .map_err(|error| format!("Failed to reach GitLab API: {error}"))?;

        if bearer_response.status().is_success() {
            return parse_gitlab_user_response(bearer_response, "GitLab API response").await;
        }

        if bearer_response.status() != StatusCode::UNAUTHORIZED {
            let status = bearer_response.status();
            let body = bearer_response.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(200).collect();
            return Err(format!(
                "GitLab API returned {status}. Response: {}",
                snippet.trim()
            ));
        }

        let private_token_response = client
            .get(&endpoint)
            .header("PRIVATE-TOKEN", token)
            .header("User-Agent", USER_AGENT)
            .send()
            .await
            .map_err(|error| format!("Failed to reach GitLab API: {error}"))?;

        if private_token_response.status() == StatusCode::UNAUTHORIZED {
            return Err(
                "GitLab rejected the token. Verify token scopes and try again.".to_string(),
            );
        }

        if !private_token_response.status().is_success() {
            let status = private_token_response.status();
            let body = private_token_response.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(200).collect();
            return Err(format!(
                "GitLab API returned {status}. Response: {}",
                snippet.trim()
            ));
        }

        parse_gitlab_user_response(private_token_response, "GitLab API response").await
    }

    async fn start_device_authorization(&self) -> Result<ProviderDeviceAuthorizationStart, String> {
        let client_id = gitlab_oauth_client_id()?;
        let scope = gitlab_oauth_scope();
        let base_url = gitlab_base_url();
        let endpoint = format!("{base_url}/oauth/authorize_device");
        let client = Client::new();
        let params = [("client_id", client_id.as_str()), ("scope", scope.as_str())];

        let response = client
            .post(endpoint)
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .form(&params)
            .send()
            .await
            .map_err(|error| format!("Failed to reach GitLab OAuth API: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(200).collect();
            return Err(format!(
                "GitLab OAuth API returned {status}. Response: {}",
                snippet.trim()
            ));
        }

        let device_code: GitLabDeviceCodeResponse = response
            .json()
            .await
            .map_err(|error| format!("Failed to parse GitLab OAuth response: {error}"))?;

        Ok(ProviderDeviceAuthorizationStart {
            device_code: device_code.device_code,
            user_code: device_code.user_code,
            verification_uri: device_code.verification_uri,
            verification_uri_complete: device_code.verification_uri_complete,
            expires_in: device_code.expires_in,
            interval: device_code.interval.unwrap_or(5),
        })
    }

    async fn poll_device_authorization(
        &self,
        device_code: &str,
    ) -> Result<ProviderDeviceAuthorizationPoll, String> {
        let code = device_code.trim();
        if code.is_empty() {
            return Err("Device code must not be empty.".to_string());
        }

        let client_id = gitlab_oauth_client_id()?;
        let base_url = gitlab_base_url();
        let endpoint = format!("{base_url}/oauth/token");
        let client = Client::new();
        let params = [
            ("client_id", client_id.as_str()),
            ("device_code", code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ];

        let response = client
            .post(endpoint)
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .form(&params)
            .send()
            .await
            .map_err(|error| format!("Failed to reach GitLab OAuth API: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(200).collect();
            return Err(format!(
                "GitLab OAuth API returned {status}. Response: {}",
                snippet.trim()
            ));
        }

        let token: GitLabDeviceTokenResponse = response
            .json()
            .await
            .map_err(|error| format!("Failed to parse GitLab OAuth response: {error}"))?;

        if let Some(access_token) = token
            .access_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Ok(ProviderDeviceAuthorizationPoll::Complete {
                access_token: access_token.to_string(),
            });
        }

        match token.error.as_deref() {
            Some("authorization_pending") => Ok(ProviderDeviceAuthorizationPoll::Pending),
            Some("slow_down") => Ok(ProviderDeviceAuthorizationPoll::SlowDown),
            Some("expired_token") => Ok(ProviderDeviceAuthorizationPoll::Expired),
            Some("access_denied") => Ok(ProviderDeviceAuthorizationPoll::Denied),
            Some(error_code) => {
                let description = token
                    .error_description
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("No description returned.");
                Err(format!("GitLab OAuth returned {error_code}: {description}"))
            }
            None => Err("GitLab OAuth response did not contain an access token.".to_string()),
        }
    }
}
