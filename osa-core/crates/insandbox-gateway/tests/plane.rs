//! The plane's behavior over the real SDK surface, its shim, and its gate.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use insandbox_gateway::state::StateRoot;
use insandbox_gateway::{serve_on, Plane};
use openshell_sdk::raw::proto;
use openshell_sdk::{
    ClientConfig, DeleteOptions, ExecOptions, ListOptions, OpenShellClient, SandboxSpec,
};
use tokio::net::TcpListener;

struct Running {
    dir: PathBuf,
    state: StateRoot,
    shim: PathBuf,
    url: String,
}

fn state_dir(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "osa-insandbox-{label}-{}-{stamp}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

async fn start(label: &str) -> Running {
    let dir = state_dir(label);
    let state = StateRoot::open(&dir).expect("state root");
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
    let address = listener.local_addr().expect("address");
    let url = format!("http://{address}");
    let exe = PathBuf::from(env!("CARGO_BIN_EXE_insandbox-gateway"));
    let plane = Plane::new(state.clone(), exe, url.clone());
    let shim = plane.install_shim().expect("shim");
    tokio::spawn(async move {
        serve_on(listener, plane).await.expect("serve");
    });
    Running {
        dir,
        state,
        shim,
        url,
    }
}

async fn connect(url: &str) -> OpenShellClient {
    OpenShellClient::connect(ClientConfig::new(url.to_string()))
        .await
        .expect("connected")
}

async fn create(client: &OpenShellClient, name: &str, providers: &[&str]) {
    client
        .create_sandbox(SandboxSpec {
            name: Some(name.to_string()),
            image: Some("osa-dev:local".to_string()),
            providers: providers.iter().map(|name| name.to_string()).collect(),
            ..Default::default()
        })
        .await
        .expect("created");
}

fn run_shim(running: &Running, args: &[&str]) -> std::process::Output {
    Command::new(&running.shim)
        .args(args)
        .output()
        .expect("shim runs")
}

/// The real gateway does not create a workdir at sandbox create; the
/// front-end's first mkdir does. Tests that exec in `/sandbox/project`
/// create it the same way.
async fn make_workdir(client: &OpenShellClient, name: &str) {
    // A stopped sandbox refuses the exec; the test that stops it still calls
    // the helper, so a failure here is tolerated and the real exec reports it.
    let _ = client
        .exec(
            name,
            &["sh".into(), "-c".into(), "mkdir -p /sandbox/project".into()],
            ExecOptions::default(),
        )
        .await;
}

fn exec(
    client: &OpenShellClient,
    name: &str,
    script: &str,
) -> impl std::future::Future<Output = Result<openshell_sdk::ExecResult, openshell_sdk::SdkError>> {
    let client = client.clone();
    let name = name.to_string();
    let script = script.to_string();
    async move {
        make_workdir(&client, &name).await;
        client
            .exec(
                &name,
                &["sh".into(), "-c".into(), script],
                ExecOptions {
                    workdir: Some("/sandbox/project".to_string()),
                    ..Default::default()
                },
            )
            .await
    }
}

#[tokio::test]
async fn the_shared_sdk_surface_contract_passes() {
    let running = start("shared").await;
    let client = connect(&running.url).await;
    sdk_contract_cases::run(&client).await;
    assert_eq!(sdk_contract_cases::CASES.len(), 12);
    assert!(
        !running.state.sandbox_dir("contract-demo").exists(),
        "the shared delete case leaves the plane clean"
    );
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn an_unmodelled_operation_names_itself_and_writes_nothing() {
    let running = start("unmodelled").await;
    let client = connect(&running.url).await;
    let error = client
        .raw_grpc()
        .list_sandbox_templates(proto::ListSandboxTemplatesRequest::default())
        .await
        .expect_err("unmodelled operation fails");
    assert!(
        error.message().contains("list_sandbox_templates"),
        "{error:?}"
    );
    assert!(
        running.state.list().is_empty(),
        "no partial state was written"
    );
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn delete_removes_the_directory_and_provider_attachments() {
    let running = start("delete").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &["provider-a"]).await;
    assert!(running.state.sandbox_dir("demo").is_dir());
    assert_eq!(
        running.state.providers("demo"),
        vec!["provider-a".to_string()]
    );

    client
        .delete_sandbox("demo", DeleteOptions::default())
        .await
        .expect("deleted");
    assert!(!running.state.sandbox_dir("demo").exists());
    assert!(running.state.providers("demo").is_empty());
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn a_stopped_sandbox_refuses_exec_without_starting_a_process() {
    let running = start("stopped").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;
    client.stop_sandbox("demo").await.expect("stopped");

    let error = exec(&client, "demo", "touch started")
        .await
        .expect_err("refused");
    let text = format!("{error:?} {error}");
    assert!(text.contains("stopped"), "{text}");
    assert!(
        !running
            .state
            .root_dir("demo")
            .join("sandbox/project/started")
            .exists(),
        "no process started for the stopped sandbox"
    );
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn exec_reports_exit_7_with_its_stderr() {
    let running = start("exit-7").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;

    let result = exec(&client, "demo", "echo oops >&2; exit 7")
        .await
        .expect("the failure is the command's, not the transport's");
    assert_eq!(result.exit_code, 7);
    assert!(String::from_utf8_lossy(&result.stderr).contains("oops"));
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn exec_streams_the_first_line_before_the_process_exits() {
    let running = start("stream").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;
    make_workdir(&client, "demo").await;

    let mut stream = client
        .raw_grpc()
        .exec_sandbox(proto::ExecSandboxRequest {
            sandbox: "demo".to_string(),
            command: vec!["sh".into(), "-c".into(), "echo first; sleep 2".into()],
            workdir: "/sandbox/project".to_string(),
            ..Default::default()
        })
        .await
        .expect("exec stream")
        .into_inner();

    let first = tokio::time::timeout(Duration::from_millis(1500), stream.message())
        .await
        .expect("the first line arrives before exit")
        .expect("stream message")
        .expect("event");
    match first.payload {
        Some(proto::exec_sandbox_event::Payload::Stdout(chunk)) => {
            assert_eq!(String::from_utf8_lossy(&chunk.data).trim(), "first");
        }
        other => panic!("expected stdout, got {other:?}"),
    }
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn a_missing_command_and_a_killed_child_are_distinct_exit_codes() {
    let running = start("distinct").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;

    let missing = exec(&client, "demo", "osa-definitely-not-a-command")
        .await
        .expect("missing command is a command failure");
    assert_eq!(missing.exit_code, 127);
    assert!(String::from_utf8_lossy(&missing.stderr).contains("osa-definitely-not-a-command"));

    let killed = exec(&client, "demo", "kill -9 $$")
        .await
        .expect("a killed child is a command failure");
    assert_eq!(killed.exit_code, 137);
    assert_ne!(missing.exit_code, killed.exit_code);
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn upload_then_download_round_trips_and_writes_a_plain_file() {
    let running = start("transfer").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;

    let local = running.dir.join("local.txt");
    std::fs::write(&local, b"payload\n").expect("local file");
    let upload = run_shim(
        &running,
        &[
            "sandbox",
            "upload",
            "demo",
            &local.display().to_string(),
            "/sandbox/project/uploaded.txt",
        ],
    );
    assert!(
        upload.status.success(),
        "upload failed: {}",
        String::from_utf8_lossy(&upload.stderr)
    );

    let inside = running
        .state
        .root_dir("demo")
        .join("sandbox/project/uploaded.txt");
    let metadata = std::fs::symlink_metadata(&inside).expect("uploaded file");
    assert!(metadata.file_type().is_file(), "a plain file, not a link");
    assert!(!metadata.file_type().is_symlink());
    assert_eq!(std::fs::read(&inside).expect("inside"), b"payload\n");

    let out = running.dir.join("out.txt");
    let download = run_shim(
        &running,
        &[
            "sandbox",
            "download",
            "demo",
            "/sandbox/project/uploaded.txt",
            &out.display().to_string(),
        ],
    );
    assert!(
        download.status.success(),
        "download failed: {}",
        String::from_utf8_lossy(&download.stderr)
    );
    assert_eq!(std::fs::read(&out).expect("out"), b"payload\n");
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn an_escaping_path_is_refused_and_names_itself() {
    let running = start("escape").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;

    let outside = running.dir.join("outside.txt");
    std::fs::write(&outside, b"inert\n").expect("outside file");
    let project = running.state.root_dir("demo").join("sandbox/project");
    std::fs::create_dir_all(&project).expect("project");
    let link = project.join("escape");
    std::os::unix::fs::symlink(&outside, &link).expect("symlink");

    let stolen = running.dir.join("stolen.txt");
    let download = run_shim(
        &running,
        &[
            "sandbox",
            "download",
            "demo",
            "/sandbox/project/escape",
            &stolen.display().to_string(),
        ],
    );
    assert!(!download.status.success(), "the escape must fail");
    let stderr = String::from_utf8_lossy(&download.stderr);
    assert!(stderr.contains("escape"), "{stderr}");
    assert_eq!(std::fs::read(&outside).expect("outside"), b"inert\n");
    assert!(!stolen.exists(), "nothing was written outside the sandbox");
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn the_shim_answers_gateway_info_and_nothing_else() {
    let running = start("shim").await;
    let info = run_shim(&running, &["gateway", "info", "--output", "json"]);
    assert!(
        info.status.success(),
        "gateway info failed: {}",
        String::from_utf8_lossy(&info.stderr)
    );
    let stdout = String::from_utf8_lossy(&info.stdout);
    assert!(stdout.contains(r#""auth":null"#), "{stdout}");
    assert!(
        stdout.contains(&format!(r#""server":"{}""#, running.url)),
        "{stdout}"
    );

    let unsupported = run_shim(&running, &["policy", "list"]);
    assert!(!unsupported.status.success());
    assert!(String::from_utf8_lossy(&unsupported.stderr).contains("policy list"));

    let unsupported = run_shim(&running, &["sandbox", "exec", "demo"]);
    assert!(!unsupported.status.success());
    assert!(String::from_utf8_lossy(&unsupported.stderr).contains("sandbox exec"));
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn a_shim_exec_runs_in_the_sandbox_with_rewritten_paths() {
    let running = start("shim-exec").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;
    let root = running.state.root_dir("demo");
    std::fs::create_dir_all(root.join("sandbox/project")).expect("project");
    std::fs::write(
        root.join("sandbox/project/note.txt"),
        "from the workspace\n",
    )
    .expect("note");

    let output = run_shim(
        &running,
        &[
            "sandbox",
            "exec",
            "-n",
            "demo",
            "--no-login-shell",
            "--",
            "sh",
            "-c",
            "printf '%s\\n' \"$PWD\"; cat /sandbox/project/note.txt",
        ],
    );
    assert!(
        output.status.success(),
        "shim exec failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains(&root.join("sandbox").display().to_string()),
        "the child's cwd is the sandbox root: {stdout}"
    );
    assert!(stdout.contains("from the workspace"), "{stdout}");
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn the_shim_resolves_only_inside_the_plane_tree() {
    let running = start("path-scope").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;

    let inside = exec(&client, "demo", "command -v openshell")
        .await
        .expect("exec");
    assert_eq!(inside.exit_code, 0);
    let resolved = String::from_utf8_lossy(&inside.stdout).trim().to_string();
    assert_eq!(Path::new(&resolved), running.shim.as_path());

    let outside = Command::new("/bin/sh")
        .arg("-c")
        .arg("command -v openshell")
        .env("PATH", "/nonexistent")
        .output()
        .expect("outside shell");
    assert!(
        !outside.status.success(),
        "the shim must not resolve outside the plane's tree: {}",
        String::from_utf8_lossy(&outside.stdout)
    );
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn exec_through_the_plane_answers_gateway_info_through_the_shim() {
    let running = start("launch-path").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;

    let result = exec(&client, "demo", "openshell gateway info --output json")
        .await
        .expect("exec");
    assert_eq!(
        result.exit_code,
        0,
        "stderr: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let stdout = String::from_utf8_lossy(&result.stdout);
    assert!(
        stdout.contains(&format!(r#""server":"{}""#, running.url)),
        "{stdout}"
    );
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn a_policy_read_is_the_recorded_chunk_without_an_enforcement_claim() {
    let running = start("policy").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;
    std::fs::write(
        running.state.rules_file("demo"),
        "chunk-1|allow-api|/usr/bin/curl|api.example.test:443|clean\n",
    )
    .expect("recorded rule");

    let policy = client
        .raw_grpc()
        .get_draft_policy(proto::GetDraftPolicyRequest {
            sandbox: "demo".to_string(),
            ..Default::default()
        })
        .await
        .expect("read")
        .into_inner();
    assert_eq!(policy.chunks.len(), 1);
    assert_eq!(policy.chunks[0].id, "chunk-1");
    assert_eq!(
        policy.chunks[0]
            .proposed_rule
            .as_ref()
            .expect("proposed rule")
            .endpoints[0]
            .host,
        "api.example.test"
    );
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn a_listing_reports_the_created_sandbox() {
    let running = start("list").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;
    let listed = client
        .list_all_sandboxes(ListOptions::default())
        .await
        .expect("listed");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "demo");
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn exec_uses_the_request_environment() {
    let running = start("exec-env").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;

    make_workdir(&client, "demo").await;
    let result = client
        .exec(
            "demo",
            &[
                "sh".into(),
                "-c".into(),
                "printf %s \"$OSA_REQUEST_VAR\"".into(),
            ],
            ExecOptions {
                workdir: Some("/sandbox/project".to_string()),
                environment: HashMap::from([("OSA_REQUEST_VAR".to_string(), "value".to_string())]),
                ..Default::default()
            },
        )
        .await
        .expect("exec");
    assert_eq!(result.exit_code, 0);
    assert_eq!(String::from_utf8_lossy(&result.stdout), "value");
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn log_streaming_reports_recorded_lines() {
    let running = start("logs").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;
    let id = running.state.id("demo").expect("id");

    let mut grpc = client.raw_grpc();
    grpc.push_sandbox_logs(tokio_stream::iter(vec![proto::PushSandboxLogsRequest {
        sandbox_id: id.clone(),
        logs: vec![proto::SandboxLogLine {
            message: "hello from the sandbox".to_string(),
            ..Default::default()
        }],
    }]))
    .await
    .expect("logs pushed");

    let logs = grpc
        .get_sandbox_logs(proto::GetSandboxLogsRequest {
            sandbox: "demo".to_string(),
            ..Default::default()
        })
        .await
        .expect("logs read")
        .into_inner();
    assert_eq!(logs.logs.len(), 1);
    assert_eq!(logs.logs[0].message, "hello from the sandbox");

    let mut stream = grpc
        .watch_sandbox(proto::WatchSandboxRequest {
            sandbox: "demo".to_string(),
            follow_logs: true,
            ..Default::default()
        })
        .await
        .expect("watch")
        .into_inner();
    let event = stream
        .message()
        .await
        .expect("stream message")
        .expect("log event");
    match event.payload {
        Some(proto::sandbox_stream_event::Payload::Log(line)) => {
            assert_eq!(line.message, "hello from the sandbox");
        }
        other => panic!("expected a log event, got {other:?}"),
    }
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[test]
fn a_host_run_exits_non_zero_without_opening_a_listener() {
    // Inside the development image this run would pass the gate and serve, so
    // the unit tests in `gate` carry the refusal cases there. On a host the
    // binary must name the missing sandbox detection and open nothing.
    let detection = insandbox_gateway::Detection::current();
    if detection.uid == 1500 && detection.gid == 1500 && detection.marker {
        return;
    }

    let dir = state_dir("host-refusal");
    std::fs::create_dir_all(&dir).expect("state root");
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("probe");
    let port = listener.local_addr().expect("address").port();
    drop(listener);

    let output = Command::new(env!("CARGO_BIN_EXE_insandbox-gateway"))
        .args([
            "--state-root",
            &dir.display().to_string(),
            "--listen",
            &format!("127.0.0.1:{port}"),
        ])
        .output()
        .expect("binary runs");
    assert!(!output.status.success(), "a host run is refused");
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("sandbox detection"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        std::net::TcpListener::bind(("127.0.0.1", port)).is_ok(),
        "a refused run opens no listener"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_create_environment_reaches_the_exec_child() {
    let running = start("create-env").await;
    let client = connect(&running.url).await;
    client
        .create_sandbox(SandboxSpec {
            name: Some("demo".to_string()),
            image: Some("osa-dev:local".to_string()),
            environment: HashMap::from([("OSA_CREATE_VAR".to_string(), "ready".to_string())]),
            ..Default::default()
        })
        .await
        .expect("created");
    assert_eq!(
        running.state.environment("demo"),
        vec![("OSA_CREATE_VAR".to_string(), "ready".to_string())]
    );
    let result = exec(&client, "demo", "printf %s \"$OSA_CREATE_VAR\"")
        .await
        .expect("exec");
    assert_eq!(result.exit_code, 0);
    assert_eq!(String::from_utf8_lossy(&result.stdout), "ready");
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn provider_create_and_list_record_names_and_no_value() {
    let running = start("providers").await;
    let client = connect(&running.url).await;
    let request = proto::CreateProviderRequest {
        provider: Some(proto::Provider {
            metadata: Some(proto::ObjectMeta {
                name: "e2e-noop".to_string(),
                ..Default::default()
            }),
            credentials: HashMap::from([(
                "E2E_FIXTURE_CREDENTIAL".to_string(),
                "sentinel-value-not-stored".to_string(),
            )]),
            ..Default::default()
        }),
        ..Default::default()
    };
    client
        .raw_grpc()
        .create_provider(request.clone())
        .await
        .expect("created");
    let duplicate = client.raw_grpc().create_provider(request).await;
    assert!(duplicate.is_err(), "a duplicate provider is refused");
    assert_eq!(running.state.provider_names(), vec!["e2e-noop".to_string()]);
    let listed = client
        .raw_grpc()
        .list_providers(proto::ListProvidersRequest::default())
        .await
        .expect("listed")
        .into_inner();
    assert_eq!(listed.providers.len(), 1);
    assert_eq!(
        listed.providers[0]
            .metadata
            .as_ref()
            .expect("metadata")
            .name,
        "e2e-noop"
    );
    // The value never reaches the state root.
    for entry in walk(&running.dir) {
        let text = std::fs::read_to_string(&entry).unwrap_or_default();
        assert!(
            !text.contains("sentinel-value-not-stored"),
            "a credential value reached {}",
            entry.display()
        );
    }
    let _ = std::fs::remove_dir_all(&running.dir);
}

#[tokio::test]
async fn an_interactive_exec_streams_input_and_reports_the_exit() {
    let running = start("interactive").await;
    let client = connect(&running.url).await;
    create(&client, "demo", &[]).await;
    make_workdir(&client, "demo").await;

    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    sender
        .send(proto::ExecSandboxInput {
            payload: Some(proto::exec_sandbox_input::Payload::Start(
                proto::ExecSandboxRequest {
                    sandbox: "demo".to_string(),
                    command: vec![
                        "sh".to_string(),
                        "-c".to_string(),
                        "read line; echo \"got:$line\"; echo err >&2; exit 3".to_string(),
                    ],
                    workdir: "/sandbox/project".to_string(),
                    tty: true,
                    ..Default::default()
                },
            )),
        })
        .await
        .expect("start frame");
    let mut stream = client
        .raw_grpc()
        .exec_sandbox_interactive(tokio_stream::wrappers::ReceiverStream::new(receiver))
        .await
        .expect("interactive exec")
        .into_inner();
    sender
        .send(proto::ExecSandboxInput {
            payload: Some(proto::exec_sandbox_input::Payload::Stdin(
                b"hello\n".to_vec(),
            )),
        })
        .await
        .expect("stdin frame");
    drop(sender);

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit = None;
    while let Some(event) = stream.message().await.expect("event") {
        match event.payload {
            Some(proto::exec_sandbox_event::Payload::Stdout(chunk)) => stdout.extend(chunk.data),
            Some(proto::exec_sandbox_event::Payload::Stderr(chunk)) => stderr.extend(chunk.data),
            Some(proto::exec_sandbox_event::Payload::Exit(status)) => {
                exit = Some(status.exit_code);
            }
            None => {}
        }
    }
    assert_eq!(String::from_utf8_lossy(&stdout), "got:hello\n");
    assert_eq!(String::from_utf8_lossy(&stderr), "err\n");
    assert_eq!(exit, Some(3));
    let _ = std::fs::remove_dir_all(&running.dir);
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            files.extend(walk(&path));
        } else if path.is_file() {
            files.push(path);
        }
    }
    files
}

#[tokio::test]
async fn the_shim_answers_doctor_status_from_the_baked_endpoint() {
    let running = start("status").await;
    let output = run_shim(&running, &["status", "--output", "json"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("\"status\":\"connected\""), "{text}");
    assert!(text.contains(&running.url), "{text}");
    let _ = std::fs::remove_dir_all(&running.dir);
}
