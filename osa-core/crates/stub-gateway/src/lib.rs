//! The offline OpenShell gateway the suite drives instead of a real one.
//!
//! State lives in `STUB_STATE_DIR` in the layout the CLI stub already uses, so
//! a case seeds and asserts the same files it always did. Every served request
//! also appends the equivalent CLI argv to `STUB_LOG`, so assertions written
//! against the argv seam keep working while the client transport is what
//! actually ran.
//!
//! Everything the typed client does not cover is `unimplemented`: a test that
//! reaches one has found a gap in the stub, not a gateway quirk.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use openshell_core::proto;
use proto::open_shell_server::{OpenShell, OpenShellServer};

/// The documented argv separator the CLI stub writes.
const SEPARATOR: &str = "---";

/// One offline gateway. Cloneable because the server shares one instance.
#[derive(Clone)]
pub struct Stub {
    state: PathBuf,
    log: Option<PathBuf>,
    version: String,
    exec_stdout: Vec<u8>,
    exec_exit: i32,
    exec_interrupt: bool,
    exec_hold: bool,
    create_race: bool,
    delete_fail: bool,
    credential_reject: bool,
    log_lines: Vec<String>,
    log_error: bool,
    active_streams: Arc<AtomicUsize>,
    credentials: Arc<Mutex<Vec<(String, String)>>>,
    requests: Arc<Mutex<Vec<String>>>,
}

impl Stub {
    /// A stub over an explicit state directory and an optional argv log.
    pub fn new(state: impl Into<PathBuf>, log: Option<PathBuf>) -> Self {
        Stub {
            state: state.into(),
            log,
            version: "0.1.5-stub".to_string(),
            // The same default the CLI stub prints for `sandbox exec`.
            exec_stdout: b"stub-exec-output\n".to_vec(),
            exec_exit: 0,
            exec_interrupt: false,
            exec_hold: false,
            create_race: false,
            delete_fail: false,
            credential_reject: false,
            log_lines: Vec::new(),
            log_error: false,
            active_streams: Arc::new(AtomicUsize::new(0)),
            credentials: Arc::new(Mutex::new(Vec::new())),
            requests: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// The stub the suite configures with the same environment variables the
    /// CLI stub reads.
    pub fn from_env() -> Self {
        let state = std::env::var("STUB_STATE_DIR").unwrap_or_else(|_| ".".to_string());
        let log = std::env::var("STUB_LOG").ok().map(PathBuf::from);
        let mut stub = Stub::new(state, log);
        stub.version =
            std::env::var("STUB_GATEWAY_VERSION").unwrap_or_else(|_| "0.1.5-stub".to_string());
        if let Ok(stdout) = std::env::var("STUB_EXEC_STDOUT") {
            stub.exec_stdout = format!("{stdout}\n").into_bytes();
        }
        stub.exec_exit = std::env::var("STUB_EXEC_EXIT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        stub.create_race = std::env::var("STUB_CREATE_RACE").as_deref() == Ok("1");
        stub.delete_fail = std::env::var("STUB_DELETE_FAIL").as_deref() == Ok("1");
        stub
    }

    /// The stdout and exit status every exec reports.
    pub fn with_exec(mut self, stdout: impl Into<Vec<u8>>, exit_code: i32) -> Self {
        self.exec_stdout = stdout.into();
        self.exec_exit = exit_code;
        self
    }

    /// A create that loses a race: the sandbox exists, the create fails.
    pub fn with_create_race(mut self) -> Self {
        self.create_race = true;
        self
    }

    /// A delete the gateway refuses.
    pub fn with_delete_failure(mut self) -> Self {
        self.delete_fail = true;
        self
    }

    /// An exec whose stream ends with a transport error after its output.
    pub fn with_interrupted_exec(mut self, stdout: impl Into<Vec<u8>>) -> Self {
        self.exec_stdout = stdout.into();
        self.exec_interrupt = true;
        self
    }

    /// An exec whose stream sends its output and then stays open until the
    /// caller goes away, so an interrupt can be observed.
    pub fn with_held_exec(mut self, stdout: impl Into<Vec<u8>>) -> Self {
        self.exec_stdout = stdout.into();
        self.exec_hold = true;
        self
    }

    /// A provider create whose credential the gateway rejects.
    pub fn with_credential_rejection(mut self) -> Self {
        self.credential_reject = true;
        self
    }

    /// The log lines a read or watch reports.
    pub fn with_logs(mut self, lines: &[&str]) -> Self {
        self.log_lines = lines.iter().map(|line| line.to_string()).collect();
        self
    }

    /// A log stream that fails after its buffered lines.
    pub fn with_log_error(mut self) -> Self {
        self.log_error = true;
        self
    }

    /// The credential fields and values a create request carried. Test-only:
    /// nothing in the stub logs or stores them.
    pub fn supplied_credentials(&self) -> Vec<(String, String)> {
        self.credentials.lock().expect("lock").clone()
    }

    /// Transport streams this stub still has open. It reaches zero when the
    /// caller drops an interrupted stream.
    pub fn active_streams(&self) -> usize {
        self.active_streams.load(Ordering::SeqCst)
    }

    /// The gRPC service to add to a server.
    pub fn into_server(self) -> OpenShellServer<Stub> {
        OpenShellServer::new(self)
    }

    pub fn version(&self) -> String {
        self.version.clone()
    }

    /// Every request's normalized argv, in order.
    pub fn requests(&self) -> Vec<String> {
        self.requests.lock().expect("lock").clone()
    }

    fn record(&self, words: &[&str]) {
        let line = words.join(" ");
        self.requests.lock().expect("lock").push(line.clone());
        self.record_client_transport(&line);
        let Some(log) = &self.log else { return };
        if let Some(parent) = log.parent() {
            let _ = fs::create_dir_all(parent);
        }
        // The same leading-separator convention the CLI stub uses, so the two
        // writers cannot merge one invocation into the next.
        let mut text = String::new();
        text.push_str(SEPARATOR);
        text.push('\n');
        for word in words {
            text.push_str(word);
            text.push('\n');
        }
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(log) {
            use std::io::Write;
            let _ = file.write_all(text.as_bytes());
        }
    }

    /// The per-case client seam.
    ///
    /// The suite points this gateway's state root at a symlink that every case
    /// repoints at its own directory, so the request log lands beside the case
    /// being run. The conformance harness reads it to name the transport the
    /// backend actually used.
    ///
    /// Only a harness-configured gateway (`log` set) writes it, so a unit test
    /// never leaves a stray file beside its temporary state root.
    fn record_client_transport(&self, line: &str) {
        if self.log.is_none() {
            return;
        }
        let Ok(state) = fs::canonicalize(&self.state) else {
            return;
        };
        let Some(case_dir) = state.parent() else {
            return;
        };
        let path = case_dir.join("client-requests.log");
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
            use std::io::Write;
            let _ = writeln!(file, "{line}");
        }
    }

    fn fixtures_dir(&self) -> PathBuf {
        self.state.join("fixtures")
    }

    fn fixture(&self, name: &str) -> Option<String> {
        fs::read_to_string(self.fixtures_dir().join(name)).ok()
    }

    fn fixture_present(&self, name: &str) -> bool {
        self.fixtures_dir().join(name).exists()
    }

    /// The canned exec outcome for this command: a per-command case first,
    /// then the run's stdout and exit status.
    fn exec_outcome(&self, command: &[String]) -> (Vec<u8>, i32) {
        let joined = command.join(" ");
        if let Some(cases) = self.fixture("exec.cases") {
            for line in cases.lines() {
                let mut fields = line.split('|');
                let key = fields.next().unwrap_or_default();
                if key.is_empty() || !joined.contains(key) {
                    continue;
                }
                let exit = fields
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .parse()
                    .unwrap_or(0);
                let file = fields.next().unwrap_or_default();
                let stdout = if file.is_empty() {
                    Vec::new()
                } else {
                    fs::read(file).unwrap_or_default()
                };
                return (stdout, exit);
            }
        }
        let stdout = self
            .fixture("exec.stdout")
            .map(String::into_bytes)
            .unwrap_or_else(|| self.exec_stdout.clone());
        let exit = self
            .fixture("exec.exit")
            .and_then(|text| text.trim().parse().ok())
            .unwrap_or(self.exec_exit);
        (stdout, exit)
    }

    /// The structured pending rules: the per-run fixture when a case wrote
    /// one, otherwise the case's seeded rule files.
    fn rules(&self, sandbox: &str) -> (u64, Vec<proto::PolicyChunk>) {
        let version = self
            .fixture("rules.version")
            .and_then(|text| text.trim().parse().ok())
            .unwrap_or(1);
        let text = self
            .fixture("rules")
            .or_else(|| fs::read_to_string(self.state.join("rules").join(sandbox)).ok());
        (
            version,
            text.map(|text| parse_rules(&text)).unwrap_or_default(),
        )
    }

    /// Run one exec the way the CLI stub does: internal sandbox scripts and
    /// the run wrapper execute locally; everything else reports the run's
    /// canned outcome. Fixtures arrive as files under the state root.
    async fn run_exec(&self, request: &proto::ExecSandboxRequest) -> ExecOutcome {
        let command = &request.command;
        let internal = command.len() >= 4
            && command[0] == "sh"
            && command[1] == "-c"
            && command[3].ends_with("-git");
        let wrapper = command.len() >= 4
            && command[0] == "sh"
            && command[1] == "-c"
            && command[3].ends_with("-run")
            && self.fixture_present("exec.run-wrapper");
        if internal {
            if let Some(fail) = self.fixture("exec.fail") {
                let fail = fail.trim();
                if !fail.is_empty() && command[2].contains(fail) {
                    return ExecOutcome {
                        stdout: Vec::new(),
                        stderr: b"stub: sandbox script failed\n".to_vec(),
                        exit_code: 1,
                    };
                }
            }
        }
        if internal || wrapper {
            let tools = self
                .fixture("exec.tools")
                .map(|text| text.trim().to_string())
                .unwrap_or_default();
            let script = command[2].clone();
            let args: Vec<String> = command[3..].to_vec();
            let stdin = request.stdin.clone();
            let git_trace = self
                .fixture("exec.git-trace")
                .map(|text| text.trim().to_string())
                .unwrap_or_default();
            let output = tokio::task::spawn_blocking(move || {
                use std::io::Write;
                let mut process = std::process::Command::new("sh");
                process
                    .arg("-c")
                    .arg(&script)
                    .args(&args)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());
                if !tools.is_empty() {
                    let path = std::env::var("PATH").unwrap_or_default();
                    process.env("PATH", format!("{tools}:{path}"));
                }
                if !git_trace.is_empty() {
                    process.env("GIT_TRACE", &git_trace);
                }
                let mut child = process.spawn()?;
                if let Some(pipe) = child.stdin.take() {
                    let mut pipe = pipe;
                    let _ = pipe.write_all(&stdin);
                }
                child.wait_with_output()
            })
            .await;
            if let Ok(Ok(output)) = output {
                return ExecOutcome {
                    stdout: output.stdout,
                    stderr: output.stderr,
                    exit_code: output.status.code().unwrap_or(1),
                };
            }
            return ExecOutcome {
                stdout: Vec::new(),
                stderr: b"stub: sandbox script failed\n".to_vec(),
                exit_code: 1,
            };
        }
        // The CLI stub logs agent stdin and nothing else: an internal script
        // returns before that point.
        if let Some(path) = self.fixture("exec.stdin-log") {
            let _ = fs::write(path.trim(), &request.stdin);
        }
        if matches!(
            command.first().map(String::as_str),
            Some("maki" | "opencode" | "claude" | "codex")
        ) {
            if let Some(script) = self.fixture("exec.maki-script") {
                let workdir = request.workdir.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    let mut process = std::process::Command::new("sh");
                    process.arg("-c").arg(script);
                    if !workdir.is_empty() {
                        process.current_dir(workdir);
                    }
                    process.status()
                })
                .await;
            }
        }
        let (stdout, exit_code) = self.exec_outcome(command);
        ExecOutcome {
            stdout,
            stderr: Vec::new(),
            exit_code,
        }
    }

    fn sandboxes_dir(&self) -> PathBuf {
        self.state.join("sandboxes")
    }

    fn providers_dir(&self) -> PathBuf {
        self.state.join("providers")
    }

    fn ids_dir(&self) -> PathBuf {
        self.state.join("ids")
    }

    fn phase(&self, name: &str) -> Option<String> {
        let text = fs::read_to_string(self.sandboxes_dir().join(name)).ok()?;
        Some(text.trim().to_string())
    }

    fn set_phase(&self, name: &str, phase: &str) -> std::io::Result<()> {
        fs::create_dir_all(self.sandboxes_dir())?;
        fs::write(self.sandboxes_dir().join(name), format!("{phase}\n"))
    }

    fn id_of(&self, name: &str) -> Option<String> {
        fs::read_to_string(self.ids_dir().join(name))
            .ok()
            .map(|text| text.trim().to_string())
    }

    fn set_id(&self, name: &str) -> std::io::Result<()> {
        fs::create_dir_all(self.ids_dir())?;
        // The same shape the CLI stub writes: name, epoch, pid. The
        // conformance normalizer collapses it, so a state digest compares the
        // two transports without inventing a stable id.
        let epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        fs::write(
            self.ids_dir().join(name),
            format!("id-{name}-{epoch}-{}", std::process::id()),
        )
    }

    fn attached(&self, name: &str) -> Vec<String> {
        fs::read_to_string(self.providers_dir().join(name))
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect()
    }

    fn set_attached(&self, name: &str, providers: &[String]) -> std::io::Result<()> {
        fs::create_dir_all(self.providers_dir())?;
        fs::write(
            self.providers_dir().join(name),
            format!("{}\n", providers.join("\n")),
        )
    }

    fn forget(&self, name: &str) -> std::io::Result<()> {
        let _ = fs::remove_file(self.sandboxes_dir().join(name));
        let _ = fs::remove_file(self.providers_dir().join(name));
        let _ = fs::remove_file(self.ids_dir().join(name));
        Ok(())
    }

    fn sandboxes(&self) -> Vec<proto::Sandbox> {
        let mut names = Vec::new();
        if let Ok(entries) = fs::read_dir(self.sandboxes_dir()) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    names.push(name.to_string());
                }
            }
        }
        names.sort();
        names.iter().filter_map(|name| self.sandbox(name)).collect()
    }

    fn sandbox(&self, name: &str) -> Option<proto::Sandbox> {
        let phase = self.phase(name)?;
        let id = self.id_of(name).unwrap_or_else(|| format!("id-{name}"));
        Some(proto::Sandbox {
            metadata: Some(proto::ObjectMeta {
                id,
                name: name.to_string(),
                resource_version: 1,
                ..Default::default()
            }),
            spec: None,
            status: Some(proto::SandboxStatus {
                phase: phase_code(&phase),
                current_policy_version: 1,
                ..Default::default()
            }),
            host_key_fingerprint: String::new(),
            created_from_workload_template: None,
        })
    }

    fn provider_names(&self) -> Vec<String> {
        fs::read_to_string(self.state.join("providers.list"))
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect()
    }

    fn add_provider(&self, name: &str) -> std::io::Result<()> {
        fs::create_dir_all(&self.state)?;
        let mut names = self.provider_names();
        if !names.iter().any(|known| known == name) {
            names.push(name.to_string());
        }
        fs::write(
            self.state.join("providers.list"),
            format!("{}\n", names.join("\n")),
        )
    }

    fn approve(&self, sandbox: &str, chunk: &str) -> Result<(), String> {
        let file = self.state.join("rules").join(sandbox);
        let text = fs::read_to_string(&file).map_err(|error| error.to_string())?;
        let mut found = false;
        let mut kept = BTreeMap::new();
        for line in text.lines() {
            let id = line.split('|').next().unwrap_or_default().trim();
            if id == chunk {
                found = true;
                continue;
            }
            kept.insert(id.to_string(), line.to_string());
        }
        if !found {
            return Err(format!("no pending chunk '{chunk}' on '{sandbox}'"));
        }
        let body: Vec<String> = kept.into_values().collect();
        fs::write(&file, body.join("\n")).map_err(|error| error.to_string())?;
        Ok(())
    }
}

/// `chunk-id|rule-name|binary|host:port|verdict` lines, one chunk each.
fn parse_rules(text: &str) -> Vec<proto::PolicyChunk> {
    let mut chunks = Vec::new();
    for line in text.lines() {
        let mut parts = line.split('|');
        let Some(id) = parts.next().filter(|part| !part.trim().is_empty()) else {
            continue;
        };
        let rule_name = parts.next().unwrap_or_default();
        let binary = parts.next().unwrap_or_default();
        let endpoint = parts.next().unwrap_or_default();
        let verdict = parts.next().unwrap_or_default();
        let mut endpoints = Vec::new();
        if !endpoint.is_empty() {
            let (host, port) = endpoint.split_once(':').unwrap_or((endpoint, "443"));
            endpoints.push(proto::NetworkEndpoint {
                host: host.to_string(),
                port: port.parse().unwrap_or(443),
                ..Default::default()
            });
        }
        chunks.push(proto::PolicyChunk {
            id: id.trim().to_string(),
            status: "pending".to_string(),
            rule_name: rule_name.to_string(),
            proposed_rule: Some(proto::NetworkPolicyRule {
                name: rule_name.to_string(),
                endpoints,
                binaries: Vec::new(),
            }),
            binary: binary.to_string(),
            validation_result: verdict.to_string(),
            ..Default::default()
        });
    }
    chunks
}

/// The CLI create argv the request stands for, so the create argument surface
/// stays reviewable after the conversion. The policy arrives parsed, so the
/// request's policy presence is recorded by name only.
fn create_words(request: &proto::CreateSandboxRequest) -> Vec<String> {
    let mut words = vec![
        "sandbox".to_string(),
        "create".to_string(),
        "--name".to_string(),
        request.name.clone(),
    ];
    if let Some(spec) = request.spec.as_ref() {
        if let Some(template) = spec.template.as_ref() {
            if !template.image.is_empty() {
                words.push("--from".to_string());
                words.push(template.image.clone());
            }
        }
        if spec.policy.is_some() {
            words.push("--policy".to_string());
            words.push("<parsed>".to_string());
        }
        if let Some(resources) = spec
            .template
            .as_ref()
            .and_then(|template| template.resources.as_ref())
        {
            if let Some(limits) = resources.fields.get("limits") {
                if let Some(prost_types::value::Kind::StructValue(limits)) = limits.kind.as_ref() {
                    for key in ["cpu", "memory"] {
                        if let Some(value) = limits.fields.get(key) {
                            if let Some(prost_types::value::Kind::StringValue(value)) =
                                value.kind.as_ref()
                            {
                                words.push(format!("--{key}"));
                                words.push(value.clone());
                            }
                        }
                    }
                }
            }
        }
        for provider in spec.providers.iter().filter(|value| !value.is_empty()) {
            words.push("--provider".to_string());
            words.push(provider.clone());
        }
        let mut environment: Vec<(&String, &String)> = spec.environment.iter().collect();
        environment.sort();
        for (name, value) in environment {
            // An empty value is how the request carries `--env-from NAME`:
            // the gateway reads that variable from its own environment.
            if value.is_empty() {
                words.push("--env-from".to_string());
                words.push(name.clone());
            } else {
                words.push("--env".to_string());
                words.push(format!("{name}={value}"));
            }
        }
    }
    words.push("--detach".to_string());
    words
}

/// The exec argv the request stands for, so a converted exec keeps the same
/// seam shape as the CLI it replaced.
fn exec_words(request: &proto::ExecSandboxRequest, tty: bool) -> Vec<String> {
    let mut words = vec![
        "sandbox".to_string(),
        "exec".to_string(),
        "-n".to_string(),
        request.sandbox.clone(),
    ];
    if tty {
        words.push("--tty".to_string());
    } else {
        words.push("--no-login-shell".to_string());
    }
    if !request.workdir.is_empty() {
        words.push("--workdir".to_string());
        words.push(request.workdir.clone());
    }
    let mut environment: Vec<(String, String)> = request
        .environment
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    environment.sort();
    for (key, value) in environment {
        words.push("--env".to_string());
        words.push(format!("{key}={value}"));
    }
    words.push("--".to_string());
    words.extend(request.command.iter().cloned());
    words
}

/// One exec's effect: what the process wrote and the status it exited with.
struct ExecOutcome {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: i32,
}

fn phase_code(phase: &str) -> i32 {
    let value = match phase {
        "Provisioning" => proto::SandboxPhase::Provisioning,
        "Ready" => proto::SandboxPhase::Ready,
        "Error" => proto::SandboxPhase::Error,
        "Deleting" => proto::SandboxPhase::Deleting,
        "Stopping" => proto::SandboxPhase::Stopping,
        "Stopped" => proto::SandboxPhase::Stopped,
        "Starting" => proto::SandboxPhase::Starting,
        "Completed" => proto::SandboxPhase::Completed,
        "Suspending" => proto::SandboxPhase::Suspending,
        "Suspended" => proto::SandboxPhase::Suspended,
        _ => proto::SandboxPhase::Unknown,
    };
    value as i32
}

/// Keeps the active count honest: the count falls when the response stream is
/// dropped, which is the observable an interrupt test asserts on.
struct ActiveGuard(Arc<AtomicUsize>);

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// A response stream that yields its buffered events and then stays open, so
/// the caller can be interrupted while it is still live.
struct HeldStream<T> {
    first: Vec<T>,
    _guard: Option<ActiveGuard>,
}

impl<T> Unpin for HeldStream<T> {}

impl<T> tokio_stream::Stream for HeldStream<T> {
    type Item = T;

    fn poll_next(
        self: std::pin::Pin<&mut Self>,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        let held = self.get_mut();
        if held.first.is_empty() {
            return std::task::Poll::Pending;
        }
        let item = held.first.remove(0);
        std::task::Poll::Ready(Some(item))
    }
}

fn stub_log_line(sandbox_id: &str, message: String) -> proto::SandboxLogLine {
    proto::SandboxLogLine {
        sandbox_id: sandbox_id.to_string(),
        level: "INFO".to_string(),
        target: "stub".to_string(),
        message,
        source: "sandbox".to_string(),
        ..Default::default()
    }
}

/// The equivalent CLI argv a log read stands for, so a case asserting the
/// seam keeps the same shape after the conversion.
fn log_words(request: &proto::WatchSandboxRequest) -> Vec<String> {
    let mut words = vec!["logs".to_string(), request.sandbox.clone()];
    if request.follow_logs {
        words.push("--tail".to_string());
    }
    if let Some(since) = request.since_time.as_ref() {
        words.push("--since".to_string());
        words.push(
            (since.seconds.saturating_mul(1000) + i64::from(since.nanos) / 1_000_000).to_string(),
        );
    }
    for source in &request.log_sources {
        words.push("--source".to_string());
        words.push(source.clone());
    }
    if !request.log_min_level.is_empty() {
        words.push("--level".to_string());
        words.push(request.log_min_level.to_lowercase());
    }
    words.push("-n".to_string());
    words.push(request.log_tail_lines.to_string());
    words
}

#[tonic::async_trait]
#[allow(unused_variables, clippy::too_many_lines)]
impl OpenShell for Stub {
    type ExecSandboxStream = std::pin::Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::ExecSandboxEvent, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type ForwardTcpStream = std::pin::Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::TcpForwardFrame, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type ExecSandboxInteractiveStream = std::pin::Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::ExecSandboxEvent, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type ConnectSupervisorStream = std::pin::Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::GatewayMessage, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type RelayStreamStream = std::pin::Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::RelayFrame, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type PeerRelayStream = std::pin::Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::PeerRelayFrame, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type WatchSandboxStream = std::pin::Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::SandboxStreamEvent, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;

    async fn health(
        &self,
        request: tonic::Request<proto::HealthRequest>,
    ) -> std::result::Result<tonic::Response<proto::HealthResponse>, tonic::Status> {
        self.record(&["status", "--output", "json"]);
        Ok(tonic::Response::new(proto::HealthResponse {
            status: proto::ServiceStatus::Healthy as i32,
            version: self.version(),
        }))
    }

    async fn get_current_user(
        &self,
        request: tonic::Request<proto::GetCurrentUserRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetCurrentUserResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_current_user",
        ))
    }

    async fn get_gateway_info(
        &self,
        request: tonic::Request<proto::GetGatewayInfoRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetGatewayInfoResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_gateway_info",
        ))
    }

    async fn create_sandbox(
        &self,
        request: tonic::Request<proto::CreateSandboxRequest>,
    ) -> std::result::Result<tonic::Response<proto::SandboxResponse>, tonic::Status> {
        let request = request.into_inner();
        let name = request.name.clone();
        let words = create_words(&request);
        let recorded: Vec<&str> = words.iter().map(String::as_str).collect();
        self.record(&recorded);
        if name.is_empty() {
            return Err(tonic::Status::invalid_argument("sandbox name is required"));
        }
        let providers = request
            .spec
            .as_ref()
            .map(|spec| spec.providers.clone())
            .unwrap_or_default();
        let exists = self.phase(&name).is_some();
        if (self.create_race || self.fixture_present("create.race")) && !exists {
            // A concurrent run won: the sandbox exists, but this create loses.
            let _ = self.set_phase(&name, "Ready");
            let _ = self.set_attached(&name, &providers);
            return Err(tonic::Status::already_exists(format!(
                "sandbox {name} already exists"
            )));
        }
        if exists {
            return Err(tonic::Status::already_exists(format!(
                "sandbox {name} already exists"
            )));
        }
        self.set_id(&name)
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        self.set_phase(&name, "Ready")
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        self.set_attached(&name, &providers)
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        let sandbox = self
            .sandbox(&name)
            .ok_or_else(|| tonic::Status::internal("sandbox vanished after create"))?;
        Ok(tonic::Response::new(proto::SandboxResponse {
            sandbox: Some(sandbox),
            service_urls: Default::default(),
        }))
    }

    async fn begin_rootfs_tar_staging(
        &self,
        request: tonic::Request<proto::BeginRootfsTarStagingRequest>,
    ) -> std::result::Result<tonic::Response<proto::BeginRootfsTarStagingResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: begin_rootfs_tar_staging",
        ))
    }

    async fn get_sandbox(
        &self,
        request: tonic::Request<proto::GetSandboxRequest>,
    ) -> std::result::Result<tonic::Response<proto::SandboxResponse>, tonic::Status> {
        let name = request.into_inner().name;
        self.record(&["sandbox", "get", &name, "--output", "json"]);
        let sandbox = self
            .sandbox(&name)
            .ok_or_else(|| tonic::Status::not_found(format!("sandbox {name} not found")))?;
        Ok(tonic::Response::new(proto::SandboxResponse {
            sandbox: Some(sandbox),
            service_urls: Default::default(),
        }))
    }

    async fn list_sandboxes(
        &self,
        request: tonic::Request<proto::ListSandboxesRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListSandboxesResponse>, tonic::Status> {
        self.record(&["sandbox", "list", "--output", "json"]);
        Ok(tonic::Response::new(proto::ListSandboxesResponse {
            sandboxes: self.sandboxes(),
            next_page_token: String::new(),
        }))
    }

    async fn create_sandbox_template(
        &self,
        request: tonic::Request<proto::CreateSandboxTemplateRequest>,
    ) -> std::result::Result<tonic::Response<proto::SandboxTemplateResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: create_sandbox_template",
        ))
    }

    async fn get_sandbox_template(
        &self,
        request: tonic::Request<proto::GetSandboxTemplateRequest>,
    ) -> std::result::Result<tonic::Response<proto::SandboxTemplateResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_sandbox_template",
        ))
    }

    async fn list_sandbox_templates(
        &self,
        request: tonic::Request<proto::ListSandboxTemplatesRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListSandboxTemplatesResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: list_sandbox_templates",
        ))
    }

    async fn delete_sandbox_template(
        &self,
        request: tonic::Request<proto::DeleteSandboxTemplateRequest>,
    ) -> std::result::Result<tonic::Response<proto::DeleteSandboxTemplateResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: delete_sandbox_template",
        ))
    }

    async fn list_sandbox_providers(
        &self,
        request: tonic::Request<proto::ListSandboxProvidersRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListSandboxProvidersResponse>, tonic::Status>
    {
        let name = request.into_inner().sandbox;
        self.record(&["sandbox", "provider", "list", &name, "--output", "json"]);
        if self.phase(&name).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {name} not found"
            )));
        }
        let providers = self
            .attached(&name)
            .into_iter()
            .map(|name| proto::Provider {
                metadata: Some(proto::ObjectMeta {
                    name,
                    ..Default::default()
                }),
                ..Default::default()
            })
            .collect();
        Ok(tonic::Response::new(proto::ListSandboxProvidersResponse {
            providers,
            next_page_token: String::new(),
        }))
    }

    async fn attach_sandbox_provider(
        &self,
        request: tonic::Request<proto::AttachSandboxProviderRequest>,
    ) -> std::result::Result<tonic::Response<proto::AttachSandboxProviderResponse>, tonic::Status>
    {
        let request = request.into_inner();
        self.record(&[
            "sandbox",
            "provider",
            "attach",
            &request.sandbox,
            &request.provider,
        ]);
        if self.phase(&request.sandbox).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {} not found",
                request.sandbox
            )));
        }
        let mut attached = self.attached(&request.sandbox);
        if self.fixture_present("attach.fail") {
            return Err(tonic::Status::unavailable(format!(
                "stub: attach of {} timed out waiting for the supervisor",
                request.provider
            )));
        }
        if !attached.contains(&request.provider) {
            attached.push(request.provider.clone());
            self.set_attached(&request.sandbox, &attached)
                .map_err(|error| tonic::Status::internal(error.to_string()))?;
        }
        Ok(tonic::Response::new(
            proto::AttachSandboxProviderResponse::default(),
        ))
    }

    async fn detach_sandbox_provider(
        &self,
        request: tonic::Request<proto::DetachSandboxProviderRequest>,
    ) -> std::result::Result<tonic::Response<proto::DetachSandboxProviderResponse>, tonic::Status>
    {
        let request = request.into_inner();
        self.record(&[
            "sandbox",
            "provider",
            "detach",
            &request.sandbox,
            &request.provider,
        ]);
        let attached: Vec<String> = self
            .attached(&request.sandbox)
            .into_iter()
            .filter(|name| name != &request.provider)
            .collect();
        self.set_attached(&request.sandbox, &attached)
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        Ok(tonic::Response::new(
            proto::DetachSandboxProviderResponse::default(),
        ))
    }

    async fn get_sandbox_provider_status(
        &self,
        request: tonic::Request<proto::GetSandboxProviderStatusRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetSandboxProviderStatusResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_sandbox_provider_status",
        ))
    }

    async fn delete_sandbox(
        &self,
        request: tonic::Request<proto::DeleteSandboxRequest>,
    ) -> std::result::Result<tonic::Response<proto::DeleteSandboxResponse>, tonic::Status> {
        let request = request.into_inner();
        let name = request.name;
        self.record(&["sandbox", "delete", &name]);
        if self.delete_fail || self.fixture_present("delete.fail") {
            return Err(tonic::Status::internal(format!(
                "cannot delete sandbox {name}"
            )));
        }
        let id = self.id_of(&name);
        if self.phase(&name).is_none() {
            if request.allow_missing {
                return Ok(tonic::Response::new(proto::DeleteSandboxResponse {
                    outcome: proto::DeletionOutcome::AlreadyAbsent as i32,
                    sandbox_id: String::new(),
                }));
            }
            return Err(tonic::Status::not_found(format!(
                "sandbox {name} not found"
            )));
        }
        self.forget(&name)
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        Ok(tonic::Response::new(proto::DeleteSandboxResponse {
            outcome: proto::DeletionOutcome::Completed as i32,
            sandbox_id: id.unwrap_or_default(),
        }))
    }

    async fn stop_sandbox(
        &self,
        request: tonic::Request<proto::StopSandboxRequest>,
    ) -> std::result::Result<tonic::Response<proto::SandboxResponse>, tonic::Status> {
        let name = request.into_inner().name;
        self.record(&["sandbox", "stop", &name]);
        if self.phase(&name).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {name} not found"
            )));
        }
        self.set_phase(&name, "Stopped")
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        let sandbox = self
            .sandbox(&name)
            .ok_or_else(|| tonic::Status::internal("sandbox vanished after stop"))?;
        Ok(tonic::Response::new(proto::SandboxResponse {
            sandbox: Some(sandbox),
            service_urls: Default::default(),
        }))
    }

    async fn start_sandbox(
        &self,
        request: tonic::Request<proto::StartSandboxRequest>,
    ) -> std::result::Result<tonic::Response<proto::SandboxResponse>, tonic::Status> {
        let name = request.into_inner().name;
        self.record(&["sandbox", "start", &name]);
        if self.phase(&name).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {name} not found"
            )));
        }
        self.set_phase(&name, "Ready")
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        let sandbox = self
            .sandbox(&name)
            .ok_or_else(|| tonic::Status::internal("sandbox vanished after start"))?;
        Ok(tonic::Response::new(proto::SandboxResponse {
            sandbox: Some(sandbox),
            service_urls: Default::default(),
        }))
    }

    async fn suspend_sandbox(
        &self,
        request: tonic::Request<proto::SuspendSandboxRequest>,
    ) -> std::result::Result<tonic::Response<proto::SandboxResponse>, tonic::Status> {
        let name = request.into_inner().name;
        self.record(&["sandbox", "suspend", &name]);
        if self.phase(&name).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {name} not found"
            )));
        }
        self.set_phase(&name, "Suspended")
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        let sandbox = self
            .sandbox(&name)
            .ok_or_else(|| tonic::Status::internal("sandbox vanished after suspend"))?;
        Ok(tonic::Response::new(proto::SandboxResponse {
            sandbox: Some(sandbox),
            service_urls: Default::default(),
        }))
    }

    async fn resume_sandbox(
        &self,
        request: tonic::Request<proto::ResumeSandboxRequest>,
    ) -> std::result::Result<tonic::Response<proto::SandboxResponse>, tonic::Status> {
        let name = request.into_inner().name;
        self.record(&["sandbox", "resume", &name]);
        match self.phase(&name) {
            None => {
                return Err(tonic::Status::not_found(format!(
                    "sandbox {name} not found"
                )))
            }
            Some(phase) if phase != "Suspended" => {
                return Err(tonic::Status::failed_precondition(format!(
                    "sandbox {name} is {phase}, not suspended"
                )))
            }
            Some(_) => {}
        }
        self.set_phase(&name, "Ready")
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        let sandbox = self
            .sandbox(&name)
            .ok_or_else(|| tonic::Status::internal("sandbox vanished after resume"))?;
        Ok(tonic::Response::new(proto::SandboxResponse {
            sandbox: Some(sandbox),
            service_urls: Default::default(),
        }))
    }

    async fn create_ssh_session(
        &self,
        request: tonic::Request<proto::CreateSshSessionRequest>,
    ) -> std::result::Result<tonic::Response<proto::CreateSshSessionResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: create_ssh_session",
        ))
    }

    async fn expose_service(
        &self,
        request: tonic::Request<proto::ExposeServiceRequest>,
    ) -> std::result::Result<tonic::Response<proto::ServiceEndpointResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: expose_service"))
    }

    async fn get_service(
        &self,
        request: tonic::Request<proto::GetServiceRequest>,
    ) -> std::result::Result<tonic::Response<proto::ServiceEndpointResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: get_service"))
    }

    async fn list_services(
        &self,
        request: tonic::Request<proto::ListServicesRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListServicesResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: list_services"))
    }

    async fn delete_service(
        &self,
        request: tonic::Request<proto::DeleteServiceRequest>,
    ) -> std::result::Result<tonic::Response<proto::DeleteServiceResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: delete_service"))
    }

    async fn revoke_ssh_session(
        &self,
        request: tonic::Request<proto::RevokeSshSessionRequest>,
    ) -> std::result::Result<tonic::Response<proto::RevokeSshSessionResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: revoke_ssh_session",
        ))
    }

    async fn exec_sandbox(
        &self,
        request: tonic::Request<proto::ExecSandboxRequest>,
    ) -> std::result::Result<tonic::Response<Self::ExecSandboxStream>, tonic::Status> {
        let request = request.into_inner();
        let name = request.sandbox.clone();
        let words = exec_words(&request, false);
        let recorded: Vec<&str> = words.iter().map(String::as_str).collect();
        self.record(&recorded);
        if self.phase(&name).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {name} not found"
            )));
        }
        let outcome = self.run_exec(&request).await;
        let mut events: Vec<std::result::Result<proto::ExecSandboxEvent, tonic::Status>> =
            Vec::new();
        if !outcome.stdout.is_empty() {
            events.push(Ok(proto::ExecSandboxEvent {
                payload: Some(proto::exec_sandbox_event::Payload::Stdout(
                    proto::ExecSandboxStdout {
                        data: outcome.stdout,
                    },
                )),
            }));
        }
        if !outcome.stderr.is_empty() {
            events.push(Ok(proto::ExecSandboxEvent {
                payload: Some(proto::exec_sandbox_event::Payload::Stderr(
                    proto::ExecSandboxStderr {
                        data: outcome.stderr,
                    },
                )),
            }));
        }
        events.push(Ok(proto::ExecSandboxEvent {
            payload: Some(proto::exec_sandbox_event::Payload::Exit(
                proto::ExecSandboxExit {
                    exit_code: outcome.exit_code,
                },
            )),
        }));
        if self.exec_hold {
            events.pop();
            self.active_streams.fetch_add(1, Ordering::SeqCst);
            let held = HeldStream {
                first: events,
                _guard: Some(ActiveGuard(self.active_streams.clone())),
            };
            return Ok(tonic::Response::new(
                Box::pin(held) as Self::ExecSandboxStream
            ));
        }
        if self.exec_interrupt {
            events.pop();
            events.push(Err(tonic::Status::unavailable("stream interrupted")));
        }
        Ok(tonic::Response::new(
            Box::pin(tokio_stream::iter(events)) as Self::ExecSandboxStream
        ))
    }

    async fn forward_tcp(
        &self,
        request: tonic::Request<tonic::Streaming<proto::TcpForwardFrame>>,
    ) -> std::result::Result<tonic::Response<Self::ForwardTcpStream>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: forward_tcp"))
    }

    async fn exec_sandbox_interactive(
        &self,
        request: tonic::Request<tonic::Streaming<proto::ExecSandboxInput>>,
    ) -> std::result::Result<tonic::Response<Self::ExecSandboxInteractiveStream>, tonic::Status>
    {
        let mut stream = request.into_inner();
        let mut start = None;
        let mut stdin = Vec::new();
        while let Ok(Some(frame)) = stream.message().await {
            match frame.payload {
                Some(proto::exec_sandbox_input::Payload::Start(request)) => start = Some(request),
                Some(proto::exec_sandbox_input::Payload::Stdin(bytes)) => stdin.extend(bytes),
                Some(proto::exec_sandbox_input::Payload::Resize(_)) => {}
                None => {}
            }
            if start.is_some() {
                break;
            }
        }
        let mut request = start.ok_or_else(|| {
            tonic::Status::invalid_argument("the interactive exec needs a start frame")
        })?;
        if request.stdin.is_empty() {
            request.stdin = stdin;
        }
        let name = request.sandbox.clone();
        let words = exec_words(&request, request.tty);
        let recorded: Vec<&str> = words.iter().map(String::as_str).collect();
        self.record(&recorded);
        if self.phase(&name).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {name} not found"
            )));
        }
        let outcome = self.run_exec(&request).await;
        let mut events: Vec<std::result::Result<proto::ExecSandboxEvent, tonic::Status>> =
            Vec::new();
        if !outcome.stdout.is_empty() {
            events.push(Ok(proto::ExecSandboxEvent {
                payload: Some(proto::exec_sandbox_event::Payload::Stdout(
                    proto::ExecSandboxStdout {
                        data: outcome.stdout,
                    },
                )),
            }));
        }
        if !outcome.stderr.is_empty() {
            events.push(Ok(proto::ExecSandboxEvent {
                payload: Some(proto::exec_sandbox_event::Payload::Stderr(
                    proto::ExecSandboxStderr {
                        data: outcome.stderr,
                    },
                )),
            }));
        }
        events.push(Ok(proto::ExecSandboxEvent {
            payload: Some(proto::exec_sandbox_event::Payload::Exit(
                proto::ExecSandboxExit {
                    exit_code: outcome.exit_code,
                },
            )),
        }));
        Ok(tonic::Response::new(
            Box::pin(tokio_stream::iter(events)) as Self::ExecSandboxInteractiveStream
        ))
    }

    async fn create_provider(
        &self,
        request: tonic::Request<proto::CreateProviderRequest>,
    ) -> std::result::Result<tonic::Response<proto::ProviderResponse>, tonic::Status> {
        let request = request.into_inner();
        let provider = request
            .provider
            .ok_or_else(|| tonic::Status::invalid_argument("provider is required"))?;
        let name = provider
            .metadata
            .as_ref()
            .map(|meta| meta.name.clone())
            .unwrap_or_default();
        // The credential's FIELD is recorded; its value never is.
        let mut fields: Vec<&String> = provider.credentials.keys().collect();
        fields.sort();
        if let Ok(mut supplied) = self.credentials.lock() {
            supplied.extend(
                provider
                    .credentials
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone())),
            );
        }
        // The case's credential log names where a fixture value is expected to
        // land; it lives outside the state root so the leak scan stays honest.
        if let Some(path) = self.fixture("credential-log") {
            let path = path.trim().to_string();
            if !path.is_empty() {
                let mut values: Vec<&String> = provider.credentials.values().collect();
                values.sort();
                for value in values {
                    use std::io::Write;
                    if let Ok(mut file) =
                        fs::OpenOptions::new().create(true).append(true).open(&path)
                    {
                        let _ = writeln!(file, "{value}");
                    }
                }
            }
        }
        let mut words: Vec<String> = vec![
            "provider".to_string(),
            "create".to_string(),
            "--name".to_string(),
            name.clone(),
            "--type".to_string(),
            provider.r#type.clone(),
        ];
        for field in fields {
            words.push("--credential".to_string());
            words.push(field.clone());
        }
        let mut config: Vec<(&String, &String)> = provider.config.iter().collect();
        config.sort();
        for (key, value) in config {
            words.push("--config".to_string());
            words.push(format!("{key}={value}"));
        }
        if provider.profile_workspace.is_empty() {
            words.push("--global-profile".to_string());
        }
        let recorded: Vec<&str> = words.iter().map(String::as_str).collect();
        self.record(&recorded);
        if self.credential_reject && !provider.credentials.is_empty() {
            return Err(tonic::Status::invalid_argument("credential rejected"));
        }
        self.add_provider(&name)
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        Ok(tonic::Response::new(proto::ProviderResponse {
            provider: Some(provider),
            mutation_id: String::new(),
            target_receipts: Default::default(),
        }))
    }

    async fn get_provider(
        &self,
        request: tonic::Request<proto::GetProviderRequest>,
    ) -> std::result::Result<tonic::Response<proto::ProviderResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: get_provider"))
    }

    async fn get_provider_credentials(
        &self,
        request: tonic::Request<proto::GetProviderCredentialsRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetProviderCredentialsResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_provider_credentials",
        ))
    }

    async fn list_providers(
        &self,
        request: tonic::Request<proto::ListProvidersRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListProvidersResponse>, tonic::Status> {
        self.record(&["provider", "list", "--names"]);
        let providers = self
            .provider_names()
            .into_iter()
            .map(|name| proto::Provider {
                metadata: Some(proto::ObjectMeta {
                    name,
                    ..Default::default()
                }),
                ..Default::default()
            })
            .collect();
        Ok(tonic::Response::new(proto::ListProvidersResponse {
            providers,
            next_page_token: String::new(),
        }))
    }

    async fn list_provider_profiles(
        &self,
        request: tonic::Request<proto::ListProviderProfilesRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListProviderProfilesResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: list_provider_profiles",
        ))
    }

    async fn get_provider_profile(
        &self,
        request: tonic::Request<proto::GetProviderProfileRequest>,
    ) -> std::result::Result<tonic::Response<proto::ProviderProfileResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_provider_profile",
        ))
    }

    async fn import_provider_profiles(
        &self,
        request: tonic::Request<proto::ImportProviderProfilesRequest>,
    ) -> std::result::Result<tonic::Response<proto::ImportProviderProfilesResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: import_provider_profiles",
        ))
    }

    async fn update_provider_profiles(
        &self,
        request: tonic::Request<proto::UpdateProviderProfilesRequest>,
    ) -> std::result::Result<tonic::Response<proto::UpdateProviderProfilesResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: update_provider_profiles",
        ))
    }

    async fn lint_provider_profiles(
        &self,
        request: tonic::Request<proto::LintProviderProfilesRequest>,
    ) -> std::result::Result<tonic::Response<proto::LintProviderProfilesResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: lint_provider_profiles",
        ))
    }

    async fn update_provider(
        &self,
        request: tonic::Request<proto::UpdateProviderRequest>,
    ) -> std::result::Result<tonic::Response<proto::ProviderResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: update_provider",
        ))
    }

    async fn get_provider_refresh_status(
        &self,
        request: tonic::Request<proto::GetProviderRefreshStatusRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetProviderRefreshStatusResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_provider_refresh_status",
        ))
    }

    async fn configure_provider_refresh(
        &self,
        request: tonic::Request<proto::ConfigureProviderRefreshRequest>,
    ) -> std::result::Result<tonic::Response<proto::ConfigureProviderRefreshResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: configure_provider_refresh",
        ))
    }

    async fn rotate_provider_credential(
        &self,
        request: tonic::Request<proto::RotateProviderCredentialRequest>,
    ) -> std::result::Result<tonic::Response<proto::RotateProviderCredentialResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: rotate_provider_credential",
        ))
    }

    async fn delete_provider_refresh(
        &self,
        request: tonic::Request<proto::DeleteProviderRefreshRequest>,
    ) -> std::result::Result<tonic::Response<proto::DeleteProviderRefreshResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: delete_provider_refresh",
        ))
    }

    async fn delete_provider(
        &self,
        request: tonic::Request<proto::DeleteProviderRequest>,
    ) -> std::result::Result<tonic::Response<proto::DeleteProviderResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: delete_provider",
        ))
    }

    async fn delete_provider_profile(
        &self,
        request: tonic::Request<proto::DeleteProviderProfileRequest>,
    ) -> std::result::Result<tonic::Response<proto::DeleteProviderProfileResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: delete_provider_profile",
        ))
    }

    async fn get_sandbox_config(
        &self,
        request: tonic::Request<proto::sandbox::v1::GetSandboxConfigRequest>,
    ) -> std::result::Result<
        tonic::Response<proto::sandbox::v1::GetSandboxConfigResponse>,
        tonic::Status,
    > {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_sandbox_config",
        ))
    }

    async fn get_gateway_config(
        &self,
        request: tonic::Request<proto::sandbox::v1::GetGatewayConfigRequest>,
    ) -> std::result::Result<
        tonic::Response<proto::sandbox::v1::GetGatewayConfigResponse>,
        tonic::Status,
    > {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_gateway_config",
        ))
    }

    async fn update_config(
        &self,
        request: tonic::Request<proto::UpdateConfigRequest>,
    ) -> std::result::Result<tonic::Response<proto::UpdateConfigResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: update_config"))
    }

    async fn get_sandbox_policy_status(
        &self,
        request: tonic::Request<proto::GetSandboxPolicyStatusRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetSandboxPolicyStatusResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_sandbox_policy_status",
        ))
    }

    async fn list_sandbox_policies(
        &self,
        request: tonic::Request<proto::ListSandboxPoliciesRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListSandboxPoliciesResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: list_sandbox_policies",
        ))
    }

    async fn report_policy_status(
        &self,
        request: tonic::Request<proto::ReportPolicyStatusRequest>,
    ) -> std::result::Result<tonic::Response<proto::ReportPolicyStatusResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: report_policy_status",
        ))
    }

    async fn report_endpoint_status(
        &self,
        request: tonic::Request<proto::ReportEndpointStatusRequest>,
    ) -> std::result::Result<tonic::Response<proto::ReportEndpointStatusResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: report_endpoint_status",
        ))
    }

    async fn report_provider_readiness(
        &self,
        request: tonic::Request<proto::ReportProviderReadinessRequest>,
    ) -> std::result::Result<tonic::Response<proto::ReportProviderReadinessResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: report_provider_readiness",
        ))
    }

    async fn report_sandbox_configuration(
        &self,
        request: tonic::Request<proto::ReportSandboxConfigurationRequest>,
    ) -> std::result::Result<
        tonic::Response<proto::ReportSandboxConfigurationResponse>,
        tonic::Status,
    > {
        Err(tonic::Status::unimplemented(
            "stub-gateway: report_sandbox_configuration",
        ))
    }

    async fn get_sandbox_provider_environment(
        &self,
        request: tonic::Request<proto::GetSandboxProviderEnvironmentRequest>,
    ) -> std::result::Result<
        tonic::Response<proto::GetSandboxProviderEnvironmentResponse>,
        tonic::Status,
    > {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_sandbox_provider_environment",
        ))
    }

    async fn exchange_provider_subject_token(
        &self,
        request: tonic::Request<proto::ExchangeProviderSubjectTokenRequest>,
    ) -> std::result::Result<
        tonic::Response<proto::ExchangeProviderSubjectTokenResponse>,
        tonic::Status,
    > {
        Err(tonic::Status::unimplemented(
            "stub-gateway: exchange_provider_subject_token",
        ))
    }

    async fn get_sandbox_logs(
        &self,
        request: tonic::Request<proto::GetSandboxLogsRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetSandboxLogsResponse>, tonic::Status> {
        let request = request.into_inner();
        let lines_text = request.lines.to_string();
        let mut words = vec!["logs".to_string(), request.sandbox.clone()];
        words.push("-n".to_string());
        words.push(lines_text);
        let borrowed: Vec<&str> = words.iter().map(String::as_str).collect();
        self.record(&borrowed);
        if self.phase(&request.sandbox).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {} not found",
                request.sandbox
            )));
        }
        let id = self
            .id_of(&request.sandbox)
            .unwrap_or_else(|| format!("id-{}", request.sandbox));
        let mut lines = self.log_lines.clone();
        if lines.is_empty() {
            lines.push("stub log line".to_string());
        }
        if request.lines > 0 && lines.len() > request.lines as usize {
            lines = lines.split_off(lines.len() - request.lines as usize);
        }
        let logs = lines
            .into_iter()
            .map(|message| stub_log_line(&id, message))
            .collect();
        Ok(tonic::Response::new(proto::GetSandboxLogsResponse {
            logs,
            buffer_total: self.log_lines.len() as u32,
        }))
    }

    async fn push_sandbox_logs(
        &self,
        request: tonic::Request<tonic::Streaming<proto::PushSandboxLogsRequest>>,
    ) -> std::result::Result<tonic::Response<proto::PushSandboxLogsResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: push_sandbox_logs",
        ))
    }

    async fn connect_supervisor(
        &self,
        request: tonic::Request<tonic::Streaming<proto::SupervisorMessage>>,
    ) -> std::result::Result<tonic::Response<Self::ConnectSupervisorStream>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: connect_supervisor",
        ))
    }

    async fn report_main_process_exit(
        &self,
        request: tonic::Request<proto::ReportMainProcessExitRequest>,
    ) -> std::result::Result<tonic::Response<proto::ReportMainProcessExitResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: report_main_process_exit",
        ))
    }

    async fn finalize_main_process_exit(
        &self,
        request: tonic::Request<proto::FinalizeMainProcessExitRequest>,
    ) -> std::result::Result<tonic::Response<proto::FinalizeMainProcessExitResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: finalize_main_process_exit",
        ))
    }

    async fn relay_stream(
        &self,
        request: tonic::Request<tonic::Streaming<proto::RelayFrame>>,
    ) -> std::result::Result<tonic::Response<Self::RelayStreamStream>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: relay_stream"))
    }

    async fn peer_relay(
        &self,
        request: tonic::Request<tonic::Streaming<proto::PeerRelayFrame>>,
    ) -> std::result::Result<tonic::Response<Self::PeerRelayStream>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: peer_relay"))
    }

    async fn peer_report_provider_readiness(
        &self,
        request: tonic::Request<proto::ReportProviderReadinessRequest>,
    ) -> std::result::Result<tonic::Response<proto::ReportProviderReadinessResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: peer_report_provider_readiness",
        ))
    }

    async fn peer_report_endpoint_status(
        &self,
        request: tonic::Request<proto::ReportEndpointStatusRequest>,
    ) -> std::result::Result<tonic::Response<proto::ReportEndpointStatusResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: peer_report_endpoint_status",
        ))
    }

    async fn peer_get_sandbox_provider_status(
        &self,
        request: tonic::Request<proto::GetSandboxProviderStatusRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetSandboxProviderStatusResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: peer_get_sandbox_provider_status",
        ))
    }

    async fn peer_notify_config_update(
        &self,
        request: tonic::Request<proto::PeerNotifyConfigUpdateRequest>,
    ) -> std::result::Result<tonic::Response<proto::PeerNotifyConfigUpdateResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: peer_notify_config_update",
        ))
    }

    async fn watch_sandbox(
        &self,
        request: tonic::Request<proto::WatchSandboxRequest>,
    ) -> std::result::Result<tonic::Response<Self::WatchSandboxStream>, tonic::Status> {
        let request = request.into_inner();
        let words = log_words(&request);
        let borrowed: Vec<&str> = words.iter().map(String::as_str).collect();
        self.record(&borrowed);
        if self.phase(&request.sandbox).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {} not found",
                request.sandbox
            )));
        }
        let id = self
            .id_of(&request.sandbox)
            .unwrap_or_else(|| format!("id-{}", request.sandbox));
        let mut lines = self.log_lines.clone();
        if lines.is_empty() {
            lines.push("stub log line".to_string());
        }
        if request.log_tail_lines > 0 && lines.len() > request.log_tail_lines as usize {
            lines = lines.split_off(lines.len() - request.log_tail_lines as usize);
        }
        let mut events: Vec<std::result::Result<proto::SandboxStreamEvent, tonic::Status>> = lines
            .into_iter()
            .enumerate()
            .map(|(index, message)| {
                Ok(proto::SandboxStreamEvent {
                    payload: Some(proto::sandbox_stream_event::Payload::Log(stub_log_line(
                        &id, message,
                    ))),
                    cursor: format!("{}", index + 1),
                })
            })
            .collect();
        if self.log_error {
            events.push(Err(tonic::Status::unavailable("stream interrupted")));
        }
        Ok(tonic::Response::new(
            Box::pin(tokio_stream::iter(events)) as Self::WatchSandboxStream
        ))
    }

    async fn submit_policy_analysis(
        &self,
        request: tonic::Request<proto::SubmitPolicyAnalysisRequest>,
    ) -> std::result::Result<tonic::Response<proto::SubmitPolicyAnalysisResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: submit_policy_analysis",
        ))
    }

    async fn get_draft_policy(
        &self,
        request: tonic::Request<proto::GetDraftPolicyRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetDraftPolicyResponse>, tonic::Status> {
        let request = request.into_inner();
        self.record(&["rule", "get", &request.sandbox, "--status", "pending"]);
        let (version, chunks) = self.rules(&request.sandbox);
        let chunks = chunks
            .into_iter()
            .filter(|chunk| {
                request.status_filter.is_empty() || chunk.status == request.status_filter
            })
            .collect();
        Ok(tonic::Response::new(proto::GetDraftPolicyResponse {
            chunks,
            rolling_summary: String::new(),
            draft_version: version,
            last_analyzed_time: None,
        }))
    }

    async fn approve_draft_chunk(
        &self,
        request: tonic::Request<proto::ApproveDraftChunkRequest>,
    ) -> std::result::Result<tonic::Response<proto::ApproveDraftChunkResponse>, tonic::Status> {
        let request = request.into_inner();
        self.record(&[
            "rule",
            "approve",
            &request.sandbox,
            "--chunk-id",
            &request.chunk_id,
        ]);
        self.approve(&request.sandbox, &request.chunk_id)
            .map_err(tonic::Status::internal)?;
        Ok(tonic::Response::new(proto::ApproveDraftChunkResponse {
            policy_version: 2,
            policy_hash: "stub-policy-hash".to_string(),
        }))
    }

    async fn reject_draft_chunk(
        &self,
        request: tonic::Request<proto::RejectDraftChunkRequest>,
    ) -> std::result::Result<tonic::Response<proto::RejectDraftChunkResponse>, tonic::Status> {
        let request = request.into_inner();
        self.record(&[
            "rule",
            "reject",
            &request.sandbox,
            "--chunk-id",
            &request.chunk_id,
            "--reason",
            &request.reason,
        ]);
        // Rejecting a chunk the case never seeded still succeeds: the write is
        // recorded, and there is nothing to remove.
        let _ = self.approve(&request.sandbox, &request.chunk_id);
        Ok(tonic::Response::new(
            proto::RejectDraftChunkResponse::default(),
        ))
    }

    async fn approve_all_draft_chunks(
        &self,
        request: tonic::Request<proto::ApproveAllDraftChunksRequest>,
    ) -> std::result::Result<tonic::Response<proto::ApproveAllDraftChunksResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: approve_all_draft_chunks",
        ))
    }

    async fn edit_draft_chunk(
        &self,
        request: tonic::Request<proto::EditDraftChunkRequest>,
    ) -> std::result::Result<tonic::Response<proto::EditDraftChunkResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: edit_draft_chunk",
        ))
    }

    async fn undo_draft_chunk(
        &self,
        request: tonic::Request<proto::UndoDraftChunkRequest>,
    ) -> std::result::Result<tonic::Response<proto::UndoDraftChunkResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: undo_draft_chunk",
        ))
    }

    async fn clear_draft_chunks(
        &self,
        request: tonic::Request<proto::ClearDraftChunksRequest>,
    ) -> std::result::Result<tonic::Response<proto::ClearDraftChunksResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: clear_draft_chunks",
        ))
    }

    async fn get_draft_history(
        &self,
        request: tonic::Request<proto::GetDraftHistoryRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetDraftHistoryResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_draft_history",
        ))
    }

    async fn issue_sandbox_token(
        &self,
        request: tonic::Request<proto::IssueSandboxTokenRequest>,
    ) -> std::result::Result<tonic::Response<proto::IssueSandboxTokenResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: issue_sandbox_token",
        ))
    }

    async fn refresh_sandbox_token(
        &self,
        request: tonic::Request<proto::RefreshSandboxTokenRequest>,
    ) -> std::result::Result<tonic::Response<proto::RefreshSandboxTokenResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: refresh_sandbox_token",
        ))
    }

    async fn create_workspace(
        &self,
        request: tonic::Request<proto::CreateWorkspaceRequest>,
    ) -> std::result::Result<tonic::Response<proto::CreateWorkspaceResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: create_workspace",
        ))
    }

    async fn get_workspace(
        &self,
        request: tonic::Request<proto::GetWorkspaceRequest>,
    ) -> std::result::Result<tonic::Response<proto::GetWorkspaceResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented("stub-gateway: get_workspace"))
    }

    async fn list_workspaces(
        &self,
        request: tonic::Request<proto::ListWorkspacesRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListWorkspacesResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: list_workspaces",
        ))
    }

    async fn delete_workspace(
        &self,
        request: tonic::Request<proto::DeleteWorkspaceRequest>,
    ) -> std::result::Result<tonic::Response<proto::DeleteWorkspaceResponse>, tonic::Status> {
        Err(tonic::Status::unimplemented(
            "stub-gateway: delete_workspace",
        ))
    }

    async fn add_workspace_member(
        &self,
        request: tonic::Request<proto::AddWorkspaceMemberRequest>,
    ) -> std::result::Result<tonic::Response<proto::AddWorkspaceMemberResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: add_workspace_member",
        ))
    }

    async fn remove_workspace_member(
        &self,
        request: tonic::Request<proto::RemoveWorkspaceMemberRequest>,
    ) -> std::result::Result<tonic::Response<proto::RemoveWorkspaceMemberResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: remove_workspace_member",
        ))
    }

    async fn list_workspace_members(
        &self,
        request: tonic::Request<proto::ListWorkspaceMembersRequest>,
    ) -> std::result::Result<tonic::Response<proto::ListWorkspaceMembersResponse>, tonic::Status>
    {
        Err(tonic::Status::unimplemented(
            "stub-gateway: list_workspace_members",
        ))
    }
}
