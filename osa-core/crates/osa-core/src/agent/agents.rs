//! Per-agent launch behavior: the argv, environment, and flag checks that
//! differ between Maki, OpenCode, Claude Code, and Codex.

use std::ffi::OsString;

use super::context::Context;
use super::failure::{Failure, Outcome};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Interactive,
    Headless,
}

pub fn supports_stdin_prompt(ctx: &Context) -> bool {
    matches!(ctx.profile.name, "maki-oss" | "claude-oss")
}

pub fn takes_passthrough(ctx: &Context) -> bool {
    matches!(ctx.profile.name, "maki-oss" | "claude-oss")
}

fn session_flags(ctx: &Context, argv: &mut Vec<String>) {
    let model = ctx.model();
    if !model.is_empty() {
        let flag = if ctx.profile.name == "codex-oss" {
            "-m"
        } else {
            "--model"
        };
        argv.push(flag.into());
        argv.push(model);
    }
    if ctx.options.continue_session {
        argv.push("--continue".into());
    }
    if let Some(resume) = ctx
        .options
        .resume
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        argv.push("--resume".into());
        argv.push(resume.clone());
    }
    if let Some(id) = ctx
        .options
        .session_id
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        argv.push("--session-id".into());
        argv.push(id.clone());
    }
}

fn opencode_session_flags(ctx: &Context, argv: &mut Vec<String>) {
    if ctx.options.continue_session {
        argv.push("--continue".into());
    }
    if let Some(resume) = ctx
        .options
        .resume
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        argv.push("--session".into());
        argv.push(resume.clone());
    }
    if let Some(id) = ctx
        .options
        .session_id
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        argv.push("--session".into());
        argv.push(id.clone());
    }
}

pub fn interactive_argv(ctx: &Context) -> Vec<String> {
    let mut argv = Vec::new();
    match ctx.profile.name {
        "maki-oss" => {
            argv.push("maki".into());
            session_flags(ctx, &mut argv);
        }
        "opencode-oss" => {
            argv.push("opencode".into());
            argv.push("--standalone".into());
            opencode_session_flags(ctx, &mut argv);
        }
        "claude-oss" => {
            argv.push("sh".into());
            argv.push("-c".into());
            argv.push("/usr/local/libexec/claude-oss/approve-api-key; exec \"$@\"".into());
            argv.push("sh".into());
            argv.push("claude".into());
            argv.push("--dangerously-skip-permissions".into());
            session_flags(ctx, &mut argv);
        }
        "codex-oss" => {
            argv.push("codex".into());
            codex_resume_word(ctx, &mut argv);
            if ctx.options.continue_session {
                argv.push("--last".into());
                argv.push("--include-non-interactive".into());
            }
            argv.push("--dangerously-bypass-approvals-and-sandbox".into());
            if !ctx.model().is_empty() {
                argv.push("-m".into());
                argv.push(ctx.model());
            }
            if let Some(resume) = ctx
                .options
                .resume
                .as_ref()
                .filter(|value| !value.is_empty())
            {
                argv.push(resume.clone());
            }
        }
        _ => argv.push(ctx.profile.agent_command.to_string()),
    }
    argv
}

fn codex_resume_word(ctx: &Context, argv: &mut Vec<String>) {
    if ctx.options.continue_session
        || ctx
            .options
            .resume
            .as_ref()
            .is_some_and(|value| !value.is_empty())
    {
        argv.push("resume".into());
    }
}

pub fn headless_argv(
    ctx: &Context,
    prompt: &str,
    stdin_prompt: bool,
    passthrough: &[String],
    permission_flags: bool,
) -> Vec<String> {
    let mut argv = Vec::new();
    match ctx.profile.name {
        "maki-oss" => {
            argv.extend([
                "maki".into(),
                "--print".into(),
                "--yolo".into(),
                "--trust".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
            ]);
            session_flags(ctx, &mut argv);
        }
        "opencode-oss" => {
            argv.extend([
                "opencode".into(),
                "run".into(),
                "--standalone".into(),
                "--auto".into(),
                "--format".into(),
                "json".into(),
            ]);
            let model = ctx.model();
            if !model.is_empty() {
                argv.push("--model".into());
                argv.push(model);
            }
            opencode_session_flags(ctx, &mut argv);
        }
        "claude-oss" => {
            argv.extend([
                "claude".into(),
                "-p".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
            ]);
            if !permission_flags {
                argv.push("--dangerously-skip-permissions".into());
            }
            session_flags(ctx, &mut argv);
        }
        "codex-oss" => {
            argv.extend(["codex".into(), "exec".into()]);
            codex_resume_word(ctx, &mut argv);
            if ctx.options.continue_session {
                argv.push("--last".into());
            }
            argv.extend([
                "--json".into(),
                "--skip-git-repo-check".into(),
                "--dangerously-bypass-approvals-and-sandbox".into(),
            ]);
            if !ctx.model().is_empty() {
                argv.push("-m".into());
                argv.push(ctx.model());
            }
            if let Some(resume) = ctx
                .options
                .resume
                .as_ref()
                .filter(|value| !value.is_empty())
            {
                argv.push(resume.clone());
            }
        }
        _ => argv.push(ctx.profile.agent_command.to_string()),
    }
    argv.extend(passthrough.iter().cloned());
    if !stdin_prompt {
        argv.push(prompt.to_string());
    }
    argv
}

pub fn exec_env(ctx: &Context, mode: Mode) -> Vec<(String, String)> {
    match ctx.profile.name {
        "opencode-oss" => {
            let mut env = vec![("OPENCODE_DISABLE_MODELS_FETCH".to_string(), "1".to_string())];
            let model = ctx.model();
            if mode == Mode::Interactive && !model.is_empty() {
                let escaped = model.replace('\\', "\\\\").replace('"', "\\\"");
                env.push((
                    "OPENCODE_CONFIG_CONTENT".to_string(),
                    format!("{{\"model\":\"{escaped}\"}}"),
                ));
            }
            env
        }
        "codex-oss" => {
            let account = codex_account_id(ctx);
            if account.is_empty() {
                Vec::new()
            } else {
                vec![("CODEX_CHATGPT_ACCOUNT_ID".to_string(), account)]
            }
        }
        _ => Vec::new(),
    }
}

fn codex_account_id(ctx: &Context) -> String {
    if let Some(value) = ctx.profile.env_setting("ACCOUNT_ID") {
        return value;
    }
    ctx.config
        .get("account_id")
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

pub fn check_session_flags(ctx: &Context, mode: Mode) -> Outcome {
    match ctx.profile.name {
        "opencode-oss" => {
            if ctx.options.continue_session
                && ctx
                    .options
                    .session_id
                    .as_ref()
                    .is_some_and(|v| !v.is_empty())
            {
                return Err(Failure::usage(
                    "--continue cannot be combined with --session-id",
                ));
            }
            if ctx.options.resume.as_ref().is_some_and(|v| !v.is_empty())
                && ctx
                    .options
                    .session_id
                    .as_ref()
                    .is_some_and(|v| !v.is_empty())
            {
                return Err(Failure::usage(
                    "--resume cannot be combined with --session-id",
                ));
            }
        }
        "claude-oss" => {
            if ctx.options.continue_session
                && ctx
                    .options
                    .session_id
                    .as_ref()
                    .is_some_and(|v| !v.is_empty())
            {
                return Err(Failure::usage(
                    "--continue cannot be combined with --session-id",
                ));
            }
            if ctx.options.resume.as_ref().is_some_and(|v| !v.is_empty())
                && ctx
                    .options
                    .session_id
                    .as_ref()
                    .is_some_and(|v| !v.is_empty())
            {
                return Err(Failure::usage(
                    "--resume cannot be combined with --session-id",
                ));
            }
            if let Some(id) = ctx.options.session_id.as_ref().filter(|v| !v.is_empty()) {
                if !is_uuid(id) {
                    return Err(Failure::usage(format!(
                        "--session-id must be a UUID (for example 123e4567-e89b-12d3-a456-426614174000), got '{id}'"
                    )));
                }
            }
        }
        "codex-oss" => {
            if ctx
                .options
                .session_id
                .as_ref()
                .is_some_and(|v| !v.is_empty())
            {
                return Err(Failure::usage(
                    "--session-id is not supported: Codex cannot start a session with a chosen ID; use --resume ID to continue one",
                ));
            }
            if codex_account_id(ctx).is_empty() {
                return Err(Failure::usage(format!(
                    "no ChatGPT account ID configured; run '{} provider setup' (it writes account_id to {})",
                    ctx.program(),
                    ctx.profile.config_path().display()
                )));
            }
        }
        "maki-oss" if mode == Mode::Interactive => {
            let tui = resolved_tui(ctx)?;
            if tui == "opencode"
                && (ctx.options.continue_session
                    || ctx.options.resume.as_ref().is_some_and(|v| !v.is_empty())
                    || ctx
                        .options
                        .session_id
                        .as_ref()
                        .is_some_and(|v| !v.is_empty()))
            {
                return Err(Failure::usage(
                    "--continue, --resume, and --session-id are unsupported in OpenCode TUI mode (tui = \"opencode\"); unset the tui setting to use Maki's TUI",
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

/// Checks `run`'s words after `--`; returns whether a permission flag was
/// passed (Claude Code drops its bypass in that case).
pub fn passthrough_check(ctx: &Context, words: &[OsString]) -> Result<bool, Failure> {
    if words.is_empty() {
        return Ok(false);
    }
    let mut permission_flags = false;
    let mut index = 0;
    while index < words.len() {
        let word = words[index].to_string_lossy().into_owned();
        match ctx.profile.name {
            "maki-oss" => match word.as_str() {
                "--fork-session" => {}
                "--disallowed-tools" => {
                    ensure_value(words, index, &word)?;
                    index += 1;
                }
                other => {
                    return Err(Failure::usage(format!(
                        "pass-through option {other} is not allowed after --: use --disallowed-tools or --fork-session"
                    )))
                }
            },
            "claude-oss" => match word.as_str() {
                "--fork-session" => {}
                "--permission-mode" | "--allowedTools" | "--disallowedTools" | "--add-dir"
                | "--effort" => {
                    ensure_value(words, index, &word)?;
                    if word == "--permission-mode"
                        && words[index + 1].to_string_lossy() == "bypassPermissions"
                    {
                        return Err(Failure::usage(
                            "pass-through --permission-mode bypassPermissions is not allowed: pass no permission flags to keep the bypass",
                        ));
                    }
                    if matches!(
                        word.as_str(),
                        "--permission-mode" | "--allowedTools" | "--disallowedTools"
                    ) {
                        permission_flags = true;
                    }
                    index += 1;
                }
                other => {
                    return Err(Failure::usage(format!(
                        "pass-through option {other} is not allowed after --: use --permission-mode, --allowedTools, --disallowedTools, --add-dir, --fork-session, or --effort"
                    )))
                }
            },
            _ => {}
        }
        index += 1;
    }
    Ok(permission_flags)
}

fn ensure_value(words: &[OsString], index: usize, option: &str) -> Result<(), Failure> {
    match words.get(index + 1).map(|value| value.to_string_lossy()) {
        Some(value) if !value.is_empty() && !value.starts_with("--") => Ok(()),
        Some(value) if !value.is_empty() => Err(Failure::usage(format!(
            "pass-through option {option} requires a value, got '{value}'"
        ))),
        _ => Err(Failure::usage(format!(
            "pass-through option {option} requires a value"
        ))),
    }
}

/// The interactive TUI choice: the environment first, then the config file.
/// Unset means Maki's own TTY session; `opencode` means the local bridge.
pub fn resolved_tui(ctx: &Context) -> Result<String, Failure> {
    let tui = ctx
        .profile
        .env_setting("TUI")
        .or_else(|| ctx.config.get("tui").map(str::to_string))
        .unwrap_or_default();
    match tui.as_str() {
        "" | "opencode" => Ok(tui),
        other => Err(Failure::usage(format!(
            "invalid 'tui' value <{other}>: accepted values are \"opencode\" (or leave the key unset for Maki's own TUI)"
        ))),
    }
}

fn is_uuid(value: &str) -> bool {
    let parts: Vec<&str> = value.split('-').collect();
    parts.len() == 5
        && [8, 4, 4, 4, 12]
            == [
                parts[0].len(),
                parts[1].len(),
                parts[2].len(),
                parts[3].len(),
                parts[4].len(),
            ]
        && parts
            .iter()
            .all(|part| part.chars().all(|character| character.is_ascii_hexdigit()))
}
