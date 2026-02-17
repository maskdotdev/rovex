use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn find_opencode_source_binary() -> Option<PathBuf> {
    if let Ok(explicit) = env::var("ROVEX_OPENCODE_BIN") {
        let path = PathBuf::from(explicit.trim());
        if path.is_file() {
            return Some(path);
        }
    }

    if let Ok(home) = env::var("HOME") {
        let path = PathBuf::from(home).join(".opencode/bin/opencode");
        if path.is_file() {
            return Some(path);
        }
    }

    None
}

fn ensure_opencode_sidecar() {
    let Ok(target) = env::var("TARGET") else {
        return;
    };
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let project_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let sidecar_path = project_dir
        .join("binaries")
        .join(format!("opencode-{target}{extension}"));
    if sidecar_path.exists() {
        return;
    }

    let Some(source) = find_opencode_source_binary() else {
        println!(
            "cargo:warning=No bundled OpenCode sidecar found at {} and no local source binary detected. Set ROVEX_OPENCODE_BIN to the opencode executable path before packaging.",
            sidecar_path.display()
        );
        return;
    };

    if let Some(parent) = sidecar_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            panic!(
                "Failed to create sidecar directory {}: {error}",
                parent.display()
            );
        }
    }
    if let Err(error) = fs::copy(&source, &sidecar_path) {
        panic!(
            "Failed to copy OpenCode sidecar from {} to {}: {error}",
            source.display(),
            sidecar_path.display()
        );
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(&sidecar_path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o755);
            let _ = fs::set_permissions(&sidecar_path, permissions);
        }
    }

    println!(
        "cargo:warning=Copied OpenCode sidecar from {} to {}",
        source.display(),
        sidecar_path.display()
    );
}

fn main() {
    ensure_opencode_sidecar();
    tauri_build::build()
}
