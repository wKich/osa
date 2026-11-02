//! The SDK surface contract shared by every OpenShell-compatible gateway in
//! this repository.
//!
//! `stub-gateway` and `insandbox-gateway` are different implementations of the
//! same generated RPC surface. Running this one case list against both keeps
//! the plane honest without letting either crate's fixtures define the
//! contract. Cases that depend on a crate's own state layout (seed files,
//! canned argv logs, create races) stay in that crate.

use openshell_sdk::raw::proto;
use openshell_sdk::{
    ClientConfig, DeleteOptions, ExecOptions, ListOptions, OpenShellClient, SandboxPhase,
    SandboxSpec, ServiceStatus,
};

/// The ordered cases this module runs. Both crates assert this list is what
/// they executed, so a case cannot be dropped from one side silently.
pub const CASES: &[&str] = &[
    "health",
    "create",
    "list",
    "get",
    "exec",
    "stop",
    "start",
    "provider attach",
    "provider list",
    "provider detach",
    "rule read",
    "delete",
];

/// Run every case against a connected client. The caller provides the server;
/// this module only speaks the SDK's surface.
pub async fn run(client: &OpenShellClient) {
    assert_eq!(CASES.len(), 12, "the documented case list is complete");

    let health = client.health().await.expect("health answers");
    assert_eq!(health.status, ServiceStatus::Healthy);

    let created = client
        .create_sandbox(SandboxSpec {
            name: Some("contract-demo".to_string()),
            image: Some("osa-dev:local".to_string()),
            ..Default::default()
        })
        .await
        .expect("create answers");
    assert_eq!(created.name, "contract-demo");
    assert_eq!(created.phase, SandboxPhase::Ready);

    let listed = client
        .list_all_sandboxes(ListOptions::default())
        .await
        .expect("list answers");
    assert!(
        listed.iter().any(|sandbox| sandbox.name == "contract-demo"),
        "the created sandbox is listed"
    );

    let fetched = client
        .get_sandbox("contract-demo")
        .await
        .expect("get answers");
    assert_eq!(fetched.name, "contract-demo");
    assert_eq!(fetched.phase, SandboxPhase::Ready);

    let exec = client
        .exec(
            "contract-demo",
            &["sh".into(), "-c".into(), "true".into()],
            ExecOptions::default(),
        )
        .await
        .expect("exec answers without a transport failure");
    assert_eq!(exec.exit_code, 0);

    let stopped = client
        .stop_sandbox("contract-demo")
        .await
        .expect("stop answers");
    assert_eq!(stopped.phase, SandboxPhase::Stopped);

    let started = client
        .start_sandbox("contract-demo")
        .await
        .expect("start answers");
    assert_eq!(started.phase, SandboxPhase::Ready);

    let mut grpc = client.raw_grpc();
    grpc.attach_sandbox_provider(proto::AttachSandboxProviderRequest {
        sandbox: "contract-demo".to_string(),
        provider: "contract-provider".to_string(),
        ..Default::default()
    })
    .await
    .expect("attach answers");

    let attached = grpc
        .list_sandbox_providers(proto::ListSandboxProvidersRequest {
            sandbox: "contract-demo".to_string(),
            ..Default::default()
        })
        .await
        .expect("provider list answers")
        .into_inner();
    assert!(
        attached.providers.iter().any(|provider| provider
            .metadata
            .as_ref()
            .is_some_and(|meta| meta.name == "contract-provider")),
        "the attached provider is listed"
    );

    grpc.detach_sandbox_provider(proto::DetachSandboxProviderRequest {
        sandbox: "contract-demo".to_string(),
        provider: "contract-provider".to_string(),
        ..Default::default()
    })
    .await
    .expect("detach answers");
    let after = grpc
        .list_sandbox_providers(proto::ListSandboxProvidersRequest {
            sandbox: "contract-demo".to_string(),
            ..Default::default()
        })
        .await
        .expect("provider list answers after detach")
        .into_inner();
    assert!(after.providers.is_empty(), "detach removed the attachment");

    // A rule read with no recorded chunks is still a well-formed answer: the
    // plane records policy, it does not prove it.
    let policy = grpc
        .get_draft_policy(proto::GetDraftPolicyRequest {
            sandbox: "contract-demo".to_string(),
            ..Default::default()
        })
        .await
        .expect("rule read answers")
        .into_inner();
    assert!(policy.chunks.is_empty());

    let deletion = client
        .delete_sandbox("contract-demo", DeleteOptions::default())
        .await
        .expect("delete answers");
    assert!(deletion.sandbox_id.is_some(), "delete reports the id");
    assert!(
        client.get_sandbox("contract-demo").await.is_err(),
        "the sandbox is gone after delete"
    );
}

/// Connect to a plaintext endpoint, the only transport both gateways accept.
pub async fn connect(server: String) -> OpenShellClient {
    OpenShellClient::connect(ClientConfig::new(server))
        .await
        .expect("the contract client connects")
}
