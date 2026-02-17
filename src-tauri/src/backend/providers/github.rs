use std::env;

use async_trait::async_trait;
use base64::Engine as _;
use reqwest::{Client, StatusCode};
use serde::Deserialize;

use super::{
    ProviderClient, ProviderDeviceAuthorizationPoll, ProviderDeviceAuthorizationStart,
    ProviderIdentity, RepositoryRef,
};

const GITHUB_HTTPS_PREFIX: &str = "https://github.com/";
const GITHUB_SSH_PREFIX: &str = "git@github.com:";
const GITHUB_DEVICE_CODE_ENDPOINT: &str = "https://github.com/login/device/code";
const GITHUB_DEVICE_TOKEN_ENDPOINT: &str = "https://github.com/login/oauth/access_token";
const GITHUB_DEFAULT_OAUTH_SCOPE: &str = "repo";
const GITHUB_OAUTH_CLIENT_ID_ENV: &str = "GITHUB_OAUTH_CLIENT_ID";
const ROVEX_GITHUB_OAUTH_CLIENT_ID_ENV: &str = "ROVEX_GITHUB_OAUTH_CLIENT_ID";
const GITHUB_OAUTH_SCOPE_ENV: &str = "GITHUB_OAUTH_SCOPE";
const ROVEX_GITHUB_OAUTH_SCOPE_ENV: &str = "ROVEX_GITHUB_OAUTH_SCOPE";

pub struct GitHubProviderClient;

#[derive(Debug, Deserialize)]
struct GitHubUserResponse {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubDeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GitHubDeviceTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn github_oauth_client_id() -> Result<String, String> {
    let value = env::var(GITHUB_OAUTH_CLIENT_ID_ENV)
        .or_else(|_| env::var(ROVEX_GITHUB_OAUTH_CLIENT_ID_ENV))
        .map_err(|_| {
            format!(
                "Missing GitHub OAuth client ID. Set {GITHUB_OAUTH_CLIENT_ID_ENV} in your .env."
            )
        })?;

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!(
            "GitHub OAuth client ID is empty. Set {GITHUB_OAUTH_CLIENT_ID_ENV} in your .env."
        ));
    }

    Ok(trimmed.to_string())
}

fn github_oauth_scope() -> String {
    env::var(GITHUB_OAUTH_SCOPE_ENV)
        .or_else(|_| env::var(ROVEX_GITHUB_OAUTH_SCOPE_ENV))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| GITHUB_DEFAULT_OAUTH_SCOPE.to_string())
}

#[async_trait]
impl ProviderClient for GitHubProviderClient {
    fn parse_repository(&self, value: &str) -> Result<RepositoryRef, String> {
        let mut normalized = value.trim();
        if normalized.is_empty() {
            return Err("Repository must not be empty.".to_string());
        }

        if let Some(stripped) = normalized.strip_prefix(GITHUB_HTTPS_PREFIX) {
            normalized = stripped;
        } else if let Some(stripped) = normalized.strip_prefix(GITHUB_SSH_PREFIX) {
            normalized = stripped;
        }

        normalized = normalized.trim_start_matches('/').trim_end_matches('/');
        if let Some(stripped) = normalized.strip_suffix(".git") {
            normalized = stripped;
        }

        let mut parts = normalized.split('/');
        let owner = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Repository must be in the format owner/repository.".to_string())?;
        let name = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Repository must be in the format owner/repository.".to_string())?;

        if parts.next().is_some() {
            return Err("Repository must be in the format owner/repository.".to_string());
        }

        Ok(RepositoryRef {
            owner: owner.to_string(),
            name: name.to_string(),
        })
    }

    fn clone_url(&self, repository: &RepositoryRef) -> String {
        format!("https://github.com/{}.git", repository.slug())
    }

    fn clone_auth_header(&self, access_token: &str) -> Result<String, String> {
        let token = access_token.trim();
        if token.is_empty() {
            return Err("Provider access token must not be empty.".to_string());
        }

        let encoded =
            base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{token}"));
        Ok(format!("Authorization: Basic {encoded}"))
    }

    async fn validate_access_token(&self, access_token: &str) -> Result<ProviderIdentity, String> {
        let token = access_token.trim();
        if token.is_empty() {
            return Err("Provider access token must not be empty.".to_string());
        }

        let client = Client::new();
        let response = client
            .get("https://api.github.com/user")
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "rovex-provider")
            .send()
            .await
            .map_err(|error| format!("Failed to reach GitHub API: {error}"))?;

        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(
                "GitHub rejected the token. Verify token scopes and try again.".to_string(),
            );
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(200).collect();
            return Err(format!(
                "GitHub API returned {status}. Response: {}",
                snippet.trim()
            ));
        }

        let user: GitHubUserResponse = response
            .json()
            .await
            .map_err(|error| format!("Failed to parse GitHub API response: {error}"))?;

        Ok(ProviderIdentity {
            account_login: user.login,
            avatar_url: user.avatar_url,
        })
    }

    async fn start_device_authorization(&self) -> Result<ProviderDeviceAuthorizationStart, String> {
        let client_id = github_oauth_client_id()?;
        let scope = github_oauth_scope();
        let client = Client::new();
        let params = [("client_id", client_id.as_str()), ("scope", scope.as_str())];

        let response = client
            .post(GITHUB_DEVICE_CODE_ENDPOINT)
            .header("Accept", "application/json")
            .header("User-Agent", "rovex-provider")
            .form(&params)
            .send()
            .await
            .map_err(|error| format!("Failed to reach GitHub OAuth API: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(200).collect();
            return Err(format!(
                "GitHub OAuth API returned {status}. Response: {}",
                snippet.trim()
            ));
        }

        let device_code: GitHubDeviceCodeResponse = response
            .json()
            .await
            .map_err(|error| format!("Failed to parse GitHub OAuth response: {error}"))?;

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

        let client_id = github_oauth_client_id()?;
        let client = Client::new();
        let params = [
            ("client_id", client_id.as_str()),
            ("device_code", code),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code",
            ),
        ];

        let response = client
            .post(GITHUB_DEVICE_TOKEN_ENDPOINT)
            .header("Accept", "application/json")
            .header("User-Agent", "rovex-provider")
            .form(&params)
            .send()
            .await
            .map_err(|error| format!("Failed to reach GitHub OAuth API: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(200).collect();
            return Err(format!(
                "GitHub OAuth API returned {status}. Response: {}",
                snippet.trim()
            ));
        }

        let token: GitHubDeviceTokenResponse = response
            .json()
            .await
            .map_err(|error| format!("Failed to parse GitHub OAuth response: {error}"))?;

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
                Err(format!(
                    "GitHub OAuth returned {error_code}: {description}"
                ))
            }
            None => Err("GitHub OAuth response did not contain an access token.".to_string()),
        }
    }
}
