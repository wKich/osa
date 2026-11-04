//! The stub gateway speaks enough of the OpenShell service for the typed
//! client to drive it: health, sandbox lifecycle, exec, providers, and draft
//! policy chunks. These tests are the contract between the two.

use std::path::PathBuf;

use openshell_sdk::{ClientConfig, ExecOptions, ListOptions, OpenShellClient, SandboxSpec};
use stub_gateway::Stub;

fn state_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osa-stub-gateway-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

async fn serve(stub: Stub) -> String {
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
    format!("http://{addr}")
}

async fn connect(url: String) -> OpenShellClient {
    OpenShellClient::connect(ClientConfig::new(url))
        .await
        .expect("connected")
}

#[tokio::test]
async fn the_shared_sdk_surface_contract_passes() {
    let dir = state_dir("shared-contract");
    let stub = Stub::new(&dir, None);
    let url = serve(stub.clone()).await;
    let client = connect(url).await;

    sdk_contract_cases::run(&client).await;

    // The shared case list is the same one the plane runs.
    assert!(sdk_contract_cases::CASES.contains(&"exec"));
    assert_eq!(sdk_contract_cases::CASES.len(), 12);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn health_and_sandbox_lifecycle_round_trip() {
    let dir = state_dir("lifecycle");
    let stub = Stub::new(&dir, None);
    let url = serve(stub.clone()).await;
    let client = connect(url).await;

    let health = client.health().await.expect("healthy");
    assert_eq!(health.status, openshell_sdk::ServiceStatus::Healthy);

    let created = client
        .create_sandbox(SandboxSpec {
            name: Some("demo".to_string()),
            image: Some("maki-agent:local".to_string()),
            ..Default::default()
        })
        .await
        .expect("created");
    assert_eq!(created.name, "demo");
    assert_eq!(created.phase, openshell_sdk::SandboxPhase::Ready);

    let listed = client
        .list_all_sandboxes(ListOptions::default())
        .await
        .expect("listed");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "demo");

    let exec = client
        .exec(
            "demo",
            &["sh".into(), "-c".into(), "true".into()],
            ExecOptions::default(),
        )
        .await
        .expect("exec");
    assert_eq!(exec.exit_code, 0);
    assert_eq!(
        String::from_utf8_lossy(&exec.stdout).trim_end(),
        "stub-exec-output"
    );

    let stopped = client.stop_sandbox("demo").await.expect("stopped");
    assert_eq!(stopped.phase, openshell_sdk::SandboxPhase::Stopped);
    let started = client.start_sandbox("demo").await.expect("started");
    assert_eq!(started.phase, openshell_sdk::SandboxPhase::Ready);

    let deletion = client
        .delete_sandbox("demo", Default::default())
        .await
        .expect("deleted");
    assert!(deletion.sandbox_id.is_some(), "the id is reported back");
    assert!(
        client.get_sandbox("demo").await.is_err(),
        "the sandbox is gone"
    );

    // Every request also shows up as the equivalent CLI argv, which is what the
    // shell suite's assertions read.
    let requests = stub.requests();
    assert!(requests
        .iter()
        .any(|line| line == "sandbox create --name demo --from maki-agent:local --detach"));
    assert!(requests.iter().any(|line| line == "sandbox delete demo"));
    assert!(requests.iter().any(|line| line == "sandbox start demo"));
    assert!(requests.iter().any(|line| line == "sandbox stop demo"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn an_existing_name_reports_already_exists_and_a_create_race_reuses_it() {
    let dir = state_dir("race");
    let stub = Stub::new(&dir, None);
    let url = serve(stub.clone()).await;
    let client = connect(url).await;

    std::fs::create_dir_all(dir.join("sandboxes")).expect("state");
    std::fs::write(dir.join("sandboxes").join("demo"), "Ready\n").expect("phase");
    let error = client
        .create_sandbox(SandboxSpec {
            name: Some("demo".to_string()),
            ..Default::default()
        })
        .await
        .expect_err("already exists");
    assert!(
        matches!(error, openshell_sdk::SdkError::AlreadyExists { .. }),
        "{error:?}"
    );
    // The create-race path re-reads and reuses, so the sandbox is readable.
    assert_eq!(
        client.get_sandbox("demo").await.expect("read").phase,
        openshell_sdk::SandboxPhase::Ready
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn draft_chunks_carry_the_identifier_the_rule_name_and_the_verdict() {
    let dir = state_dir("rules");
    let stub = Stub::new(&dir, None);
    let url = serve(stub.clone()).await;
    let client = connect(url).await;

    std::fs::create_dir_all(dir.join("sandboxes")).expect("state");
    std::fs::write(dir.join("sandboxes").join("demo"), "Ready\n").expect("phase");
    std::fs::create_dir_all(dir.join("rules")).expect("rules");
    std::fs::write(
        dir.join("rules").join("demo"),
        "chunk-1|allow-api|/usr/bin/curl|api.example.test:443|clean\n",
    )
    .expect("chunk");

    let mut grpc = client.raw_grpc();
    let policy = grpc
        .get_draft_policy(openshell_sdk::raw::proto::GetDraftPolicyRequest {
            sandbox: "demo".to_string(),
            status_filter: "pending".to_string(),
            ..Default::default()
        })
        .await
        .expect("chunks")
        .into_inner();
    assert_eq!(policy.chunks.len(), 1);
    let chunk = &policy.chunks[0];
    assert_eq!(chunk.id, "chunk-1");
    assert_eq!(chunk.rule_name, "allow-api");
    assert_eq!(chunk.binary, "/usr/bin/curl");
    assert_eq!(chunk.validation_result, "clean");
    let rule = chunk.proposed_rule.as_ref().expect("proposed rule");
    assert_eq!(rule.endpoints.len(), 1);
    assert_eq!(rule.endpoints[0].host, "api.example.test");

    grpc.approve_draft_chunk(openshell_sdk::raw::proto::ApproveDraftChunkRequest {
        sandbox: "demo".to_string(),
        chunk_id: "chunk-1".to_string(),
        ..Default::default()
    })
    .await
    .expect("approved");
    assert!(stub
        .requests()
        .iter()
        .any(|line| line == "rule approve demo --chunk-id chunk-1"));

    let _ = std::fs::remove_dir_all(&dir);
}
