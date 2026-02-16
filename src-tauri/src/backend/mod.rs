pub mod commands;
mod db;
mod models;

pub use models::{
    AddThreadMessageInput, BackendHealth, CreateThreadInput, Message, MessageRole, Thread,
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
