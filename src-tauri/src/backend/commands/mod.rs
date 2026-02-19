mod common;
mod providers;
mod review;
mod threads;
mod workspace_git;
#[cfg(test)]
mod workspace_git_tests;

use tauri::{AppHandle, State};

use super::{
    AddThreadMessageInput, AppServerAccountStatus, AppServerLoginStartResult, AppState,
    BackendHealth, CancelAiReviewRunInput, CancelAiReviewRunResult, CheckoutWorkspaceBranchInput,
    CheckoutWorkspaceBranchResult, CloneRepositoryInput, CloneRepositoryResult, CodeIntelSyncInput,
    CodeIntelSyncResult, CompareWorkspaceDiffInput, CompareWorkspaceDiffResult,
    ConnectProviderInput, CreateThreadInput, CreateWorkspaceBranchInput, GenerateAiFollowUpInput,
    GenerateAiFollowUpResult, GenerateAiReviewInput, GenerateAiReviewResult, GetAiReviewRunInput,
    ListAiReviewRunsInput, ListAiReviewRunsResult, ListWorkspaceBranchesInput,
    ListWorkspaceBranchesResult, Message, OpencodeSidecarStatus, PollProviderDeviceAuthInput,
    PollProviderDeviceAuthResult, ProviderConnection, ProviderKind, SetAiReviewApiKeyInput,
    SetAiReviewSettingsInput, StartAiReviewRunInput, StartAiReviewRunResult,
    StartProviderDeviceAuthInput, StartProviderDeviceAuthResult, Thread,
};

#[tauri::command]
pub async fn backend_health(state: State<'_, AppState>) -> Result<BackendHealth, String> {
    threads::backend_health(state).await
}

#[tauri::command]
pub async fn create_thread(
    state: State<'_, AppState>,
    input: CreateThreadInput,
) -> Result<Thread, String> {
    threads::create_thread(state, input).await
}

#[tauri::command]
pub async fn list_threads(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<Thread>, String> {
    threads::list_threads(state, limit).await
}

#[tauri::command]
pub async fn delete_thread(state: State<'_, AppState>, thread_id: i64) -> Result<bool, String> {
    threads::delete_thread(state, thread_id).await
}

#[tauri::command]
pub async fn add_thread_message(
    state: State<'_, AppState>,
    input: AddThreadMessageInput,
) -> Result<Message, String> {
    threads::add_thread_message(state, input).await
}

#[tauri::command]
pub async fn list_thread_messages(
    state: State<'_, AppState>,
    thread_id: i64,
    limit: Option<u32>,
) -> Result<Vec<Message>, String> {
    threads::list_thread_messages(state, thread_id, limit).await
}

#[tauri::command]
pub async fn connect_provider(
    state: State<'_, AppState>,
    input: ConnectProviderInput,
) -> Result<ProviderConnection, String> {
    providers::connect_provider(state, input).await
}

#[tauri::command]
pub async fn start_provider_device_auth(
    input: StartProviderDeviceAuthInput,
) -> Result<StartProviderDeviceAuthResult, String> {
    providers::start_provider_device_auth(input).await
}

#[tauri::command]
pub async fn poll_provider_device_auth(
    state: State<'_, AppState>,
    input: PollProviderDeviceAuthInput,
) -> Result<PollProviderDeviceAuthResult, String> {
    providers::poll_provider_device_auth(state, input).await
}

#[tauri::command]
pub async fn get_provider_connection(
    state: State<'_, AppState>,
    provider: ProviderKind,
) -> Result<Option<ProviderConnection>, String> {
    providers::get_provider_connection(state, provider).await
}

#[tauri::command]
pub async fn list_provider_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConnection>, String> {
    providers::list_provider_connections(state).await
}

#[tauri::command]
pub async fn disconnect_provider(
    state: State<'_, AppState>,
    provider: ProviderKind,
) -> Result<bool, String> {
    providers::disconnect_provider(state, provider).await
}

#[tauri::command]
pub async fn clone_repository(
    state: State<'_, AppState>,
    input: CloneRepositoryInput,
) -> Result<CloneRepositoryResult, String> {
    workspace_git::clone_repository(state, input).await
}

#[tauri::command]
pub async fn compare_workspace_diff(
    input: CompareWorkspaceDiffInput,
) -> Result<CompareWorkspaceDiffResult, String> {
    workspace_git::compare_workspace_diff(input).await
}

#[tauri::command]
pub async fn list_workspace_branches(
    input: ListWorkspaceBranchesInput,
) -> Result<ListWorkspaceBranchesResult, String> {
    workspace_git::list_workspace_branches(input).await
}

#[tauri::command]
pub async fn checkout_workspace_branch(
    input: CheckoutWorkspaceBranchInput,
) -> Result<CheckoutWorkspaceBranchResult, String> {
    workspace_git::checkout_workspace_branch(input).await
}

#[tauri::command]
pub async fn create_workspace_branch(
    input: CreateWorkspaceBranchInput,
) -> Result<CheckoutWorkspaceBranchResult, String> {
    workspace_git::create_workspace_branch(input).await
}

#[tauri::command]
pub async fn get_ai_review_config() -> Result<super::AiReviewConfig, String> {
    review::config::get_ai_review_config().await
}

#[tauri::command]
pub async fn set_ai_review_api_key(
    input: SetAiReviewApiKeyInput,
) -> Result<super::AiReviewConfig, String> {
    review::config::set_ai_review_api_key(input).await
}

#[tauri::command]
pub async fn set_ai_review_settings(
    input: SetAiReviewSettingsInput,
) -> Result<super::AiReviewConfig, String> {
    review::config::set_ai_review_settings(input).await
}

#[tauri::command]
pub async fn get_app_server_account_status() -> Result<AppServerAccountStatus, String> {
    review::transports::app_server::get_app_server_account_status().await
}

#[tauri::command]
pub async fn start_app_server_account_login() -> Result<AppServerLoginStartResult, String> {
    review::transports::app_server_login::start_app_server_account_login().await
}

#[tauri::command]
pub async fn get_opencode_sidecar_status(app: AppHandle) -> Result<OpencodeSidecarStatus, String> {
    review::transports::opencode::get_opencode_sidecar_status(app).await
}

#[tauri::command]
pub async fn start_ai_review_run(
    app: AppHandle,
    state: State<'_, AppState>,
    input: StartAiReviewRunInput,
) -> Result<StartAiReviewRunResult, String> {
    review::run_queue::start_ai_review_run(app, state, input).await
}

#[tauri::command]
pub async fn cancel_ai_review_run(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CancelAiReviewRunInput,
) -> Result<CancelAiReviewRunResult, String> {
    review::run_queue::cancel_ai_review_run(app, state, input).await
}

#[tauri::command]
pub async fn list_ai_review_runs(
    state: State<'_, AppState>,
    input: ListAiReviewRunsInput,
) -> Result<ListAiReviewRunsResult, String> {
    review::run_queue::list_ai_review_runs(state, input).await
}

#[tauri::command]
pub async fn get_ai_review_run(
    state: State<'_, AppState>,
    input: GetAiReviewRunInput,
) -> Result<super::AiReviewRun, String> {
    review::run_queue::get_ai_review_run(state, input).await
}

#[tauri::command]
pub async fn generate_ai_review(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateAiReviewInput,
) -> Result<GenerateAiReviewResult, String> {
    review::executor::generate_ai_review(app, state, input).await
}

#[tauri::command]
pub async fn generate_ai_follow_up(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateAiFollowUpInput,
) -> Result<GenerateAiFollowUpResult, String> {
    review::follow_up::generate_ai_follow_up(app, state, input).await
}

#[tauri::command]
pub async fn run_code_intel_sync(
    input: Option<CodeIntelSyncInput>,
) -> Result<CodeIntelSyncResult, String> {
    super::code_intel::run_code_intel_sync(input).await
}
