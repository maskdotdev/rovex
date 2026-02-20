use std::sync::atomic::{AtomicU64, Ordering};

use super::super::common::{
    parse_bool_i64, parse_json_vec_or_default, parse_limit, parse_optional_json_vec,
    MAX_PROGRESS_EVENTS_PER_RUN,
};
use crate::backend::{
    AiReviewChunk, AiReviewFinding, AiReviewProgressEvent, AiReviewRun, AppState,
    CreateInlineReviewCommentInput, GenerateAiReviewResult, InlineReviewComment,
    ListInlineReviewCommentsInput, StartAiReviewRunInput,
};

static INLINE_REVIEW_COMMENT_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_inline_review_comment_id() -> String {
    let counter = INLINE_REVIEW_COMMENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!("comment-{millis}-{counter}")
}

fn normalize_comment_side(raw: &str) -> Option<&'static str> {
    let value = raw.trim().to_lowercase();
    match value.as_str() {
        "additions" | "addition" | "added" => Some("additions"),
        "deletions" | "deletion" | "removed" => Some("deletions"),
        _ => None,
    }
}

fn parse_ai_review_run_from_row(row: &libsql::Row) -> Result<AiReviewRun, String> {
    let chunks_json: Option<String> = row
        .get(22)
        .map_err(|error| format!("Failed to parse run chunks_json: {error}"))?;
    let findings_json: Option<String> = row
        .get(23)
        .map_err(|error| format!("Failed to parse run findings_json: {error}"))?;
    let progress_events_json: Option<String> = row
        .get(24)
        .map_err(|error| format!("Failed to parse run progress_events_json: {error}"))?;
    let diff_truncated: i64 = row
        .get(20)
        .map_err(|error| format!("Failed to parse run diff_truncated: {error}"))?;
    let total_chunks: i64 = row
        .get(12)
        .map_err(|error| format!("Failed to parse run total_chunks: {error}"))?;
    let completed_chunks: i64 = row
        .get(13)
        .map_err(|error| format!("Failed to parse run completed_chunks: {error}"))?;
    let failed_chunks: i64 = row
        .get(14)
        .map_err(|error| format!("Failed to parse run failed_chunks: {error}"))?;
    let finding_count: i64 = row
        .get(15)
        .map_err(|error| format!("Failed to parse run finding_count: {error}"))?;
    let diff_chars_used: Option<i64> = row
        .get(18)
        .map_err(|error| format!("Failed to parse run diff_chars_used: {error}"))?;
    let diff_chars_total: Option<i64> = row
        .get(19)
        .map_err(|error| format!("Failed to parse run diff_chars_total: {error}"))?;

    Ok(AiReviewRun {
        run_id: row
            .get(0)
            .map_err(|error| format!("Failed to parse run_id: {error}"))?,
        thread_id: row
            .get(1)
            .map_err(|error| format!("Failed to parse run thread_id: {error}"))?,
        workspace: row
            .get(2)
            .map_err(|error| format!("Failed to parse run workspace: {error}"))?,
        base_ref: row
            .get(3)
            .map_err(|error| format!("Failed to parse run base_ref: {error}"))?,
        merge_base: row
            .get(4)
            .map_err(|error| format!("Failed to parse run merge_base: {error}"))?,
        head: row
            .get(5)
            .map_err(|error| format!("Failed to parse run head: {error}"))?,
        files_changed: row
            .get(6)
            .map_err(|error| format!("Failed to parse run files_changed: {error}"))?,
        insertions: row
            .get(7)
            .map_err(|error| format!("Failed to parse run insertions: {error}"))?,
        deletions: row
            .get(8)
            .map_err(|error| format!("Failed to parse run deletions: {error}"))?,
        prompt: row
            .get(9)
            .map_err(|error| format!("Failed to parse run prompt: {error}"))?,
        scope_label: row
            .get(10)
            .map_err(|error| format!("Failed to parse run scope_label: {error}"))?,
        status: row
            .get(11)
            .map_err(|error| format!("Failed to parse run status: {error}"))?,
        total_chunks: total_chunks.max(0) as usize,
        completed_chunks: completed_chunks.max(0) as usize,
        failed_chunks: failed_chunks.max(0) as usize,
        finding_count: finding_count.max(0) as usize,
        model: row
            .get(16)
            .map_err(|error| format!("Failed to parse run model: {error}"))?,
        review: row
            .get(17)
            .map_err(|error| format!("Failed to parse run review: {error}"))?,
        diff_chars_used: diff_chars_used.map(|value| value.max(0) as usize),
        diff_chars_total: diff_chars_total.map(|value| value.max(0) as usize),
        diff_truncated: diff_truncated != 0,
        error: row
            .get(21)
            .map_err(|error| format!("Failed to parse run error: {error}"))?,
        chunks: parse_optional_json_vec(chunks_json),
        findings: parse_optional_json_vec(findings_json),
        progress_events: parse_optional_json_vec(progress_events_json),
        created_at: row
            .get(25)
            .map_err(|error| format!("Failed to parse run created_at: {error}"))?,
        started_at: row
            .get(26)
            .map_err(|error| format!("Failed to parse run started_at: {error}"))?,
        ended_at: row
            .get(27)
            .map_err(|error| format!("Failed to parse run ended_at: {error}"))?,
        canceled_at: row
            .get(28)
            .map_err(|error| format!("Failed to parse run canceled_at: {error}"))?,
    })
}

fn parse_inline_review_comment_from_row(row: &libsql::Row) -> Result<InlineReviewComment, String> {
    Ok(InlineReviewComment {
        id: row
            .get(0)
            .map_err(|error| format!("Failed to parse inline comment id: {error}"))?,
        thread_id: row
            .get(1)
            .map_err(|error| format!("Failed to parse inline comment thread_id: {error}"))?,
        workspace: row
            .get(2)
            .map_err(|error| format!("Failed to parse inline comment workspace: {error}"))?,
        base_ref: row
            .get(3)
            .map_err(|error| format!("Failed to parse inline comment base_ref: {error}"))?,
        merge_base: row
            .get(4)
            .map_err(|error| format!("Failed to parse inline comment merge_base: {error}"))?,
        head: row
            .get(5)
            .map_err(|error| format!("Failed to parse inline comment head: {error}"))?,
        file_path: row
            .get(6)
            .map_err(|error| format!("Failed to parse inline comment file_path: {error}"))?,
        side: row
            .get(7)
            .map_err(|error| format!("Failed to parse inline comment side: {error}"))?,
        line_number: row
            .get(8)
            .map_err(|error| format!("Failed to parse inline comment line_number: {error}"))?,
        end_side: row
            .get(9)
            .map_err(|error| format!("Failed to parse inline comment end_side: {error}"))?,
        end_line_number: row
            .get(10)
            .map_err(|error| format!("Failed to parse inline comment end_line_number: {error}"))?,
        body: row
            .get(11)
            .map_err(|error| format!("Failed to parse inline comment body: {error}"))?,
        author: row
            .get(12)
            .map_err(|error| format!("Failed to parse inline comment author: {error}"))?,
        created_at: row
            .get(13)
            .map_err(|error| format!("Failed to parse inline comment created_at: {error}"))?,
        updated_at: row
            .get(14)
            .map_err(|error| format!("Failed to parse inline comment updated_at: {error}"))?,
    })
}

pub(crate) async fn insert_ai_review_run(
    state: &AppState,
    run_id: &str,
    input: &StartAiReviewRunInput,
    reviewer_goal: &str,
    total_chunks: usize,
) -> Result<(), String> {
    let conn = state.connection()?;
    conn.execute(
        "INSERT INTO ai_review_runs (
            run_id, thread_id, workspace, base_ref, merge_base, head, files_changed, insertions, deletions,
            prompt, scope_label, status, total_chunks, completed_chunks, failed_chunks, finding_count,
            diff_chars_total
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'queued', ?12, 0, 0, 0, ?13)",
        (
            run_id.to_string(),
            input.thread_id,
            input.workspace.trim().to_string(),
            input.base_ref.trim().to_string(),
            input.merge_base.trim().to_string(),
            input.head.trim().to_string(),
            input.files_changed,
            input.insertions,
            input.deletions,
            Some(reviewer_goal.to_string()),
            input.scope_label.clone(),
            i64::try_from(total_chunks).unwrap_or(i64::MAX),
            i64::try_from(input.diff.chars().count()).unwrap_or(i64::MAX),
        ),
    )
    .await
    .map_err(|error| format!("Failed to insert AI review run: {error}"))?;
    Ok(())
}

pub(crate) async fn load_ai_review_run_by_id(
    state: &AppState,
    run_id: &str,
) -> Result<AiReviewRun, String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT
              run_id, thread_id, workspace, base_ref, merge_base, head, files_changed, insertions, deletions,
              prompt, scope_label, status, total_chunks, completed_chunks, failed_chunks, finding_count,
              model, review, diff_chars_used, diff_chars_total, diff_truncated, error,
              chunks_json, findings_json, progress_events_json,
              created_at, started_at, ended_at, canceled_at
             FROM ai_review_runs
             WHERE run_id = ?1
             LIMIT 1",
            [run_id.to_string()],
        )
        .await
        .map_err(|error| format!("Failed to query AI review run: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read AI review run row: {error}"))?
    else {
        return Err(format!("AI review run '{run_id}' was not found."));
    };

    parse_ai_review_run_from_row(&row)
}

pub(crate) async fn list_ai_review_runs_internal(
    state: &AppState,
    thread_id: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<AiReviewRun>, String> {
    let conn = state.connection()?;
    let requested_limit = parse_limit(limit);
    let mut rows = if let Some(thread_id) = thread_id {
        conn.query(
            "SELECT
              run_id, thread_id, workspace, base_ref, merge_base, head, files_changed, insertions, deletions,
              prompt, scope_label, status, total_chunks, completed_chunks, failed_chunks, finding_count,
              model, review, diff_chars_used, diff_chars_total, diff_truncated, error,
              chunks_json, findings_json, progress_events_json,
              created_at, started_at, ended_at, canceled_at
             FROM ai_review_runs
             WHERE thread_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
            (thread_id, requested_limit),
        )
        .await
        .map_err(|error| format!("Failed to list AI review runs: {error}"))?
    } else {
        conn.query(
            "SELECT
              run_id, thread_id, workspace, base_ref, merge_base, head, files_changed, insertions, deletions,
              prompt, scope_label, status, total_chunks, completed_chunks, failed_chunks, finding_count,
              model, review, diff_chars_used, diff_chars_total, diff_truncated, error,
              chunks_json, findings_json, progress_events_json,
              created_at, started_at, ended_at, canceled_at
             FROM ai_review_runs
             ORDER BY created_at DESC
             LIMIT ?1",
            [requested_limit],
        )
        .await
        .map_err(|error| format!("Failed to list AI review runs: {error}"))?
    };

    let mut runs = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read AI review run rows: {error}"))?
    {
        runs.push(parse_ai_review_run_from_row(&row)?);
    }
    Ok(runs)
}

pub(crate) async fn set_ai_review_run_status(
    state: &AppState,
    run_id: &str,
    status: &str,
    error: Option<&str>,
    mark_started: bool,
    mark_ended: bool,
    mark_canceled: bool,
) -> Result<(), String> {
    let conn = state.connection()?;
    conn.execute(
        "UPDATE ai_review_runs
         SET status = ?2,
             error = ?3,
             started_at = CASE WHEN ?4 = 1 AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
             ended_at = CASE WHEN ?5 = 1 THEN CURRENT_TIMESTAMP ELSE ended_at END,
             canceled_at = CASE WHEN ?6 = 1 THEN CURRENT_TIMESTAMP ELSE canceled_at END
         WHERE run_id = ?1",
        (
            run_id.to_string(),
            status.to_string(),
            error.map(ToOwned::to_owned),
            parse_bool_i64(mark_started),
            parse_bool_i64(mark_ended),
            parse_bool_i64(mark_canceled),
        ),
    )
    .await
    .map_err(|error| format!("Failed to update AI review run status: {error}"))?;
    Ok(())
}

pub(crate) async fn append_ai_review_run_progress(
    state: &AppState,
    run_id: &str,
    event: &AiReviewProgressEvent,
) -> Result<(), String> {
    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT chunks_json, findings_json, progress_events_json, failed_chunks
             FROM ai_review_runs WHERE run_id = ?1 LIMIT 1",
            [run_id.to_string()],
        )
        .await
        .map_err(|error| format!("Failed to load run progress state: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read run progress row: {error}"))?
    else {
        return Ok(());
    };

    let mut chunks: Vec<AiReviewChunk> =
        parse_json_vec_or_default(&row.get::<String>(0).unwrap_or_else(|_| "[]".to_string()));
    let mut findings: Vec<AiReviewFinding> =
        parse_json_vec_or_default(&row.get::<String>(1).unwrap_or_else(|_| "[]".to_string()));
    let mut events: Vec<AiReviewProgressEvent> =
        parse_json_vec_or_default(&row.get::<String>(2).unwrap_or_else(|_| "[]".to_string()));
    let mut failed_chunks: i64 = row.get(3).unwrap_or(0);

    if let Some(chunk) = &event.chunk {
        if let Some(index) = chunks.iter().position(|entry| entry.id == chunk.id) {
            chunks[index] = chunk.clone();
        } else {
            chunks.push(chunk.clone());
        }
        chunks.sort_by(|left, right| {
            left.file_path
                .cmp(&right.file_path)
                .then(left.chunk_index.cmp(&right.chunk_index))
        });
    }
    if let Some(finding) = &event.finding {
        if !findings.iter().any(|entry| entry.id == finding.id) {
            findings.push(finding.clone());
        }
    }
    if event.status == "chunk-failed" {
        failed_chunks += 1;
    }

    events.push(event.clone());
    if events.len() > MAX_PROGRESS_EVENTS_PER_RUN {
        let start = events.len() - MAX_PROGRESS_EVENTS_PER_RUN;
        events = events.split_off(start);
    }

    let chunks_json = serde_json::to_string(&chunks)
        .map_err(|error| format!("Failed to serialize chunk progress: {error}"))?;
    let findings_json = serde_json::to_string(&findings)
        .map_err(|error| format!("Failed to serialize findings progress: {error}"))?;
    let events_json = serde_json::to_string(&events)
        .map_err(|error| format!("Failed to serialize event progress: {error}"))?;

    conn.execute(
        "UPDATE ai_review_runs
         SET chunks_json = ?2,
             findings_json = ?3,
             progress_events_json = ?4,
             completed_chunks = ?5,
             total_chunks = ?6,
             finding_count = ?7,
             failed_chunks = ?8
         WHERE run_id = ?1",
        (
            run_id.to_string(),
            chunks_json,
            findings_json,
            events_json,
            i64::try_from(event.completed_chunks).unwrap_or(i64::MAX),
            i64::try_from(event.total_chunks).unwrap_or(i64::MAX),
            i64::try_from(findings.len()).unwrap_or(i64::MAX),
            failed_chunks,
        ),
    )
    .await
    .map_err(|error| format!("Failed to persist run progress: {error}"))?;
    Ok(())
}

pub(crate) async fn finalize_ai_review_run(
    state: &AppState,
    run_id: &str,
    result: &GenerateAiReviewResult,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let conn = state.connection()?;
    conn.execute(
        "UPDATE ai_review_runs
         SET status = ?2,
             model = ?3,
             review = ?4,
             diff_chars_used = ?5,
             diff_chars_total = ?6,
             diff_truncated = ?7,
             error = ?8,
             chunks_json = ?9,
             findings_json = ?10,
             completed_chunks = ?11,
             total_chunks = ?12,
             finding_count = ?13,
             ended_at = CURRENT_TIMESTAMP
         WHERE run_id = ?1",
        (
            run_id.to_string(),
            status.to_string(),
            Some(result.model.clone()),
            Some(result.review.clone()),
            i64::try_from(result.diff_chars_used).unwrap_or(i64::MAX),
            i64::try_from(result.diff_chars_total).unwrap_or(i64::MAX),
            parse_bool_i64(result.diff_truncated),
            error.map(ToOwned::to_owned),
            serde_json::to_string(&result.chunks).map_err(|serialize_error| {
                format!("Failed to serialize final chunks: {serialize_error}")
            })?,
            serde_json::to_string(&result.findings).map_err(|serialize_error| {
                format!("Failed to serialize final findings: {serialize_error}")
            })?,
            i64::try_from(result.chunks.len()).unwrap_or(i64::MAX),
            i64::try_from(result.chunks.len()).unwrap_or(i64::MAX),
            i64::try_from(result.findings.len()).unwrap_or(i64::MAX),
        ),
    )
    .await
    .map_err(|error| format!("Failed to finalize AI review run: {error}"))?;
    Ok(())
}

pub(crate) async fn insert_inline_review_comment(
    state: &AppState,
    input: &CreateInlineReviewCommentInput,
) -> Result<InlineReviewComment, String> {
    let workspace = input.workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace is required for inline comments.".to_string());
    }
    let base_ref = input.base_ref.trim();
    if base_ref.is_empty() {
        return Err("Base ref is required for inline comments.".to_string());
    }
    let merge_base = input.merge_base.trim();
    if merge_base.is_empty() {
        return Err("Merge base is required for inline comments.".to_string());
    }
    let head = input.head.trim();
    if head.is_empty() {
        return Err("Head ref is required for inline comments.".to_string());
    }
    let file_path = input.file_path.trim();
    if file_path.is_empty() {
        return Err("File path is required for inline comments.".to_string());
    }
    let side = normalize_comment_side(&input.side)
        .ok_or_else(|| "Comment side must be 'additions' or 'deletions'.".to_string())?;
    if input.line_number <= 0 {
        return Err("Comment line number must be positive.".to_string());
    }
    let mut line_number = input.line_number;
    let mut end_side = input
        .end_side
        .as_deref()
        .and_then(normalize_comment_side)
        .map(ToOwned::to_owned);
    let mut end_line_number = input.end_line_number;
    if end_line_number.is_some() && end_side.is_none() {
        end_side = Some(side.to_string());
    }
    if let Some(value) = end_line_number {
        if value <= 0 {
            return Err("Comment end line number must be positive.".to_string());
        }
    }
    if end_line_number.is_none() && end_side.is_some() {
        end_line_number = Some(line_number);
    }
    if let (Some(target_end_side), Some(target_end_line)) = (end_side.as_deref(), end_line_number) {
        if target_end_side == side && target_end_line < line_number {
            line_number = target_end_line;
            end_line_number = Some(input.line_number);
        }
    }
    if end_line_number == Some(line_number) && end_side.as_deref() == Some(side) {
        end_line_number = None;
        end_side = None;
    }
    let body = input.body.trim();
    if body.is_empty() {
        return Err("Comment body must not be empty.".to_string());
    }
    let author = input
        .author
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("You")
        .to_string();

    let comment_id = next_inline_review_comment_id();
    let conn = state.connection()?;
    conn.execute(
        "INSERT INTO inline_review_comments (
            id, thread_id, workspace, base_ref, merge_base, head, file_path, side, line_number, end_side, end_line_number, body, author
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        (
            comment_id.clone(),
            input.thread_id,
            workspace.to_string(),
            base_ref.to_string(),
            merge_base.to_string(),
            head.to_string(),
            file_path.to_string(),
            side.to_string(),
            line_number,
            end_side,
            end_line_number,
            body.to_string(),
            author.clone(),
        ),
    )
    .await
    .map_err(|error| format!("Failed to create inline review comment: {error}"))?;

    let mut rows = conn
        .query(
            "SELECT
               id, thread_id, workspace, base_ref, merge_base, head, file_path, side, line_number,
               end_side, end_line_number, body, author, created_at, updated_at
             FROM inline_review_comments
             WHERE id = ?1
             LIMIT 1",
            [comment_id],
        )
        .await
        .map_err(|error| format!("Failed to load created inline review comment: {error}"))?;

    let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read created inline review comment row: {error}"))?
    else {
        return Err("Inline review comment was created but could not be loaded.".to_string());
    };

    parse_inline_review_comment_from_row(&row)
}

pub(crate) async fn list_inline_review_comments_internal(
    state: &AppState,
    input: &ListInlineReviewCommentsInput,
) -> Result<Vec<InlineReviewComment>, String> {
    let workspace = input.workspace.trim();
    if workspace.is_empty() {
        return Ok(Vec::new());
    }
    let base_ref = input.base_ref.trim();
    let merge_base = input.merge_base.trim();
    let head = input.head.trim();
    if base_ref.is_empty() || merge_base.is_empty() || head.is_empty() {
        return Ok(Vec::new());
    }

    let conn = state.connection()?;
    let mut rows = conn
        .query(
            "SELECT
               id, thread_id, workspace, base_ref, merge_base, head, file_path, side, line_number,
               end_side, end_line_number, body, author, created_at, updated_at
             FROM inline_review_comments
             WHERE thread_id = ?1
               AND workspace = ?2
               AND base_ref = ?3
               AND merge_base = ?4
               AND head = ?5
             ORDER BY created_at ASC, id ASC",
            (
                input.thread_id,
                workspace.to_string(),
                base_ref.to_string(),
                merge_base.to_string(),
                head.to_string(),
            ),
        )
        .await
        .map_err(|error| format!("Failed to list inline review comments: {error}"))?;

    let mut comments = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed to read inline review comment rows: {error}"))?
    {
        comments.push(parse_inline_review_comment_from_row(&row)?);
    }
    Ok(comments)
}
