//! The gate that keeps the plane from running as an unsandboxed agent runner.
//!
//! Every condition is required and every refusal names the missing or
//! unsupported one:
//!
//! - the invoking identity is the sandbox uid/gid (1500) and the development
//!   image's marker exists;
//! - an explicit state root is supplied;
//! - the bind address is loopback;
//! - the transport is plaintext.
//!
//! Bearer tokens and mutual TLS are refused rather than downgraded. The gate
//! runs before any socket is bound, so a refusal opens no listener.

use std::ffi::OsString;
use std::net::SocketAddr;
use std::path::PathBuf;

/// The marker only the development image installs.
pub const MARKER: &str = "/etc/osa-dev/insandbox";

/// The line printed before the listener is announced.
pub const NON_GUARANTEE: &str = "insandbox-gateway: dev-only control plane: enforces no isolation or policy; its safety comes only from the osa sandbox it runs in";

/// What the gate observed about the current process.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Detection {
    pub uid: u32,
    pub gid: u32,
    pub marker: bool,
}

impl Detection {
    /// The real process identity and marker.
    pub fn current() -> Self {
        Detection {
            uid: unsafe { libc::getuid() },
            gid: unsafe { libc::getgid() },
            marker: std::path::Path::new(MARKER).is_file(),
        }
    }

    /// A detection that passes, for tests and for the documented in-image
    /// launch path. It is never selected by [`Detection::current`].
    pub fn inside_sandbox() -> Self {
        Detection {
            uid: 1500,
            gid: 1500,
            marker: true,
        }
    }
}

/// Why the plane refused to start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateError {
    Help,
    NotInsideSandbox(String),
    MissingStateRoot,
    InvalidListen(String),
    NonLoopback(String),
    UnsupportedTransport(String),
    UnknownOption(String),
    Io(String),
}

impl std::fmt::Display for GateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GateError::Help => write!(f, "help requested"),
            GateError::NotInsideSandbox(detail) => {
                write!(f, "sandbox detection failed: {detail}")
            }
            GateError::MissingStateRoot => write!(
                f,
                "the in-sandbox plane needs an explicit state root: pass --state-root <DIR>"
            ),
            GateError::InvalidListen(detail) => {
                write!(f, "invalid listen address: {detail}")
            }
            GateError::NonLoopback(address) => write!(
                f,
                "listen address {address} is not loopback: the plane binds a loopback address only"
            ),
            GateError::UnsupportedTransport(detail) => write!(f, "{detail}"),
            GateError::UnknownOption(option) => write!(f, "unknown option: {option}"),
            GateError::Io(detail) => write!(f, "{detail}"),
        }
    }
}

/// A validated launch configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlaneConfig {
    pub state_root: PathBuf,
    pub listen: SocketAddr,
}

/// Parse and validate the launch configuration. Nothing is bound here.
pub fn prepare(args: &[OsString], detection: &Detection) -> Result<PlaneConfig, GateError> {
    let mut state_root: Option<PathBuf> = None;
    let mut listen = "127.0.0.1:0".to_string();
    let mut bearer: Option<String> = None;
    let mut mutual_tls: Option<String> = None;

    let mut index = 0;
    while index < args.len() {
        let word = args[index].to_string_lossy();
        let (name, inline) = match word.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (word.to_string(), None),
        };
        let value = |index: &mut usize| -> Result<String, GateError> {
            if let Some(value) = &inline {
                return Ok(value.clone());
            }
            *index += 1;
            args.get(*index)
                .map(|value| value.to_string_lossy().into_owned())
                .ok_or_else(|| GateError::UnknownOption(format!("{name} needs a value")))
        };
        match name.as_str() {
            "--help" | "-h" => return Err(GateError::Help),
            "--state-root" => state_root = Some(PathBuf::from(value(&mut index)?)),
            "--listen" => listen = value(&mut index)?,
            "--token" | "--bearer-token" => bearer = Some(value(&mut index)?),
            "--tls-dir" | "--tls-cert" | "--tls-key" | "--tls-ca" => {
                mutual_tls = Some(value(&mut index)?)
            }
            other => return Err(GateError::UnknownOption(other.to_string())),
        }
        index += 1;
    }

    if detection.uid != 1500 {
        return Err(GateError::NotInsideSandbox(format!(
            "uid is {}, not the sandbox uid 1500",
            detection.uid
        )));
    }
    if detection.gid != 1500 {
        return Err(GateError::NotInsideSandbox(format!(
            "gid is {}, not the sandbox gid 1500",
            detection.gid
        )));
    }
    if !detection.marker {
        return Err(GateError::NotInsideSandbox(format!(
            "the development image marker {MARKER} is missing"
        )));
    }

    let state_root = state_root.ok_or(GateError::MissingStateRoot)?;
    let listen: SocketAddr = listen
        .parse()
        .map_err(|error| GateError::InvalidListen(format!("{listen}: {error}")))?;
    if !listen.ip().is_loopback() {
        return Err(GateError::NonLoopback(listen.to_string()));
    }
    if bearer.is_some() {
        return Err(GateError::UnsupportedTransport(
            "bearer token authentication is not supported: the plane accepts plaintext loopback clients only"
                .to_string(),
        ));
    }
    if mutual_tls.is_some() {
        return Err(GateError::UnsupportedTransport(
            "mutual TLS is not supported: the plane accepts plaintext loopback clients only and will not downgrade a TLS configuration"
                .to_string(),
        ));
    }

    Ok(PlaneConfig { state_root, listen })
}

/// Prepare, then bind and serve. A refusal returns before any listener opens.
pub async fn serve_gated(args: &[OsString], detection: &Detection) -> Result<(), GateError> {
    let config = prepare(args, detection)?;
    crate::serve(config.state_root, config.listen)
        .await
        .map_err(|error| GateError::Io(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn free_port() -> u16 {
        for _ in 0..20 {
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("probe bind");
            let port = listener.local_addr().expect("addr").port();
            drop(listener);
            // The port must still be free after the probe's listener closes;
            // an unrelated process can claim an ephemeral port in between.
            if TcpListener::bind(("127.0.0.1", port)).is_ok() {
                return port;
            }
        }
        panic!("no usable probe port");
    }

    fn args(words: &[&str]) -> Vec<OsString> {
        words.iter().map(OsString::from).collect()
    }

    fn assert_no_listener(ip: &str, port: u16) {
        // A second bind is the unambiguous check: a live listener makes it
        // fail, and this never depends on a connect timeout.
        match TcpListener::bind((ip, port)) {
            Ok(listener) => drop(listener),
            Err(error) => {
                panic!("a refused launch must not open a listener on {ip}:{port}: {error}")
            }
        }
    }

    #[tokio::test]
    async fn the_four_missing_conditions_are_refused_without_a_listener() {
        let inside = Detection::inside_sandbox();
        let state = std::env::temp_dir().join(format!("osa-gate-{}", std::process::id()));
        let state_text = state.display().to_string();

        let port = free_port();
        let outside = Detection {
            uid: 501,
            gid: 20,
            marker: false,
        };
        let error = serve_gated(
            &args(&[
                "--state-root",
                &state_text,
                "--listen",
                &format!("127.0.0.1:{port}"),
            ]),
            &outside,
        )
        .await
        .expect_err("detection refusal");
        assert!(matches!(error, GateError::NotInsideSandbox(_)), "{error}");
        assert_no_listener("127.0.0.1", port);

        let port = free_port();
        let error = serve_gated(&args(&["--listen", &format!("127.0.0.1:{port}")]), &inside)
            .await
            .expect_err("state-root refusal");
        assert!(error.to_string().contains("state root"), "{error}");
        assert_no_listener("127.0.0.1", port);

        let port = free_port();
        let error = serve_gated(
            &args(&[
                "--state-root",
                &state_text,
                "--listen",
                &format!("0.0.0.0:{port}"),
            ]),
            &inside,
        )
        .await
        .expect_err("non-loopback refusal");
        assert!(error.to_string().contains("loopback"), "{error}");
        assert_no_listener("0.0.0.0", port);

        let port = free_port();
        let error = serve_gated(
            &args(&[
                "--state-root",
                &state_text,
                "--listen",
                &format!("127.0.0.1:{port}"),
                "--tls-cert",
                "server.pem",
            ]),
            &inside,
        )
        .await
        .expect_err("plaintext refusal");
        assert!(error.to_string().contains("mutual TLS"), "{error}");
        assert_no_listener("127.0.0.1", port);

        let _ = std::fs::remove_dir_all(&state);
    }

    #[test]
    fn bearer_and_mutual_tls_are_named_not_downgraded() {
        let inside = Detection::inside_sandbox();
        let error = prepare(
            &args(&["--state-root", "/state", "--token", "secret"]),
            &inside,
        )
        .expect_err("bearer refusal");
        assert!(error.to_string().contains("bearer token"), "{error}");

        let error = prepare(
            &args(&["--state-root", "/state", "--tls-dir", "/certs"]),
            &inside,
        )
        .expect_err("mtls refusal");
        assert!(error.to_string().contains("mutual TLS"), "{error}");
    }

    #[test]
    fn the_inside_sandbox_detection_is_required_in_full() {
        let inside = Detection::inside_sandbox();
        assert!(prepare(
            &args(&["--state-root", "/state", "--listen", "127.0.0.1:0"]),
            &inside
        )
        .is_ok());

        for broken in [
            Detection {
                uid: 501,
                ..inside.clone()
            },
            Detection {
                gid: 20,
                ..inside.clone()
            },
            Detection {
                marker: false,
                ..inside.clone()
            },
        ] {
            let error = prepare(&args(&["--state-root", "/state"]), &broken)
                .expect_err("detection refusal");
            assert!(error.to_string().contains("sandbox detection"), "{error}");
        }
    }
}
