//! The OpenShell seam: every gateway call the front-ends make.

use std::os::unix::io::FromRawFd;
use std::process::{Command, Stdio};
use std::sync::Arc;

use crate::gateway::{
    self, ChunkSink, ExecInput, ExecOutput, ExecRequest, ExitStatus, Gateway, GatewayError,
    InteractiveExec,
};

use super::context::Context;
use super::failure::{Failure, Outcome};

impl Context {
    pub fn openshell(&self, args: &[&str]) -> Command {
        let mut command = Command::new("openshell");
        if let Some(gateway) = self.gateway() {
            command.arg("-g").arg(gateway);
        }
        command.args(args);
        command
    }

    /// Runs the command with inherited streams; a non-zero status is a
    /// gateway failure.
    pub fn run_gateway(&self, args: &[&str]) -> Outcome {
        let mut command = self.openshell(args);
        if self.gateway_stdout_to_stderr.get() {
            command.stdout(Stdio::from(unsafe {
                std::fs::File::from_raw_fd(libc::dup(2))
            }));
        }
        let status = command.status();
        let status = match status {
            Ok(status) => status,
            Err(error) => {
                return Err(Failure::dep(format!(
                    "cannot run openshell: {error}; install it from https://github.com/NVIDIA/OpenShell"
                )))
            }
        };
        if status.success() {
            return Ok(());
        }
        let code = crate::process::exit_code(status);
        Err(Failure::gateway(format!(
            "openshell command failed (exit status {code})"
        )))
    }

    pub fn require_openshell(&self) -> Outcome {
        if crate::state::command_in_path("openshell") {
            Ok(())
        } else {
            Err(Failure::dep(
                "openshell CLI not found on PATH; install it from https://github.com/NVIDIA/OpenShell",
            ))
        }
    }

    /// Map one typed failure onto the command's exit status and message.
    fn gateway_failure(error: GatewayError) -> Failure {
        Failure::new(error.code(), error.message())
    }

    /// Run one typed call, turning a transport failure into a command failure.
    fn gateway_call<T>(
        &self,
        call: impl FnOnce(Arc<dyn Gateway>) -> Result<T, GatewayError>,
    ) -> Result<T, Failure> {
        let client = self.client()?;
        call(client).map_err(Self::gateway_failure)
    }

    pub fn start_sandbox(&self, name: &str) -> Outcome {
        self.gateway_call(|client| gateway::block_on(client.start_sandbox(name)))
            .map(|_| ())
    }

    pub fn stop_sandbox(&self, name: &str) -> Outcome {
        self.gateway_call(|client| gateway::block_on(client.stop_sandbox(name)))
            .map(|_| ())
    }

    pub fn delete_sandbox(&self, name: &str) -> Outcome {
        self.gateway_call(|client| gateway::block_on(client.delete_sandbox(name)))
            .map(|_| ())
    }

    pub fn wait_ready(&self, name: &str, timeout: std::time::Duration) -> Outcome {
        self.gateway_call(|client| gateway::block_on(client.wait_ready(name, timeout)))
            .map(|_| ())
    }

    pub fn attach_provider(&self, name: &str, provider: &str) -> Outcome {
        self.gateway_call(|client| gateway::block_on(client.attach_provider(name, provider)))
    }

    pub fn list_sandboxes(&self) -> Result<Vec<gateway::Sandbox>, Failure> {
        self.gateway_call(|client| gateway::block_on(client.list_sandboxes()))
    }

    pub fn provider_names(&self) -> Result<Vec<String>, Failure> {
        self.gateway_call(|client| gateway::block_on(client.list_providers()))
    }

    pub fn attached_provider_names(&self, name: &str) -> Result<Vec<String>, Failure> {
        self.gateway_call(|client| gateway::block_on(client.attached_providers(name)))
    }

    /// One buffered exec, for probes and script reads whose whole output is
    /// needed. The interactive session stays on the CLI: the typed exec cannot
    /// inherit a terminal's stdin.
    pub fn exec_buffered(
        &self,
        name: &str,
        command: Vec<String>,
        workdir: Option<String>,
        no_login_shell: bool,
    ) -> Option<ExecOutput> {
        let request = ExecRequest {
            sandbox: name.to_string(),
            command,
            workdir,
            no_login_shell,
            stdin: None,
            timeout: None,
        };
        self.gateway_call(|client| gateway::block_on(client.exec_buffered(request)))
            .ok()
    }

    pub fn approve_rule(&self, name: &str, chunk: &str) -> Outcome {
        self.gateway_call(|client| gateway::block_on(client.approve_rule(name, chunk)))
    }

    pub fn rule_names(&self, name: &str, pending_only: bool) -> Result<Vec<String>, Failure> {
        let listing = self.gateway_call(|client| gateway::block_on(client.list_rules(name)))?;
        Ok(listing
            .rules
            .into_iter()
            .filter(|rule| !pending_only || rule.status.as_deref() == Some("pending"))
            .map(|rule| rule.name)
            .collect())
    }

    /// The structured rule listing for `name`, unfiltered.
    pub fn rule_listing(&self, name: &str) -> Result<gateway::RuleListing, Failure> {
        self.gateway_call(|client| gateway::block_on(client.list_rules(name)))
    }

    /// The create spec the documented flags describe, in the form both
    /// transports record before building a request.
    pub fn sandbox_spec(&self, name: &str) -> gateway::SandboxSpec {
        let cpu = self.cpu();
        let memory = self.memory();
        gateway::SandboxSpec {
            name: name.to_string(),
            image: self.image(),
            policy: Some(self.policy()).filter(|value| !value.is_empty()),
            cpu: (!cpu.is_empty()).then_some(cpu),
            memory: (!memory.is_empty()).then_some(memory),
            providers: self
                .providers()
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect(),
            env: self
                .options
                .envs
                .iter()
                .filter(|pair| !pair.is_empty())
                .cloned()
                .collect(),
            env_from: self
                .options
                .env_froms
                .iter()
                .filter(|pair| !pair.is_empty())
                .cloned()
                .collect(),
        }
    }

    /// One create through the transport. `Ok` covers a create that won;
    /// `AlreadyExists` is the caller's race path, not a hard failure.
    pub fn create_sandbox(&self, spec: gateway::SandboxSpec) -> Result<(), Failure> {
        self.gateway_call(|client| gateway::block_on(client.create_sandbox(spec)))
            .map(|_| ())
    }

    pub fn create_provider(&self, spec: gateway::ProviderSpec) -> Outcome {
        self.gateway_call(|client| gateway::block_on(client.create_provider(spec)))
    }

    /// One interactive or scripted exec through the transport, streaming
    /// output to `sink` and forwarding stdin and resize frames.
    pub fn exec_interactive(
        &self,
        exec: InteractiveExec,
        input: tokio::sync::mpsc::Receiver<ExecInput>,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, Failure> {
        self.gateway_call(|client| gateway::block_on(client.exec_interactive(exec, input, sink)))
    }

    /// Map one file-transfer failure onto the command's exit status and text.
    fn transfer_failure(error: gateway::cli::TransferError) -> Failure {
        match error {
            gateway::cli::TransferError::Spawn(error) => Failure::dep(format!(
                "cannot run openshell: {error}; install it from https://github.com/NVIDIA/OpenShell"
            )),
            gateway::cli::TransferError::Exit(code) => {
                Failure::gateway(format!("openshell command failed (exit status {code})"))
            }
        }
    }

    fn cli(&self) -> gateway::cli::Cli {
        gateway::cli::Cli::new("openshell")
    }

    pub fn upload(
        &self,
        name: &str,
        source: &str,
        destination: &str,
        no_git_ignore: bool,
    ) -> Outcome {
        self.cli()
            .upload(
                self.gateway().as_deref(),
                name,
                source,
                destination,
                no_git_ignore,
                self.gateway_stdout_to_stderr.get(),
            )
            .map_err(Self::transfer_failure)
    }

    pub fn download(&self, name: &str, source: &str, destination: &str) -> Outcome {
        self.download_to(name, source, destination, false)
    }

    /// A download whose progress goes to stderr, for a loop already writing a
    /// report to stdout.
    pub fn download_to(
        &self,
        name: &str,
        source: &str,
        destination: &str,
        stdout_to_stderr: bool,
    ) -> Outcome {
        self.cli()
            .download(
                self.gateway().as_deref(),
                name,
                source,
                destination,
                stdout_to_stderr || self.gateway_stdout_to_stderr.get(),
            )
            .map_err(Self::transfer_failure)
    }

    pub fn sandbox_phase(&self, name: &str) -> Result<Option<String>, Failure> {
        self.require_openshell()?;
        let client = self.client()?;
        match crate::gateway::block_on(client.get_sandbox(name)) {
            Ok(found) => Ok(found.and_then(|sandbox| sandbox.phase)),
            Err(_) => Err(Failure::gateway(format!(
                "cannot list sandboxes; is the gateway running? Try '{} doctor'",
                self.program()
            ))),
        }
    }

    pub fn sandbox_id(&self, name: &str) -> Option<String> {
        let client = self.client().ok()?;
        crate::gateway::block_on(client.get_sandbox(name))
            .ok()
            .flatten()
            .and_then(|sandbox| sandbox.id)
    }

    pub fn attached_providers(&self, name: &str) -> Result<Vec<String>, Failure> {
        self.attached_provider_names(name).map_err(|_| {
            Failure::gateway(format!("cannot list providers attached to '{name}'"))
        })
    }

    /// Every provider name on the gateway.
    pub fn gateway_provider_names(&self) -> Result<Vec<String>, Failure> {
        self.provider_names().map_err(|_| {
            Failure::gateway(format!(
                "cannot list providers; is the gateway running? Try '{} doctor'",
                self.program()
            ))
        })
    }

    pub fn enable_policy_advisor(&self, name: &str) -> bool {
        let status = self
            .openshell(&[
                "settings",
                "set",
                name,
                "--key",
                "agent_policy_proposals_enabled",
                "--value",
                "true",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        matches!(status, Ok(status) if status.success())
    }

    pub fn sandbox_mkdir(&self, name: &str, workdir: &str) -> bool {
        let command = vec![
            "sh".to_string(),
            "-c".to_string(),
            r#"mkdir -p "$1""#.to_string(),
            format!("{}-git", self.program()),
            workdir.to_string(),
        ];
        self.exec_buffered(name, command, None, true)
            .is_some_and(|output| output.exit_code == 0)
    }

    fn script_request(
        &self,
        name: &str,
        workdir: &str,
        script: &str,
        extra: Option<&str>,
    ) -> ExecRequest {
        let git_dir = sandbox_git_dir(workdir, self.profile.state_name);
        let mut command = vec![
            "sh".to_string(),
            "-c".to_string(),
            script.to_string(),
            format!("{}-git", self.program()),
            git_dir,
            workdir.to_string(),
        ];
        if let Some(extra) = extra {
            command.push(extra.to_string());
        }
        ExecRequest {
            sandbox: name.to_string(),
            command,
            workdir: Some(workdir.to_string()),
            no_login_shell: true,
            stdin: None,
            timeout: None,
        }
    }

    pub fn sandbox_script_bytes(&self, name: &str, workdir: &str, script: &str) -> Option<Vec<u8>> {
        let request = self.script_request(name, workdir, script, None);
        let output = self
            .gateway_call(|client| gateway::block_on(client.exec_buffered(request)))
            .ok()?;
        (output.exit_code == 0).then_some(output.stdout)
    }

    pub fn sandbox_script_output(
        &self,
        name: &str,
        workdir: &str,
        script: &str,
        extra: Option<&str>,
    ) -> Option<ExecOutput> {
        let request = self.script_request(name, workdir, script, extra);
        self.gateway_call(|client| gateway::block_on(client.exec_buffered(request)))
            .ok()
    }

    pub fn sandbox_script(
        &self,
        name: &str,
        workdir: &str,
        script: &str,
        extra: Option<&str>,
    ) -> Option<String> {
        let output = self.sandbox_script_output(name, workdir, script, extra)?;
        if output.exit_code != 0 {
            return None;
        }
        Some(
            String::from_utf8_lossy(&output.stdout)
                .trim_end()
                .to_string(),
        )
    }
}

pub fn sandbox_git_dir(workdir: &str, state_name: &str) -> String {
    if workdir == "/sandbox" || workdir.starts_with("/sandbox/") {
        return format!("/sandbox/{state_name}/git");
    }
    let parent = std::path::Path::new(workdir)
        .parent()
        .map(|parent| parent.display().to_string())
        .unwrap_or_default();
    format!("{parent}/{state_name}/git")
}
