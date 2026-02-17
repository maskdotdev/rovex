use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendHealth {
    pub status: String,
    pub database_url: String,
    pub thread_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThreadInput {
    pub title: String,
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: i64,
    pub title: String,
    pub workspace: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

impl MessageRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddThreadMessageInput {
    pub thread_id: i64,
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub thread_id: i64,
    pub role: MessageRole,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeIntelSyncInput {
    pub project_root: Option<String>,
    pub use_scip: Option<bool>,
    pub clear_kitedb: Option<bool>,
    pub clear_turso_project: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIntelSyncResult {
    pub run_id: String,
    pub project_root: String,
    pub kitedb_store_path: String,
    pub syntax_nodes_upserted: u64,
    pub semantic_nodes_upserted: u64,
    pub vectors_upserted: u64,
    pub files_parsed: u64,
    pub files_skipped: u64,
    pub chunks_emitted: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Github,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "github" => Some(Self::Github),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectProviderInput {
    pub provider: ProviderKind,
    pub access_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartProviderDeviceAuthInput {
    pub provider: ProviderKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartProviderDeviceAuthResult {
    pub provider: ProviderKind,
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollProviderDeviceAuthInput {
    pub provider: ProviderKind,
    pub device_code: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderDeviceAuthStatus {
    Pending,
    SlowDown,
    Complete,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnection {
    pub provider: ProviderKind,
    pub account_login: String,
    pub avatar_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollProviderDeviceAuthResult {
    pub status: ProviderDeviceAuthStatus,
    pub connection: Option<ProviderConnection>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRepositoryInput {
    pub provider: ProviderKind,
    pub repository: String,
    pub destination_root: Option<String>,
    pub directory_name: Option<String>,
    pub shallow: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRepositoryResult {
    pub provider: ProviderKind,
    pub repository: String,
    pub workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareWorkspaceDiffInput {
    pub workspace: String,
    pub base_ref: Option<String>,
    pub fetch_remote: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareWorkspaceDiffResult {
    pub workspace: String,
    pub base_ref: String,
    pub merge_base: String,
    pub head: String,
    pub diff: String,
    pub files_changed: i64,
    pub insertions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspaceBranchesInput {
    pub workspace: String,
    pub fetch_remote: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBranch {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspaceBranchesResult {
    pub workspace: String,
    pub current_branch: Option<String>,
    pub branches: Vec<WorkspaceBranch>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutWorkspaceBranchInput {
    pub workspace: String,
    pub branch_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutWorkspaceBranchResult {
    pub workspace: String,
    pub branch_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceBranchInput {
    pub workspace: String,
    pub branch_name: String,
    pub from_ref: Option<String>,
}
