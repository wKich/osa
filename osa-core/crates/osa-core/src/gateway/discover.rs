//! Where the typed client's endpoint comes from.
//!
//! Resolution order: an explicit selection (the `--gateway` flag, the
//! `OPENSHELL_GATEWAY` environment variable, or the project's `gateway` config
//! key), then one `openshell gateway info --output json` call memoized for the
//! process lifetime.
//!
//! The private gateway registry that the CLI keeps on disk is never read: it is
//! an undocumented format owned by OpenShell, and one change to it would break
//! every command at once.
//!
//! A gateway that reports an authentication mode the client cannot express
//! (mTLS client certificates) fails here, before any operation, rather than
//! silently falling back to the CLI: a per-operation fallback would make the
//! transport depend on host configuration and give one command two behaviors.

use std::sync::{Arc, OnceLock};

use super::cli::Cli;
use super::error::GatewayError;

/// The sources a failed discovery names, in the order they were tried.
pub const SOURCES: &str =
    "the --gateway flag, OPENSHELL_GATEWAY, the project's gateway key, openshell gateway info";

/// How the gateway authenticates callers. The client speaks plaintext and
/// bearer-token TLS; a client-certificate gateway is out of scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMode {
    Plaintext,
    Bearer,
    Mtls,
}

impl AuthMode {
    pub fn name(self) -> &'static str {
        match self {
            AuthMode::Plaintext => "none",
            AuthMode::Bearer => "bearer",
            AuthMode::Mtls => "mtls",
        }
    }
}

/// A resolved gateway: the name, the URL to connect to, and how it
/// authenticates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub gateway: String,
    pub server: String,
    pub auth: AuthMode,
    pub version: String,
}

impl Endpoint {
    /// Fails when the gateway's authentication mode is one the client cannot
    /// express. There is no accept-any-certificate path.
    pub fn ensure_supported(&self) -> Result<(), GatewayError> {
        match self.auth {
            AuthMode::Mtls => Err(GatewayError::UnsupportedAuth {
                mode: "mtls".to_string(),
            }),
            AuthMode::Plaintext | AuthMode::Bearer => Ok(()),
        }
    }
}

/// Where a [`Discovery`] gets its answer. The production source runs the CLI;
/// tests substitute a source that counts its calls.
pub trait InfoSource: Send + Sync {
    /// Report the gateway named by `explicit`, or the one the CLI has
    /// selected when it is `None`.
    fn info(&self, explicit: Option<&str>) -> Result<Endpoint, GatewayError>;
}

/// The production source: `openshell [-g NAME] gateway info --output json`.
#[derive(Debug, Clone, Default)]
pub struct CliSource {
    cli: Cli,
}

impl CliSource {
    pub fn new(program: impl Into<String>) -> Self {
        CliSource {
            cli: Cli::new(program),
        }
    }
}

impl InfoSource for CliSource {
    fn info(&self, explicit: Option<&str>) -> Result<Endpoint, GatewayError> {
        self.cli.gateway_info(explicit)
    }
}

/// One process's discovery. The first `resolve` does the work; every later
/// call returns the same answer without contacting anything.
pub struct Discovery {
    explicit: Option<String>,
    source: Arc<dyn InfoSource>,
    resolved: OnceLock<Result<Endpoint, GatewayError>>,
}

impl Discovery {
    pub fn new(explicit: Option<String>, source: Arc<dyn InfoSource>) -> Self {
        Discovery {
            explicit,
            source,
            resolved: OnceLock::new(),
        }
    }

    /// Resolve the endpoint once. An unsupported authentication mode is a
    /// discovery failure, so it is memoized like any other.
    pub fn resolve(&self) -> Result<Endpoint, GatewayError> {
        self.resolved
            .get_or_init(|| {
                let endpoint = self.source.info(self.explicit.as_deref())?;
                endpoint.ensure_supported()?;
                Ok(endpoint)
            })
            .clone()
    }
}

/// The process-wide discovery: explicit selection first, then the memoized
/// CLI call.
pub fn discover(explicit: Option<&str>) -> Result<Endpoint, GatewayError> {
    static PROCESS: OnceLock<Discovery> = OnceLock::new();
    PROCESS
        .get_or_init(|| {
            Discovery::new(explicit.map(str::to_string), Arc::new(CliSource::default()))
        })
        .resolve()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    struct Counting {
        calls: AtomicUsize,
        asked: Mutex<Vec<Option<String>>>,
        answer: Result<Endpoint, GatewayError>,
    }

    impl Counting {
        fn answering(answer: Result<Endpoint, GatewayError>) -> Arc<Self> {
            Arc::new(Counting {
                calls: AtomicUsize::new(0),
                asked: Mutex::new(Vec::new()),
                answer,
            })
        }
    }

    impl InfoSource for Counting {
        fn info(&self, explicit: Option<&str>) -> Result<Endpoint, GatewayError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.asked
                .lock()
                .expect("lock")
                .push(explicit.map(str::to_string));
            self.answer.clone()
        }
    }

    fn endpoint(auth: AuthMode) -> Endpoint {
        Endpoint {
            gateway: "local".to_string(),
            server: "http://127.0.0.1:8080".to_string(),
            auth,
            version: "0.1.5".to_string(),
        }
    }

    #[test]
    fn discovery_runs_once_per_process() {
        let source = Counting::answering(Ok(endpoint(AuthMode::Plaintext)));
        let discovery = Discovery::new(None, source.clone());
        for _ in 0..5 {
            discovery.resolve().expect("resolved");
        }
        assert_eq!(source.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn the_explicit_selection_is_the_only_gateway_asked_for() {
        let source = Counting::answering(Ok(endpoint(AuthMode::Bearer)));
        let discovery = Discovery::new(Some("team".to_string()), source.clone());
        let resolved = discovery.resolve().expect("resolved");
        assert_eq!(resolved.auth, AuthMode::Bearer);
        assert_eq!(source.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            source.asked.lock().expect("lock").as_slice(),
            &[Some("team".to_string())]
        );
    }

    #[test]
    fn an_mtls_gateway_fails_naming_the_mode_and_the_alternatives() {
        let source = Counting::answering(Ok(endpoint(AuthMode::Mtls)));
        let discovery = Discovery::new(None, source.clone());
        let error = discovery.resolve().expect_err("mtls is unsupported");
        assert_eq!(
            error,
            GatewayError::UnsupportedAuth {
                mode: "mtls".to_string()
            }
        );
        let message = error.message();
        assert!(message.contains("'mtls'"), "{message}");
        assert!(message.contains("bearer-token"), "{message}");
        assert!(message.contains("plaintext"), "{message}");
        // No fallback: the CLI is not asked a second time, and the failure is
        // memoized like a success.
        let again = discovery.resolve().expect_err("still unsupported");
        assert_eq!(again, error);
        assert_eq!(source.calls.load(Ordering::SeqCst), 1);
        assert_eq!(error.code(), 2);
    }

    #[test]
    fn a_discovery_failure_names_the_gateway_the_sources_and_the_fix() {
        let source = Counting::answering(Err(GatewayError::Unreachable {
            endpoint: "team".to_string(),
            sources: SOURCES.to_string(),
            fix: super::super::cli::DISCOVERY_FIX.to_string(),
        }));
        let error = Discovery::new(Some("team".to_string()), source)
            .resolve()
            .expect_err("unreachable");
        let message = error.message();
        assert!(message.contains("gateway 'team'"), "{message}");
        assert!(message.contains("--gateway flag"), "{message}");
        assert!(message.contains("OPENSHELL_GATEWAY"), "{message}");
        assert!(message.contains("openshell gateway info"), "{message}");
        assert!(message.contains("openshell status"), "{message}");
        assert_eq!(error.code(), 3);
    }
}
