//! Exec as a real local child process.
//!
//! The child runs as the invoking uid in the sandbox's workdir with the
//! environment the plane passes. Output is streamed as it arrives; the child's
//! exit code is its own. A command that cannot be found is the command's
//! failure (127), and a child killed by a signal reports 128 + the signal, so
//! neither is confused with a plane failure.

use std::ffi::OsString;
use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use openshell_core::proto;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time;
use tokio_stream::wrappers::ReceiverStream;

/// A stream of exec events, all delivered as successful messages.
pub type EventStream = ReceiverStream<std::result::Result<proto::ExecSandboxEvent, tonic::Status>>;

/// Why a plane-side exec could not start. Command failures are events, not
/// this type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecError {
    EmptyCommand,
    Spawn(String),
}

impl std::fmt::Display for ExecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExecError::EmptyCommand => write!(f, "exec request has no command"),
            ExecError::Spawn(detail) => write!(f, "could not start the child process: {detail}"),
        }
    }
}

#[derive(Clone, Copy)]
enum Stream {
    Out,
    Err,
}

/// Spawn `command` in `cwd` with exactly `env`, stream its output, and report
/// its exit code. `stdin` is written to the child and closed.
pub fn run(
    command: Vec<String>,
    cwd: PathBuf,
    env: Vec<(OsString, OsString)>,
    stdin: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<EventStream, ExecError> {
    let Some((program, args)) = command.split_first() else {
        return Err(ExecError::EmptyCommand);
    };

    let spawned = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawned {
        Ok(child) => child,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let (sender, receiver) = mpsc::channel(4);
            let message = format!("insandbox-gateway: command not found: {program}\n");
            tokio::spawn(async move {
                let _ = sender.send(Ok(stderr_event(message.into_bytes()))).await;
                let _ = sender.send(Ok(exit_event(127))).await;
            });
            return Ok(ReceiverStream::new(receiver));
        }
        Err(error) => return Err(ExecError::Spawn(error.to_string())),
    };

    if let Some(mut handle) = child.stdin.take() {
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let _ = handle.write_all(&stdin).await;
            let _ = handle.shutdown().await;
        });
    }

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let (sender, receiver) = mpsc::channel(32);

    let out_sender = sender.clone();
    let out_task = tokio::spawn(async move {
        pump(stdout, Stream::Out, out_sender).await;
    });
    let err_sender = sender.clone();
    let err_task = tokio::spawn(async move {
        pump(stderr, Stream::Err, err_sender).await;
    });

    tokio::spawn(async move {
        let mut timed_out = false;
        let status = match timeout {
            Some(limit) => match time::timeout(limit, child.wait()).await {
                Ok(status) => Some(status),
                Err(_) => {
                    timed_out = true;
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    None
                }
            },
            None => Some(child.wait().await),
        };
        let _ = out_task.await;
        let _ = err_task.await;

        if timed_out {
            let limit = timeout.unwrap_or_default();
            let _ = sender
                .send(Ok(stderr_event(
                    format!(
                        "insandbox-gateway: exec timed out after {}s\n",
                        limit.as_secs()
                    )
                    .into_bytes(),
                )))
                .await;
            let _ = sender.send(Ok(exit_event(124))).await;
            return;
        }

        let code = match status.expect("a non-timeout wait returns a status") {
            Ok(status) => exit_code_of(&status),
            Err(error) => {
                let _ = sender
                    .send(Ok(stderr_event(
                        format!("insandbox-gateway: could not wait for the child: {error}\n")
                            .into_bytes(),
                    )))
                    .await;
                125
            }
        };
        let _ = sender.send(Ok(exit_event(code))).await;
    });

    Ok(ReceiverStream::new(receiver))
}

fn exit_code_of(status: &std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    match (status.code(), status.signal()) {
        (Some(code), _) => code,
        // The shell convention for a signal-terminated child.
        (None, Some(signal)) => 128 + signal,
        (None, None) => 1,
    }
}

async fn pump<R: AsyncRead + Unpin>(
    mut reader: R,
    stream: Stream,
    sender: mpsc::Sender<std::result::Result<proto::ExecSandboxEvent, tonic::Status>>,
) {
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => return,
            Ok(read) => {
                let event = match stream {
                    Stream::Out => stdout_event(buffer[..read].to_vec()),
                    Stream::Err => stderr_event(buffer[..read].to_vec()),
                };
                if sender.send(Ok(event)).await.is_err() {
                    return;
                }
            }
            Err(_) => return,
        }
    }
}

fn stdout_event(data: Vec<u8>) -> proto::ExecSandboxEvent {
    proto::ExecSandboxEvent {
        payload: Some(proto::exec_sandbox_event::Payload::Stdout(
            proto::ExecSandboxStdout { data },
        )),
    }
}

fn stderr_event(data: Vec<u8>) -> proto::ExecSandboxEvent {
    proto::ExecSandboxEvent {
        payload: Some(proto::exec_sandbox_event::Payload::Stderr(
            proto::ExecSandboxStderr { data },
        )),
    }
}

fn exit_event(exit_code: i32) -> proto::ExecSandboxEvent {
    proto::ExecSandboxEvent {
        payload: Some(proto::exec_sandbox_event::Payload::Exit(
            proto::ExecSandboxExit { exit_code },
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_stream::StreamExt;

    fn path_env() -> Vec<(OsString, OsString)> {
        vec![(OsString::from("PATH"), OsString::from("/usr/bin:/bin"))]
    }

    async fn collect(stream: EventStream) -> (Vec<u8>, Vec<u8>, i32) {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit = -1;
        let mut stream = stream;
        while let Some(event) = stream.next().await {
            match event.expect("event").payload {
                Some(proto::exec_sandbox_event::Payload::Stdout(chunk)) => {
                    stdout.extend(chunk.data);
                }
                Some(proto::exec_sandbox_event::Payload::Stderr(chunk)) => {
                    stderr.extend(chunk.data);
                }
                Some(proto::exec_sandbox_event::Payload::Exit(status)) => {
                    exit = status.exit_code;
                }
                None => {}
            }
        }
        (stdout, stderr, exit)
    }

    #[tokio::test]
    async fn a_missing_command_is_exit_127_with_its_stderr() {
        let stream = run(
            vec!["osa-definitely-not-a-command".to_string()],
            std::env::temp_dir(),
            path_env(),
            Vec::new(),
            None,
        )
        .expect("stream");
        let (stdout, stderr, exit) = collect(stream).await;
        assert!(stdout.is_empty());
        assert_eq!(exit, 127);
        assert!(String::from_utf8_lossy(&stderr).contains("osa-definitely-not-a-command"));
    }

    #[tokio::test]
    async fn output_is_streamed_before_the_process_exits() {
        let mut stream = run(
            vec!["sh".into(), "-c".into(), "echo first; sleep 2".into()],
            std::env::temp_dir(),
            path_env(),
            Vec::new(),
            None,
        )
        .expect("stream");
        let first = time::timeout(Duration::from_millis(1500), stream.next())
            .await
            .expect("the first line arrives before exit")
            .expect("event");
        match first.expect("event").payload {
            Some(proto::exec_sandbox_event::Payload::Stdout(chunk)) => {
                assert_eq!(String::from_utf8_lossy(&chunk.data).trim(), "first");
            }
            other => panic!("expected stdout, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_killed_child_reports_128_plus_the_signal() {
        let stream = run(
            vec!["sh".into(), "-c".into(), "kill -9 $$".into()],
            std::env::temp_dir(),
            path_env(),
            Vec::new(),
            None,
        )
        .expect("stream");
        let (_, _, exit) = collect(stream).await;
        assert_eq!(exit, 137);
    }

    #[tokio::test]
    async fn the_exit_code_of_a_plain_failure_is_preserved() {
        let stream = run(
            vec!["sh".into(), "-c".into(), "echo oops >&2; exit 7".into()],
            std::env::temp_dir(),
            path_env(),
            Vec::new(),
            None,
        )
        .expect("stream");
        let (_, stderr, exit) = collect(stream).await;
        assert_eq!(exit, 7);
        assert!(String::from_utf8_lossy(&stderr).contains("oops"));
    }

    #[tokio::test]
    async fn the_workdir_is_the_sandbox_directory() {
        let dir = std::env::temp_dir().join(format!("osa-insandbox-exec-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let stream = run(
            vec!["pwd".into()],
            dir.clone(),
            path_env(),
            Vec::new(),
            None,
        )
        .expect("stream");
        let (stdout, _, exit) = collect(stream).await;
        assert_eq!(exit, 0);
        let observed = String::from_utf8_lossy(&stdout);
        assert_eq!(
            std::path::Path::new(observed.trim()),
            std::fs::canonicalize(&dir).expect("canonical dir")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
