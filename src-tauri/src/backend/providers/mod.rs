mod github;
mod gitlab;

use async_trait::async_trait;

use super::models::ProviderKind;

#[derive(Debug, Clone)]
pub struct ProviderIdentity {
    pub account_login: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderDeviceAuthorizationStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone)]
pub enum ProviderDeviceAuthorizationPoll {
    Pending,
    SlowDown,
    Complete { access_token: String },
    Expired,
    Denied,
}

#[derive(Debug, Clone)]
pub struct RepositoryRef {
    pub owner: String,
    pub name: String,
}

impl RepositoryRef {
    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

#[async_trait]
pub trait ProviderClient: Send + Sync {
    fn parse_repository(&self, value: &str) -> Result<RepositoryRef, String>;
    fn clone_url(&self, repository: &RepositoryRef) -> String;
    fn clone_auth_header(&self, access_token: &str) -> Result<String, String>;
    async fn validate_access_token(&self, access_token: &str) -> Result<ProviderIdentity, String>;

    async fn start_device_authorization(&self) -> Result<ProviderDeviceAuthorizationStart, String> {
        Err("Device authorization is not supported for this provider.".to_string())
    }

    async fn poll_device_authorization(
        &self,
        _device_code: &str,
    ) -> Result<ProviderDeviceAuthorizationPoll, String> {
        Err("Device authorization is not supported for this provider.".to_string())
    }
}

pub fn provider_client(kind: ProviderKind) -> Box<dyn ProviderClient> {
    match kind {
        ProviderKind::Github => Box::new(github::GitHubProviderClient),
        ProviderKind::Gitlab => Box::new(gitlab::GitLabProviderClient),
    }
}
