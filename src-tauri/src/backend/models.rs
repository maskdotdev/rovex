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
