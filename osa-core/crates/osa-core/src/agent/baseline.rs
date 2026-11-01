//! Host baselines and the sync classification shared by `status` and the
//! session prepare path.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::flat;

#[derive(Debug, Clone, Default)]
pub struct HostBaseline {
    pub mode: String,
    pub git: bool,
    pub branch: String,
    pub commit: String,
    pub tree: String,
    pub dirty: bool,
    pub base: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PendingInfo {
    pub exists: bool,
    pub kind: String,
    pub patch: String,
    pub result_tree: String,
}

/// Records the host tree in the state directory without touching the
/// project's index, branch, or working tree.
pub fn capture_host_baseline(state_dir: &Path, program: &str) -> HostBaseline {
    let mut baseline = HostBaseline {
        mode: "plain".to_string(),
        ..HostBaseline::default()
    };
    if !crate::state::command_in_path("git") {
        return baseline;
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if !git_succeeds(&cwd, &["rev-parse", "--is-inside-work-tree"]) {
        return capture_plain_tree(state_dir, &cwd);
    }
    let Some(root) = git_text(&cwd, &["rev-parse", "--show-toplevel"]) else {
        return capture_plain_tree(state_dir, &cwd);
    };
    if !same_path(Path::new(&root), &cwd) {
        return capture_plain_tree(state_dir, &cwd);
    }
    if !git_succeeds(&cwd, &["rev-parse", "-q", "--verify", "HEAD"]) {
        return capture_plain_tree(state_dir, &cwd);
    }
    baseline.branch =
        git_text(&cwd, &["symbolic-ref", "--short", "-q", "HEAD"]).unwrap_or_default();
    let Some(commit) = git_text(&cwd, &["rev-parse", "-q", "--verify", "HEAD"]) else {
        return capture_plain_tree(state_dir, &cwd);
    };
    let Some(tree) = git_text(&cwd, &["rev-parse", "-q", "--verify", "HEAD^{tree}"]) else {
        return capture_plain_tree(state_dir, &cwd);
    };
    baseline.commit = commit;
    baseline.tree = tree;
    if git_text(&cwd, &["status", "--porcelain"]).is_some_and(|text| text.is_empty()) {
        baseline.mode = "clean".to_string();
        baseline.base = baseline.commit.clone();
        baseline.git = true;
        baseline.ok = true;
        write_host_manifest(state_dir, &cwd, &baseline.tree);
        return baseline;
    }
    baseline.mode = "dirty".to_string();
    baseline.dirty = true;
    let index = state_dir.join("baseline.index");
    let _ = fs::remove_file(&index);
    let index_text = index.display().to_string();
    let index_env = [("GIT_INDEX_FILE", Some(index_text.as_str()))];
    if !git_with_env(&cwd, &["read-tree", &baseline.commit], &index_env) {
        let _ = fs::remove_file(&index);
        return capture_plain_tree(state_dir, &cwd);
    }
    if !git_with_env(&cwd, &["add", "-A"], &index_env) {
        let _ = fs::remove_file(&index);
        return capture_plain_tree(state_dir, &cwd);
    }
    let tree = git_text_env(&cwd, &["write-tree"], &index_env);
    let Some(tree) = tree else {
        let _ = fs::remove_file(&index);
        return capture_plain_tree(state_dir, &cwd);
    };
    let email = format!("{program}@localhost");
    let message = format!("{program} baseline {}", std::process::id());
    let commit_env = [
        ("GIT_AUTHOR_NAME", Some(program)),
        ("GIT_AUTHOR_EMAIL", Some(email.as_str())),
        ("GIT_COMMITTER_NAME", Some(program)),
        ("GIT_COMMITTER_EMAIL", Some(email.as_str())),
    ];
    let commit = git_text_env(
        &cwd,
        &["commit-tree", &tree, "-p", &baseline.commit, "-m", &message],
        &commit_env,
    );
    let Some(commit) = commit else {
        let _ = fs::remove_file(&index);
        return capture_plain_tree(state_dir, &cwd);
    };
    baseline.tree = tree.clone();
    baseline.git = true;
    baseline.ok = true;
    baseline.base = commit;
    let _ = fs::remove_file(&index);
    write_host_manifest(state_dir, &cwd, &baseline.tree);
    baseline
}

fn capture_plain_tree(state_dir: &Path, cwd: &Path) -> HostBaseline {
    let mut baseline = HostBaseline {
        mode: "plain".to_string(),
        ..HostBaseline::default()
    };
    let tmp = std::env::temp_dir().join(format!("osa-tree.{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    if !Command::new("git")
        .args(["init", "-q"])
        .arg(&tmp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
    {
        let _ = fs::remove_dir_all(&tmp);
        return baseline;
    }
    let git_dir = tmp.join(".git");
    let index = tmp.join("index");
    let git_dir_text = git_dir.display().to_string();
    let work_tree_text = cwd.display().to_string();
    let index_text = index.display().to_string();
    let env = [
        ("GIT_DIR", Some(git_dir_text.as_str())),
        ("GIT_WORK_TREE", Some(work_tree_text.as_str())),
        ("GIT_INDEX_FILE", Some(index_text.as_str())),
    ];
    let tree = if git_with_env(cwd, &["add", "-A"], &env) {
        git_text_env(cwd, &["write-tree"], &env)
    } else {
        None
    };
    if let Some(tree) = tree {
        baseline.tree = tree.clone();
        baseline.git = true;
        baseline.ok = true;
        if let Some(listing) = git_text_env(cwd, &["ls-tree", "-r", "--name-only", &tree], &env) {
            write_manifest_text(state_dir, &listing);
        }
    }
    let _ = fs::remove_dir_all(&tmp);
    baseline
}

fn write_host_manifest(state_dir: &Path, cwd: &Path, tree: &str) {
    if let Some(listing) = git_text(cwd, &["ls-tree", "-r", "--name-only", tree]) {
        write_manifest_text(state_dir, &listing);
    }
}

fn write_manifest_text(state_dir: &Path, listing: &str) {
    let path = state_dir.join("host_manifest");
    let temp = state_dir.join(format!("host_manifest.{}", std::process::id()));
    let text = if listing.is_empty() {
        String::new()
    } else {
        format!("{listing}\n")
    };
    if fs::write(&temp, text).is_ok() {
        let _ = fs::rename(&temp, &path);
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn git_command(cwd: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command.current_dir(cwd).args(args);
    command
}

fn git_succeeds(cwd: &Path, args: &[&str]) -> bool {
    git_command(cwd, args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn git_text(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = git_command(cwd, args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_with_env(cwd: &Path, args: &[&str], env: &[(&str, Option<&str>)]) -> bool {
    let mut command = git_command(cwd, args);
    for (key, value) in env {
        match value {
            Some(value) => command.env(key, value),
            None => command.env(key, ""),
        };
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn git_text_env(cwd: &Path, args: &[&str], env: &[(&str, Option<&str>)]) -> Option<String> {
    let mut command = git_command(cwd, args);
    for (key, value) in env {
        match value {
            Some(value) => command.env(key, value),
            None => command.env(key, ""),
        };
    }
    let output = command
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Reads a `key=value` file (the synced marker and session baseline format).
pub fn read_kv(path: &Path) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    let Ok(text) = fs::read_to_string(path) else {
        return values;
    };
    for line in text.lines() {
        if let Some((key, value)) = line.split_once('=') {
            values.insert(key.to_string(), value.to_string());
        }
    }
    values
}

pub fn pending_info(state_dir: &Path) -> PendingInfo {
    let path = state_dir.join("pending");
    if !path.is_file() {
        return PendingInfo::default();
    }
    let mut info = PendingInfo {
        exists: true,
        ..PendingInfo::default()
    };
    if let Ok(parsed) = flat::read_entry(&path) {
        info.kind = parsed.entry.get("kind").unwrap_or("").to_string();
        info.patch = parsed.entry.get("patch").unwrap_or("").to_string();
        info.result_tree = parsed.entry.get("result_tree").unwrap_or("").to_string();
    }
    if info.kind.is_empty() {
        if !info.patch.is_empty() && fs::metadata(&info.patch).is_ok_and(|meta| meta.len() > 0) {
            info.kind = "retained".to_string();
        } else {
            info.kind = "parked".to_string();
        }
    }
    info
}

#[derive(Debug, Clone, Default)]
pub struct SyncInputs {
    pub bl_ok: bool,
    pub bl_tree: String,
    pub synced_host_tree: String,
    pub synced_sandbox_tree: String,
    pub pending_kind: String,
    pub pending_result_tree: String,
    pub probe_ok: bool,
    pub sandbox_tree: String,
    pub sandbox_empty: bool,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncVerdict {
    pub state: &'static str,
    pub needs_refresh: bool,
}

fn clean_or_retained(inputs: &SyncInputs) -> SyncVerdict {
    let covers = inputs.pending_kind == "retained"
        && (inputs.pending_result_tree.is_empty()
            || inputs.pending_result_tree == inputs.sandbox_tree);
    SyncVerdict {
        state: if covers { "retained" } else { "clean" },
        needs_refresh: false,
    }
}

pub fn classify(inputs: &SyncInputs) -> SyncVerdict {
    let verdict = |state, needs_refresh| SyncVerdict {
        state,
        needs_refresh,
    };
    if inputs.pending_kind == "parked" {
        return verdict("parked", false);
    }
    if inputs.created {
        return verdict("behind", true);
    }
    if !inputs.probe_ok {
        return verdict("parked", false);
    }
    if inputs.pending_kind == "retained"
        && !inputs.pending_result_tree.is_empty()
        && inputs.pending_result_tree == inputs.sandbox_tree
    {
        return verdict("retained", true);
    }
    if inputs.bl_ok {
        if inputs.synced_host_tree.is_empty() || inputs.synced_sandbox_tree.is_empty() {
            if inputs.sandbox_tree == inputs.bl_tree {
                return clean_or_retained(inputs);
            }
            if inputs.sandbox_empty {
                return verdict("behind", true);
            }
            return verdict("parked", false);
        }
        if inputs.sandbox_tree != inputs.synced_sandbox_tree {
            return verdict("parked", false);
        }
        if inputs.bl_tree != inputs.synced_host_tree {
            return verdict("behind", true);
        }
        return clean_or_retained(inputs);
    }
    if inputs.synced_sandbox_tree.is_empty() {
        return clean_or_retained(inputs);
    }
    if inputs.sandbox_tree != inputs.synced_sandbox_tree {
        return verdict("parked", false);
    }
    verdict("behind", true)
}
