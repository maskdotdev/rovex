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
    Gitlab,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Gitlab => "gitlab",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "github" => Some(Self::Github),
            "gitlab" => Some(Self::Gitlab),
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
    pub upstream_branch: Option<String>,
    pub remote_branches: Vec<WorkspaceBranch>,
    pub suggested_base_ref: String,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiReviewInput {
    pub thread_id: i64,
    pub workspace: String,
    pub base_ref: String,
    pub merge_base: String,
    pub head: String,
    pub files_changed: i64,
    pub insertions: i64,
    pub deletions: i64,
    pub diff: String,
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewFinding {
    pub id: String,
    pub file_path: String,
    pub chunk_id: String,
    pub chunk_index: usize,
    pub hunk_header: String,
    pub side: String,
    pub line_number: i64,
    pub title: String,
    pub body: String,
    pub severity: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewChunk {
    pub id: String,
    pub file_path: String,
    pub chunk_index: usize,
    pub hunk_header: String,
    pub summary: String,
    pub findings: Vec<AiReviewFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewProgressEvent {
    pub run_id: Option<String>,
    pub thread_id: i64,
    pub status: String,
    pub message: String,
    pub total_chunks: usize,
    pub completed_chunks: usize,
    pub chunk_id: Option<String>,
    pub file_path: Option<String>,
    pub chunk_index: Option<usize>,
    pub finding_count: Option<usize>,
    pub chunk: Option<AiReviewChunk>,
    pub finding: Option<AiReviewFinding>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiReviewResult {
    pub thread_id: i64,
    pub workspace: String,
    pub base_ref: String,
    pub merge_base: String,
    pub head: String,
    pub files_changed: i64,
    pub insertions: i64,
    pub deletions: i64,
    pub model: String,
    pub review: String,
    pub diff_chars_used: usize,
    pub diff_chars_total: usize,
    pub diff_truncated: bool,
    pub chunks: Vec<AiReviewChunk>,
    pub findings: Vec<AiReviewFinding>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAiReviewRunInput {
    pub thread_id: i64,
    pub workspace: String,
    pub base_ref: String,
    pub merge_base: String,
    pub head: String,
    pub files_changed: i64,
    pub insertions: i64,
    pub deletions: i64,
    pub diff: String,
    pub prompt: Option<String>,
    pub scope_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewRun {
    pub run_id: String,
    pub thread_id: i64,
    pub workspace: String,
    pub base_ref: String,
    pub merge_base: String,
    pub head: String,
    pub files_changed: i64,
    pub insertions: i64,
    pub deletions: i64,
    pub prompt: Option<String>,
    pub scope_label: Option<String>,
    pub status: String,
    pub total_chunks: usize,
    pub completed_chunks: usize,
    pub failed_chunks: usize,
    pub finding_count: usize,
    pub model: Option<String>,
    pub review: Option<String>,
    pub diff_chars_used: Option<usize>,
    pub diff_chars_total: Option<usize>,
    pub diff_truncated: bool,
    pub error: Option<String>,
    pub chunks: Vec<AiReviewChunk>,
    pub findings: Vec<AiReviewFinding>,
    pub progress_events: Vec<AiReviewProgressEvent>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub canceled_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAiReviewRunResult {
    pub run: AiReviewRun,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAiReviewRunInput {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAiReviewRunResult {
    pub run_id: String,
    pub canceled: bool,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAiReviewRunsInput {
    pub thread_id: Option<i64>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAiReviewRunsResult {
    pub runs: Vec<AiReviewRun>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAiReviewRunInput {
    pub run_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiFollowUpInput {
    pub thread_id: i64,
    pub workspace: String,
    pub question: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiFollowUpResult {
    pub thread_id: i64,
    pub workspace: String,
    pub model: String,
    pub answer: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewConfig {
    pub has_api_key: bool,
    pub api_key_preview: Option<String>,
    pub env_file_path: Option<String>,
    pub review_provider: String,
    pub review_model: String,
    pub opencode_provider: String,
    pub opencode_model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAiReviewApiKeyInput {
    pub api_key: String,
    pub persist_to_env: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAiReviewSettingsInput {
    pub review_provider: String,
    pub review_model: String,
    pub opencode_provider: Option<String>,
    pub opencode_model: Option<String>,
    pub persist_to_env: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeSidecarStatus {
    pub available: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerRateLimitWindow {
    pub used_percent: i64,
    pub resets_at: Option<i64>,
    pub window_duration_mins: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerCredits {
    pub balance: Option<String>,
    pub has_credits: bool,
    pub unlimited: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerRateLimits {
    pub limit_id: Option<String>,
    pub limit_name: Option<String>,
    pub plan_type: Option<String>,
    pub primary: Option<AppServerRateLimitWindow>,
    pub secondary: Option<AppServerRateLimitWindow>,
    pub credits: Option<AppServerCredits>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerAccountStatus {
    pub available: bool,
    pub requires_openai_auth: bool,
    pub account_type: Option<String>,
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub rate_limits: Option<AppServerRateLimits>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerLoginStartResult {
    pub login_id: String,
    pub auth_url: String,
}
