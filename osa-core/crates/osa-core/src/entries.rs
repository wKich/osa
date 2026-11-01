//! The three flat TOML documents the state root publishes, each with the
//! documented write order and omit-absent semantics.

use crate::flat::{FlatEntry, FlatError, STATE_VERSION};

/// A registry entry under `projects/<sandbox>.toml`. `fingerprint` is present
/// only for a git project; every other field is always written.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RegistryEntry {
    pub version: String,
    pub agent: String,
    pub host_path: String,
    pub project: String,
    pub sandbox_name: String,
    pub sandbox_id: String,
    pub created: String,
    pub last_session: String,
    pub fingerprint: Option<String>,
}

impl RegistryEntry {
    pub fn from_flat(entry: &FlatEntry) -> Self {
        let text = |key: &str| entry.get(key).unwrap_or("").to_string();
        RegistryEntry {
            version: text("version"),
            agent: text("agent"),
            host_path: text("host_path"),
            project: text("project"),
            sandbox_name: text("sandbox_name"),
            sandbox_id: text("sandbox_id"),
            created: text("created"),
            last_session: text("last_session"),
            fingerprint: entry
                .get("fingerprint")
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        }
    }

    pub fn to_flat(&self) -> Result<FlatEntry, FlatError> {
        let mut pairs = vec![
            ("version", self.version.as_str()),
            ("agent", self.agent.as_str()),
            ("host_path", self.host_path.as_str()),
            ("project", self.project.as_str()),
            ("sandbox_name", self.sandbox_name.as_str()),
            ("sandbox_id", self.sandbox_id.as_str()),
            ("created", self.created.as_str()),
            ("last_session", self.last_session.as_str()),
        ];
        if let Some(fingerprint) = self.fingerprint.as_deref() {
            pairs.push(("fingerprint", fingerprint));
        }
        FlatEntry::from_pairs(pairs)
    }
}

/// A session's `pending` marker. Every field is written, empty or not.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PendingMarker {
    pub version: String,
    pub kind: String,
    pub patch: String,
    pub sandbox: String,
    pub sandbox_id: String,
    pub created: String,
    pub reason: String,
    pub result_tree: String,
}

impl PendingMarker {
    pub fn new(kind: impl Into<String>) -> Self {
        PendingMarker {
            version: STATE_VERSION.to_string(),
            kind: kind.into(),
            ..PendingMarker::default()
        }
    }

    pub fn from_flat(entry: &FlatEntry) -> Self {
        let text = |key: &str| entry.get(key).unwrap_or("").to_string();
        PendingMarker {
            version: text("version"),
            kind: text("kind"),
            patch: text("patch"),
            sandbox: text("sandbox"),
            sandbox_id: text("sandbox_id"),
            created: text("created"),
            reason: text("reason"),
            result_tree: text("result_tree"),
        }
    }

    pub fn to_flat(&self) -> Result<FlatEntry, FlatError> {
        FlatEntry::from_pairs([
            ("version", self.version.as_str()),
            ("kind", self.kind.as_str()),
            ("patch", self.patch.as_str()),
            ("sandbox", self.sandbox.as_str()),
            ("sandbox_id", self.sandbox_id.as_str()),
            ("created", self.created.as_str()),
            ("reason", self.reason.as_str()),
            ("result_tree", self.result_tree.as_str()),
        ])
    }
}

/// The keys an agent's `config.toml` documents, in the order the reference
/// lists them. Keys a front-end adds for itself follow in insertion order.
pub const CONFIG_KEYS: [&str; 12] = [
    "image",
    "policy",
    "providers",
    "cpu",
    "memory",
    "sandbox_name",
    "engine",
    "gateway",
    "workdir",
    "model",
    "tui",
    "idle_stop",
];

/// A front-end configuration file. Absent keys are omitted, never written
/// empty.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Config {
    pub values: Vec<(String, String)>,
}

impl Config {
    pub fn from_flat(entry: &FlatEntry) -> Self {
        let mut values: Vec<(String, String)> = CONFIG_KEYS
            .iter()
            .filter_map(|key| {
                entry
                    .get(key)
                    .map(|value| ((*key).to_string(), value.to_string()))
            })
            .collect();
        for (key, value) in entry.pairs() {
            if !CONFIG_KEYS.contains(&key.as_str()) {
                values.push((key.clone(), value.clone()));
            }
        }
        Config { values }
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.values
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }

    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) {
        let key = key.into();
        match self.values.iter_mut().find(|(name, _)| *name == key) {
            Some(slot) => slot.1 = value.into(),
            None => self.values.push((key, value.into())),
        }
    }

    pub fn to_flat(&self) -> Result<FlatEntry, FlatError> {
        let mut entry = FlatEntry::new();
        for key in CONFIG_KEYS {
            if let Some(value) = self.get(key) {
                entry.push(key, value)?;
            }
        }
        for (key, value) in &self.values {
            if !CONFIG_KEYS.contains(&key.as_str()) {
                entry.push(key.as_str(), value.as_str())?;
            }
        }
        Ok(entry)
    }
}
