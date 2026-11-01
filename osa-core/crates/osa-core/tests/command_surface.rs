//! Command-surface behavior over a temporary state root: no gateway, no
//! Docker, no network.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use osa_core::entries::{PendingMarker, RegistryEntry};
use osa_core::flat::write_atomic;
use osa_core::state;

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!("osa-surface-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("state")).expect("state directory");
        let root = fs::canonicalize(&root).expect("canonical fixture root");
        Fixture { root }
    }

    fn state_home(&self) -> PathBuf {
        self.root.join("state")
    }

    fn state_root(&self) -> PathBuf {
        self.state_home().join("osa")
    }

    fn registry(&self) -> PathBuf {
        self.state_root().join("projects")
    }

    fn project(&self, name: &str) -> PathBuf {
        let path = self.root.join("projects").join(name);
        fs::create_dir_all(&path).expect("project directory");
        fs::canonicalize(&path).expect("canonical project path")
    }

    fn entry(&self, sandbox: &str, agent: &str, host_path: &Path, fingerprint: Option<&str>) {
        fs::create_dir_all(self.registry()).expect("registry directory");
        let entry = RegistryEntry {
            version: "1".to_string(),
            agent: agent.to_string(),
            host_path: host_path.to_string_lossy().into_owned(),
            project: "myproject".to_string(),
            sandbox_name: sandbox.to_string(),
            sandbox_id: "id-1".to_string(),
            created: "2026-01-02T03:04:05Z".to_string(),
            last_session: "2026-01-02T03:05:06Z".to_string(),
            fingerprint: fingerprint.map(str::to_string),
        };
        let flat = entry.to_flat().expect("valid entry");
        write_atomic(&self.registry().join(format!("{sandbox}.toml")), &flat).expect("write entry");
    }

    fn pending(&self, sandbox: &str, kind: &str, patch: Option<&Path>) {
        let session = self.state_root().join("sessions").join(sandbox);
        fs::create_dir_all(&session).expect("session directory");
        let mut marker = PendingMarker::new(kind);
        if let Some(patch) = patch {
            marker.patch = patch.to_string_lossy().into_owned();
        }
        let flat = marker.to_flat().expect("valid marker");
        write_atomic(&session.join("pending"), &flat).expect("write marker");
    }

    fn run(&self, current_dir: &Path, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_osa"))
            .args(args)
            .current_dir(current_dir)
            .env("XDG_STATE_HOME", self.state_home())
            .env("HOME", self.root.join("home"))
            .env("OSA_REPO_ROOT", repo_root())
            .output()
            .expect("osa runs")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("checkout root")
        .to_path_buf()
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn an_empty_registry_lists_nothing() {
    let fixture = Fixture::new("empty");
    let output = fixture.run(&fixture.root, &["projects", "--json"]);
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(stdout(&output), "[]\n");

    let output = fixture.run(&fixture.root, &["projects"]);
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(
        stdout(&output),
        "No registered projects. Run maki-oss, opencode-oss, claude-oss, or codex-oss in a project.\n"
    );
}

#[test]
fn projects_reports_pending_orphan_and_the_published_field_order() {
    let fixture = Fixture::new("projects");
    let project = fixture.project("myproject");
    fixture.entry("maki-myproject", "mk", &project, None);
    fixture.entry(
        "mk-ghost-0000",
        "mk",
        &fixture.root.join("projects").join("gone"),
        None,
    );
    let patch = fixture.root.join("retained.patch");
    fs::write(&patch, "diff\n").expect("patch");
    fixture.pending("maki-myproject", "retained", Some(&patch));

    let output = fixture.run(&fixture.root, &["projects", "--json"]);
    assert_eq!(output.status.code(), Some(0));
    let present = project.to_string_lossy();
    let gone = fixture.root.join("projects").join("gone");
    let gone = gone.to_string_lossy();
    let expected = format!(
        concat!(
            "[{{",
            "\"version\":\"1\",\"agent\":\"mk\",\"host_path\":\"{}\",\"project\":\"myproject\",",
            "\"sandbox_name\":\"maki-myproject\",\"sandbox_id\":\"id-1\",",
            "\"created\":\"2026-01-02T03:04:05Z\",\"last_session\":\"2026-01-02T03:05:06Z\",",
            "\"fingerprint\":\"\",\"pending\":\"retained\",\"orphan\":false",
            "}},{{",
            "\"version\":\"1\",\"agent\":\"mk\",\"host_path\":\"{}\",\"project\":\"myproject\",",
            "\"sandbox_name\":\"mk-ghost-0000\",\"sandbox_id\":\"id-1\",",
            "\"created\":\"2026-01-02T03:04:05Z\",\"last_session\":\"2026-01-02T03:05:06Z\",",
            "\"fingerprint\":\"\",\"pending\":\"\",\"orphan\":true",
            "}}]\n"
        ),
        present, gone
    );
    assert_eq!(stdout(&output), expected);

    let output = fixture.run(&fixture.root, &["projects"]);
    assert_eq!(output.status.code(), Some(0));
    let text = stdout(&output);
    let mut lines = text.lines();
    assert_eq!(
        lines.next(),
        Some("AGENT SANDBOX             PENDING  PROJECT      PATH")
    );
    assert_eq!(
        lines.next(),
        Some(format!("mk    maki-myproject      retained myproject    {present}").as_str())
    );
    assert_eq!(
        lines.next(),
        Some(
            format!(
                "mk    mk-ghost-0000       -        myproject    {gone} (orphan: folder missing)"
            )
            .as_str()
        )
    );
}

#[test]
fn status_quick_reports_changed_unchanged_and_unknown() {
    let fixture = Fixture::new("quick");
    let project = fixture.project("repo");
    git(&project, &["init", "-q"]);
    fs::write(project.join("tracked.txt"), "one\n").expect("tracked");
    git(&project, &["add", "tracked.txt"]);
    git(&project, &["commit", "-qm", "base"]);
    let fingerprint = state::project_fingerprint(&project).expect("a git project");
    fixture.entry("maki-repo", "mk", &project, Some(&fingerprint));

    let output = fixture.run(&project, &["status", "--quick", "--json"]);
    assert_eq!(output.status.code(), Some(0));
    let text = stdout(&output);
    assert!(
        text.contains("\"fingerprint_result\":\"unchanged\""),
        "{text}"
    );
    assert!(text.contains("\"busy\":false"), "{text}");
    assert!(
        text.contains("\"idle\":{\"period\":null,\"state\":\"none\",\"deadline\":null,\"estimated\":false,\"last_event\":null,\"last_time\":null}"),
        "{text}"
    );

    fs::write(project.join("tracked.txt"), "one\ntwo\n").expect("change");
    let output = fixture.run(&project, &["status", "--quick", "--json"]);
    assert!(stdout(&output).contains("\"fingerprint_result\":\"changed\""));

    let elsewhere = fixture.root.join("nowhere");
    let output = fixture.run(&project, &["status", "--quick", "--json"]);
    assert!(!stdout(&output).contains(elsewhere.to_string_lossy().as_ref()));

    let output = fixture.run(&fixture.root, &["status", "--quick"]);
    assert_eq!(
        stdout(&output),
        format!("No project is registered at {}.\n", fixture.root.display())
    );

    let plain = fixture.project("plain");
    fixture.entry("maki-plain", "mk", &plain, None);
    let output = fixture.run(&plain, &["status", "--quick", "--json"]);
    assert!(stdout(&output).contains("\"fingerprint_result\":\"unknown\""));
    let output = fixture.run(&plain, &["status", "--quick"]);
    assert_eq!(
        stdout(&output),
        "Sandbox:   maki-plain (mk)\nPending:   none\nHost:      unknown since the last sync\nIdle stop: no session has run\n"
    );
}

#[test]
fn status_quick_reports_the_idle_deadline_and_the_pending_kind() {
    let fixture = Fixture::new("quick-idle");
    let project = fixture.project("plain");
    fixture.entry("maki-plain", "mk", &project, None);
    let session = fixture.state_root().join("sessions").join("maki-plain");
    fs::create_dir_all(&session).expect("session");
    let dead = Command::new("sh")
        .arg("-c")
        .arg("echo $$")
        .output()
        .expect("child runs");
    let dead_pid = stdout(&dead).trim().to_string();
    fs::write(
        session.join("idle.log"),
        format!(
            "{} armed secs=3600 session={dead_pid} watcher=1\n",
            local_time(now() - 900)
        ),
    )
    .expect("idle log");

    let output = fixture.run(&project, &["status", "--quick", "--json"]);
    let text = stdout(&output);
    assert!(
        text.contains("\"idle\":{\"period\":3600,\"state\":\"counting\",\"deadline\":\""),
        "{text}"
    );

    let output = fixture.run(&project, &["status", "--quick"]);
    let text = stdout(&output);
    assert!(
        text.contains("Idle stop: counting down; stop due about "),
        "{text}"
    );
    assert!(text.contains("(estimated) (period 3600s)"), "{text}");
}

#[test]
fn health_reports_idle_and_the_error_sections_for_an_orphan() {
    let fixture = Fixture::new("health");
    let gone = fixture.root.join("projects").join("gone");
    fixture.entry("mk-ghost-0000", "mk", &gone, None);
    let output = fixture.run(&fixture.root, &["health", "mk-ghost-0000", "--json"]);
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(
        stdout(&output),
        "{\"sandbox\":\"mk-ghost-0000\",\"agent\":\"mk\",\"idle\":{\"period\":null,\"state\":\"none\",\"deadline\":null,\"estimated\":false,\"last_event\":null,\"last_time\":null},\"mcp\":{\"error\":\"project folder missing\"},\"doctor\":{\"error\":\"project folder missing\"}}\n"
    );
    let output = fixture.run(&fixture.root, &["health", "mk-ghost-0000"]);
    assert_eq!(
        stdout(&output),
        "Health of sandbox 'mk-ghost-0000' (mk):\nIdle stop: no session has run\n\nMCP readiness:\n  error: project folder missing\n\nDoctor:\n  error: project folder missing\n"
    );

    let output = fixture.run(&fixture.root, &["health", "mk-nowhere-0000", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stdout(&output), "");
    assert!(
        stderr(&output).contains("not registered"),
        "{}",
        stderr(&output)
    );

    let project = fixture.project("other");
    fixture.entry("maki-other", "zz", &project, None);
    let output = fixture.run(&fixture.root, &["health", "maki-other", "--json"]);
    assert_eq!(output.status.code(), Some(0));
    assert!(
        stdout(&output).contains("\"error\":\"agent 'zz' is not known to osa\""),
        "{}",
        stdout(&output)
    );
}

#[test]
fn a_registry_file_that_names_another_sandbox_is_reported() {
    let fixture = Fixture::new("mismatch");
    let project = fixture.project("myproject");
    fs::create_dir_all(fixture.registry()).expect("registry");
    fixture.entry("maki-other", "mk", &project, None);
    fs::rename(
        fixture.registry().join("maki-other.toml"),
        fixture.registry().join("other.toml"),
    )
    .expect("rename");
    let output = fixture.run(&fixture.root, &["health", "other"]);
    assert_eq!(output.status.code(), Some(1));
    let message = stderr(&output);
    assert!(
        message.contains("names sandbox 'maki-other', not 'other'"),
        "{message}"
    );
}

#[test]
fn a_malformed_entry_is_reported_and_the_listing_continues() {
    let fixture = Fixture::new("malformed");
    let project = fixture.project("myproject");
    fixture.entry("maki-myproject", "mk", &project, None);
    fs::write(
        fixture.registry().join("broken.toml"),
        "version = \"1\"\nagent = mk\n",
    )
    .expect("broken entry");

    let output = fixture.run(&fixture.root, &["projects", "--json"]);
    assert_eq!(output.status.code(), Some(0));
    let message = stderr(&output);
    assert!(message.contains("broken.toml:2:"), "{message}");
    assert!(message.contains("quoted string"), "{message}");
    assert!(
        stdout(&output).contains("\"sandbox_name\":\"maki-myproject\""),
        "{}",
        stdout(&output)
    );

    let output = fixture.run(&fixture.root, &["status", "--quick"]);
    assert_eq!(output.status.code(), Some(0));
    assert!(stderr(&output).contains("broken.toml:2:"));

    let output = fixture.run(&fixture.root, &["health", "broken", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stdout(&output), "");
    assert!(
        stderr(&output).contains("broken.toml:2:"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn resolve_and_remove_refuse_before_any_change() {
    let fixture = Fixture::new("refusals");
    let output = fixture.run(&fixture.root, &["resolve", "maki-nope", "apply", "--json"]);
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        stdout(&output),
        "{\"sandbox\":\"maki-nope\",\"action\":\"apply\",\"ok\":false,\"changed\":[],\"message\":\"sandbox 'maki-nope' is not registered; run 'osa projects' to list sandboxes\"}\n"
    );
    assert_eq!(
        stderr(&output),
        "osa: sandbox 'maki-nope' is not registered; run 'osa projects' to list sandboxes\n"
    );

    let project = fixture.project("myproject");
    fixture.entry("maki-myproject", "mk", &project, None);
    let output = fixture.run(&fixture.root, &["remove", "maki-myproject"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(
        stderr(&output).contains("pass --yes to confirm"),
        "{}",
        stderr(&output)
    );

    fixture.entry("maki-orphan", "mk", &fixture.root.join("gone"), None);
    let output = fixture.run(
        &fixture.root,
        &["resolve", "maki-orphan", "rescue", "--json"],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(
        stdout(&output).contains("\"message\":\"the project folder for 'maki-orphan' is missing:"),
        "{}",
        stdout(&output)
    );

    fixture.entry("maki-other", "zz", &project, None);
    let output = fixture.run(&fixture.root, &["remove", "maki-other", "--yes"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(
        stderr(&output).contains("which osa does not know"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn provider_setup_validates_the_attach_sandbox_before_the_front_end() {
    let fixture = Fixture::new("attach");
    let project = fixture.project("myproject");
    fixture.entry("oc-demo-1a2b", "oc", &project, None);
    let output = fixture.run(
        &fixture.root,
        &[
            "provider",
            "setup",
            "mk",
            "--profile",
            "maki-deepseek",
            "--attach",
            "oc-demo-1a2b",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("belongs to agent 'oc'"),
        "{}",
        stderr(&output)
    );

    let output = fixture.run(
        &fixture.root,
        &[
            "provider",
            "setup",
            "mk",
            "--profile",
            "maki-deepseek",
            "--attach",
            "mk-nowhere-0000",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("not registered"),
        "{}",
        stderr(&output)
    );
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "user.email=fixture@example.com",
            "-c",
            "user.name=fixture",
        ])
        .args(args)
        .current_dir(dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?}");
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("after the epoch")
        .as_secs() as i64
}

fn local_time(epoch: i64) -> String {
    let gnu = Command::new("date")
        .args(["-d", &format!("@{epoch}"), "+%Y-%m-%dT%H:%M:%S"])
        .output();
    if let Ok(output) = gnu {
        if output.status.success() {
            return stdout(&output).trim_end().to_string();
        }
    }
    let bsd = Command::new("date")
        .args(["-r", &epoch.to_string(), "+%Y-%m-%dT%H:%M:%S"])
        .output()
        .expect("date runs");
    stdout(&bsd).trim_end().to_string()
}
