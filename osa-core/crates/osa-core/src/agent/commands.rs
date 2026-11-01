//! The commands ported so far: ensure (`up`), status, lifecycle, and `rm`.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::entries::RegistryEntry;
use crate::flat;

use super::baseline::{self, PendingInfo, SyncInputs};
use super::context::{Context, WorkspaceMode, DEFAULT_WORKDIR};
use super::failure::{Failure, Outcome};

use super::scripts;

pub fn up(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    let image = ctx.image();
    let policy = ctx.policy();
    if !Path::new(&policy).is_file() {
        return Err(Failure::dep(format!(
            "policy file not found: {policy} (pass --policy or fix the config)"
        )));
    }
    ctx.check_env_hygiene()?;
    let mode = ctx.workspace_mode()?;
    if mode == WorkspaceMode::Caller {
        ctx.require_caller_target(false)?;
    }
    let name = ctx.sandbox_name()?;
    if mode == WorkspaceMode::Managed {
        ctx.registry_guard(&name)?;
    }
    match ctx.sandbox_phase(&name)? {
        Some(phase) => {
            if matches!(phase.as_str(), "Ready" | "Starting" | "Provisioning") {
                ctx.say(&format!(
                    "Sandbox '{name}' already exists (phase: {phase})."
                ));
            } else {
                ctx.say(&format!("Starting sandbox '{name}' (phase: {phase})..."));
                ctx.run_gateway(&["sandbox", "start", &name])?;
            }
        }
        None => {
            ctx.say(&format!("Creating sandbox '{name}' from {image}..."));
            create_sandbox(ctx, &name)?;
        }
    }
    if mode == WorkspaceMode::Caller {
        ctx.say(&format!("Sandbox '{name}' is ready."));
        return Ok(());
    }
    ctx.registry_update(&name, ctx.sandbox_id(&name).as_deref(), false, false);
    ctx.say(&format!(
        "Sandbox '{name}' is ready. Next: {} (the session refreshes the workspace).",
        ctx.program()
    ));
    Ok(())
}

fn create_sandbox(ctx: &Context, name: &str) -> Outcome {
    ctx.check_env_hygiene()?;
    let image = ctx.image();
    let policy = ctx.policy();
    let providers = ctx.providers();
    let cpu = ctx.cpu();
    let memory = ctx.memory();

    let mut args: Vec<String> = vec![
        "sandbox".into(),
        "create".into(),
        "--name".into(),
        name.into(),
        "--from".into(),
        image,
        "--policy".into(),
        policy,
        "--detach".into(),
    ];
    if !cpu.is_empty() {
        args.push("--cpu".into());
        args.push(cpu);
    }
    if !memory.is_empty() {
        args.push("--memory".into());
        args.push(memory);
    }
    for provider in providers.iter().filter(|provider| !provider.is_empty()) {
        args.push("--provider".into());
        args.push(provider.clone());
    }
    for pair in ctx.options.envs.iter().filter(|pair| !pair.is_empty()) {
        args.push("--env".into());
        args.push(pair.clone());
    }
    for pair in ctx.options.env_froms.iter().filter(|pair| !pair.is_empty()) {
        args.push("--env-from".into());
        args.push(pair.clone());
    }
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    ctx.run_gateway(&words)
}

pub fn status(ctx: &Context) -> Outcome {
    status_report(ctx, false)
}

/// `osa status --json`: the same classification as `status`, as one line.
pub fn status_json(ctx: &Context) -> Outcome {
    status_report(ctx, true)
}

fn status_report(ctx: &Context, json: bool) -> Outcome {
    let say = |line: &str| {
        if !json {
            ctx.say(line);
        }
    };
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    let Some(phase) = ctx.sandbox_phase(&name)? else {
        if json {
            println!("{{\"sandbox\":{},\"exists\":false}}", json_str(&name));
            return Ok(());
        }
        say(&format!("Sandbox:   {name}"));
        say("Exists:    no");
        return Err(Failure::silent(super::cli::EX_USAGE));
    };
    let image = ctx.image();
    let providers = ctx.attached_providers(&name)?.join(",");
    let workdir = ctx.workdir();
    let state_dir = ctx.session_state_dir(&name);

    say(&format!("Sandbox:   {name}"));
    say("Exists:    yes");
    say(&format!("Phase:     {phase}"));
    say(&format!("Image:     {image} (configured)"));
    say(&format!(
        "Providers: {}",
        if providers.is_empty() {
            "none"
        } else {
            &providers
        }
    ));

    let temp =
        std::env::temp_dir().join(format!("{}-status.{}", ctx.program(), std::process::id()));
    let _ = fs::remove_dir_all(&temp);
    let _ = fs::create_dir_all(&temp);
    let host = baseline::capture_host_baseline(&temp, ctx.program());

    let synced = baseline::read_kv(&state_dir.join("synced"));
    let mut synced_host_tree = synced.get("host_tree").cloned().unwrap_or_default();
    let mut synced_sandbox_tree = synced.get("sandbox_tree").cloned().unwrap_or_default();
    let synced_id = synced.get("sandbox_id").cloned().unwrap_or_default();
    let pending = baseline::pending_info(&state_dir);
    let sandbox_id = ctx.sandbox_id(&name).unwrap_or_default();
    if !sandbox_id.is_empty() && !synced_id.is_empty() && sandbox_id != synced_id {
        synced_host_tree.clear();
        synced_sandbox_tree.clear();
    }

    let mut probe_ok = false;
    let mut sandbox_tree = String::new();
    let mut sandbox_empty = false;
    if phase == "Ready" {
        match ctx.sandbox_script(&name, &workdir, &scripts::probe(ctx.program()), None) {
            Some(value) if value == "missing" => {
                if ctx
                    .sandbox_script(&name, &workdir, scripts::WORKDIR_NONEMPTY, None)
                    .as_deref()
                    == Some("empty")
                {
                    probe_ok = true;
                    sandbox_empty = true;
                }
            }
            Some(value) if !value.is_empty() => {
                probe_ok = true;
                sandbox_tree = value;
            }
            _ => {}
        }
    }
    if probe_ok
        && host.ok
        && synced_sandbox_tree.is_empty()
        && !sandbox_tree.is_empty()
        && sandbox_tree != host.tree
        && ctx
            .sandbox_script(&name, &workdir, scripts::TREE_EMPTY, Some(&sandbox_tree))
            .as_deref()
            == Some("empty")
    {
        sandbox_empty = true;
    }

    let state = if probe_ok {
        baseline::classify(&SyncInputs {
            bl_ok: host.ok,
            bl_tree: host.tree.clone(),
            synced_host_tree: synced_host_tree.clone(),
            synced_sandbox_tree: synced_sandbox_tree.clone(),
            pending_kind: pending.kind.clone(),
            pending_result_tree: pending.result_tree.clone(),
            probe_ok,
            sandbox_tree: sandbox_tree.clone(),
            sandbox_empty,
            created: false,
        })
        .state
        .to_string()
    } else {
        let recorded = baseline::read_kv(&state_dir.join("baseline"))
            .get("state")
            .cloned()
            .unwrap_or_default();
        match recorded.as_str() {
            "clean" | "behind" | "retained" | "parked" => recorded,
            _ => {
                if pending.kind == "parked" {
                    "parked".to_string()
                } else if pending.kind == "retained" {
                    "retained".to_string()
                } else {
                    "behind".to_string()
                }
            }
        }
    };
    let state = if pending.kind == "parked" {
        "parked".to_string()
    } else {
        state
    };

    say(&format!("Sync:      {state}"));
    let program = ctx.program();
    let (next, patch) = match state.as_str() {
        "parked" => {
            let next = format!("{program} download {workdir} ./DEST");
            say(&format!("Next:      {next}"));
            say(&format!(
                "Discard:   {program} upload --discard (or {program} rm --discard)"
            ));
            (next, pending.patch.clone())
        }
        "retained" => {
            let next = format!("{program} (refreshes before the next session)");
            say(&format!("Next:      {next}"));
            (next, pending.patch.clone())
        }
        "behind" => {
            let next = format!("{program} (refreshes the workspace)");
            say(&format!("Next:      {next}"));
            (next, String::new())
        }
        _ => {
            let next = program.to_string();
            say(&format!("Next:      {next}"));
            (next, String::new())
        }
    };
    if !patch.is_empty() && !json {
        say(&format!("Patch:     {patch}"));
    }
    let _ = fs::remove_dir_all(&temp);
    if json {
        println!(
            "{{\"sandbox\":{},\"exists\":true,\"phase\":{},\"image\":{},\"providers\":{},\"sync\":{},\"patch\":{},\"next\":{}}}",
            json_str(&name),
            json_str(&phase),
            json_str(&image),
            json_str(&providers),
            json_str(&state),
            json_str(&patch),
            json_str(&next)
        );
    }
    Ok(())
}

pub(crate) fn json_str(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for character in value.chars().filter(|character| *character != '\r') {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\t' => escaped.push_str("\\t"),
            '\n' => escaped.push_str("\\n"),
            other => escaped.push(other),
        }
    }
    escaped.push('"');
    escaped
}

/// `list`: the gateway's sandboxes, rendered here from the typed listing.
///
/// The OpenShell CLI still resolves the endpoint — discovery asks it once — but
/// nothing about the output is delegated to it any more.
pub fn list(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    let client = ctx.client()?;
    let sandboxes = crate::gateway::block_on(client.list_sandboxes())
        .map_err(|error| Failure::new(error.code(), error.message()))?;
    for line in listing(&sandboxes) {
        ctx.say(&line);
    }
    Ok(())
}

pub fn logs(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    let mut args: Vec<String> = vec!["logs".into(), name];
    if ctx.options.tail {
        args.push("--tail".into());
    }
    if let Some(value) = ctx.options.since.as_ref().filter(|value| !value.is_empty()) {
        args.push("--since".into());
        args.push(value.clone());
    }
    if let Some(value) = ctx
        .options
        .source
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        args.push("--source".into());
        args.push(value.clone());
    }
    if let Some(value) = ctx.options.level.as_ref().filter(|value| !value.is_empty()) {
        args.push("--level".into());
        args.push(value.clone());
    }
    if let Some(value) = ctx.options.lines.as_ref().filter(|value| !value.is_empty()) {
        args.push("-n".into());
        args.push(value.clone());
    }
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    ctx.run_gateway(&words)
}

pub fn start(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    ctx.run_gateway(&["sandbox", "start", &name])?;
    ctx.say(&format!("Sandbox '{name}' started."));
    Ok(())
}

pub fn stop(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    ctx.run_gateway(&["sandbox", "stop", &name])?;
    ctx.say(&format!("Sandbox '{name}' stopped."));
    Ok(())
}

pub fn rm(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    if ctx.sandbox_phase(&name)?.is_none() {
        return Err(Failure::new(
            super::cli::EX_USAGE,
            format!("sandbox '{name}' not found"),
        ));
    }
    let state_dir = ctx.session_state_dir(&name);
    let pending = baseline::pending_info(&state_dir);
    if pending.kind == "parked" && !ctx.options.discard {
        return Err(Failure::with_lines(
            super::cli::EX_USAGE,
            vec![
                "the workspace is parked; download its changes or pass --discard to delete them"
                    .to_string(),
                format!(
                    "  download: {} download {} ./DEST",
                    ctx.program(),
                    ctx.workdir()
                ),
                format!("  discard:  {} rm --yes --discard", ctx.program()),
            ],
            false,
        ));
    }
    if !ctx.options.yes {
        if unsafe { libc::isatty(libc::STDIN_FILENO) == 1 } {
            print!("Delete sandbox '{name}'? [y/N] ");
            let _ = io::stdout().flush();
            let mut answer = String::new();
            let _ = io::stdin().read_line(&mut answer);
            match answer.trim() {
                "y" | "Y" | "yes" | "YES" => {}
                _ => {
                    ctx.say("Aborted.");
                    return Err(Failure::silent(super::cli::EX_USAGE));
                }
            }
        } else {
            return Err(Failure::new(
                super::cli::EX_USAGE,
                format!("refusing to delete sandbox '{name}': stdin is not a terminal; pass --yes"),
            ));
        }
    }
    ctx.say(&format!("Deleting sandbox '{name}'..."));
    ctx.run_gateway(&["sandbox", "delete", &name])?;
    if state_dir.is_dir() {
        archive_state_dir(ctx, &state_dir, "sandbox deleted");
    }
    ctx.registry_remove(&name);
    Ok(())
}

pub(crate) fn archive_state_dir(
    ctx: &Context,
    dir: &Path,
    reason: &str,
) -> Option<std::path::PathBuf> {
    let stamp = format!(
        "{}-{}",
        crate::state::utc_iso(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0)
        )
        .unwrap_or_default()
        .replace(['-', ':'], ""),
        std::process::id()
    );
    let destination = dir.with_file_name(format!(
        "{}.archive-{stamp}",
        dir.file_name().unwrap_or_default().to_string_lossy()
    ));
    if fs::rename(dir, &destination).is_err() {
        ctx.warn(&format!(
            "cannot archive the previous sandbox state at {} ({reason})",
            dir.display()
        ));
        return None;
    }
    if fs::create_dir_all(dir).is_err() {
        ctx.warn(&format!(
            "archived the previous state to {} but cannot recreate {}",
            destination.display(),
            dir.display()
        ));
        return None;
    }
    let _ = fs::set_permissions(dir, std::os::unix::fs::PermissionsExt::from_mode(0o700));
    let locks = destination.join("locks");
    if locks.is_dir() {
        let _ = fs::rename(&locks, dir.join("locks"));
    }
    ctx.note(&format!(
        "Archived the previous sandbox state to {} ({reason}).",
        destination.display()
    ));
    Some(destination)
}

/// The bare session's preconditions, which run before any sandbox mutation.
pub fn session_preconditions(ctx: &Context) -> Outcome {
    let mut providers = ctx.providers();
    if providers.is_empty() && ctx.is_interactive() {
        ctx.say("No provider is configured yet; starting provider setup.");
        super::provider_setup::interactive(ctx)?;
        providers = ctx.providers();
    }
    if providers.is_empty() {
        return Err(Failure::with_lines(
            super::cli::EX_USAGE,
            vec![format!(
                "no provider is configured; run '{} provider setup' first",
                ctx.program()
            )],
            false,
        ));
    }
    let known = ctx.gateway_provider_names()?;
    for provider in &providers {
        if !known.contains(provider) {
            return Err(Failure::with_lines(
                super::cli::EX_USAGE,
                vec![format!(
                    "provider '{provider}' is not known to the gateway; run '{} provider setup'",
                    ctx.program()
                )],
                false,
            ));
        }
    }
    Ok(())
}

/// Reads the registry entry for a sandbox, exposed for the session slices.
#[allow(dead_code)]
pub fn registry_entry(path: &Path) -> Option<RegistryEntry> {
    flat::read_entry(path)
        .ok()
        .map(|parsed| RegistryEntry::from_flat(&parsed.entry))
}

#[allow(dead_code)]
pub fn pending(state_dir: &Path) -> PendingInfo {
    baseline::pending_info(state_dir)
}

#[allow(dead_code)]
pub const FALLBACK_WORKDIR: &str = DEFAULT_WORKDIR;

/// `image build`: builds this front-end's base image and tags it with the
/// profile's base tag. The configured `image` is deliberately ignored: it may
/// name a derived environment, and tagging the base with it would overwrite
/// that environment.
pub fn image_build(ctx: &Context, args: &[OsString]) -> Outcome {
    if !args.is_empty() {
        return Err(Failure::usage("image build takes no arguments"));
    }
    let context = if ctx.profile.name == "maki-oss" {
        ctx.repo_root.join("examples").join("maki-image")
    } else {
        ctx.repo_root.join(ctx.profile.name).join("image")
    };
    if !context.is_dir() {
        return Err(Failure::dep(format!(
            "missing {}; keep the repository layout or build your image elsewhere",
            context.display()
        )));
    }
    let engine = ctx.engine();
    if !crate::state::command_in_path(&engine) {
        return Err(Failure::dep(format!(
            "container engine '{engine}' not found on PATH"
        )));
    }
    let image = ctx.profile.base_image.to_string();
    let mut version = ctx
        .options
        .version
        .clone()
        .filter(|value| !value.is_empty());
    if version.is_none() && ctx.profile.name == "maki-oss" {
        version = std::env::var("MAKI_VERSION")
            .ok()
            .filter(|value| !value.is_empty());
    }
    let mut argv: Vec<String> = vec!["build".into()];
    if let Some(version) = &version {
        argv.push("--build-arg".into());
        argv.push(format!("{}={version}", version_key(ctx)));
    }
    argv.push("-t".into());
    argv.push(image.clone());
    argv.push(context.to_string_lossy().into_owned());

    ctx.say(&format!("Building image '{image}' with {engine}..."));
    let code = run_forwarding_signals(&engine, &argv)?;
    if code != 0 {
        if version.is_some() {
            for line in version_hint(ctx) {
                ctx.err_line(line);
            }
        }
        return Err(Failure::dep(format!(
            "image build failed (exit status {code})"
        )));
    }
    ctx.say(&format!("Built image '{image}'."));
    Ok(())
}

fn version_key(ctx: &Context) -> &'static str {
    match ctx.profile.name {
        "maki-oss" => "MAKI_VERSION",
        "opencode-oss" => "OPENCODE_VERSION",
        "claude-oss" => "CLAUDE_VERSION",
        _ => "CODEX_VERSION",
    }
}

fn version_hint(ctx: &Context) -> &'static [&'static str] {
    match ctx.profile.name {
        "opencode-oss" => &[
            "the Dockerfile verifies a pinned sha512 per architecture; a new",
            "  OPENCODE_VERSION needs matching OPENCODE_SHA512_ARM64/AMD64 values",
            "  (see 'Build the image' in opencode-oss/README.md)",
        ],
        "claude-oss" => &[
            "the Dockerfile verifies a pinned sha256 per architecture; a new",
            "  CLAUDE_VERSION needs matching CLAUDE_SHA256_ARM64/AMD64 values",
            "  (see 'Build the image' in claude-oss/README.md)",
        ],
        "codex-oss" => &[
            "the Dockerfile verifies a pinned sha256 per architecture for both",
            "  codex and codex-code-mode-host; a new CODEX_VERSION needs matching",
            "  CODEX_SHA256_ARM64/AMD64 and CODEX_HOST_SHA256_ARM64/AMD64 values",
            "  (see 'Build the image' in codex-oss/README.md)",
        ],
        _ => &[],
    }
}

static FORWARD_PID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

extern "C" fn forward_signal(signal: libc::c_int) {
    let pid = FORWARD_PID.load(std::sync::atomic::Ordering::Relaxed);
    if pid > 0 {
        unsafe {
            libc::kill(pid, signal);
        }
    }
}

/// Runs a child with inherited streams, forwarding INT and TERM so a build
/// stops instead of leaving the engine behind.
fn run_forwarding_signals(program: &str, args: &[String]) -> Result<i32, Failure> {
    let mut child = std::process::Command::new(program)
        .args(args)
        .spawn()
        .map_err(|error| Failure::dep(format!("cannot run {program}: {error}")))?;
    FORWARD_PID.store(child.id() as i32, std::sync::atomic::Ordering::Relaxed);
    unsafe {
        libc::signal(
            libc::SIGINT,
            forward_signal as *const () as libc::sighandler_t,
        );
        libc::signal(
            libc::SIGTERM,
            forward_signal as *const () as libc::sighandler_t,
        );
    }
    let status = child.wait();
    FORWARD_PID.store(0, std::sync::atomic::Ordering::Relaxed);
    unsafe {
        libc::signal(libc::SIGINT, libc::SIG_DFL);
        libc::signal(libc::SIGTERM, libc::SIG_DFL);
    }
    let status = status.map_err(|error| Failure::dep(format!("cannot run {program}: {error}")))?;
    Ok(crate::process::exit_code(status))
}

/// Remembers a provider in the config's `providers` list, keeping order and
/// never duplicating an entry.
pub fn remember_provider(ctx: &Context, name: &str) -> Result<PathBuf, Failure> {
    let current = ctx.config.get("providers").unwrap_or("").to_string();
    let entries: Vec<&str> = current
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    if entries.contains(&name) {
        return Ok(ctx.profile.config_path());
    }
    let list = if entries.is_empty() {
        name.to_string()
    } else {
        format!("{current},{name}")
    };
    crate::agent::config::set_value(ctx.profile, "providers", &list)
        .map_err(|error| Failure::dep(format!("cannot write the config file: {error}")))
}

pub fn provider_add(ctx: &Context, args: &[OsString]) -> Outcome {
    let Some(provider) = args.first().and_then(|word| word.to_str()) else {
        return Err(Failure::usage(format!(
            "usage: {} provider add NAME --type TYPE [--from-existing]",
            ctx.program()
        )));
    };
    if args.len() > 1 {
        return Err(Failure::usage(format!(
            "usage: {} provider add NAME --type TYPE [--from-existing]",
            ctx.program()
        )));
    }
    let Some(type_) = ctx.options.type_.as_ref().filter(|value| !value.is_empty()) else {
        return Err(Failure::usage(
            "provider add requires --type (a provider profile id)",
        ));
    };
    for credential in &ctx.options.credentials {
        if credential.contains('=') {
            return Err(Failure::usage(
                "--credential takes the KEY name only; inline KEY=VALUE is not accepted (use --from-existing)",
            ));
        }
    }
    let mut argv: Vec<String> = vec![
        "provider".into(),
        "create".into(),
        "--name".into(),
        provider.into(),
        "--type".into(),
        type_.clone(),
    ];
    if ctx.options.from_existing {
        argv.push("--from-existing".into());
    }
    if ctx.options.runtime_credentials {
        argv.push("--runtime-credentials".into());
    }
    if ctx.options.global_profile {
        argv.push("--global-profile".into());
    }
    for credential in &ctx.options.credentials {
        if !credential.is_empty() {
            argv.push("--credential".into());
            argv.push(credential.clone());
        }
    }
    for pair in &ctx.options.configs {
        if !pair.is_empty() {
            argv.push("--config".into());
            argv.push(pair.clone());
        }
    }
    let words: Vec<&str> = argv.iter().map(String::as_str).collect();
    ctx.run_gateway(&words)?;
    ctx.say(&format!("Provider '{provider}' created."));
    let path = remember_provider(ctx, provider)?;
    ctx.say(&format!(
        "Remembered provider '{provider}' in {}.",
        path.display()
    ));
    Ok(())
}

pub fn provider_attach(ctx: &Context, args: &[OsString]) -> Outcome {
    let Some(provider) = args.first().and_then(|word| word.to_str()) else {
        return Err(Failure::usage(format!(
            "usage: {} provider attach PROVIDER [--wait]",
            ctx.program()
        )));
    };
    if args.len() > 1 {
        return Err(Failure::usage(format!(
            "usage: {} provider attach PROVIDER [--wait]",
            ctx.program()
        )));
    }
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    commands_require_sandbox(ctx, &name)?;
    let mut argv: Vec<String> = vec![
        "sandbox".into(),
        "provider".into(),
        "attach".into(),
        name.clone(),
        provider.into(),
    ];
    if ctx.options.wait {
        argv.push("--wait".into());
    }
    let words: Vec<&str> = argv.iter().map(String::as_str).collect();
    ctx.run_gateway(&words)?;
    ctx.say(&format!("Provider '{provider}' attached to '{name}'."));
    Ok(())
}

pub fn provider_list(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    ctx.run_gateway(&["provider", "list"])
}

fn commands_require_sandbox(ctx: &Context, name: &str) -> Result<(), Failure> {
    if ctx.sandbox_phase(name)?.is_none() {
        return Err(Failure::with_lines(
            super::cli::EX_USAGE,
            vec![format!(
                "sandbox '{name}' not found; run '{} up' first",
                ctx.program()
            )],
            false,
        ));
    }
    Ok(())
}

pub fn policy(ctx: &Context, args: &[OsString]) -> Outcome {
    let Some(sub) = args.first().and_then(|word| word.to_str()) else {
        return Err(Failure::usage(
            "policy requires a subcommand: show, edit, apply, review, approve, reject",
        ));
    };
    let rest = &args[1..];
    match sub {
        "show" => {
            no_args("policy show", rest)?;
            ctx.require_openshell()?;
            if ctx.options.full && ctx.options.base {
                return Err(Failure::usage(
                    "policy show: --full and --base are mutually exclusive",
                ));
            }
            let mut argv: Vec<String> = vec!["policy".into(), "get".into()];
            argv.push(if ctx.options.full {
                "--full".into()
            } else {
                "--base".into()
            });
            if ctx.options.global {
                argv.push("--global".into());
            } else {
                let name = ctx.sandbox_name()?;
                commands_require_sandbox(ctx, &name)?;
                argv.push(name);
            }
            run_argv(ctx, &argv)
        }
        "edit" => {
            no_args("policy edit", rest)?;
            let policy = ctx.policy();
            if !Path::new(&policy).is_file() {
                return Err(Failure::dep(format!("policy file not found: {policy}")));
            }
            let editor = std::env::var("EDITOR").unwrap_or_else(|_| "vi".to_string());
            let mut words = editor.split_whitespace();
            let Some(program) = words.next() else {
                return Err(Failure::dep("policy edit: empty EDITOR"));
            };
            let status = std::process::Command::new(program)
                .args(words)
                .arg(&policy)
                .status()
                .map_err(|error| Failure::dep(format!("cannot run {program}: {error}")))?;
            let code = crate::process::exit_code(status);
            if code == 0 {
                Ok(())
            } else {
                Err(Failure::silent(code))
            }
        }
        "apply" => {
            no_args("policy apply", rest)?;
            ctx.require_openshell()?;
            let policy = ctx.policy();
            if !Path::new(&policy).is_file() {
                return Err(Failure::dep(format!("policy file not found: {policy}")));
            }
            let mut argv: Vec<String> = vec![
                "policy".into(),
                "set".into(),
                "--policy".into(),
                policy.clone(),
            ];
            if ctx.options.global {
                argv.push("--global".into());
                if ctx.options.yes {
                    argv.push("--yes".into());
                }
            } else {
                let name = ctx.sandbox_name()?;
                commands_require_sandbox(ctx, &name)?;
                if ctx.options.wait {
                    argv.push("--wait".into());
                }
                argv.push(name);
            }
            run_argv(ctx, &argv)?;
            ctx.say(&format!("Policy applied from '{policy}'."));
            Ok(())
        }
        "review" => {
            no_args("policy review", rest)?;
            ctx.require_openshell()?;
            let name = ctx.sandbox_name()?;
            commands_require_sandbox(ctx, &name)?;
            run_argv(
                ctx,
                &[
                    "rule".to_string(),
                    "get".to_string(),
                    name,
                    "--status".to_string(),
                    "pending".to_string(),
                ],
            )
        }
        "approve" => {
            if rest.len() != 1 {
                return Err(Failure::usage(format!(
                    "usage: {} policy approve CHUNK_ID [--yes]",
                    ctx.program()
                )));
            }
            let chunk = rest[0].to_string_lossy().into_owned();
            ctx.require_openshell()?;
            let name = ctx.sandbox_name()?;
            commands_require_sandbox(ctx, &name)?;
            if !ctx.options.yes {
                if ctx.is_interactive() {
                    print!("Approve proposal {chunk} on '{name}'? [y/N] ");
                    let _ = std::io::Write::flush(&mut std::io::stdout());
                    let mut answer = String::new();
                    let _ = std::io::BufRead::read_line(&mut std::io::stdin().lock(), &mut answer);
                    if !matches!(answer.trim(), "y" | "Y" | "yes" | "YES") {
                        ctx.say("Aborted.");
                        return Err(Failure::silent(super::cli::EX_USAGE));
                    }
                } else {
                    return Err(Failure::with_lines(
                        super::cli::EX_USAGE,
                        vec![format!(
                            "refusing to approve proposal '{chunk}': stdin is not a terminal; pass --yes"
                        )],
                        false,
                    ));
                }
            }
            run_argv(
                ctx,
                &[
                    "rule".to_string(),
                    "approve".to_string(),
                    name.clone(),
                    "--chunk-id".to_string(),
                    chunk.clone(),
                ],
            )?;
            ctx.say(&format!("Approved proposal '{chunk}' on '{name}'."));
            Ok(())
        }
        "reject" => {
            if rest.len() != 1 {
                return Err(Failure::usage(format!(
                    "usage: {} policy reject CHUNK_ID --reason \"<text>\"",
                    ctx.program()
                )));
            }
            let chunk = rest[0].to_string_lossy().into_owned();
            ctx.require_openshell()?;
            let name = ctx.sandbox_name()?;
            commands_require_sandbox(ctx, &name)?;
            let Some(reason) = ctx
                .options
                .reason
                .as_ref()
                .filter(|value| !value.is_empty())
            else {
                return Err(Failure::usage(
                    "policy reject requires --reason (the agent receives it and can narrow its request)",
                ));
            };
            run_argv(
                ctx,
                &[
                    "rule".to_string(),
                    "reject".to_string(),
                    name.clone(),
                    "--chunk-id".to_string(),
                    chunk.clone(),
                    "--reason".to_string(),
                    reason.clone(),
                ],
            )?;
            ctx.say(&format!("Rejected proposal '{chunk}' on '{name}'."));
            Ok(())
        }
        other => Err(Failure::usage(format!(
            "unknown policy subcommand: {other}"
        ))),
    }
}

fn run_argv(ctx: &Context, argv: &[String]) -> Outcome {
    let words: Vec<&str> = argv.iter().map(String::as_str).collect();
    ctx.run_gateway(&words)
}

fn no_args(command: &str, args: &[OsString]) -> Outcome {
    if args.is_empty() {
        Ok(())
    } else {
        Err(Failure::usage(format!("{command} takes no arguments")))
    }
}

fn fish_home() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into())).join(".config")
        });
    base.join("fish")
}

fn fish_entries(ctx: &Context) -> [String; 3] {
    [
        "functions/__oss_run.fish".to_string(),
        format!("functions/{}.fish", ctx.program()),
        format!("completions/{}.fish", ctx.program()),
    ]
}

fn fish_shared_in_use(ctx: &Context, home: &Path) -> bool {
    let Ok(entries) = fs::read_dir(home.join("functions")) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|ext| ext != "fish") {
            continue;
        }
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        if name.as_deref() == Some("__oss_run.fish")
            || name.as_deref() == Some(&format!("{}.fish", ctx.program()))
        {
            continue;
        }
        if fs::symlink_metadata(&path)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false)
        {
            if let Ok(target) = fs::read_link(&path) {
                if target.starts_with(ctx.repo_root.join("fish").join("functions")) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn fish(ctx: &Context, args: &[OsString]) -> Outcome {
    let Some(sub) = args.first().and_then(|word| word.to_str()) else {
        return Err(Failure::usage(
            "fish requires a subcommand: install, uninstall",
        ));
    };
    if args.len() > 1 {
        return Err(Failure::usage(format!("fish {sub} takes no arguments")));
    }
    let home = fish_home();
    match sub {
        "install" => {
            let mut failed = false;
            let mut changed = false;
            for entry in fish_entries(ctx) {
                let src = ctx.repo_root.join("fish").join(&entry);
                let dest = home.join(&entry);
                if !src.exists() {
                    ctx.err_line(&format!("missing plugin file: {}", src.display()));
                    failed = true;
                    continue;
                }
                let metadata = fs::symlink_metadata(&dest);
                let is_link = metadata
                    .as_ref()
                    .map(|meta| meta.file_type().is_symlink())
                    .unwrap_or(false);
                if is_link {
                    let target = fs::read_link(&dest).unwrap_or_default();
                    if target == src {
                        ctx.say(&format!("already installed: {}", dest.display()));
                    } else if target.starts_with(&ctx.repo_root) {
                        let _ = fs::remove_file(&dest);
                        let _ = std::os::unix::fs::symlink(&src, &dest);
                        ctx.say(&format!("relinked: {}", dest.display()));
                        changed = true;
                    } else {
                        ctx.err_line(&format!(
                            "skipped {}: existing symlink points outside this repository",
                            dest.display()
                        ));
                        failed = true;
                    }
                } else if metadata.is_ok() {
                    ctx.err_line(&format!(
                        "skipped {}: file exists and was not installed by {}",
                        dest.display(),
                        ctx.program()
                    ));
                    failed = true;
                } else {
                    if let Some(parent) = dest.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if std::os::unix::fs::symlink(&src, &dest).is_ok() {
                        ctx.say(&format!("linked: {} -> {}", dest.display(), src.display()));
                        changed = true;
                    } else {
                        ctx.err_line(&format!("cannot create {}", dest.display()));
                        failed = true;
                    }
                }
            }
            if failed {
                return Err(Failure::silent(super::cli::EX_USAGE));
            }
            if changed {
                ctx.say("Fish plugin installed; open a new fish session to use it.");
            } else {
                ctx.say("Fish plugin already installed.");
            }
            Ok(())
        }
        "uninstall" => {
            for entry in fish_entries(ctx) {
                let dest = home.join(&entry);
                let is_link = fs::symlink_metadata(&dest)
                    .map(|meta| meta.file_type().is_symlink())
                    .unwrap_or(false);
                if is_link {
                    let target = fs::read_link(&dest).unwrap_or_default();
                    if target.starts_with(&ctx.repo_root) {
                        if entry == "functions/__oss_run.fish" && fish_shared_in_use(ctx, &home) {
                            ctx.say(&format!(
                                "kept (still used by another front-end): {}",
                                dest.display()
                            ));
                        } else {
                            let _ = fs::remove_file(&dest);
                            ctx.say(&format!("removed: {}", dest.display()));
                        }
                    } else {
                        ctx.say(&format!(
                            "skipped (not installed by {}): {}",
                            ctx.program(),
                            dest.display()
                        ));
                    }
                } else if dest.exists() {
                    ctx.say(&format!(
                        "skipped (not a symlink from this repository): {}",
                        dest.display()
                    ));
                } else {
                    ctx.say(&format!("not installed: {}", dest.display()));
                }
            }
            Ok(())
        }
        other => Err(Failure::usage(format!("unknown fish subcommand: {other}"))),
    }
}

pub fn base_image_tag(ctx: &Context) -> String {
    if let Some(value) = ctx.options.image.as_ref().filter(|value| !value.is_empty()) {
        return value.clone();
    }
    if let Some(value) = ctx.profile.env_setting("IMAGE") {
        return value;
    }
    ctx.profile.base_image.to_string()
}

/// `osa images` / `osa images --json`: the base tag, the configured image,
/// and whether the base exists. Never builds, tags, or removes anything.
pub fn image_report(ctx: &Context, args: &[OsString], text: bool) -> Outcome {
    if !args.is_empty() {
        return Err(Failure::usage(format!(
            "usage: {} __image-json",
            ctx.program()
        )));
    }
    let image = base_image_tag(ctx);
    let engine = ctx.engine();
    let configured = ctx.image();
    let configured = if configured == image {
        String::new()
    } else {
        configured
    };
    let mut present = false;
    let mut id = String::new();
    let mut created = String::new();
    let mut error = String::new();
    if !crate::state::command_in_path(&engine) {
        error = format!("container engine '{engine}' not found on PATH");
    } else {
        let output = std::process::Command::new(&engine)
            .args([
                "image",
                "inspect",
                "--format",
                "{{.Id}}|{{.Created}}",
                &image,
            ])
            .stdin(std::process::Stdio::null())
            .output();
        match output {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout);
                let line = text.lines().next().unwrap_or("");
                present = true;
                let (left, right) = line.split_once('|').unwrap_or((line, ""));
                id = left.to_string();
                created = right.to_string();
            }
            Ok(output) => {
                let combined = format!(
                    "{}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                let lowered = combined.to_ascii_lowercase();
                if lowered.contains("no such image") || lowered.contains("image not known") {
                    present = false;
                } else {
                    let first = combined
                        .lines()
                        .find(|line| !line.trim().is_empty())
                        .unwrap_or("")
                        .to_string();
                    let code = crate::process::exit_code(output.status);
                    error = format!(
                        "image inspect failed (exit status {code}){}",
                        if first.is_empty() {
                            String::new()
                        } else {
                            format!(": {first}")
                        }
                    );
                }
            }
            Err(_) => {
                error = format!("container engine '{engine}' not found on PATH");
            }
        }
    }
    if text {
        let state = if !error.is_empty() {
            format!("error: {error}")
        } else if present {
            format!("present (created {created})")
        } else {
            format!("missing; run 'osa image build {}'", ctx.profile.tag)
        };
        print!(
            "{:<3} {:<24} {:<7} {}",
            ctx.profile.tag, image, engine, state
        );
        if !configured.is_empty() {
            print!("; sessions use {configured}");
        }
        println!();
        return Ok(());
    }
    let error_json = if error.is_empty() {
        "null".to_string()
    } else {
        format!("{{\"message\":{}}}", json_str(&error))
    };
    println!(
        "{{\"agent\":{},\"image\":{},\"engine\":{},\"present\":{},\"id\":{},\"created\":{},\"configured\":{},\"error\":{error_json}}}",
        json_str(ctx.profile.tag),
        json_str(&image),
        json_str(&engine),
        present,
        json_or_null(&id),
        json_or_null(&created),
        json_or_null(&configured),
    );
    Ok(())
}

fn json_or_null(value: &str) -> String {
    if value.is_empty() {
        "null".to_string()
    } else {
        json_str(value)
    }
}

/// The `list` table, byte for byte what `openshell sandbox list` prints for the
/// same state: a name column as wide as the widest name (minimum 4, so the
/// header sets a floor), two spaces, a 19-wide creation time, two spaces, then
/// the phase.
fn listing(sandboxes: &[crate::gateway::Sandbox]) -> Vec<String> {
    if sandboxes.is_empty() {
        return vec!["No sandboxes found.".to_string()];
    }
    let name_width = sandboxes
        .iter()
        .map(|sandbox| sandbox.name.len())
        .max()
        .unwrap_or(0)
        .max(4);
    let mut lines: Vec<String> = Vec::with_capacity(sandboxes.len() + 1);
    lines.push(format!("{:<name_width$}  {:<19}  {}", "NAME", "CREATED", "PHASE"));
    for sandbox in sandboxes {
        lines.push(format!(
            "{:<name_width$}  {:<19}  {}",
            sandbox.name,
            format_epoch_ms(sandbox.created_ms),
            sandbox.phase.as_deref().unwrap_or("Unknown"),
        ));
    }
    lines
}

/// `YYYY-MM-DD HH:MM:SS` in UTC, with the CLI's own fallback for a missing or
/// out-of-range value.
fn format_epoch_ms(millis: i64) -> String {
    use std::time::{Duration, UNIX_EPOCH};
    let Ok(millis) = u64::try_from(millis) else {
        return "-".to_string();
    };
    let Some(time) = UNIX_EPOCH.checked_add(Duration::from_millis(millis)) else {
        return "-".to_string();
    };
    let Ok(duration) = time.duration_since(UNIX_EPOCH) else {
        return "-".to_string();
    };
    let seconds = duration.as_secs();
    let days = i64::try_from(seconds / 86_400).unwrap_or(0);
    let (year, month, day) = super::idle::civil_from_days(days);
    let time_of_day = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}",
        time_of_day / 3_600,
        (time_of_day % 3_600) / 60,
        time_of_day % 60
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::gateway::Sandbox;

    fn sandbox(name: &str, phase: &str, created_ms: i64) -> Sandbox {
        Sandbox {
            name: name.to_string(),
            id: None,
            phase: Some(phase.to_string()),
            created_ms,
        }
    }

    #[test]
    fn the_listing_matches_the_captured_cli_table() {
        let captured = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/sandbox-list.txt"
        ))
        .expect("the captured table");
        let rows = vec![
            sandbox("maki-6df2fd27364e", "Stopped", 1_793_333_313_000),
            sandbox("mk-emptytest-e5bb", "Ready", 1_793_445_549_000),
        ];
        assert_eq!(listing(&rows).join("\n") + "\n", captured);
    }

    #[test]
    fn a_short_name_keeps_the_headers_width() {
        let rows = vec![sandbox("ab", "Ready", 0)];
        assert_eq!(
            listing(&rows),
            vec![
                "NAME  CREATED              PHASE".to_string(),
                "ab    1970-01-01 00:00:00  Ready".to_string(),
            ]
        );
    }

    #[test]
    fn an_empty_listing_matches_the_cli_message() {
        assert_eq!(listing(&[]), vec!["No sandboxes found.".to_string()]);
    }
}
