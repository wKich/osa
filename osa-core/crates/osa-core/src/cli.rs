//! The hand-rolled dispatcher: the usage text, the option grammar, and the
//! usage-error exit code are part of the observable surface, so they are
//! spelled out here rather than owned by an argument-parsing crate.

use std::ffi::OsString;
use std::io::Write;

use crate::commands::{self, Context, Options, AGENT_TAGS, EX_USAGE};

pub const PROGRAM: &str = "osa";
pub const COMMANDS: &str =
    "projects, status, health, providers, images, resolve, remove, provider setup, image build, dashboard, help";

pub fn usage() -> &'static str {
    r#"osa: report on the projects the agent front-ends have registered.

Usage:
  osa <command> [options]

Commands:
  projects [--json]                 List every registered project
  status [PATH] [--json] [--quick]  Report the project at PATH (default: .)
                                    for each agent registered there
  health SANDBOX [--json]           Report the sandbox's idle stop, MCP
                                    readiness, and doctor checks
  providers [--agent TAG] [--json]  List each agent's setup profiles, the
                                    gateway's providers, and the remembered
                                    providers
  images [--json]                   Report each agent's base image tag and
                                    whether it exists locally
  resolve SANDBOX ACTION [--yes] [--json]
                                    Resolve the sandbox's pending work:
                                    apply, branch, or drop --yes for a
                                    retained patch; rescue or discard --yes
                                    for a parked workspace
  remove SANDBOX --yes [--json]     Delete the sandbox on the gateway (when
                                    it is listed) and forget its project;
                                    refused while work is pending
  provider setup TAG --profile ID [--name NAME] [--attach SANDBOX] [--yes] [--json]
                                    Set up a provider for agent TAG from a
                                    credential read on stdin, never prompted
  image build TAG                   Build agent TAG's base image
  dashboard [--port N] [--host ADDR] [--token T] [--read-only] [--open]
                                    Run the web dashboard in the foreground
                                    (needs Bun >= 1.2.0; Ctrl-C stops it)
  help                              Show this help

Agent tags: mk (maki-oss), oc (opencode-oss), cc (claude-oss), cx (codex-oss).

Options:
  --json    Print one JSON array (health, resolve, and provider setup: one
            JSON object) on stdout and nothing else
  --quick   Skip the gateway and the tree hash: report the pending kind,
            whether the host changed since the last sync (changed,
            unchanged, or unknown), whether a session or resolve is
            running (busy), and the idle-stop state and deadline (idle)
  --yes     Confirm drop, discard, or remove; for provider setup, update an
            existing provider's credential

Only resolve, remove, provider setup, and image build change anything, and
only remove deletes a sandbox. Exit codes for resolve, remove, and provider
setup: 0 done, 1 usage error, 2 refused before any
change, 3 failed during the action. image build exits 0 when the image was
built, 1 for a usage error, and the front-end's status otherwise.
dashboard exits 1 for a usage error, 2 when Bun or the dashboard files are
missing, and with the dashboard's status otherwise.
"#
}

pub fn dashboard_usage() -> &'static str {
    r#"Usage: osa dashboard [--port N] [--host ADDR] [--token T] [--read-only] [--open]

Runs <repo>/dashboard/src/main.ts with Bun in the foreground; Ctrl-C stops
it. The flags pass to the dashboard unchanged, which validates them, and the
DASHBOARD_* environment variables still apply, except DASHBOARD_OSA_BIN,
which is always set to this osa.

  --port N     Port to listen on (default: 8787)
  --host ADDR  Address to bind (default: 127.0.0.1); off loopback needs --token
  --token T    Session token for mutating routes
  --read-only  Reject every mutating route and hide the controls
  --open       Open the page in the default browser once listening (loopback)

Exit codes: 1 usage error, 2 Bun or the dashboard missing, otherwise the
dashboard's status.
"#
}

/// Prints the usage error and returns the usage exit code.
pub fn die_usage(message: &str) -> i32 {
    eprintln!("{PROGRAM}: {message}");
    eprintln!("Run '{PROGRAM} help' for usage.");
    EX_USAGE
}

/// A lowercase kebab-case word, the only shape a profile id or provider name
/// may take.
pub fn valid_kebab(word: &str) -> bool {
    !word.is_empty()
        && word
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !word.starts_with('-')
        && !word.ends_with('-')
        && !word.contains("--")
}

pub fn run(args: Vec<OsString>) -> i32 {
    let words: Vec<String> = args
        .iter()
        .skip(1)
        .map(|word| word.to_string_lossy().into_owned())
        .collect();
    let ctx = Context::new();
    if words.is_empty() {
        print!("{}", usage());
        return 0;
    }
    match words[0].as_str() {
        "help" | "-h" | "--help" => {
            print!("{}", usage());
            0
        }
        "projects" | "status" | "health" | "providers" | "images" | "resolve" | "remove" => {
            run_command(&ctx, &words[0], &words[1..])
        }
        "dashboard" => commands::dashboard(&ctx, &words[1..]),
        "provider" | "image" => {
            let command = words[0].as_str();
            let subcommand = words.get(1).map(String::as_str);
            let accepted = matches!(
                (command, subcommand),
                ("provider", Some("setup")) | ("image", Some("build"))
            );
            if !accepted {
                let shown = match subcommand {
                    Some(subcommand) => format!("{command} {subcommand}"),
                    None => command.to_string(),
                };
                return die_usage(&format!("unknown command: {shown} (commands: {COMMANDS})"));
            }
            let subcommand = subcommand.expect("an accepted subcommand");
            let rest = &words[2..];
            if command == "image" {
                return image_build(&ctx, rest);
            }
            run_command(&ctx, &format!("{command}-{subcommand}"), rest)
        }
        other => die_usage(&format!("unknown command: {other} (commands: {COMMANDS})")),
    }
}

fn image_build(ctx: &Context, args: &[String]) -> i32 {
    if args.len() != 1 {
        return die_usage("usage: osa image build TAG (no other argument)");
    }
    let tag = args[0].as_str();
    if !AGENT_TAGS.contains(&tag) {
        return die_usage(&format!("unknown agent tag: {tag} (tags: mk, oc, cc, cx)"));
    }
    commands::image_build(ctx, tag)
}

fn run_command(ctx: &Context, command: &str, words: &[String]) -> i32 {
    let mut options = Options::default();
    let mut index = 0;
    while index < words.len() {
        let word = words[index].as_str();
        match word {
            "--json" => options.json = true,
            "--quick" => {
                if command != "status" {
                    return die_usage("--quick applies to status only");
                }
                options.quick = true;
            }
            "--yes" => {
                if !matches!(command, "resolve" | "remove" | "provider-setup") {
                    return die_usage("--yes applies to resolve, remove, and provider setup only");
                }
                options.yes = true;
            }
            "--agent" => {
                if command != "providers" {
                    return die_usage("--agent applies to providers only");
                }
                match words.get(index + 1) {
                    Some(value) => {
                        options.agent = Some(value.clone());
                        index += 1;
                    }
                    None => return die_usage("option --agent requires a value"),
                }
            }
            "--profile" | "--name" | "--attach" => {
                if command != "provider-setup" {
                    return die_usage(&format!("{word} applies to provider setup only"));
                }
                match words.get(index + 1) {
                    Some(value) => {
                        match word {
                            "--profile" => options.profile = Some(value.clone()),
                            "--name" => options.name = Some(value.clone()),
                            _ => options.attach = Some(value.clone()),
                        }
                        index += 1;
                    }
                    None => {
                        return die_usage(&format!("option {word} requires a value"));
                    }
                }
            }
            other if other.starts_with('-') => {
                return die_usage(&format!("unknown option: {other}"));
            }
            other => match command {
                "health" | "remove" => {
                    if options.sandbox.is_some() {
                        return die_usage(&format!("{command} takes one SANDBOX"));
                    }
                    options.sandbox = Some(other.to_string());
                }
                "resolve" => {
                    if options.sandbox.is_none() {
                        options.sandbox = Some(other.to_string());
                    } else if options.action.is_none() {
                        options.action = Some(other.to_string());
                    } else {
                        return die_usage("resolve takes SANDBOX and ACTION");
                    }
                }
                "provider-setup" => {
                    if options.agent.is_some() {
                        return die_usage("provider setup takes one TAG");
                    }
                    options.agent = Some(other.to_string());
                }
                "status" => {
                    if options.path.is_some() {
                        return die_usage("status takes at most one PATH");
                    }
                    options.path = Some(other.to_string());
                }
                _ => return die_usage(&format!("{command} takes no arguments")),
            },
        }
        index += 1;
    }

    if command == "health" && options.sandbox.is_none() {
        return die_usage("usage: osa health SANDBOX [--json]");
    }
    if command == "remove" {
        if options.sandbox.is_none() {
            return die_usage("usage: osa remove SANDBOX --yes [--json]");
        }
        options.action = Some("remove".to_string());
    }
    if command == "resolve" {
        let Some(action) = options.action.as_deref() else {
            return die_usage("usage: osa resolve SANDBOX ACTION [--yes] [--json]");
        };
        if !matches!(action, "apply" | "branch" | "drop" | "rescue" | "discard") {
            return die_usage(&format!(
                "unknown resolve action: {action} (actions: apply, branch, drop, rescue, discard)"
            ));
        }
    }
    if command == "providers" {
        if let Some(agent) = options.agent.as_deref() {
            if !AGENT_TAGS.contains(&agent) {
                return die_usage(&format!(
                    "unknown agent tag: {agent} (tags: mk, oc, cc, cx)"
                ));
            }
        }
    }
    if command == "provider-setup" {
        let Some(tag) = options.agent.as_deref() else {
            return die_usage(
                "usage: osa provider setup TAG --profile ID [--name NAME] [--attach SANDBOX] [--yes] [--json]",
            );
        };
        if !AGENT_TAGS.contains(&tag) {
            return die_usage(&format!("unknown agent tag: {tag} (tags: mk, oc, cc, cx)"));
        }
        let Some(profile) = options.profile.as_deref() else {
            return die_usage("provider setup needs --profile ID");
        };
        if !valid_kebab(profile) {
            return die_usage(&format!("invalid profile id '{profile}': use kebab-case"));
        }
        if let Some(name) = options.name.as_deref() {
            if !valid_kebab(name) {
                return die_usage(&format!("invalid provider name '{name}': use kebab-case"));
            }
        }
    }

    match command {
        "projects" => commands::projects(ctx, options.json),
        "status" => commands::status(ctx, &options),
        "health" => commands::health(ctx, &options),
        "providers" => commands::providers(ctx, &options),
        "images" => commands::images(ctx, &options),
        "resolve" => commands::resolve(ctx, &options),
        "remove" => commands::remove(ctx, &options),
        "provider-setup" => commands::provider_setup(ctx, &options),
        _ => {
            let _ = std::io::stdout().flush();
            EX_USAGE
        }
    }
}
