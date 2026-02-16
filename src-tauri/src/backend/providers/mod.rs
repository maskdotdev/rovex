mod github;

use async_trait::async_trait;

use super::models::ProviderKind;

#[derive(Debug, Clone)]
pub struct ProviderIdentity {
    pub account_login: String,
    pub avatar_url: Option<String>,
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
}

pub fn provider_client(kind: ProviderKind) -> Box<dyn ProviderClient> {
    match kind {
        ProviderKind::Github => Box::new(github::GitHubProviderClient),
    }
}
