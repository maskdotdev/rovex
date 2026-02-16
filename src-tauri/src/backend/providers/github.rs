use async_trait::async_trait;
use base64::Engine as _;
use reqwest::{Client, StatusCode};
use serde::Deserialize;

use super::{ProviderClient, ProviderIdentity, RepositoryRef};

const GITHUB_HTTPS_PREFIX: &str = "https://github.com/";
const GITHUB_SSH_PREFIX: &str = "git@github.com:";

pub struct GitHubProviderClient;

#[derive(Debug, Deserialize)]
struct GitHubUserResponse {
    login: String,
    avatar_url: Option<String>,
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
}
