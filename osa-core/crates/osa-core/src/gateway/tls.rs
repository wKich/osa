//! Client-certificate material for a gateway that requires mTLS.
//!
//! The client the core otherwise uses has no client-identity support, so a
//! channel is built in [`super::sdk`] and handed over through the client's
//! `from_parts` constructor. Material is read from files the caller names:
//! nothing here takes a key from argv, prints one, or serializes one, and there
//! is no path that disables certificate verification.

use std::fmt;
use std::path::Path;

/// The file names OpenShell's own gateway directory uses.
pub const FILES: [&str; 3] = ["ca.crt", "tls.crt", "tls.key"];

/// The three PEM files a client certificate needs, as bytes.
#[derive(Clone, PartialEq, Eq)]
pub struct ClientIdentity {
    /// The certificate authority the gateway's server certificate chains to.
    pub ca: Vec<u8>,
    /// The client certificate presented to the gateway.
    pub cert: Vec<u8>,
    /// The private key for that certificate.
    pub key: Vec<u8>,
}

impl ClientIdentity {
    pub fn new(ca: Vec<u8>, cert: Vec<u8>, key: Vec<u8>) -> Self {
        ClientIdentity { ca, cert, key }
    }

    /// Read the three files from `directory`.
    ///
    /// The error names the file that could not be read and the directory that
    /// was searched, so a mistyped path does not surface as a handshake
    /// failure.
    pub fn from_dir(directory: &Path) -> Result<Self, String> {
        let read = |name: &str| {
            std::fs::read(directory.join(name)).map_err(|error| {
                format!(
                    "cannot read {name} in {}: {error}; --tls-dir must contain {}",
                    directory.display(),
                    FILES.join(", ")
                )
            })
        };
        Ok(ClientIdentity::new(
            read(FILES[0])?,
            read(FILES[1])?,
            read(FILES[2])?,
        ))
    }
}

impl fmt::Debug for ClientIdentity {
    // Never print the material: the key is a credential.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ClientIdentity { ca: <redacted>, cert: <redacted>, key: <redacted> }")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn directory(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("osa-tls-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        dir
    }

    #[test]
    fn the_three_files_are_read() {
        let dir = directory("read");
        for name in FILES {
            std::fs::write(dir.join(name), format!("{name} bytes")).expect("write");
        }
        let identity = ClientIdentity::from_dir(&dir).expect("read");
        assert_eq!(identity.ca, b"ca.crt bytes".to_vec());
        assert_eq!(identity.cert, b"tls.crt bytes".to_vec());
        assert_eq!(identity.key, b"tls.key bytes".to_vec());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_file_is_named_with_the_directory() {
        let dir = directory("missing");
        std::fs::write(dir.join("ca.crt"), "ca").expect("write");
        let error = ClientIdentity::from_dir(&dir).expect_err("missing pair");
        assert!(error.contains("tls.crt"), "{error}");
        assert!(error.contains(&dir.display().to_string()), "{error}");
        assert!(error.contains("--tls-dir"), "{error}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_material_is_never_printed() {
        let identity =
            ClientIdentity::new(b"ca".to_vec(), b"cert".to_vec(), b"secret-key".to_vec());
        let printed = format!("{identity:?}");
        assert!(printed.contains("redacted"), "{printed}");
        assert!(!printed.contains("secret-key"), "{printed}");
    }
}
