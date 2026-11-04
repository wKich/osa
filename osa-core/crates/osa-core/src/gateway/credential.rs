//! The credential payload type.
//!
//! A credential travels in exactly one place: the gateway request field defined
//! to carry it. This type makes the other places — a `{}` format, a JSON
//! serialization, a derived `Debug` — unavailable rather than merely
//! discouraged:
//!
//! ```
//! use osa_core::gateway::Credential;
//!
//! let credential = Credential::new("sentinel");
//! assert!(!format!("{credential:?}").contains("sentinel"));
//! ```
//!
//! Formatting it as a value does not compile:
//!
//! ```compile_fail
//! use osa_core::gateway::Credential;
//!
//! let credential = Credential::new("sentinel");
//! println!("{}", credential);
//! ```
//!
//! Serializing it does not compile either:
//!
//! ```compile_fail
//! use osa_core::gateway::Credential;
//!
//! let credential = Credential::new("sentinel");
//! let _ = serde_json::to_string(&credential);
//! ```

use std::fmt;

/// How a redacted credential prints.
pub const REDACTED: &str = "<redacted>";

/// A provider credential value. No `Display`, no `Serialize`, and no derived
/// `Debug`: [`Credential::expose`] is the only way to read the value, and it
/// exists for the one request builder that fills the designated field.
#[derive(PartialEq, Eq)]
pub struct Credential(String);

impl Credential {
    pub fn new(value: impl Into<String>) -> Self {
        Credential(value.into())
    }

    /// The value, for the request field that carries it. Callers must not log,
    /// print, store, or format the result.
    #[doc(hidden)]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Credential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

/// A request that carries a credential never prints one.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_prints_the_redaction_token_and_not_the_value() {
        let credential = Credential::new("sentinel-value");
        assert_eq!(format!("{credential:?}"), REDACTED);
        assert!(!format!("{credential:?}").contains("sentinel"));
        assert_eq!(credential.expose(), "sentinel-value");
    }

    #[test]
    fn a_struct_holding_a_credential_prints_no_value() {
        #[derive(Debug)]
        #[allow(dead_code)]
        struct Request {
            field: &'static str,
            credential: Credential,
        }
        let request = Request {
            field: "api_key",
            credential: Credential::new("sentinel-value"),
        };
        let printed = format!("{request:?}");
        assert!(printed.contains("api_key"));
        assert!(!printed.contains("sentinel"), "{printed}");
    }

    #[test]
    fn no_path_can_format_a_credential_outside_the_request_builder() {
        // The type itself exposes no `Display` or `Serialize` (the doctests
        // above prove formatting and serialization do not compile), so the
        // remaining risk is a caller formatting `expose()`. Only the request
        // builder in `gateway/sdk.rs` may read the value at all; nothing else
        // may put it in a format string.
        fn visit(dir: &std::path::Path, offenders: &mut Vec<String>) {
            for entry in std::fs::read_dir(dir).expect("source read") {
                let path = entry.expect("entry").path();
                if path.is_dir() {
                    visit(&path, offenders);
                    continue;
                }
                if path.extension().and_then(|value| value.to_str()) != Some("rs") {
                    continue;
                }
                if path.ends_with("gateway/sdk.rs") || path.ends_with("gateway/credential.rs") {
                    continue;
                }
                let text = std::fs::read_to_string(&path).expect("source");
                for line in text.lines() {
                    let formatting = ["format!", "write!", "println!", "print!", "to_string"]
                        .iter()
                        .any(|call| line.contains(call));
                    if formatting && line.contains("expose()") {
                        offenders.push(format!("{}: {}", path.display(), line.trim()));
                    }
                }
            }
        }
        let mut offenders = Vec::new();
        visit(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut offenders,
        );
        assert!(offenders.is_empty(), "{offenders:#?}");
    }
}
