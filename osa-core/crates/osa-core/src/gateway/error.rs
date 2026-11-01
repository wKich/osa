//! The transport error taxonomy.
//!
//! One variant per failure class a command branches on, so the create-race
//! reuse path and the policy-denied path are a `match` rather than a substring
//! search over gateway text. [`GatewayError::message`] and
//! [`GatewayError::code`] are the single mapping to what a command prints and
//! exits with; no call site composes either by hand.

use std::fmt;

/// A gateway failure. Every variant carries the fields its message needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayError {
    /// The gateway could not be contacted at all.
    Unreachable {
        endpoint: String,
        sources: String,
        fix: String,
    },
    /// The gateway answered and rejected the caller's identity.
    Unauthenticated { endpoint: String, status: u16 },
    /// The named sandbox is not on the gateway.
    NotFound { sandbox: String },
    /// The name is taken; the create-race path re-reads and reuses.
    AlreadyExists { sandbox: String },
    /// The gateway refused the operation by policy.
    PolicyDenied { sandbox: String, detail: String },
    /// A readiness or deletion wait elapsed.
    Timeout {
        sandbox: String,
        phase: String,
        seconds: u64,
    },
    /// A credentialed request was rejected; the value stays out of the text.
    CredentialRejected { field: String, status: u16 },
    /// The gateway uses an authentication mode the client cannot express.
    UnsupportedAuth { mode: String },
    /// The `openshell` CLI is needed (discovery, file transfer) but absent.
    MissingCli { program: String },
    /// Everything else the gateway reported.
    Failed {
        operation: &'static str,
        detail: String,
    },
}

impl GatewayError {
    /// The exit code the documented message belongs to: `2` for a missing
    /// local dependency, `3` for a gateway failure.
    pub fn code(&self) -> i32 {
        match self {
            GatewayError::MissingCli { .. } | GatewayError::UnsupportedAuth { .. } => 2,
            _ => 3,
        }
    }

    /// The documented message, one line, no credential value.
    pub fn message(&self) -> String {
        match self {
            GatewayError::Unreachable {
                endpoint,
                sources,
                fix,
            } => format!(
                "gateway '{endpoint}' is unreachable (tried {sources}); {fix}"
            ),
            GatewayError::Unauthenticated { endpoint, status } => format!(
                "gateway '{endpoint}' rejected the caller's credentials (status {status}); refresh the gateway login on the host"
            ),
            GatewayError::NotFound { sandbox } => {
                format!("sandbox '{sandbox}' is not on the gateway")
            }
            GatewayError::AlreadyExists { sandbox } => {
                format!("sandbox '{sandbox}' already exists on the gateway")
            }
            GatewayError::PolicyDenied { sandbox, detail } => {
                format!("gateway policy denied the operation on sandbox '{sandbox}': {detail}")
            }
            GatewayError::Timeout {
                sandbox,
                phase,
                seconds,
            } => format!("sandbox '{sandbox}' is still '{phase}' after {seconds} seconds"),
            GatewayError::CredentialRejected { field, status } => format!(
                "gateway rejected the credential in field '{field}' (status {status})"
            ),
            GatewayError::UnsupportedAuth { mode } => format!(
                "gateway authentication mode '{mode}' is not supported by the typed client; use bearer-token or plaintext transport (OPENSHELL_TOKEN with a bearer gateway), or run the operation through the openshell CLI"
            ),
            GatewayError::MissingCli { program } => format!(
                "cannot run {program}: install the OpenShell CLI from https://github.com/NVIDIA/OpenShell"
            ),
            GatewayError::Failed { operation, detail } => {
                format!("{operation} failed: {detail}")
            }
        }
    }
}

impl fmt::Display for GatewayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for GatewayError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> Vec<(GatewayError, &'static str, i32)> {
        vec![
            (
                GatewayError::Unreachable {
                    endpoint: "local".into(),
                    sources: "explicit, OPENSHELL_GATEWAY, openshell gateway info".into(),
                    fix: "start it: openshell status".into(),
                },
                "gateway 'local' is unreachable (tried explicit, OPENSHELL_GATEWAY, openshell gateway info); start it: openshell status",
                3,
            ),
            (
                GatewayError::Unauthenticated {
                    endpoint: "local".into(),
                    status: 401,
                },
                "gateway 'local' rejected the caller's credentials (status 401); refresh the gateway login on the host",
                3,
            ),
            (
                GatewayError::NotFound {
                    sandbox: "box".into(),
                },
                "sandbox 'box' is not on the gateway",
                3,
            ),
            (
                GatewayError::AlreadyExists {
                    sandbox: "box".into(),
                },
                "sandbox 'box' already exists on the gateway",
                3,
            ),
            (
                GatewayError::PolicyDenied {
                    sandbox: "box".into(),
                    detail: "egress denied".into(),
                },
                "gateway policy denied the operation on sandbox 'box': egress denied",
                3,
            ),
            (
                GatewayError::Timeout {
                    sandbox: "box".into(),
                    phase: "Starting".into(),
                    seconds: 120,
                },
                "sandbox 'box' is still 'Starting' after 120 seconds",
                3,
            ),
            (
                GatewayError::CredentialRejected {
                    field: "api_key".to_string(),
                    status: 400,
                },
                "gateway rejected the credential in field 'api_key' (status 400)",
                3,
            ),
            (
                GatewayError::UnsupportedAuth {
                    mode: "mtls".into(),
                },
                "gateway authentication mode 'mtls' is not supported by the typed client; use bearer-token or plaintext transport (OPENSHELL_TOKEN with a bearer gateway), or run the operation through the openshell CLI",
                2,
            ),
            (
                GatewayError::MissingCli {
                    program: "openshell".into(),
                },
                "cannot run openshell: install the OpenShell CLI from https://github.com/NVIDIA/OpenShell",
                2,
            ),
            (
                GatewayError::Failed {
                    operation: "openshell sandbox list",
                    detail: "response is missing required field \"sandboxes\"".into(),
                },
                "openshell sandbox list failed: response is missing required field \"sandboxes\"",
                3,
            ),
        ]
    }

    #[test]
    fn every_variant_pins_its_documented_message_and_code() {
        for (error, message, code) in table() {
            assert_eq!(error.message(), message, "{error:?}");
            assert_eq!(error.to_string(), message, "{error:?}");
            assert_eq!(error.code(), code, "{error:?}");
        }
    }

    #[test]
    fn the_wait_timeout_matches_the_recorded_shell_message() {
        // tests/run-tests.sh asserts this line verbatim for a sandbox that
        // never becomes ready.
        let error = GatewayError::Timeout {
            sandbox: "demo".into(),
            phase: "Starting".into(),
            seconds: 120,
        };
        assert_eq!(
            error.message(),
            "sandbox 'demo' is still 'Starting' after 120 seconds"
        );
    }
}
