//! The gateway seam: how the core talks to OpenShell.
//!
//! Layout:
//!
//! - this module declares [`Gateway`], the one abstraction every covered
//!   operation goes through, its request and reply types, and the lenient JSON
//!   reader the CLI path still needs;
//! - [`cli`] holds every remaining `openshell` process invocation: endpoint
//!   discovery, file transfer, and the commands this change does not convert;
//! - [`discover`] resolves the endpoint once per process;
//! - [`error`] is the typed failure set and its message/exit-code mapping;
//! - [`credential`] is the payload type that cannot be printed or serialized.
//!
//! The reader accepts the layouts `openshell` emits — pretty-printed, compact,
//! several documents on one line. Leniency stops at a missing required field: a
//! shape change that would silently drop a sandbox fails with the command, the
//! field, and the payload shape, so the failure is diagnosable without the raw
//! body in the message.

pub mod cli;
pub mod cli_transport;
pub mod credential;
pub mod discover;
pub mod error;
pub mod sdk;
pub mod tls;

/// The recording transport: compiled only for tests, never into a release
/// binary.
#[cfg(feature = "test-support")]
pub mod record;

/// The end-to-end suite's transcript directory. Test-support builds only: a
/// release binary cannot record, and setting this variable there does nothing.
#[cfg(feature = "test-support")]
pub fn transcript_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("OSA_E2E_TRANSCRIPT_DIR")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
}

pub use credential::Credential;
pub use discover::{discover, AuthMode, Discovery, Endpoint};
pub use error::GatewayError;

use std::fmt;
use std::future::Future;
use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

const SHAPE_LIMIT: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShapeError {
    pub command: &'static str,
    pub field: &'static str,
    pub shape: String,
}

impl fmt::Display for ShapeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}: response is missing required field \"{}\"; payload shape: {}",
            self.command, self.field, self.shape
        )
    }
}

impl std::error::Error for ShapeError {}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Sandbox {
    pub name: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub phase: Option<String>,
    /// Milliseconds since the Unix epoch, `0` when the transport reports none —
    /// the same fallback the CLI uses before formatting the column.
    #[serde(default)]
    pub created_ms: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Rule {
    pub name: String,
    #[serde(default)]
    pub status: Option<String>,
    /// The proposal's chunk identifier: the unit an approval targets.
    #[serde(default)]
    pub chunk_id: Option<String>,
    /// The binary a proposal applies to.
    #[serde(default)]
    pub binary: Option<String>,
    /// The endpoints a proposal would allow.
    #[serde(default)]
    pub endpoints: Vec<String>,
    /// The policy prover's verdict.
    #[serde(default)]
    pub verdict: Option<String>,
}

/// A sandbox listing: `{"sandboxes": [...]}`, a bare array, or any number of
/// those documents.
pub fn sandboxes(payload: &str) -> Result<Vec<Sandbox>, ShapeError> {
    let mut found = Vec::new();
    for document in documents(payload, "openshell sandbox list")? {
        match document {
            Value::Object(ref map) => {
                let Some(items) = map.get("sandboxes") else {
                    return Err(missing("openshell sandbox list", "sandboxes", payload));
                };
                found.extend(elements::<Sandbox>(
                    items,
                    "openshell sandbox list",
                    "name",
                    payload,
                )?);
            }
            Value::Array(_) => {
                found.extend(elements::<Sandbox>(
                    &document,
                    "openshell sandbox list",
                    "name",
                    payload,
                )?);
            }
            _ => return Err(missing("openshell sandbox list", "sandboxes", payload)),
        }
    }
    Ok(found)
}

/// A provider listing as names: `{"providers": [{"name": ...}]}`, bare array
/// of names or objects, or several such documents.
pub fn providers(payload: &str) -> Result<Vec<String>, ShapeError> {
    let mut found = Vec::new();
    for document in documents(payload, "openshell provider list")? {
        let items = match &document {
            Value::Object(map) => match map.get("providers") {
                Some(items) => items,
                None => return Err(missing("openshell provider list", "providers", payload)),
            },
            Value::Array(_) => &document,
            _ => return Err(missing("openshell provider list", "providers", payload)),
        };
        let Value::Array(items) = items else {
            return Err(missing("openshell provider list", "providers", payload));
        };
        for item in items {
            match item {
                Value::String(name) => found.push(name.clone()),
                Value::Object(map) => match map.get("name").and_then(Value::as_str) {
                    Some(name) => found.push(name.to_string()),
                    None => return Err(missing("openshell provider list", "name", payload)),
                },
                _ => return Err(missing("openshell provider list", "name", payload)),
            }
        }
    }
    Ok(found)
}

/// A rule listing: `{"rules": [{"name": ...}]}`, a bare array, or several
/// documents.
pub fn rules(payload: &str) -> Result<Vec<Rule>, ShapeError> {
    let mut found = Vec::new();
    for document in documents(payload, "openshell rule list")? {
        match document {
            Value::Object(ref map) => {
                let Some(items) = map.get("rules") else {
                    return Err(missing("openshell rule list", "rules", payload));
                };
                found.extend(elements::<Rule>(
                    items,
                    "openshell rule list",
                    "name",
                    payload,
                )?);
            }
            Value::Array(_) => {
                found.extend(elements::<Rule>(
                    &document,
                    "openshell rule list",
                    "name",
                    payload,
                )?);
            }
            _ => return Err(missing("openshell rule list", "rules", payload)),
        }
    }
    Ok(found)
}

fn elements<T>(
    items: &Value,
    command: &'static str,
    field: &'static str,
    payload: &str,
) -> Result<Vec<T>, ShapeError>
where
    T: for<'de> Deserialize<'de>,
{
    let Value::Array(items) = items else {
        return Err(missing(command, field, payload));
    };
    let mut found = Vec::new();
    for item in items {
        match serde_json::from_value::<T>(item.clone()) {
            Ok(value) => found.push(value),
            Err(_) => return Err(missing(command, field, payload)),
        }
    }
    Ok(found)
}

/// Every JSON document in the payload, in order. A payload that is not JSON at
/// all fails with its shape rather than an empty result.
fn documents(payload: &str, command: &'static str) -> Result<Vec<Value>, ShapeError> {
    if payload.trim().is_empty() {
        return Err(ShapeError {
            command,
            field: "document",
            shape: "<empty>".to_string(),
        });
    }
    if let Ok(value) = serde_json::from_str::<Value>(payload) {
        return Ok(vec![value]);
    }
    let stream = serde_json::Deserializer::from_str(payload).into_iter::<Value>();
    let mut documents = Vec::new();
    for item in stream {
        match item {
            Ok(value) => documents.push(value),
            Err(_) => return Err(missing(command, "document", payload)),
        }
    }
    if documents.is_empty() {
        return Err(missing(command, "document", payload));
    }
    Ok(documents)
}

fn missing(command: &'static str, field: &'static str, payload: &str) -> ShapeError {
    ShapeError {
        command,
        field,
        shape: shape(payload),
    }
}

fn shape(payload: &str) -> String {
    let mut collapsed = String::new();
    let mut last_space = false;
    for ch in payload.chars() {
        let is_space = ch.is_whitespace();
        if is_space {
            if !last_space {
                collapsed.push(' ');
            }
        } else {
            collapsed.push(ch);
        }
        last_space = is_space;
    }
    let collapsed = collapsed.trim();
    if collapsed.chars().count() <= SHAPE_LIMIT {
        return collapsed.to_string();
    }
    let mut truncated: String = collapsed.chars().take(SHAPE_LIMIT).collect();
    truncated.push('…');
    truncated
}

/// What creating a sandbox needs: the same inputs the CLI create takes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxSpec {
    pub name: String,
    pub image: String,
    pub policy: Option<String>,
    pub cpu: Option<String>,
    pub memory: Option<String>,
    pub providers: Vec<String>,
    pub env: Vec<String>,
    pub env_from: Vec<String>,
}

/// A command to run inside a sandbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecRequest {
    pub sandbox: String,
    pub command: Vec<String>,
    pub workdir: Option<String>,
    pub no_login_shell: bool,
    pub stdin: Option<Vec<u8>>,
    pub timeout: Option<Duration>,
}

/// A buffered exec result. The exit code is reported separately from the
/// output, so a probe can report both without parsing either.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecOutput {
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// The terminal status of a streamed exec, delivered after the output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitStatus {
    pub code: i32,
}

/// Render the text `policy review` prints from the structured listing.
///
/// This is the one place the wording lives: the CLI transport parses the same
/// text back into a listing, so parity compares rendered results rather than
/// two independent formats.
pub fn render_rules(sandbox: &str, listing: &RuleListing) -> String {
    if listing.rules.is_empty() {
        return format!("No network rules for sandbox '{sandbox}'\n");
    }
    let mut text = format!(
        "Network Rules:  (version {}, {} chunk{})\n\n",
        listing.version,
        listing.rules.len(),
        if listing.rules.len() == 1 { "" } else { "s" }
    );
    for rule in &listing.rules {
        let chunk = rule.chunk_id.as_deref().unwrap_or(&rule.name);
        text.push_str(&format!("  Chunk: {chunk}\n"));
        if let Some(status) = &rule.status {
            text.push_str(&format!("  Status: {status}\n"));
        }
        text.push_str(&format!("  Rule: {}\n", rule.name));
        if let Some(binary) = rule.binary.as_ref().filter(|value| !value.is_empty()) {
            text.push_str(&format!("  Binary: {binary}\n"));
        }
        if !rule.endpoints.is_empty() {
            text.push_str(&format!("  Endpoints: {}\n", rule.endpoints.join(", ")));
        }
        if let Some(verdict) = rule.verdict.as_ref().filter(|value| !value.is_empty()) {
            text.push_str(&format!("  Prover: {verdict}\n"));
        }
        text.push('\n');
    }
    text
}

/// Receives output chunks as they arrive.
///
/// A callback rather than a returned stream keeps the command surface
/// synchronous: the transport owns the async plumbing, and backpressure comes
/// from its bounded channel, not from buffering the whole stream here.
pub trait ChunkSink: Send {
    fn write(&mut self, bytes: &[u8]);
}

impl ChunkSink for Vec<u8> {
    fn write(&mut self, bytes: &[u8]) {
        self.extend_from_slice(bytes);
    }
}

impl ChunkSink for std::io::Stdout {
    fn write(&mut self, bytes: &[u8]) {
        use std::io::Write;
        let _ = self.write_all(bytes);
        let _ = self.flush();
    }
}

/// What a log read needs: the same filter surface the CLI's `logs` command
/// exposes, so converting the command loses no option.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogOptions {
    /// Stream live logs instead of reading one batch.
    pub follow: bool,
    /// How many lines the gateway keeps when replaying.
    pub lines: u32,
    /// A CLI duration (`5m`, `1h`, `30s`), resolved to an instant by the
    /// transport.
    pub since: Option<String>,
    /// `gateway`, `sandbox`, or `all`; empty means no filter.
    pub sources: Vec<String>,
    /// `error`, `warn`, `info`, `debug`, or `trace`; empty means all.
    pub level: Option<String>,
}

impl Default for LogOptions {
    fn default() -> Self {
        LogOptions {
            follow: false,
            lines: 200,
            since: None,
            sources: Vec::new(),
            level: None,
        }
    }
}

/// The structured rule listing: the draft version plus every chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleListing {
    pub version: u64,
    pub rules: Vec<Rule>,
}

/// What creating a provider needs: the create command's whole option surface.
#[derive(Debug, PartialEq, Eq)]
pub struct ProviderSpec {
    pub name: String,
    pub profile: String,
    /// Take the credential from the caller's existing environment rather than
    /// from an inline value. The value still travels only in the designated
    /// request field.
    pub from_existing: bool,
    /// Store the profile at platform scope instead of the selected workspace.
    pub global_profile: bool,
    /// The profile resolves its credential at runtime; no secret is stored.
    pub runtime_credentials: bool,
    /// The environment keys the credential belongs to; each name is one
    /// request field, and its value comes from the process environment.
    pub credential_keys: Vec<String>,
    /// Non-secret provider configuration pairs.
    pub config: Vec<(String, String)>,
    /// A credential already in hand, keyed by `credential_key`.
    pub credential_key: Option<String>,
    pub credential: Option<Credential>,
}

/// One frame a caller sends to an interactive exec.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecInput {
    Stdin(Vec<u8>),
    Resize { cols: u16, rows: u16 },
}

/// An interactive or scripted exec: the command, its environment, and the
/// terminal shape. The exit status comes back separately from the output.
#[derive(Debug, Clone)]
pub struct InteractiveExec {
    pub request: ExecRequest,
    pub env: Vec<(String, String)>,
    pub tty: bool,
    pub size: Option<(u16, u16)>,
    /// Set when the session's interrupt handler fires; the exec loop watches
    /// it so a signal ends the stream even while no output is arriving.
    pub interrupt: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}

/// Every covered gateway operation.
///
/// Covered: health, sandbox create/start/stop/delete/get/list, readiness and
/// deletion waits, exec, log streaming, provider create/list/attach/detach, and
/// rule get/list/approve. File transfer and endpoint discovery stay in
/// [`cli`]. One method per operation keeps the recording transport a plain
/// implementation rather than a branch.
///
/// The trait is `async_trait` and object-safe on purpose: the transport is
/// chosen at construction and substituted at runtime in tests, so it is stored
/// as `Arc<dyn Gateway>` and native async-in-trait (not dyn-compatible without
/// boxing at every call site) is not an option here.
#[async_trait::async_trait]
pub trait Gateway: Send + Sync {
    /// The resolved endpoint this transport talks to.
    fn endpoint(&self) -> &Endpoint;

    async fn health(&self) -> Result<(), GatewayError>;

    async fn list_sandboxes(&self) -> Result<Vec<Sandbox>, GatewayError>;
    async fn get_sandbox(&self, name: &str) -> Result<Option<Sandbox>, GatewayError>;
    async fn create_sandbox(&self, spec: SandboxSpec) -> Result<Sandbox, GatewayError>;
    async fn start_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError>;
    async fn stop_sandbox(&self, name: &str) -> Result<Sandbox, GatewayError>;
    /// The deleted sandbox's id, when the gateway reported one: the deletion
    /// wait re-reads by id.
    async fn delete_sandbox(&self, name: &str) -> Result<Option<String>, GatewayError>;

    /// Poll until the sandbox is ready, or fail with
    /// [`GatewayError::Timeout`] naming the last observed phase.
    async fn wait_ready(&self, name: &str, timeout: Duration) -> Result<Sandbox, GatewayError>;
    async fn wait_deleted(&self, name: &str, timeout: Duration) -> Result<(), GatewayError>;

    /// Stream an exec's output to `sink` as it arrives, then report the exit
    /// status.
    async fn exec(
        &self,
        request: ExecRequest,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, GatewayError>;
    /// Buffer an exec's whole output. Probes may buffer; passthrough may not.
    async fn exec_buffered(&self, request: ExecRequest) -> Result<ExecOutput, GatewayError>;
    /// Stream an exec's output as it arrives while forwarding stdin and resize
    /// frames, and report the exit status separately. An interrupt drops the
    /// stream, which ends the remote process.
    async fn exec_interactive(
        &self,
        exec: InteractiveExec,
        input: tokio::sync::mpsc::Receiver<ExecInput>,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<ExitStatus, GatewayError>;
    /// Stream a sandbox's logs to `sink` until the stream ends. A non-following
    /// read drains its tail and returns.
    async fn logs(
        &self,
        sandbox: &str,
        options: LogOptions,
        sink: &mut (dyn ChunkSink + Send),
    ) -> Result<(), GatewayError>;

    async fn list_providers(&self) -> Result<Vec<String>, GatewayError>;
    async fn create_provider(&self, spec: ProviderSpec) -> Result<(), GatewayError>;
    async fn attached_providers(&self, sandbox: &str) -> Result<Vec<String>, GatewayError>;
    async fn attach_provider(&self, sandbox: &str, provider: &str) -> Result<(), GatewayError>;
    async fn detach_provider(&self, sandbox: &str, provider: &str) -> Result<(), GatewayError>;

    async fn get_rule(
        &self,
        sandbox: &str,
        name: &str,
        pending_only: bool,
    ) -> Result<Option<Rule>, GatewayError>;
    async fn list_rules(&self, sandbox: &str) -> Result<RuleListing, GatewayError>;
    /// Approve exactly one draft chunk. There is deliberately no bulk
    /// approval here: egress widens one chunk at a time.
    async fn approve_rule(&self, sandbox: &str, chunk: &str) -> Result<(), GatewayError>;
    /// Reject exactly one draft chunk, with the reason the agent receives.
    async fn reject_rule(
        &self,
        sandbox: &str,
        chunk: &str,
        reason: &str,
    ) -> Result<(), GatewayError>;
}

/// Run one future on the process's runtime.
///
/// The front-ends are synchronous, so a converted command blocks on its
/// transport at the outermost call and nowhere else. The runtime is created
/// once per process; everything below the seam is async.
pub fn block_on<F: Future>(future: F) -> F::Output {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    let runtime = RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("the tokio runtime starts")
    });
    runtime.block_on(future)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-only: the transport is chosen at construction and substituted in
    /// tests, so it must be storable as a trait object.
    #[test]
    fn the_trait_is_object_safe_and_stored_as_an_arc() {
        fn store(gateway: std::sync::Arc<dyn Gateway>) -> std::sync::Arc<dyn Gateway> {
            gateway
        }
        let _store: fn(std::sync::Arc<dyn Gateway>) -> std::sync::Arc<dyn Gateway> = store;
    }

    const PRETTY: &str = "{\n  \"next_page_token\": \"\",\n  \"sandboxes\": [\n    {\"id\": \"a\", \"name\": \"one\", \"phase\": \"Ready\"},\n    {\"id\": \"b\", \"name\": \"two\", \"phase\": \"Stopped\"}\n  ]\n}";
    const COMPACT: &str = "{\"next_page_token\":\"\",\"sandboxes\":[{\"id\":\"a\",\"name\":\"one\",\"phase\":\"Ready\"},{\"id\":\"b\",\"name\":\"two\",\"phase\":\"Stopped\"}]}";
    const MULTI_DOCUMENT: &str = "{\"sandboxes\":[{\"name\":\"one\",\"phase\":\"Ready\"}]}{\"sandboxes\":[{\"name\":\"two\",\"phase\":\"Stopped\"}]}";
    const MULTI_ON_ONE_LINE: &str = "{\"sandboxes\":[{\"name\":\"one\",\"phase\":\"Ready\"},{\"name\":\"two\",\"phase\":\"Stopped\"}]}";

    fn phases(payload: &str) -> Vec<(String, String)> {
        sandboxes(payload)
            .expect("readable")
            .into_iter()
            .map(|sandbox| (sandbox.name, sandbox.phase.unwrap_or_default()))
            .collect()
    }

    #[test]
    fn every_layout_resolves_the_same_phase() {
        let expected = vec![
            ("one".to_string(), "Ready".to_string()),
            ("two".to_string(), "Stopped".to_string()),
        ];
        for payload in [PRETTY, COMPACT, MULTI_DOCUMENT, MULTI_ON_ONE_LINE] {
            assert_eq!(phases(payload), expected, "{payload}");
        }
    }

    #[test]
    fn every_layout_resolves_the_same_provider_set() {
        let expected = vec!["maki-deepseek".to_string(), "maki-anthropic".to_string()];
        let pretty = "{\n  \"providers\": [\n    {\"name\": \"maki-deepseek\"},\n    {\"name\": \"maki-anthropic\"}\n  ]\n}";
        let compact =
            "{\"providers\":[{\"name\":\"maki-deepseek\"},{\"name\":\"maki-anthropic\"}]}";
        let documents = "{\"providers\":[{\"name\":\"maki-deepseek\"}]}{\"providers\":[{\"name\":\"maki-anthropic\"}]}";
        let strings = "[\"maki-deepseek\", \"maki-anthropic\"]";
        for payload in [pretty, compact, documents, strings] {
            assert_eq!(providers(payload).expect("readable"), expected, "{payload}");
        }
    }

    #[test]
    fn rule_listing_reads_name_and_status() {
        let payload = "{\"rules\":[{\"name\":\"allow-api\",\"status\":\"pending\"}]}";
        let rules = rules(payload).expect("readable");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].name, "allow-api");
        assert_eq!(rules[0].status.as_deref(), Some("pending"));
    }

    #[test]
    fn truncated_payload_names_the_command_the_field_and_the_shape() {
        let payload = "{\n  \"next_page_token\": \"\",\n  \"items\": [ {\"name\": \"one\"} ]\n}";
        let error = sandboxes(payload).expect_err("no sandboxes field");
        let message = error.to_string();
        assert!(message.contains("openshell sandbox list"), "{message}");
        assert!(message.contains("\"sandboxes\""), "{message}");
        assert!(message.contains("next_page_token"), "{message}");
    }

    #[test]
    fn a_missing_name_names_the_field() {
        let payload = "{\"sandboxes\": [{\"phase\": \"Ready\"}]}";
        let error = sandboxes(payload).expect_err("no name");
        assert_eq!(error.field, "name");
    }

    #[test]
    fn a_non_json_payload_is_reported() {
        let error = sandboxes("not json at all").expect_err("not json");
        assert!(error.to_string().contains("not json at all"));
    }

    #[test]
    fn shape_is_collapsed_and_bounded() {
        let long = format!("{{\"sandboxes\": []}}{}", " ".repeat(400));
        let collapsed = shape(&long);
        assert!(collapsed.chars().count() <= SHAPE_LIMIT + 1);
        assert!(!collapsed.contains("  "));
    }
}
