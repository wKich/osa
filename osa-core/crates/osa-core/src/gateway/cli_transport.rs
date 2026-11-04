//! The CLI transport: the same covered operations, performed by `openshell`.
//!
//! This is not the default. It exists for two reasons the design names: it is
//! the rollback path (re-pointing the trait at the CLI is a one-line selector,
//! not a code change), and it lets the conformance suite run one case set over
//! each transport so `transport-changed` is measured rather than assumed.
//!
//! Everything here spawns `openshell`; the typed client is [`super::sdk`]. The
//! selector is an explicit environment choice, never an automatic fallback: a
//! gateway failure must not silently change which transport a command used.

use std::process::Stdio;
use std::time::Duration;

use super::cli::Cli;
use super::error::GatewayError;
use super::{
    ChunkSink, Endpoint, ExecInput, ExecOutput, ExecRequest, ExitStatus, Gateway, InteractiveExec,
    LogOptions, ProviderSpec, Rule, RuleListing, Sandbox, SandboxSpec,
};

/// The covered operations, over the OpenShell CLI.
pub struct CliGateway {
    cli: Cli,
    endpoint: Endpoint,
}

impl CliGateway {
    pub fn new(endpoint: Endpoint) -> Self {
        CliGateway {
            cli: Cli::new("openshell"),
            endpoint,
        }
    }

    fn gateway(&self) -> Option<&str> {
        Some(self.endpoint.gateway.as_str()).filter(|name| !name.is_empty())
    }

    fn run(&self, args: &[&str]) -> Result<std::process::Output, GatewayError> {
        self.cli
            .command(self.gateway(), args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| GatewayError::MissingCli {
                program: format!("openshell ({error})"),
            })
    }

    fn failed(operation: &'static str, output: &std::process::Output) -> GatewayError {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if detail.is_empty() {
            format!("exit status {}", crate::process::exit_code(output.status))
        } else {
            detail
        };
        GatewayError::Failed { operation, detail }
    }

    fn status_only(&self, args: &[&str], operation: &'static str) -> Result<(), GatewayError> {
        let output = self.run(args)?;
        if output.status.success() {
            Ok(())
        } else {
            Err(Self::failed(operation, &output))
        }
    }
}

#[async_trait::async_trait]
impl Gateway for CliGateway {
    fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    async fn health(&self) -> Result<(), GatewayError> {
        self.status_only(&["status", "--output", "json"], "gateway health")
    }

    async fn list_sandboxes(&self) -> Result<Vec<Sandbox>, GatewayError> {
        let output = self.run(&["sandbox", "list", "--output", "json"])?;
        if !output.status.success() {
            return Err(Self::failed("sandbox list", &output));
        }
        super::sandboxes(&String::from_utf8_lossy(&output.stdout)).map_err(|error| {
            GatewayError::Failed {
                operation: "sandbox list",
                detail: error.to_string(),
            }
        })
    }

    async fn get_sandbox(&self, name: &str) -> Result<Option<Sandbox>, GatewayError> {
        let output = self.run(&["sandbox", "get", name, "--output", "json"])?;
        if !output.status.success() {
            if String::from_utf8_lossy(&output.stderr).contains("not found") {
                return Ok(None);
            }
            return Err(Self::failed("sandbox get", &output));
        }
        serde_json::from_str::<Sandbox>(&String::from_utf8_lossy(&output.stdout))
            .map(Some)
            .map_err(|error| GatewayError::Failed {
                operation: "sandbox get",
                detail: format!("response is not the documented JSON: {error}"),
            })
    }

    async fn create_sandbox(&self, spec: SandboxSpec) -> Result<Sandbox, GatewayError> {
        let mut args: Vec<String> = vec![
            "sandbox".into(),
            "create".into(),
            "--name".into(),
            spec.name.clone(),
            "--from".into(),
            spec.image.clone(),
            "--detach".into(),
        ];
        if let Some(policy) = spec.policy.as_ref().filter(|value| !value.is_empty()) {
            args.push("--policy".into());
            args.push(policy.clone());
        }
        if let Some(cpu) = spec.cpu.as_ref().filter(|value| !value.is_empty()) {
            args.push("--cpu".into());
            args.push(cpu.clone());
        }
        if let Some(memory) = spec.memory.as_ref().filter(|value| !value.is_empty()) {
            args.push("--memory".into());
            args.push(memory.clone());
        }
        for provider in spec.providers.iter().filter(|value| !value.is_empty()) {
            args.push("--provider".into());
            args.push(provider.clone());
        }
        for pair in spec.env.iter().filter(|value| !value.is_empty()) {
            args.push("--env".into());
            args.push(pair.clone());
        }
        for pair in spec.env_from.iter().filter(|value| !value.is_empty()) {
            args.push("--env-from".into());
            args.push(pair.clone());
        }
        let words: Vec<&str> = args.iter().map(String::as_str).collect();
        let output = self.run(&words)?;
        if !output.status.success() {
            if String::from_utf8_lossy(&output.stderr).contains("already exists") {
                return Err(GatewayError::AlreadyExists { sandbox: spec.name });
            }
            return Err(Self::failed("sandbox create", &output));
        }
        self.get_sandbox(&spec.name)
            .await?
            .ok_or(GatewayError::NotFound { sandbox: spec.name })
    }

    async fn start_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError> {
        self.status_only(&["sandbox", "start", name], "sandbox start")?;
        self.get_sandbox(name)
            .await?
            .ok_or_else(|| GatewayError::NotFound {
                sandbox: name.to_string(),
            })
    }

    async fn stop_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError> {
        self.status_only(&["sandbox", "stop", name], "sandbox stop")?;
        self.get_sandbox(name)
            .await?
            .ok_or_else(|| GatewayError::NotFound {
                sandbox: name.to_string(),
            })
    }

    async fn delete_sandbox(&self, name: &str) -> Result<Option<String>, GatewayError> {
        let id = self.get_sandbox(name).await?.and_then(|sandbox| sandbox.id);
        self.status_only(&["sandbox", "delete", name], "sandbox delete")?;
        Ok(id)
    }

    async fn wait_ready(&self, name: &str, timeout: Duration) -> Result<Sandbox, GatewayError> {
        let started = std::time::Instant::now();
        loop {
            let found = self
                .get_sandbox(name)
                .await?
                .ok_or_else(|| GatewayError::Failed {
                    operation: "sandbox wait",
                    detail: format!("sandbox '{name}' disappeared while waiting for readiness"),
                })?;
            match found.phase.as_deref() {
                Some("Ready") => return Ok(found),
                Some("Starting") | Some("Provisioning") | Some("Unknown") => {}
                Some(other) => {
                    return Err(GatewayError::Failed {
                        operation: "sandbox wait",
                        detail: format!(
                            "sandbox '{name}' is in phase '{other}'; run status and logs to investigate"
                        ),
                    })
                }
                None => {
                    return Err(GatewayError::Failed {
                        operation: "sandbox wait",
                        detail: format!("sandbox '{name}' reported no phase"),
                    })
                }
            }
            if started.elapsed() >= timeout {
                return Err(GatewayError::Timeout {
                    sandbox: name.to_string(),
                    phase: found.phase.unwrap_or_else(|| "Unknown".to_string()),
                    seconds: timeout.as_secs(),
                });
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    async fn wait_deleted(&self, name: &str, timeout: Duration) -> Result<(), GatewayError> {
        let started = std::time::Instant::now();
        while self.get_sandbox(name).await?.is_some() {
            if started.elapsed() >= timeout {
                return Err(GatewayError::Timeout {
                    sandbox: name.to_string(),
                    phase: "Deleting".to_string(),
                    seconds: timeout.as_secs(),
                });
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        Ok(())
    }

    async fn exec(
        &self,
        request: ExecRequest,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, GatewayError> {
        let mut args: Vec<String> = vec![
            "sandbox".into(),
            "exec".into(),
            "-n".into(),
            request.sandbox.clone(),
        ];
        if request.no_login_shell {
            args.push("--no-login-shell".into());
        }
        if let Some(workdir) = request.workdir.as_ref().filter(|value| !value.is_empty()) {
            args.push("--workdir".into());
            args.push(workdir.clone());
        }
        args.push("--".into());
        args.extend(request.command.iter().cloned());
        let words: Vec<&str> = args.iter().map(String::as_str).collect();
        let output = self.run(&words)?;
        sink.write(&output.stdout);
        if !output.stderr.is_empty() {
            sink.write(&output.stderr);
        }
        Ok(ExitStatus {
            code: crate::process::exit_code(output.status),
        })
    }

    async fn exec_buffered(&self, request: ExecRequest) -> Result<ExecOutput, GatewayError> {
        let mut stdout = Vec::new();
        let status = self.exec(request, &mut stdout).await?;
        // The CLI path does not separate the streams in this capture; the
        // buffered probes read stdout only, and stderr is already merged by
        // the caller's fork in the default transport.
        Ok(ExecOutput {
            exit_code: status.code,
            stdout,
            stderr: Vec::new(),
        })
    }

    async fn exec_interactive(
        &self,
        exec: InteractiveExec,
        input: tokio::sync::mpsc::Receiver<ExecInput>,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, GatewayError> {
        use std::io::Write;
        let request = exec.request;
        let mut args: Vec<String> = vec![
            "sandbox".into(),
            "exec".into(),
            "-n".into(),
            request.sandbox.clone(),
        ];
        if exec.tty {
            args.push("--tty".into());
        } else {
            args.push("--no-login-shell".into());
        }
        if let Some(workdir) = request.workdir.as_ref().filter(|value| !value.is_empty()) {
            args.push("--workdir".into());
            args.push(workdir.clone());
        }
        for (key, value) in &exec.env {
            args.push("--env".into());
            args.push(format!("{key}={value}"));
        }
        args.push("--".into());
        args.extend(request.command.iter().cloned());
        let words: Vec<&str> = args.iter().map(String::as_str).collect();
        let mut child = self
            .cli
            .command(self.gateway(), &words)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GatewayError::MissingCli {
                program: format!("openshell ({error})"),
            })?;
        let mut child_stdin = child.stdin.take();
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let (chunks, mut receiver) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let mut readers = Vec::new();
        if let Some(pipe) = stdout.take() {
            let chunks = chunks.clone();
            readers.push(std::thread::spawn(move || pump(pipe, chunks)));
        }
        if let Some(pipe) = stderr.take() {
            let chunks = chunks.clone();
            readers.push(std::thread::spawn(move || pump(pipe, chunks)));
        }
        let initial_stdin = request.stdin.clone().unwrap_or_default();
        let writer = child_stdin.take().map(|mut pipe| {
            std::thread::spawn(move || {
                let mut input = input;
                if !initial_stdin.is_empty() {
                    let _ = pipe.write_all(&initial_stdin);
                    let _ = pipe.flush();
                }
                while let Some(frame) = input.blocking_recv() {
                    match frame {
                        ExecInput::Stdin(bytes) => {
                            if pipe.write_all(&bytes).is_err() {
                                break;
                            }
                            let _ = pipe.flush();
                        }
                        ExecInput::Resize { .. } => {
                            // The child has no terminal of its own here; the
                            // gateway owns the remote PTY.
                        }
                    }
                }
            })
        });
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        let status;
        loop {
            if exec
                .interrupt
                .as_ref()
                .is_some_and(|flag| flag.load(std::sync::atomic::Ordering::Relaxed))
            {
                let _ = child.kill();
            }
            if let Some(code) = child.try_wait().ok().flatten() {
                status = Some(crate::process::exit_code(code));
                break;
            }
            tokio::select! {
                Some(bytes) = receiver.recv() => sink.write(&bytes),
                _ = tick.tick() => {}
            }
        }
        // Drain what the pipes still hold for this run.
        while let Ok(bytes) = receiver.try_recv() {
            sink.write(&bytes);
        }
        drop(writer);
        for reader in readers {
            let _ = reader.join();
        }
        while let Ok(bytes) = receiver.try_recv() {
            sink.write(&bytes);
        }
        if let Some(flag) = exec.interrupt.as_ref() {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                return Ok(ExitStatus { code: 130 });
            }
        }
        Ok(ExitStatus {
            code: status.unwrap_or(-1),
        })
    }

    async fn logs(
        &self,
        sandbox: &str,
        options: LogOptions,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<(), GatewayError> {
        let mut args: Vec<String> = vec!["logs".into(), sandbox.to_string()];
        if options.follow {
            args.push("--tail".into());
        }
        if let Some(since) = options.since.as_ref().filter(|value| !value.is_empty()) {
            args.push("--since".into());
            args.push(since.clone());
        }
        for source in options.sources.iter().filter(|value| !value.is_empty()) {
            args.push("--source".into());
            args.push(source.clone());
        }
        if let Some(level) = options.level.as_ref().filter(|value| !value.is_empty()) {
            args.push("--level".into());
            args.push(level.clone());
        }
        args.push("-n".into());
        args.push(options.lines.to_string());
        let words: Vec<&str> = args.iter().map(String::as_str).collect();
        let output = self.run(&words)?;
        if !output.status.success() {
            return Err(Self::failed("sandbox logs", &output));
        }
        sink.write(&output.stdout);
        Ok(())
    }

    async fn list_providers(&self) -> Result<Vec<String>, GatewayError> {
        let output = self.run(&["provider", "list", "--names"])?;
        if !output.status.success() {
            return Err(Self::failed("provider list", &output));
        }
        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect())
    }

    async fn create_provider(&self, spec: ProviderSpec) -> Result<(), GatewayError> {
        let mut args: Vec<String> = vec![
            "provider".into(),
            "create".into(),
            "--name".into(),
            spec.name.clone(),
            "--type".into(),
            spec.profile.clone(),
        ];
        if spec.from_existing {
            args.push("--from-existing".into());
        }
        if spec.runtime_credentials {
            args.push("--runtime-credentials".into());
        }
        if spec.global_profile {
            args.push("--global-profile".into());
        }
        let key = spec
            .credential_key
            .clone()
            .or_else(|| spec.credential_keys.first().cloned());
        if spec.credential.is_some() {
            if let Some(key) = key.as_ref() {
                args.push("--credential".into());
                args.push(key.clone());
            }
        }
        for named in spec.credential_keys.iter().filter(|key| !key.is_empty()) {
            args.push("--credential".into());
            args.push(named.clone());
        }
        for (config_key, config_value) in spec.config.iter().filter(|(key, _)| !key.is_empty()) {
            args.push("--config".into());
            args.push(format!("{config_key}={config_value}"));
        }
        let words: Vec<&str> = args.iter().map(String::as_str).collect();
        let mut command = self.cli.command(self.gateway(), &words);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // The CLI's existing-credential mode reads the value from the child
        // environment; this is that transport's one designated channel.
        if let (Some(key), Some(credential)) = (key.as_ref(), spec.credential.as_ref()) {
            command.env(key, credential.expose());
        }
        let output = command.output().map_err(|error| GatewayError::MissingCli {
            program: format!("openshell ({error})"),
        })?;
        if output.status.success() {
            Ok(())
        } else {
            Err(Self::failed("provider create", &output))
        }
    }

    async fn attached_providers(&self, sandbox: &str) -> Result<Vec<String>, GatewayError> {
        let output = self.run(&["sandbox", "provider", "list", sandbox, "--output", "json"])?;
        if !output.status.success() {
            return Err(Self::failed("sandbox provider list", &output));
        }
        super::providers(&String::from_utf8_lossy(&output.stdout)).map_err(|error| {
            GatewayError::Failed {
                operation: "sandbox provider list",
                detail: error.to_string(),
            }
        })
    }

    async fn attach_provider(&self, sandbox: &str, provider: &str) -> Result<(), GatewayError> {
        self.status_only(
            &["sandbox", "provider", "attach", sandbox, provider],
            "sandbox provider attach",
        )
    }

    async fn detach_provider(&self, sandbox: &str, provider: &str) -> Result<(), GatewayError> {
        self.status_only(
            &["sandbox", "provider", "detach", sandbox, provider],
            "sandbox provider detach",
        )
    }

    async fn get_rule(
        &self,
        sandbox: &str,
        name: &str,
        pending_only: bool,
    ) -> Result<Option<Rule>, GatewayError> {
        Ok(self
            .list_rules(sandbox)
            .await?
            .rules
            .into_iter()
            .find(|rule| {
                rule.name == name && (!pending_only || rule.status.as_deref() == Some("pending"))
            }))
    }

    async fn list_rules(&self, sandbox: &str) -> Result<RuleListing, GatewayError> {
        let output = self.run(&["rule", "get", sandbox, "--status", "pending"])?;
        if !output.status.success() {
            return Err(Self::failed("rule list", &output));
        }
        Ok(parse_rules(&String::from_utf8_lossy(&output.stdout)))
    }

    async fn approve_rule(&self, sandbox: &str, chunk: &str) -> Result<(), GatewayError> {
        self.status_only(
            &["rule", "approve", sandbox, "--chunk-id", chunk],
            "rule approve",
        )
    }

    async fn reject_rule(
        &self,
        sandbox: &str,
        chunk: &str,
        reason: &str,
    ) -> Result<(), GatewayError> {
        self.status_only(
            &[
                "rule",
                "reject",
                sandbox,
                "--chunk-id",
                chunk,
                "--reason",
                reason,
            ],
            "rule reject",
        )
    }
}

/// The CLI's `rule get` text, read into the same shape the client returns.
fn parse_rules(text: &str) -> RuleListing {
    let mut version = 1u64;
    let mut rules = Vec::new();
    let mut current: Option<Rule> = None;
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Network Rules:") {
            if let Some(found) = rest.split_once("version ").map(|(_, tail)| tail) {
                let digits: String = found.chars().take_while(char::is_ascii_digit).collect();
                if let Ok(parsed) = digits.parse() {
                    version = parsed;
                }
            }
        } else if let Some(chunk) = line.strip_prefix("Chunk: ") {
            if let Some(rule) = current.take() {
                rules.push(rule);
            }
            current = Some(Rule {
                name: chunk.to_string(),
                status: None,
                chunk_id: Some(chunk.to_string()),
                binary: None,
                endpoints: Vec::new(),
                verdict: None,
            });
        } else if let Some(status) = line.strip_prefix("Status: ") {
            if let Some(rule) = current.as_mut() {
                rule.status = Some(status.to_string());
            }
        } else if let Some(name) = line.strip_prefix("Rule: ") {
            if let Some(rule) = current.as_mut() {
                rule.name = name.to_string();
            }
        } else if let Some(binary) = line.strip_prefix("Binary: ") {
            if let Some(rule) = current.as_mut() {
                rule.binary = Some(binary.to_string());
            }
        } else if let Some(endpoints) = line.strip_prefix("Endpoints: ") {
            if let Some(rule) = current.as_mut() {
                rule.endpoints = endpoints
                    .split(",")
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect();
            }
        } else if let Some(verdict) = line.strip_prefix("Prover: ") {
            if let Some(rule) = current.as_mut() {
                rule.verdict = Some(verdict.to_string());
            }
        }
    }
    if let Some(rule) = current {
        rules.push(rule);
    }
    RuleListing { version, rules }
}

/// Read one child pipe into the chunk channel as bytes arrive.
fn pump(mut pipe: impl std::io::Read, chunks: tokio::sync::mpsc::Sender<Vec<u8>>) {
    let mut buffer = [0u8; 4096];
    loop {
        match pipe.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                if chunks.blocking_send(buffer[..read].to_vec()).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}
