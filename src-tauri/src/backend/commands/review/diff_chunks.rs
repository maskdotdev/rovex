use std::{collections::BTreeSet, fs, path::Path};

use serde::Deserialize;

use super::super::common::{
    snippet, truncate_chars, MAX_CHUNK_FILE_CONTEXT_CHARS, MAX_CHUNK_FILE_CONTEXT_WINDOWS,
};
use crate::backend::{AiReviewChunk, AiReviewFinding};

#[derive(Debug, Clone)]
pub(crate) struct DiffChunk {
    pub(crate) id: String,
    pub(crate) file_path: String,
    pub(crate) previous_path: Option<String>,
    pub(crate) chunk_index: usize,
    pub(crate) hunk_header: String,
    pub(crate) patch: String,
    pub(crate) addition_lines: Vec<i64>,
    pub(crate) deletion_lines: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChunkFindingPayload {
    pub(crate) title: Option<String>,
    pub(crate) body: Option<String>,
    pub(crate) severity: Option<String>,
    pub(crate) confidence: Option<f64>,
    pub(crate) side: Option<String>,
    pub(crate) line_number: Option<i64>,
    pub(crate) line: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChunkReviewPayload {
    pub(crate) summary: Option<String>,
    pub(crate) findings: Option<Vec<ChunkFindingPayload>>,
}

fn normalize_patch_path(value: &str) -> Option<String> {
    let normalized = value.trim().trim_matches('"');
    if normalized.is_empty() || normalized == "/dev/null" {
        return None;
    }
    let without_prefix = normalized
        .strip_prefix("a/")
        .or_else(|| normalized.strip_prefix("b/"))
        .unwrap_or(normalized);
    Some(without_prefix.to_string())
}

fn parse_hunk_line_start(spec: &str, prefix: char) -> Option<i64> {
    let trimmed = spec.trim();
    let rest = trimmed.strip_prefix(prefix)?;
    let (start, _) = rest.split_once(',').unwrap_or((rest, ""));
    start.trim().parse::<i64>().ok()
}

fn parse_hunk_positions(header: &str) -> Option<(i64, i64)> {
    if !header.starts_with("@@") {
        return None;
    }
    let mut parts = header.split_whitespace();
    let marker = parts.next()?;
    if marker != "@@" {
        return None;
    }
    let old_spec = parts.next()?;
    let new_spec = parts.next()?;
    let old_start = parse_hunk_line_start(old_spec, '-')?;
    let new_start = parse_hunk_line_start(new_spec, '+')?;
    Some((old_start, new_start))
}

pub(crate) fn parse_diff_chunks(diff: &str) -> Vec<DiffChunk> {
    #[derive(Default)]
    struct FileState {
        file_path: Option<String>,
        previous_path: Option<String>,
        headers: Vec<String>,
        chunk_count: usize,
    }
    struct HunkState {
        header: String,
        lines: Vec<String>,
        old_line: i64,
        new_line: i64,
        addition_lines: BTreeSet<i64>,
        deletion_lines: BTreeSet<i64>,
    }

    fn finalize_hunk(
        chunks: &mut Vec<DiffChunk>,
        file_state: &mut FileState,
        hunk_state: Option<HunkState>,
    ) {
        let Some(hunk_state) = hunk_state else {
            return;
        };
        let Some(file_path) = file_state.file_path.clone() else {
            return;
        };
        file_state.chunk_count += 1;
        let chunk_index = file_state.chunk_count;
        let chunk_id = format!("{file_path}#chunk-{chunk_index}");
        let mut patch_parts = Vec::new();
        patch_parts.extend(file_state.headers.clone());
        patch_parts.push(hunk_state.header.clone());
        patch_parts.extend(hunk_state.lines.clone());
        let patch = if patch_parts.is_empty() {
            String::new()
        } else {
            let mut joined = patch_parts.join("\n");
            joined.push('\n');
            joined
        };

        chunks.push(DiffChunk {
            id: chunk_id,
            file_path,
            previous_path: file_state.previous_path.clone(),
            chunk_index,
            hunk_header: hunk_state.header,
            patch,
            addition_lines: hunk_state.addition_lines.into_iter().collect(),
            deletion_lines: hunk_state.deletion_lines.into_iter().collect(),
        });
    }

    let mut chunks = Vec::new();
    let mut file_state = FileState::default();
    let mut hunk_state: Option<HunkState> = None;

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            finalize_hunk(&mut chunks, &mut file_state, hunk_state.take());
            file_state = FileState::default();
            file_state.headers.push(line.to_string());

            let mut parts = line.split_whitespace();
            let _ = parts.next();
            let _ = parts.next();
            let old_path = parts.next().and_then(normalize_patch_path);
            let new_path = parts.next().and_then(normalize_patch_path);
            file_state.previous_path = old_path;
            file_state.file_path = new_path.or_else(|| file_state.previous_path.clone());
            continue;
        }

        if line.starts_with("@@ ") && line.contains(" @@") {
            finalize_hunk(&mut chunks, &mut file_state, hunk_state.take());
            let (old_start, new_start) = parse_hunk_positions(line).unwrap_or((1, 1));
            hunk_state = Some(HunkState {
                header: line.to_string(),
                lines: Vec::new(),
                old_line: old_start.max(1),
                new_line: new_start.max(1),
                addition_lines: BTreeSet::new(),
                deletion_lines: BTreeSet::new(),
            });
            continue;
        }

        if let Some(hunk) = hunk_state.as_mut() {
            hunk.lines.push(line.to_string());
            if let Some(prefix) = line.chars().next() {
                match prefix {
                    '+' => {
                        if !line.starts_with("+++") {
                            hunk.addition_lines.insert(hunk.new_line.max(1));
                            hunk.new_line += 1;
                        }
                    }
                    '-' => {
                        if !line.starts_with("---") {
                            hunk.deletion_lines.insert(hunk.old_line.max(1));
                            hunk.old_line += 1;
                        }
                    }
                    ' ' => {
                        hunk.old_line += 1;
                        hunk.new_line += 1;
                    }
                    '\\' => {}
                    _ => {}
                }
            }
            continue;
        }

        if file_state.file_path.is_some() {
            if line.starts_with("--- ") {
                file_state.previous_path = normalize_patch_path(line.trim_start_matches("--- "));
            } else if line.starts_with("+++ ") {
                let new_path = normalize_patch_path(line.trim_start_matches("+++ "));
                if new_path.is_some() {
                    file_state.file_path = new_path;
                }
            }
            file_state.headers.push(line.to_string());
        }
    }

    finalize_hunk(&mut chunks, &mut file_state, hunk_state.take());
    chunks
}

fn merge_line_windows(line_numbers: &[i64], max_line: i64) -> Vec<(i64, i64)> {
    let mut windows: Vec<(i64, i64)> = Vec::new();
    let mut sorted_lines = line_numbers
        .iter()
        .copied()
        .filter(|line| *line > 0)
        .collect::<Vec<_>>();
    sorted_lines.sort_unstable();
    sorted_lines.dedup();

    for line in sorted_lines {
        let start = (line - 10).max(1);
        let end = (line + 10).min(max_line.max(1));
        if let Some((_, previous_end)) = windows.last_mut() {
            if start <= *previous_end + 2 {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        windows.push((start, end));
        if windows.len() >= MAX_CHUNK_FILE_CONTEXT_WINDOWS {
            break;
        }
    }

    windows
}

pub(crate) fn format_workspace_file_context(workspace: &str, chunk: &DiffChunk) -> Option<String> {
    let repo_path = Path::new(workspace);
    let primary_path = repo_path.join(&chunk.file_path);
    let (context_path, source) = if primary_path.exists() {
        (primary_path, chunk.file_path.clone())
    } else if let Some(previous_path) = &chunk.previous_path {
        let fallback = repo_path.join(previous_path);
        if fallback.exists() {
            (fallback, previous_path.clone())
        } else {
            return None;
        }
    } else {
        return None;
    };

    let content = fs::read_to_string(&context_path).ok()?;
    let lines = content.lines().collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }

    let target_lines = if chunk.addition_lines.is_empty() {
        vec![1]
    } else {
        chunk.addition_lines.clone()
    };
    let windows = merge_line_windows(&target_lines, lines.len() as i64);
    if windows.is_empty() {
        return None;
    }

    let mut sections = Vec::new();
    for (start, end) in windows {
        sections.push(format!("Lines {start}-{end}:"));
        for line in start..=end {
            let index = (line - 1) as usize;
            if let Some(value) = lines.get(index) {
                sections.push(format!("{line:>5} | {value}"));
            }
        }
        sections.push(String::new());
    }

    let rendered = format!(
        "Current workspace snapshot for {source}\n{}",
        sections.join("\n")
    );
    let (truncated, did_truncate) = truncate_chars(&rendered, MAX_CHUNK_FILE_CONTEXT_CHARS);
    Some(if did_truncate {
        format!("{truncated}\n[...truncated...]")
    } else {
        truncated
    })
}

pub(crate) fn normalize_annotation_side(value: Option<&str>) -> &'static str {
    let normalized = value
        .map(str::trim)
        .map(str::to_lowercase)
        .unwrap_or_else(|| "additions".to_string());
    match normalized.as_str() {
        "deletion" | "deletions" | "old" | "left" | "minus" | "removed" => "deletions",
        _ => "additions",
    }
}

pub(crate) fn normalize_severity(value: Option<&str>) -> &'static str {
    let normalized = value
        .map(str::trim)
        .map(str::to_lowercase)
        .unwrap_or_else(|| "medium".to_string());
    match normalized.as_str() {
        "critical" => "critical",
        "high" => "high",
        "low" => "low",
        _ => "medium",
    }
}

pub(crate) fn resolve_line_number_for_chunk(
    chunk: &DiffChunk,
    side: &str,
    requested: Option<i64>,
) -> Option<i64> {
    let lines = if side == "deletions" {
        &chunk.deletion_lines
    } else {
        &chunk.addition_lines
    };
    if lines.is_empty() {
        return None;
    }

    let candidate = requested.unwrap_or(lines[0]).max(1);
    if lines.contains(&candidate) {
        return Some(candidate);
    }

    lines
        .iter()
        .min_by_key(|line| (candidate - **line).abs())
        .copied()
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&raw[start..=end])
}

pub(crate) fn parse_chunk_review_payload(raw: &str) -> ChunkReviewPayload {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return ChunkReviewPayload {
            summary: Some("No output returned for this chunk.".to_string()),
            findings: Some(Vec::new()),
        };
    }

    if let Ok(payload) = serde_json::from_str::<ChunkReviewPayload>(trimmed) {
        return payload;
    }
    if let Some(json_slice) = extract_json_object(trimmed) {
        if let Ok(payload) = serde_json::from_str::<ChunkReviewPayload>(json_slice) {
            return payload;
        }
    }

    ChunkReviewPayload {
        summary: Some(snippet(trimmed, 1_200)),
        findings: Some(Vec::new()),
    }
}

pub(crate) fn build_chunk_review_prompt(
    reviewer_goal: &str,
    workspace: &str,
    base_ref: &str,
    merge_base: &str,
    head: &str,
    chunk: &DiffChunk,
    patch_for_review: &str,
    patch_truncated: bool,
    workspace_context: Option<&str>,
) -> String {
    let additions = if chunk.addition_lines.is_empty() {
        "none".to_string()
    } else {
        chunk
            .addition_lines
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    };
    let deletions = if chunk.deletion_lines.is_empty() {
        "none".to_string()
    } else {
        chunk
            .deletion_lines
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    };

    let context_block = workspace_context
        .map(|value| format!("\nWorkspace file context:\n```\n{value}\n```\n"))
        .unwrap_or_default();

    format!(
        "You are reviewing one diff chunk for bugs.\n\nReviewer goal: {reviewer_goal}\nWorkspace: {workspace}\nBase ref: {base_ref}\nMerge base: {merge_base}\nHead: {head}\nChunk ID: {}\nFile path: {}\nChunk index: {}\nHunk header: {}\nAllowed addition line numbers: {additions}\nAllowed deletion line numbers: {deletions}\nDiff chunk truncated: {}\n\nIMPORTANT:\n1) Treat this as a bug-finding task only (functional bugs, regressions, security, data loss, missing tests that hide bugs).\n2) If you are running in a tool-enabled environment, inspect relevant files in the workspace before deciding.\n3) Return STRICT JSON only. No markdown.\n4) JSON schema:\n{{\n  \"summary\": \"short chunk summary\",\n  \"findings\": [\n    {{\n      \"title\": \"short bug title\",\n      \"body\": \"why this is a bug and concrete fix/test guidance\",\n      \"severity\": \"critical|high|medium|low\",\n      \"confidence\": 0.0,\n      \"side\": \"additions|deletions\",\n      \"lineNumber\": 123\n    }}\n  ]\n}}\n5) Use an empty findings array when there is no clear bug.\n\nDiff chunk:\n```diff\n{patch_for_review}\n```{context_block}",
        chunk.id,
        chunk.file_path,
        chunk.chunk_index,
        chunk.hunk_header,
        if patch_truncated { "yes" } else { "no" }
    )
}

pub(crate) fn build_chunk_review_markdown(
    reviewer_goal: &str,
    chunks: &[AiReviewChunk],
    findings: &[AiReviewFinding],
    diff_truncated: bool,
) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "Chunked review complete for goal: {reviewer_goal}. {} chunk(s) analyzed.",
        chunks.len()
    ));
    lines.push(format!(
        "Findings: {}. Diff input truncated: {}.",
        findings.len(),
        if diff_truncated { "yes" } else { "no" }
    ));
    lines.push(String::new());
    lines.push("## Findings By Chunk".to_string());

    if findings.is_empty() {
        lines.push("- No clear bugs found in reviewed chunks.".to_string());
    }

    for chunk in chunks {
        lines.push(String::new());
        lines.push(format!(
            "### {} (chunk {}, {})",
            chunk.file_path, chunk.chunk_index, chunk.id
        ));
        if !chunk.summary.trim().is_empty() {
            lines.push(format!("- Summary: {}", chunk.summary.trim()));
        }
        if chunk.findings.is_empty() {
            lines.push("- No bug findings in this chunk.".to_string());
            continue;
        }
        for finding in &chunk.findings {
            lines.push(format!(
                "- [{}] {} [{}:{}] {}",
                finding.severity, finding.title, finding.side, finding.line_number, finding.body
            ));
        }
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::{parse_diff_chunks, resolve_line_number_for_chunk};

    #[test]
    fn parse_diff_chunks_tracks_chunk_and_line_mappings() {
        let diff = r#"diff --git a/src/main.rs b/src/main.rs
index 1111111..2222222 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 line1
+line2_added
 line3
-line4_removed
"#;

        let chunks = parse_diff_chunks(diff);
        assert_eq!(chunks.len(), 1);
        let chunk = &chunks[0];
        assert_eq!(chunk.id, "src/main.rs#chunk-1");
        assert_eq!(chunk.file_path, "src/main.rs");
        assert_eq!(chunk.chunk_index, 1);
        assert!(chunk.addition_lines.contains(&2));
        assert!(chunk.deletion_lines.contains(&3));
    }

    #[test]
    fn resolve_line_number_selects_nearest_available_line() {
        let diff = r#"diff --git a/src/main.rs b/src/main.rs
index 1111111..2222222 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -10,2 +10,3 @@
 context
+new_line
 context2
"#;
        let chunk = parse_diff_chunks(diff).remove(0);
        let resolved = resolve_line_number_for_chunk(&chunk, "additions", Some(999));
        assert_eq!(resolved, Some(11));
    }
}
