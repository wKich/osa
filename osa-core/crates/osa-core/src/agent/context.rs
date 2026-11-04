//! The resolved per-invocation context: repository root, project identity,
//! settings precedence, workspace mode, sandbox naming, and the env guards.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};

use crate::commands::repo_root;
use crate::entries::RegistryEntry;
use crate::flat;
use crate::gateway::{self, Gateway};
use crate::state::{cksum, StatePaths};

use super::cli::{Options, EX_USAGE};
use super::config::Config;
use super::failure::Failure;
use super::profile::AgentProfile;

pub const SANDBOX_NAME_MAX: usize = 19;
pub const DEFAULT_WORKDIR: &str = "/sandbox/project";
pub const DEFAULT_ENGINE: &str = "docker";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceMode {
    Managed,
    Caller,
}

pub struct Context {
    pub gateway_stdout_to_stderr: std::cell::Cell<bool>,
    pub profile: &'static AgentProfile,
    pub options: Options,
    pub config: Config,
    pub repo_root: PathBuf,
    pub project_path: PathBuf,
    pub project_name: String,
    pub project_hash: String,
    pub state: StatePaths,
    /// The typed client, resolved and connected the first time a command asks
    /// for it. A command that never touches the gateway never fills this in.
    client: OnceLock<Result<Arc<dyn Gateway>, Failure>>,
}

impl Context {
    pub fn new(profile: &'static AgentProfile, options: Options, config: Config) -> Self {
        let project_path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let project_name = sanitize_project(&project_source(&project_path));
        let project_hash = hash4(&project_path);
        Context {
            gateway_stdout_to_stderr: std::cell::Cell::new(false),
            profile,
            options,
            config,
            repo_root: repo_root(),
            project_path,
            project_name,
            project_hash,
            state: StatePaths::from_env(),
            client: OnceLock::new(),
        }
    }

    pub fn program(&self) -> &str {
        self.profile.name
    }

    pub fn say(&self, line: &str) {
        if self.gateway_stdout_to_stderr.get() {
            eprintln!("{line}");
        } else {
            println!("{line}");
        }
    }

    pub fn note(&self, line: &str) {
        eprintln!("{line}");
    }

    /// A prefixed error line, as the shell's `err` prints it.
    pub fn err_line(&self, line: &str) {
        eprintln!("{}: {line}", self.program());
    }

    pub fn warn(&self, line: &str) {
        eprintln!("{}: warning: {line}", self.program());
    }

    fn env(&self, key: &str) -> Option<String> {
        self.profile.env_setting(key)
    }

    /// flag > environment > config file > default, treating empty as absent.
    pub fn setting(&self, flag: Option<&String>, key: &str, default: &str) -> String {
        if let Some(value) = flag.filter(|value| !value.is_empty()) {
            return value.clone();
        }
        if let Some(value) = self.env(key) {
            return value;
        }
        // Config keys are lowercase; environment names are uppercase.
        let config_key = key.to_ascii_lowercase();
        if let Some(value) = self
            .config
            .get(&config_key)
            .filter(|value| !value.is_empty())
        {
            return value.to_string();
        }
        default.to_string()
    }

    pub fn image(&self) -> String {
        self.setting(
            self.options.image.as_ref(),
            "IMAGE",
            self.profile.base_image,
        )
    }

    pub fn policy(&self) -> String {
        let default = self.repo_root.join(self.profile.default_policy);
        let value = self.setting(
            self.options.policy.as_ref(),
            "POLICY",
            &default.display().to_string(),
        );
        if !value.starts_with('/') && !Path::new(&value).is_file() {
            let joined = self.repo_root.join(&value);
            if joined.is_file() {
                return joined.display().to_string();
            }
        }
        value
    }

    pub fn engine(&self) -> String {
        self.setting(self.options.engine.as_ref(), "ENGINE", DEFAULT_ENGINE)
    }

    pub fn workdir(&self) -> String {
        self.setting(self.options.workdir.as_ref(), "WORKDIR", DEFAULT_WORKDIR)
    }

    pub fn gateway(&self) -> Option<String> {
        let value = self.setting(self.options.gateway.as_ref(), "GATEWAY", "");
        (!value.is_empty()).then_some(value)
    }

    /// The directory holding the client certificate, when one is configured.
    pub fn tls_dir(&self) -> Option<String> {
        let value = self.setting(self.options.tls_dir.as_ref(), "TLS_DIR", "");
        (!value.is_empty()).then_some(value)
    }

    /// The client-certificate material named by `--tls-dir`.
    ///
    /// Read here rather than in the transport so a missing file is a local
    /// dependency failure with the documented exit status, and so the message
    /// names the file that is missing instead of the handshake it would
    /// otherwise fail with.
    fn identity(&self) -> Result<Option<gateway::tls::ClientIdentity>, Failure> {
        let Some(directory) = self.tls_dir() else {
            return Ok(None);
        };
        gateway::tls::ClientIdentity::from_dir(Path::new(&directory))
            .map(Some)
            .map_err(Failure::dep)
    }

    /// The gateway transport selected for this process: the typed client by
    /// default, or the CLI when `OSA_GATEWAY_TRANSPORT=cli`.
    ///
    /// The CLI choice is the rollback path and how the conformance suite runs
    /// one case set over each transport. It is explicit, never a fallback: a
    /// gateway failure must not silently change transports.
    pub fn client(&self) -> Result<Arc<dyn Gateway>, Failure> {
        self.client
            .get_or_init(|| {
                let endpoint = gateway::discover(self.gateway().as_deref())
                    .map_err(|error| Failure::new(error.code(), error.message()))?;
                if std::env::var("OSA_GATEWAY_TRANSPORT").as_deref() == Ok("cli") {
                    return Ok(
                        Arc::new(gateway::cli_transport::CliGateway::new(endpoint))
                            as Arc<dyn Gateway>,
                    );
                }
                let identity = self.identity()?;
                let client = gateway::block_on(gateway::sdk::SdkGateway::connect_with(
                    endpoint, identity,
                ))
                .map_err(|error| Failure::new(error.code(), error.message()))?;
                Ok(Arc::new(client) as Arc<dyn Gateway>)
            })
            .clone()
    }

    pub fn model(&self) -> String {
        self.setting(self.options.model.as_ref(), "MODEL", "")
    }

    pub fn cpu(&self) -> String {
        self.setting(self.options.cpu.as_ref(), "CPU", "")
    }

    pub fn memory(&self) -> String {
        self.setting(self.options.memory.as_ref(), "MEMORY", "")
    }

    pub fn timeout(&self) -> String {
        self.setting(self.options.timeout.as_ref(), "TIMEOUT", "")
    }

    pub fn providers(&self) -> Vec<String> {
        if !self.options.providers.is_empty() {
            return self.options.providers.clone();
        }
        if let Some(value) = self.env("PROVIDERS") {
            return split_csv(&value);
        }
        if let Some(value) = self.config.get("providers") {
            return split_csv(value);
        }
        // Provider setup reloads the config after writing it.
        if let Ok(config) = super::config::load(self.profile) {
            if let Some(value) = config.get("providers").filter(|value| !value.is_empty()) {
                return split_csv(value);
            }
        }
        Vec::new()
    }

    pub fn workspace_mode(&self) -> Result<WorkspaceMode, Failure> {
        let value = self
            .env("WORKSPACE")
            .unwrap_or_else(|| "managed".to_string());
        match value.as_str() {
            "managed" => Ok(WorkspaceMode::Managed),
            "caller" => Ok(WorkspaceMode::Caller),
            _ => Err(Failure::usage(format!(
                "invalid {}_WORKSPACE value <{value}>: use managed or caller",
                self.profile.env_prefix
            ))),
        }
    }

    /// Caller mode never derives a name or workdir from the current directory.
    pub fn require_caller_target(&self, need_workdir: bool) -> Result<(), Failure> {
        let name = self
            .options
            .name
            .clone()
            .filter(|value| !value.is_empty())
            .or_else(|| self.env("SANDBOX_NAME"))
            .unwrap_or_default();
        if name.is_empty() || name.contains('{') {
            return Err(Failure::usage(format!(
                "{}_WORKSPACE=caller needs a literal sandbox name: set {}_SANDBOX_NAME or pass --name",
                self.profile.env_prefix, self.profile.env_prefix
            )));
        }
        if need_workdir
            && self
                .options
                .workdir
                .clone()
                .or_else(|| self.env("WORKDIR"))
                .is_none_or(|value| value.is_empty())
        {
            return Err(Failure::usage(format!(
                "{}_WORKSPACE=caller needs the workspace path: set {}_WORKDIR or pass --workdir",
                self.profile.env_prefix, self.profile.env_prefix
            )));
        }
        Ok(())
    }

    pub fn sandbox_name(&self) -> Result<String, Failure> {
        let mut template = self
            .options
            .name
            .clone()
            .filter(|value| !value.is_empty())
            .or_else(|| self.env("SANDBOX_NAME"))
            .or_else(|| {
                self.config
                    .get("sandbox_name")
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .or_else(|| self.registry_lookup_name())
            .unwrap_or_else(|| self.profile.default_name.to_string());

        let hashed = template.contains("{hash}");
        if hashed {
            template = template.replace("{hash}", &self.project_hash);
        }
        if template.contains("{project}") {
            let fixed = template.replace("{project}", "");
            let count = template.matches("{project}").count();
            let fixed_len = fixed.chars().count();
            let budget = (SANDBOX_NAME_MAX as i64 - fixed_len as i64) / count as i64;
            if budget < 1 {
                return Err(Failure::usage(format!(
                    "sandbox name pattern '{template}' is longer than {SANDBOX_NAME_MAX} characters; shorten sandbox_name/--name"
                )));
            }
            let budget = budget as usize;
            let mut project = self.project_name.clone();
            if project.chars().count() > budget {
                if hashed {
                    project = trim_hyphens(&take_chars(&project, budget));
                } else {
                    if budget < 6 {
                        return Err(Failure::usage(format!(
                            "sandbox name pattern '{template}' leaves only {budget} character(s) for {{project}}; shorten sandbox_name/--name"
                        )));
                    }
                    let keep = trim_hyphens(&take_chars(&project, budget - 5));
                    let hash = format!("{:04x}", cksum(project.as_bytes()).0 % 65536);
                    project = if keep.is_empty() {
                        hash
                    } else {
                        format!("{keep}-{hash}")
                    };
                }
            }
            template = template.replace("{project}", &project);
        }

        validate_name(&template)?;
        Ok(template)
    }

    pub fn registry_lookup_name(&self) -> Option<String> {
        for path in self.state.registry_entries() {
            let Ok(parsed) = flat::read_entry(&path) else {
                continue;
            };
            let entry = RegistryEntry::from_flat(&parsed.entry);
            if entry.agent == self.profile.tag
                && entry.host_path == self.project_path.display().to_string()
            {
                return Some(entry.sandbox_name);
            }
        }
        None
    }

    pub fn registry_guard(&self, name: &str) -> Result<(), Failure> {
        let path = self.state.registry.join(format!("{name}.toml"));
        let Some(host_path) = registry_field(&path, "host_path") else {
            return Ok(());
        };
        if !host_path.is_empty() && host_path != self.project_path.display().to_string() {
            return Err(Failure::usage(format!(
                "sandbox name '{name}' is registered to {host_path}; choose another name with --name"
            )));
        }
        Ok(())
    }

    pub fn registry_update(
        &self,
        name: &str,
        sandbox_id: Option<&str>,
        session: bool,
        fingerprint: bool,
    ) {
        let path = self.state.registry.join(format!("{name}.toml"));
        let existing = flat::read_entry(&path)
            .ok()
            .map(|parsed| RegistryEntry::from_flat(&parsed.entry));
        let mut entry = existing.unwrap_or_default();
        let host_path = self.project_path.display().to_string();
        if !entry.host_path.is_empty() && entry.host_path != host_path {
            return;
        }
        let now = utc_now();
        if sandbox_id.is_some_and(|id| !id.is_empty()) {
            entry.sandbox_id = sandbox_id.unwrap_or("").to_string();
        }
        entry.version = "1".to_string();
        entry.agent = self.profile.tag.to_string();
        entry.host_path = self.project_path.display().to_string();
        entry.project = self.project_name.clone();
        entry.sandbox_name = name.to_string();
        entry.created = if entry.created.is_empty() {
            now.clone()
        } else {
            entry.created.clone()
        };
        if session {
            entry.last_session = now;
        }
        if fingerprint {
            entry.fingerprint = crate::state::project_fingerprint(&self.project_path);
        }
        if let Ok(flat_entry) = entry.to_flat() {
            if let Err(error) = flat::write_atomic(&path, &flat_entry) {
                self.warn(&format!(
                    "cannot write the registry entry {}: {error}",
                    path.display()
                ));
            }
        }
    }

    pub fn registry_remove(&self, name: &str) {
        let _ = std::fs::remove_file(self.state.registry.join(format!("{name}.toml")));
    }

    pub fn session_state_dir(&self, name: &str) -> PathBuf {
        self.state.session_dir(name)
    }

    pub fn is_interactive(&self) -> bool {
        if self.env("INTERACTIVE").is_some() {
            return true;
        }
        unsafe { libc::isatty(libc::STDIN_FILENO) == 1 }
    }

    pub fn check_env_hygiene(&self) -> Result<(), Failure> {
        for pair in &self.options.envs {
            if pair.is_empty() {
                continue;
            }
            let Some((key, _)) = pair.split_once('=') else {
                return Err(Failure::usage(format!(
                    "--env expects KEY=VALUE, got '{pair}'"
                )));
            };
            if !valid_env_name(key) {
                return Err(Failure::usage(format!(
                    "--env key must match [A-Za-z_][A-Za-z0-9_]*; got '{key}'"
                )));
            }
            if credential_like(key) && !self.env_key_allowed(key) {
                return Err(self.env_refusal("--env", key));
            }
        }
        for pair in &self.options.env_froms {
            if pair.is_empty() {
                continue;
            }
            let (key, source) = match pair.split_once('=') {
                Some((key, source)) => (key, source),
                None => (pair.as_str(), pair.as_str()),
            };
            for name in [key, source] {
                if !valid_env_name(name) {
                    return Err(Failure::usage(format!(
                        "--env-from expects KEY or KEY=ENVVAR with names matching [A-Za-z_][A-Za-z0-9_]*; got '{pair}'"
                    )));
                }
            }
            if credential_like(key) && !self.env_key_allowed(key) {
                return Err(self.env_refusal("--env-from", key));
            }
            if credential_like(source) && !self.env_key_allowed(source) {
                return Err(self.env_refusal("--env-from", source));
            }
        }
        Ok(())
    }

    fn env_key_allowed(&self, key: &str) -> bool {
        self.options.allow_env.iter().any(|allowed| allowed == key)
    }

    fn env_refusal(&self, flag: &str, key: &str) -> Failure {
        Failure::with_lines(
            EX_USAGE,
            vec![
                format!("refusing {flag} {key}: the name looks like a credential"),
                "  Sandbox environment variables are readable by the agent; use a provider instead:"
                    .to_string(),
                format!(
                    "    {} provider add my-provider --type <profile> --from-existing",
                    self.program()
                ),
                format!("    {} provider attach my-provider", self.program()),
                format!(
                    "  If this value is genuinely not secret, repeat the key with --allow-env {key}"
                ),
            ],
            false,
        )
    }
}

fn registry_field(path: &Path, key: &str) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let parsed = flat::read_entry(path).ok()?;
    Some(parsed.entry.get(key).unwrap_or("").to_string())
}

fn project_source(path: &Path) -> String {
    let basename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".to_string());
    if !crate::state::command_in_path("git") {
        return basename;
    }
    let output = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(path)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output();
    let Ok(output) = output else {
        return basename;
    };
    if !output.status.success() {
        return basename;
    }
    let mut remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
    remote = remote.trim_end_matches('/').to_string();
    remote = remote.strip_suffix(".git").unwrap_or(&remote).to_string();
    if let Some(tail) = remote.rsplit('/').next() {
        remote = tail.to_string();
    }
    if let Some(tail) = remote.rsplit(':').next() {
        remote = tail.to_string();
    }
    if remote.is_empty() {
        basename
    } else {
        remote
    }
}

pub fn sanitize_project(source: &str) -> String {
    let mut name = String::new();
    for character in source.chars() {
        let lowered = character.to_ascii_lowercase();
        if lowered.is_ascii_lowercase() || lowered.is_ascii_digit() || lowered == '-' {
            name.push(lowered);
        } else {
            name.push('-');
        }
    }
    while name.contains("--") {
        name = name.replace("--", "-");
    }
    let name = name.trim_matches('-');
    if name.is_empty() {
        "project".to_string()
    } else {
        name.to_string()
    }
}

pub fn hash4(path: &Path) -> String {
    format!(
        "{:04x}",
        cksum(path.display().to_string().as_bytes()).0 % 65536
    )
}

pub fn validate_name(name: &str) -> Result<(), Failure> {
    if name.is_empty() {
        return Err(Failure::usage(
            "resolved sandbox name is empty; check sandbox_name/--name",
        ));
    }
    if !name.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(Failure::usage(format!(
            "invalid sandbox name '{name}': use lowercase letters, digits, and hyphens"
        )));
    }
    if name.starts_with('-') || name.ends_with('-') {
        return Err(Failure::usage(format!(
            "invalid sandbox name '{name}': do not start or end with a hyphen"
        )));
    }
    let length = name.chars().count();
    if length > SANDBOX_NAME_MAX {
        return Err(Failure::usage(format!(
            "sandbox name '{name}' is {length} characters; OpenShell allows at most {SANDBOX_NAME_MAX}"
        )));
    }
    Ok(())
}

fn take_chars(text: &str, count: usize) -> String {
    text.chars().take(count).collect()
}

fn trim_hyphens(text: &str) -> String {
    text.trim_matches('-').to_string()
}

pub fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn credential_like(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    let hay = format!("_{upper}_");
    [
        "TOKEN",
        "SECRET",
        "PASSWORD",
        "CREDENTIAL",
        "ACCESS_KEY",
        "SECRET_KEY",
        "API_KEY",
    ]
    .iter()
    .any(|keyword| hay.contains(&format!("_{keyword}_")))
}

fn valid_env_name(name: &str) -> bool {
    let mut characters = name.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

pub fn utc_now() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    crate::state::utc_iso(seconds).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_sanitized() {
        assert_eq!(sanitize_project("My_App.Test"), "my-app-test");
        assert_eq!(sanitize_project("--x--"), "x");
        assert_eq!(sanitize_project("***"), "project");
    }

    #[test]
    fn credential_keys_use_whole_segments() {
        assert!(credential_like("API_KEY"));
        assert!(credential_like("MY_TOKEN"));
        assert!(credential_like("GITHUB_SECRET_KEY"));
        assert!(!credential_like("TOKENIZERS"));
        assert!(!credential_like("api"));
    }
}
