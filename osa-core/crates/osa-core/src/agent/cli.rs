//! The front-end command line: option parsing, command dispatch, and the
//! usage/exit-code conventions shared by all four binaries.

use std::ffi::OsString;

use super::caller;
use super::commands;
use super::config::{self};
use super::context::Context;
use super::failure::{Failure, Outcome};
use super::health;
use super::profile::AgentProfile;
use super::session;
use super::usage;

pub const EX_USAGE: i32 = 1;
pub const EX_DEP: i32 = 2;
pub const EX_GATEWAY: i32 = 3;

/// Commands every front-end accepts.
const SHARED_COMMANDS: [&str; 28] = [
    "doctor",
    "init",
    "up",
    "run",
    "upload",
    "download",
    "sync-in",
    "collect-patch",
    "status",
    "list",
    "logs",
    "policy",
    "provider",
    "start",
    "stop",
    "rm",
    "help",
    "__image-json",
    "__image",
    "__provider-setup",
    "__providers-json",
    "__providers",
    "__status-json",
    "__resolve",
    "__remove",
    "__idle-state",
    "__health-json",
    "__health",
];

/// Commands only this profile accepts (besides `image`, `mcp`, and `help`).
fn profile_commands(profile: &AgentProfile) -> &'static [&'static str] {
    match profile.name {
        "maki-oss" => &["image", "maki", "mcp", "fish"],
        "opencode-oss" => &["image", "opencode", "mcp", "fish"],
        "claude-oss" => &["image", "claude", "mcp"],
        "codex-oss" => &["image", "codex", "mcp"],
        other => panic!("no command set for {other}"),
    }
}

pub fn run(profile: &'static AgentProfile, args: Vec<OsString>) -> i32 {
    super::signals::install();
    // The watcher re-invokes this executable with an internal first argument.
    // It must be matched before any profile dispatch, including `help`.
    if args.first().and_then(|arg| arg.to_str()) == Some("__idle-watch") {
        return idle_watch(profile, &args[1..]);
    }

    let options = match Options::parse(profile, &args) {
        Ok(options) => options,
        Err(message) => return usage_error(profile, &message),
    };

    if options.help {
        print!("{}", usage::for_profile(profile));
        return 0;
    }

    // --continue and --resume name different sessions; upstream's precedence
    // when both are passed is unspecified, so refuse the pair instead of
    // guessing.
    if options.continue_session && options.resume.is_some() {
        return usage_error(profile, "--continue cannot be combined with --resume");
    }

    let config = match config::load(profile) {
        Ok(config) => config,
        Err(error) => {
            for problem in error.problems() {
                eprintln!("{problem}");
            }
            eprintln!("{}: {error}", profile.name);
            return EX_USAGE;
        }
    };

    let ctx = Context::new(profile, options, config);
    match dispatch(&ctx) {
        Ok(()) => 0,
        Err(failure) => {
            report(profile, &failure);
            failure.code
        }
    }
}

fn report(profile: &AgentProfile, failure: &Failure) {
    for line in &failure.lines {
        eprintln!("{}: {line}", profile.name);
    }
    if failure.usage {
        eprintln!("Run '{} help' for usage.", profile.name);
    }
}

fn dispatch(ctx: &Context) -> Outcome {
    let Some(command) = ctx.options.words.first().and_then(|word| word.to_str()) else {
        return session::session(ctx);
    };
    let args = &ctx.options.words[1..];

    if !known_command(ctx.profile, command) {
        return Err(Failure::usage(format!("unknown command: {command}")));
    }

    match command {
        "help" => {
            print!("{}", usage::for_profile(ctx.profile));
            Ok(())
        }
        "init" | "up" => {
            no_args(command, args)?;
            commands::up(ctx)
        }
        "doctor" => {
            no_args(command, args)?;
            health::doctor(ctx)
        }
        "mcp" => {
            let Some(sub) = args.first().and_then(|word| word.to_str()) else {
                return Err(Failure::usage("mcp requires a subcommand: status"));
            };
            match sub {
                "status" => {
                    no_args(sub, &args[1..])?;
                    health::mcp_status(ctx)
                }
                other => Err(Failure::usage(format!("unknown mcp subcommand: {other}"))),
            }
        }
        "status" => {
            no_args(command, args)?;
            commands::status(ctx)
        }
        "__health-json" => {
            no_args(command, args)?;
            health::health(ctx, true)
        }
        "__health" => {
            no_args(command, args)?;
            health::health(ctx, false)
        }
        "__image-json" => commands::image_report(ctx, args, false),
        "__image" => commands::image_report(ctx, args, true),
        "__provider-setup" => super::provider_setup::program(ctx, args),
        "__providers-json" => super::provider_setup::providers_report(ctx, args, false),
        "__providers" => super::provider_setup::providers_report(ctx, args, true),
        "__status-json" => {
            no_args(command, args)?;
            commands::status_json(ctx)
        }
        "__resolve" => super::resolve::resolve(ctx, args),
        "__remove" => super::resolve::remove(ctx, args),
        "__idle-state" => super::idle::state_row(ctx, args),
        "list" => {
            no_args(command, args)?;
            commands::list(ctx)
        }
        "logs" => {
            no_args(command, args)?;
            commands::logs(ctx)
        }
        "start" => {
            no_args(command, args)?;
            commands::start(ctx)
        }
        "stop" => {
            no_args(command, args)?;
            commands::stop(ctx)
        }
        "rm" => {
            no_args(command, args)?;
            commands::rm(ctx)
        }
        "run" => session::run(ctx, args),
        "maki" | "opencode" | "claude" | "codex" => {
            no_args(command, args)?;
            session::session(ctx)
        }
        "image" => {
            let Some(sub) = args.first().and_then(|word| word.to_str()) else {
                return Err(Failure::usage("image requires a subcommand: build"));
            };
            match sub {
                "build" => commands::image_build(ctx, &args[1..]),
                other => Err(Failure::usage(format!("unknown image subcommand: {other}"))),
            }
        }
        "sync-in" => caller::sync_in(ctx, args),
        "collect-patch" => caller::collect_patch(ctx, args),
        "fish" => commands::fish(ctx, args),
        "policy" => commands::policy(ctx, args),
        "provider" => {
            let Some(sub) = args.first().and_then(|word| word.to_str()) else {
                return Err(Failure::usage(
                    "provider requires a subcommand: add, attach, list, setup",
                ));
            };
            let rest = &args[1..];
            match sub {
                "add" => commands::provider_add(ctx, rest),
                "attach" => commands::provider_attach(ctx, rest),
                "list" => {
                    no_args(sub, rest)?;
                    commands::provider_list(ctx)
                }
                "setup" => super::provider_setup::command(ctx, rest),
                other => Err(Failure::usage(format!(
                    "unknown provider subcommand: {other}"
                ))),
            }
        }
        "upload" => session::upload(ctx, args),
        "download" => session::download(ctx, args),
        _ => not_ported(ctx.profile, command),
    }
}

fn no_args(command: &str, args: &[OsString]) -> Outcome {
    if args.is_empty() {
        Ok(())
    } else {
        Err(Failure::usage(format!("{command} takes no arguments")))
    }
}

fn known_command(profile: &AgentProfile, command: &str) -> bool {
    SHARED_COMMANDS.contains(&command)
        || command == "image"
        || command == "mcp"
        || profile_commands(profile).contains(&command)
}

fn usage_error(profile: &AgentProfile, message: &str) -> i32 {
    eprintln!("{}: {message}", profile.name);
    eprintln!("Run '{} help' for usage.", profile.name);
    EX_USAGE
}

fn not_ported(profile: &AgentProfile, command: &str) -> Outcome {
    let _ = profile;
    Err(Failure::dep(format!(
        "command '{command}' is not ported to the Rust front-end yet"
    )))
}

/// The detached watcher's entry point. The port of its behavior is a later
/// slice; the dispatch order above is what keeps the command line stable.
fn idle_watch(profile: &'static AgentProfile, args: &[OsString]) -> i32 {
    match super::idle::watch(profile, args) {
        Ok(()) => 0,
        Err(failure) => {
            report(profile, &failure);
            failure.code
        }
    }
}

/// Parsed command line. Positional words keep their original bytes; option
/// values are text because every one of them is a name, path, or number.
#[allow(dead_code)]
#[derive(Debug, Default)]
pub struct Options {
    pub words: Vec<OsString>,
    pub passthrough_count: usize,

    pub name: Option<String>,
    pub image: Option<String>,
    pub policy: Option<String>,
    pub cpu: Option<String>,
    pub memory: Option<String>,
    pub engine: Option<String>,
    pub gateway: Option<String>,
    pub tls_dir: Option<String>,
    pub workdir: Option<String>,
    pub providers: Vec<String>,
    pub envs: Vec<String>,
    pub env_froms: Vec<String>,
    pub allow_env: Vec<String>,
    pub credentials: Vec<String>,
    pub configs: Vec<String>,
    pub type_: Option<String>,
    pub from: Option<String>,
    pub file: Option<String>,
    pub field: Option<String>,
    pub profile: Option<String>,
    pub provider_name: Option<String>,
    pub stdin: bool,
    pub probe: bool,
    pub model: Option<String>,
    pub continue_session: bool,
    pub resume: Option<String>,
    pub timeout: Option<String>,
    pub idle_stop: Option<String>,
    pub session_id: Option<String>,
    pub since: Option<String>,
    pub source: Option<String>,
    pub level: Option<String>,
    pub lines: Option<String>,
    pub out: Option<String>,
    pub yes: bool,
    pub reason: Option<String>,
    pub full: bool,
    pub base: bool,
    pub base_ref: Option<String>,
    pub global: bool,
    pub wait: bool,
    pub tail: bool,
    pub from_existing: bool,
    pub runtime_credentials: bool,
    pub global_profile: bool,
    pub attach: Option<bool>,
    pub no_git_ignore: bool,
    pub no_sync: bool,
    pub incremental: bool,
    pub discard: bool,
    pub orphan: bool,
    pub json: bool,
    pub help: bool,
    pub version: Option<String>,
    pub device_auth: bool,
}

impl Options {
    pub fn parse(profile: &AgentProfile, args: &[OsString]) -> Result<Self, String> {
        let mut options = Options::default();
        let sync_in = args.iter().any(|arg| arg.to_str() == Some("sync-in"));

        // A value flag in the last position used to pull a command word back
        // in as its own value; catch it before parsing.
        if let Some(last) = args.last().and_then(|arg| arg.to_str()) {
            let needs_value = matches!(
                last,
                "--resume" | "-r" | "--session-id" | "--timeout" | "--idle-stop" | "--out"
            ) || (last == "--base" && sync_in);
            if needs_value {
                return Err(format!("option {last} requires a value"));
            }
        }

        let version_flag = match profile.name {
            "maki-oss" => "--maki-version",
            "opencode-oss" => "--opencode-version",
            "claude-oss" => "--claude-version",
            "codex-oss" => "--codex-version",
            other => panic!("no version flag for {other}"),
        };

        let mut index = 0;
        while index < args.len() {
            let raw = &args[index];
            let Some(word) = raw.to_str() else {
                options.words.push(raw.clone());
                index += 1;
                continue;
            };

            if word == "--" {
                options.passthrough_count = args.len() - index - 1;
                options.words.extend(args[index + 1..].iter().cloned());
                break;
            }
            if word == "-" || !word.starts_with('-') {
                options.words.push(raw.clone());
                index += 1;
                continue;
            }

            match word {
                "--name" => options.name = Some(take(args, &mut index, word)?),
                "--image" => options.image = Some(take(args, &mut index, word)?),
                "--policy" => options.policy = Some(take(args, &mut index, word)?),
                "--cpu" => options.cpu = Some(take(args, &mut index, word)?),
                "--memory" => options.memory = Some(take(args, &mut index, word)?),
                "--engine" => options.engine = Some(take(args, &mut index, word)?),
                "--gateway" => options.gateway = Some(take(args, &mut index, word)?),
                "--tls-dir" => options.tls_dir = Some(take(args, &mut index, word)?),
                "--workdir" => options.workdir = Some(take(args, &mut index, word)?),
                "--provider" => options.providers.push(take(args, &mut index, word)?),
                "--env" => options.envs.push(take(args, &mut index, word)?),
                "--env-from" => options.env_froms.push(take(args, &mut index, word)?),
                "--allow-env" => options.allow_env.push(take(args, &mut index, word)?),
                "--credential" => options.credentials.push(take(args, &mut index, word)?),
                "--config" => options.configs.push(take(args, &mut index, word)?),
                "--type" => options.type_ = Some(take(args, &mut index, word)?),
                "--from" => options.from = Some(take(args, &mut index, word)?),
                "--file" => options.file = Some(take(args, &mut index, word)?),
                "--field" => options.field = Some(take(args, &mut index, word)?),
                "--profile" => options.profile = Some(take(args, &mut index, word)?),
                "--provider-name" => options.provider_name = Some(take(args, &mut index, word)?),
                "--stdin" => options.stdin = true,
                "--probe" => options.probe = true,
                "--model" => options.model = Some(take(args, &mut index, word)?),
                "-c" | "--continue" => options.continue_session = true,
                "-r" | "--resume" => {
                    let value = take(args, &mut index, word)?;
                    if value.is_empty() {
                        return Err(format!("option {word} requires a non-empty value"));
                    }
                    options.resume = Some(value);
                }
                "--timeout" => options.timeout = Some(take(args, &mut index, word)?),
                "--idle-stop" => options.idle_stop = Some(take(args, &mut index, word)?),
                "--session-id" => {
                    let value = take(args, &mut index, word)?;
                    if value.is_empty() {
                        return Err("option --session-id requires a non-empty value".to_string());
                    }
                    options.session_id = Some(value);
                }
                "--since" => options.since = Some(take(args, &mut index, word)?),
                "--source" => options.source = Some(take(args, &mut index, word)?),
                "--level" => options.level = Some(take(args, &mut index, word)?),
                "-n" | "--lines" => options.lines = Some(take(args, &mut index, word)?),
                "--out" => {
                    let value = take(args, &mut index, word)?;
                    if value.is_empty() {
                        return Err("option --out requires a non-empty value".to_string());
                    }
                    options.out = Some(value);
                }
                "--yes" => options.yes = true,
                "--reason" => options.reason = Some(take(args, &mut index, word)?),
                "--full" => options.full = true,
                "--base" => {
                    if sync_in {
                        let value = take(args, &mut index, word)?;
                        if value.is_empty() {
                            return Err("option --base requires a non-empty value".to_string());
                        }
                        options.base_ref = Some(value);
                    } else {
                        options.base = true;
                    }
                }
                "--global" => options.global = true,
                "--wait" => options.wait = true,
                "--tail" => options.tail = true,
                "--from-existing" => options.from_existing = true,
                "--runtime-credentials" => options.runtime_credentials = true,
                "--global-profile" => options.global_profile = true,
                "--attach" => options.attach = Some(true),
                "--no-attach" => options.attach = Some(false),
                "--no-git-ignore" => options.no_git_ignore = true,
                "--no-sync" => options.no_sync = true,
                "--incremental" => options.incremental = true,
                "--discard" => options.discard = true,
                "--orphan" => options.orphan = true,
                "--json" => options.json = true,
                "-h" | "--help" => options.help = true,
                _ if word == version_flag => options.version = Some(take(args, &mut index, word)?),
                "--device-auth" if profile.name == "codex-oss" => options.device_auth = true,
                _ => return Err(format!("unknown option: {word}")),
            }
            index += 1;
        }

        Ok(options)
    }
}

fn take(args: &[OsString], index: &mut usize, name: &str) -> Result<String, String> {
    *index += 1;
    match args.get(*index) {
        Some(value) => Ok(value.to_string_lossy().into_owned()),
        None => Err(format!("option {name} requires a value")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::profile::{CLAUDE, CODEX, MAKI, OPENCODE};

    fn parse(profile: &AgentProfile, words: &[&str]) -> Result<Options, String> {
        let args: Vec<OsString> = words.iter().map(OsString::from).collect();
        Options::parse(profile, &args)
    }

    #[test]
    fn precedence_sources_are_all_visible() {
        let options = parse(
            &MAKI,
            &[
                "--name",
                "flag",
                "up",
                "--image",
                "img",
                "--provider",
                "a",
                "--provider",
                "b",
            ],
        )
        .unwrap();
        assert_eq!(options.name.as_deref(), Some("flag"));
        assert_eq!(options.image.as_deref(), Some("img"));
        assert_eq!(options.providers, ["a", "b"]);
        assert_eq!(options.words, [OsString::from("up")]);
    }

    #[test]
    fn trailing_value_flags_are_usage_errors() {
        for words in [
            &["maki", "--resume"][..],
            &["maki", "-r"][..],
            &["maki", "--session-id"][..],
            &["run", "--timeout"][..],
            &["run", "--idle-stop"][..],
            &["collect-patch", "--out"][..],
        ] {
            assert!(parse(&MAKI, words).is_err(), "{words:?}");
        }
        assert!(parse(&MAKI, &["sync-in", ".", "--base"]).is_err());
    }

    #[test]
    fn empty_resume_and_session_ids_are_refused() {
        assert_eq!(
            parse(&MAKI, &["maki", "--resume", ""]).unwrap_err(),
            "option --resume requires a non-empty value"
        );
        assert_eq!(
            parse(&MAKI, &["run", "--session-id", ""]).unwrap_err(),
            "option --session-id requires a non-empty value"
        );
    }

    #[test]
    fn unknown_options_are_refused() {
        assert_eq!(
            parse(&MAKI, &["up", "--definitely-not-an-option"]).unwrap_err(),
            "unknown option: --definitely-not-an-option"
        );
        assert!(parse(&MAKI, &["--opencode-version", "1"]).is_err());
        assert!(parse(&OPENCODE, &["--maki-version", "1"]).is_err());
        assert!(parse(&CLAUDE, &["--maki-version", "1"]).is_err());
        assert!(parse(&MAKI, &["--device-auth"]).is_err());
        assert!(parse(&CODEX, &["--device-auth"]).is_ok());
    }

    #[test]
    fn passthrough_words_keep_their_order() {
        let options = parse(&MAKI, &["run", "prompt", "--", "--fork-session"]).unwrap();
        assert_eq!(options.passthrough_count, 1);
        assert_eq!(
            options.words,
            [
                OsString::from("run"),
                OsString::from("prompt"),
                OsString::from("--fork-session")
            ]
        );
    }

    #[test]
    fn front_end_command_sets_differ() {
        assert!(known_command(&MAKI, "maki"));
        assert!(!known_command(&OPENCODE, "maki"));
        assert!(!known_command(&CLAUDE, "opencode"));
        assert!(!known_command(&CODEX, "claude"));
        assert!(known_command(&CODEX, "codex"));
        assert!(known_command(&CLAUDE, "image"));
    }
}
