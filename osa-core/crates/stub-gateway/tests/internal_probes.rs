//! The helper's own probes travel over the typed client too, so the fake
//! gateway has to answer them from the same per-run fixtures the CLI stub
//! reads. These tests pin that: a case's answer and its failure fixture both
//! reach a scripted probe, and an agent command stays an agent run.

use std::path::{Path, PathBuf};

use openshell_sdk::{ClientConfig, ExecOptions, OpenShellClient};
use stub_gateway::Stub;

fn state_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osa-stub-gateway-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("sandboxes")).expect("sandboxes");
    std::fs::write(dir.join("sandboxes").join("demo"), "Ready\n").expect("phase");
    std::fs::create_dir_all(dir.join("fixtures")).expect("fixtures");
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

fn fixture(dir: &Path, name: &str, text: &str) {
    std::fs::write(dir.join("fixtures").join(name), text).expect("fixture");
}

fn argv(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| word.to_string()).collect()
}

#[tokio::test]
async fn a_case_answer_reaches_the_idle_probe() {
    let dir = state_dir("idle-answer");
    let stub = Stub::new(&dir, None);
    let client = connect(serve(stub).await).await;

    let answer = dir.join("scan-answer");
    std::fs::write(&answer, "idle\n").expect("answer");
    fixture(
        &dir,
        "exec.cases",
        &format!("maki-oss-idle|0|{}\n", answer.display()),
    );

    // The script would print "busy": only the case's answer can produce
    // "idle", so the assertion names which one the gateway used.
    let scan = "printf 'busy\\n'";
    let exec = client
        .exec(
            "demo",
            &argv(&["sh", "-c", scan, "maki-oss-idle"]),
            ExecOptions::default(),
        )
        .await
        .expect("exec");

    assert_eq!(exec.exit_code, 0);
    assert_eq!(String::from_utf8_lossy(&exec.stdout), "idle\n");
    assert!(exec.stderr.is_empty(), "the fixture supplies no stderr");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_failure_fixture_fails_the_probe() {
    let dir = state_dir("idle-failure");
    let stub = Stub::new(&dir, None);
    let client = connect(serve(stub).await).await;

    fixture(&dir, "exec.fail", "maki-oss-result\n");

    let exec = client
        .exec(
            "demo",
            &argv(&["sh", "-c", "printf 'maki-oss-result\\n'", "maki-oss-git"]),
            ExecOptions::default(),
        )
        .await
        .expect("exec");

    assert_eq!(exec.exit_code, 1);
    assert!(exec.stdout.is_empty(), "a failed probe has no answer");
    assert_eq!(
        String::from_utf8_lossy(&exec.stderr),
        "stub: sandbox script failed\n"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn an_agent_command_runs_as_an_agent_not_a_script() {
    let dir = state_dir("agent-run");
    let stub = Stub::new(&dir, None);
    let client = connect(serve(stub).await).await;

    fixture(&dir, "exec.stdout", "agent-answer\n");
    let stdin_log = dir.join("agent-stdin");
    fixture(&dir, "exec.stdin-log", &stdin_log.display().to_string());

    let exec = client
        .exec(
            "demo",
            &argv(&["maki", "--print", "--yolo", "check"]),
            ExecOptions {
                stdin: Some(b"keep going".to_vec()),
                ..Default::default()
            },
        )
        .await
        .expect("exec");

    assert_eq!(exec.exit_code, 0);
    assert_eq!(String::from_utf8_lossy(&exec.stdout), "agent-answer\n");
    // Only an agent run logs its stdin; an internal script returns first.
    assert_eq!(
        std::fs::read_to_string(&stdin_log).expect("stdin log"),
        "keep going"
    );

    // The claude front-end wraps its interactive command in a shell form whose
    // fourth word is the script's argv0, not one of the helper's labels. It is
    // still the agent run: the script never executes on the host.
    let interactive = client
        .exec(
            "demo",
            &argv(&[
                "sh",
                "-c",
                "/usr/local/libexec/claude-oss/approve-api-key; exec \"$@\"",
                "sh",
                "claude",
                "--dangerously-skip-permissions",
            ]),
            ExecOptions::default(),
        )
        .await
        .expect("exec");
    assert_eq!(interactive.exit_code, 0);
    assert_eq!(
        String::from_utf8_lossy(&interactive.stdout),
        "agent-answer\n"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
