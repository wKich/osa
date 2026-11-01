//! The remaining OpenShell CLI surface.
//!
//! The typed client covers sandbox lifecycle, waits, exec, log streaming,
//! providers, and rules. Everything else stays here, so a reviewer can read the
//! whole un-converted surface in one file:
//!
//! - gateway endpoint discovery (`gateway info --output json`), because the
//!   client does not read the CLI's gateway configuration from disk;
//! - file upload and download, because the client's curated surface has no file
//!   transfer and `raw_grpc` coverage for it is unverified;
//! - the commands the change does not convert at all: policy show/apply/reject,
//!   settings, and provider profile import.
//!
//! Nothing here may be called twice per operation: discovery is memoized by
//! [`super::discover`], and file transfer runs exactly once per file.

use std::io::ErrorKind;
use std::process::{Command, Stdio};

use super::discover::SOURCES;
use super::discover::{AuthMode, Endpoint};
use super::error::GatewayError;

/// The documented recovery line a failed discovery carries.
pub const DISCOVERY_FIX: &str =
    "start it with 'openshell status'; if that is not Connected, restart the gateway service";

/// A handle on the `openshell` CLI.
#[derive(Debug, Clone, Default)]
pub struct Cli {
    pub program: String,
}

impl Cli {
    pub fn new(program: impl Into<String>) -> Self {
        Cli {
            program: program.into(),
        }
    }

    fn program_name(&self) -> String {
        if self.program.is_empty() {
            "openshell".to_string()
        } else {
            self.program.clone()
        }
    }

    /// A prepared command, with the gateway selection first when there is one.
    pub fn command(&self, gateway: Option<&str>, args: &[&str]) -> Command {
        let mut command = Command::new(self.program_name());
        if let Some(gateway) = gateway {
            command.arg("-g").arg(gateway);
        }
        command.args(args);
        command
    }

    /// `openshell [-g NAME] gateway info --output json`, as the endpoint the
    /// typed client connects to.
    pub fn gateway_info(&self, explicit: Option<&str>) -> Result<Endpoint, GatewayError> {
        let program = self.program_name();
        let output = self
            .command(explicit, &["gateway", "info", "--output", "json"])
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .output();
        let output = match output {
            Ok(output) => output,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Err(GatewayError::MissingCli { program });
            }
            Err(error) => {
                return Err(GatewayError::Unreachable {
                    endpoint: explicit.unwrap_or("local").to_string(),
                    sources: SOURCES.to_string(),
                    fix: format!("{DISCOVERY_FIX} ({error})"),
                })
            }
        };
        if !output.status.success() {
            return Err(GatewayError::Unreachable {
                endpoint: explicit.unwrap_or("local").to_string(),
                sources: SOURCES.to_string(),
                fix: DISCOVERY_FIX.to_string(),
            });
        }
        parse_gateway_info(&String::from_utf8_lossy(&output.stdout), explicit)
    }
}

/// The stable subset of `openshell gateway info --output json`.
#[derive(serde::Deserialize)]
struct GatewayInfo {
    #[serde(default)]
    gateway: String,
    server: String,
    #[serde(default)]
    auth: Option<String>,
    #[serde(default)]
    version: String,
}

fn parse_gateway_info(payload: &str, explicit: Option<&str>) -> Result<Endpoint, GatewayError> {
    let info: GatewayInfo =
        serde_json::from_str(payload).map_err(|error| GatewayError::Failed {
            operation: "openshell gateway info",
            detail: format!("response is not the documented JSON: {error}"),
        })?;
    if info.server.trim().is_empty() {
        return Err(GatewayError::Failed {
            operation: "openshell gateway info",
            detail: "response is missing required field \"server\"".to_string(),
        });
    }
    let name = if !info.gateway.is_empty() {
        info.gateway
    } else {
        explicit.unwrap_or("local").to_string()
    };
    Ok(Endpoint {
        gateway: name,
        server: info.server,
        auth: match info.auth.as_deref() {
            Some("bearer") => AuthMode::Bearer,
            Some("mtls") => AuthMode::Mtls,
            _ => AuthMode::Plaintext,
        },
        version: info.version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAYLOAD: &str = r#"{
        "gateway": "local",
        "server": "http://127.0.0.1:8080",
        "auth": null,
        "status": "Connected",
        "version": "0.1.5",
        "compute_drivers": [],
        "extensions": []
    }"#;

    #[test]
    fn the_documented_json_shape_resolves() {
        let endpoint = parse_gateway_info(PAYLOAD, None).expect("parsed");
        assert_eq!(endpoint.gateway, "local");
        assert_eq!(endpoint.server, "http://127.0.0.1:8080");
        assert_eq!(endpoint.auth, AuthMode::Plaintext);
        assert_eq!(endpoint.version, "0.1.5");
    }

    #[test]
    fn the_auth_field_selects_the_mode() {
        assert_eq!(
            parse_gateway_info(&PAYLOAD.replace("null", "\"bearer\""), None)
                .expect("parsed")
                .auth,
            AuthMode::Bearer
        );
        assert_eq!(
            parse_gateway_info(&PAYLOAD.replace("null", "\"mtls\""), None)
                .expect("parsed")
                .auth,
            AuthMode::Mtls
        );
    }

    #[test]
    fn a_missing_server_names_the_field() {
        let error = parse_gateway_info(r#"{"gateway": "local", "server": ""}"#, None)
            .expect_err("no server");
        assert!(error.message().contains("\"server\""), "{error}");
    }

    #[test]
    fn a_payload_that_is_not_json_names_the_operation() {
        let error = parse_gateway_info("Gateway: local (https://example.test)", None)
            .expect_err("not json");
        assert!(error.message().starts_with("openshell gateway info failed"));
        assert_eq!(error.code(), 3);
    }

    #[test]
    fn the_explicit_name_is_kept_when_the_payload_omits_it() {
        let endpoint =
            parse_gateway_info(r#"{"server": "https://gw.test"}"#, Some("team")).expect("parsed");
        assert_eq!(endpoint.gateway, "team");
    }
}
