//! The recording transport: test builds only.
//!
//! [`RecordingGateway`] wraps any [`Gateway`], forwards every call unchanged,
//! and writes a normalized transcript of each request to a directory the
//! constructor is given. It is compiled only under the `test-support` feature,
//! so a shipped binary cannot construct one, and the type itself reads no
//! environment variable. The opt-in lives in the test-support client wrapper
//! ([`super::transcript_dir`]), which passes the directory explicitly; a release
//! build has neither the wrapper nor this type.
//!
//! Normalization keeps only what identifies the request — the operation, the
//! target, and the non-secret fields, sorted by name. No credential value is
//! ever written: a credential records as [`super::credential::REDACTED`], and
//! an environment pair records by name only, matching the CLI-transport rule.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::credential::REDACTED;
use super::error::GatewayError;
use super::{
    ChunkSink, Credential, Endpoint, ExecInput, ExecOutput, ExecRequest, ExitStatus, Gateway,
    InteractiveExec, LogOptions, ProviderSpec, Rule, RuleListing, Sandbox, SandboxSpec,
};

/// One recorded request: what operation ran, on what, with which non-secret
/// fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub operation: &'static str,
    pub target: String,
    fields: Vec<(&'static str, String)>,
}

impl Entry {
    pub fn new(operation: &'static str, target: impl Into<String>) -> Self {
        Entry {
            operation,
            target: target.into(),
            fields: Vec::new(),
        }
    }

    pub fn field(mut self, key: &'static str, value: impl Into<String>) -> Self {
        self.fields.push((key, value.into()));
        self
    }

    /// The variable names of a `KEY=value` pair, never its value.
    pub fn env_names(mut self, key: &'static str, pairs: &[String]) -> Self {
        let names: Vec<String> = pairs
            .iter()
            .map(|pair| {
                pair.split_once('=')
                    .map(|(name, _)| name.to_string())
                    .unwrap_or_else(|| pair.clone())
            })
            .collect();
        self.fields.push((key, names.join(",")));
        self
    }

    /// The transcript line: operation, target, then fields sorted by name so
    /// two runs of one case are byte-identical.
    pub fn normalize(&self) -> String {
        let mut fields = self.fields.clone();
        fields.sort();
        let mut line = format!("op={}\ntarget={}\n", self.operation, self.target);
        for (key, value) in fields {
            line.push_str(&format!("{key}={value}\n"));
        }
        line
    }
}

/// A forwarding transport that records what it forwarded.
pub struct RecordingGateway {
    inner: Arc<dyn Gateway>,
    dir: PathBuf,
    sequence: AtomicUsize,
    /// One `<dir>/operations.log` for the whole process, appended under
    /// O_APPEND so a second recorder process (the idle watcher) lands after the
    /// first instead of overwriting its files.
    appended: bool,
}

impl RecordingGateway {
    /// Record one file per request into `dir`, which the caller owns and
    /// deletes. Nothing is read from the environment: an explicit directory is
    /// the only way in.
    pub fn new(inner: Arc<dyn Gateway>, dir: impl AsRef<Path>) -> Self {
        RecordingGateway {
            inner,
            dir: dir.as_ref().to_path_buf(),
            sequence: AtomicUsize::new(0),
            appended: false,
        }
    }

    /// Record every request into one append-only `operations.log` in `dir`.
    /// The file is the transcript of a whole case, including calls made by a
    /// second process such as the idle watcher.
    pub fn appending(inner: Arc<dyn Gateway>, dir: impl AsRef<Path>) -> Self {
        RecordingGateway {
            appended: true,
            ..RecordingGateway::new(inner, dir)
        }
    }

    /// The directory transcripts are written to.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn record(&self, entry: Entry) {
        // A transcript is a test artifact; a write failure must not look like a
        // gateway failure, so it is surfaced as a panic in the test process.
        let _ = fs::create_dir_all(&self.dir);
        if self.appended {
            use std::io::Write;
            let path = self.dir.join("operations.log");
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .expect("transcript opened");
            // One write per entry, separated by a blank line, so two recorder
            // processes append whole blocks instead of interleaving lines.
            file.write_all(format!("{}\n", entry.normalize()).as_bytes())
                .expect("transcript written");
            return;
        }
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let name = format!("{sequence:04}-{}.log", entry.operation);
        let path = self.dir.join(name);
        fs::write(&path, entry.normalize()).expect("transcript written");
    }
}

fn credential_field(credential: &Option<Credential>) -> String {
    if credential.is_some() {
        REDACTED.to_string()
    } else {
        String::new()
    }
}

#[async_trait::async_trait]
impl Gateway for RecordingGateway {
    fn endpoint(&self) -> &Endpoint {
        self.inner.endpoint()
    }

    async fn health(&self) -> Result<(), GatewayError> {
        self.record(Entry::new("health", self.inner.endpoint().gateway.clone()));
        self.inner.health().await
    }

    async fn list_sandboxes(&self) -> Result<Vec<Sandbox>, GatewayError> {
        self.record(Entry::new(
            "list_sandboxes",
            self.inner.endpoint().gateway.clone(),
        ));
        self.inner.list_sandboxes().await
    }

    async fn get_sandbox(&self, name: &str) -> Result<Option<Sandbox>, GatewayError> {
        self.record(Entry::new("get_sandbox", name));
        self.inner.get_sandbox(name).await
    }

    async fn create_sandbox(&self, spec: SandboxSpec) -> Result<Sandbox, GatewayError> {
        let entry = Entry::new("create_sandbox", spec.name.clone())
            .field("image", spec.image.clone())
            .field("policy", spec.policy.clone().unwrap_or_default())
            .field("cpu", spec.cpu.clone().unwrap_or_default())
            .field("memory", spec.memory.clone().unwrap_or_default())
            .field("providers", spec.providers.join(","))
            .env_names("env", &spec.env)
            .env_names("env_from", &spec.env_from);
        self.record(entry);
        self.inner.create_sandbox(spec).await
    }

    async fn start_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError> {
        self.record(Entry::new("start_sandbox", name));
        self.inner.start_sandbox(name).await
    }

    async fn stop_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError> {
        self.record(Entry::new("stop_sandbox", name));
        self.inner.stop_sandbox(name).await
    }

    async fn delete_sandbox(&self, name: &str) -> Result<Option<String>, GatewayError> {
        self.record(Entry::new("delete_sandbox", name));
        self.inner.delete_sandbox(name).await
    }

    async fn wait_ready(&self, name: &str, timeout: Duration) -> Result<Sandbox, GatewayError> {
        self.record(Entry::new("wait_ready", name).field("timeout", timeout.as_secs().to_string()));
        self.inner.wait_ready(name, timeout).await
    }

    async fn wait_deleted(&self, name: &str, timeout: Duration) -> Result<(), GatewayError> {
        self.record(
            Entry::new("wait_deleted", name).field("timeout", timeout.as_secs().to_string()),
        );
        self.inner.wait_deleted(name, timeout).await
    }

    async fn exec(
        &self,
        request: ExecRequest,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, GatewayError> {
        let entry = Entry::new("exec", request.sandbox.clone())
            .field("command", request.command.join(" "))
            .field("workdir", request.workdir.clone().unwrap_or_default())
            .field("no_login_shell", request.no_login_shell.to_string())
            .field("stdin", request.stdin.is_some().to_string());
        self.record(entry);
        self.inner.exec(request, sink).await
    }

    async fn exec_buffered(&self, request: ExecRequest) -> Result<ExecOutput, GatewayError> {
        let entry = Entry::new("exec_buffered", request.sandbox.clone())
            .field("command", request.command.join(" "))
            .field("workdir", request.workdir.clone().unwrap_or_default())
            .field("no_login_shell", request.no_login_shell.to_string());
        self.record(entry);
        self.inner.exec_buffered(request).await
    }

    async fn exec_interactive(
        &self,
        exec: InteractiveExec,
        input: tokio::sync::mpsc::Receiver<ExecInput>,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, GatewayError> {
        let entry = Entry::new("exec_interactive", exec.request.sandbox.clone())
            .field("command", exec.request.command.join(" "))
            .field("workdir", exec.request.workdir.clone().unwrap_or_default())
            .field("no_login_shell", exec.request.no_login_shell.to_string())
            .field("tty", exec.tty.to_string())
            .field("size", format!("{:?}", exec.size))
            .field(
                "env",
                exec.env
                    .iter()
                    .map(|(key, _)| key.clone())
                    .collect::<Vec<_>>()
                    .join(","),
            );
        self.record(entry);
        self.inner.exec_interactive(exec, input, sink).await
    }

    async fn logs(
        &self,
        sandbox: &str,
        options: LogOptions,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<(), GatewayError> {
        self.record(
            Entry::new("logs", sandbox)
                .field("follow", options.follow.to_string())
                .field("lines", options.lines.to_string())
                .field("since", options.since.clone().unwrap_or_default())
                .field("sources", options.sources.join(","))
                .field("level", options.level.clone().unwrap_or_default()),
        );
        self.inner.logs(sandbox, options, sink).await
    }

    async fn list_providers(&self) -> Result<Vec<String>, GatewayError> {
        self.record(Entry::new(
            "list_providers",
            self.inner.endpoint().gateway.clone(),
        ));
        self.inner.list_providers().await
    }

    async fn create_provider(&self, spec: ProviderSpec) -> Result<(), GatewayError> {
        let entry = Entry::new("create_provider", spec.name.clone())
            .field("profile", spec.profile.clone())
            .field("credential", credential_field(&spec.credential))
            .field(
                "credential_key",
                spec.credential_key.clone().unwrap_or_default(),
            );
        self.record(entry);
        self.inner.create_provider(spec).await
    }

    async fn attached_providers(&self, sandbox: &str) -> Result<Vec<String>, GatewayError> {
        self.record(Entry::new("attached_providers", sandbox));
        self.inner.attached_providers(sandbox).await
    }

    async fn attach_provider(&self, sandbox: &str, provider: &str) -> Result<(), GatewayError> {
        self.record(Entry::new("attach_provider", sandbox).field("provider", provider));
        self.inner.attach_provider(sandbox, provider).await
    }

    async fn detach_provider(&self, sandbox: &str, provider: &str) -> Result<(), GatewayError> {
        self.record(Entry::new("detach_provider", sandbox).field("provider", provider));
        self.inner.detach_provider(sandbox, provider).await
    }

    async fn get_rule(
        &self,
        sandbox: &str,
        name: &str,
        pending_only: bool,
    ) -> Result<Option<Rule>, GatewayError> {
        self.record(
            Entry::new("get_rule", sandbox)
                .field("name", name)
                .field("pending_only", pending_only.to_string()),
        );
        self.inner.get_rule(sandbox, name, pending_only).await
    }

    async fn list_rules(&self, sandbox: &str) -> Result<RuleListing, GatewayError> {
        self.record(Entry::new("list_rules", sandbox));
        self.inner.list_rules(sandbox).await
    }

    async fn approve_rule(&self, sandbox: &str, chunk: &str) -> Result<(), GatewayError> {
        self.record(Entry::new("approve_rule", sandbox).field("chunk_id", chunk));
        self.inner.approve_rule(sandbox, chunk).await
    }

    async fn reject_rule(
        &self,
        sandbox: &str,
        chunk: &str,
        reason: &str,
    ) -> Result<(), GatewayError> {
        self.record(
            Entry::new("reject_rule", sandbox)
                .field("chunk_id", chunk)
                .field("reason", reason),
        );
        self.inner.reject_rule(sandbox, chunk, reason).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// A stand-in for the transport under test: no gateway, no process.
    #[derive(Default)]
    struct Stub {
        endpoint: Option<Endpoint>,
        execs: Mutex<usize>,
    }

    impl Stub {
        fn new() -> Arc<Stub> {
            Arc::new(Stub {
                endpoint: Some(Endpoint {
                    gateway: "local".to_string(),
                    server: "http://127.0.0.1:8080".to_string(),
                    auth: super::super::AuthMode::Plaintext,
                    version: "0.1.5".to_string(),
                }),
                execs: Mutex::new(0),
            })
        }
    }

    #[async_trait::async_trait]
    impl Gateway for Stub {
        fn endpoint(&self) -> &Endpoint {
            self.endpoint.as_ref().expect("endpoint")
        }
        async fn health(&self) -> Result<(), GatewayError> {
            Ok(())
        }
        async fn list_sandboxes(&self) -> Result<Vec<Sandbox>, GatewayError> {
            Ok(Vec::new())
        }
        async fn get_sandbox(&self, name: &str) -> Result<Option<Sandbox>, GatewayError> {
            Ok(Some(Sandbox {
                name: name.to_string(),
                id: Some("id".to_string()),
                phase: Some("Ready".to_string()),
                created_ms: 0,
            }))
        }
        async fn create_sandbox(&self, spec: SandboxSpec) -> Result<Sandbox, GatewayError> {
            Ok(Sandbox {
                name: spec.name,
                id: None,
                phase: Some("Starting".to_string()),
                created_ms: 0,
            })
        }
        async fn start_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError> {
            self.get_sandbox(name)
                .await
                .map(|sandbox| sandbox.expect("sandbox"))
        }
        async fn stop_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError> {
            self.get_sandbox(name)
                .await
                .map(|sandbox| sandbox.expect("sandbox"))
        }
        async fn delete_sandbox(&self, _name: &str) -> Result<Option<String>, GatewayError> {
            Ok(None)
        }
        async fn wait_ready(
            &self,
            name: &str,
            _timeout: Duration,
        ) -> Result<Sandbox, GatewayError> {
            self.get_sandbox(name)
                .await
                .map(|sandbox| sandbox.expect("sandbox"))
        }
        async fn wait_deleted(&self, _name: &str, _timeout: Duration) -> Result<(), GatewayError> {
            Ok(())
        }
        async fn exec(
            &self,
            _request: ExecRequest,
            sink: &mut (dyn ChunkSink + Send),
        ) -> Result<ExitStatus, GatewayError> {
            *self.execs.lock().expect("lock") += 1;
            sink.write(b"streamed\n");
            Ok(ExitStatus { code: 0 })
        }
        async fn exec_buffered(&self, _request: ExecRequest) -> Result<ExecOutput, GatewayError> {
            *self.execs.lock().expect("lock") += 1;
            Ok(ExecOutput {
                exit_code: 0,
                stdout: b"buffered\n".to_vec(),
                stderr: Vec::new(),
            })
        }
        async fn exec_interactive(
            &self,
            _exec: InteractiveExec,
            _input: tokio::sync::mpsc::Receiver<ExecInput>,
            sink: &mut (dyn ChunkSink + Send),
        ) -> Result<ExitStatus, GatewayError> {
            sink.write(b"interactive\n");
            Ok(ExitStatus { code: 0 })
        }
        async fn logs(
            &self,
            _sandbox: &str,
            _options: LogOptions,
            sink: &mut (dyn ChunkSink + Send),
        ) -> Result<(), GatewayError> {
            sink.write(b"log\n");
            Ok(())
        }
        async fn list_providers(&self) -> Result<Vec<String>, GatewayError> {
            Ok(vec!["maki-deepseek".to_string()])
        }
        async fn create_provider(&self, _spec: ProviderSpec) -> Result<(), GatewayError> {
            Ok(())
        }
        async fn attached_providers(&self, _sandbox: &str) -> Result<Vec<String>, GatewayError> {
            Ok(Vec::new())
        }
        async fn attach_provider(
            &self,
            _sandbox: &str,
            _provider: &str,
        ) -> Result<(), GatewayError> {
            Ok(())
        }
        async fn detach_provider(
            &self,
            _sandbox: &str,
            _provider: &str,
        ) -> Result<(), GatewayError> {
            Ok(())
        }
        async fn get_rule(
            &self,
            _sandbox: &str,
            _name: &str,
            _pending_only: bool,
        ) -> Result<Option<Rule>, GatewayError> {
            Ok(None)
        }
        async fn list_rules(&self, _sandbox: &str) -> Result<RuleListing, GatewayError> {
            Ok(RuleListing {
                version: 1,
                rules: Vec::new(),
            })
        }
        async fn approve_rule(&self, _sandbox: &str, _chunk: &str) -> Result<(), GatewayError> {
            Ok(())
        }
        async fn reject_rule(
            &self,
            _sandbox: &str,
            _chunk: &str,
            _reason: &str,
        ) -> Result<(), GatewayError> {
            Ok(())
        }
    }

    fn sandbox_spec() -> SandboxSpec {
        SandboxSpec {
            name: "demo".to_string(),
            image: "maki-agent:local".to_string(),
            policy: Some("/tmp/policy.yaml".to_string()),
            cpu: None,
            memory: None,
            providers: vec!["maki-deepseek".to_string()],
            env: vec!["SAFE=value".to_string()],
            env_from: vec!["SECRET_FROM_HOST".to_string()],
        }
    }

    fn run_case(dir: &Path) -> (Vec<String>, Vec<String>) {
        let recording = RecordingGateway::new(Stub::new(), dir);
        super::super::block_on(async {
            recording.health().await.expect("health");
            recording.list_sandboxes().await.expect("list");
            recording
                .create_sandbox(sandbox_spec())
                .await
                .expect("create");
            recording
                .exec_buffered(ExecRequest {
                    sandbox: "demo".to_string(),
                    command: vec!["sh".to_string(), "-c".to_string(), "true".to_string()],
                    workdir: Some("/sandbox".to_string()),
                    no_login_shell: true,
                    stdin: None,
                    timeout: None,
                })
                .await
                .expect("exec");
            recording
                .approve_rule("demo", "chunk-1")
                .await
                .expect("approve");
            recording
                .create_provider(ProviderSpec {
                    name: "maki-deepseek".to_string(),
                    profile: "maki-deepseek".to_string(),
                    from_existing: true,
                    global_profile: true,
                    runtime_credentials: false,
                    credential_keys: Vec::new(),
                    config: Vec::new(),
                    credential_key: Some("DEEPSEEK_API_KEY".to_string()),
                    credential: Some(Credential::new("sentinel-value")),
                })
                .await
                .expect("provider");
        });
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        let contents: Vec<String> = names
            .iter()
            .map(|name| fs::read_to_string(dir.join(name)).expect("read"))
            .collect();
        (names, contents)
    }

    fn transcript_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("osa-transcript-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn two_runs_of_one_case_produce_byte_identical_transcripts() {
        let first = transcript_dir("first");
        let second = transcript_dir("second");
        let (names_a, contents_a) = run_case(&first);
        let (names_b, contents_b) = run_case(&second);
        assert_eq!(names_a, names_b);
        assert_eq!(contents_a, contents_b);
        assert_eq!(names_a.len(), 6);
        assert!(names_a[0].ends_with("-health.log"), "{:?}", names_a);
        let _ = fs::remove_dir_all(&first);
        let _ = fs::remove_dir_all(&second);
    }

    #[test]
    fn a_transcript_names_the_operation_the_target_and_the_fields() {
        let dir = transcript_dir("fields");
        let (_, contents) = run_case(&dir);
        let create = contents
            .iter()
            .find(|text| text.contains("op=create_sandbox"))
            .expect("create transcript");
        assert!(create.contains("target=demo"), "{create}");
        assert!(create.contains("image=maki-agent:local"), "{create}");
        assert!(create.contains("providers=maki-deepseek"), "{create}");
        // Environment pairs record their names, never their values.
        assert!(create.contains("env=SAFE"), "{create}");
        assert!(!create.contains("value"), "{create}");
        assert!(create.contains("env_from=SECRET_FROM_HOST"), "{create}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_credential_records_as_the_redaction_token_only() {
        let dir = transcript_dir("credential");
        let (_, contents) = run_case(&dir);
        let provider = contents
            .iter()
            .find(|text| text.contains("op=create_provider"))
            .expect("provider transcript");
        assert!(
            provider.contains(&format!("credential={REDACTED}")),
            "{provider}"
        );
        for text in &contents {
            assert!(!text.contains("sentinel"), "{text}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_directory_is_the_only_destination_and_the_environment_is_ignored() {
        let dir = transcript_dir("explicit");
        let elsewhere = transcript_dir("elsewhere");
        std::env::set_var("OSA_GATEWAY_TRANSCRIPT", &elsewhere);
        let (names, _) = run_case(&dir);
        std::env::remove_var("OSA_GATEWAY_TRANSCRIPT");
        assert!(!names.is_empty());
        assert!(!elsewhere.exists(), "the environment named a directory");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_appending_mode_writes_one_ordered_log_for_the_whole_process() {
        let dir = transcript_dir("append");
        let recording = RecordingGateway::appending(Stub::new(), &dir);
        super::super::block_on(async {
            recording.health().await.expect("health");
            recording.list_sandboxes().await.expect("list");
        });
        let names: Vec<String> = fs::read_dir(&dir)
            .expect("dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["operations.log".to_string()]);
        let text = fs::read_to_string(dir.join("operations.log")).expect("log");
        let health = text.find("op=health").expect("health block");
        let list = text.find("op=list_sandboxes").expect("list block");
        assert!(health < list, "{text}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn one_approval_records_exactly_one_rule_write_for_one_chunk() {
        let dir = transcript_dir("approval");
        let (names, contents) = run_case(&dir);
        let writes: Vec<&String> = contents
            .iter()
            .filter(|text| text.contains("op=approve_rule"))
            .collect();
        assert_eq!(writes.len(), 1);
        assert!(writes[0].contains("chunk_id=chunk-1"), "{}", writes[0]);
        assert_eq!(names.len(), contents.len());
        let _ = fs::remove_dir_all(&dir);
    }
}
