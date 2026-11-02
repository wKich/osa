//! The plane's state root: one directory per sandbox.
//!
//! Layout:
//!
//! ```text
//! <state>/
//!   sandboxes/<name>/
//!     phase        # Ready, Stopped, ...
//!     id           # the sandbox id reported to clients
//!     created      # milliseconds since the epoch
//!     providers    # attached provider names, one per line
//!     rules        # recorded policy chunks, the CLI stub's line format
//!     logs         # recorded log lines, one per line
//!     root/        # the sandbox filesystem; /sandbox/project lives here
//!   shim/openshell # the private PATH shim, never installed system-wide
//! ```
//!
//! The state root is the only place the plane writes. A sandbox's `root/` is
//! its whole filesystem, so absolute sandbox paths stay inside it.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The workdir relative paths resolve against, matching the agent base image.
pub const DEFAULT_WORKDIR: &str = "/sandbox";

/// The directories every sandbox starts with, so an exec can run before an
/// upload has created them.
const SEED_DIRS: &[&str] = &["sandbox", "sandbox/project", "tmp"];

/// One sandbox's recorded identity and phase.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SandboxRecord {
    pub name: String,
    pub id: String,
    pub phase: String,
    pub created_ms: i64,
}

/// Why a create was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum CreateError {
    AlreadyExists(String),
    InvalidName(String),
    Io(String),
}

impl std::fmt::Display for CreateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CreateError::AlreadyExists(name) => write!(f, "sandbox {name} already exists"),
            CreateError::InvalidName(name) => {
                write!(
                    f,
                    "invalid sandbox name '{name}': use a single path component"
                )
            }
            CreateError::Io(detail) => write!(f, "{detail}"),
        }
    }
}

/// A state root on disk.
#[derive(Clone, Debug)]
pub struct StateRoot {
    root: PathBuf,
}

impl StateRoot {
    /// Open or create a state root. The shim directory is created here so the
    /// plane can install its shim before it binds.
    pub fn open(root: impl Into<PathBuf>) -> io::Result<Self> {
        let root = root.into();
        fs::create_dir_all(root.join("sandboxes"))?;
        fs::create_dir_all(root.join("shim"))?;
        Ok(StateRoot { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn shim_dir(&self) -> PathBuf {
        self.root.join("shim")
    }

    pub fn sandboxes_dir(&self) -> PathBuf {
        self.root.join("sandboxes")
    }

    /// The one directory that holds a sandbox's record and its filesystem.
    pub fn sandbox_dir(&self, name: &str) -> PathBuf {
        self.sandboxes_dir().join(name)
    }

    /// The sandbox's filesystem. Absolute sandbox paths are relative to this.
    pub fn root_dir(&self, name: &str) -> PathBuf {
        self.sandbox_dir(name).join("root")
    }

    fn phase_file(&self, name: &str) -> PathBuf {
        self.sandbox_dir(name).join("phase")
    }

    fn id_file(&self, name: &str) -> PathBuf {
        self.sandbox_dir(name).join("id")
    }

    fn created_file(&self, name: &str) -> PathBuf {
        self.sandbox_dir(name).join("created")
    }

    fn providers_file(&self, name: &str) -> PathBuf {
        self.sandbox_dir(name).join("providers")
    }

    pub fn rules_file(&self, name: &str) -> PathBuf {
        self.sandbox_dir(name).join("rules")
    }

    pub fn logs_file(&self, name: &str) -> PathBuf {
        self.sandbox_dir(name).join("logs")
    }

    pub fn phase(&self, name: &str) -> Option<String> {
        let text = fs::read_to_string(self.phase_file(name)).ok()?;
        let phase = text.trim().to_string();
        (!phase.is_empty()).then_some(phase)
    }

    pub fn exists(&self, name: &str) -> bool {
        self.phase(name).is_some()
    }

    pub fn set_phase(&self, name: &str, phase: &str) -> io::Result<()> {
        fs::write(self.phase_file(name), format!("{phase}\n"))
    }

    pub fn id(&self, name: &str) -> Option<String> {
        let text = fs::read_to_string(self.id_file(name)).ok()?;
        let id = text.trim().to_string();
        (!id.is_empty()).then_some(id)
    }

    fn created_ms(&self, name: &str) -> i64 {
        fs::read_to_string(self.created_file(name))
            .ok()
            .and_then(|text| text.trim().parse().ok())
            .unwrap_or(0)
    }

    pub fn providers(&self, name: &str) -> Vec<String> {
        fs::read_to_string(self.providers_file(name))
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect()
    }

    pub fn set_providers(&self, name: &str, providers: &[String]) -> io::Result<()> {
        fs::write(self.providers_file(name), providers.join("\n"))
    }

    /// Create the sandbox directory, its seed dirs, and its phase record.
    pub fn create(&self, name: &str, providers: &[String]) -> Result<SandboxRecord, CreateError> {
        if !valid_name(name) {
            return Err(CreateError::InvalidName(name.to_string()));
        }
        if self.exists(name) {
            return Err(CreateError::AlreadyExists(name.to_string()));
        }
        let dir = self.sandbox_dir(name);
        fs::create_dir_all(&dir).map_err(|error| CreateError::Io(error.to_string()))?;
        for seed in SEED_DIRS {
            fs::create_dir_all(dir.join("root").join(seed))
                .map_err(|error| CreateError::Io(error.to_string()))?;
        }
        let id = format!("sb-{name}-{}", std::process::id());
        fs::write(self.id_file(name), format!("{id}\n"))
            .map_err(|error| CreateError::Io(error.to_string()))?;
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or(0);
        fs::write(self.created_file(name), format!("{created}\n"))
            .map_err(|error| CreateError::Io(error.to_string()))?;
        fs::write(self.providers_file(name), providers.join("\n"))
            .map_err(|error| CreateError::Io(error.to_string()))?;
        self.set_phase(name, "Ready")
            .map_err(|error| CreateError::Io(error.to_string()))?;
        Ok(SandboxRecord {
            name: name.to_string(),
            id,
            phase: "Ready".to_string(),
            created_ms: created,
        })
    }

    /// Every sandbox, sorted by name.
    pub fn list(&self) -> Vec<SandboxRecord> {
        let mut names = Vec::new();
        if let Ok(entries) = fs::read_dir(self.sandboxes_dir()) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                if let Some(name) = entry.file_name().to_str() {
                    names.push(name.to_string());
                }
            }
        }
        names.sort();
        names.iter().filter_map(|name| self.record(name)).collect()
    }

    pub fn record(&self, name: &str) -> Option<SandboxRecord> {
        Some(SandboxRecord {
            name: name.to_string(),
            id: self.id(name)?,
            phase: self.phase(name)?,
            created_ms: self.created_ms(name),
        })
    }

    /// Remove the directory, its filesystem, and its recorded provider
    /// attachments in one operation.
    pub fn delete(&self, name: &str) -> io::Result<()> {
        match fs::remove_dir_all(self.sandbox_dir(name)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// Find a sandbox by the id a client reports, as the log surface does.
    pub fn name_for_id(&self, id: &str) -> Option<String> {
        self.list()
            .into_iter()
            .find(|record| record.id == id)
            .map(|record| record.name)
    }
}

/// A sandbox name is one path component, never `.` or `..`.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_state(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "osa-insandbox-state-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn create_writes_the_layout_and_delete_removes_it() {
        let dir = temp_state("layout");
        let state = StateRoot::open(&dir).expect("open");
        let record = state
            .create("demo", &["provider-a".to_string()])
            .expect("created");
        assert_eq!(record.phase, "Ready");
        assert!(state.root_dir("demo").join("sandbox/project").is_dir());
        assert_eq!(state.providers("demo"), vec!["provider-a".to_string()]);
        assert!(state.exists("demo"));

        state.delete("demo").expect("deleted");
        assert!(!state.sandbox_dir("demo").exists());
        assert!(state.providers("demo").is_empty());
        assert!(!state.exists("demo"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn names_that_escape_are_refused() {
        let dir = temp_state("names");
        let state = StateRoot::open(&dir).expect("open");
        for name in ["", ".", "..", "../escape", "a/b", "a\\b"] {
            assert!(
                state.create(name, &[]).is_err(),
                "name {name:?} must be refused"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
