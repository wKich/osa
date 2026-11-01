//! The `osa` command implementations behind the hand-rolled dispatcher.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::value::RawValue;

use crate::entries::RegistryEntry;
use crate::flat;
use crate::json;
use crate::process;
use crate::state::{self, IdleState, StatePaths};

pub const EX_USAGE: i32 = 1;
pub const EX_REFUSED: i32 = 2;
pub const EX_DEP: i32 = 2;

pub const AGENT_TAGS: [&str; 4] = ["mk", "oc", "cc", "cx"];

pub struct Context {
    pub repo_root: PathBuf,
    pub paths: StatePaths,
}

impl Default for Context {
    fn default() -> Self {
        Self::new()
    }
}

impl Context {
    pub fn new() -> Self {
        Context {
            repo_root: repo_root(),
            paths: StatePaths::from_env(),
        }
    }

    /// The front-end that owns an agent tag.
    pub fn front_end(&self, tag: &str) -> Option<PathBuf> {
        let name = match tag {
            "mk" => "maki-oss",
            "oc" => "opencode-oss",
            "cc" => "claude-oss",
            "cx" => "codex-oss",
            _ => return None,
        };
        Some(self.repo_root.join("bin").join(name))
    }

    pub fn session_dir(&self, sandbox: &str) -> PathBuf {
        self.paths.session_dir(sandbox)
    }
}

/// The checkout the command surface belongs to: the shim exports it, and a
/// binary run straight from the workspace finds it by walking up from
/// `target/`.
pub fn repo_root() -> PathBuf {
    if let Some(root) = std::env::var_os("OSA_REPO_ROOT") {
        let root = PathBuf::from(root);
        if is_checkout(&root) {
            return root;
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        for ancestor in executable.ancestors().skip(1) {
            if is_checkout(ancestor) {
                return ancestor.to_path_buf();
            }
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn is_checkout(dir: &Path) -> bool {
    dir.join("bin").join("osa").is_file() && dir.join("osa-core").join("Cargo.toml").is_file()
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    pub json: bool,
    pub yes: bool,
    pub quick: bool,
    pub sandbox: Option<String>,
    pub action: Option<String>,
    pub path: Option<String>,
    pub agent: Option<String>,
    pub profile: Option<String>,
    pub name: Option<String>,
    pub attach: Option<String>,
}

struct Loaded {
    entry: RegistryEntry,
    pending: Option<String>,
    orphan: bool,
}

#[derive(Serialize)]
struct EntryJson<'a> {
    version: &'a str,
    agent: &'a str,
    host_path: &'a str,
    project: &'a str,
    sandbox_name: &'a str,
    sandbox_id: &'a str,
    created: &'a str,
    last_session: &'a str,
    fingerprint: &'a str,
    pending: &'a str,
    orphan: bool,
}

impl<'a> EntryJson<'a> {
    fn new(loaded: &'a Loaded) -> Self {
        EntryJson {
            version: &loaded.entry.version,
            agent: &loaded.entry.agent,
            host_path: &loaded.entry.host_path,
            project: &loaded.entry.project,
            sandbox_name: &loaded.entry.sandbox_name,
            sandbox_id: &loaded.entry.sandbox_id,
            created: &loaded.entry.created,
            last_session: &loaded.entry.last_session,
            fingerprint: loaded.entry.fingerprint.as_deref().unwrap_or(""),
            pending: loaded.pending.as_deref().unwrap_or(""),
            orphan: loaded.orphan,
        }
    }
}

#[derive(Serialize)]
struct IdleJson {
    period: Option<u64>,
    state: String,
    deadline: Option<String>,
    estimated: bool,
    last_event: Option<String>,
    last_time: Option<String>,
}

impl From<IdleState> for IdleJson {
    fn from(idle: IdleState) -> Self {
        IdleJson {
            period: idle.period_number(),
            state: idle.state,
            deadline: idle.deadline,
            estimated: idle.estimated,
            last_event: idle.event,
            last_time: idle.time,
        }
    }
}

#[derive(Serialize)]
struct StatusQuick<'a> {
    #[serde(flatten)]
    entry: EntryJson<'a>,
    fingerprint_result: &'a str,
    busy: bool,
    idle: IdleJson,
}

#[derive(Serialize)]
struct StatusFull<'a> {
    #[serde(flatten)]
    entry: EntryJson<'a>,
    status: Box<RawValue>,
}

#[derive(Serialize)]
struct MessageBody<'a> {
    message: &'a str,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
}

#[derive(Serialize)]
struct AgentError<'a> {
    agent: &'a str,
    error: MessageBody<'a>,
}

#[derive(Serialize)]
struct HealthFallback<'a> {
    sandbox: &'a str,
    agent: &'a str,
    idle: IdleJson,
    mcp: ErrorBody<'a>,
    doctor: ErrorBody<'a>,
}

#[derive(Serialize)]
struct Refusal<'a> {
    sandbox: &'a str,
    action: &'a str,
    ok: bool,
    changed: Vec<String>,
    message: &'a str,
}

/// Serializes a list of documents through the serializer and carries each one
/// as raw JSON, so field order survives and no output is string-assembled.
fn json_collection<T: Serialize>(items: Vec<T>) -> String {
    let documents: Vec<Box<RawValue>> = items
        .into_iter()
        .map(|item| {
            let text = serde_json::to_string(&item).expect("serializable output");
            RawValue::from_string(text).expect("the serializer emits valid JSON")
        })
        .collect();
    json::line(&documents)
}

fn warn_problems(problems: &[String]) {
    for problem in problems {
        eprintln!("{problem}");
    }
}

fn fatal_problems(problems: &[String]) -> i32 {
    warn_problems(problems);
    EX_USAGE
}

fn load_entry(ctx: &Context, path: &Path) -> Result<Loaded, Vec<String>> {
    let parsed = flat::read_entry(path)?;
    let entry = RegistryEntry::from_flat(&parsed.entry);
    let pending = state::pending_kind(&ctx.session_dir(&entry.sandbox_name));
    let orphan = !Path::new(&entry.host_path).is_dir();
    Ok(Loaded {
        entry,
        pending,
        orphan,
    })
}

/// Every entry a listing can read. An unreadable entry is named on stderr and
/// skipped, so one damaged file cannot hide the projects that are intact.
fn load_all_reporting(ctx: &Context) -> Vec<Loaded> {
    let mut loaded = Vec::new();
    for path in ctx.paths.registry_entries() {
        match load_entry(ctx, &path) {
            Ok(entry) => loaded.push(entry),
            Err(problems) => warn_problems(&problems),
        }
    }
    loaded
}

/// `cd PATH && pwd -P`, or the absolute literal path when PATH is gone.
pub fn absolute_path(path: &str) -> PathBuf {
    if Path::new(path).is_dir() {
        if let Ok(physical) = fs::canonicalize(path) {
            return physical;
        }
    }
    let path = Path::new(path);
    if path.is_absolute() {
        return path.to_path_buf();
    }
    physical_cwd().join(path)
}

fn physical_cwd() -> PathBuf {
    fs::canonicalize(".").unwrap_or_else(|_| std::env::current_dir().unwrap_or_default())
}

fn left(text: &str, width: usize) -> String {
    let mut padded = text.to_string();
    if text.len() < width {
        padded.push_str(&" ".repeat(width - text.len()));
    }
    padded
}

pub fn projects(ctx: &Context, json_output: bool) -> i32 {
    let loaded = load_all_reporting(ctx);
    if json_output {
        let rows: Vec<EntryJson> = loaded.iter().map(EntryJson::new).collect();
        print!("{}", json_collection(rows));
        return 0;
    }
    if loaded.is_empty() {
        println!("No registered projects. Run maki-oss, opencode-oss, claude-oss, or codex-oss in a project.");
        return 0;
    }
    let header = format!(
        "{} {} {} {} {}\n",
        left("AGENT", 5),
        left("SANDBOX", 19),
        left("PENDING", 8),
        left("PROJECT", 12),
        "PATH"
    );
    print!("{header}");
    for loaded_entry in &loaded {
        let pending = loaded_entry.pending.as_deref().unwrap_or("-");
        let pending = if pending.is_empty() { "-" } else { pending };
        let mut path = loaded_entry.entry.host_path.clone();
        if loaded_entry.orphan {
            path.push_str(" (orphan: folder missing)");
        }
        println!(
            "{} {} {} {} {}",
            left(&loaded_entry.entry.agent, 5),
            left(&loaded_entry.entry.sandbox_name, 19),
            left(pending, 8),
            left(&loaded_entry.entry.project, 12),
            path
        );
    }
    0
}

fn fingerprint_result(loaded: &Loaded) -> &'static str {
    match loaded.entry.fingerprint.as_deref() {
        None | Some("") => "unknown",
        Some(_) if loaded.orphan => "unknown",
        Some(fingerprint) => match state::project_fingerprint(Path::new(&loaded.entry.host_path)) {
            None => "unknown",
            Some(now) if now == fingerprint => "unchanged",
            Some(_) => "changed",
        },
    }
}

pub fn status(ctx: &Context, opts: &Options) -> i32 {
    let wanted = absolute_path(opts.path.as_deref().unwrap_or("."));
    let wanted = wanted.to_string_lossy().into_owned();
    let registry = ctx.paths.registry_entries();
    let mut rows: Vec<(Loaded, &'static str)> = Vec::new();
    for path in registry {
        let loaded = match load_entry(ctx, &path) {
            Ok(loaded) => loaded,
            Err(problems) => {
                warn_problems(&problems);
                continue;
            }
        };
        if loaded.entry.host_path != wanted {
            continue;
        }
        rows.push((loaded, ""));
    }
    let count = rows.len();
    if opts.json && !opts.quick {
        let mut documents: Vec<Box<RawValue>> = Vec::new();
        for (loaded, _) in &rows {
            let front = ctx.front_end(&loaded.entry.agent);
            let Some(front) = front else {
                continue;
            };
            if loaded.orphan {
                let text = serde_json::to_string(&EntryJson::new(loaded)).expect("serializable");
                documents.push(RawValue::from_string(text).expect("valid JSON"));
                continue;
            }
            let mut command = Command::new(&front);
            command
                .arg("--name")
                .arg(&loaded.entry.sandbox_name)
                .arg("__status-json")
                .current_dir(&loaded.entry.host_path);
            let captured = capture(&mut command);
            let raw = match captured {
                Some(text) => json::raw(&text).unwrap_or_else(empty_object),
                None => empty_object(),
            };
            let text = serde_json::to_string(&StatusFull {
                entry: EntryJson::new(loaded),
                status: raw,
            })
            .expect("serializable");
            documents.push(RawValue::from_string(text).expect("valid JSON"));
        }
        print!("{}", json::line(&documents));
        return 0;
    }
    if opts.json {
        let mut documents: Vec<Box<RawValue>> = Vec::new();
        for (loaded, _) in &rows {
            let idle = state::idle_state(&ctx.session_dir(&loaded.entry.sandbox_name), None);
            let text = serde_json::to_string(&StatusQuick {
                entry: EntryJson::new(loaded),
                fingerprint_result: fingerprint_result(loaded),
                busy: state::lock_busy(&ctx.session_dir(&loaded.entry.sandbox_name).join("locks")),
                idle: IdleJson::from(idle),
            })
            .expect("serializable");
            documents.push(RawValue::from_string(text).expect("valid JSON"));
        }
        print!("{}", json::line(&documents));
        return 0;
    }
    for (loaded, _) in &rows {
        let session = ctx.session_dir(&loaded.entry.sandbox_name);
        if opts.quick {
            let idle = state::idle_state(&session, None);
            let pending = loaded.pending.as_deref().unwrap_or("none");
            let pending = if pending.is_empty() { "none" } else { pending };
            println!(
                "Sandbox:   {} ({})",
                loaded.entry.sandbox_name, loaded.entry.agent
            );
            println!("Pending:   {pending}");
            println!(
                "Host:      {} since the last sync",
                fingerprint_result(loaded)
            );
            if state::lock_busy(&session.join("locks")) {
                println!("Busy:      a session or resolve is running");
            }
            println!("Idle stop: {}", idle.describe());
            continue;
        }
        let Some(front) = ctx.front_end(&loaded.entry.agent) else {
            continue;
        };
        if loaded.orphan {
            println!(
                "Sandbox:   {} ({}): folder missing",
                loaded.entry.sandbox_name, loaded.entry.agent
            );
            continue;
        }
        let _ = std::io::stdout().flush();
        fork_inherit(
            Command::new(&front)
                .args(["--name", &loaded.entry.sandbox_name, "status"])
                .current_dir(&loaded.entry.host_path),
        );
    }
    if count == 0 {
        println!("No project is registered at {wanted}.");
    }
    0
}

fn empty_object() -> Box<RawValue> {
    RawValue::from_string("{}".to_string()).expect("valid JSON")
}

/// Runs a child with inherited stdio, ignoring its status, for the text
/// reports whose output belongs to the child.
fn fork_inherit(command: &mut Command) {
    let _ = command.status();
}

/// Runs a child with inherited stdout and stderr and returns its stdout, or
/// `None` when it exits non-zero or cannot start.
fn capture(command: &mut Command) -> Option<String> {
    let output = command
        .stdin(Stdio::inherit())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout)
        .trim_end_matches('\n')
        .to_string();
    Some(text)
}

fn run_inherit(command: &mut Command) -> i32 {
    match command.status() {
        Ok(status) => process::exit_code(status),
        Err(error) => {
            eprintln!("osa: cannot run the front-end: {error}");
            127
        }
    }
}

pub fn health(ctx: &Context, opts: &Options) -> i32 {
    let sandbox = opts.sandbox.as_deref().unwrap_or_default();
    let Some(path) = ctx.paths.entry_file(sandbox) else {
        return crate::cli::die_usage(&format!(
            "sandbox '{sandbox}' is not registered; run 'osa projects' to list sandboxes"
        ));
    };
    let loaded = match load_entry(ctx, &path) {
        Ok(loaded) => loaded,
        Err(problems) => return fatal_problems(&problems),
    };
    if loaded.entry.sandbox_name != sandbox {
        return crate::cli::die_usage(&format!(
            "the registry entry {} names sandbox '{}', not '{sandbox}'",
            path.display(),
            loaded.entry.sandbox_name
        ));
    }
    let front = ctx.front_end(&loaded.entry.agent);
    let unknown_agent = format!("agent '{}' is not known to osa", loaded.entry.agent);
    let error: Option<&str> = if loaded.orphan {
        Some("project folder missing")
    } else if front.is_none() {
        Some(unknown_agent.as_str())
    } else {
        None
    };
    if error.is_none() {
        let front = front.expect("a known agent has a front-end");
        let verb = if opts.json {
            "__health-json"
        } else {
            "__health"
        };
        return run_inherit(
            Command::new(front)
                .arg("--name")
                .arg(sandbox)
                .arg(verb)
                .current_dir(&loaded.entry.host_path),
        );
    }
    let error = error.expect("an error path has an error");
    let session = ctx.session_dir(sandbox);
    let idle = state::idle_state(&session, None);
    if opts.json {
        print!(
            "{}",
            json::line(&HealthFallback {
                sandbox,
                agent: &loaded.entry.agent,
                idle: IdleJson::from(idle),
                mcp: ErrorBody { error },
                doctor: ErrorBody { error },
            })
        );
        return 0;
    }
    println!("Health of sandbox '{sandbox}' ({}):", loaded.entry.agent);
    println!("Idle stop: {}", idle.describe());
    print!("\nMCP readiness:\n  error: {error}\n\nDoctor:\n  error: {error}\n");
    0
}

fn refuse(json_output: bool, sandbox: &str, action: &str, message: &str) -> i32 {
    if json_output {
        print!(
            "{}",
            json::line(&Refusal {
                sandbox,
                action,
                ok: false,
                changed: Vec::new(),
                message,
            })
        );
    }
    eprintln!("osa: {message}");
    EX_REFUSED
}

pub fn resolve(ctx: &Context, opts: &Options) -> i32 {
    let sandbox = opts.sandbox.as_deref().unwrap_or_default();
    let action = opts.action.as_deref().unwrap_or_default();
    let Some(path) = ctx.paths.entry_file(sandbox) else {
        return refuse(
            opts.json,
            sandbox,
            action,
            &format!("sandbox '{sandbox}' is not registered; run 'osa projects' to list sandboxes"),
        );
    };
    let loaded = match load_entry(ctx, &path) {
        Ok(loaded) => loaded,
        Err(problems) => return fatal_problems(&problems),
    };
    if loaded.entry.sandbox_name != sandbox {
        return refuse(
            opts.json,
            sandbox,
            action,
            &format!(
                "the registry entry {} names sandbox '{}', not '{sandbox}'",
                path.display(),
                loaded.entry.sandbox_name
            ),
        );
    }
    if loaded.orphan {
        return refuse(
            opts.json,
            sandbox,
            action,
            &format!(
                "the project folder for '{sandbox}' is missing: {}",
                loaded.entry.host_path
            ),
        );
    }
    let Some(front) = ctx.front_end(&loaded.entry.agent) else {
        return refuse(
            opts.json,
            sandbox,
            action,
            &format!(
                "sandbox '{sandbox}' belongs to agent '{}', which osa does not know",
                loaded.entry.agent
            ),
        );
    };
    let mut argv = vec![
        "--name".to_string(),
        sandbox.to_string(),
        "__resolve".to_string(),
        action.to_string(),
    ];
    if opts.yes {
        argv.push("--yes".to_string());
    }
    if opts.json {
        argv.push("--json".to_string());
    }
    run_inherit(
        Command::new(front)
            .args(argv)
            .current_dir(&loaded.entry.host_path),
    )
}

pub fn remove(ctx: &Context, opts: &Options) -> i32 {
    let sandbox = opts.sandbox.as_deref().unwrap_or_default();
    let action = "remove";
    let Some(path) = ctx.paths.entry_file(sandbox) else {
        return refuse(
            opts.json,
            sandbox,
            action,
            &format!("sandbox '{sandbox}' is not registered; run 'osa projects' to list sandboxes"),
        );
    };
    let loaded = match load_entry(ctx, &path) {
        Ok(loaded) => loaded,
        Err(problems) => return fatal_problems(&problems),
    };
    if loaded.entry.sandbox_name != sandbox {
        return refuse(
            opts.json,
            sandbox,
            action,
            &format!(
                "the registry entry {} names sandbox '{}', not '{sandbox}'",
                path.display(),
                loaded.entry.sandbox_name
            ),
        );
    }
    let Some(front) = ctx.front_end(&loaded.entry.agent) else {
        return refuse(
            opts.json,
            sandbox,
            action,
            &format!(
                "sandbox '{sandbox}' belongs to agent '{}', which osa does not know",
                loaded.entry.agent
            ),
        );
    };
    if !opts.yes {
        return refuse(
            opts.json,
            sandbox,
            action,
            &format!(
                "removing '{sandbox}' deletes its sandbox; pass --yes to confirm. Nothing changed"
            ),
        );
    }
    let mut argv = vec![
        "--name".to_string(),
        sandbox.to_string(),
        "__remove".to_string(),
        "--yes".to_string(),
    ];
    let mut directory = PathBuf::from(&loaded.entry.host_path);
    if loaded.orphan {
        argv.push("--orphan".to_string());
        directory = ctx.paths.root.clone();
    }
    if opts.json {
        argv.push("--json".to_string());
    }
    run_inherit(Command::new(front).args(argv).current_dir(directory))
}

pub fn providers(ctx: &Context, opts: &Options) -> i32 {
    let tags: Vec<String> = match opts.agent.as_deref() {
        Some(agent) => vec![agent.to_string()],
        None => AGENT_TAGS.iter().map(|tag| (*tag).to_string()).collect(),
    };
    if !opts.json {
        let mut separator = String::new();
        for tag in &tags {
            let Some(front) = ctx.front_end(tag) else {
                continue;
            };
            print!("{separator}");
            let _ = std::io::stdout().flush();
            let status = Command::new(&front)
                .arg("__providers")
                .stdin(Stdio::null())
                .status();
            if !status.is_ok_and(|status| status.success()) {
                println!("{tag}: provider report failed");
            }
            separator = "\n".to_string();
        }
        return 0;
    }
    let mut documents: Vec<Box<RawValue>> = Vec::new();
    for tag in &tags {
        let Some(front) = ctx.front_end(tag) else {
            continue;
        };
        let mut command = Command::new(&front);
        command.arg("__providers-json");
        let captured = capture_stdin_null(&mut command);
        let raw = match captured.as_deref().and_then(json::raw) {
            Some(raw) => raw,
            None => error_document(tag, &front, "__providers-json"),
        };
        documents.push(raw);
    }
    print!("{}", json::line(&documents));
    0
}

pub fn images(ctx: &Context, opts: &Options) -> i32 {
    if !opts.json {
        for tag in AGENT_TAGS {
            let Some(front) = ctx.front_end(tag) else {
                continue;
            };
            let status = Command::new(&front)
                .arg("__image")
                .stdin(Stdio::null())
                .status();
            if !status.is_ok_and(|status| status.success()) {
                println!("{tag}: image report failed");
            }
        }
        return 0;
    }
    let mut documents: Vec<Box<RawValue>> = Vec::new();
    for tag in AGENT_TAGS {
        let Some(front) = ctx.front_end(tag) else {
            continue;
        };
        let mut command = Command::new(&front);
        command.arg("__image-json");
        let captured = capture_stdin_null(&mut command);
        let raw = match captured.as_deref().and_then(json::raw) {
            Some(raw) => raw,
            None => error_document(tag, &front, "__image-json"),
        };
        documents.push(raw);
    }
    print!("{}", json::line(&documents));
    0
}

fn error_document(tag: &str, front: &Path, verb: &str) -> Box<RawValue> {
    let name = front
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let message = format!("{name} {verb} failed");
    let text = serde_json::to_string(&AgentError {
        agent: tag,
        error: MessageBody { message: &message },
    })
    .expect("serializable");
    RawValue::from_string(text).expect("valid JSON")
}

fn capture_stdin_null(command: &mut Command) -> Option<String> {
    let output = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .trim_end_matches('\n')
            .to_string(),
    )
}

pub fn provider_setup(ctx: &Context, opts: &Options) -> i32 {
    let tag = opts.agent.as_deref().unwrap_or_default();
    let Some(front) = ctx.front_end(tag) else {
        return EX_USAGE;
    };
    if let Some(attach) = opts.attach.as_deref() {
        let Some(path) = ctx.paths.entry_file(attach) else {
            return crate::cli::die_usage(&format!(
                "sandbox '{attach}' is not registered; run 'osa projects' to list sandboxes"
            ));
        };
        let parsed = match flat::read_entry(&path) {
            Ok(parsed) => parsed,
            Err(problems) => return fatal_problems(&problems),
        };
        let entry = RegistryEntry::from_flat(&parsed.entry);
        if entry.sandbox_name != attach {
            return crate::cli::die_usage(&format!(
                "the registry entry {} does not name sandbox '{attach}'",
                path.display()
            ));
        }
        if entry.agent != tag {
            return crate::cli::die_usage(&format!(
                "sandbox '{attach}' belongs to agent '{}', not '{tag}'",
                entry.agent
            ));
        }
    }
    let mut probe = Command::new(&front);
    probe.arg("__provider-setup").arg("--probe");
    if opts.json {
        probe.arg("--json");
    }
    let status = probe.stdin(Stdio::null()).status();
    match status {
        Ok(status) if status.success() => {}
        Ok(status) => return process::exit_code(status),
        Err(error) => {
            eprintln!("osa: cannot run {}: {error}", front.display());
            return 127;
        }
    }
    let mut argv: Vec<String> = Vec::new();
    if let Some(attach) = opts.attach.as_deref() {
        argv.push("--name".to_string());
        argv.push(attach.to_string());
    }
    argv.push("__provider-setup".to_string());
    argv.push("--profile".to_string());
    argv.push(opts.profile.clone().unwrap_or_default());
    if let Some(name) = opts.name.as_deref() {
        argv.push("--provider-name".to_string());
        argv.push(name.to_string());
    }
    if opts.attach.is_some() {
        argv.push("--attach".to_string());
    }
    if opts.yes {
        argv.push("--yes".to_string());
    }
    if opts.json {
        argv.push("--json".to_string());
    }
    process::exec(Command::new(front).args(argv))
}

pub fn image_build(ctx: &Context, tag: &str) -> i32 {
    let Some(front) = ctx.front_end(tag) else {
        return crate::cli::die_usage(&format!("unknown agent tag: {tag} (tags: mk, oc, cc, cx)"));
    };
    process::exec(
        Command::new(front)
            .args(["image", "build"])
            .stdin(Stdio::null()),
    )
}

pub const BUN_MIN: &str = "1.2.0";
pub const BUN_INSTALL_URL: &str = "https://bun.sh";

pub fn dashboard(ctx: &Context, args: &[String]) -> i32 {
    let mut expecting: Option<&str> = None;
    for arg in args {
        if expecting.is_some() {
            expecting = None;
            continue;
        }
        match arg.as_str() {
            "-h" | "--help" => {
                print!("{}", crate::cli::dashboard_usage());
                return 0;
            }
            "--port" | "--host" | "--token" => expecting = Some(arg),
            "--read-only" | "--open" => {}
            other
                if other.starts_with("--port=")
                    || other.starts_with("--host=")
                    || other.starts_with("--token=") => {}
            other if other.starts_with('-') => {
                return crate::cli::die_usage(&format!(
                    "unknown dashboard option: {other} (options: --port, --host, --token, --read-only, --open)"
                ));
            }
            other => {
                return crate::cli::die_usage(&format!("dashboard takes no arguments: {other}"));
            }
        }
    }
    if let Some(option) = expecting {
        return crate::cli::die_usage(&format!("option {option} requires a value"));
    }
    let main = ctx.repo_root.join("dashboard").join("src").join("main.ts");
    if !main.is_file() {
        eprintln!("osa: dashboard not found at {}", main.display());
        return EX_DEP;
    }
    let Some(bun) = find_in_path("bun") else {
        eprintln!(
            "osa: the dashboard needs Bun >= {BUN_MIN} and no bun is on PATH; install it from {BUN_INSTALL_URL}"
        );
        return EX_DEP;
    };
    let version = Command::new(&bun)
        .arg("--version")
        .stderr(Stdio::null())
        .output()
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or_default()
                .to_string()
        })
        .unwrap_or_default();
    match version_triple(&version) {
        Some(found) if !version_at_least(found, version_triple(BUN_MIN).expect("constant")) => {
            eprintln!(
                "osa: the dashboard needs Bun >= {BUN_MIN}, found {version}; upgrade from {BUN_INSTALL_URL}"
            );
            return EX_DEP;
        }
        None => {
            eprintln!(
                "osa: warning: cannot read Bun's version ('{version}'); the dashboard needs Bun >= {BUN_MIN}"
            );
        }
        Some(_) => {}
    }
    let shim = ctx.repo_root.join("bin").join("osa");
    let mut command = Command::new(bun);
    command
        .arg("run")
        .arg(&main)
        .args(args)
        .env("DASHBOARD_OSA_BIN", shim);
    process::exec(&mut command)
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

fn version_triple(version: &str) -> Option<(u64, u64, u64)> {
    let bytes = version.as_bytes();
    let mut index = 0;
    let mut numbers = [0u64; 3];
    for (slot, number) in numbers.iter_mut().enumerate() {
        if slot == 2 && (index >= bytes.len() || bytes[index] != b'.') {
            break;
        }
        if slot > 0 {
            if index >= bytes.len() || bytes[index] != b'.' {
                return None;
            }
            index += 1;
        }
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index == start {
            return None;
        }
        *number = version[start..index].parse().ok()?;
    }
    Some((numbers[0], numbers[1], numbers[2]))
}

fn version_at_least(found: (u64, u64, u64), wanted: (u64, u64, u64)) -> bool {
    found >= wanted
}
