//! The typed transport against the offline stub gateway: no Docker, no real
//! gateway, no network. These are the cases the change converts, expressed at
//! the transport seam rather than through the shell suite.

use std::path::PathBuf;
use std::time::Duration;

use osa_core::gateway::sdk::SdkGateway;
use osa_core::gateway::{
    AuthMode, ChunkSink, Endpoint, ExecRequest, Gateway, GatewayError, ProviderSpec, Rule,
    SandboxSpec,
};
use stub_gateway::Stub;

fn state_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osa-sdk-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

async fn gateway(stub: Stub) -> SdkGateway {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
    tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(stub.into_server())
            .serve_with_incoming(incoming)
            .await
            .expect("serve");
    });
    SdkGateway::connect(Endpoint {
        gateway: "local".to_string(),
        server: format!("http://{addr}"),
        auth: AuthMode::Plaintext,
        version: "0.1.5".to_string(),
    })
    .await
    .expect("connected")
}

fn seed_sandbox(dir: &PathBuf, name: &str, phase: &str) {
    std::fs::create_dir_all(dir.join("sandboxes")).expect("state");
    std::fs::write(dir.join("sandboxes").join(name), format!("{phase}\n")).expect("phase");
}

fn spec(name: &str) -> SandboxSpec {
    SandboxSpec {
        name: name.to_string(),
        image: "maki-agent:local".to_string(),
        policy: None,
        cpu: None,
        memory: None,
        providers: Vec::new(),
        env: Vec::new(),
        env_from: Vec::new(),
    }
}

#[tokio::test]
async fn get_list_and_both_waits_run_over_the_client() {
    let dir = state_dir("lifecycle");
    let stub = Stub::new(&dir, None);
    seed_sandbox(&dir, "demo", "Ready");
    let ok = gateway(stub.clone()).await;

    assert_eq!(
        ok.get_sandbox("demo")
            .await
            .expect("read")
            .map(|sandbox| sandbox.phase),
        Some(Some("Ready".to_string()))
    );
    assert!(ok.get_sandbox("missing").await.expect("read").is_none());
    let listed = ok.list_sandboxes().await.expect("listed");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "demo");

    // A ready sandbox stops the wait immediately.
    let waited = ok
        .wait_ready("demo", Duration::from_secs(5))
        .await
        .expect("ready");
    assert_eq!(waited.phase.as_deref(), Some("Ready"));

    ok.delete_sandbox("demo").await.expect("deleted");
    ok.wait_deleted("demo", Duration::from_secs(5))
        .await
        .expect("gone");
    assert!(ok.get_sandbox("demo").await.expect("read").is_none());

    // The requests are recorded as the equivalent CLI argv.
    let requests = stub.requests();
    assert!(requests
        .iter()
        .any(|line| line == "sandbox list --output json"));
    assert!(requests
        .iter()
        .any(|line| line == "sandbox get demo --output json"));
    assert!(requests.iter().any(|line| line == "sandbox delete demo"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_wait_timeout_names_the_sandbox_and_the_last_phase() {
    let dir = state_dir("timeout");
    let stub = Stub::new(&dir, None);
    seed_sandbox(&dir, "slow", "Starting");
    let transport = gateway(stub).await;

    let error = transport
        .wait_ready("slow", Duration::from_secs(0))
        .await
        .expect_err("still starting");
    assert_eq!(
        error,
        GatewayError::Timeout {
            sandbox: "slow".to_string(),
            phase: "Starting".to_string(),
            seconds: 0,
        }
    );
    assert_eq!(
        error.message(),
        "sandbox 'slow' is still 'Starting' after 0 seconds"
    );
    assert_eq!(error.code(), 3);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn create_and_start_and_stop_run_over_the_client() {
    let dir = state_dir("create");
    let stub = Stub::new(&dir, None);
    let transport = gateway(stub.clone()).await;

    let created = transport
        .create_sandbox(spec("demo"))
        .await
        .expect("created");
    assert_eq!(created.phase.as_deref(), Some("Ready"));
    assert_eq!(
        transport
            .stop_sandbox("demo")
            .await
            .expect("stopped")
            .phase
            .as_deref(),
        Some("Stopped")
    );
    assert_eq!(
        transport
            .start_sandbox("demo")
            .await
            .expect("started")
            .phase
            .as_deref(),
        Some("Ready")
    );
    assert!(stub
        .requests()
        .iter()
        .any(|line| line == "sandbox create --name demo --detach"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn the_create_race_re_reads_and_reuses_instead_of_failing() {
    let dir = state_dir("race");
    let stub = Stub::new(&dir, None).with_create_race();
    let transport = gateway(stub).await;

    let error = transport
        .create_sandbox(spec("demo"))
        .await
        .expect_err("the create loses");
    assert_eq!(
        error,
        GatewayError::AlreadyExists {
            sandbox: "demo".to_string()
        }
    );
    // The reuse path: the sandbox is readable and ready.
    let reused = transport.get_sandbox("demo").await.expect("read");
    assert_eq!(
        reused.map(|sandbox| sandbox.phase),
        Some(Some("Ready".to_string()))
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn streamed_exec_writes_before_the_stream_ends_and_reports_the_status_separately() {
    let dir = state_dir("exec");
    let stub = Stub::new(&dir, None).with_exec("first chunk\n", 7);
    seed_sandbox(&dir, "demo", "Ready");
    let transport = gateway(stub).await;

    let mut written = Counter { bytes: Vec::new() };
    let status = transport
        .exec(
            ExecRequest {
                sandbox: "demo".to_string(),
                command: vec!["sh".to_string(), "-c".to_string(), "true".to_string()],
                workdir: None,
                no_login_shell: true,
                stdin: None,
                timeout: None,
            },
            &mut written,
        )
        .await
        .expect("exec");
    assert_eq!(written.bytes, b"first chunk\n");
    // The exit status is reported separately from the output.
    assert_eq!(status.code, 7);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_probe_may_buffer_and_still_reports_code_and_output_distinctly() {
    let dir = state_dir("probe");
    let stub = Stub::new(&dir, None).with_exec("probe output\n", 3);
    seed_sandbox(&dir, "demo", "Ready");
    let transport = gateway(stub).await;

    let output = transport
        .exec_buffered(ExecRequest {
            sandbox: "demo".to_string(),
            command: vec!["true".to_string()],
            workdir: None,
            no_login_shell: true,
            stdin: None,
            timeout: None,
        })
        .await
        .expect("probe");
    assert_eq!(output.exit_code, 3);
    assert_eq!(String::from_utf8_lossy(&output.stdout), "probe output\n");
    assert!(output.stderr.is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn providers_attach_detach_and_list_over_the_client() {
    let dir = state_dir("providers");
    let stub = Stub::new(&dir, None);
    seed_sandbox(&dir, "demo", "Ready");
    let transport = gateway(stub.clone()).await;

    transport
        .create_provider(ProviderSpec {
            name: "maki-deepseek".to_string(),
            profile: "maki-deepseek".to_string(),
            credential_key: Some("DEEPSEEK_API_KEY".to_string()),
            credential: None,
        })
        .await
        .expect("provider");
    assert_eq!(
        transport.list_providers().await.expect("listed"),
        vec!["maki-deepseek".to_string()]
    );
    transport
        .attach_provider("demo", "maki-deepseek")
        .await
        .expect("attached");
    assert_eq!(
        transport
            .attached_providers("demo")
            .await
            .expect("attached list"),
        vec!["maki-deepseek".to_string()]
    );
    transport
        .detach_provider("demo", "maki-deepseek")
        .await
        .expect("detached");
    assert!(transport
        .attached_providers("demo")
        .await
        .expect("attached list")
        .is_empty());
    // No command other than an explicit approval writes a rule.
    assert!(!stub.requests().iter().any(|line| line.starts_with("rule ")));
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn rule_listing_carries_the_structured_fields_and_approval_targets_one_chunk() {
    let dir = state_dir("rules");
    let stub = Stub::new(&dir, None);
    seed_sandbox(&dir, "demo", "Ready");
    std::fs::create_dir_all(dir.join("rules")).expect("rules");
    std::fs::write(
        dir.join("rules").join("demo"),
        "chunk-1|allow-api|/usr/bin/curl|api.example.test:443|clean\nchunk-2|allow-dns|/usr/bin/dig|dns.example.test:53|review\n",
    )
    .expect("chunks");
    let transport = gateway(stub.clone()).await;

    let rules: Vec<Rule> = transport.list_rules("demo").await.expect("listed");
    assert_eq!(rules.len(), 2);
    let first = &rules[0];
    assert_eq!(first.chunk_id.as_deref(), Some("chunk-1"));
    assert_eq!(first.name, "allow-api");
    assert_eq!(first.binary.as_deref(), Some("/usr/bin/curl"));
    assert_eq!(first.endpoints, vec!["api.example.test:443".to_string()]);
    assert_eq!(first.verdict.as_deref(), Some("clean"));

    transport
        .approve_rule("demo", "chunk-1")
        .await
        .expect("approved");
    let remaining = transport.list_rules("demo").await.expect("listed");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].chunk_id.as_deref(), Some("chunk-2"));
    let writes: Vec<String> = stub
        .requests()
        .into_iter()
        .filter(|line| line.starts_with("rule approve"))
        .collect();
    assert_eq!(
        writes,
        vec!["rule approve demo --chunk-id chunk-1".to_string()]
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_missing_sandbox_is_not_found_and_a_refused_delete_keeps_it() {
    let dir = state_dir("errors");
    let stub = Stub::new(&dir, None).with_delete_failure();
    seed_sandbox(&dir, "demo", "Ready");
    let transport = gateway(stub).await;

    assert_eq!(
        transport
            .delete_sandbox("demo")
            .await
            .expect_err("refused")
            .code(),
        3
    );
    assert!(transport.get_sandbox("demo").await.expect("read").is_some());
    let _ = std::fs::remove_dir_all(&dir);
}

/// The sink the streaming cases use; it keeps what it was handed.
struct Counter {
    bytes: Vec<u8>,
}

impl ChunkSink for Counter {
    fn write(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }
}
