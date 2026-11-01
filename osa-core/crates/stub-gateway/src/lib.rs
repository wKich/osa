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
    create_race: bool,
    delete_fail: bool,
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
            create_race: false,
            delete_fail: false,
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
        let Some(log) = &self.log else { return };
        if let Some(parent) = log.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let mut text = String::new();
        for word in words {
            text.push_str(word);
            text.push('\n');
        }
        text.push_str(SEPARATOR);
        text.push('\n');
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(log) {
            use std::io::Write;
            let _ = file.write_all(text.as_bytes());
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
        fs::write(
            self.ids_dir().join(name),
            format!(
                "id-{name}-{}-{}",
                std::process::id(),
                self.ids_dir().display()
            ),
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
        fs::write(self.providers_dir().join(name), providers.join("\n"))
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
        fs::write(self.state.join("providers.list"), names.join("\n"))
    }

    fn chunks(&self, sandbox: &str) -> Vec<proto::PolicyChunk> {
        let mut chunks = Vec::new();
        let file = self.state.join("rules").join(sandbox);
        let Ok(text) = fs::read_to_string(file) else {
            return chunks;
        };
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
        _ => proto::SandboxPhase::Unknown,
    };
    value as i32
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
        self.record(&["sandbox", "create", "--name", &name, "--detach"]);
        if name.is_empty() {
            return Err(tonic::Status::invalid_argument("sandbox name is required"));
        }
        let providers = request
            .spec
            .as_ref()
            .map(|spec| spec.providers.clone())
            .unwrap_or_default();
        let exists = self.phase(&name).is_some();
        if self.create_race && !exists {
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
        if self.delete_fail {
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
        self.record(&["sandbox", "exec", "-n", &name]);
        if self.phase(&name).is_none() {
            return Err(tonic::Status::not_found(format!(
                "sandbox {name} not found"
            )));
        }
        let mut events: Vec<std::result::Result<proto::ExecSandboxEvent, tonic::Status>> =
            Vec::new();
        let stdout = self.exec_stdout.clone();
        if !stdout.is_empty() {
            events.push(Ok(proto::ExecSandboxEvent {
                payload: Some(proto::exec_sandbox_event::Payload::Stdout(
                    proto::ExecSandboxStdout { data: stdout },
                )),
            }));
        }
        events.push(Ok(proto::ExecSandboxEvent {
            payload: Some(proto::exec_sandbox_event::Payload::Exit(
                proto::ExecSandboxExit {
                    exit_code: self.exec_exit,
                },
            )),
        }));
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
        Err(tonic::Status::unimplemented(
            "stub-gateway: exec_sandbox_interactive",
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
        let fields: Vec<&str> = provider.credentials.keys().map(String::as_str).collect();
        let mut words = vec!["provider", "create", "--name", &name];
        words.extend(fields.iter());
        self.record(&words);
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
        Err(tonic::Status::unimplemented(
            "stub-gateway: get_sandbox_logs",
        ))
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
        Err(tonic::Status::unimplemented("stub-gateway: watch_sandbox"))
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
        let chunks = self
            .chunks(&request.sandbox)
            .into_iter()
            .filter(|chunk| {
                request.status_filter.is_empty() || chunk.status == request.status_filter
            })
            .collect();
        Ok(tonic::Response::new(proto::GetDraftPolicyResponse {
            chunks,
            rolling_summary: String::new(),
            draft_version: 1,
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
        Err(tonic::Status::unimplemented(
            "stub-gateway: reject_draft_chunk",
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
