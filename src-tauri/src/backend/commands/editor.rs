use std::{
    path::{Component, Path, PathBuf},
    process::Command,
};

use crate::backend::OpenFileInEditorInput;

pub(crate) async fn open_file_in_editor(input: OpenFileInEditorInput) -> Result<(), String> {
    let workspace = input.workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace path is required to open files.".to_string());
    }

    let raw_file_path = input.file_path.trim();
    if raw_file_path.is_empty() {
        return Err("File path is required to open files.".to_string());
    }

    let workspace_path = PathBuf::from(workspace);
    let normalized_path = normalize_file_path(raw_file_path)?;
    let target_path = if normalized_path.is_absolute() {
        normalized_path
    } else {
        workspace_path.join(normalized_path)
    };
    let target_path_string = target_path.to_string_lossy().to_string();

    let launcher = input.launcher.trim().to_lowercase();
    match launcher.as_str() {
        "vscode" => spawn_command("code", vec![target_path_string]),
        "cursor" => spawn_command("cursor", vec![target_path_string]),
        "ghostty" => {
            let template = input
                .ghostty_command_template
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("nvim {file}");
            let command = build_ghostty_command(template, &target_path.to_string_lossy());
            spawn_ghostty(command)
        }
        _ => Err(format!(
            "Unsupported open-with target '{}'. Use vscode, cursor, or ghostty.",
            input.launcher
        )),
    }
}

fn normalize_file_path(file_path: &str) -> Result<PathBuf, String> {
    let parsed = Path::new(file_path);
    if parsed.is_absolute() {
        return Ok(parsed.to_path_buf());
    }

    let mut normalized = PathBuf::new();
    for component in parsed.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir => {
                return Err("File path cannot contain '..' segments.".to_string())
            }
            Component::RootDir => {
                return Err("File path must be relative to the selected workspace.".to_string())
            }
            Component::Prefix(_) => {
                return Err("File path must be relative to the selected workspace.".to_string())
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err("File path is empty after normalization.".to_string());
    }

    Ok(normalized)
}

fn spawn_command(program: &str, args: Vec<String>) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to launch {program}: {error}"))
}

#[cfg(target_os = "windows")]
fn shell_escape(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

#[cfg(not(target_os = "windows"))]
fn shell_escape(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn build_ghostty_command(template: &str, file_path: &str) -> String {
    let escaped_path = shell_escape(file_path);
    if template.contains("{file}") {
        return template.replace("{file}", &escaped_path);
    }
    format!("{template} {escaped_path}")
}

#[cfg(target_os = "windows")]
fn spawn_ghostty(command: String) -> Result<(), String> {
    spawn_command(
        "ghostty",
        vec!["-e".to_string(), "cmd".to_string(), "/C".to_string(), command],
    )
}

#[cfg(not(target_os = "windows"))]
fn spawn_ghostty(command: String) -> Result<(), String> {
    spawn_command(
        "ghostty",
        vec!["-e".to_string(), "sh".to_string(), "-lc".to_string(), command],
    )
}
