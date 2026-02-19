use std::{
    fs,
    path::Path,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use super::workspace_git::resolve_base_ref;

fn run_ok(repo_path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .expect("git command should run");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn resolve_base_ref_falls_back_to_master_when_origin_main_missing() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let repo_path = std::env::temp_dir().join(format!("rovex-base-ref-test-{suffix}"));
    fs::create_dir_all(&repo_path).expect("create temp repo dir");

    run_ok(&repo_path, &["init", "-b", "master"]);
    fs::write(repo_path.join("README.md"), "hello\n").expect("write file");
    run_ok(&repo_path, &["add", "README.md"]);
    run_ok(
        &repo_path,
        &[
            "-c",
            "user.email=test@example.com",
            "-c",
            "user.name=Test",
            "commit",
            "-m",
            "init",
        ],
    );

    let resolved = resolve_base_ref(&repo_path, "origin/main").expect("resolve base ref");
    assert_eq!(resolved, "master");

    let _ = fs::remove_dir_all(&repo_path);
}
