//! The typed transport: every covered operation over `openshell-sdk`.
//!
//! The curated client covers health, sandbox lifecycle, waits, and buffered
//! exec. Providers, policy chunks, and streamed exec go through `raw_grpc`
//! with the generated protobuf types, which is the SDK's documented escape
//! hatch for the RPCs its curated surface does not wrap.
//!
//! Nothing here reads the CLI's gateway configuration: the endpoint arrives
//! from [`super::discover`], and a credential arrives as [`super::Credential`]
//! and is written to the one request field that carries it.

use std::collections::HashMap;
use std::time::Duration;

use openshell_sdk::raw::proto;
use openshell_sdk::{
    AuthConfig, ClientConfig, DeleteOptions, EdgeAuthInterceptor, ExecOptions, OpenShellClient,
    SdkError,
};
use tonic::transport::{Certificate, ClientTlsConfig, Endpoint as TonicEndpoint, Identity};

use super::error::GatewayError;
use super::tls::ClientIdentity;
use super::{
    AuthMode, ChunkSink, Endpoint, ExecInput, ExecOutput, ExecRequest, ExitStatus, Gateway,
    InteractiveExec, LogOptions, ProviderSpec, Rule, RuleListing, Sandbox, SandboxSpec,
};

/// How long a readiness or deletion wait polls between reads.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// The workspace every command in this repository targets.
const WORKSPACE: &str = "default";

/// A gateway connection and the endpoint it came from.
pub struct SdkGateway {
    client: OpenShellClient,
    endpoint: Endpoint,
}

impl SdkGateway {
    /// Connect to a resolved endpoint with no client certificate.
    pub async fn connect(endpoint: Endpoint) -> Result<Self, GatewayError> {
        Self::connect_with(endpoint, None).await
    }

    /// Connect to a resolved endpoint, presenting a client certificate when one
    /// is supplied.
    ///
    /// The client's own configuration cannot carry a client identity, so that
    /// case builds the channel here and hands it over through `from_parts`.
    /// Everything else about the connection is the same, including the
    /// timeouts and keep-alive settings the client's transport uses.
    pub async fn connect_with(
        endpoint: Endpoint,
        identity: Option<ClientIdentity>,
    ) -> Result<Self, GatewayError> {
        // An unsupported authentication mode is a discovery failure only when
        // nothing can express it: supplying a certificate is exactly the case
        // the mode describes.
        if identity.is_none() {
            endpoint.ensure_supported()?;
        }
        let mut config = ClientConfig::new(endpoint.server.clone());
        if endpoint.auth == AuthMode::Bearer {
            let token =
                std::env::var("OPENSHELL_TOKEN").map_err(|_| GatewayError::Unreachable {
                    endpoint: endpoint.gateway.clone(),
                    sources: "the bearer authentication mode".to_string(),
                    fix: "export OPENSHELL_TOKEN with the gateway's bearer token".to_string(),
                })?;
            config.auth = Some(AuthConfig::oidc(token));
        }
        let client = match identity {
            None => OpenShellClient::connect(config)
                .await
                .map_err(|error| Self::map(error, &endpoint, "connect"))?,
            Some(identity) => {
                let tls = ClientTlsConfig::new()
                    .ca_certificate(Certificate::from_pem(identity.ca))
                    .identity(Identity::from_pem(identity.cert, identity.key));
                let channel = TonicEndpoint::from_shared(endpoint.server.clone())
                    .map_err(|error| GatewayError::Failed {
                        operation: "connect",
                        detail: format!("invalid gateway URL: {error}"),
                    })?
                    .connect_timeout(Duration::from_secs(10))
                    .http2_adaptive_window(true)
                    .http2_keep_alive_interval(Duration::from_secs(10))
                    .keep_alive_while_idle(true)
                    .tls_config(tls)
                    .map_err(|error| GatewayError::Failed {
                        operation: "connect",
                        detail: format!("tls configuration rejected: {error}"),
                    })?
                    .connect()
                    .await
                    .map_err(|_| Self::unreachable(&endpoint, true))?;
                let interceptor = EdgeAuthInterceptor::new(None, None)
                    .map_err(|error| Self::map(error, &endpoint, "connect"))?;
                OpenShellClient::from_parts(channel, interceptor)
            }
        };
        Ok(SdkGateway { client, endpoint })
    }

    /// The failure a failed connection produces. Without a certificate the
    /// message names the one flag that would have made mTLS work, because
    /// discovery cannot see the mode and the gateway's own answer would
    /// otherwise read as a plain unreachable endpoint.
    fn unreachable(endpoint: &Endpoint, with_identity: bool) -> GatewayError {
        let fix = if with_identity {
            "check that the certificate and CA in --tls-dir chain to this gateway, and that it is running".to_string()
        } else {
            "start it with 'openshell status'; if that is not Connected, restart the gateway service; if the gateway requires client certificates, pass --tls-dir with its ca.crt, tls.crt, and tls.key".to_string()
        };
        GatewayError::Unreachable {
            endpoint: endpoint.gateway.clone(),
            sources: format!("the typed client at {}", endpoint.server),
            fix,
        }
    }

    /// The failure mapping: one place, and no gateway text in a branch
    /// condition anywhere else.
    fn map(error: SdkError, endpoint: &Endpoint, operation: &'static str) -> GatewayError {
        match error {
            SdkError::NotFound { message, .. } => GatewayError::NotFound { sandbox: message },
            SdkError::AlreadyExists { message, .. } => {
                GatewayError::AlreadyExists { sandbox: message }
            }
            SdkError::Auth { status, .. } => GatewayError::Unauthenticated {
                endpoint: endpoint.gateway.clone(),
                status: status.as_ref().map(|status| status.code() as u16).unwrap_or(401),
            },
            SdkError::Connect { .. } | SdkError::Io { .. } => Self::unreachable(endpoint, false),
            other => GatewayError::Failed {
                operation,
                detail: other.to_string(),
            },
        }
    }

    fn scope() -> Option<proto::WorkspaceSelector> {
        Some(proto::workspace_selector(WORKSPACE))
    }
}

fn sandbox(ref_: &openshell_sdk::SandboxRef) -> Sandbox {
    Sandbox {
        name: ref_.name.clone(),
        id: Some(ref_.id.clone()),
        phase: Some(phase_name(ref_.phase).to_string()),
        created_ms: 0,
    }
}

/// One listing row, as the protobuf carries it.
fn sandbox_of(raw: &proto::Sandbox) -> Sandbox {
    let metadata = raw.metadata.as_ref();
    Sandbox {
        name: metadata.map(|value| value.name.clone()).unwrap_or_default(),
        id: metadata
            .map(|value| value.id.clone())
            .filter(|id| !id.is_empty()),
        phase: raw
            .status
            .as_ref()
            .map(|status| proto_phase_name(status.phase).to_string()),
        created_ms: metadata
            .and_then(|value| value.created_time.as_ref())
            .map(|stamp| stamp.seconds.saturating_mul(1000) + i64::from(stamp.nanos) / 1_000_000)
            .unwrap_or(0),
    }
}

/// The CLI's phase wording, from the protobuf enum value.
fn proto_phase_name(phase: i32) -> &'static str {
    match proto::SandboxPhase::try_from(phase) {
        Ok(proto::SandboxPhase::Unspecified) => "Unspecified",
        Ok(proto::SandboxPhase::Provisioning) => "Provisioning",
        Ok(proto::SandboxPhase::Ready) => "Ready",
        Ok(proto::SandboxPhase::Error) => "Error",
        Ok(proto::SandboxPhase::Deleting) => "Deleting",
        Ok(proto::SandboxPhase::Stopping) => "Stopping",
        Ok(proto::SandboxPhase::Stopped) => "Stopped",
        Ok(proto::SandboxPhase::Starting) => "Starting",
        Ok(proto::SandboxPhase::Completed) => "Completed",
        Ok(proto::SandboxPhase::Suspending) => "Suspending",
        Ok(proto::SandboxPhase::Suspended) => "Suspended",
        Ok(proto::SandboxPhase::Unknown) | Err(_) => "Unknown",
    }
}

fn phase_name(phase: openshell_sdk::SandboxPhase) -> &'static str {
    use openshell_sdk::SandboxPhase;
    match phase {
        SandboxPhase::Provisioning => "Provisioning",
        SandboxPhase::Ready => "Ready",
        SandboxPhase::Error => "Error",
        SandboxPhase::Deleting => "Deleting",
        SandboxPhase::Stopping => "Stopping",
        SandboxPhase::Stopped => "Stopped",
        SandboxPhase::Starting => "Starting",
        SandboxPhase::Completed => "Completed",
        SandboxPhase::Suspending => "Suspending",
        SandboxPhase::Suspended => "Suspended",
        _ => "Unknown",
    }
}

fn rule_of(chunk: &proto::PolicyChunk) -> Rule {
    let endpoints = chunk
        .proposed_rule
        .iter()
        .flat_map(|rule| rule.endpoints.iter())
        .map(|endpoint| format!("{}:{}", endpoint.host, endpoint.port))
        .collect();
    Rule {
        name: if chunk.rule_name.is_empty() {
            chunk.id.clone()
        } else {
            chunk.rule_name.clone()
        },
        status: Some(chunk.status.clone()),
        chunk_id: Some(chunk.id.clone()),
        binary: (!chunk.binary.is_empty()).then(|| chunk.binary.clone()),
        endpoints,
        verdict: (!chunk.validation_result.is_empty()).then(|| chunk.validation_result.clone()),
    }
}

#[async_trait::async_trait]
impl Gateway for SdkGateway {
    fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    async fn health(&self) -> Result<(), GatewayError> {
        self.client
            .health()
            .await
            .map(|_| ())
            .map_err(|error| Self::map(error, &self.endpoint, "gateway health"))
    }

    async fn list_sandboxes(&self) -> Result<Vec<Sandbox>, GatewayError> {
        // The curated `list_all_sandboxes` returns `SandboxRef`, which carries no
        // creation time, and the listing renders one. The protobuf does carry
        // it, so this operation reads through `raw_grpc` like the policy paths.
        let response = self
            .client
            .raw_grpc()
            .list_sandboxes(proto::ListSandboxesRequest {
                workspace_scope: Self::scope(),
                ..Default::default()
            })
            .await
            .map_err(|status| GatewayError::Failed {
                operation: "sandbox list",
                detail: status.message().to_string(),
            })?
            .into_inner();
        Ok(response.sandboxes.iter().map(sandbox_of).collect())
    }

    async fn get_sandbox(&self, name: &str) -> Result<Option<Sandbox>, GatewayError> {
        match self.client.get_sandbox(name).await {
            Ok(found) => Ok(Some(sandbox(&found))),
            Err(SdkError::NotFound { .. }) => Ok(None),
            Err(error) => Err(Self::map(error, &self.endpoint, "sandbox get")),
        }
    }

    async fn create_sandbox(&self, spec: SandboxSpec) -> Result<Sandbox, GatewayError> {
        let mut environment = HashMap::new();
        for pair in &spec.env {
            if let Some((key, value)) = pair.split_once('=') {
                environment.insert(key.to_string(), value.to_string());
            }
        }
        for pair in &spec.env_from {
            if let Some((key, _)) = pair.split_once('=') {
                environment.insert(key.to_string(), String::new());
            }
        }
        let policy = match &spec.policy {
            Some(path) => Some(
                openshell_policy::parse_sandbox_policy_file(std::path::Path::new(path)).map_err(
                    |error| GatewayError::Failed {
                        operation: "sandbox create",
                        detail: format!("policy file '{path}': {error}"),
                    },
                )?,
            ),
            None => None,
        };
        let request = proto::CreateSandboxRequest {
            workspace_scope: Self::scope(),
            spec: Some(proto::SandboxSpec {
                environment,
                template: Some(proto::SandboxTemplate {
                    image: spec.image.clone(),
                    resources: resource_limits(spec.cpu.as_deref(), spec.memory.as_deref()),
                    ..Default::default()
                }),
                policy,
                providers: spec.providers.clone(),
                ..Default::default()
            }),
            name: spec.name.clone(),
            ..Default::default()
        };
        let response = self
            .client
            .raw_grpc()
            .create_sandbox(request)
            .await
            .map_err(|status| {
                if status.code() == tonic::Code::AlreadyExists {
                    GatewayError::AlreadyExists {
                        sandbox: spec.name.clone(),
                    }
                } else {
                    GatewayError::Failed {
                        operation: "sandbox create",
                        detail: status.message().to_string(),
                    }
                }
            })?
            .into_inner();
        let created = response.sandbox.ok_or_else(|| GatewayError::Failed {
            operation: "sandbox create",
            detail: "the gateway returned no sandbox".to_string(),
        })?;
        let name = created
            .metadata
            .as_ref()
            .map(|meta| meta.name.clone())
            .unwrap_or(spec.name);
        self.get_sandbox(&name)
            .await?
            .ok_or(GatewayError::NotFound { sandbox: name })
    }

    async fn start_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError> {
        let started = self
            .client
            .start_sandbox(name)
            .await
            .map_err(|error| Self::map(error, &self.endpoint, "sandbox start"))?;
        Ok(sandbox(&started))
    }

    async fn stop_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError> {
        let stopped = self
            .client
            .stop_sandbox(name)
            .await
            .map_err(|error| Self::map(error, &self.endpoint, "sandbox stop"))?;
        Ok(sandbox(&stopped))
    }

    async fn delete_sandbox(&self, name: &str) -> Result<Option<String>, GatewayError> {
        let deleted = self
            .client
            .delete_sandbox(
                name,
                DeleteOptions {
                    allow_missing: false,
                },
            )
            .await
            .map_err(|error| Self::map(error, &self.endpoint, "sandbox delete"))?;
        Ok(deleted.sandbox_id)
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
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    async fn wait_deleted(&self, name: &str, timeout: Duration) -> Result<(), GatewayError> {
        self.client
            .wait_deleted(name, timeout, None)
            .await
            .map(|_| ())
            .map_err(|error| match error {
                SdkError::NotFound { .. } => GatewayError::NotFound {
                    sandbox: name.to_string(),
                },
                other => Self::map(other, &self.endpoint, "sandbox delete wait"),
            })
    }

    async fn exec(
        &self,
        request: ExecRequest,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, GatewayError> {
        let sandbox = request.sandbox.clone();
        let mut stream = self
            .client
            .raw_grpc()
            .exec_sandbox(proto::ExecSandboxRequest {
                workspace_scope: Self::scope(),
                sandbox: sandbox.clone(),
                command: request.command.clone(),
                workdir: request.workdir.clone().unwrap_or_default(),
                execution_timeout: request.timeout.map(|timeout| prost_types::Duration {
                    seconds: timeout.as_secs() as i64,
                    nanos: timeout.subsec_nanos() as i32,
                }),
                stdin: request.stdin.clone().unwrap_or_default(),
                no_login_shell: request.no_login_shell,
                ..Default::default()
            })
            .await
            .map_err(|status| GatewayError::Failed {
                operation: "sandbox exec",
                detail: status.message().to_string(),
            })?
            .into_inner();

        // A bounded channel carries each chunk to the caller as it arrives, so
        // a slow reader slows the stream instead of buffering it.
        enum Event {
            Chunk(Vec<u8>),
            Error(String),
        }
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<Event>(16);
        // The producer owns the stream, so cancelling it on drop is what keeps
        // an interrupted exec from leaving the RPC open.
        let mut producer = AbortOnDrop(tokio::spawn(async move {
            let mut exit_code = -1;
            loop {
                match stream.message().await {
                    Ok(Some(event)) => match event.payload {
                        Some(proto::exec_sandbox_event::Payload::Stdout(chunk)) => {
                            if sender.send(Event::Chunk(chunk.data)).await.is_err() {
                                return exit_code;
                            }
                        }
                        Some(proto::exec_sandbox_event::Payload::Stderr(chunk)) => {
                            if sender.send(Event::Chunk(chunk.data)).await.is_err() {
                                return exit_code;
                            }
                        }
                        Some(proto::exec_sandbox_event::Payload::Exit(exit)) => {
                            exit_code = exit.exit_code;
                        }
                        None => {}
                    },
                    Ok(None) => break,
                    Err(status) => {
                        let _ = sender.send(Event::Error(status.message().to_string())).await;
                        break;
                    }
                }
            }
            exit_code
        }));
        let mut failure = None;
        while let Some(event) = receiver.recv().await {
            match event {
                Event::Chunk(bytes) => sink.write(&bytes),
                Event::Error(detail) => failure = Some(detail),
            }
        }
        let produced = (&mut producer.0).await.unwrap_or(-1);
        if let Some(detail) = failure {
            return Err(GatewayError::Failed {
                operation: "sandbox exec",
                detail,
            });
        }
        Ok(ExitStatus { code: produced })
    }

    async fn exec_buffered(&self, request: ExecRequest) -> Result<ExecOutput, GatewayError> {
        let result = self
            .client
            .exec(
                &request.sandbox,
                &request.command,
                ExecOptions {
                    workdir: request.workdir,
                    timeout: request.timeout,
                    stdin: request.stdin,
                    no_login_shell: request.no_login_shell,
                    ..Default::default()
                },
            )
            .await
            .map_err(|error| Self::map(error, &self.endpoint, "sandbox exec"))?;
        Ok(ExecOutput {
            exit_code: result.exit_code,
            stdout: result.stdout,
            stderr: result.stderr,
        })
    }

    async fn exec_interactive(
        &self,
        exec: InteractiveExec,
        mut input: tokio::sync::mpsc::Receiver<ExecInput>,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, GatewayError> {
        let request = exec.request;
        let sandbox = request.sandbox.clone();
        let (cols, rows) = exec
            .size
            .map(|(cols, rows)| (u32::from(cols), u32::from(rows)))
            .unwrap_or((0, 0));
        let start = proto::ExecSandboxRequest {
            workspace_scope: Self::scope(),
            sandbox: sandbox.clone(),
            command: request.command.clone(),
            workdir: request.workdir.clone().unwrap_or_default(),
            environment: exec.env.iter().cloned().collect(),
            execution_timeout: request.timeout.map(|timeout| prost_types::Duration {
                seconds: timeout.as_secs() as i64,
                nanos: timeout.subsec_nanos() as i32,
            }),
            stdin: request.stdin.clone().unwrap_or_default(),
            tty: exec.tty,
            cols,
            rows,
            no_login_shell: request.no_login_shell,
            ..Default::default()
        };
        let (sender, receiver) = tokio::sync::mpsc::channel::<proto::ExecSandboxInput>(16);
        sender
            .send(proto::ExecSandboxInput {
                payload: Some(proto::exec_sandbox_input::Payload::Start(start)),
            })
            .await
            .map_err(|_| GatewayError::Failed {
                operation: "sandbox exec",
                detail: "the request stream closed before the exec started".to_string(),
            })?;
        let mut stream = self
            .client
            .raw_grpc()
            .exec_sandbox_interactive(tokio_stream::wrappers::ReceiverStream::new(receiver))
            .await
            .map_err(|status| GatewayError::Failed {
                operation: "sandbox exec",
                detail: status.message().to_string(),
            })?
            .into_inner();

        let mut sender = Some(sender);
        let mut input_open = true;
        let mut exit_code = None;
        let mut failure = None;
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        loop {
            let interrupted = exec
                .interrupt
                .as_ref()
                .is_some_and(|flag| flag.load(std::sync::atomic::Ordering::Relaxed));
            if interrupted {
                // Dropping the stream cancels the RPC, which ends the process.
                drop(stream);
                return Ok(ExitStatus { code: 130 });
            }
            tokio::select! {
                frame = input.recv(), if input_open => {
                    match frame {
                        Some(ExecInput::Stdin(bytes)) => {
                            if let Some(out) = sender.as_ref() {
                                let frame = proto::ExecSandboxInput {
                                    payload: Some(proto::exec_sandbox_input::Payload::Stdin(bytes)),
                                };
                                if out.send(frame).await.is_err() {
                                    input_open = false;
                                    sender = None;
                                }
                            }
                        }
                        Some(ExecInput::Resize { cols, rows }) => {
                            if let Some(out) = sender.as_ref() {
                                let frame = proto::ExecSandboxInput {
                                    payload: Some(proto::exec_sandbox_input::Payload::Resize(
                                        proto::ExecSandboxWindowResize {
                                            cols: u32::from(cols),
                                            rows: u32::from(rows),
                                        },
                                    )),
                                };
                                let _ = out.send(frame).await;
                            }
                        }
                        None => {
                            // Stdin ended; keep the response half open so the
                            // command can finish on its own.
                            input_open = false;
                            sender = None;
                        }
                    }
                }
                event = stream.message() => {
                    match event {
                        Ok(Some(event)) => match event.payload {
                            Some(proto::exec_sandbox_event::Payload::Stdout(chunk)) => {
                                sink.write(&chunk.data);
                            }
                            Some(proto::exec_sandbox_event::Payload::Stderr(chunk)) => {
                                sink.write(&chunk.data);
                            }
                            Some(proto::exec_sandbox_event::Payload::Exit(exit)) => {
                                exit_code = Some(exit.exit_code);
                            }
                            None => {}
                        },
                        Ok(None) => break,
                        Err(status) => {
                            failure = Some(status.message().to_string());
                            break;
                        }
                    }
                }
                _ = tick.tick() => {}
            }
        }
        if let Some(detail) = failure {
            return Err(GatewayError::Failed {
                operation: "sandbox exec",
                detail,
            });
        }
        Ok(ExitStatus {
            code: exit_code.unwrap_or(-1),
        })
    }

    async fn logs(
        &self,
        sandbox: &str,
        options: LogOptions,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<(), GatewayError> {
        let since = since_time(options.since.as_deref())?;
        let sources: Vec<String> = options
            .sources
            .into_iter()
            .filter(|source| source != "all")
            .collect();
        let level = options
            .level
            .map(|level| level.to_uppercase())
            .unwrap_or_default();
        if options.follow {
            let mut stream = self
                .client
                .raw_grpc()
                .watch_sandbox(proto::WatchSandboxRequest {
                    workspace_scope: Self::scope(),
                    sandbox: sandbox.to_string(),
                    follow_logs: true,
                    log_tail_lines: options.lines,
                    since_time: since,
                    log_sources: sources,
                    log_min_level: level,
                    ..Default::default()
                })
                .await
                .map_err(|status| GatewayError::Failed {
                    operation: "sandbox logs",
                    detail: status.message().to_string(),
                })?
                .into_inner();
            // Both endings - a normal end and an interrupted stream - leave the
            // loop here, dropping the stream and releasing the connection.
            while let Some(event) =
                stream
                    .message()
                    .await
                    .map_err(|status| GatewayError::Failed {
                        operation: "sandbox logs",
                        detail: status.message().to_string(),
                    })?
            {
                if let Some(proto::sandbox_stream_event::Payload::Log(log)) = event.payload {
                    sink.write(format!("{}\n", format_log_line(&log)).as_bytes());
                }
            }
            return Ok(());
        }
        let response = self
            .client
            .raw_grpc()
            .get_sandbox_logs(proto::GetSandboxLogsRequest {
                workspace_scope: Self::scope(),
                sandbox: sandbox.to_string(),
                lines: options.lines,
                since_time: since,
                sources,
                min_level: level,
            })
            .await
            .map_err(|status| GatewayError::Failed {
                operation: "sandbox logs",
                detail: status.message().to_string(),
            })?
            .into_inner();
        for log in &response.logs {
            sink.write(format!("{}\n", format_log_line(log)).as_bytes());
        }
        Ok(())
    }

    async fn list_providers(&self) -> Result<Vec<String>, GatewayError> {
        let providers = self
            .client
            .raw_grpc()
            .list_providers(proto::ListProvidersRequest {
                workspace_scope: Self::scope(),
                ..Default::default()
            })
            .await
            .map_err(|status| GatewayError::Failed {
                operation: "provider list",
                detail: status.message().to_string(),
            })?
            .into_inner();
        Ok(providers
            .providers
            .into_iter()
            .filter_map(|provider| provider.metadata.map(|meta| meta.name))
            .collect())
    }

    async fn create_provider(&self, spec: ProviderSpec) -> Result<(), GatewayError> {
        let mut credentials = HashMap::new();
        if let Some(credential) = &spec.credential {
            let key = spec
                .credential_key
                .clone()
                .unwrap_or_else(|| spec.profile.clone());
            credentials.insert(key, credential.expose().to_string());
        }
        // A named credential field resolves from the caller's environment: the
        // existing local credential is the source, and the request field stays
        // the only channel it travels in.
        for key in spec.credential_keys.iter().filter(|key| !key.is_empty()) {
            let value = std::env::var(key).map_err(|_| GatewayError::Failed {
                operation: "provider create",
                detail: format!(
                    "requires local env var '{key}' to be set to a non-empty value"
                ),
            })?;
            if value.trim().is_empty() {
                return Err(GatewayError::Failed {
                    operation: "provider create",
                    detail: format!(
                        "requires local env var '{key}' to be set to a non-empty value"
                    ),
                });
            }
            credentials.insert(key.clone(), value);
        }
        let mut config = HashMap::new();
        for (key, value) in spec.config.iter().filter(|(key, _)| !key.is_empty()) {
            config.insert(key.clone(), value.clone());
        }
        let profile_workspace = if spec.global_profile {
            String::new()
        } else {
            WORKSPACE.to_string()
        };
        let response = self
            .client
            .raw_grpc()
            .create_provider(proto::CreateProviderRequest {
                workspace_scope: Self::scope(),
                provider: Some(proto::Provider {
                    metadata: Some(proto::ObjectMeta {
                        name: spec.name.clone(),
                        ..Default::default()
                    }),
                    r#type: spec.profile.clone(),
                    credentials,
                    config,
                    profile_workspace,
                    ..Default::default()
                }),
                ..Default::default()
            })
            .await;
        match response {
            Ok(_) => Ok(()),
            Err(status) => {
                if spec.credential.is_some() || !spec.credential_keys.is_empty() {
                    // Names the field and the status; never the value.
                    Err(GatewayError::CredentialRejected {
                        field: spec
                            .credential_key
                            .clone()
                            .or_else(|| spec.credential_keys.first().cloned())
                            .unwrap_or_else(|| spec.profile.clone()),
                        status: status.code() as u16,
                    })
                } else {
                    Err(GatewayError::Failed {
                        operation: "provider create",
                        detail: status.message().to_string(),
                    })
                }
            }
        }
    }

    async fn attached_providers(&self, sandbox: &str) -> Result<Vec<String>, GatewayError> {
        let attached = self
            .client
            .raw_grpc()
            .list_sandbox_providers(proto::ListSandboxProvidersRequest {
                workspace_scope: Self::scope(),
                sandbox: sandbox.to_string(),
                ..Default::default()
            })
            .await
            .map_err(|status| GatewayError::Failed {
                operation: "sandbox provider list",
                detail: status.message().to_string(),
            })?
            .into_inner();
        Ok(attached
            .providers
            .into_iter()
            .filter_map(|provider| provider.metadata.map(|meta| meta.name))
            .collect())
    }

    async fn attach_provider(&self, sandbox: &str, provider: &str) -> Result<(), GatewayError> {
        self.client
            .raw_grpc()
            .attach_sandbox_provider(proto::AttachSandboxProviderRequest {
                workspace_scope: Self::scope(),
                sandbox: sandbox.to_string(),
                provider: provider.to_string(),
                ..Default::default()
            })
            .await
            .map(|_| ())
            .map_err(|status| GatewayError::Failed {
                operation: "sandbox provider attach",
                detail: status.message().to_string(),
            })
    }

    async fn detach_provider(&self, sandbox: &str, provider: &str) -> Result<(), GatewayError> {
        self.client
            .raw_grpc()
            .detach_sandbox_provider(proto::DetachSandboxProviderRequest {
                workspace_scope: Self::scope(),
                sandbox: sandbox.to_string(),
                provider: provider.to_string(),
                ..Default::default()
            })
            .await
            .map(|_| ())
            .map_err(|status| GatewayError::Failed {
                operation: "sandbox provider detach",
                detail: status.message().to_string(),
            })
    }

    async fn get_rule(
        &self,
        sandbox: &str,
        name: &str,
        pending_only: bool,
    ) -> Result<Option<Rule>, GatewayError> {
        let listing = self.list_rules(sandbox).await?;
        Ok(listing.rules.into_iter().find(|rule| {
            rule.name == name && (!pending_only || rule.status.as_deref() == Some("pending"))
        }))
    }

    async fn list_rules(&self, sandbox: &str) -> Result<RuleListing, GatewayError> {
        let policy = self
            .client
            .raw_grpc()
            .get_draft_policy(proto::GetDraftPolicyRequest {
                workspace_scope: Self::scope(),
                sandbox: sandbox.to_string(),
                status_filter: String::new(),
            })
            .await
            .map_err(|status| GatewayError::Failed {
                operation: "rule list",
                detail: status.message().to_string(),
            })?
            .into_inner();
        Ok(RuleListing {
            version: policy.draft_version,
            rules: policy.chunks.iter().map(rule_of).collect(),
        })
    }

    async fn approve_rule(&self, sandbox: &str, chunk: &str) -> Result<(), GatewayError> {
        self.client
            .raw_grpc()
            .approve_draft_chunk(proto::ApproveDraftChunkRequest {
                workspace_scope: Self::scope(),
                sandbox: sandbox.to_string(),
                chunk_id: chunk.to_string(),
                ..Default::default()
            })
            .await
            .map(|_| ())
            .map_err(|status| GatewayError::Failed {
                operation: "rule approve",
                detail: status.message().to_string(),
            })
    }
}

/// A spawned stream producer that is cancelled when its owner is dropped.
///
/// Without this, an interrupted exec would leave the producer blocked on the
/// RPC and the stream open until the gateway closed it.
struct AbortOnDrop(tokio::task::JoinHandle<i32>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Resolve the CLI's `--since` duration against the wall clock, in the one
/// place that builds a request.
fn since_time(since: Option<&str>) -> Result<Option<prost_types::Timestamp>, GatewayError> {
    let Some(since) = since else {
        return Ok(None);
    };
    let millis = parse_duration_ms(since).ok_or_else(|| GatewayError::Failed {
        operation: "sandbox logs",
        detail: format!("invalid duration: {since} (expected e.g. 5m, 1h, 30s)"),
    })?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0);
    let at = now - millis;
    Ok(Some(prost_types::Timestamp {
        seconds: at / 1000,
        nanos: ((at % 1000) * 1_000_000) as i32,
    }))
}

/// `5m`, `1h`, `30s` — the units the CLI's `--since` accepts.
fn parse_duration_ms(value: &str) -> Option<i64> {
    let value = value.trim();
    let unit = value.chars().last()?;
    let number = &value[..value.len() - unit.len_utf8()];
    let amount: i64 = number.parse().ok()?;
    if amount <= 0 {
        return None;
    }
    let multiplier = match unit {
        's' => 1_000,
        'm' => 60_000,
        'h' => 3_600_000,
        _ => return None,
    };
    amount.checked_mul(multiplier)
}

/// One log line, in the wording the CLI prints.
fn format_log_line(log: &proto::SandboxLogLine) -> String {
    let source = if log.source.is_empty() {
        "gateway"
    } else {
        &log.source
    };
    let millis = log
        .event_time
        .as_ref()
        .map(|stamp| stamp.seconds.saturating_mul(1000) + i64::from(stamp.nanos) / 1_000_000)
        .unwrap_or(0);
    let secs = millis / 1000;
    let fraction = millis % 1000;
    if log.fields.is_empty() {
        format!(
            "[{secs}.{fraction:03}] [{source:<7}] [{:<5}] [{}] {}",
            log.level, log.target, log.message
        )
    } else {
        let mut fields: Vec<(&String, &String)> = log.fields.iter().collect();
        fields.sort_by_key(|(key, _)| key.as_str());
        let rendered = fields
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join(" ");
        format!(
            "[{secs}.{fraction:03}] [{source:<7}] [{:<5}] [{}] {} {}",
            log.level, log.target, log.message, rendered
        )
    }
}

/// The inline template limits the CLI sends: `resources.limits.{cpu,memory}`.
fn resource_limits(cpu: Option<&str>, memory: Option<&str>) -> Option<prost_types::Struct> {
    use prost_types::value::Kind;
    use prost_types::{Struct, Value};

    let mut limits = std::collections::BTreeMap::new();
    if let Some(cpu) = cpu.filter(|value| !value.is_empty()) {
        limits.insert(
            "cpu".to_string(),
            Value {
                kind: Some(Kind::StringValue(cpu.to_string())),
            },
        );
    }
    if let Some(memory) = memory.filter(|value| !value.is_empty()) {
        limits.insert(
            "memory".to_string(),
            Value {
                kind: Some(Kind::StringValue(memory.to_string())),
            },
        );
    }
    if limits.is_empty() {
        return None;
    }
    let mut fields = std::collections::BTreeMap::new();
    fields.insert(
        "limits".to_string(),
        Value {
            kind: Some(Kind::StructValue(Struct { fields: limits })),
        },
    );
    Some(Struct { fields })
}
