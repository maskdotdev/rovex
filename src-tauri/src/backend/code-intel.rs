use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use argus_search::core::cancel::CancelToken;
use argus_search::core::graph::engine::GraphSink;
use argus_search::core::graph::types::{GraphBatch, GraphNodeRecord};
use argus_search::core::index_engine::{
    IndexEngine, IndexEvent, IndexOptions, IndexPhases, IndexSink,
};
use argus_search::core::kitedb_store::KiteDbIndexSink;
use argus_search::core::parse::engine::{ParseInputs, ParseSink};
use argus_search::core::scip::engine::ScipSink;
use argus_search::core::types::GraphLayer;
use argus_search::core::vector::engine::VectorSink;
use argus_search::core::vector::provider::{HttpEmbeddingConfig, HttpEmbeddingsProvider};
use argus_search::core::vector::types::{VectorBatch, VectorRecord};
use libsql::{Builder, Connection, Database};
use tokio::runtime::Runtime;

use super::{CodeIntelSyncInput, CodeIntelSyncResult};

const DEFAULT_KITEDB_STORE_PATH: &str = ".argus-search/index.kite";
const DEFAULT_VECTOR_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_VECTOR_MODEL: &str = "text-embedding-3-small";
const DEFAULT_VECTOR_DIMENSION: usize = 1536;
const DEFAULT_VECTOR_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_VECTOR_BATCH_SIZE: usize = 256;
const DEFAULT_VECTOR_CONCURRENCY: usize = 4;
const DEFAULT_PATHS: &[&str] = &["src", "src-tauri"];
const DEFAULT_INCLUDE: &[&str] = &["*.ts", "*.tsx", "*.js", "*.jsx", "*.rs", "*.py"];
const DEFAULT_EXCLUDE: &[&str] = &[
    "node_modules",
    "dist",
    "target",
    ".git",
    ".venv",
    "__pycache__",
];

const TURSO_DATABASE_URL_ENV: &str = "TURSO_DATABASE_URL";
const TURSO_AUTH_TOKEN_ENV: &str = "TURSO_AUTH_TOKEN";

const CODE_INTEL_PROJECT_ROOT_ENV: &str = "CODE_INTEL_PROJECT_ROOT";
const CODE_INTEL_PATHS_ENV: &str = "CODE_INTEL_PATHS";
const CODE_INTEL_INCLUDE_ENV: &str = "CODE_INTEL_INCLUDE";
const CODE_INTEL_EXCLUDE_ENV: &str = "CODE_INTEL_EXCLUDE";
const CODE_INTEL_SCIP_ENV: &str = "CODE_INTEL_SCIP";
const CODE_INTEL_KITEDB_STORE_ENV: &str = "CODE_INTEL_KITEDB_STORE";
const CODE_INTEL_KITEDB_CLEAR_ENV: &str = "CODE_INTEL_KITEDB_CLEAR";
const CODE_INTEL_TURSO_CLEAR_PROJECT_ENV: &str = "CODE_INTEL_TURSO_CLEAR_PROJECT";
const CODE_INTEL_VECTOR_BASE_URL_ENV: &str = "CODE_INTEL_VECTOR_BASE_URL";
const CODE_INTEL_VECTOR_MODEL_ENV: &str = "CODE_INTEL_VECTOR_MODEL";
const CODE_INTEL_VECTOR_DIMENSION_ENV: &str = "CODE_INTEL_VECTOR_DIMENSION";
const CODE_INTEL_VECTOR_TIMEOUT_MS_ENV: &str = "CODE_INTEL_VECTOR_TIMEOUT_MS";
const CODE_INTEL_VECTOR_BATCH_SIZE_ENV: &str = "CODE_INTEL_VECTOR_BATCH_SIZE";
const CODE_INTEL_VECTOR_CONCURRENCY_ENV: &str = "CODE_INTEL_VECTOR_CONCURRENCY";
const CODE_INTEL_VECTOR_API_KEY_ENV: &str = "CODE_INTEL_VECTOR_API_KEY";
const OPENAI_API_KEY_ENV: &str = "OPENAI_API_KEY";

const TURSO_SYNC_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS code_graph_nodes (
  project_root TEXT NOT NULL,
  graph_node_id TEXT NOT NULL,
  graph_layer TEXT NOT NULL CHECK (graph_layer IN ('syntax', 'semantic')),
  node_kind TEXT NOT NULL,
  symbol_name TEXT,
  file_path TEXT,
  language TEXT,
  scip_symbol TEXT,
  range_json TEXT,
  metadata_json TEXT,
  sources_json TEXT,
  run_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_root, graph_node_id)
);

CREATE INDEX IF NOT EXISTS idx_code_graph_nodes_project_symbol
ON code_graph_nodes(project_root, symbol_name);

CREATE INDEX IF NOT EXISTS idx_code_graph_nodes_project_scip_symbol
ON code_graph_nodes(project_root, scip_symbol);

CREATE INDEX IF NOT EXISTS idx_code_graph_nodes_project_file_path
ON code_graph_nodes(project_root, file_path);

CREATE TABLE IF NOT EXISTS code_embedding_chunks (
  project_root TEXT NOT NULL,
  graph_node_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  chunk_kind TEXT,
  symbol_name TEXT,
  language TEXT,
  embedding_json TEXT NOT NULL,
  vector_dimension INTEGER NOT NULL,
  metadata_json TEXT,
  chunk_json TEXT,
  provider_model TEXT NOT NULL,
  run_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_root, graph_node_id)
);

CREATE INDEX IF NOT EXISTS idx_code_embedding_chunks_project_chunk_id
ON code_embedding_chunks(project_root, chunk_id);

CREATE INDEX IF NOT EXISTS idx_code_embedding_chunks_project_file_path
ON code_embedding_chunks(project_root, file_path);
"#;

const UPSERT_GRAPH_NODE_SQL: &str = r#"
INSERT INTO code_graph_nodes (
  project_root, graph_node_id, graph_layer, node_kind, symbol_name,
  file_path, language, scip_symbol, range_json, metadata_json, sources_json, run_id, updated_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP)
ON CONFLICT(project_root, graph_node_id) DO UPDATE SET
  graph_layer = excluded.graph_layer,
  node_kind = excluded.node_kind,
  symbol_name = excluded.symbol_name,
  file_path = excluded.file_path,
  language = excluded.language,
  scip_symbol = excluded.scip_symbol,
  range_json = excluded.range_json,
  metadata_json = excluded.metadata_json,
  sources_json = excluded.sources_json,
  run_id = excluded.run_id,
  updated_at = CURRENT_TIMESTAMP
"#;

const UPSERT_VECTOR_SQL: &str = r#"
INSERT INTO code_embedding_chunks (
  project_root, graph_node_id, chunk_id, file_path, chunk_kind,
  symbol_name, language, embedding_json, vector_dimension, metadata_json,
  chunk_json, provider_model, run_id, updated_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, CURRENT_TIMESTAMP)
ON CONFLICT(project_root, graph_node_id) DO UPDATE SET
  chunk_id = excluded.chunk_id,
  file_path = excluded.file_path,
  chunk_kind = excluded.chunk_kind,
  symbol_name = excluded.symbol_name,
  language = excluded.language,
  embedding_json = excluded.embedding_json,
  vector_dimension = excluded.vector_dimension,
  metadata_json = excluded.metadata_json,
  chunk_json = excluded.chunk_json,
  provider_model = excluded.provider_model,
  run_id = excluded.run_id,
  updated_at = CURRENT_TIMESTAMP
"#;

fn parse_bool(value: Option<String>, fallback: bool) -> bool {
    let Some(value) = value else {
        return fallback;
    };
    let normalized = value.trim().to_lowercase();
    if ["1", "true", "yes", "on"].contains(&normalized.as_str()) {
        return true;
    }
    if ["0", "false", "no", "off"].contains(&normalized.as_str()) {
        return false;
    }
    fallback
}

fn parse_usize(value: Option<String>, fallback: usize, min: usize) -> usize {
    let Some(value) = value else {
        return fallback;
    };
    value
        .trim()
        .parse::<usize>()
        .ok()
        .filter(|parsed| *parsed >= min)
        .unwrap_or(fallback)
}

fn parse_u64(value: Option<String>, fallback: u64, min: u64) -> u64 {
    let Some(value) = value else {
        return fallback;
    };
    value
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|parsed| *parsed >= min)
        .unwrap_or(fallback)
}

fn parse_csv(value: Option<String>, fallback: &[&str]) -> Vec<String> {
    let Some(value) = value else {
        return fallback.iter().map(|entry| (*entry).to_string()).collect();
    };
    let parsed = value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if parsed.is_empty() {
        fallback.iter().map(|entry| (*entry).to_string()).collect()
    } else {
        parsed
    }
}

fn resolve_project_path(project_root: &Path, candidate: &str) -> PathBuf {
    let candidate_path = PathBuf::from(candidate);
    if candidate_path.is_absolute() {
        candidate_path
    } else {
        project_root.join(candidate_path)
    }
}

fn normalize_project_root(path: PathBuf) -> Result<PathBuf, String> {
    std::fs::canonicalize(&path)
        .or_else(|_| {
            if path.is_absolute() {
                Ok(path)
            } else {
                std::env::current_dir().map(|cwd| cwd.join(path))
            }
        })
        .map_err(|error| format!("Failed to resolve CODE_INTEL_PROJECT_ROOT: {error}"))
}

fn is_remote_turso(url: &str) -> bool {
    url.starts_with("libsql://") || url.starts_with("https://")
}

#[derive(Debug, Clone)]
struct CodeIntelConfig {
    run_id: String,
    project_root: PathBuf,
    project_root_key: String,
    turso_database_url: String,
    turso_auth_token: Option<String>,
    kitedb_store_path: PathBuf,
    clear_kitedb: bool,
    clear_turso_project: bool,
    use_scip: bool,
    inputs_paths: Vec<PathBuf>,
    inputs_include: Vec<String>,
    inputs_exclude: Vec<String>,
    vector_base_url: String,
    vector_model: String,
    vector_dimension: usize,
    vector_timeout_ms: u64,
    vector_batch_size: usize,
    vector_concurrency: usize,
    vector_api_key: Option<String>,
}

impl CodeIntelConfig {
    fn from_input(input: Option<CodeIntelSyncInput>) -> Result<Self, String> {
        dotenvy::dotenv().ok();
        let input = input.unwrap_or_default();

        let project_root_raw = input
            .project_root
            .or_else(|| env::var(CODE_INTEL_PROJECT_ROOT_ENV).ok())
            .unwrap_or_else(|| ".".to_string());
        let project_root = normalize_project_root(PathBuf::from(project_root_raw))?;
        let project_root_key = project_root.to_string_lossy().to_string();

        let run_id = format!(
            "run-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| format!("Failed to compute run id timestamp: {error}"))?
                .as_millis()
        );

        let turso_database_url = env::var(TURSO_DATABASE_URL_ENV)
            .map_err(|_| format!("Missing {TURSO_DATABASE_URL_ENV}."))?;
        let turso_auth_token = env::var(TURSO_AUTH_TOKEN_ENV).ok();
        if is_remote_turso(&turso_database_url)
            && turso_auth_token.as_deref().unwrap_or("").is_empty()
        {
            return Err(format!(
                "{TURSO_AUTH_TOKEN_ENV} is required for remote Turso URLs."
            ));
        }

        let kitedb_store_raw = env::var(CODE_INTEL_KITEDB_STORE_ENV)
            .unwrap_or_else(|_| DEFAULT_KITEDB_STORE_PATH.to_string());
        let kitedb_store_path = resolve_project_path(&project_root, &kitedb_store_raw);

        let use_scip = input
            .use_scip
            .unwrap_or_else(|| parse_bool(env::var(CODE_INTEL_SCIP_ENV).ok(), true));
        let clear_kitedb = input
            .clear_kitedb
            .unwrap_or_else(|| parse_bool(env::var(CODE_INTEL_KITEDB_CLEAR_ENV).ok(), true));
        let clear_turso_project = input
            .clear_turso_project
            .unwrap_or_else(|| parse_bool(env::var(CODE_INTEL_TURSO_CLEAR_PROJECT_ENV).ok(), true));

        let input_paths = parse_csv(env::var(CODE_INTEL_PATHS_ENV).ok(), DEFAULT_PATHS)
            .into_iter()
            .map(|path| resolve_project_path(&project_root, &path))
            .collect::<Vec<_>>();
        let input_include = parse_csv(env::var(CODE_INTEL_INCLUDE_ENV).ok(), DEFAULT_INCLUDE);
        let input_exclude = parse_csv(env::var(CODE_INTEL_EXCLUDE_ENV).ok(), DEFAULT_EXCLUDE);

        let vector_base_url = env::var(CODE_INTEL_VECTOR_BASE_URL_ENV)
            .unwrap_or_else(|_| DEFAULT_VECTOR_BASE_URL.to_string());
        let vector_model = env::var(CODE_INTEL_VECTOR_MODEL_ENV)
            .unwrap_or_else(|_| DEFAULT_VECTOR_MODEL.to_string());
        let vector_dimension = parse_usize(
            env::var(CODE_INTEL_VECTOR_DIMENSION_ENV).ok(),
            DEFAULT_VECTOR_DIMENSION,
            1,
        );
        let vector_timeout_ms = parse_u64(
            env::var(CODE_INTEL_VECTOR_TIMEOUT_MS_ENV).ok(),
            DEFAULT_VECTOR_TIMEOUT_MS,
            1_000,
        );
        let vector_batch_size = parse_usize(
            env::var(CODE_INTEL_VECTOR_BATCH_SIZE_ENV).ok(),
            DEFAULT_VECTOR_BATCH_SIZE,
            1,
        );
        let vector_concurrency = parse_usize(
            env::var(CODE_INTEL_VECTOR_CONCURRENCY_ENV).ok(),
            DEFAULT_VECTOR_CONCURRENCY,
            1,
        );
        let vector_api_key = env::var(CODE_INTEL_VECTOR_API_KEY_ENV)
            .ok()
            .or_else(|| env::var(OPENAI_API_KEY_ENV).ok());

        if vector_base_url.contains("api.openai.com")
            && vector_api_key.as_deref().unwrap_or("").trim().is_empty()
        {
            return Err(format!(
                "OpenAI-compatible embeddings require {CODE_INTEL_VECTOR_API_KEY_ENV} or {OPENAI_API_KEY_ENV}."
            ));
        }

        Ok(Self {
            run_id,
            project_root,
            project_root_key,
            turso_database_url,
            turso_auth_token,
            kitedb_store_path,
            clear_kitedb,
            clear_turso_project,
            use_scip,
            inputs_paths: input_paths,
            inputs_include: input_include,
            inputs_exclude: input_exclude,
            vector_base_url,
            vector_model,
            vector_dimension,
            vector_timeout_ms,
            vector_batch_size,
            vector_concurrency,
            vector_api_key,
        })
    }
}

fn extract_scip_symbol(node: &GraphNodeRecord) -> Option<String> {
    if let Some(metadata) = &node.metadata {
        if let Some(value) = metadata.get("scipSymbol").and_then(|value| value.as_str()) {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    if node.id.starts_with("scip:") {
        return Some(node.id.clone());
    }
    None
}

fn value_to_json(value: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("Failed to serialize JSON value: {error}"))
}

fn open_turso_database(runtime: &Runtime, config: &CodeIntelConfig) -> Result<Database, String> {
    let url = config.turso_database_url.clone();
    let token = config.turso_auth_token.clone().unwrap_or_default();
    runtime.block_on(async move {
        if is_remote_turso(&url) {
            return Builder::new_remote(url, token)
                .build()
                .await
                .map_err(|error| format!("Failed to open remote Turso database: {error}"));
        }

        let local_path = url.strip_prefix("file:").unwrap_or(&url).to_string();
        Builder::new_local(local_path)
            .build()
            .await
            .map_err(|error| format!("Failed to open local libSQL database: {error}"))
    })
}

#[derive(Debug, Clone, Default)]
struct TursoCounters {
    syntax_nodes_upserted: u64,
    semantic_nodes_upserted: u64,
    vectors_upserted: u64,
}

struct TursoIndexSink {
    _db: Database,
    conn: Connection,
    runtime: Runtime,
    project_root: String,
    run_id: String,
    provider_model: String,
    counters: TursoCounters,
    error: Option<String>,
}

impl TursoIndexSink {
    fn new(config: &CodeIntelConfig) -> Result<Self, String> {
        let runtime =
            Runtime::new().map_err(|error| format!("Failed to create runtime: {error}"))?;
        let db = open_turso_database(&runtime, config)?;
        let conn = db
            .connect()
            .map_err(|error| format!("Failed to connect to Turso database: {error}"))?;

        let mut sink = Self {
            _db: db,
            conn,
            runtime,
            project_root: config.project_root_key.clone(),
            run_id: config.run_id.clone(),
            provider_model: config.vector_model.clone(),
            counters: TursoCounters::default(),
            error: None,
        };
        sink.ensure_schema()?;
        if config.clear_turso_project {
            sink.clear_project_rows()?;
        }
        Ok(sink)
    }

    fn ensure_schema(&mut self) -> Result<(), String> {
        self.runtime
            .block_on(self.conn.execute_batch(TURSO_SYNC_SCHEMA_SQL))
            .map_err(|error| format!("Failed to initialize Turso sync schema: {error}"))?;
        Ok(())
    }

    fn clear_project_rows(&mut self) -> Result<(), String> {
        let project_root = self.project_root.clone();
        self.runtime
            .block_on(self.conn.execute(
                "DELETE FROM code_embedding_chunks WHERE project_root = ?1",
                [project_root.clone()],
            ))
            .map_err(|error| format!("Failed to clear embedding rows: {error}"))?;
        self.runtime
            .block_on(self.conn.execute(
                "DELETE FROM code_graph_nodes WHERE project_root = ?1",
                [project_root],
            ))
            .map_err(|error| format!("Failed to clear graph rows: {error}"))?;
        Ok(())
    }

    fn upsert_graph_node(
        &mut self,
        layer: GraphLayer,
        node: &GraphNodeRecord,
    ) -> Result<(), String> {
        let graph_layer = match layer {
            GraphLayer::Syntax => "syntax",
            GraphLayer::Semantic => "semantic",
        };
        let range_json = node
            .range
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| format!("Failed to serialize node range: {error}"))?;
        let metadata_json = node.metadata.as_ref().map(value_to_json).transpose()?;
        let sources_json = serde_json::to_string(&node.sources)
            .map_err(|error| format!("Failed to serialize node sources: {error}"))?;
        let scip_symbol = extract_scip_symbol(node);

        self.runtime
            .block_on(self.conn.execute(
                UPSERT_GRAPH_NODE_SQL,
                (
                    self.project_root.clone(),
                    node.id.clone(),
                    graph_layer.to_string(),
                    node.kind.clone(),
                    node.name.clone(),
                    node.file_path.clone(),
                    node.language.clone(),
                    scip_symbol,
                    range_json,
                    metadata_json,
                    Some(sources_json),
                    self.run_id.clone(),
                ),
            ))
            .map_err(|error| format!("Failed to upsert graph node {}: {error}", node.id))?;

        match layer {
            GraphLayer::Syntax => self.counters.syntax_nodes_upserted += 1,
            GraphLayer::Semantic => self.counters.semantic_nodes_upserted += 1,
        }
        Ok(())
    }

    fn upsert_vector_record(&mut self, record: &VectorRecord) -> Result<(), String> {
        let chunk_kind = record.chunk.as_ref().map(|chunk| chunk.kind.clone());
        let symbol_name = record.chunk.as_ref().and_then(|chunk| chunk.name.clone());
        let language = record.chunk.as_ref().map(|chunk| chunk.language.clone());
        let chunk_json = record
            .chunk
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| format!("Failed to serialize vector chunk payload: {error}"))?;
        let metadata_json = record.metadata.as_ref().map(value_to_json).transpose()?;
        let embedding_json = serde_json::to_string(&record.embedding)
            .map_err(|error| format!("Failed to serialize embedding vector: {error}"))?;
        let vector_dimension = i64::try_from(record.embedding.len())
            .map_err(|_| "Embedding vector length overflowed i64.".to_string())?;

        self.runtime
            .block_on(self.conn.execute(
                UPSERT_VECTOR_SQL,
                (
                    self.project_root.clone(),
                    record.chunk_id.clone(),
                    record.chunk_id.clone(),
                    record.file_path.clone(),
                    chunk_kind,
                    symbol_name,
                    language,
                    embedding_json,
                    vector_dimension,
                    metadata_json,
                    chunk_json,
                    self.provider_model.clone(),
                    self.run_id.clone(),
                ),
            ))
            .map_err(|error| {
                format!(
                    "Failed to upsert vector record {}: {error}",
                    record.chunk_id
                )
            })?;

        self.counters.vectors_upserted += 1;
        Ok(())
    }

    fn capture_error(&mut self, error: String) {
        if self.error.is_none() {
            self.error = Some(error);
        }
    }
}

impl ParseSink for TursoIndexSink {}

impl GraphSink for TursoIndexSink {
    fn on_graph_batch(&mut self, batch: GraphBatch) {
        if self.error.is_some() {
            return;
        }
        for node in &batch.nodes {
            if let Err(error) = self.upsert_graph_node(batch.layer, node) {
                self.capture_error(error);
                return;
            }
        }
    }
}

impl VectorSink for TursoIndexSink {
    fn on_vector_batch(&mut self, batch: VectorBatch) {
        if self.error.is_some() {
            return;
        }
        for record in &batch {
            if let Err(error) = self.upsert_vector_record(record) {
                self.capture_error(error);
                return;
            }
        }
    }
}

impl ScipSink for TursoIndexSink {
    fn on_scip_batch(&mut self, batch: GraphBatch) {
        self.on_graph_batch(batch);
    }
}

impl IndexSink for TursoIndexSink {}

struct HybridSink {
    kitedb: Option<KiteDbIndexSink>,
    turso: TursoIndexSink,
}

impl HybridSink {
    fn new(kitedb: KiteDbIndexSink, turso: TursoIndexSink) -> Self {
        Self {
            kitedb: Some(kitedb),
            turso,
        }
    }

    fn finish(mut self) -> Result<TursoCounters, String> {
        if let Some(error) = self.turso.error.take() {
            if let Some(kitedb) = self.kitedb.take() {
                let _ = kitedb.abort();
            }
            return Err(error);
        }

        if let Some(kitedb) = self.kitedb.take() {
            kitedb
                .finish()
                .map_err(|error| format!("Failed to finalize KiteDB sink: {error}"))?;
        }

        Ok(self.turso.counters)
    }

    fn abort(mut self) {
        if let Some(kitedb) = self.kitedb.take() {
            let _ = kitedb.abort();
        }
    }
}

impl ParseSink for HybridSink {
    fn on_parse_batch_ref(&mut self, batch: &[argus_search::core::parse::types::CodeChunk]) {
        if let Some(kitedb) = self.kitedb.as_mut() {
            kitedb.on_parse_batch_ref(batch);
        }
        self.turso.on_parse_batch_ref(batch);
    }
}

impl GraphSink for HybridSink {
    fn on_graph_batch(&mut self, batch: GraphBatch) {
        if let Some(kitedb) = self.kitedb.as_mut() {
            kitedb.on_graph_batch(batch.clone());
        }
        self.turso.on_graph_batch(batch);
    }
}

impl VectorSink for HybridSink {
    fn on_vector_batch(&mut self, batch: VectorBatch) {
        if let Some(kitedb) = self.kitedb.as_mut() {
            kitedb.on_vector_batch(batch.clone());
        }
        self.turso.on_vector_batch(batch);
    }
}

impl ScipSink for HybridSink {
    fn on_scip_batch(&mut self, batch: GraphBatch) {
        if let Some(kitedb) = self.kitedb.as_mut() {
            kitedb.on_scip_batch(batch.clone());
        }
        self.turso.on_scip_batch(batch);
    }
}

impl IndexSink for HybridSink {
    fn disable_parse_skip(&self, phases: IndexPhases) -> bool {
        let kitedb_forces = self
            .kitedb
            .as_ref()
            .map(|sink| sink.disable_parse_skip(phases))
            .unwrap_or(false);
        kitedb_forces || self.turso.disable_parse_skip(phases)
    }

    fn on_parsed_files(
        &mut self,
        files: &[argus_search::core::parse::types::ParsedFile],
        phases: IndexPhases,
    ) -> Result<(), String> {
        if let Some(kitedb) = self.kitedb.as_mut() {
            kitedb.on_parsed_files(files, phases)?;
        }
        self.turso.on_parsed_files(files, phases)
    }

    fn on_event(&mut self, event: IndexEvent) {
        if let Some(kitedb) = self.kitedb.as_mut() {
            kitedb.on_event(event.clone());
        }
        self.turso.on_event(event);
    }
}

fn run_index_sync_blocking(config: CodeIntelConfig) -> Result<CodeIntelSyncResult, String> {
    let mut options = IndexOptions::new(config.project_root.clone());
    options.inputs = ParseInputs {
        paths: config.inputs_paths.clone(),
        include: config.inputs_include.clone(),
        exclude: config.inputs_exclude.clone(),
        respect_gitignore: true,
    };
    options.phases = IndexPhases {
        parse: true,
        graph: true,
        vector: true,
        scip: config.use_scip,
        index_pack: false,
    };
    options.vector.batch_size = config.vector_batch_size;
    options.vector.concurrency = config.vector_concurrency;
    options.vector.include_chunk = true;

    let mut provider_config = HttpEmbeddingConfig::new(
        config.vector_base_url.clone(),
        config.vector_api_key.clone(),
        config.vector_model.clone(),
    );
    provider_config.dimension = Some(config.vector_dimension);
    provider_config.timeout = Some(Duration::from_millis(config.vector_timeout_ms));
    let provider = HttpEmbeddingsProvider::new(provider_config)
        .map_err(|error| format!("Failed to configure embeddings provider: {error}"))?;
    options.vector_provider = Some(Arc::new(provider));

    let cancel = CancelToken::new();
    let kitedb_sink = KiteDbIndexSink::new(config.kitedb_store_path.clone(), config.clear_kitedb);
    let turso_sink = TursoIndexSink::new(&config)?;
    let mut sink = HybridSink::new(kitedb_sink, turso_sink);

    let engine = IndexEngine::new(options);
    let stats = match engine.run(&mut sink, &cancel) {
        Ok(stats) => stats,
        Err(error) => {
            sink.abort();
            return Err(format!("Code intelligence indexing failed: {error}"));
        }
    };

    let counters = sink.finish()?;
    let parse_stats = stats.parse.unwrap_or_default();

    Ok(CodeIntelSyncResult {
        run_id: config.run_id,
        project_root: config.project_root_key,
        kitedb_store_path: config.kitedb_store_path.to_string_lossy().to_string(),
        syntax_nodes_upserted: counters.syntax_nodes_upserted,
        semantic_nodes_upserted: counters.semantic_nodes_upserted,
        vectors_upserted: counters.vectors_upserted,
        files_parsed: parse_stats.files_parsed,
        files_skipped: parse_stats.files_skipped,
        chunks_emitted: parse_stats.chunks_emitted,
    })
}

pub async fn run_code_intel_sync(
    input: Option<CodeIntelSyncInput>,
) -> Result<CodeIntelSyncResult, String> {
    let config = CodeIntelConfig::from_input(input)?;
    tauri::async_runtime::spawn_blocking(move || run_index_sync_blocking(config))
        .await
        .map_err(|error| format!("Code intelligence sync task failed: {error}"))?
}
