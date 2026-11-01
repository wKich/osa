//! Caller-owned workspace sync: `sync-in` mirrors a host tree into a sandbox
//! workdir with its baseline, and `collect-patch` hands the workdir's changes
//! back as a binary patch.

use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::io::FromRawFd;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::context::{Context, WorkspaceMode};
use super::failure::{Failure, Outcome};
use super::gateway::sandbox_git_dir;

fn temp_path(ctx: &Context, suffix: &str) -> PathBuf {
    // Keep the shell's `${TMPDIR}/...` shape, including a trailing slash in
    // TMPDIR, so recordings normalize identically.
    PathBuf::from(format!(
        "{}/{}-{suffix}",
        std::env::temp_dir().display(),
        ctx.profile.tmp_prefix
    ))
}

/// Host temp paths owned by one command. The shell's EXIT trap removes them on
/// every path, including usage and gateway errors.
struct TempFiles(std::cell::RefCell<Vec<PathBuf>>);

impl TempFiles {
    fn new() -> Self {
        Self(std::cell::RefCell::new(Vec::new()))
    }

    fn track(&self, path: PathBuf) {
        self.0.borrow_mut().push(path);
    }
}

impl Drop for TempFiles {
    fn drop(&mut self) {
        for path in self.0.borrow().iter() {
            if path.is_dir() {
                let _ = fs::remove_dir_all(path);
            } else {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn cksum(value: &str) -> u32 {
    let mut crc: u32 = 0;
    for byte in value.bytes() {
        crc ^= (byte as u32) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04C1_1DB7
            } else {
                crc << 1
            };
        }
    }
    let mut length = value.len();
    while length > 0 {
        crc ^= ((length & 0xff) as u32) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04C1_1DB7
            } else {
                crc << 1
            };
        }
        length >>= 8;
    }
    !crc
}

fn caller_git_dir(ctx: &Context, workdir: &str) -> String {
    let base = sandbox_git_dir(workdir, ctx.profile.state_name);
    let parent = Path::new(&base)
        .parent()
        .map(|parent| parent.display().to_string())
        .unwrap_or_default();
    format!("{parent}/caller/{}", cksum(workdir))
}

fn sync_target(ctx: &Context, command: &str) -> Result<(String, String), Failure> {
    if ctx.workspace_mode()? != WorkspaceMode::Caller {
        return Err(Failure::usage(format!(
            "{command} is a caller interface: set {}_WORKSPACE=caller",
            ctx.profile.env_prefix
        )));
    }
    ctx.require_caller_target(true)?;
    let workdir = ctx.workdir();
    let git_dir = caller_git_dir(ctx, &workdir);
    if git_dir.starts_with(&format!("{workdir}/")) {
        return Err(Failure::usage(format!(
            "{command} needs a workdir below the sandbox root, not '{workdir}'"
        )));
    }
    Ok((ctx.sandbox_name()?, workdir))
}

fn require_running(ctx: &Context, name: &str) -> Outcome {
    match ctx.sandbox_phase(name)? {
        Some(phase) if phase == "Ready" => Ok(()),
        Some(phase) => Err(Failure::gateway(format!(
            "sandbox '{name}' is {phase}, not running; run '{} up' first",
            ctx.program()
        ))),
        None => Err(Failure::gateway(format!(
            "sandbox '{name}' not found; run '{} up' first",
            ctx.program()
        ))),
    }
}

fn run_script(
    ctx: &Context,
    name: &str,
    workdir: &str,
    script: &str,
    extra: &[String],
) -> Option<std::process::Output> {
    let git_dir = caller_git_dir(ctx, workdir);
    let mut command = Command::new("openshell");
    if let Some(gateway) = ctx.gateway() {
        command.arg("-g").arg(gateway);
    }
    command.args([
        "sandbox",
        "exec",
        "-n",
        name,
        "--no-login-shell",
        "--",
        "sh",
        "-c",
        script,
        &format!("{}-git", ctx.program()),
        &git_dir,
        workdir,
    ]);
    for word in extra {
        command.arg(word);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()
}

fn script_text_output(ctx: &Context, name: &str, workdir: &str, script: &str) -> Option<String> {
    let output = run_script(ctx, name, workdir, script, &[])?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn clear_script(_program: &str) -> String {
    "set -e\n\
gitdir=$1 worktree=$2 repodir=$3 bundle=$4 manifest=$5 dirty=$6\n\
rm -rf \"$gitdir\" \"$repodir\" \"$bundle\" \"$manifest\" \"$dirty\"\n\
mkdir -p \"$(dirname -- \"$gitdir\")\" \"$worktree\"\n\
find \"$worktree\" -mindepth 1 -maxdepth 1 -exec rm -rf {} +"
        .to_string()
}

fn history_script(_program: &str) -> String {
    "set -e\n\
gitdir=$1 worktree=$2 repodir=$3 bundle=$4 commit=$5 base_name=$6 base_ref=$7 base_commit=$8\n\
trap 'rm -f \"$bundle\"' EXIT\n\
rm -rf \"$repodir\" \"$worktree/.git\"\n\
mkdir -p \"$repodir\" \"$worktree\"\n\
git init -q --separate-git-dir=\"$repodir\" \"$worktree\"\n\
git --git-dir=\"$repodir\" fetch -q --no-tags \"$bundle\" HEAD\n\
if [ -n \"$base_ref\" ]; then\n    \
git --git-dir=\"$repodir\" fetch -q --no-tags \"$bundle\" \"$base_ref\"\n\
fi\n\
git --git-dir=\"$repodir\" update-ref --no-deref HEAD \"$commit\"\n\
if [ -n \"$base_name\" ]; then\n    \
git --git-dir=\"$repodir\" update-ref \"refs/remotes/origin/$base_name\" \"$base_commit\"\n\
fi\n\
GIT_DIR=$repodir GIT_WORK_TREE=$worktree git read-tree \"$commit\"\n\
GIT_DIR=$repodir GIT_WORK_TREE=$worktree git reset -q --mixed"
        .to_string()
}

fn baseline_script(program: &str) -> String {
    format!(
        "set -e\n\
gitdir=$1 worktree=$2 keepgit=$3\n\
if [ \"$keepgit\" -eq 0 ]; then\n    \
rm -rf \"$worktree/.git\"\n\
fi\n\
export GIT_DIR=$gitdir GIT_WORK_TREE=$worktree\n\
export GIT_AUTHOR_NAME={program} GIT_AUTHOR_EMAIL={program}@localhost\n\
export GIT_COMMITTER_NAME={program} GIT_COMMITTER_EMAIL={program}@localhost\n\
mkdir -p \"$gitdir\"\n\
git init -q\n\
git add -A\n\
tree=$(git write-tree)\n\
commit=$(git commit-tree \"$tree\" -m \"{program} caller baseline\")\n\
git update-ref refs/{program}/caller-base \"$commit\"\n\
files=$(git ls-tree -r \"$tree\" | wc -l | tr -d \" \")\n\
bytes=$(git ls-tree -r -l \"$tree\" | awk \"{{ s += \\$4 }} END {{ printf \\\"%d\\\", s }}\")\n\
printf \"%s %s %s\\n\" \"$commit\" \"$files\" \"$bytes\""
    )
}

fn base_script(program: &str) -> String {
    format!(
        "export GIT_DIR=$1\ngit rev-parse -q --verify refs/{program}/caller-base 2>/dev/null || printf \"missing\\n\""
    )
}

fn collect_script(program: &str) -> String {
    format!(
        "set -e\n\
export GIT_DIR=$1 GIT_WORK_TREE=$2\n\
export GIT_AUTHOR_NAME={program} GIT_AUTHOR_EMAIL={program}@localhost\n\
export GIT_COMMITTER_NAME={program} GIT_COMMITTER_EMAIL={program}@localhost\n\
index=$GIT_DIR/collect-index.$$\n\
trap 'rm -f \"$index\"' EXIT\n\
cp \"$GIT_DIR/index\" \"$index\" 2>/dev/null || :\n\
GIT_INDEX_FILE=$index git add -A\n\
tree=$(GIT_INDEX_FILE=$index git write-tree)\n\
commit=$(git commit-tree \"$tree\" -p refs/{program}/caller-base -m \"{program} caller result\")\n\
git update-ref refs/{program}/caller-result \"$commit\"\n\
git diff --binary --full-index refs/{program}/caller-base refs/{program}/caller-result"
    )
}

fn manifest_script(program: &str) -> String {
    format!(
        "set -e\nexport GIT_DIR=$1\ngit diff --no-renames --name-status refs/{program}/caller-base refs/{program}/caller-result"
    )
}

// The incremental path's sandbox scripts, byte-identical to the shell
// implementation's; conformance compares the recorded script text.
const COMPARE_SCRIPT: &str = r#"set -e
worktree=$2 prev=$3 cur=$4 dirty=$5 filter=$6 history=$7
if [ -e "$dirty" ]; then
    printf "F\tdirty\n"
    exit 0
fi
if [ ! -f "$prev" ] || [ ! -f "$cur" ]; then
    printf "F\tmissing\n"
    exit 0
fi
want=$(printf "osa-caller-manifest\t1\t%s\t%s" "$filter" "$history")
head=$(sed -n 1p "$prev")
if [ "$head" != "$want" ]; then
    printf "F\theader\n"
    exit 0
fi
if [ "$(tail -n 1 "$prev")" != "complete	1" ]; then
    printf "F\tincomplete\n"
    exit 0
fi
awk -F "\t" 'NR==FNR {
    if (FNR > 1 && $1 != "complete") pm[$5] = $1 " " $3
    next
}
FNR > 1 && $1 != "complete" {
    if (!($5 in pm) || pm[$5] != $1 " " $3) print "U\t" $5
    delete pm[$5]
}' "$prev" "$cur""#;

const INCREMENTAL_DELETE_HEAD: &str = r#"set -e
worktree=$2 prev=$3 cur=$4 dirty=$5 filter=$6 history=$7
tmp=${TMPDIR:-/tmp}/"#;

const INCREMENTAL_DELETE_TAIL: &str = r#"-inc.$$
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp"
awk -F "\t" 'NR==FNR {
    if (FNR > 1 && $1 != "complete") pm[$5] = 1
    next
}
FNR > 1 && $1 != "complete" {
    delete pm[$5]
}
END {
    for (p in pm) print p
}' "$prev" "$cur" > "$tmp/deleted"
while IFS= read -r path; do
    case $path in
        ""|/*|..|../*|*/..|*/../*) continue ;;
    esac
    target=$worktree/$path
    if [ -f "$target" ] || [ -L "$target" ]; then
        rm -f -- "$target"
    fi
done < "$tmp/deleted"
awk -F "\t" 'FNR > 1 && $1 != "complete" { print $5 }' "$cur" \
    | LC_ALL=C sort -u > "$tmp/current"
awk -F "\t" 'FNR > 1 && $1 != "complete" { print $5 }' "$prev" \
    | LC_ALL=C sort -u > "$tmp/previous"
find "$worktree" -mindepth 1 -path "$worktree/.git" -prune -o \
    \( -type f -o -type l \) -print \
    | awk -v p="$worktree/" 'index($0, p) == 1 { print substr($0, length(p) + 1) }' \
    | LC_ALL=C sort -u > "$tmp/work"
comm -23 "$tmp/work" "$tmp/current" > "$tmp/notcurrent"
comm -23 "$tmp/notcurrent" "$tmp/previous" > "$tmp/leftover"
while IFS= read -r path; do
    case $path in
        ""|/*|..|../*|*/..|*/../*) continue ;;
    esac
    if [ "$filter" = gitignore ] \
        && git -C "$worktree" check-ignore -q --no-index -- "$path" 2>/dev/null; then
        continue
    fi
    target=$worktree/$path
    if [ -f "$target" ] || [ -L "$target" ]; then
        rm -f -- "$target"
    fi
done < "$tmp/leftover"
if [ "$history" != git ]; then
    rm -rf -- "$worktree/.git"
fi
find "$worktree" -mindepth 1 -depth -type d ! -path "$worktree/.git" \
    -exec rmdir -- {} \; 2>/dev/null || true
rm -f -- "$cur""#;

const PROBE_SCRIPT: &str = r#"set -e
worktree=$2 want_head=$3 base_name=$4 base_commit=$5
if [ ! -f "$worktree/.git" ]; then
    printf "stale\n"
    exit 0
fi
got=$(git -C "$worktree" rev-parse -q --verify HEAD 2>/dev/null) || got=
if [ "$got" != "$want_head" ]; then
    printf "stale\n"
    exit 0
fi
if [ -n "$base_name" ]; then
    got_base=$(git -C "$worktree" rev-parse -q --verify \
        "refs/remotes/origin/$base_name" 2>/dev/null) || got_base=
    if [ "$got_base" != "$base_commit" ]; then
        printf "stale\n"
        exit 0
    fi
fi
printf "current\n""#;

const DIRTY_SCRIPT: &str = r#"set -e
dirty=$3
mkdir -p "$(dirname -- "$dirty")"
printf "incremental\n" > "$dirty""#;

const CLEAR_SCRIPT: &str = r#"rm -f -- "$3""#;

fn incremental_delete_script(ctx: &Context) -> String {
    format!(
        "{INCREMENTAL_DELETE_HEAD}{}{INCREMENTAL_DELETE_TAIL}",
        ctx.profile.tmp_prefix
    )
}

fn drop_base_script(program: &str) -> String {
    format!("export GIT_DIR=$1\ngit update-ref -d refs/{program}/caller-base 2>/dev/null || true")
}

fn run_git(tree: &Path, args: &[&str]) -> Option<std::process::Output> {
    Command::new("git")
        .args(args)
        .current_dir(tree)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()
}

fn git_text(tree: &Path, args: &[&str]) -> Option<String> {
    let output = run_git(tree, args)?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

struct Base {
    commit: String,
    name: String,
    reference: String,
    temp_ref: String,
}

fn resolve_base(program: &str, tree: &Path, reference: &str) -> Result<Base, Failure> {
    let mut base = Base {
        commit: String::new(),
        name: String::new(),
        reference: String::new(),
        temp_ref: String::new(),
    };
    if reference.is_empty() {
        return Ok(base);
    }
    let spec = format!("{reference}^{{commit}}");
    let Some(commit) = git_text(
        tree,
        &["rev-parse", "-q", "--verify", "--end-of-options", &spec],
    ) else {
        return Err(Failure::usage(format!(
            "sync-in: --base '{reference}' does not name a commit in '{}'",
            tree.display()
        )));
    };
    base.commit = commit;
    let symbolic = git_text(
        tree,
        &[
            "rev-parse",
            "-q",
            "--verify",
            "--symbolic-full-name",
            "--end-of-options",
            reference,
        ],
    )
    .unwrap_or_default();
    if let Some(name) = symbolic.strip_prefix("refs/heads/") {
        base.name = name.to_string();
        base.reference = symbolic;
    } else if let Some(rest) = symbolic.strip_prefix("refs/remotes/") {
        base.name = rest
            .split_once('/')
            .map(|(_, name)| name)
            .unwrap_or(rest)
            .to_string();
        base.reference = symbolic;
    } else if symbolic.starts_with("refs/tags/") {
        base.name = "base".to_string();
        base.reference = symbolic;
    } else {
        base.name = "base".to_string();
        base.temp_ref = format!("refs/{program}-bundle/{}", std::process::id());
    }
    if base.name.is_empty() {
        return Err(Failure::usage(format!(
            "sync-in: --base '{reference}' does not name a usable origin ref"
        )));
    }
    let check = Command::new("git")
        .args([
            "check-ref-format",
            &format!("refs/remotes/origin/{}", base.name),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !check {
        return Err(Failure::usage(format!(
            "sync-in: --base '{reference}' does not name a usable origin ref"
        )));
    }
    Ok(base)
}

/// An on-disk manifest build: the temp repository whose index staged the host
/// tree, kept so the incremental path can `checkout-index` changed files.
struct ManifestBuild {
    git_dir: PathBuf,
    index: PathBuf,
    filter: String,
    history: String,
}

fn manifest_add(tree: &Path, git_dir: &Path, index: &Path, force: bool) -> bool {
    let mut add = Command::new("git");
    add.args(["add", "-A"]);
    if force {
        add.arg("-f");
    }
    add.env("GIT_DIR", git_dir)
        .env("GIT_WORK_TREE", tree)
        .env("GIT_INDEX_FILE", index)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    add.status().map(|status| status.success()).unwrap_or(false)
}

/// Builds the host-filtered manifest for TREE with the same filter the upload
/// uses: `.gitignore` for a git worktree, everything when --no-git-ignore is
/// set or the tree is not a git worktree. The header carries the schema version
/// and the final `complete` record is the completion marker. At a repository
/// root the host index is copied first so clean files keep their stat cache;
/// the copy never modifies the host's index.
fn host_manifest(
    ctx: &Context,
    tree: &Path,
    is_git: bool,
    out: &Path,
    tag: &str,
    temps: &TempFiles,
) -> Option<ManifestBuild> {
    let dir = temp_path(ctx, &format!("manifest.{}.{tag}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    temps.track(dir.clone());
    let filter = if ctx.options.no_git_ignore || !is_git {
        "all"
    } else {
        "gitignore"
    };
    let history = if is_git { "git" } else { "none" };
    let repo = dir.join("repo");
    let git_dir = repo.join(".git");
    let index = dir.join("index");
    let inited = Command::new("git")
        .args(["init", "-q"])
        .arg(&repo)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !inited {
        ctx.warn(
            "could not build the caller manifest; the next incremental sync will use a full sync",
        );
        return None;
    }
    // A repository root copies the host index so clean files keep their stat
    // cache; an alternate lets write-tree read the host objects.
    if is_git {
        if let Some(root) = git_text(tree, &["rev-parse", "--show-toplevel"]) {
            if Path::new(&root) == tree {
                if let Some(index_path) = git_text(tree, &["rev-parse", "--git-path", "index"]) {
                    let source = if Path::new(&index_path).is_absolute() {
                        PathBuf::from(&index_path)
                    } else {
                        tree.join(&index_path)
                    };
                    if fs::copy(&source, &index).is_ok() {
                        if let Some(objects) =
                            git_text(tree, &["rev-parse", "--git-path", "objects"])
                        {
                            let objects = if Path::new(&objects).is_absolute() {
                                PathBuf::from(&objects)
                            } else {
                                tree.join(&objects)
                            };
                            if objects.is_dir() {
                                let info = git_dir.join("objects").join("info");
                                let _ = fs::create_dir_all(&info);
                                let _ = fs::write(
                                    info.join("alternates"),
                                    format!("{}\n", objects.display()),
                                );
                            }
                        }
                    } else {
                        let _ = fs::remove_file(&index);
                    }
                }
            }
        }
    }
    if !manifest_add(tree, &git_dir, &index, filter == "all") {
        // A stale or conflicted host index copy falls back to a fresh index.
        let _ = fs::remove_file(&index);
        if !manifest_add(tree, &git_dir, &index, filter == "all") {
            ctx.warn("could not build the caller manifest; the next incremental sync will use a full sync");
            return None;
        }
    }
    let tree_id = Command::new("git")
        .args(["write-tree"])
        .env("GIT_DIR", &git_dir)
        .env("GIT_INDEX_FILE", &index)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string());
    let Some(tree_id) = tree_id else {
        ctx.warn(
            "could not build the caller manifest; the next incremental sync will use a full sync",
        );
        return None;
    };
    let listing = Command::new("git")
        .args(["ls-tree", "-r", "-l", &tree_id])
        .env("GIT_DIR", &git_dir)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    let mut text = format!("osa-caller-manifest\t1\t{filter}\t{history}\n");
    for line in listing.lines() {
        // "<mode> <type> <sha> <size>\t<path>"
        let Some((meta, path)) = line.split_once('\t') else {
            continue;
        };
        let parts: Vec<&str> = meta.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
        text.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\n",
            parts[0], parts[3], parts[2], parts[1], path
        ));
    }
    text.push_str("complete\t1\n");
    if fs::write(out, text).is_err() {
        ctx.warn(
            "could not build the caller manifest; the next incremental sync will use a full sync",
        );
        return None;
    }
    let _ = fs::set_permissions(out, fs::Permissions::from_mode(0o600));
    Some(ManifestBuild {
        git_dir,
        index,
        filter: filter.to_string(),
        history: history.to_string(),
    })
}

fn upload_file(ctx: &Context, name: &str, source: &Path, dest: &str) -> bool {
    let mut command = Command::new("openshell");
    if let Some(gateway) = ctx.gateway() {
        command.arg("-g").arg(gateway);
    }
    command
        .args(["sandbox", "upload", name])
        .arg(source)
        .arg(dest)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Uploads a whole tree through the sandbox upload endpoint from inside it, so
/// its paths land at DEST. Incidental output goes to stderr.
fn upload_tree(ctx: &Context, name: &str, source: &Path, dest: &str, no_git_ignore: bool) -> bool {
    let mut upload = Command::new("openshell");
    if let Some(gateway) = ctx.gateway() {
        upload.arg("-g").arg(gateway);
    }
    upload.args(["sandbox", "upload"]);
    if no_git_ignore {
        upload.arg("--no-git-ignore");
    }
    upload
        .arg(name)
        .arg(".")
        .arg(dest)
        .current_dir(source)
        .stdin(Stdio::null())
        .stdout(Stdio::from(unsafe {
            std::fs::File::from_raw_fd(libc::dup(2))
        }));
    upload
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Compares the previous sandbox manifest with the freshly built host manifest.
/// Returns None when the caller must take the full path (missing, malformed,
/// incompatible, or interrupted state); the upload paths are the new and
/// changed host-filtered files.
#[allow(clippy::too_many_arguments)]
fn incremental_ready(
    ctx: &Context,
    name: &str,
    workdir: &str,
    tree: &Path,
    is_git: bool,
    manifest: &str,
    dirty: &str,
    temps: &TempFiles,
) -> (
    Option<PathBuf>,
    Option<String>,
    Option<ManifestBuild>,
    Option<Vec<String>>,
) {
    let pid = std::process::id();
    let host = temp_path(ctx, &format!("manifest.{pid}"));
    let _ = fs::remove_file(&host);
    let Some(build) = host_manifest(ctx, tree, is_git, &host, "incremental", temps) else {
        return (None, None, None, None);
    };
    let parent = Path::new(workdir)
        .parent()
        .map(|parent| parent.display().to_string())
        .unwrap_or_else(|| workdir.to_string());
    let sandbox = format!("{parent}/{}-manifest.{pid}", ctx.profile.tmp_prefix);
    temps.track(host.clone());
    if !upload_file(ctx, name, &host, &sandbox) {
        return (Some(host), Some(sandbox), Some(build), None);
    }
    let compared = run_script(
        ctx,
        name,
        workdir,
        COMPARE_SCRIPT,
        &[
            manifest.to_string(),
            sandbox.clone(),
            dirty.to_string(),
            build.filter.clone(),
            build.history.clone(),
        ],
    )
    .filter(|output| output.status.success());
    let Some(compared) = compared else {
        return (Some(host), Some(sandbox), Some(build), None);
    };
    let text = String::from_utf8_lossy(&compared.stdout)
        .trim_end_matches('\n')
        .to_string();
    if text.starts_with('F') {
        return (Some(host), Some(sandbox), Some(build), None);
    }
    let mut paths = Vec::new();
    for line in text.lines() {
        if let Some((_, path)) = line.split_once('\t') {
            paths.push(path.to_string());
        }
    }
    (Some(host), Some(sandbox), Some(build), Some(paths))
}

/// Marks the sandbox state dirty, stages the changed and new files from the
/// manifest index, uploads them into the existing workdir, then applies host
/// deletions and agent-leftover deletion.
#[allow(clippy::too_many_arguments)]
fn incremental_upload(
    ctx: &Context,
    name: &str,
    workdir: &str,
    tree: &Path,
    build: &ManifestBuild,
    paths: &[String],
    manifest: &str,
    sandbox_manifest: &str,
    dirty: &str,
    temps: &TempFiles,
) -> bool {
    if run_script(ctx, name, workdir, DIRTY_SCRIPT, &[dirty.to_string()])
        .is_none_or(|output| !output.status.success())
    {
        return false;
    }
    if !paths.is_empty() {
        let stage = temp_path(ctx, &format!("stage.{}", std::process::id()));
        let _ = fs::remove_dir_all(&stage);
        temps.track(stage.clone());
        let listing = format!("{}\n", paths.join("\n"));
        let mut checkout = Command::new("git");
        checkout
            .args([
                "checkout-index",
                &format!("--prefix={}/", stage.display()),
                "--stdin",
            ])
            .env("GIT_DIR", &build.git_dir)
            .env("GIT_WORK_TREE", tree)
            .env("GIT_INDEX_FILE", &build.index)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let checked = match checkout.spawn() {
            Ok(mut child) => {
                let written = child.stdin.take().is_some_and(|mut stdin| {
                    std::io::Write::write_all(&mut stdin, listing.as_bytes()).is_ok()
                });
                written && child.wait().map(|status| status.success()).unwrap_or(false)
            }
            Err(_) => false,
        };
        if !checked {
            return false;
        }
        if !upload_tree(ctx, name, &stage, workdir, false) {
            return false;
        }
    }
    let delete = incremental_delete_script(ctx);
    run_script(
        ctx,
        name,
        workdir,
        &delete,
        &[
            manifest.to_string(),
            sandbox_manifest.to_string(),
            dirty.to_string(),
            build.filter.clone(),
            build.history.clone(),
        ],
    )
    .is_some_and(|output| output.status.success())
}

fn drop_base(ctx: &Context, name: &str, workdir: &str) {
    let _ = run_script(ctx, name, workdir, &drop_base_script(ctx.program()), &[]);
}

fn clear_dirty(ctx: &Context, name: &str, workdir: &str, path: &str) {
    let _ = run_script(ctx, name, workdir, CLEAR_SCRIPT, &[path.to_string()]);
}

pub fn sync_in(ctx: &Context, args: &[OsString]) -> Outcome {
    if args.len() != 1 {
        return Err(Failure::usage(format!(
            "usage: {} sync-in HOST_TREE [--base REF] [--incremental] [--json]",
            ctx.program()
        )));
    }
    let source = args[0].to_string_lossy().into_owned();
    let (name, workdir) = sync_target(ctx, "sync-in")?;
    if !Path::new(&source).is_dir() {
        return Err(Failure::usage(format!(
            "sync-in: '{source}' is not a directory"
        )));
    }
    let tree = fs::canonicalize(&source).unwrap_or_else(|_| PathBuf::from(&source));
    let is_git = run_git(&tree, &["rev-parse", "--is-inside-work-tree"])
        .is_some_and(|output| output.status.success());
    let head = if is_git {
        match git_text(
            &tree,
            &[
                "rev-parse",
                "-q",
                "--verify",
                "--end-of-options",
                "HEAD^{commit}",
            ],
        ) {
            Some(head) => head,
            None => {
                return Err(Failure::usage(format!(
                    "sync-in: '{}' has no HEAD commit to sync",
                    tree.display()
                )))
            }
        }
    } else {
        String::new()
    };
    let base_ref = ctx.options.base_ref.clone().unwrap_or_default();
    if !base_ref.is_empty() && !is_git {
        return Err(Failure::usage(format!(
            "sync-in: --base '{base_ref}' needs a git HOST_TREE"
        )));
    }
    let base = resolve_base(ctx.program(), &tree, &base_ref)?;
    ctx.require_openshell()?;
    require_running(ctx, &name)?;

    let temps = TempFiles::new();
    let repo = format!("{}-repo", caller_git_dir(ctx, &workdir));
    let bundle = format!("{}-bundle", caller_git_dir(ctx, &workdir));
    let manifest = format!("{}-manifest", caller_git_dir(ctx, &workdir));
    let dirty = format!("{}-manifest.dirty", caller_git_dir(ctx, &workdir));

    let mut bundle_tmp: Option<PathBuf> = None;
    if is_git {
        let path = temp_path(ctx, &format!("sync.{}", std::process::id()));
        let _ = fs::remove_file(&path);
        temps.track(path.clone());
        if !base.temp_ref.is_empty()
            && run_git(&tree, &["update-ref", &base.temp_ref, &base.commit])
                .is_none_or(|output| !output.status.success())
        {
            return Err(Failure::dep(format!(
                "sync-in: could not prepare the base commit in '{}'",
                tree.display()
            )));
        }
        let ref_to_carry = if base.temp_ref.is_empty() {
            base.reference.clone()
        } else {
            base.temp_ref.clone()
        };
        let mut bundle_args: Vec<&str> = vec!["bundle", "create", "-q"];
        let path_text = path.to_string_lossy().into_owned();
        bundle_args.push(&path_text);
        bundle_args.push("HEAD");
        if !ref_to_carry.is_empty() {
            bundle_args.push(&ref_to_carry);
        }
        let created = run_git(&tree, &bundle_args).is_some_and(|output| output.status.success());
        if !base.temp_ref.is_empty() {
            let _ = run_git(&tree, &["update-ref", "-d", &base.temp_ref]);
        }
        if !created {
            return Err(Failure::dep(format!(
                "sync-in: could not create a git bundle for '{}'",
                tree.display()
            )));
        }
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        bundle_tmp = Some(path);
    }

    let mut manifest_host: Option<PathBuf> = None;
    let mut sandbox_manifest: Option<String> = None;
    let mut manifest_build: Option<ManifestBuild> = None;
    let mut upload_paths: Option<Vec<String>> = None;
    if ctx.options.incremental {
        let (host, sandbox, build, paths) = incremental_ready(
            ctx, &name, &workdir, &tree, is_git, &manifest, &dirty, &temps,
        );
        manifest_host = host;
        sandbox_manifest = sandbox;
        manifest_build = build;
        upload_paths = paths;
    }
    let incremental = upload_paths.is_some();

    if incremental {
        let paths = upload_paths.as_deref().unwrap_or_default();
        let build = manifest_build
            .as_ref()
            .expect("an incremental sync has a manifest build");
        let sandbox = sandbox_manifest
            .as_deref()
            .expect("an incremental sync has a sandbox manifest");
        if !incremental_upload(
            ctx, &name, &workdir, &tree, build, paths, &manifest, sandbox, &dirty, &temps,
        ) {
            drop_base(ctx, &name, &workdir);
            clear_dirty(ctx, &name, &workdir, sandbox);
            return Err(Failure::gateway(format!(
                "could not apply the incremental sync to '{name}:{workdir}'; the next sync will use the full path"
            )));
        }
    } else {
        if let Some(sandbox) = &sandbox_manifest {
            clear_dirty(ctx, &name, &workdir, sandbox);
        }
        let clear = clear_script(ctx.program());
        if run_script(
            ctx,
            &name,
            &workdir,
            &clear,
            &[
                repo.clone(),
                bundle.clone(),
                manifest.clone(),
                dirty.clone(),
            ],
        )
        .is_none_or(|output| !output.status.success())
        {
            return Err(Failure::gateway(format!(
                "could not clear '{name}:{workdir}'"
            )));
        }
        if !upload_tree(ctx, &name, &tree, &workdir, ctx.options.no_git_ignore) {
            return Err(Failure::gateway(format!(
                "openshell command failed while uploading '{}'",
                tree.display()
            )));
        }
    }

    let mut history_current = false;
    if incremental && is_git {
        if let Some(probe) = run_script(
            ctx,
            &name,
            &workdir,
            PROBE_SCRIPT,
            &[head.clone(), base.name.clone(), base.commit.clone()],
        ) {
            if probe.status.success() && String::from_utf8_lossy(&probe.stdout).trim() == "current"
            {
                history_current = true;
            }
        }
    }
    if is_git && !history_current {
        let Some(bundle_path) = &bundle_tmp else {
            unreachable!("a git host tree has a bundle");
        };
        let uploaded_bundle = upload_file(ctx, &name, bundle_path, &bundle);
        if !uploaded_bundle {
            return Err(Failure::gateway("openshell command failed"));
        }
        let history = history_script(ctx.program());
        let result = run_script(
            ctx,
            &name,
            &workdir,
            &history,
            &[
                repo.clone(),
                bundle.clone(),
                head.clone(),
                base.name.clone(),
                if base.temp_ref.is_empty() {
                    base.reference.clone()
                } else {
                    base.temp_ref.clone()
                },
                base.commit.clone(),
            ],
        );
        if result.is_none_or(|output| !output.status.success()) {
            if incremental {
                drop_base(ctx, &name, &workdir);
            } else {
                let clear = clear_script(ctx.program());
                let _ = run_script(
                    ctx,
                    &name,
                    &workdir,
                    &clear,
                    &[
                        repo.clone(),
                        bundle.clone(),
                        manifest.clone(),
                        dirty.clone(),
                    ],
                );
            }
            return Err(Failure::gateway(format!(
                "uploaded, but could not set up history in '{name}:{workdir}'"
            )));
        }
    }
    let keepgit = if is_git { "1" } else { "0" };
    let baseline = baseline_script(ctx.program());
    let Some(result) = run_script(ctx, &name, &workdir, &baseline, &[keepgit.to_string()])
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
    else {
        if incremental {
            drop_base(ctx, &name, &workdir);
        } else {
            let clear = clear_script(ctx.program());
            let _ = run_script(
                ctx,
                &name,
                &workdir,
                &clear,
                &[repo, bundle, manifest.clone(), dirty],
            );
        }
        return Err(Failure::gateway(format!(
            "uploaded, but could not record the baseline in '{name}:{workdir}'"
        )));
    };

    // A full sync also records a manifest, so a later developer pass can stay
    // incremental; the extra write does not change what the full path syncs.
    let recorded = match &manifest_host {
        Some(host) => upload_file(ctx, &name, host, &manifest),
        None => {
            let out = temp_path(ctx, &format!("manifest.{}.out", std::process::id()));
            let _ = fs::remove_file(&out);
            temps.track(out.clone());
            match host_manifest(ctx, &tree, is_git, &out, "record", &temps) {
                Some(_) => upload_file(ctx, &name, &out, &manifest),
                // A build failure is soft: the warning above already said the
                // next sync will use the full path.
                None => true,
            }
        }
    };
    if !recorded {
        ctx.warn(
            "could not record the caller manifest; the next incremental sync will use a full sync",
        );
        if incremental {
            drop_base(ctx, &name, &workdir);
            return Err(Failure::gateway(format!(
                "incremental sync could not record its manifest in '{name}:{workdir}'; the next sync will use the full path"
            )));
        }
    }
    if incremental
        && run_script(
            ctx,
            &name,
            &workdir,
            CLEAR_SCRIPT,
            std::slice::from_ref(&dirty),
        )
        .is_none_or(|output| !output.status.success())
    {
        ctx.warn(&format!(
            "could not clear the incremental marker in '{name}:{workdir}'"
        ));
    }

    let fields: Vec<&str> = result.split_whitespace().collect();
    let commit = fields.first().copied().unwrap_or("");
    let files = fields.get(1).copied().unwrap_or("0");
    let bytes = fields.get(2).copied().unwrap_or("0");
    if ctx.options.json {
        println!(
            "{{\"baseline\":{},\"files\":{files},\"bytes\":{bytes}}}",
            super::commands::json_str(commit)
        );
    } else {
        ctx.say(&format!(
            "Synced '{}' to '{name}:{workdir}' (baseline {commit}, {files} files).",
            tree.display()
        ));
    }
    Ok(())
}

pub fn collect_patch(ctx: &Context, args: &[OsString]) -> Outcome {
    if !args.is_empty() {
        return Err(Failure::usage(format!(
            "usage: {} collect-patch --out FILE [--json]",
            ctx.program()
        )));
    }
    let Some(out) = ctx.options.out.clone().filter(|value| !value.is_empty()) else {
        return Err(Failure::usage("collect-patch needs --out FILE"));
    };
    let (name, workdir) = sync_target(ctx, "collect-patch")?;
    let Some(parent) = Path::new(&out).parent() else {
        return Err(Failure::usage("collect-patch: directory '' does not exist"));
    };
    if !parent.is_dir() {
        return Err(Failure::usage(format!(
            "collect-patch: directory '{}' does not exist",
            parent.display()
        )));
    }
    ctx.require_openshell()?;
    require_running(ctx, &name)?;
    let base = base_script(ctx.program());
    let Some(baseline) = script_text_output(ctx, &name, &workdir, &base) else {
        return Err(Failure::gateway(format!(
            "could not read the baseline in '{name}:{workdir}'"
        )));
    };
    if baseline == "missing" || baseline.is_empty() {
        return Err(Failure::usage(format!(
            "no baseline in '{name}:{workdir}': run '{} sync-in HOST_TREE' first",
            ctx.program()
        )));
    }
    let temp = PathBuf::from(format!(
        "{out}.{}.{}",
        ctx.profile.tmp_prefix,
        std::process::id()
    ));
    let _ = fs::remove_file(&temp);
    if fs::write(&temp, "").is_err() {
        let _ = fs::remove_file(&temp);
        return Err(Failure::usage(format!(
            "collect-patch: cannot write '{out}'"
        )));
    }
    let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
    let collect = collect_script(ctx.program());
    let collected = run_script(ctx, &name, &workdir, &collect, &[]);
    let detail = match &collected {
        Some(output) if !output.status.success() => {
            String::from_utf8_lossy(&output.stderr).into_owned()
        }
        None => String::new(),
        Some(_) => String::new(),
    };
    let patch = collected
        .filter(|output| output.status.success())
        .map(|output| output.stdout);
    let Some(patch) = patch else {
        let detail = detail.lines().take(3).collect::<Vec<_>>().join("\n");
        let _ = fs::remove_file(&temp);
        return Err(Failure::gateway(format!(
            "could not collect changes from '{name}:{workdir}'{}{}",
            if detail.is_empty() { "" } else { ": " },
            detail
        )));
    };
    let Some(manifest) = script_text_output(ctx, &name, &workdir, &manifest_script(ctx.program()))
    else {
        let _ = fs::remove_file(&temp);
        return Err(Failure::gateway(format!(
            "could not collect changes from '{name}:{workdir}'"
        )));
    };
    if fs::write(&temp, patch).is_err() || fs::rename(&temp, &out).is_err() {
        let _ = fs::remove_file(&temp);
        return Err(Failure::gateway(format!(
            "could not collect changes from '{name}:{workdir}'"
        )));
    }
    let _ = fs::set_permissions(&out, fs::Permissions::from_mode(0o600));
    if ctx.options.json {
        let mut files = String::new();
        for line in manifest.lines() {
            let Some((status, path)) = line.split_once('\t') else {
                continue;
            };
            if status.is_empty() {
                continue;
            }
            if !files.is_empty() {
                files.push(',');
            }
            files.push_str(&format!(
                "{{\"status\":{},\"path\":{}}}",
                super::commands::json_str(status),
                super::commands::json_str(path)
            ));
        }
        let empty = fs::metadata(&out).map(|meta| meta.len()).unwrap_or(0) == 0;
        println!(
            "{{\"empty\":{empty},\"baseline\":{},\"files\":[{files}]}}",
            super::commands::json_str(&baseline)
        );
    } else {
        ctx.say(&format!(
            "Wrote the changes in '{name}:{workdir}' to '{out}'."
        ));
    }
    Ok(())
}
