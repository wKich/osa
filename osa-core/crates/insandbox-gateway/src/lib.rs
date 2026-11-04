//! A dev-only OpenShell-compatible control plane that runs inside an osa
//! sandbox.
//!
//! This is not a boundary. It enforces no isolation and no policy, and it
//! brokers no credential: its safety comes only from the outer sandbox. Its
//! job is to let osa's own front-ends exercise their lifecycle from inside one
//! sandbox, where a "sandbox" is a directory and `exec` is a local child
//! process.
//!
//! The gate in [`gate`] refuses to start anywhere that is not an osa sandbox,
//! and the startup line says the non-guarantee before the listener is
//! announced.

pub mod exec;
pub mod gate;
pub mod shim;
pub mod state;
pub mod transfer;

use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{self, Write};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::time::Duration;

use openshell_core::proto;
use proto::open_shell_server::{OpenShell, OpenShellServer};
use tokio::net::TcpListener;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{Request, Response, Status};

pub use gate::{Detection, GateError, PlaneConfig};
pub use state::{SandboxRecord, StateRoot};

/// The version this plane reports.
pub const VERSION: &str = "0.1.5-insandbox";

/// The line that announces the listener, after the non-guarantee.
pub const LISTENING_PREFIX: &str = "insandbox-gateway listening on ";

/// The plane's state and identity. One instance serves the whole process.
#[derive(Clone, Debug)]
pub struct Plane {
    state: StateRoot,
    exe: PathBuf,
    server: String,
}

/// Rewrite an absolute `/sandbox` path to the sandbox's directory. The helper
/// scripts and the agent image speak the sandbox's own `/sandbox`; the plane
/// runs a local child and has no chroot, so the path is translated before the
/// child starts. A substring is rewritten only at a path boundary, so a script
/// body's `${HOME:-/sandbox}` and a `PATH` entry both translate and ordinary
/// words containing "sandbox" do not.
pub(crate) fn rewrite_sandbox_path(value: &str, root: &str) -> String {
    const NEEDLE: &str = "/sandbox";
    let mut out = String::with_capacity(value.len() + root.len());
    let mut rest = value;
    while let Some(position) = rest.find(NEEDLE) {
        let before = rest[..position].chars().next_back();
        let after = rest[position + NEEDLE.len()..].chars().next();
        let boundary_before = matches!(
            before,
            None | Some(':' | '=' | ' ' | '(' | '\'' | '"' | '-')
        );
        let boundary_after = matches!(after, None | Some('/' | ':' | '}' | '\'' | '"' | ' '));
        out.push_str(&rest[..position]);
        if boundary_before && boundary_after {
            out.push_str(root);
        }
        out.push_str(NEEDLE);
        rest = &rest[position + NEEDLE.len()..];
    }
    out.push_str(rest);
    out
}

/// The rewritten argv, workdir, environment, and timeout an exec of either
/// kind shares.
type ExecSetup = (
    Vec<String>,
    PathBuf,
    Vec<(OsString, OsString)>,
    Option<Duration>,
);

impl Plane {
    pub fn new(state: StateRoot, exe: PathBuf, server: String) -> Self {
        Plane { state, exe, server }
    }

    pub fn state(&self) -> &StateRoot {
        &self.state
    }

    /// Install the shim in the state root's private directory. The plane only
    /// prepends that directory to `PATH` for its own child tree; this never
    /// writes to a system bin directory.
    pub fn install_shim(&self) -> io::Result<PathBuf> {
        let dir = self.state.shim_dir();
        fs::create_dir_all(&dir)?;
        let path = dir.join("openshell");
        fs::write(
            &path,
            shim::script(&self.exe, self.state.root(), &self.server),
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))?;
        }
        Ok(path)
    }

    pub fn into_server(self) -> OpenShellServer<Plane> {
        OpenShellServer::new(self)
    }

    /// The environment every exec child receives: the invoking environment,
    /// the create request's pairs, the exec request's variables, and the
    /// path-scoped shim last. The shim is prefixed to whatever `PATH` those
    /// layers named (or the plane's own when none did), so a create-time
    /// `PATH` survives.
    fn child_env(
        &self,
        name: &str,
        requested: &std::collections::HashMap<String, String>,
    ) -> Vec<(OsString, OsString)> {
        child_environment(&self.state, &self.server, &self.exe, name, requested)
    }

    /// The parts an exec of either kind shares: the phase guard, the resolved
    /// workdir, the child environment, the timeout, and the rewritten argv.
    fn exec_setup(&self, request: &proto::ExecSandboxRequest) -> Result<ExecSetup, Status> {
        let name = &request.sandbox;
        let phase = self
            .state
            .phase(name)
            .ok_or_else(|| Status::not_found(format!("sandbox {name} not found")))?;
        if phase == "Stopped" {
            return Err(Status::failed_precondition(format!(
                "sandbox {name} is stopped; start it before exec"
            )));
        }
        if request.command.is_empty() {
            return Err(Status::invalid_argument("exec command is required"));
        }
        let root = self.state.root_dir(name);
        let workdir = transfer::workdir(&root, &request.workdir)
            .map_err(|error| Status::invalid_argument(error.to_string()))?;
        let timeout = request
            .execution_timeout
            .as_ref()
            .map(|value| {
                duration_of(value)
                    .ok_or_else(|| Status::invalid_argument("execution timeout is negative"))
            })
            .transpose()?;
        let env = self.child_env(name, &request.environment);
        let root = root.display().to_string();
        let command = request
            .command
            .iter()
            .map(|argument| rewrite_sandbox_path(argument, &root))
            .collect();
        Ok((command, workdir, env, timeout))
    }

    fn sandbox(&self, name: &str) -> Result<proto::Sandbox, Status> {
        self.state
            .record(name)
            .map(|record| sandbox_proto(&record))
            .ok_or_else(|| Status::not_found(format!("sandbox {name} not found")))
    }
}

/// Bind `listen`, install the shim, print the non-guarantee and the listener,
/// then serve until the process ends.
pub async fn serve(state_root: PathBuf, listen: SocketAddr) -> io::Result<()> {
    let state = StateRoot::open(state_root)?;
    let listener = TcpListener::bind(listen).await?;
    let address = listener.local_addr()?;
    let exe = std::env::current_exe()?;
    let plane = Plane::new(state, exe, format!("http://{address}"));
    plane.install_shim()?;
    announce(&mut io::stdout(), address)?;
    serve_on(listener, plane).await
}

/// Serve an already-bound listener. Tests use this to skip the gate while
/// keeping the same server.
pub async fn serve_on(listener: TcpListener, plane: Plane) -> io::Result<()> {
    let incoming = TcpListenerStream::new(listener);
    tonic::transport::Server::builder()
        .add_service(plane.into_server())
        .serve_with_incoming(incoming)
        .await
        .map_err(io::Error::other)
}

/// The environment every exec child receives: the invoking environment, the
/// create request's pairs, the exec request's variables, and the path-scoped
/// shim last. Sandbox paths in every layer are rewritten to the plane's real
/// directory, since a plane child has no chroot.
pub(crate) fn child_environment(
    state: &StateRoot,
    server: &str,
    exe: &Path,
    name: &str,
    requested: &std::collections::HashMap<String, String>,
) -> Vec<(OsString, OsString)> {
    let root = state.root_dir(name).display().to_string();
    let rewrite = |value: &str| rewrite_sandbox_path(value, &root);
    let mut env: Vec<(OsString, OsString)> = std::env::vars_os()
        .map(|(key, value)| (key, OsString::from(rewrite(&value.to_string_lossy()))))
        .collect();
    for (key, value) in state.environment(name) {
        env.retain(|(known, _)| known != OsStr::new(&key));
        env.push((OsString::from(key), OsString::from(rewrite(&value))));
    }
    for (key, value) in requested {
        env.retain(|(known, _)| known != OsStr::new(key));
        env.push((OsString::from(key), OsString::from(rewrite(value))));
    }
    let base = env
        .iter()
        .find(|(key, _)| key == OsStr::new("PATH"))
        .map(|(_, value)| value.clone())
        .unwrap_or_else(|| std::env::var_os("PATH").unwrap_or_default());
    env.retain(|(key, _)| key != OsStr::new("PATH"));
    let mut path = OsString::from(state.shim_dir());
    path.push(":");
    path.push(base);
    env.push((OsString::from("PATH"), path));
    env.push((
        OsString::from(shim::STATE_ROOT_ENV),
        state.root().as_os_str().to_os_string(),
    ));
    env.push((OsString::from(shim::SERVER_ENV), OsString::from(server)));
    env.push((
        OsString::from(shim::BIN_ENV),
        exe.as_os_str().to_os_string(),
    ));
    env
}

/// The startup lines, in the order the contract requires: the non-guarantee
/// first, the listener second.
pub fn announce(writer: &mut impl Write, address: SocketAddr) -> io::Result<()> {
    writeln!(writer, "{}", gate::NON_GUARANTEE)?;
    writeln!(writer, "{LISTENING_PREFIX}http://{address}")?;
    writer.flush()
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

fn sandbox_proto(record: &SandboxRecord) -> proto::Sandbox {
    proto::Sandbox {
        metadata: Some(proto::ObjectMeta {
            id: record.id.clone(),
            name: record.name.clone(),
            resource_version: 1,
            created_time: Some(prost_types::Timestamp {
                seconds: record.created_ms / 1000,
                nanos: ((record.created_ms % 1000) * 1_000_000) as i32,
            }),
            ..Default::default()
        }),
        spec: None,
        status: Some(proto::SandboxStatus {
            phase: phase_code(&record.phase),
            current_policy_version: 1,
            ..Default::default()
        }),
        host_key_fingerprint: String::new(),
        created_from_workload_template: None,
    }
}

fn duration_of(value: &prost_types::Duration) -> Option<Duration> {
    if value.seconds < 0 || value.nanos < 0 {
        return None;
    }
    Some(Duration::new(value.seconds as u64, value.nanos as u32))
}

fn log_line(sandbox_id: &str, message: String) -> proto::SandboxLogLine {
    proto::SandboxLogLine {
        sandbox_id: sandbox_id.to_string(),
        level: "INFO".to_string(),
        target: "insandbox".to_string(),
        message,
        source: "sandbox".to_string(),
        ..Default::default()
    }
}

fn recorded_logs(path: &std::path::Path, tail: usize) -> Vec<String> {
    let text = fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<String> = text
        .lines()
        .map(str::to_string)
        .filter(|line| !line.is_empty())
        .collect();
    if tail > 0 && lines.len() > tail {
        lines = lines.split_off(lines.len() - tail);
    }
    lines
}

#[tonic::async_trait]
#[allow(clippy::too_many_lines)]
impl OpenShell for Plane {
    type ExecSandboxStream = Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::ExecSandboxEvent, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type ForwardTcpStream = Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::TcpForwardFrame, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type ExecSandboxInteractiveStream = Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::ExecSandboxEvent, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type ConnectSupervisorStream = Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::GatewayMessage, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type RelayStreamStream = Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::RelayFrame, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type PeerRelayStream = Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::PeerRelayFrame, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;
    type WatchSandboxStream = Pin<
        Box<
            dyn tonic::codegen::tokio_stream::Stream<
                    Item = std::result::Result<proto::SandboxStreamEvent, tonic::Status>,
                > + std::marker::Send
                + 'static,
        >,
    >;

    async fn health(
        &self,
        _request: Request<proto::HealthRequest>,
    ) -> std::result::Result<Response<proto::HealthResponse>, Status> {
        Ok(Response::new(proto::HealthResponse {
            status: proto::ServiceStatus::Healthy as i32,
            version: VERSION.to_string(),
        }))
    }

    async fn create_sandbox(
        &self,
        request: Request<proto::CreateSandboxRequest>,
    ) -> std::result::Result<Response<proto::SandboxResponse>, Status> {
        let request = request.into_inner();
        let name = request.name;
        if name.is_empty() {
            return Err(Status::invalid_argument("sandbox name is required"));
        }
        let providers = request
            .spec
            .as_ref()
            .map(|spec| spec.providers.clone())
            .unwrap_or_default();
        let mut environment: Vec<(String, String)> = request
            .spec
            .as_ref()
            .map(|spec| {
                spec.environment
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect()
            })
            .unwrap_or_default();
        environment.sort();
        let record = self
            .state
            .create_with(&name, &providers, &environment)
            .map_err(|error| {
                use state::CreateError;
                match error {
                    CreateError::AlreadyExists(name) => {
                        Status::already_exists(format!("sandbox {name} already exists"))
                    }
                    CreateError::InvalidName(_) => Status::invalid_argument(error.to_string()),
                    CreateError::Io(detail) => Status::internal(detail),
                }
            })?;
        Ok(Response::new(proto::SandboxResponse {
            sandbox: Some(sandbox_proto(&record)),
            service_urls: Default::default(),
        }))
    }

    async fn get_sandbox(
        &self,
        request: Request<proto::GetSandboxRequest>,
    ) -> std::result::Result<Response<proto::SandboxResponse>, Status> {
        let name = request.into_inner().name;
        Ok(Response::new(proto::SandboxResponse {
            sandbox: Some(self.sandbox(&name)?),
            service_urls: Default::default(),
        }))
    }

    async fn list_sandboxes(
        &self,
        _request: Request<proto::ListSandboxesRequest>,
    ) -> std::result::Result<Response<proto::ListSandboxesResponse>, Status> {
        Ok(Response::new(proto::ListSandboxesResponse {
            sandboxes: self.state.list().iter().map(sandbox_proto).collect(),
            next_page_token: String::new(),
        }))
    }

    async fn list_sandbox_providers(
        &self,
        request: Request<proto::ListSandboxProvidersRequest>,
    ) -> std::result::Result<Response<proto::ListSandboxProvidersResponse>, Status> {
        let name = request.into_inner().sandbox;
        if !self.state.exists(&name) {
            return Err(Status::not_found(format!("sandbox {name} not found")));
        }
        let providers = self
            .state
            .providers(&name)
            .into_iter()
            .map(|name| proto::Provider {
                metadata: Some(proto::ObjectMeta {
                    name,
                    ..Default::default()
                }),
                ..Default::default()
            })
            .collect();
        Ok(Response::new(proto::ListSandboxProvidersResponse {
            providers,
            next_page_token: String::new(),
        }))
    }

    async fn attach_sandbox_provider(
        &self,
        request: Request<proto::AttachSandboxProviderRequest>,
    ) -> std::result::Result<Response<proto::AttachSandboxProviderResponse>, Status> {
        let request = request.into_inner();
        if !self.state.exists(&request.sandbox) {
            return Err(Status::not_found(format!(
                "sandbox {} not found",
                request.sandbox
            )));
        }
        let mut attached = self.state.providers(&request.sandbox);
        if !attached.contains(&request.provider) {
            attached.push(request.provider.clone());
            self.state
                .set_providers(&request.sandbox, &attached)
                .map_err(|error| Status::internal(error.to_string()))?;
        }
        Ok(Response::new(
            proto::AttachSandboxProviderResponse::default(),
        ))
    }

    async fn detach_sandbox_provider(
        &self,
        request: Request<proto::DetachSandboxProviderRequest>,
    ) -> std::result::Result<Response<proto::DetachSandboxProviderResponse>, Status> {
        let request = request.into_inner();
        if !self.state.exists(&request.sandbox) {
            return Err(Status::not_found(format!(
                "sandbox {} not found",
                request.sandbox
            )));
        }
        let attached: Vec<String> = self
            .state
            .providers(&request.sandbox)
            .into_iter()
            .filter(|name| name != &request.provider)
            .collect();
        self.state
            .set_providers(&request.sandbox, &attached)
            .map_err(|error| Status::internal(error.to_string()))?;
        Ok(Response::new(
            proto::DetachSandboxProviderResponse::default(),
        ))
    }

    async fn delete_sandbox(
        &self,
        request: Request<proto::DeleteSandboxRequest>,
    ) -> std::result::Result<Response<proto::DeleteSandboxResponse>, Status> {
        let request = request.into_inner();
        let name = request.name;
        let Some(record) = self.state.record(&name) else {
            if request.allow_missing {
                return Ok(Response::new(proto::DeleteSandboxResponse {
                    outcome: proto::DeletionOutcome::AlreadyAbsent as i32,
                    sandbox_id: String::new(),
                }));
            }
            return Err(Status::not_found(format!("sandbox {name} not found")));
        };
        // The directory, the filesystem, and the provider record go together.
        self.state
            .delete(&name)
            .map_err(|error| Status::internal(error.to_string()))?;
        Ok(Response::new(proto::DeleteSandboxResponse {
            outcome: proto::DeletionOutcome::Completed as i32,
            sandbox_id: record.id,
        }))
    }

    async fn stop_sandbox(
        &self,
        request: Request<proto::StopSandboxRequest>,
    ) -> std::result::Result<Response<proto::SandboxResponse>, Status> {
        let name = request.into_inner().name;
        if !self.state.exists(&name) {
            return Err(Status::not_found(format!("sandbox {name} not found")));
        }
        self.state
            .set_phase(&name, "Stopped")
            .map_err(|error| Status::internal(error.to_string()))?;
        Ok(Response::new(proto::SandboxResponse {
            sandbox: Some(self.sandbox(&name)?),
            service_urls: Default::default(),
        }))
    }

    async fn start_sandbox(
        &self,
        request: Request<proto::StartSandboxRequest>,
    ) -> std::result::Result<Response<proto::SandboxResponse>, Status> {
        let name = request.into_inner().name;
        if !self.state.exists(&name) {
            return Err(Status::not_found(format!("sandbox {name} not found")));
        }
        self.state
            .set_phase(&name, "Ready")
            .map_err(|error| Status::internal(error.to_string()))?;
        Ok(Response::new(proto::SandboxResponse {
            sandbox: Some(self.sandbox(&name)?),
            service_urls: Default::default(),
        }))
    }

    async fn suspend_sandbox(
        &self,
        request: Request<proto::SuspendSandboxRequest>,
    ) -> std::result::Result<Response<proto::SandboxResponse>, Status> {
        let name = request.into_inner().name;
        if !self.state.exists(&name) {
            return Err(Status::not_found(format!("sandbox {name} not found")));
        }
        self.state
            .set_phase(&name, "Suspended")
            .map_err(|error| Status::internal(error.to_string()))?;
        Ok(Response::new(proto::SandboxResponse {
            sandbox: Some(self.sandbox(&name)?),
            service_urls: Default::default(),
        }))
    }

    async fn resume_sandbox(
        &self,
        request: Request<proto::ResumeSandboxRequest>,
    ) -> std::result::Result<Response<proto::SandboxResponse>, Status> {
        let name = request.into_inner().name;
        match self.state.phase(&name) {
            None => return Err(Status::not_found(format!("sandbox {name} not found"))),
            Some(phase) if phase != "Suspended" => {
                return Err(Status::failed_precondition(format!(
                    "sandbox {name} is {phase}, not suspended"
                )))
            }
            Some(_) => {}
        }
        self.state
            .set_phase(&name, "Ready")
            .map_err(|error| Status::internal(error.to_string()))?;
        Ok(Response::new(proto::SandboxResponse {
            sandbox: Some(self.sandbox(&name)?),
            service_urls: Default::default(),
        }))
    }

    async fn exec_sandbox(
        &self,
        request: Request<proto::ExecSandboxRequest>,
    ) -> std::result::Result<Response<Self::ExecSandboxStream>, Status> {
        let request = request.into_inner();
        if request.tty {
            return Err(Status::unimplemented(
                "insandbox-gateway: exec_sandbox with a tty; use exec_sandbox_interactive",
            ));
        }
        let (command, workdir, env, timeout) = self.exec_setup(&request)?;
        let stream = exec::run(command, workdir, env, request.stdin, timeout)
            .map_err(|error| Status::internal(error.to_string()))?;
        Ok(Response::new(Box::pin(stream) as Self::ExecSandboxStream))
    }

    async fn get_draft_policy(
        &self,
        request: Request<proto::GetDraftPolicyRequest>,
    ) -> std::result::Result<Response<proto::GetDraftPolicyResponse>, Status> {
        let request = request.into_inner();
        if !self.state.exists(&request.sandbox) {
            return Err(Status::not_found(format!(
                "sandbox {} not found",
                request.sandbox
            )));
        }
        // A recorded policy, not a proved one: the reply carries no
        // enforcement claim and the plane makes no egress decision.
        let chunks = policy_chunks(&self.state.rules_file(&request.sandbox))
            .into_iter()
            .filter(|chunk| {
                request.status_filter.is_empty() || chunk.status == request.status_filter
            })
            .collect();
        Ok(Response::new(proto::GetDraftPolicyResponse {
            chunks,
            rolling_summary: String::new(),
            draft_version: 1,
            last_analyzed_time: None,
        }))
    }

    async fn get_sandbox_logs(
        &self,
        request: Request<proto::GetSandboxLogsRequest>,
    ) -> std::result::Result<Response<proto::GetSandboxLogsResponse>, Status> {
        let request = request.into_inner();
        let record = self
            .state
            .record(&request.sandbox)
            .ok_or_else(|| Status::not_found(format!("sandbox {} not found", request.sandbox)))?;
        let tail = if request.lines == 0 {
            2000
        } else {
            request.lines as usize
        };
        let lines = recorded_logs(&self.state.logs_file(&record.name), tail);
        let buffer_total = lines.len() as u32;
        Ok(Response::new(proto::GetSandboxLogsResponse {
            logs: lines
                .into_iter()
                .map(|message| log_line(&record.id, message))
                .collect(),
            buffer_total,
        }))
    }

    async fn push_sandbox_logs(
        &self,
        request: Request<tonic::Streaming<proto::PushSandboxLogsRequest>>,
    ) -> std::result::Result<Response<proto::PushSandboxLogsResponse>, Status> {
        let mut stream = request.into_inner();
        while let Some(batch) = stream.message().await? {
            let Some(name) = self.state.name_for_id(&batch.sandbox_id) else {
                return Err(Status::not_found(format!(
                    "sandbox {} not found",
                    batch.sandbox_id
                )));
            };
            let mut text = String::new();
            for line in batch.logs {
                text.push_str(&line.message);
                text.push('\n');
            }
            use std::io::Write as _;
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.state.logs_file(&name))
                .map_err(|error| Status::internal(error.to_string()))?;
            file.write_all(text.as_bytes())
                .map_err(|error| Status::internal(error.to_string()))?;
        }
        Ok(Response::new(proto::PushSandboxLogsResponse {}))
    }

    async fn watch_sandbox(
        &self,
        request: Request<proto::WatchSandboxRequest>,
    ) -> std::result::Result<Response<Self::WatchSandboxStream>, Status> {
        let request = request.into_inner();
        let record = self
            .state
            .record(&request.sandbox)
            .ok_or_else(|| Status::not_found(format!("sandbox {} not found", request.sandbox)))?;
        let mut events: Vec<std::result::Result<proto::SandboxStreamEvent, Status>> = Vec::new();
        if request.follow_logs {
            let tail = if request.log_tail_lines == 0 {
                0
            } else {
                request.log_tail_lines as usize
            };
            for (index, message) in recorded_logs(&self.state.logs_file(&record.name), tail)
                .into_iter()
                .enumerate()
            {
                events.push(Ok(proto::SandboxStreamEvent {
                    payload: Some(proto::sandbox_stream_event::Payload::Log(log_line(
                        &record.id, message,
                    ))),
                    cursor: format!("{}", index + 1),
                }));
            }
        }
        Ok(Response::new(
            Box::pin(tokio_stream::iter(events)) as Self::WatchSandboxStream
        ))
    }

    // Everything below is outside the plane's modeled surface. Each answer
    // names the operation, so a gap is reported rather than returning an empty
    // success.
    async fn get_current_user(
        &self,
        _request: Request<proto::GetCurrentUserRequest>,
    ) -> std::result::Result<Response<proto::GetCurrentUserResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: get_current_user"))
    }

    async fn get_gateway_info(
        &self,
        _request: Request<proto::GetGatewayInfoRequest>,
    ) -> std::result::Result<Response<proto::GetGatewayInfoResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: get_gateway_info"))
    }

    async fn begin_rootfs_tar_staging(
        &self,
        _request: Request<proto::BeginRootfsTarStagingRequest>,
    ) -> std::result::Result<Response<proto::BeginRootfsTarStagingResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: begin_rootfs_tar_staging",
        ))
    }

    async fn create_sandbox_template(
        &self,
        _request: Request<proto::CreateSandboxTemplateRequest>,
    ) -> std::result::Result<Response<proto::SandboxTemplateResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: create_sandbox_template",
        ))
    }

    async fn get_sandbox_template(
        &self,
        _request: Request<proto::GetSandboxTemplateRequest>,
    ) -> std::result::Result<Response<proto::SandboxTemplateResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_sandbox_template",
        ))
    }

    async fn list_sandbox_templates(
        &self,
        _request: Request<proto::ListSandboxTemplatesRequest>,
    ) -> std::result::Result<Response<proto::ListSandboxTemplatesResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: list_sandbox_templates",
        ))
    }

    async fn delete_sandbox_template(
        &self,
        _request: Request<proto::DeleteSandboxTemplateRequest>,
    ) -> std::result::Result<Response<proto::DeleteSandboxTemplateResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: delete_sandbox_template",
        ))
    }

    async fn get_sandbox_provider_status(
        &self,
        _request: Request<proto::GetSandboxProviderStatusRequest>,
    ) -> std::result::Result<Response<proto::GetSandboxProviderStatusResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_sandbox_provider_status",
        ))
    }

    async fn create_ssh_session(
        &self,
        _request: Request<proto::CreateSshSessionRequest>,
    ) -> std::result::Result<Response<proto::CreateSshSessionResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: create_ssh_session",
        ))
    }

    async fn expose_service(
        &self,
        _request: Request<proto::ExposeServiceRequest>,
    ) -> std::result::Result<Response<proto::ServiceEndpointResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: expose_service"))
    }

    async fn get_service(
        &self,
        _request: Request<proto::GetServiceRequest>,
    ) -> std::result::Result<Response<proto::ServiceEndpointResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: get_service"))
    }

    async fn list_services(
        &self,
        _request: Request<proto::ListServicesRequest>,
    ) -> std::result::Result<Response<proto::ListServicesResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: list_services"))
    }

    async fn delete_service(
        &self,
        _request: Request<proto::DeleteServiceRequest>,
    ) -> std::result::Result<Response<proto::DeleteServiceResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: delete_service"))
    }

    async fn revoke_ssh_session(
        &self,
        _request: Request<proto::RevokeSshSessionRequest>,
    ) -> std::result::Result<Response<proto::RevokeSshSessionResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: revoke_ssh_session",
        ))
    }

    async fn forward_tcp(
        &self,
        _request: Request<tonic::Streaming<proto::TcpForwardFrame>>,
    ) -> std::result::Result<Response<Self::ForwardTcpStream>, Status> {
        Err(Status::unimplemented("insandbox-gateway: forward_tcp"))
    }

    async fn exec_sandbox_interactive(
        &self,
        request: Request<tonic::Streaming<proto::ExecSandboxInput>>,
    ) -> std::result::Result<Response<Self::ExecSandboxInteractiveStream>, Status> {
        let mut frames = request.into_inner();
        let mut start = None;
        let mut early = Vec::new();
        while start.is_none() {
            match frames.message().await? {
                Some(frame) => match frame.payload {
                    Some(proto::exec_sandbox_input::Payload::Start(request)) => {
                        start = Some(request);
                    }
                    Some(proto::exec_sandbox_input::Payload::Stdin(bytes)) => early.extend(bytes),
                    Some(proto::exec_sandbox_input::Payload::Resize(_)) | None => {}
                },
                None => break,
            }
        }
        let request = start
            .ok_or_else(|| Status::invalid_argument("the interactive exec needs a start frame"))?;
        let (command, workdir, env, timeout) = self.exec_setup(&request)?;
        let mut stdin = request.stdin;
        stdin.extend(early);
        let (events, input) = exec::interactive(command, workdir, env, stdin, timeout)
            .map_err(|error| Status::internal(error.to_string()))?;
        // The request half stays open for input frames; closing it closes the
        // child's stdin, and dropping the response stream ends the process.
        tokio::spawn(async move {
            while let Ok(Some(frame)) = frames.message().await {
                if let Some(proto::exec_sandbox_input::Payload::Stdin(bytes)) = frame.payload {
                    if input.send(bytes).await.is_err() {
                        return;
                    }
                }
            }
            drop(input);
        });
        Ok(Response::new(
            Box::pin(events) as Self::ExecSandboxInteractiveStream
        ))
    }

    async fn create_provider(
        &self,
        request: Request<proto::CreateProviderRequest>,
    ) -> std::result::Result<Response<proto::ProviderResponse>, Status> {
        let provider = request
            .into_inner()
            .provider
            .ok_or_else(|| Status::invalid_argument("provider is required"))?;
        let name = provider
            .metadata
            .as_ref()
            .map(|metadata| metadata.name.trim().to_string())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| Status::invalid_argument("provider name is required"))?;
        // Only the name is recorded. The plane brokers no credential: a
        // value in the request is dropped here and never reaches the state
        // root or a transcript.
        let added = self
            .state
            .add_provider(&name)
            .map_err(|error| Status::internal(error.to_string()))?;
        if !added {
            return Err(Status::already_exists(format!(
                "provider {name} already exists"
            )));
        }
        Ok(Response::new(proto::ProviderResponse {
            provider: Some(proto::Provider {
                metadata: Some(proto::ObjectMeta {
                    name,
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        }))
    }

    async fn get_provider(
        &self,
        _request: Request<proto::GetProviderRequest>,
    ) -> std::result::Result<Response<proto::ProviderResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: get_provider"))
    }

    async fn get_provider_credentials(
        &self,
        _request: Request<proto::GetProviderCredentialsRequest>,
    ) -> std::result::Result<Response<proto::GetProviderCredentialsResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_provider_credentials",
        ))
    }

    async fn list_providers(
        &self,
        _request: Request<proto::ListProvidersRequest>,
    ) -> std::result::Result<Response<proto::ListProvidersResponse>, Status> {
        let providers = self
            .state
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
        Ok(Response::new(proto::ListProvidersResponse {
            providers,
            next_page_token: String::new(),
        }))
    }

    async fn list_provider_profiles(
        &self,
        _request: Request<proto::ListProviderProfilesRequest>,
    ) -> std::result::Result<Response<proto::ListProviderProfilesResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: list_provider_profiles",
        ))
    }

    async fn get_provider_profile(
        &self,
        _request: Request<proto::GetProviderProfileRequest>,
    ) -> std::result::Result<Response<proto::ProviderProfileResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_provider_profile",
        ))
    }

    async fn import_provider_profiles(
        &self,
        _request: Request<proto::ImportProviderProfilesRequest>,
    ) -> std::result::Result<Response<proto::ImportProviderProfilesResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: import_provider_profiles",
        ))
    }

    async fn update_provider_profiles(
        &self,
        _request: Request<proto::UpdateProviderProfilesRequest>,
    ) -> std::result::Result<Response<proto::UpdateProviderProfilesResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: update_provider_profiles",
        ))
    }

    async fn lint_provider_profiles(
        &self,
        _request: Request<proto::LintProviderProfilesRequest>,
    ) -> std::result::Result<Response<proto::LintProviderProfilesResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: lint_provider_profiles",
        ))
    }

    async fn update_provider(
        &self,
        _request: Request<proto::UpdateProviderRequest>,
    ) -> std::result::Result<Response<proto::ProviderResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: update_provider"))
    }

    async fn get_provider_refresh_status(
        &self,
        _request: Request<proto::GetProviderRefreshStatusRequest>,
    ) -> std::result::Result<Response<proto::GetProviderRefreshStatusResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_provider_refresh_status",
        ))
    }

    async fn configure_provider_refresh(
        &self,
        _request: Request<proto::ConfigureProviderRefreshRequest>,
    ) -> std::result::Result<Response<proto::ConfigureProviderRefreshResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: configure_provider_refresh",
        ))
    }

    async fn rotate_provider_credential(
        &self,
        _request: Request<proto::RotateProviderCredentialRequest>,
    ) -> std::result::Result<Response<proto::RotateProviderCredentialResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: rotate_provider_credential",
        ))
    }

    async fn delete_provider_refresh(
        &self,
        _request: Request<proto::DeleteProviderRefreshRequest>,
    ) -> std::result::Result<Response<proto::DeleteProviderRefreshResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: delete_provider_refresh",
        ))
    }

    async fn delete_provider(
        &self,
        _request: Request<proto::DeleteProviderRequest>,
    ) -> std::result::Result<Response<proto::DeleteProviderResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: delete_provider"))
    }

    async fn delete_provider_profile(
        &self,
        _request: Request<proto::DeleteProviderProfileRequest>,
    ) -> std::result::Result<Response<proto::DeleteProviderProfileResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: delete_provider_profile",
        ))
    }

    async fn get_sandbox_config(
        &self,
        _request: Request<proto::sandbox::v1::GetSandboxConfigRequest>,
    ) -> std::result::Result<Response<proto::sandbox::v1::GetSandboxConfigResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_sandbox_config",
        ))
    }

    async fn get_gateway_config(
        &self,
        _request: Request<proto::sandbox::v1::GetGatewayConfigRequest>,
    ) -> std::result::Result<Response<proto::sandbox::v1::GetGatewayConfigResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_gateway_config",
        ))
    }

    async fn update_config(
        &self,
        _request: Request<proto::UpdateConfigRequest>,
    ) -> std::result::Result<Response<proto::UpdateConfigResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: update_config"))
    }

    async fn get_sandbox_policy_status(
        &self,
        _request: Request<proto::GetSandboxPolicyStatusRequest>,
    ) -> std::result::Result<Response<proto::GetSandboxPolicyStatusResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_sandbox_policy_status",
        ))
    }

    async fn list_sandbox_policies(
        &self,
        _request: Request<proto::ListSandboxPoliciesRequest>,
    ) -> std::result::Result<Response<proto::ListSandboxPoliciesResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: list_sandbox_policies",
        ))
    }

    async fn report_policy_status(
        &self,
        _request: Request<proto::ReportPolicyStatusRequest>,
    ) -> std::result::Result<Response<proto::ReportPolicyStatusResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: report_policy_status",
        ))
    }

    async fn report_endpoint_status(
        &self,
        _request: Request<proto::ReportEndpointStatusRequest>,
    ) -> std::result::Result<Response<proto::ReportEndpointStatusResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: report_endpoint_status",
        ))
    }

    async fn report_provider_readiness(
        &self,
        _request: Request<proto::ReportProviderReadinessRequest>,
    ) -> std::result::Result<Response<proto::ReportProviderReadinessResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: report_provider_readiness",
        ))
    }

    async fn report_sandbox_configuration(
        &self,
        _request: Request<proto::ReportSandboxConfigurationRequest>,
    ) -> std::result::Result<Response<proto::ReportSandboxConfigurationResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: report_sandbox_configuration",
        ))
    }

    async fn get_sandbox_provider_environment(
        &self,
        _request: Request<proto::GetSandboxProviderEnvironmentRequest>,
    ) -> std::result::Result<Response<proto::GetSandboxProviderEnvironmentResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_sandbox_provider_environment",
        ))
    }

    async fn exchange_provider_subject_token(
        &self,
        _request: Request<proto::ExchangeProviderSubjectTokenRequest>,
    ) -> std::result::Result<Response<proto::ExchangeProviderSubjectTokenResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: exchange_provider_subject_token",
        ))
    }

    async fn connect_supervisor(
        &self,
        _request: Request<tonic::Streaming<proto::SupervisorMessage>>,
    ) -> std::result::Result<Response<Self::ConnectSupervisorStream>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: connect_supervisor",
        ))
    }

    async fn report_main_process_exit(
        &self,
        _request: Request<proto::ReportMainProcessExitRequest>,
    ) -> std::result::Result<Response<proto::ReportMainProcessExitResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: report_main_process_exit",
        ))
    }

    async fn finalize_main_process_exit(
        &self,
        _request: Request<proto::FinalizeMainProcessExitRequest>,
    ) -> std::result::Result<Response<proto::FinalizeMainProcessExitResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: finalize_main_process_exit",
        ))
    }

    async fn relay_stream(
        &self,
        _request: Request<tonic::Streaming<proto::RelayFrame>>,
    ) -> std::result::Result<Response<Self::RelayStreamStream>, Status> {
        Err(Status::unimplemented("insandbox-gateway: relay_stream"))
    }

    async fn peer_relay(
        &self,
        _request: Request<tonic::Streaming<proto::PeerRelayFrame>>,
    ) -> std::result::Result<Response<Self::PeerRelayStream>, Status> {
        Err(Status::unimplemented("insandbox-gateway: peer_relay"))
    }

    async fn peer_report_provider_readiness(
        &self,
        _request: Request<proto::ReportProviderReadinessRequest>,
    ) -> std::result::Result<Response<proto::ReportProviderReadinessResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: peer_report_provider_readiness",
        ))
    }

    async fn peer_report_endpoint_status(
        &self,
        _request: Request<proto::ReportEndpointStatusRequest>,
    ) -> std::result::Result<Response<proto::ReportEndpointStatusResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: peer_report_endpoint_status",
        ))
    }

    async fn peer_get_sandbox_provider_status(
        &self,
        _request: Request<proto::GetSandboxProviderStatusRequest>,
    ) -> std::result::Result<Response<proto::GetSandboxProviderStatusResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: peer_get_sandbox_provider_status",
        ))
    }

    async fn peer_notify_config_update(
        &self,
        _request: Request<proto::PeerNotifyConfigUpdateRequest>,
    ) -> std::result::Result<Response<proto::PeerNotifyConfigUpdateResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: peer_notify_config_update",
        ))
    }

    async fn submit_policy_analysis(
        &self,
        _request: Request<proto::SubmitPolicyAnalysisRequest>,
    ) -> std::result::Result<Response<proto::SubmitPolicyAnalysisResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: submit_policy_analysis",
        ))
    }

    async fn approve_draft_chunk(
        &self,
        _request: Request<proto::ApproveDraftChunkRequest>,
    ) -> std::result::Result<Response<proto::ApproveDraftChunkResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: approve_draft_chunk",
        ))
    }

    async fn reject_draft_chunk(
        &self,
        _request: Request<proto::RejectDraftChunkRequest>,
    ) -> std::result::Result<Response<proto::RejectDraftChunkResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: reject_draft_chunk",
        ))
    }

    async fn approve_all_draft_chunks(
        &self,
        _request: Request<proto::ApproveAllDraftChunksRequest>,
    ) -> std::result::Result<Response<proto::ApproveAllDraftChunksResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: approve_all_draft_chunks",
        ))
    }

    async fn edit_draft_chunk(
        &self,
        _request: Request<proto::EditDraftChunkRequest>,
    ) -> std::result::Result<Response<proto::EditDraftChunkResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: edit_draft_chunk"))
    }

    async fn undo_draft_chunk(
        &self,
        _request: Request<proto::UndoDraftChunkRequest>,
    ) -> std::result::Result<Response<proto::UndoDraftChunkResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: undo_draft_chunk"))
    }

    async fn clear_draft_chunks(
        &self,
        _request: Request<proto::ClearDraftChunksRequest>,
    ) -> std::result::Result<Response<proto::ClearDraftChunksResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: clear_draft_chunks",
        ))
    }

    async fn get_draft_history(
        &self,
        _request: Request<proto::GetDraftHistoryRequest>,
    ) -> std::result::Result<Response<proto::GetDraftHistoryResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: get_draft_history",
        ))
    }

    async fn issue_sandbox_token(
        &self,
        _request: Request<proto::IssueSandboxTokenRequest>,
    ) -> std::result::Result<Response<proto::IssueSandboxTokenResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: issue_sandbox_token",
        ))
    }

    async fn refresh_sandbox_token(
        &self,
        _request: Request<proto::RefreshSandboxTokenRequest>,
    ) -> std::result::Result<Response<proto::RefreshSandboxTokenResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: refresh_sandbox_token",
        ))
    }

    async fn create_workspace(
        &self,
        _request: Request<proto::CreateWorkspaceRequest>,
    ) -> std::result::Result<Response<proto::CreateWorkspaceResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: create_workspace"))
    }

    async fn get_workspace(
        &self,
        _request: Request<proto::GetWorkspaceRequest>,
    ) -> std::result::Result<Response<proto::GetWorkspaceResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: get_workspace"))
    }

    async fn list_workspaces(
        &self,
        _request: Request<proto::ListWorkspacesRequest>,
    ) -> std::result::Result<Response<proto::ListWorkspacesResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: list_workspaces"))
    }

    async fn delete_workspace(
        &self,
        _request: Request<proto::DeleteWorkspaceRequest>,
    ) -> std::result::Result<Response<proto::DeleteWorkspaceResponse>, Status> {
        Err(Status::unimplemented("insandbox-gateway: delete_workspace"))
    }

    async fn add_workspace_member(
        &self,
        _request: Request<proto::AddWorkspaceMemberRequest>,
    ) -> std::result::Result<Response<proto::AddWorkspaceMemberResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: add_workspace_member",
        ))
    }

    async fn remove_workspace_member(
        &self,
        _request: Request<proto::RemoveWorkspaceMemberRequest>,
    ) -> std::result::Result<Response<proto::RemoveWorkspaceMemberResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: remove_workspace_member",
        ))
    }

    async fn list_workspace_members(
        &self,
        _request: Request<proto::ListWorkspaceMembersRequest>,
    ) -> std::result::Result<Response<proto::ListWorkspaceMembersResponse>, Status> {
        Err(Status::unimplemented(
            "insandbox-gateway: list_workspace_members",
        ))
    }
}

/// Parse the recorded policy chunk lines (the CLI stub's documented format).
fn policy_chunks(path: &std::path::Path) -> Vec<proto::PolicyChunk> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut chunks = Vec::new();
    for line in text.lines() {
        // `chunk-id|rule-name|binary|host:port|verdict`
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_non_guarantee_is_printed_before_the_listener() {
        let mut output = Vec::new();
        announce(&mut output, "127.0.0.1:4444".parse().expect("address")).expect("announced");
        let text = String::from_utf8(output).expect("utf8");
        let non_guarantee = text
            .find("enforces no isolation or policy")
            .expect("stated");
        let listener = text.find(LISTENING_PREFIX).expect("announced");
        assert!(
            non_guarantee < listener,
            "the non-guarantee precedes the listener: {text}"
        );
        assert!(text.contains("http://127.0.0.1:4444"));
    }

    #[test]
    fn a_sandbox_path_is_rewritten_only_at_a_boundary() {
        let root = "/private/plane/sandboxes/demo/root";
        let cases = [
            ("/sandbox", "/private/plane/sandboxes/demo/root/sandbox"),
            (
                "/sandbox/project",
                "/private/plane/sandboxes/demo/root/sandbox/project",
            ),
            (
                "cd /sandbox && ls",
                "cd /private/plane/sandboxes/demo/root/sandbox && ls",
            ),
            (
                "${HOME:-/sandbox}",
                "${HOME:-/private/plane/sandboxes/demo/root/sandbox}",
            ),
            (
                "PATH=/sandbox/bin:/usr/bin",
                "PATH=/private/plane/sandboxes/demo/root/sandbox/bin:/usr/bin",
            ),
            (
                "ROOT=/sandbox",
                "ROOT=/private/plane/sandboxes/demo/root/sandbox",
            ),
            (
                "'/sandbox/.e2e'",
                "'/private/plane/sandboxes/demo/root/sandbox/.e2e'",
            ),
            ("apply_patch /sandboxx", "apply_patch /sandboxx"),
            ("an unanchored word: sandbox", "an unanchored word: sandbox"),
        ];
        for (input, expected) in cases {
            assert_eq!(rewrite_sandbox_path(input, root), expected, "{input}");
        }
    }
}
