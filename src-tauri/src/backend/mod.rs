#[path = "code-intel.rs"]
mod code_intel;
pub mod commands;
mod db;
mod models;
mod providers;

pub use models::{
    AddThreadMessageInput, AiReviewChunk, AiReviewConfig, AiReviewFinding, AiReviewProgressEvent,
    AiReviewRun, AppServerAccountStatus, AppServerCredits, AppServerLoginStartResult,
    AppServerModel, AppServerRateLimitWindow, AppServerRateLimits, BackendHealth,
    CancelAiReviewRunInput, CancelAiReviewRunResult, CheckoutWorkspaceBranchInput,
    CheckoutWorkspaceBranchResult, CloneRepositoryInput, CloneRepositoryResult, CodeIntelSyncInput,
    CodeIntelSyncResult, CompareWorkspaceDiffInput, CompareWorkspaceDiffProfile,
    CompareWorkspaceDiffResult, ConnectProviderInput, CreateThreadInput,
    CreateWorkspaceBranchInput, GenerateAiFollowUpInput, GenerateAiFollowUpResult,
    GenerateAiReviewInput, GenerateAiReviewResult, GetAiReviewRunInput, ListAiReviewRunsInput,
    ListAiReviewRunsResult, ListWorkspaceBranchesInput, ListWorkspaceBranchesResult, Message,
    MessageRole, OpencodeSidecarStatus, PollProviderDeviceAuthInput, PollProviderDeviceAuthResult,
    ProviderConnection, ProviderDeviceAuthStatus, ProviderKind, SetAiReviewApiKeyInput,
    SetAiReviewSettingsInput, StartAiReviewRunInput, StartAiReviewRunResult,
    StartProviderDeviceAuthInput, StartProviderDeviceAuthResult, Thread, WorkspaceBranch,
};

use libsql::{Connection, Database};

pub struct AppState {
    db: Database,
    database_url: String,
}

impl AppState {
    pub async fn initialize() -> Result<Self, String> {
        let (database_url, db) = db::open_database_from_env().await?;
        db::initialize_schema(&db).await?;

        Ok(Self { db, database_url })
    }

    pub async fn initialize_local_fallback() -> Result<Self, String> {
        let (database_url, db) = db::open_local_database().await?;
        db::initialize_schema(&db).await?;

        Ok(Self { db, database_url })
    }

    pub fn connection(&self) -> Result<Connection, String> {
        self.db
            .connect()
            .map_err(|error| format!("Failed to open database connection: {error}"))
    }

    pub fn database_url(&self) -> &str {
        &self.database_url
    }
}
