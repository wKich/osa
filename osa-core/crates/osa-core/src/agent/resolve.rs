//! `__resolve` and `__remove`: the actions `osa resolve` and `osa remove`
//! delegate to. They run in the registered project folder, never prompt, and
//! keep every incidental line on stderr so the one JSON object under `--json`
//! is the only thing on stdout.

use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::io::FromRawFd;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::state;

use super::baseline;
use super::commands::{archive_state_dir, json_str};
use super::context::Context;
use super::failure::{Failure, Outcome};

const EX_REFUSED: i32 = 2;
const EX_FAILED: i32 = 3;

fn flat_value(path: &Path, key: &str) -> String {
    crate::flat::read_entry(path)
        .ok()
        .and_then(|parsed| parsed.entry.get(key).map(str::to_string))
        .unwrap_or_default()
}

/// The baseline and synced markers use `key=value` lines, not flat TOML.
fn kv_value(path: &Path, key: &str) -> String {
    baseline::read_kv(path)
        .get(key)
        .cloned()
        .unwrap_or_default()
}

fn registry_file(ctx: &Context, name: &str) -> PathBuf {
    ctx.state.registry.join(format!("{name}.toml"))
}

/// A compact local `YYYYmmddHHMMSS` stamp: fourteen digits, whatever the
/// timezone, because recordings normalize that shape.
pub(crate) fn compact_stamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    state::utc_iso(seconds)
        .unwrap_or_default()
        .replace(['-', ':', 'T', 'Z'], "")
}

fn git_ok(dir: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn git_text(dir: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn stderr_stdio() -> Stdio {
    Stdio::from(unsafe { std::fs::File::from_raw_fd(libc::dup(2)) })
}

fn patch_is_binary(patch: &Path) -> bool {
    let Ok(text) = fs::read_to_string(patch) else {
        return false;
    };
    text.lines().any(|line| {
        line == "GIT binary patch"
            || (line.starts_with("Binary files ") && line.ends_with(" differ"))
    })
}

/// A retained patch whose reverse applies is already in the host tree.
fn patch_present(ctx: &Context, patch: &Path) -> bool {
    if state::command_in_path("git") {
        return git_ok(
            &ctx.project_path,
            &[
                "apply",
                "--reverse",
                "--check",
                &patch.display().to_string(),
            ],
        );
    }
    if !state::command_in_path("patch") || patch_is_binary(patch) {
        return false;
    }
    let Ok(file) = fs::File::open(patch) else {
        return false;
    };
    Command::new("patch")
        .args(["-p1", "--force", "--reverse", "--dry-run", "--silent"])
        .current_dir(&ctx.project_path)
        .stdin(Stdio::from(file))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Checks, then applies, the patch in place. Returns the shell's status:
/// 0 applied, 1 failed after a clean check, 2 check refused, 3 binary without
/// git, 4 neither tool.
fn patch_check_apply(ctx: &Context, patch: &Path) -> i32 {
    let path = patch.display().to_string();
    if state::command_in_path("git") {
        let check = Command::new("git")
            .args(["apply", "--check", &path])
            .current_dir(&ctx.project_path)
            .stdout(stderr_stdio())
            .status();
        if !check.is_ok_and(|status| status.success()) {
            return 2;
        }
        let apply = Command::new("git")
            .args(["apply", &path])
            .current_dir(&ctx.project_path)
            .stdout(stderr_stdio())
            .status();
        return if apply.is_ok_and(|status| status.success()) {
            0
        } else {
            1
        };
    }
    if patch_is_binary(patch) {
        return 3;
    }
    if !state::command_in_path("patch") {
        return 4;
    }
    let patched = |args: &[&str]| {
        let Ok(file) = fs::File::open(patch) else {
            return false;
        };
        Command::new("patch")
            .args(args)
            .current_dir(&ctx.project_path)
            .stdin(Stdio::from(file))
            .stdout(stderr_stdio())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    };
    if !patched(&["-p1", "--batch", "--dry-run", "--forward"]) {
        return 2;
    }
    if patched(&["-p1", "--batch", "--forward"]) {
        0
    } else {
        1
    }
}

/// The project paths a git patch touches, one per line.
fn patch_paths(patch: &Path) -> Vec<String> {
    let Ok(text) = fs::read_to_string(patch) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("diff --git a/")?;
            let index = rest.rfind(" b/")?;
            Some(rest[index + 3..].to_string())
        })
        .collect()
}

fn json_array(items: &[String]) -> String {
    let body = items
        .iter()
        .map(|item| json_str(item))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

struct Resolve<'a> {
    ctx: &'a Context,
    name: String,
    action: String,
    state_dir: PathBuf,
    patch: String,
    result_tree: String,
    changed: Vec<String>,
    lock_dir: PathBuf,
    locked: bool,
    worktree: Option<PathBuf>,
    new_branch: Option<String>,
    remove_cleanup: bool,
}

impl<'a> Resolve<'a> {
    fn new(ctx: &'a Context, name: String, action: String, state_dir: PathBuf) -> Self {
        Resolve {
            ctx,
            name,
            action,
            state_dir,
            patch: String::new(),
            result_tree: String::new(),
            changed: Vec::new(),
            lock_dir: PathBuf::new(),
            locked: false,
            worktree: None,
            new_branch: None,
            remove_cleanup: false,
        }
    }

    fn add_changed(&mut self, item: &str) {
        self.changed.push(item.to_string());
    }

    /// Announces this resolve, then refuses while a live session or another
    /// resolve holds the sandbox.
    fn take_lock(mut self) -> Result<Self, Outcome> {
        let lock_dir = self.state_dir.join("locks");
        self.lock_dir = lock_dir.clone();
        if fs::create_dir_all(&lock_dir).is_err() {
            return Err(self.finish(
                EX_FAILED,
                &format!("cannot create the lock directory {}", lock_dir.display()),
            ));
        }
        let resolve_dir = lock_dir.join("resolve.d");
        if fs::create_dir(&resolve_dir).is_err() {
            if let Some(state::Holder::Pid(pid)) = state::resolve_holder(&lock_dir, true) {
                let message = format!(
                    "another osa resolve is running for sandbox '{}' (PID {pid}); nothing changed",
                    self.name
                );
                return Err(self.finish(EX_REFUSED, &message));
            }
            if fs::create_dir(&resolve_dir).is_err() {
                let message = format!(
                    "another osa resolve is starting for sandbox '{}'; nothing changed",
                    self.name
                );
                return Err(self.finish(EX_REFUSED, &message));
            }
        }
        self.locked = true;
        if fs::write(resolve_dir.join("pid"), format!("{}\n", std::process::id())).is_err() {
            return Err(self.finish(
                EX_FAILED,
                &format!("cannot write the resolve lock in {}", resolve_dir.display()),
            ));
        }
        if let Some(pid) = state::session_holder(&lock_dir, true) {
            let message = format!(
                "a session is running for sandbox '{}' (PID {pid}); resolve after it exits (lock: {}; remove session.{pid} only if no such session runs)",
                self.name,
                lock_dir.display()
            );
            return Err(self.finish(EX_REFUSED, &message));
        }
        Ok(self)
    }

    /// Removes what a failed action left behind, releases the lock, reports
    /// the result, and turns it into an exit status.
    fn finish(mut self, code: i32, message: &str) -> Outcome {
        if let Some(worktree) = self.worktree.take() {
            let removed = git_ok(
                &self.ctx.project_path,
                &[
                    "worktree",
                    "remove",
                    "--force",
                    &worktree.display().to_string(),
                ],
            );
            if !removed {
                let _ = fs::remove_dir_all(&worktree);
            }
            let _ = git_ok(&self.ctx.project_path, &["worktree", "prune"]);
        }
        if let Some(branch) = self.new_branch.take() {
            let _ = git_ok(&self.ctx.project_path, &["branch", "-D", &branch]);
        }
        if self.locked {
            let _ = fs::remove_dir_all(self.lock_dir.join("resolve.d"));
            self.locked = false;
        }
        if self.remove_cleanup {
            let _ = fs::remove_dir(&self.lock_dir);
            let _ = fs::remove_dir(&self.state_dir);
            if self.state_dir.exists() {
                self.ctx.warn(&format!(
                    "left {} in place: it is not empty",
                    self.state_dir.display()
                ));
            }
        }
        if self.ctx.options.json {
            println!(
                "{{\"sandbox\":{},\"action\":{},\"ok\":{},\"changed\":{},\"message\":{}}}",
                json_str(&self.name),
                json_str(&self.action),
                code == 0,
                json_array(&self.changed),
                json_str(message)
            );
            if code != 0 {
                eprintln!("{}: {message}", self.ctx.program());
            }
        } else if code == 0 {
            println!("{message}");
        } else {
            eprintln!("{}: {message}", self.ctx.program());
        }
        if code == 0 {
            Ok(())
        } else {
            Err(Failure::silent(code))
        }
    }

    /// Moves the retained marker aside and records the resolved state, so the
    /// next session refreshes the workspace instead of parking it.
    fn clear_marker(&mut self) -> Result<(), String> {
        let pending = self.state_dir.join("pending");
        let resolved = self.state_dir.join("pending.resolved");
        if fs::rename(&pending, &resolved).is_err() {
            return Err(format!("cannot remove the marker {}", pending.display()));
        }
        self.mark_refresh();
        Ok(())
    }

    fn mark_refresh(&mut self) {
        let program = self.ctx.program().to_string();
        if self.result_tree.is_empty() {
            self.ctx.warn(&format!(
                "the marker recorded no result tree; if the next session reports the workspace parked, run '{program} upload --discard'"
            ));
            return;
        }
        let synced = self.state_dir.join("synced");
        let resolved = self.state_dir.join("pending.resolved");
        let mut sandbox_id = kv_value(&synced, "sandbox_id");
        if sandbox_id.is_empty() {
            sandbox_id = flat_value(&resolved, "sandbox_id");
        }
        let temp = self
            .state_dir
            .join(format!("synced.{}", std::process::id()));
        let text = format!(
            "host_tree=resolved\nsandbox_tree={}\nsandbox_id={}\n",
            self.result_tree, sandbox_id
        );
        let written = fs::write(&temp, text).is_ok()
            && fs::set_permissions(&temp, fs::Permissions::from_mode(0o600)).is_ok()
            && fs::rename(&temp, &synced).is_ok();
        if !written {
            let _ = fs::remove_file(&temp);
            self.ctx.warn(&format!(
                "cannot record the resolved state; if the next session reports the workspace parked, run '{program} upload --discard'"
            ));
        }
        let baseline = self.state_dir.join("baseline");
        if baseline.is_file() {
            if let Ok(text) = fs::read_to_string(&baseline) {
                let replaced: Vec<String> = text
                    .lines()
                    .map(|line| {
                        if line.starts_with("state=") {
                            "state=behind".to_string()
                        } else {
                            line.to_string()
                        }
                    })
                    .collect();
                let temp = self
                    .state_dir
                    .join(format!("baseline.{}", std::process::id()));
                let mut body = replaced.join("\n");
                if text.ends_with('\n') {
                    body.push('\n');
                }
                if fs::write(&temp, body).is_err()
                    || fs::set_permissions(&temp, fs::Permissions::from_mode(0o600)).is_err()
                    || fs::rename(&temp, &baseline).is_err()
                {
                    let _ = fs::remove_file(&temp);
                }
            }
        }
        let _ = fs::remove_file(&resolved);
    }
}

fn ready_sandbox(ctx: &Context, name: &str, start: bool) -> Result<String, (i32, String)> {
    if let Err(failure) = ctx.require_openshell() {
        return Err((failure.code, failure.lines.join(" ")));
    }
    let phase = ctx
        .sandbox_phase(name)
        .map_err(|failure| (failure.code, failure.lines.join("\n")))?;
    match phase.as_deref() {
        None => Err((
            EX_REFUSED,
            format!("sandbox '{name}' is not on the gateway; nothing changed"),
        )),
        Some("Ready") => Ok(String::new()),
        Some(stopped @ ("Stopped" | "Completed" | "Error")) => {
            if !start {
                return Err((
                    EX_REFUSED,
                    format!(
                        "sandbox '{name}' is {stopped}; nothing changed. Start it with '{} start', then discard again",
                        ctx.program()
                    ),
                ));
            }
            ctx.note(&format!("Starting sandbox '{name}' (phase: {stopped})..."));
            ctx.run_gateway(&["sandbox", "start", name])
                .map_err(|failure| (failure.code, failure.lines.join("\n")))?;
            super::session::wait_for_sandbox_ready(ctx, name)
                .map_err(|failure| (failure.code, failure.lines.join("\n")))?;
            Ok(format!("Started sandbox '{name}' (it was {stopped}). "))
        }
        _ => {
            super::session::wait_for_sandbox_ready(ctx, name)
                .map_err(|failure| (failure.code, failure.lines.join("\n")))?;
            Ok(String::new())
        }
    }
}

fn finish_stop(resolve: Resolve<'_>, stop: (i32, String)) -> Outcome {
    resolve.finish(stop.0, &stop.1)
}

fn apply_action(mut resolve: Resolve<'_>) -> Outcome {
    let project = resolve.ctx.project_path.display().to_string();
    let patch = Path::new(&resolve.patch).to_path_buf();
    if patch_present(resolve.ctx, &patch) {
        let message = format!(
            "The retained patch is already in {project}; no file changed and the marker is cleared. Patch kept: {}",
            resolve.patch
        );
        if let Err(failure) = resolve.clear_marker() {
            return resolve.finish(EX_FAILED, &failure);
        }
        return resolve.finish(0, &message);
    }
    let paths = patch_paths(&patch);
    match patch_check_apply(resolve.ctx, &patch) {
        0 => {
            for path in paths {
                resolve.add_changed(&format!("{project}/{path}"));
            }
            let message = format!(
                "Applied the retained patch to {project} (not staged or committed). Patch kept: {}",
                resolve.patch
            );
            if let Err(failure) = resolve.clear_marker() {
                return resolve.finish(EX_FAILED, &failure);
            }
            resolve.finish(0, &message)
        }
        2 => {
            let message = format!(
                "the retained patch does not apply cleanly to {project}; nothing changed. Commit it on a branch instead: osa resolve {} branch",
                resolve.name
            );
            resolve.finish(EX_REFUSED, &message)
        }
        3 => {
            let message = format!(
                "the retained patch has binary changes and this host has no git; nothing changed. Run 'osa resolve {} branch' on a host with git, or copy files with '{} download'",
                resolve.name,
                resolve.ctx.program()
            );
            resolve.finish(EX_REFUSED, &message)
        }
        4 => resolve.finish(
            EX_REFUSED,
            "neither git nor patch is available on this host; nothing changed",
        ),
        _ => {
            let message = format!(
                "applying the retained patch failed after a clean check; review {project} and {}",
                resolve.patch
            );
            resolve.finish(EX_FAILED, &message)
        }
    }
}

fn branch_action(mut resolve: Resolve<'_>) -> Outcome {
    let project = resolve.ctx.project_path.clone();
    let project_text = project.display().to_string();
    let apply_hint = format!(
        "Apply the patch to the working tree instead: osa resolve {} apply",
        resolve.name
    );
    if !state::command_in_path("git") {
        return resolve.finish(
            EX_REFUSED,
            &format!("branch needs git on this host; nothing changed. {apply_hint}"),
        );
    }
    let top = git_text(&project, &["rev-parse", "--show-toplevel"]).unwrap_or_default();
    if top != project_text {
        return resolve.finish(
            EX_REFUSED,
            &format!(
                "{project_text} is not the root of a git repository; nothing changed. {apply_hint}"
            ),
        );
    }
    let base = kv_value(&resolve.state_dir.join("baseline"), "base");
    if base.is_empty() {
        return resolve.finish(
            EX_REFUSED,
            &format!("the session recorded no base commit; nothing changed. {apply_hint}"),
        );
    }
    if !git_ok(&project, &["cat-file", "-e", &format!("{base}^{{commit}}")]) {
        return resolve.finish(
            EX_REFUSED,
            &format!(
                "the recorded base commit {base} is no longer in the repository; nothing changed. {apply_hint}"
            ),
        );
    }
    let stamp = compact_stamp();
    let mut branch = format!("osa/{}-{stamp}", resolve.name);
    if git_ok(
        &project,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    ) {
        branch = format!("{branch}-{}", std::process::id());
    }
    if !git_ok(&project, &["check-ref-format", "--branch", &branch]) {
        return resolve.finish(
            EX_REFUSED,
            &format!("'{branch}' is not a valid branch name; nothing changed"),
        );
    }
    let worktrees = resolve.state_dir.join("worktrees");
    if fs::create_dir_all(&worktrees).is_err() {
        let message = format!(
            "cannot create the worktree directory under {}",
            worktrees.display()
        );
        return resolve.finish(EX_FAILED, &message);
    }
    let worktree = worktrees.join(format!("resolve-{stamp}-{}", std::process::id()));
    let _ = git_ok(&project, &["worktree", "prune"]);
    resolve.worktree = Some(worktree.clone());
    let worktree_text = worktree.display().to_string();
    if !git_ok(
        &project,
        &["worktree", "add", "--detach", &worktree_text, &base],
    ) {
        let message =
            format!("cannot create a temporary worktree at {worktree_text}; nothing changed");
        return resolve.finish(EX_FAILED, &message);
    }
    let patch = resolve.patch.clone();
    let applied = if git_ok(&worktree, &["apply", "--check", &patch]) {
        git_ok(&worktree, &["apply", &patch])
    } else {
        git_ok(&worktree, &["apply", "--3way", &patch])
    };
    if !applied {
        return resolve.finish(
            EX_REFUSED,
            &format!(
                "the retained patch conflicts with the recorded base {base}; no branch was created and nothing changed. Review the patch by hand: {patch}"
            ),
        );
    }
    let committed = git_ok(&worktree, &["add", "-A"])
        && git_text(&worktree, &["write-tree"])
            .and_then(|tree| {
                let message = format!(
                    "{}: sandbox changes from {}",
                    resolve.ctx.program(),
                    resolve.name
                );
                Command::new("git")
                    .args(["commit-tree", &tree, "-p", &base, "-m", &message])
                    .current_dir(&worktree)
                    .env("GIT_AUTHOR_NAME", resolve.ctx.program())
                    .env(
                        "GIT_AUTHOR_EMAIL",
                        format!("{}@localhost", resolve.ctx.program()),
                    )
                    .env("GIT_COMMITTER_NAME", resolve.ctx.program())
                    .env(
                        "GIT_COMMITTER_EMAIL",
                        format!("{}@localhost", resolve.ctx.program()),
                    )
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .output()
                    .ok()
                    .filter(|output| output.status.success())
                    .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            })
            .is_some_and(|commit| git_ok(&project, &["branch", &branch, &commit]));
    if !committed {
        return resolve.finish(
            EX_FAILED,
            "cannot commit the patch in the temporary worktree; no branch was created",
        );
    }
    resolve.new_branch = Some(branch.clone());
    if !git_ok(
        &project,
        &[
            "worktree",
            "remove",
            "--force",
            &worktree.display().to_string(),
        ],
    ) {
        return resolve.finish(
            EX_FAILED,
            &format!(
                "cannot remove the temporary worktree {}; branch '{branch}' was not kept",
                worktree.display()
            ),
        );
    }
    resolve.worktree = None;
    if let Err(failure) = resolve.clear_marker() {
        return resolve.finish(EX_FAILED, &failure);
    }
    resolve.new_branch = None;
    resolve.add_changed(&format!("refs/heads/{branch}"));
    let mut message = format!(
        "Committed the retained patch on branch '{branch}' at the recorded base {base}. The working tree, index, and HEAD are unchanged. Take the change with: git cherry-pick {branch}"
    );
    if kv_value(&resolve.state_dir.join("baseline"), "dirty") == "1" {
        message.push_str(
            " (the base is a snapshot of the uncommitted work at upload, so cherry-pick takes only the agent's change)",
        );
    }
    resolve.finish(0, &message)
}

fn drop_action(mut resolve: Resolve<'_>) -> Outcome {
    if !resolve.ctx.options.yes {
        let message = format!(
            "drop needs --yes: it clears the marker and moves the patch into {}/dropped/; nothing changed",
            resolve.state_dir.display()
        );
        return resolve.finish(EX_REFUSED, &message);
    }
    let dir = resolve.state_dir.join("dropped");
    if fs::create_dir_all(&dir).is_err() {
        return resolve.finish(
            EX_FAILED,
            &format!("cannot create {}; nothing changed", dir.display()),
        );
    }
    let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    let name = Path::new(&resolve.patch)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut dest = dir.join(&name);
    if dest.exists() {
        dest = dir.join(format!("{name}.{}", std::process::id()));
    }
    if fs::rename(&resolve.patch, &dest).is_err() {
        return resolve.finish(
            EX_FAILED,
            &format!(
                "cannot move the patch into {}; nothing changed",
                dir.display()
            ),
        );
    }
    resolve.add_changed(&dest.display().to_string());
    if let Err(failure) = resolve.clear_marker() {
        return resolve.finish(EX_FAILED, &failure);
    }
    let message = format!(
        "Dropped the retained patch; it is kept at {} (recover it with: git apply '{}')",
        dest.display(),
        dest.display()
    );
    resolve.finish(0, &message)
}

fn rescue_action(mut resolve: Resolve<'_>) -> Outcome {
    let started = match ready_sandbox(resolve.ctx, &resolve.name, true) {
        Ok(started) => started,
        Err(stop) => return finish_stop(resolve, stop),
    };
    let stamp = compact_stamp();
    let mut dest = resolve.state_dir.join(format!("rescue-{stamp}"));
    if dest.exists() {
        dest = PathBuf::from(format!("{}-{}", dest.display(), std::process::id()));
    }
    let workdir = resolve.ctx.workdir();
    let dest_arg = format!("{}/", dest.display());
    let downloaded = resolve
        .ctx
        .openshell(&["sandbox", "download", &resolve.name, &workdir, &dest_arg])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !downloaded {
        let _ = fs::remove_dir_all(&dest);
        let message = format!(
            "{started}downloading {}:{workdir} failed; nothing was kept",
            resolve.name
        );
        return resolve.finish(EX_FAILED, &message);
    }
    let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(0o700));
    resolve.add_changed(&dest.display().to_string());
    let message = format!(
        "{started}Rescued the parked workspace into {}. The workspace stays parked; when done, replace it with: osa resolve {} discard --yes",
        dest.display(),
        resolve.name
    );
    resolve.finish(0, &message)
}

fn discard_action(mut resolve: Resolve<'_>) -> Outcome {
    if !resolve.ctx.options.yes {
        let message = format!(
            "discard needs --yes: it replaces the sandbox workspace with {}; nothing changed. Keep a copy first with: osa resolve {} rescue",
            resolve.ctx.project_path.display(),
            resolve.name
        );
        return resolve.finish(EX_REFUSED, &message);
    }
    if let Err(stop) = ready_sandbox(resolve.ctx, &resolve.name, false) {
        return finish_stop(resolve, stop);
    }
    if let Err(failure) = super::session::upload_with(resolve.ctx, &[], true) {
        let message = failure.lines.join("\n");
        return resolve.finish(EX_FAILED, &message);
    }
    let pending = resolve.state_dir.join("pending");
    if pending.is_file() {
        return resolve.finish(
            EX_FAILED,
            &format!(
                "the upload finished but the marker is still present: {}",
                pending.display()
            ),
        );
    }
    resolve.add_changed(&format!("{}:{}", resolve.name, resolve.ctx.workdir()));
    let message = format!(
        "Replaced the parked workspace of '{}' with {} and cleared the marker. Existing patch files were kept.",
        resolve.name,
        resolve.ctx.project_path.display()
    );
    resolve.finish(0, &message)
}

pub fn resolve(ctx: &Context, args: &[OsString]) -> Outcome {
    ctx.gateway_stdout_to_stderr.set(true);
    if args.len() != 1 {
        return Err(Failure::usage(format!(
            "usage: {} --name SANDBOX __resolve apply|branch|drop|rescue|discard [--yes] [--json]",
            ctx.program()
        )));
    }
    let action = args[0].to_string_lossy().into_owned();
    if !matches!(
        action.as_str(),
        "apply" | "branch" | "drop" | "rescue" | "discard"
    ) {
        return Err(Failure::usage(format!(
            "unknown resolve action: {action} (actions: apply, branch, drop, rescue, discard)"
        )));
    }
    let name = ctx.sandbox_name()?;
    let state_dir = ctx.session_state_dir(&name);
    let resolve = Resolve::new(ctx, name.clone(), action.clone(), state_dir);
    let owner = flat_value(&registry_file(ctx, &name), "host_path");
    if owner != ctx.project_path.display().to_string() {
        let belongs = if owner.is_empty() {
            String::new()
        } else {
            format!(" (it belongs to {owner})")
        };
        return resolve.finish(
            EX_REFUSED,
            &format!(
                "sandbox '{name}' is not registered to {}; nothing changed{belongs}",
                ctx.project_path.display()
            ),
        );
    }
    let mut resolve = match resolve.take_lock() {
        Ok(resolve) => resolve,
        Err(outcome) => return outcome,
    };
    let pending = baseline::pending_info(&resolve.state_dir);
    match action.as_str() {
        "apply" | "branch" | "drop" => match pending.kind.as_str() {
            "retained" => {}
            "parked" => {
                let message = format!(
                    "the workspace of '{name}' is parked, not retained: it holds changes with no durable patch; nothing changed. Resolve it with 'osa resolve {name} rescue' or 'osa resolve {name} discard --yes'"
                );
                return resolve.finish(EX_REFUSED, &message);
            }
            _ => {
                return resolve.finish(
                    EX_REFUSED,
                    &format!("nothing is pending for sandbox '{name}'; nothing changed"),
                )
            }
        },
        _ => match pending.kind.as_str() {
            "parked" => {}
            "retained" => {
                let message = format!(
                    "sandbox '{name}' has a retained patch, not a parked workspace; nothing changed. Resolve it with 'osa resolve {name} apply', 'osa resolve {name} branch', or 'osa resolve {name} drop --yes'"
                );
                return resolve.finish(EX_REFUSED, &message);
            }
            _ => {
                return resolve.finish(
                    EX_REFUSED,
                    &format!("nothing is pending for sandbox '{name}'; nothing changed"),
                )
            }
        },
    }
    if matches!(action.as_str(), "apply" | "branch" | "drop") {
        resolve.patch = pending.patch.clone();
        resolve.result_tree = pending.result_tree.clone();
        let usable = !resolve.patch.is_empty()
            && fs::metadata(&resolve.patch).is_ok_and(|meta| meta.len() > 0);
        if !usable {
            let recorded = if resolve.patch.is_empty() {
                "none recorded".to_string()
            } else {
                resolve.patch.clone()
            };
            return resolve.finish(
                EX_REFUSED,
                &format!(
                    "the retained patch file is missing or empty: {recorded}; nothing changed"
                ),
            );
        }
    }
    match action.as_str() {
        "apply" => apply_action(resolve),
        "branch" => branch_action(resolve),
        "drop" => drop_action(resolve),
        "rescue" => rescue_action(resolve),
        _ => discard_action(resolve),
    }
}

pub fn remove(ctx: &Context, args: &[OsString]) -> Outcome {
    ctx.gateway_stdout_to_stderr.set(true);
    if !args.is_empty() {
        return Err(Failure::usage(format!(
            "usage: {} --name SANDBOX __remove --yes [--orphan] [--json]",
            ctx.program()
        )));
    }
    let name = ctx.sandbox_name()?;
    let state_dir = ctx.session_state_dir(&name);
    let remove = Resolve::new(ctx, name.clone(), "remove".to_string(), state_dir);
    let entry = registry_file(ctx, &name);
    if !entry.is_file() {
        return remove.finish(
            EX_REFUSED,
            &format!("sandbox '{name}' is not registered; nothing changed"),
        );
    }
    let owner = flat_value(&entry, "host_path");
    let project = ctx.project_path.display().to_string();
    if ctx.options.orphan {
        let folder = if owner.is_empty() {
            "is not recorded".to_string()
        } else {
            owner.clone()
        };
        if owner.is_empty() || Path::new(&owner).is_dir() {
            return remove.finish(
                EX_REFUSED,
                &format!(
                    "sandbox '{name}' is not an orphan: its project folder {folder} exists; nothing changed"
                ),
            );
        }
    } else if owner != project {
        let belongs = if owner.is_empty() {
            String::new()
        } else {
            format!(" (it belongs to {owner})")
        };
        return remove.finish(
            EX_REFUSED,
            &format!("sandbox '{name}' is not registered to {project}{belongs}; nothing changed"),
        );
    }
    if !ctx.options.yes {
        return remove.finish(
            EX_REFUSED,
            &format!(
                "removing '{name}' deletes its sandbox; pass --yes to confirm. Nothing changed"
            ),
        );
    }
    let mut remove = match remove.take_lock() {
        Ok(remove) => remove,
        Err(outcome) => return outcome,
    };
    let pending = baseline::pending_info(&remove.state_dir);
    match pending.kind.as_str() {
        "retained" => {
            let message = format!(
                "sandbox '{name}' has a retained patch; nothing changed. Resolve it first with 'osa resolve {name} apply', 'osa resolve {name} branch', or 'osa resolve {name} drop --yes'"
            );
            return remove.finish(EX_REFUSED, &message);
        }
        "parked" => {
            let message = format!(
                "the workspace of '{name}' is parked; nothing changed. Resolve it first with 'osa resolve {name} rescue' or 'osa resolve {name} discard --yes'"
            );
            return remove.finish(EX_REFUSED, &message);
        }
        _ => {}
    }
    // Resolve the gateway before the first mutation. A discovery failure — an
    // unreachable gateway, an unsupported authentication mode — exits with the
    // discovery message and leaves the registry exactly as it was.
    if let Err(error) = crate::gateway::discover(ctx.gateway().as_deref()) {
        return remove.finish(error.code(), &error.message());
    }

    let listed = ctx
        .openshell(&["sandbox", "list", "--output", "json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output();
    let Some(listed) = listed.ok().filter(|output| output.status.success()) else {
        return remove.finish(
            EX_FAILED,
            "cannot list sandboxes; is the gateway running? Nothing changed",
        );
    };
    let payload = String::from_utf8_lossy(&listed.stdout);
    let present = crate::gateway::sandboxes(&payload)
        .ok()
        .is_some_and(|sandboxes| sandboxes.iter().any(|sandbox| sandbox.name == name));
    if present {
        let deleted = ctx
            .openshell(&["sandbox", "delete", &name])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !deleted {
            return remove.finish(
                EX_FAILED,
                &format!(
                    "the gateway did not delete sandbox '{name}'; the project stays registered"
                ),
            );
        }
        remove.add_changed(&format!("gateway:{name}"));
    }
    if let Some(destination) = archive_state_dir(ctx, &remove.state_dir, "project removed") {
        remove.add_changed(&destination.display().to_string());
        remove.remove_cleanup = true;
    }
    if fs::remove_file(&entry).is_err() {
        return remove.finish(
            EX_FAILED,
            &format!("cannot remove the registry entry {}", entry.display()),
        );
    }
    remove.add_changed(&entry.display().to_string());
    remove.finish(0, &format!("Removed project '{name}'."))
}
