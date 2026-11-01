//! Message parity: the usage text and every usage error are compared byte for
//! byte against the recording made from the shell implementation.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/messages")
}

fn case_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(fixtures())
        .expect("message fixtures")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs
}

#[test]
fn the_dispatcher_reproduces_every_recorded_message_and_exit_code() {
    let mut checked = 0;
    for dir in case_dirs() {
        let name = dir
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let args_text = fs::read_to_string(dir.join("args")).expect("args");
        let args: Vec<&str> = args_text.lines().filter(|line| !line.is_empty()).collect();
        let output = Command::new(env!("CARGO_BIN_EXE_osa"))
            .args(&args)
            .output()
            .expect("osa runs");

        let expected_stdout = fs::read_to_string(dir.join("stdout")).expect("stdout");
        let expected_stderr = fs::read_to_string(dir.join("stderr")).expect("stderr");
        let expected_rc = fs::read_to_string(dir.join("rc")).expect("rc");

        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            expected_stdout,
            "stdout for {name}"
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stderr),
            expected_stderr,
            "stderr for {name}"
        );
        assert_eq!(
            output.status.code().map(|code| code.to_string()),
            Some(expected_rc.trim().to_string()),
            "exit status for {name}"
        );
        checked += 1;
    }
    assert!(checked >= 30, "message fixtures lost: {checked}");
}

#[test]
fn the_help_text_lists_every_documented_subcommand() {
    let output = Command::new(env!("CARGO_BIN_EXE_osa"))
        .arg("help")
        .output()
        .expect("osa runs");
    let text = String::from_utf8_lossy(&output.stdout);
    for command in [
        "projects [--json]",
        "status [PATH] [--json] [--quick]",
        "health SANDBOX [--json]",
        "providers [--agent TAG] [--json]",
        "images [--json]",
        "resolve SANDBOX ACTION",
        "remove SANDBOX --yes",
        "provider setup TAG --profile ID",
        "image build TAG",
        "dashboard [--port N]",
    ] {
        assert!(text.contains(command), "help text lacks {command}");
    }
}
