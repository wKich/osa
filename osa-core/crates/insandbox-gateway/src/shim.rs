//! The `openshell` shim.
//!
//! Discovery, file transfer, and the helper scripts' `sandbox exec` form are
//! CLI-only by design, so the plane needs a shim. It is installed into the
//! state root's `shim/` directory and is usable only because the plane
//! prepends that directory to `PATH` for its own child process tree. It is
//! never written to a system bin directory.
//!
//! The shim script delegates to this binary's `__openshell` subcommand, so the
//! path checks live in one place and are the same ones the tests exercise.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use crate::state::StateRoot;
use crate::transfer;
use crate::{child_environment, rewrite_sandbox_path};

/// The environment variable that names the state root for the shim.
pub const STATE_ROOT_ENV: &str = "IN_SANDBOX_GATEWAY_STATE_ROOT";
/// The environment variable that names the plane's endpoint for the shim.
pub const SERVER_ENV: &str = "IN_SANDBOX_GATEWAY_SERVER";
/// The environment variable that names this binary for the shim script.
pub const BIN_ENV: &str = "IN_SANDBOX_GATEWAY_BIN";

/// The shim script. Defaults are baked so a child that loses the environment
/// still resolves the state root and endpoint, while the PATH placement remains
/// the only way it is found.
pub fn script(exe: &Path, state_root: &Path, server: &str) -> String {
    let mut lines = vec![
        "#!/bin/sh".to_string(),
        "# insandbox-gateway private PATH shim. Never install system-wide.".to_string(),
        "# The plane prepends this directory to PATH for its child tree only.".to_string(),
        "set -eu".to_string(),
        format!(
            ": {}=${{{0}:={}}}",
            STATE_ROOT_ENV,
            quote(&state_root.display().to_string())
        ),
        format!("export {STATE_ROOT_ENV}"),
    ];
    if !server.is_empty() {
        lines.push(format!(": {}=${{{0}:={}}}", SERVER_ENV, quote(server)));
        lines.push(format!("export {SERVER_ENV}"));
    }
    lines.push(format!(
        ": {}=${{{0}:={}}}",
        BIN_ENV,
        quote(&exe.display().to_string())
    ));
    lines.push(format!("export {BIN_ENV}"));
    lines.push(format!("exec \"${{{BIN_ENV}}}\" __openshell \"$@\""));
    lines.push(String::new());
    lines.join("\n")
}

fn quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "/._-:".contains(ch))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

/// Run the shim's CLI surface. Returns the process exit code.
pub fn run(args: &[OsString]) -> ExitCode {
    let words: Vec<String> = args
        .iter()
        .map(|word| word.to_string_lossy().into_owned())
        .collect();
    match dispatch(&words) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("insandbox-gateway shim: {error}");
            ExitCode::from(2)
        }
    }
}

fn dispatch(words: &[String]) -> Result<ExitCode, String> {
    let mut words = words;
    // `openshell -g NAME ...` is accepted and ignored: the plane is the only
    // gateway this shim can reach.
    if words.first().is_some_and(|word| word == "-g") {
        if words.len() < 3 {
            return Err("unsupported form: -g without a subcommand".to_string());
        }
        words = &words[2..];
    }

    match words {
        [gateway, info, ..] if gateway == "gateway" && info == "info" => {
            if words.len() == 4 && words[2] == "--output" && words[3] == "json" {
                print_gateway_info()?;
                Ok(ExitCode::SUCCESS)
            } else {
                Err(format!("unsupported form: {}", words.join(" ")))
            }
        }
        // `doctor` asks the CLI for connection state; the shim answers from
        // the same baked endpoint it gives discovery, and never from a socket.
        [status, output, format]
            if status == "status" && output == "--output" && format == "json" =>
        {
            print_status()?;
            Ok(ExitCode::SUCCESS)
        }
        [sandbox, verb, rest @ ..] if sandbox == "sandbox" && verb == "upload" => {
            let positionals = positionals(rest, &["--no-git-ignore"])?;
            upload(&positionals)?;
            Ok(ExitCode::SUCCESS)
        }
        [sandbox, verb, rest @ ..] if sandbox == "sandbox" && verb == "download" => {
            let positionals = positionals(rest, &[])?;
            download(&positionals)?;
            Ok(ExitCode::SUCCESS)
        }
        [sandbox, verb, rest @ ..] if sandbox == "sandbox" && verb == "exec" => exec(rest),
        _ => Err(format!("unsupported subcommand: {}", words.join(" "))),
    }
}

/// `openshell sandbox exec` as the helper scripts use it: `-n NAME`, then
/// `-- no-login-shell` flags, then `--`, then the command. The child runs
/// directly with the same environment layering and sandbox-path rewriting the
/// plane applies to a typed exec, and its exit code is its own. No login shell
/// is ever added; the shim only ever runs the argv it was given.
fn exec(rest: &[String]) -> Result<ExitCode, String> {
    let mut name: Option<String> = None;
    let mut workdir = String::new();
    let mut command: Vec<String> = Vec::new();
    let mut index = 0;
    while index < rest.len() {
        match rest[index].as_str() {
            "--" => {
                command = rest[index + 1..].to_vec();
                break;
            }
            "-n" | "--name" => {
                index += 1;
                name = rest.get(index).cloned();
            }
            "--workdir" | "-w" => {
                index += 1;
                workdir = rest.get(index).cloned().unwrap_or_default();
            }
            "--no-login-shell" => {}
            word if word.starts_with('-') => {
                return Err(format!("unsupported exec flag: {word}"));
            }
            _ => {
                command = rest[index..].to_vec();
                break;
            }
        }
        index += 1;
    }
    let name = name.ok_or_else(|| "sandbox exec needs -n NAME".to_string())?;
    if command.is_empty() {
        return Err("sandbox exec needs a command after --".to_string());
    }
    let state = state_root()?;
    let phase = state
        .phase(&name)
        .ok_or_else(|| format!("sandbox '{name}' not found"))?;
    if phase == "Stopped" {
        return Err(format!("sandbox '{name}' is stopped; start it before exec"));
    }
    let root = state.root_dir(&name);
    let cwd =
        transfer::workdir(&root, &workdir).map_err(|error| format!("sandbox exec: {error}"))?;
    let root_text = root.display().to_string();
    let argv: Vec<String> = command
        .iter()
        .map(|word| rewrite_sandbox_path(word, &root_text))
        .collect();
    let server = std::env::var(SERVER_ENV).unwrap_or_default();
    let exe = std::env::var_os(BIN_ENV)
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_default();
    let env = child_environment(&state, &server, &exe, &name, &HashMap::new());
    let status = std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .status()
        .map_err(|error| format!("sandbox exec: could not start '{}': {error}", argv[0]))?;
    let code = status.code().unwrap_or(1).clamp(0, 255) as u8;
    Ok(ExitCode::from(code))
}

fn positionals(rest: &[String], flags: &[&str]) -> Result<Vec<String>, String> {
    let mut positionals = Vec::new();
    for word in rest {
        if flags.contains(&word.as_str()) {
            continue;
        }
        if word.starts_with('-') {
            return Err(format!("unsupported flag: {word}"));
        }
        positionals.push(word.clone());
    }
    Ok(positionals)
}

fn print_gateway_info() -> Result<(), String> {
    let server = std::env::var(SERVER_ENV)
        .map_err(|_| format!("{SERVER_ENV} is not set; run this through the plane's child tree"))?;
    if server.trim().is_empty() {
        return Err(format!("{SERVER_ENV} is empty"));
    }
    let version = std::env::var("IN_SANDBOX_GATEWAY_VERSION")
        .unwrap_or_else(|_| "0.1.5-insandbox".to_string());
    println!(
        "{{\"gateway\":\"insandbox\",\"server\":\"{server}\",\"auth\":null,\"status\":\"Connected\",\"version\":\"{version}\"}}"
    );
    Ok(())
}

fn print_status() -> Result<(), String> {
    let server = std::env::var(SERVER_ENV)
        .map_err(|_| format!("{SERVER_ENV} is not set; run this through the plane's child tree"))?;
    if server.trim().is_empty() {
        return Err(format!("{SERVER_ENV} is empty"));
    }
    let version = std::env::var("IN_SANDBOX_GATEWAY_VERSION")
        .unwrap_or_else(|_| "0.1.5-insandbox".to_string());
    println!(
        "{{\"gateway\":\"insandbox\",\"server\":\"{server}\",\"status\":\"connected\",\"version\":\"{version}\"}}"
    );
    Ok(())
}

fn state_root() -> Result<StateRoot, String> {
    let root = std::env::var(STATE_ROOT_ENV).map_err(|_| {
        format!("{STATE_ROOT_ENV} is not set; run this through the plane's child tree")
    })?;
    StateRoot::open(root).map_err(|error| format!("cannot open the state root: {error}"))
}

fn upload(positionals: &[String]) -> Result<(), String> {
    let (name, local, dest) = match positionals {
        [name, local] => (name, local, "."),
        [name, local, dest] => (name, local, dest.as_str()),
        _ => {
            return Err("usage: openshell sandbox upload NAME LOCAL [DEST]".to_string());
        }
    };
    let state = state_root()?;
    if !state.exists(name) {
        return Err(format!("sandbox '{name}' not found"));
    }
    let root = state.root_dir(name);
    transfer::upload(&root, Path::new(local), dest)
        .map(|_| ())
        .map_err(|error| format!("sandbox upload: {error}"))
}

fn download(positionals: &[String]) -> Result<(), String> {
    let (name, sandbox_path, dest) = match positionals {
        [name, sandbox_path] => (name, sandbox_path, ".".to_string()),
        [name, sandbox_path, dest] => (name, sandbox_path, dest.clone()),
        _ => {
            return Err("usage: openshell sandbox download NAME SANDBOX_PATH [DEST]".to_string());
        }
    };
    let state = state_root()?;
    if !state.exists(name) {
        return Err(format!("sandbox '{name}' not found"));
    }
    let root = state.root_dir(name);
    transfer::download(&root, sandbox_path, Path::new(&dest))
        .map(|_| ())
        .map_err(|error| format!("sandbox download: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_script_bakes_the_defaults_and_execs_the_binary() {
        let script = script(
            Path::new("/opt/insandbox-gateway"),
            Path::new("/sandbox/.local/state/insandbox"),
            "http://127.0.0.1:4444",
        );
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains("exec \"${IN_SANDBOX_GATEWAY_BIN}\" __openshell \"$@\""));
        assert!(script.contains("/sandbox/.local/state/insandbox"));
        assert!(script.contains("http://127.0.0.1:4444"));
        assert!(script.contains("Never install system-wide"));
    }

    #[test]
    fn unsupported_subcommands_fail_naming_themselves() {
        let error = dispatch(&["policy".to_string(), "list".to_string()]).expect_err("refused");
        assert!(error.contains("policy list"), "{error}");
        let error = dispatch(&[
            "sandbox".to_string(),
            "exec".to_string(),
            "demo".to_string(),
        ])
        .expect_err("refused");
        assert!(error.contains("sandbox exec"), "{error}");
    }
}
