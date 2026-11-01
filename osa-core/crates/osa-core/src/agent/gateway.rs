//! The OpenShell seam: every gateway call the front-ends make.

use std::os::unix::io::FromRawFd;
use std::process::{Command, Output, Stdio};

use crate::gateway;

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

    fn capture(&self, args: &[&str]) -> Option<Output> {
        self.openshell(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .output()
            .ok()
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

    pub fn sandbox_phase(&self, name: &str) -> Result<Option<String>, Failure> {
        self.require_openshell()?;
        let output = self.capture(&["sandbox", "list", "--output", "json"]);
        let Some(output) = output.filter(|output| output.status.success()) else {
            return Err(Failure::gateway(format!(
                "cannot list sandboxes; is the gateway running? Try '{} doctor'",
                self.program()
            )));
        };
        let payload = String::from_utf8_lossy(&output.stdout);
        let found = gateway::sandboxes(&payload).ok().and_then(|sandboxes| {
            sandboxes
                .into_iter()
                .find(|sandbox| sandbox.name == name)
                .and_then(|sandbox| sandbox.phase)
        });
        Ok(found)
    }

    pub fn sandbox_id(&self, name: &str) -> Option<String> {
        if let Some(output) = self.capture(&["sandbox", "get", name, "--output", "json"]) {
            if output.status.success() {
                let payload = String::from_utf8_lossy(&output.stdout);
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) {
                    if let Some(id) = value.get("id").and_then(serde_json::Value::as_str) {
                        return Some(id.to_string());
                    }
                }
                if let Some(id) = json_field(&payload, "id") {
                    return Some(id);
                }
                return None;
            }
        }
        let output = self.capture(&["sandbox", "get", name])?;
        if !output.status.success() {
            return None;
        }
        let payload = String::from_utf8_lossy(&output.stdout);
        payload.lines().find_map(|line| {
            line.trim()
                .strip_prefix("Id:")
                .map(|id| id.trim().to_string())
        })
    }

    pub fn attached_providers(&self, name: &str) -> Result<Vec<String>, Failure> {
        let output = self.capture(&["sandbox", "provider", "list", name, "--output", "json"]);
        let Some(output) = output.filter(|output| output.status.success()) else {
            return Err(Failure::gateway(format!(
                "cannot list providers attached to '{name}'"
            )));
        };
        let payload = String::from_utf8_lossy(&output.stdout);
        gateway::providers(&payload)
            .map_err(|_| Failure::gateway(format!("cannot list providers attached to '{name}'")))
    }

    pub fn gateway_provider_names(&self) -> Result<Vec<String>, Failure> {
        let output = self.capture(&["provider", "list", "--names"]);
        let Some(output) = output.filter(|output| output.status.success()) else {
            return Err(Failure::gateway(format!(
                "cannot list providers; is the gateway running? Try '{} doctor'",
                self.program()
            )));
        };
        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect())
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
        let output = self
            .openshell(&[
                "sandbox",
                "exec",
                "-n",
                name,
                "--no-login-shell",
                "--",
                "sh",
                "-c",
                "mkdir -p \"$1\"",
                &format!("{}-git", self.program()),
                workdir,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output();
        matches!(output, Ok(output) if output.status.success())
    }

    pub fn sandbox_script_bytes(&self, name: &str, workdir: &str, script: &str) -> Option<Vec<u8>> {
        let git_dir = sandbox_git_dir(workdir, self.profile.state_name);
        let output = self
            .openshell(&[
                "sandbox",
                "exec",
                "-n",
                name,
                "--no-login-shell",
                "--workdir",
                workdir,
                "--",
                "sh",
                "-c",
                script,
            ])
            .arg(format!("{}-git", self.program()))
            .arg(&git_dir)
            .arg(workdir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        output.status.success().then_some(output.stdout)
    }

    pub fn sandbox_script_output(
        &self,
        name: &str,
        workdir: &str,
        script: &str,
        extra: Option<&str>,
    ) -> Option<std::process::Output> {
        let git_dir = sandbox_git_dir(workdir, self.profile.state_name);
        let mut command = self.openshell(&[
            "sandbox",
            "exec",
            "-n",
            name,
            "--no-login-shell",
            "--workdir",
            workdir,
            "--",
            "sh",
            "-c",
            script,
        ]);
        command
            .arg(format!("{}-git", self.program()))
            .arg(&git_dir)
            .arg(workdir);
        if let Some(extra) = extra {
            command.arg(extra);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
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
        if !output.status.success() {
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

fn json_field(payload: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let rest = &payload[payload.find(&needle)? + needle.len()..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}
