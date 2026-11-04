//! Ensure, the session, and the headless run: the idempotent pipeline that
//! prepares a sandbox and collects its changes on exit.

use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::io::FromRawFd;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::entries::PendingMarker;
use crate::flat;
use crate::state::{self, Claim};

use super::agents;
use super::baseline::{self, PendingInfo};
use super::commands::{archive_state_dir, session_preconditions};
use super::context::{Context, WorkspaceMode};
use super::failure::{Failure, Outcome};
use super::idle;
use super::scripts;
use super::signals;

#[derive(Debug, Default)]
pub struct SyncSession {
    pub name: String,
    pub workdir: String,
    pub state_dir: PathBuf,
    pub created: bool,
    pub blocked: bool,
    pub sandbox_id: String,
    pub sandbox_tree: String,
    pub probe_ok: bool,
    pub upload: String,
    pub state: String,
    pub stale: bool,
    pub pending_patch: String,
    pub pending_kind: String,
    pub pending_result_tree: String,
    pub result_tree: String,
    pub host: baseline::HostBaseline,
}

pub fn session(ctx: &Context) -> Outcome {
    let idle = resolved_idle_stop(ctx)?;
    agents::check_session_flags(ctx, agents::Mode::Interactive)?;
    let name = ctx.sandbox_name()?;
    idle::arm(ctx, &name, idle);
    if ctx.profile.name == "maki-oss" && agents::resolved_tui(ctx)? == "opencode" {
        return opencode_tui(ctx);
    }
    ctx.require_openshell()?;
    let _lock = take_session_lock(ctx, &name)?;
    let mut sync = SyncSession {
        name: name.clone(),
        workdir: ctx.workdir(),
        created: false,
        ..SyncSession::default()
    };
    ensure_project_sandbox(ctx, &mut sync)?;
    if sync.blocked {
        return Err(Failure::silent(super::cli::EX_USAGE));
    }
    resume_check(ctx, &name, &ctx.workdir())?;
    let argv = agents::interactive_argv(ctx);
    let env = agents::exec_env(ctx, agents::Mode::Interactive);
    let mut code = exec_sandbox(
        ctx,
        &name,
        &ctx.workdir(),
        true,
        &argv,
        &env,
        StdinMode::Inherit,
    )?;
    if let Some(signal) = signals::taken() {
        if code == 0 {
            code = signals::interrupted_code(signal);
        }
    }
    sync_project_back(ctx, &mut sync);
    announce_pending_proposals(ctx, &name);
    if code == 0 {
        Ok(())
    } else {
        Err(Failure::silent(code))
    }
}

pub fn run(ctx: &Context, words: &[OsString]) -> Outcome {
    let passthrough = if agents::takes_passthrough(ctx) {
        ctx.options.passthrough_count.min(words.len())
    } else {
        0
    };
    let prompt_words = &words[..words.len() - passthrough];
    let passthrough_words = &words[words.len() - passthrough..];

    let mut stdin_prompt = false;
    let mut prompt = String::new();
    if agents::supports_stdin_prompt(ctx)
        && (prompt_words.is_empty()
            || (prompt_words.len() == 1 && prompt_words[0].to_str() == Some("-")))
    {
        stdin_prompt = true;
    } else {
        prompt = prompt_words
            .iter()
            .map(|word| word.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" ");
    }
    if !stdin_prompt && prompt.is_empty() {
        return Err(Failure::usage(format!(
            "usage: {} run \"<prompt>\" [--model provider/model]",
            ctx.program()
        )));
    }
    let timeout = ctx.timeout();
    if !timeout.is_empty() {
        let valid = timeout.bytes().all(|byte| byte.is_ascii_digit()) && !timeout.starts_with('0');
        if !valid {
            return Err(Failure::usage(format!(
                "--timeout must be a positive number of seconds, got '{timeout}'"
            )));
        }
    }
    if let Some(tag) = ctx.profile.env_setting("RUN_TAG") {
        if !tag
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
        {
            return Err(Failure::usage(format!(
                "{}_RUN_TAG may only contain letters, digits, '.', '_', and '-'",
                ctx.profile.env_prefix
            )));
        }
    }
    let permission_flags = agents::passthrough_check(ctx, passthrough_words)?;
    let _idle = resolved_idle_stop(ctx)?;
    if ctx.workspace_mode()? == WorkspaceMode::Caller {
        ctx.require_caller_target(true)?;
    }
    agents::check_session_flags(ctx, agents::Mode::Headless)?;
    let mut prompt_file = None;
    if stdin_prompt {
        let mut text = Vec::new();
        if std::io::stdin().read_to_end(&mut text).is_err() {
            return Err(Failure::usage("could not read the prompt from stdin"));
        }
        if text.is_empty() {
            return Err(Failure::usage(
                "run read an empty prompt from stdin: pass \"<prompt>\" or pipe one in",
            ));
        }
        let dir =
            std::env::temp_dir().join(format!("{}-prompt.{}", ctx.program(), std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        let path = dir.join("prompt");
        fs::write(&path, &text)
            .map_err(|_| Failure::usage("could not read the prompt from stdin"))?;
        prompt_file = Some((dir, path));
    }
    let name = ctx.sandbox_name()?;
    let _lock = take_session_lock(ctx, &name)?;
    idle::arm(ctx, &name, _idle);
    ctx.gateway_stdout_to_stderr.set(true);

    let mut sync = SyncSession {
        name: name.clone(),
        workdir: ctx.workdir(),
        created: false,
        ..SyncSession::default()
    };
    ensure_project_sandbox(ctx, &mut sync)?;
    ctx.gateway_stdout_to_stderr.set(false);
    if sync.blocked {
        return Err(Failure::silent(super::cli::EX_USAGE));
    }
    resume_check(ctx, &name, &ctx.workdir())?;

    let passthrough_args: Vec<String> = passthrough_words
        .iter()
        .map(|word| word.to_string_lossy().into_owned())
        .collect();
    let mut argv = agents::headless_argv(
        ctx,
        &prompt,
        stdin_prompt,
        &passthrough_args,
        permission_flags,
    );

    if !timeout.is_empty() {
        let run_tag = ctx.profile.env_setting("RUN_TAG").unwrap_or_else(|| {
            format!(
                "{}-{}-{}",
                ctx.program(),
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_secs())
                    .unwrap_or(0)
            )
        });
        let mut wrapped: Vec<String> = vec![
            "sh".into(),
            "-c".into(),
            timeout_wrapper(ctx),
            format!("{}-run", ctx.program()),
            run_tag,
            timeout,
        ];
        wrapped.extend(argv.iter().cloned());
        argv = wrapped;
    }
    let mode = if let Some((_, path)) = &prompt_file {
        StdinMode::File(path.clone())
    } else {
        StdinMode::Null
    };
    let env = agents::exec_env(ctx, agents::Mode::Headless);
    let mut code = exec_sandbox(ctx, &name, &ctx.workdir(), false, &argv, &env, mode)?;
    if let Some(signal) = signals::taken() {
        if code == 0 {
            code = signals::interrupted_code(signal);
        }
    }
    if let Some((dir, _)) = &prompt_file {
        let _ = fs::remove_dir_all(dir);
    }
    if ctx.workspace_mode()? == WorkspaceMode::Managed {
        sync_project_back(ctx, &mut sync);
        announce_pending_proposals(ctx, &name);
    }
    if code == 0 {
        Ok(())
    } else {
        Err(Failure::silent(code))
    }
}

pub fn upload(ctx: &Context, args: &[OsString]) -> Outcome {
    upload_with(ctx, args, ctx.options.discard)
}

/// The discard decision can come from the command line or from `__resolve
/// discard`, which performs an upload the user did not type.
pub(crate) fn upload_with(ctx: &Context, args: &[OsString], discard: bool) -> Outcome {
    if args.len() > 2 {
        return Err(Failure::usage(format!(
            "usage: {} upload [--discard] [LOCAL_PATH] [SANDBOX_DEST]",
            ctx.program()
        )));
    }
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    require_sandbox(ctx, &name)?;
    let src = args
        .first()
        .map(|word| word.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string());
    let workdir = ctx.workdir();
    let dest = args
        .get(1)
        .map(|word| word.to_string_lossy().into_owned())
        .unwrap_or_else(|| workdir.clone());
    let full = (src == "." || src == "./") && dest == workdir;
    let state_dir = ctx.session_state_dir(&name);
    if full && fs::create_dir_all(&state_dir).is_ok() {
        let _ = fs::set_permissions(&state_dir, fs::Permissions::from_mode(0o700));
    }
    let pending = baseline::pending_info(&state_dir);
    if pending.kind == "parked" && (!discard || !full) {
        let mut lines = vec![
            "the workspace is parked; download its changes or pass --discard to replace them"
                .to_string(),
            format!("  download: {} download {workdir} ./DEST", ctx.program()),
            format!("  discard:  {} upload --discard", ctx.program()),
        ];
        if !full && discard {
            lines.push(format!(
                "--discard replaces the whole workspace; a copy of '{src}' cannot use it"
            ));
        }
        return Err(Failure::with_lines(super::cli::EX_USAGE, lines, false));
    }
    if full {
        let mut sync = SyncSession {
            name: name.clone(),
            workdir: workdir.clone(),
            state_dir: state_dir.clone(),
            sandbox_id: ctx.sandbox_id(&name).unwrap_or_default(),
            pending_patch: pending.patch.clone(),
            pending_kind: pending.kind.clone(),
            pending_result_tree: pending.result_tree.clone(),
            upload: "filtered".to_string(),
            ..SyncSession::default()
        };
        let host = baseline::capture_host_baseline(&state_dir, ctx.program());
        sync.host = host.clone();
        if !refresh_sandbox_workspace(ctx, &mut sync, &host) {
            return Err(Failure::gateway("openshell command failed"));
        }
        ctx.say(&format!(
            "Refreshed '{name}:{dest}' from the host directory."
        ));
    } else {
        ctx.upload(&name, &src, &dest, ctx.options.no_git_ignore)?;
        ctx.say(&format!(
            "Copied '{src}' to '{name}:{dest}' (no workspace refresh or baseline recorded)."
        ));
    }
    if pending.kind == "parked" && discard {
        let _ = fs::remove_file(state_dir.join("pending"));
        ctx.note("Discarded the parked workspace state.");
    } else if pending.kind == "retained" {
        ctx.note(&format!(
            "A retained patch is still available for review: {}",
            if pending.patch.is_empty() {
                state_dir.join("pending").display().to_string()
            } else {
                pending.patch.clone()
            }
        ));
    }
    Ok(())
}

pub fn download(ctx: &Context, args: &[OsString]) -> Outcome {
    if args.is_empty() || args.len() > 2 {
        return Err(Failure::usage(format!(
            "usage: {} download [SANDBOX_PATH] DEST",
            ctx.program()
        )));
    }
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    require_sandbox(ctx, &name)?;
    let (sandbox_path, dest) = if args.len() == 1 {
        (ctx.workdir(), args[0].to_string_lossy().into_owned())
    } else {
        (
            args[0].to_string_lossy().into_owned(),
            args[1].to_string_lossy().into_owned(),
        )
    };
    ctx.download(&name, &sandbox_path, &dest)?;
    ctx.say(&format!("Downloaded '{name}:{sandbox_path}' to '{dest}'."));
    Ok(())
}

fn require_sandbox(ctx: &Context, name: &str) -> Outcome {
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

fn take_session_lock(ctx: &Context, name: &str) -> Result<Option<state::LockGuard>, Failure> {
    let lock_dir = ctx.session_state_dir(name).join("locks");
    match state::claim_session(&lock_dir, std::process::id()) {
        Ok(Claim::Acquired(guard)) => Ok(Some(guard)),
        Ok(Claim::Busy(holder)) => {
            let pid = match holder {
                state::Holder::Pid(pid) => pid.to_string(),
                state::Holder::Unknown => "unknown".to_string(),
            };
            Err(Failure::with_lines(
                super::cli::EX_USAGE,
                vec![
                    format!(
                        "osa resolve is running for sandbox '{name}' (PID {pid}); start the session when it finishes"
                    ),
                    format!(
                        "  lock: {} (remove it only if no resolve is running)",
                        lock_dir.join("resolve.d").display()
                    ),
                ],
                false,
            ))
        }
        Err(_) => {
            ctx.warn(&format!(
                "cannot create the lock directory {}; osa resolve cannot see this session",
                lock_dir.display()
            ));
            Ok(None)
        }
    }
}

fn ensure_project_sandbox(ctx: &Context, sync: &mut SyncSession) -> Outcome {
    session_preconditions(ctx)?;
    let name = ctx.sandbox_name()?;
    sync.name = name.clone();
    let mode = ctx.workspace_mode()?;
    if mode == WorkspaceMode::Caller {
        return ensure_caller_sandbox(ctx, &name);
    }
    ctx.registry_guard(&name)?;
    let phase = ctx.sandbox_phase(&name)?;
    match phase {
        Some(phase) => {
            ctx.note(&format!(
                "Reusing '{name}'; changes are collected as a patch on exit, and the workspace is checked before Maki runs."
            ));
            match phase.as_str() {
                "Ready" => ctx.note(&format!("Reusing sandbox '{name}'.")),
                "Stopped" | "Completed" | "Error" => {
                    ctx.note(&format!("Starting sandbox '{name}' (phase: {phase})..."));
                    ctx.start_sandbox(&name)?;
                    wait_for_sandbox_ready(ctx, &name)?;
                }
                _ => {
                    ctx.note(&format!("Waiting for sandbox '{name}' (phase: {phase})..."));
                    wait_for_sandbox_ready(ctx, &name)?;
                }
            }
        }
        None => {
            let policy = ctx.policy();
            if !Path::new(&policy).is_file() {
                return Err(Failure::dep(format!(
                    "policy file not found: {policy} (pass --policy or fix the config)"
                )));
            }
            ctx.note(&format!("Creating sandbox '{name}'..."));
            let create_rc = create_sandbox_allow_fail(ctx, &name)?;
            if create_rc != 0 {
                let Some(phase) = ctx.sandbox_phase(&name)? else {
                    return Err(Failure::gateway(format!(
                        "openshell sandbox create failed (exit status {create_rc})"
                    )));
                };
                ctx.note(&format!(
                    "Reusing '{name}'; changes are collected as a patch on exit, and the workspace is checked before Maki runs."
                ));
                ctx.note(&format!(
                    "Sandbox '{name}' was created by a concurrent run (phase: {phase}); reusing it."
                ));
            } else {
                sync.created = true;
            }
            wait_for_sandbox_ready(ctx, &name)?;
        }
    }
    if !ctx.enable_policy_advisor(&name) {
        ctx.warn(&format!(
            "could not enable the policy advisor on '{name}'; agents cannot request network access"
        ));
    }
    ctx.registry_update(&name, None, true, false);
    *sync = prepare_session_sync(ctx, &name, sync.created)?;
    if !sync.sandbox_id.is_empty() {
        ctx.registry_update(&name, Some(&sync.sandbox_id), false, false);
    }
    if sync.blocked {
        return Ok(());
    }
    ensure_attach_missing(ctx, &name)
}

fn ensure_caller_sandbox(ctx: &Context, name: &str) -> Outcome {
    match ctx.sandbox_phase(name)? {
        Some(phase) => match phase.as_str() {
            "Ready" => ctx.note(&format!("Reusing sandbox '{name}'.")),
            "Stopped" | "Completed" | "Error" => {
                ctx.note(&format!("Starting sandbox '{name}' (phase: {phase})..."));
                ctx.start_sandbox(name)?;
                wait_for_sandbox_ready(ctx, name)?;
            }
            _ => {
                ctx.note(&format!("Waiting for sandbox '{name}' (phase: {phase})..."));
                wait_for_sandbox_ready(ctx, name)?;
            }
        },
        None => {
            let policy = ctx.policy();
            if !Path::new(&policy).is_file() {
                return Err(Failure::dep(format!(
                    "policy file not found: {policy} (pass --policy or fix the config)"
                )));
            }
            ctx.note(&format!("Creating sandbox '{name}'..."));
            let create_rc = create_sandbox_allow_fail(ctx, name)?;
            if create_rc != 0 && ctx.sandbox_phase(name)?.is_none() {
                return Err(Failure::gateway(format!(
                    "openshell sandbox create failed (exit status {create_rc})"
                )));
            }
            wait_for_sandbox_ready(ctx, name)?;
        }
    }
    ensure_attach_missing(ctx, name)
}

fn create_sandbox_allow_fail(ctx: &Context, name: &str) -> Result<i32, Failure> {
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
    let mut command = ctx.openshell(&words);
    if ctx.gateway_stdout_to_stderr.get() {
        command.stdout(Stdio::from(unsafe {
            std::fs::File::from_raw_fd(libc::dup(2))
        }));
    }
    Ok(match command.status() {
        Ok(status) if status.success() => 0,
        Ok(status) => crate::process::exit_code(status),
        Err(_) => 1,
    })
}

pub(crate) fn wait_for_sandbox_ready(ctx: &Context, name: &str) -> Outcome {
    ctx.wait_ready(name, std::time::Duration::from_secs(120))
}

fn ensure_attach_missing(ctx: &Context, name: &str) -> Outcome {
    let providers = ctx.providers();
    if providers.is_empty() {
        return Ok(());
    }
    let attached = ctx.attached_providers(name)?;
    for provider in providers.iter().filter(|provider| !provider.is_empty()) {
        if !attached.contains(provider) {
            ctx.note(&format!("Attaching provider '{provider}'..."));
            ctx.attach_provider(name, provider)?;
        }
    }
    Ok(())
}

pub fn prepare_session_sync(
    ctx: &Context,
    name: &str,
    created: bool,
) -> Result<SyncSession, Failure> {
    let workdir = ctx.workdir();
    let state_dir = ctx.session_state_dir(name);
    let mut sync = SyncSession {
        name: name.to_string(),
        workdir: workdir.clone(),
        state_dir: state_dir.clone(),
        created,
        upload: "filtered".to_string(),
        state: "clean".to_string(),
        pending_kind: String::new(),
        ..SyncSession::default()
    };
    if fs::create_dir_all(&state_dir).is_err() {
        ctx.warn(&format!(
            "cannot create session state directory {}; changes will stay in the sandbox",
            state_dir.display()
        ));
        return Ok(sync);
    }
    let _ = fs::set_permissions(&state_dir, fs::Permissions::from_mode(0o700));
    if created
        && ["pending", "synced", "baseline"]
            .iter()
            .any(|file| state_dir.join(file).exists())
    {
        archive_state_dir(ctx, &state_dir, "new sandbox instance");
    }
    sync.sandbox_id = ctx.sandbox_id(name).unwrap_or_default();
    let synced = baseline::read_kv(&state_dir.join("synced"));
    let mut synced_host_tree = synced.get("host_tree").cloned().unwrap_or_default();
    let mut synced_sandbox_tree = synced.get("sandbox_tree").cloned().unwrap_or_default();
    let mut synced_id = synced.get("sandbox_id").cloned().unwrap_or_default();
    if synced_id.is_empty() {
        synced_id = baseline::read_kv(&state_dir.join("baseline"))
            .get("sandbox_id")
            .cloned()
            .unwrap_or_default();
    }
    if !sync.sandbox_id.is_empty() && !synced_id.is_empty() && sync.sandbox_id != synced_id {
        archive_state_dir(ctx, &state_dir, "sandbox id changed");
        synced_host_tree.clear();
        synced_sandbox_tree.clear();
        synced_id.clear();
    }
    let mut pending = baseline::pending_info(&state_dir);
    if !pending.exists {
        pending = PendingInfo::default();
    }
    sync.pending_kind = pending.kind.clone();
    sync.pending_patch = pending.patch.clone();
    sync.pending_result_tree = pending.result_tree.clone();
    if pending.exists {
        let marker = flat::read_entry(&state_dir.join("pending"))
            .ok()
            .map(|parsed| crate::entries::PendingMarker::from_flat(&parsed.entry));
        if let Some(marker) = marker {
            if !marker.sandbox_id.is_empty()
                && !sync.sandbox_id.is_empty()
                && marker.sandbox_id != sync.sandbox_id
            {
                ctx.note("Ignoring a pending marker from a previous sandbox instance.");
                let _ = fs::remove_file(state_dir.join("pending"));
                sync.pending_kind.clear();
                sync.pending_patch.clear();
                sync.pending_result_tree.clear();
            }
        }
    }

    let host = baseline::capture_host_baseline(&state_dir, ctx.program());
    sync.host = host.clone();
    if created {
        sync.probe_ok = true;
    } else {
        let _ = ctx.sandbox_mkdir(name, &workdir);
        if let Some(probe) =
            ctx.sandbox_script(name, &workdir, &scripts::probe(ctx.program()), None)
        {
            sync.probe_ok = true;
            if probe == "missing" {
                ctx.note(&format!(
                    "Adopting the sandbox workspace as the baseline for '{name}'."
                ));
                match ctx.sandbox_script(name, &workdir, &scripts::init(ctx.program()), None) {
                    Some(tree) => sync.sandbox_tree = tree,
                    None => sync.probe_ok = false,
                }
            } else {
                sync.sandbox_tree = probe;
            }
        }
    }
    if !sync.probe_ok {
        ctx.warn(&format!(
            "cannot read or record the sandbox baseline for '{name}'"
        ));
    }
    if ctx.options.no_git_ignore {
        sync.upload = "unfiltered".to_string();
        ctx.note(
            "Automatic worktree apply is off for --no-git-ignore uploads; the patch is applied with the plain check.",
        );
    }
    if synced_sandbox_tree.is_empty() && sync.pending_kind.is_empty() {
        if let Some(tree) = baseline::read_kv(&state_dir.join("baseline")).get("sandbox_tree") {
            synced_sandbox_tree = tree.clone();
        }
    }
    let mut sandbox_empty = false;
    if host.ok
        && sync.probe_ok
        && synced_sandbox_tree.is_empty()
        && !sync.sandbox_tree.is_empty()
        && sync.sandbox_tree != host.tree
        && ctx
            .sandbox_script(
                name,
                &workdir,
                scripts::TREE_EMPTY,
                Some(&sync.sandbox_tree),
            )
            .as_deref()
            == Some("empty")
    {
        sandbox_empty = true;
    }
    let mut verdict = baseline::classify(&baseline::SyncInputs {
        bl_ok: host.ok,
        bl_tree: host.tree.clone(),
        synced_host_tree: synced_host_tree.clone(),
        synced_sandbox_tree: synced_sandbox_tree.clone(),
        pending_kind: sync.pending_kind.clone(),
        pending_result_tree: sync.pending_result_tree.clone(),
        probe_ok: sync.probe_ok,
        sandbox_tree: sync.sandbox_tree.clone(),
        sandbox_empty,
        created,
    });
    sync.state = verdict.state.to_string();
    if sync.state == "retained" && retained_patch_applied(&sync.pending_patch) {
        ctx.note("The retained patch is already applied; clearing the notice.");
        let _ = fs::remove_file(state_dir.join("pending"));
        sync.pending_kind.clear();
        sync.pending_result_tree.clear();
        if host.ok && host.tree == sync.sandbox_tree {
            sync.state = "clean".to_string();
            verdict.needs_refresh = false;
            let _ = ctx.sandbox_script(name, &workdir, &scripts::advance(ctx.program()), None);
        } else {
            sync.state = "behind".to_string();
            verdict.needs_refresh = true;
        }
    }
    if sync.state == "parked" {
        sync.stale = true;
        ctx.note(&format!(
            "Workspace '{name}' is parked: it holds changes with no durable patch."
        ));
        let pending_patch = sync.pending_patch.clone();
        let sandbox_tree = sync.sandbox_tree.clone();
        write_pending(
            ctx,
            &mut sync,
            &pending_patch,
            "workspace parked",
            "parked",
            &sandbox_tree,
        );
        recovery_block(ctx, &mut sync, "parked", &pending_patch);
        write_session_baseline(ctx, &sync);
        sync.blocked = true;
        return Ok(sync);
    }
    if verdict.needs_refresh || created {
        if !refresh_sandbox_workspace(ctx, &mut sync, &host) {
            sync.state = "parked".to_string();
            sync.stale = true;
            write_pending(ctx, &mut sync, "", "refresh failed", "parked", "");
            recovery_block(ctx, &mut sync, "parked", "");
            write_session_baseline(ctx, &sync);
            sync.blocked = true;
            return Ok(sync);
        }
        sync.state = "clean".to_string();
        if sync.pending_kind == "retained" {
            sync.state = "retained".to_string();
            ctx.note(&format!(
                "Retained patch for review: {}",
                sync.pending_patch
            ));
        }
    } else {
        if sync.probe_ok
            && !sync.sandbox_tree.is_empty()
            && (synced_sandbox_tree.is_empty() || synced_host_tree.is_empty())
        {
            write_synced_marker(ctx, &sync, &host.tree, &sync.sandbox_tree.clone());
            record_host_manifest(&state_dir);
        }
        ctx.note("Workspace is already current; the baseline matches the host.");
        if sync.state == "retained" && !sync.pending_patch.is_empty() {
            ctx.note(&format!(
                "Retained patch for review: {}",
                sync.pending_patch
            ));
        }
    }
    write_session_baseline(ctx, &sync);
    Ok(sync)
}

fn retained_patch_applied(patch: &str) -> bool {
    if patch.is_empty() || !Path::new(patch).is_file() {
        return false;
    }
    if !state::command_in_path("git") {
        return false;
    }
    let inside = std::process::Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if !inside {
        return false;
    }
    std::process::Command::new("git")
        .args(["apply", "--reverse", "--check", patch])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

const SANDBOX_PRUNE_SCRIPT: &str = r#"set -e
worktree=$2
manifest=$3
while IFS= read -r path; do
    case $path in
        ""|/*|..|../*|*/..|*/../*) continue ;;
    esac
    target=$worktree/$path
    if [ -f "$target" ] || [ -L "$target" ]; then
        rm -f -- "$target"
    fi
done < "$manifest"
rm -f -- "$manifest""#;

pub(crate) fn refresh_sandbox_workspace(
    ctx: &Context,
    sync: &mut SyncSession,
    host: &baseline::HostBaseline,
) -> bool {
    if !ctx.options.no_git_ignore {
        prune_old_paths(ctx, sync);
    }
    ctx.note("Refreshing the workspace from the host...");
    if ctx
        .upload(&sync.name, ".", &sync.workdir, ctx.options.no_git_ignore)
        .is_err()
    {
        return false;
    }
    let Some(tree) = ctx.sandbox_script(
        &sync.name,
        &sync.workdir,
        &scripts::init(ctx.program()),
        None,
    ) else {
        ctx.warn(&format!(
            "uploaded, but could not record the sandbox baseline for '{}'",
            sync.name
        ));
        return false;
    };
    record_host_manifest(&sync.state_dir);
    sync.sandbox_tree = tree.clone();
    write_synced_marker(ctx, sync, &host.tree, &tree);
    ctx.note("Refreshed the workspace from the host.");
    true
}

/// Removes tracked files that the previous refresh put in the sandbox but the
/// host no longer has. Ignored sandbox artifacts are not in the old manifest,
/// so they survive.
fn prune_old_paths(ctx: &Context, sync: &SyncSession) {
    let current_path = sync.state_dir.join("host_manifest");
    if !current_path.is_file() {
        return;
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let old: Vec<String> = if sync.state_dir.join("manifest").is_file() {
        sorted_lines(&sync.state_dir.join("manifest"))
    } else if !host_tree(sync).is_empty() {
        let tree = host_tree(sync);
        let output = Command::new("git")
            .args(["ls-tree", "-r", "--name-only", &tree])
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        match output {
            Ok(output) if output.status.success() => {
                let mut lines: Vec<String> = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .map(str::to_string)
                    .collect();
                lines.sort();
                lines
            }
            _ => Vec::new(),
        }
    } else {
        return;
    };
    if old.is_empty() {
        return;
    }
    let new: Vec<String> = sorted_lines(&current_path);
    let removed: Vec<&String> = old
        .iter()
        .filter(|path| !new.iter().any(|current| current == *path))
        .collect();
    if removed.is_empty() {
        return;
    }
    let list = sync
        .state_dir
        .join(format!("prune-list.{}", std::process::id()));
    let mut text = String::new();
    for path in &removed {
        text.push_str(path);
        text.push('\n');
    }
    if fs::write(&list, text).is_err() {
        return;
    }
    let _ = fs::set_permissions(&list, fs::Permissions::from_mode(0o600));
    let workdir = Path::new(&sync.workdir);
    let dest = workdir.parent().unwrap_or(Path::new("/")).join(format!(
        "{}-prune.{}",
        ctx.profile.tmp_prefix,
        std::process::id()
    ));
    let dest_text = dest.to_string_lossy().into_owned();
    let list_text = list.to_string_lossy().into_owned();
    let uploaded = ctx.upload(&sync.name, &list_text, &dest_text, false);
    if uploaded.is_err() {
        ctx.warn("could not send the tracked-deletion list to the sandbox");
    } else if ctx
        .sandbox_script(
            &sync.name,
            &sync.workdir,
            SANDBOX_PRUNE_SCRIPT,
            Some(&dest_text),
        )
        .is_none()
    {
        ctx.warn("could not prune tracked files removed on the host");
    }
    let _ = fs::remove_file(&list);
}

fn sorted_lines(path: &Path) -> Vec<String> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut lines: Vec<String> = text
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    lines.sort();
    lines
}

fn host_tree(sync: &SyncSession) -> String {
    baseline::read_kv(&sync.state_dir.join("synced"))
        .get("host_tree")
        .cloned()
        .unwrap_or_default()
}

fn write_synced_marker(ctx: &Context, sync: &SyncSession, host_tree: &str, sandbox_tree: &str) {
    if sandbox_tree.is_empty() {
        return;
    }
    let path = sync.state_dir.join("synced");
    let temp = sync
        .state_dir
        .join(format!("synced.{}", std::process::id()));
    let text = format!(
        "host_tree={host_tree}\nsandbox_tree={sandbox_tree}\nsandbox_id={}\n",
        sync.sandbox_id
    );
    if fs::write(&temp, text).is_err() {
        return;
    }
    let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
    if fs::rename(&temp, &path).is_ok() {
        ctx.registry_update(&sync.name, Some(&sync.sandbox_id), false, true);
    }
}

fn record_host_manifest(state_dir: &Path) {
    let source = state_dir.join("host_manifest");
    if !source.is_file() {
        return;
    }
    let temp = state_dir.join(format!("manifest.{}", std::process::id()));
    if fs::copy(&source, &temp).is_ok() {
        let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
        if fs::rename(&temp, state_dir.join("manifest")).is_err() {
            let _ = fs::remove_file(&temp);
        }
    } else {
        let _ = fs::remove_file(&temp);
    }
}

fn write_session_baseline(ctx: &Context, sync: &SyncSession) {
    let _ = ctx;
    let path = sync.state_dir.join("baseline");
    let temp = sync
        .state_dir
        .join(format!("baseline.{}", std::process::id()));
    let text = format!(
        "sandbox={}\nworkdir={}\nmode={}\ngit={}\nbranch={}\ncommit={}\ntree={}\nbase={}\ndirty={}\nsandbox_tree={}\nstate={}\nstale={}\nupload={}\nsandbox_id={}\n",
        sync.name,
        sync.workdir,
        sync.host.mode,
        if sync.host.git { 1 } else { 0 },
        sync.host.branch,
        sync.host.commit,
        sync.host.tree,
        sync.host.base,
        if sync.host.dirty { 1 } else { 0 },
        sync.sandbox_tree,
        sync.state,
        if sync.stale { 1 } else { 0 },
        sync.upload,
        sync.sandbox_id
    );
    if fs::write(&temp, text).is_err() {
        let _ = fs::remove_file(&temp);
        return;
    }
    let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
    if fs::rename(&temp, &path).is_err() {
        let _ = fs::remove_file(&temp);
    }
}

fn write_pending(
    ctx: &Context,
    sync: &mut SyncSession,
    patch: &str,
    reason: &str,
    kind: &str,
    result_tree: &str,
) {
    let mut kind = kind.to_string();
    if !matches!(kind.as_str(), "retained" | "parked") {
        kind = if !patch.is_empty() && fs::metadata(patch).is_ok_and(|meta| meta.len() > 0) {
            "retained".to_string()
        } else {
            "parked".to_string()
        };
    }
    let marker = PendingMarker {
        version: "1".to_string(),
        kind: kind.clone(),
        patch: patch.to_string(),
        sandbox: sync.name.clone(),
        sandbox_id: sync.sandbox_id.clone(),
        created: super::context::utc_now(),
        reason: reason.to_string(),
        result_tree: result_tree.to_string(),
    };
    let path = sync.state_dir.join("pending");
    if let Ok(entry) = marker.to_flat() {
        if flat::write_atomic(&path, &entry).is_err() {
            ctx.warn(&format!(
                "cannot write the pending marker in {}",
                sync.state_dir.display()
            ));
        }
    }
    sync.pending_patch = patch.to_string();
    sync.pending_kind = kind;
    sync.pending_result_tree = result_tree.to_string();
}

fn recovery_block(ctx: &Context, sync: &mut SyncSession, kind: &str, patch: &str) {
    if kind == "retained" {
        ctx.note("The sandbox patch is retained for review; the workspace can be refreshed.");
        ctx.note(&format!("  sandbox:   {}", sync.name));
        ctx.note(&format!("  workspace: {}", sync.workdir));
        ctx.note(&format!(
            "  inspect:   openshell sandbox connect {}",
            sync.name
        ));
        ctx.note(&format!(
            "  copy one:  {} download {}/PATH ./DEST",
            ctx.program(),
            sync.workdir
        ));
        ctx.note(&format!(
            "  download:  {} download {} ./DEST",
            ctx.program(),
            sync.workdir
        ));
        if !patch.is_empty() {
            ctx.note(&format!("  patch:     {patch}"));
            ctx.note(&format!("  review:    git apply --3way '{patch}'"));
        }
        ctx.note(&format!(
            "  apply:     osa resolve {} apply      (to the working tree, no commit)",
            sync.name
        ));
        ctx.note(&format!(
            "  branch:    osa resolve {} branch     (commit on a new branch)",
            sync.name
        ));
        ctx.note(&format!(
            "  drop:      osa resolve {} drop --yes (keep the patch aside)",
            sync.name
        ));
        ctx.note(&format!(
            "  next:      {} (the next session refreshes from the host)",
            ctx.program()
        ));
        return;
    }
    let _ = patch;
    ctx.err_line("sandbox changes are not in the host project; the workspace is parked");
    ctx.err_line(&format!("  sandbox:   {}", sync.name));
    ctx.err_line(&format!("  workspace: {}", sync.workdir));
    ctx.err_line(&format!(
        "  inspect:   openshell sandbox connect {}",
        sync.name
    ));
    ctx.err_line(&format!(
        "  copy one:  {} download {}/PATH ./DEST",
        ctx.program(),
        sync.workdir
    ));
    ctx.err_line(&format!(
        "  download:  {} download {} ./DEST",
        ctx.program(),
        sync.workdir
    ));
    ctx.err_line(&format!(
        "  rescue:    osa resolve {} rescue   (copy the workspace into the state directory)",
        sync.name
    ));
    ctx.err_line(&format!(
        "  discard:   osa resolve {} discard --yes   (or {} upload --discard, {} rm --discard)",
        sync.name,
        ctx.program(),
        ctx.program()
    ));
    ctx.err_line(&format!(
        "  pending:   {}/pending",
        sync.state_dir.display()
    ));
}

pub fn sync_project_back(ctx: &Context, sync: &mut SyncSession) {
    if sync.name.is_empty() {
        return;
    }
    if ctx.options.no_sync {
        write_pending(ctx, sync, "", "no-sync", "parked", "");
        ctx.note("Skipped download (--no-sync); the workspace is parked.");
        recovery_block(ctx, sync, "parked", "");
        return;
    }
    let stamp = format!(
        "{}-{}",
        super::context::utc_now()
            .replace(['-', ':'], "")
            .replace('T', "")
            .trim_end_matches('Z'),
        std::process::id()
    );
    let patch_file = sync.state_dir.join(format!("patch-{stamp}.patch"));
    if !collect_sandbox_patch(ctx, sync, &patch_file) {
        write_pending(ctx, sync, "", "collection failed", "parked", "");
        recovery_block(ctx, sync, "parked", &patch_file.display().to_string());
        return;
    }
    if fs::metadata(&patch_file)
        .map(|meta| meta.len())
        .unwrap_or(0)
        == 0
    {
        let _ = fs::remove_file(&patch_file);
        ctx.note("No sandbox changes to sync.");
        return;
    }
    ctx.note(&format!(
        "Collected sandbox changes: {}",
        patch_file.display()
    ));
    let patch = patch_file.display().to_string();
    match apply_sandbox_patch(ctx, sync, &patch) {
        0 => {}
        1 => {
            write_pending(
                ctx,
                sync,
                &patch,
                "apply failed",
                "retained",
                &sync.result_tree.clone(),
            );
            recovery_block(ctx, sync, "retained", &patch);
        }
        _ => {
            let kind = if sync.pending_kind.is_empty() {
                "retained".to_string()
            } else {
                sync.pending_kind.clone()
            };
            recovery_block(ctx, sync, &kind, &patch);
        }
    }
}

/// A resumed Maki session replays its stored transcript, and the proxy answers
/// 403 to any request body quoting a credential stand-in. The check runs
/// inside the sandbox and reports variable names only. Exit 3 means
/// "poisoned"; any other non-zero status only means the check could not run,
/// which must not block the resume.
const MAKI_RESUME_CHECK_SCRIPT: &str = r#"set -e
sessions=${HOME:-/sandbox}/.local/state/maki/sessions
file=
if [ -n "$1" ]; then
    file=$sessions/$1.jsonl
else
    for candidate in "$sessions"/*.jsonl; do
        [ -f "$candidate" ] || continue
        if [ -z "$file" ] || [ "$candidate" -nt "$file" ]; then
            file=$candidate
        fi
    done
fi
[ -n "$file" ] && [ -f "$file" ] || exit 0
found=
for key in $(printenv | sed -n "s/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p"); do
    case $key in
        *_API_KEY|*_TOKEN|*_SECRET|*_SECRET_KEY) ;;
        *) continue ;;
    esac
    value=$(printenv "$key" 2>/dev/null || true)
    [ "${#value}" -ge 16 ] || continue
    if grep -qF -- "$value" "$file"; then
        found="$found $key"
    fi
done
[ -z "$found" ] || { printf "%s\n" "$found"; exit 3; }
"#;

fn resume_check(ctx: &Context, name: &str, workdir: &str) -> Outcome {
    if ctx.profile.name != "maki-oss" {
        return Ok(());
    }
    let resume = ctx.options.resume.clone().unwrap_or_default();
    if !ctx.options.continue_session && resume.is_empty() {
        return Ok(());
    }
    let args = [
        "sandbox",
        "exec",
        "-n",
        name,
        "--no-login-shell",
        "--workdir",
        workdir,
        "--",
        "sh",
        "-c",
        MAKI_RESUME_CHECK_SCRIPT,
        "maki-oss-resume-check",
        resume.as_str(),
    ];
    let output = ctx
        .openshell(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|error| {
            Failure::dep(format!(
                "cannot run openshell: {error}; install it from https://github.com/NVIDIA/OpenShell"
            ))
        })?;
    if crate::process::exit_code(output.status) != super::cli::EX_GATEWAY {
        return Ok(());
    }
    let names = String::from_utf8_lossy(&output.stdout).trim().to_string();
    ctx.err_line(&format!(
        "refusing to resume: the stored session already contains the credential stand-in for {names}"
    ));
    ctx.err_line(
        "the proxy rejects any request body carrying it, so the first call of the resumed turn would fail with 403 credential_placeholder_in_request_body",
    );
    ctx.err_line(
        "repair the transcript in the sandbox (remove the reference, keeping a copy) or start a fresh session; do not widen policy or retry the resume",
    );
    Err(Failure::silent(super::cli::EX_GATEWAY))
}

/// The OpenCode TUI mode of `maki-oss`: the helper owns the sandbox lifecycle,
/// the bridge owns the wire. Ensure the sandbox, start the bridge, wait for
/// its listen line, attach `opencode --server` on the TTY, then kill the
/// bridge and run the usual sync and proposal check.
fn opencode_tui(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    let name = ctx.sandbox_name()?;
    let _lock = take_session_lock(ctx, &name)?;
    let mut sync = SyncSession {
        name: name.clone(),
        workdir: ctx.workdir(),
        created: false,
        ..SyncSession::default()
    };
    ensure_project_sandbox(ctx, &mut sync)?;
    if sync.blocked {
        return Err(Failure::silent(super::cli::EX_USAGE));
    }

    let bridge = ctx.repo_root.join("bridge").join("src").join("bridge.ts");
    let log_path = std::env::temp_dir().join(format!(
        "{}-bridge.{}.log",
        ctx.program(),
        std::process::id()
    ));
    ctx.note("Starting the OpenCode TUI bridge...");
    let output = fs::File::create(&log_path).and_then(|file| {
        let errors = file.try_clone()?;
        Command::new("bun")
            .arg(&bridge)
            .env("OPENSHELL_BIN", openshell_path())
            .env("OPENMAKI_SANDBOX", &name)
            .env("OPENMAKI_CWD", ctx.workdir())
            .env("MAKI_MODEL", ctx.model())
            .stdout(Stdio::from(file))
            .stderr(Stdio::from(errors))
            .spawn()
    });
    let mut child = output.map_err(|_| {
        let _ = fs::remove_file(&log_path);
        Failure::dep(format!(
            "bridge exited before listening; tui = \"opencode\" needs bun and the bridge entrypoint ({})",
            bridge.display()
        ))
    })?;
    let port = match wait_for_bridge_port(ctx, &log_path, &mut child) {
        Ok(port) => port,
        Err(failure) => {
            let _ = fs::remove_file(&log_path);
            return Err(failure);
        }
    };
    ctx.note(&format!(
        "Attaching the OpenCode TUI (server http://127.0.0.1:{port})..."
    ));
    let code = match Command::new("opencode")
        .arg("--server")
        .arg(format!("http://127.0.0.1:{port}"))
        .status()
    {
        Ok(status) => crate::process::exit_code(status),
        Err(_) => 127,
    };
    // The bridge is a child of this process, so it must be stopped explicitly.
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
    let _ = child.wait();
    let _ = fs::remove_file(&log_path);
    sync_project_back(ctx, &mut sync);
    announce_pending_proposals(ctx, &name);
    if code == 0 {
        Ok(())
    } else {
        Err(Failure::silent(code))
    }
}

/// Reads the bridge log until its listen line names a loopback port. A bridge
/// that dies or stays quiet is a dependency failure.
fn wait_for_bridge_port(
    ctx: &Context,
    log_path: &Path,
    child: &mut std::process::Child,
) -> Result<u16, Failure> {
    let mut attempts = 0;
    loop {
        if let Ok(text) = fs::read_to_string(log_path) {
            if let Some(port) = listen_port(&text) {
                return Ok(port);
            }
        }
        if let Ok(Some(_)) = child.try_wait() {
            let text = fs::read_to_string(log_path).unwrap_or_default();
            for line in text.lines() {
                eprintln!("  {line}");
            }
            return Err(Failure::dep(format!(
                "bridge exited before listening; tui = \"opencode\" needs bun and the bridge entrypoint ({})",
                ctx.repo_root.join("bridge").join("src").join("bridge.ts").display()
            )));
        }
        attempts += 1;
        if attempts > 10 {
            unsafe {
                libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
            }
            let _ = child.wait();
            return Err(Failure::dep(
                "bridge reported no listen address within 10 seconds",
            ));
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

fn listen_port(text: &str) -> Option<u16> {
    let marker = "bridge listening on http://127.0.0.1:";
    text.lines().find_map(|line| {
        let rest = line.split_once(marker)?.1;
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        digits.parse().ok()
    })
}

fn openshell_path() -> String {
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join("openshell");
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    "openshell".to_string()
}

fn timeout_wrapper(ctx: &Context) -> String {
    format!(
        "tag=$1; secs=$2; shift 2\n\
stop=/tmp/{tmp}-stop/$tag\n\
rm -f \"$stop\"\n\
export {prefix}_RUN_TAG=\"$tag\"\n\
exec 3<&0\n\
timeout --kill-after=10 \"$secs\" \"$@\" <&3 3<&- &\n\
exec 3<&-\n\
child=$!\n\
while kill -0 \"$child\" 2>/dev/null; do\n    \
if [ -e \"$stop\" ]; then kill -TERM \"$child\" 2>/dev/null; break; fi\n    \
sleep 1\n\
done\n\
wait \"$child\"\n\
rc=$?\n\
unset {prefix}_RUN_TAG\n\
for d in /proc/[0-9]*; do\n    \
if grep -qzx \"{prefix}_RUN_TAG=$tag\" \"$d/environ\" 2>/dev/null; then\n        \
kill -KILL \"${{d#/proc/}}\" 2>/dev/null\n    \
fi\n\
done\n\
rm -f \"$stop\"\n\
exit \"$rc\"",
        tmp = ctx.profile.tmp_prefix,
        prefix = ctx.profile.env_prefix,
    )
}

fn apply_sandbox_patch(ctx: &Context, sync: &mut SyncSession, patch: &str) -> i32 {
    if sync.state == "parked" {
        ctx.note("The workspace is parked; keeping this patch for review.");
        write_pending(
            ctx,
            sync,
            patch,
            "parked",
            "parked",
            &sync.result_tree.clone(),
        );
        return 2;
    }
    if !sync.probe_ok {
        ctx.note("Cannot verify the sandbox baseline; keeping this patch for review.");
        write_pending(
            ctx,
            sync,
            patch,
            "unverified baseline",
            "retained",
            &sync.result_tree.clone(),
        );
        return 2;
    }
    let git_inside = state::command_in_path("git")
        && std::process::Command::new("git")
            .args(["rev-parse", "--is-inside-work-tree"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success());
    if sync.upload != "unfiltered"
        && matches!(sync.host.mode.as_str(), "clean" | "dirty")
        && git_inside
    {
        return worktree_apply(ctx, sync, patch);
    }
    plain_apply(ctx, sync, patch)
}

fn worktree_apply(ctx: &Context, sync: &mut SyncSession, patch: &str) -> i32 {
    let base = sync.host.base.clone();
    if base.is_empty() {
        ctx.warn("the session baseline has no commit; keeping the patch");
        return 1;
    }
    let id = format!(
        "{}-{}",
        super::context::utc_now()
            .replace(['-', ':'], "")
            .replace('T', "")
            .trim_end_matches('Z'),
        std::process::id()
    );
    let branch = format!("{}/{}-{id}", ctx.program(), sync.name);
    let worktree = sync.state_dir.join("worktrees").join(&id);
    if fs::create_dir_all(sync.state_dir.join("worktrees")).is_err() {
        ctx.warn(&format!(
            "cannot create the worktree directory under {}",
            sync.state_dir.display()
        ));
        return 1;
    }
    let _ = std::process::Command::new("git")
        .args(["worktree", "prune"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let added = std::process::Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            &branch,
            &worktree.display().to_string(),
            &base,
        ])
        .stdout(stderr_stdio())
        .stderr(Stdio::inherit())
        .status()
        .is_ok_and(|status| status.success());
    if !added {
        ctx.warn(&format!(
            "cannot create the review worktree at {}; keeping the patch",
            worktree.display()
        ));
        return 1;
    }
    let worktree_text = worktree.display().to_string();
    let check = git_in(&worktree_text, &["apply", "--check", patch]);
    let applied = if check {
        git_in(&worktree_text, &["apply", patch])
    } else {
        git_in(&worktree_text, &["apply", "--3way", patch])
    };
    if !applied {
        ctx.note("The sandbox patch conflicts with the host; the host project was left unchanged.");
        ctx.note(&format!("  patch:    {patch}"));
        ctx.note(&format!(
            "  worktree: {worktree_text} (branch '{branch}', may need manual conflict resolution)"
        ));
        ctx.note(
            "Resolve there and commit, then merge or cherry-pick the branch; or apply the patch directly.",
        );
        write_pending(
            ctx,
            sync,
            patch,
            "conflict",
            "retained",
            &sync.result_tree.clone(),
        );
        return 2;
    }
    if !git_in(&worktree_text, &["add", "-A"]) {
        ctx.warn(&format!(
            "cannot stage the result in {worktree_text}; the patch is kept"
        ));
        return 1;
    }
    let Some(tree) = git_text_in(&worktree_text, &["write-tree"]) else {
        ctx.warn(&format!(
            "cannot write the result tree in {worktree_text}; the patch is kept"
        ));
        return 1;
    };
    let email = format!("{}@localhost", ctx.program());
    let message = format!("{}: apply sandbox changes", ctx.program());
    let Some(result) = git_text_env_in(
        &worktree_text,
        &["commit-tree", &tree, "-p", &base, "-m", &message],
        &[
            ("GIT_AUTHOR_NAME", Some(ctx.program())),
            ("GIT_AUTHOR_EMAIL", Some(email.as_str())),
            ("GIT_COMMITTER_NAME", Some(ctx.program())),
            ("GIT_COMMITTER_EMAIL", Some(email.as_str())),
        ],
    ) else {
        ctx.warn(&format!(
            "cannot commit the result in {worktree_text}; the patch is kept"
        ));
        return 1;
    };
    if !git_in(&worktree_text, &["update-ref", "HEAD", &result]) {
        ctx.warn(&format!(
            "cannot commit the result in {worktree_text}; the patch is kept"
        ));
        return 1;
    }
    if sync.host.mode != "clean" || sync.host.branch.is_empty() {
        ctx.note(&format!(
            "Sandbox changes committed on branch '{branch}' (worktree: {worktree_text})."
        ));
        ctx.note("Uncommitted host work was not committed. Apply the agent changes with:");
        ctx.note(&format!("  git cherry-pick {result}"));
        ctx.note(
            "If cherry-pick refuses because a changed path is untracked, run: git add -N <path>",
        );
        ctx.note(&format!("Or apply the patch directly: git apply '{patch}'"));
        advance_sandbox_baseline(ctx, sync);
        write_pending(
            ctx,
            sync,
            patch,
            "dirty baseline",
            "retained",
            &sync.result_tree.clone(),
        );
        return 2;
    }
    let now_branch = git_text(&["symbolic-ref", "--short", "-q", "HEAD"]).unwrap_or_default();
    let now_head = git_text(&["rev-parse", "-q", "--verify", "HEAD"]).unwrap_or_default();
    let now_dirty = git_text(&["status", "--porcelain"]).unwrap_or_default();
    if now_branch != sync.host.branch || now_head != sync.host.commit || !now_dirty.is_empty() {
        ctx.note("The host moved or has uncommitted changes; it was not fast-forwarded.");
        ctx.note(&format!("  branch:   {branch} (worktree: {worktree_text})"));
        ctx.note(&format!(
            "  review:   git -C '{worktree_text}' show {result}"
        ));
        ctx.note(&format!("  merge:    git merge {branch}"));
        ctx.note(&format!("  patch:    {patch}"));
        advance_sandbox_baseline(ctx, sync);
        write_pending(
            ctx,
            sync,
            patch,
            "host moved",
            "retained",
            &sync.result_tree.clone(),
        );
        return 2;
    }
    if !std::process::Command::new("git")
        .args(["merge", "--ff-only", &result])
        .stdout(stderr_stdio())
        .stderr(Stdio::inherit())
        .status()
        .is_ok_and(|status| status.success())
    {
        ctx.warn(&format!(
            "fast-forward failed; branch '{branch}' and worktree {worktree_text} are kept"
        ));
        write_pending(
            ctx,
            sync,
            patch,
            "fast-forward failed",
            "retained",
            &sync.result_tree.clone(),
        );
        return 2;
    }
    let _ = std::process::Command::new("git")
        .args(["worktree", "remove", &worktree_text])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = std::process::Command::new("git")
        .args(["branch", "-d", &branch])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    advance_sandbox_baseline(ctx, sync);
    refresh_synced_marker(ctx, sync);
    let _ = fs::remove_file(sync.state_dir.join("pending"));
    ctx.note(&format!(
        "Applied sandbox changes to branch '{}'.",
        sync.host.branch
    ));
    0
}

fn plain_apply(ctx: &Context, sync: &mut SyncSession, patch: &str) -> i32 {
    match patch_check_apply(patch) {
        0 => {
            advance_sandbox_baseline(ctx, sync);
            refresh_synced_marker(ctx, sync);
            let _ = fs::remove_file(sync.state_dir.join("pending"));
            ctx.note(&format!(
                "Applied sandbox changes to {}.",
                std::env::current_dir()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|_| ".".to_string())
            ));
            0
        }
        3 => export_review_files(ctx, sync, patch),
        2 => {
            let dir = std::env::current_dir()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|_| ".".to_string());
            ctx.note(&format!(
                "The sandbox patch does not apply cleanly; {dir} was left unchanged."
            ));
            ctx.note(&format!("  patch:  {patch}"));
            if state::command_in_path("git") {
                ctx.note(&format!("  review: git apply --3way '{patch}'"));
            } else {
                ctx.note(&format!("  review: patch -p1 < '{patch}'"));
            }
            write_pending(
                ctx,
                sync,
                patch,
                "conflict",
                "retained",
                &sync.result_tree.clone(),
            );
            2
        }
        4 => {
            ctx.warn("neither git nor patch is available on the host; keeping the patch");
            1
        }
        _ => {
            let dir = std::env::current_dir()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|_| ".".to_string());
            ctx.warn(&format!(
                "applying the sandbox patch failed; {dir} was left unchanged"
            ));
            1
        }
    }
}

/// No-git binary fallback: the sandbox reports changed paths and hashes, and
/// only those files are copied into a review directory outside the project.
fn export_review_files(ctx: &Context, sync: &mut SyncSession, patch: &str) -> i32 {
    let dir = sync.state_dir.join(format!(
        "review-{}-{}",
        super::resolve::compact_stamp(),
        std::process::id()
    ));
    let manifest = dir.join("manifest");
    if fs::create_dir_all(&dir).is_err() {
        ctx.warn(&format!(
            "cannot create the review directory {}",
            dir.display()
        ));
        return 1;
    }
    let output = ctx
        .sandbox_script_output(
            &sync.name,
            &sync.workdir,
            &scripts::manifest(ctx.program()),
            None,
        )
        .filter(|output| output.status.success());
    let Some(output) = output else {
        ctx.warn("cannot read the changed-file manifest from the sandbox");
        let _ = fs::remove_dir_all(&dir);
        return 1;
    };
    if fs::write(&manifest, &output.stdout).is_err() {
        ctx.warn("cannot read the changed-file manifest from the sandbox");
        let _ = fs::remove_dir_all(&dir);
        return 1;
    }
    let _ = fs::set_permissions(&manifest, fs::Permissions::from_mode(0o600));
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let mut failed = false;
    for line in text.lines() {
        let mut fields = line.splitn(3, '\t');
        let status = fields.next().unwrap_or("");
        let _hash = fields.next().unwrap_or("");
        let path = fields.next().unwrap_or("");
        if path.is_empty() {
            continue;
        }
        if path.starts_with('/')
            || path == ".."
            || path.starts_with("../")
            || path.ends_with("/..")
            || path.contains("/../")
        {
            ctx.warn(&format!(
                "refusing unexpected path in the sandbox manifest: {path}"
            ));
            failed = true;
            break;
        }
        if status.starts_with('D') {
            continue;
        }
        let dest = dir.join("files").join(path);
        let Some(parent) = dest.parent() else {
            failed = true;
            break;
        };
        if fs::create_dir_all(parent).is_err() {
            failed = true;
            break;
        }
        let source = format!("{}/{path}", sync.workdir);
        let downloaded = ctx
            .download_to(&sync.name, &source, &dest.display().to_string(), true)
            .is_ok();
        if !downloaded {
            failed = true;
            break;
        }
    }
    if failed {
        ctx.warn("could not export every changed file; the project was left unchanged");
        return 1;
    }
    ctx.note(&format!(
        "The host has no git; changed files were exported for review: {}",
        dir.display()
    ));
    ctx.note(&format!("  manifest: {}", manifest.display()));
    write_pending(
        ctx,
        sync,
        patch,
        "binary export",
        "retained",
        &sync.result_tree.clone(),
    );
    2
}

fn patch_check_apply(patch: &str) -> i32 {
    if state::command_in_path("git") {
        if !git_ok(&["apply", "--check", patch]) {
            return 2;
        }
        if !git_ok(&["apply", patch]) {
            return 1;
        }
        return 0;
    }
    let text = fs::read_to_string(patch).unwrap_or_default();
    if text.lines().any(|line| {
        line.starts_with("GIT binary patch")
            || (line.starts_with("Binary files ") && line.ends_with(" differ"))
    }) {
        return 3;
    }
    if !state::command_in_path("patch") {
        return 4;
    }
    let file = match fs::File::open(patch) {
        Ok(file) => file,
        Err(_) => return 1,
    };
    let check = std::process::Command::new("patch")
        .args(["-p1", "--batch", "--dry-run", "--forward"])
        .stdin(Stdio::from(file))
        .stdout(stderr_stdio())
        .stderr(Stdio::inherit())
        .status();
    if !check.is_ok_and(|status| status.success()) {
        return 2;
    }
    let file = match fs::File::open(patch) {
        Ok(file) => file,
        Err(_) => return 1,
    };
    let apply = std::process::Command::new("patch")
        .args(["-p1", "--batch", "--forward"])
        .stdin(Stdio::from(file))
        .stdout(stderr_stdio())
        .stderr(Stdio::inherit())
        .status();
    if apply.is_ok_and(|status| status.success()) {
        0
    } else {
        1
    }
}

fn git_ok(args: &[&str]) -> bool {
    std::process::Command::new("git")
        .args(args)
        .stdout(stderr_stdio())
        .stderr(Stdio::inherit())
        .status()
        .is_ok_and(|status| status.success())
}

fn stderr_stdio() -> Stdio {
    Stdio::from(unsafe { std::fs::File::from_raw_fd(libc::dup(2)) })
}

fn git_in(dir: &str, args: &[&str]) -> bool {
    std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .stdout(stderr_stdio())
        .stderr(Stdio::inherit())
        .status()
        .is_ok_and(|status| status.success())
}

fn git_text(args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(args)
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_text_in(dir: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_text_env_in(dir: &str, args: &[&str], env: &[(&str, Option<&str>)]) -> Option<String> {
    let mut command = std::process::Command::new("git");
    command.arg("-C").arg(dir).args(args);
    for (key, value) in env {
        command.env(key, value.unwrap_or(""));
    }
    let output = command.stderr(Stdio::null()).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn advance_sandbox_baseline(ctx: &Context, sync: &SyncSession) {
    if ctx
        .sandbox_script(
            &sync.name,
            &sync.workdir,
            &scripts::advance(ctx.program()),
            None,
        )
        .is_none()
    {
        ctx.warn(
            "could not advance the sandbox baseline; a later session may report the sandbox stale",
        );
    }
}

fn refresh_synced_marker(ctx: &Context, sync: &mut SyncSession) {
    let host = baseline::capture_host_baseline(&sync.state_dir, ctx.program());
    sync.host = host.clone();
    if let Some(tree) = ctx.sandbox_script(
        &sync.name,
        &sync.workdir,
        &scripts::probe(ctx.program()),
        None,
    ) {
        if !tree.is_empty() {
            write_synced_marker(ctx, sync, &host.tree, &tree);
        }
    }
}

fn collect_sandbox_patch(ctx: &Context, sync: &mut SyncSession, patch: &Path) -> bool {
    if fs::write(patch, b"").is_err() {
        ctx.warn(&format!("cannot write the patch file {}", patch.display()));
        return false;
    }
    let _ = fs::set_permissions(patch, fs::Permissions::from_mode(0o600));
    let Some(output) =
        ctx.sandbox_script_bytes(&sync.name, &sync.workdir, &scripts::collect(ctx.program()))
    else {
        let _ = fs::remove_file(patch);
        ctx.warn("could not collect sandbox changes");
        return false;
    };
    if fs::write(patch, &output).is_err() {
        let _ = fs::remove_file(patch);
        ctx.warn("could not collect sandbox changes");
        return false;
    }
    let _ = fs::set_permissions(patch, fs::Permissions::from_mode(0o600));
    sync.result_tree = ctx
        .sandbox_script(
            &sync.name,
            &sync.workdir,
            &scripts::result_tree(ctx.program()),
            None,
        )
        .unwrap_or_default();
    true
}

fn announce_pending_proposals(ctx: &Context, name: &str) {
    let output = ctx
        .openshell(&["rule", "get", name, "--status", "pending"])
        .output();
    let Ok(output) = output else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let count = text
        .lines()
        .filter(|line| line.starts_with("  Chunk: "))
        .count();
    if count > 0 {
        ctx.note(&format!(
            "{count} pending network-rule proposal(s) for '{name}'. Review: {} policy review",
            ctx.program()
        ));
    }
}

pub(crate) fn resolved_idle_stop(ctx: &Context) -> Result<u64, Failure> {
    let value = ctx.setting(ctx.options.idle_stop.as_ref(), "IDLE_STOP", "1h");
    let (number, unit) = match value.chars().last() {
        Some(last @ ('s' | 'm' | 'h')) => (&value[..value.len() - 1], Some(last)),
        _ => (value.as_str(), None),
    };
    if number.is_empty() || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(Failure::usage(format!(
            "invalid 'idle_stop' value <{value}>: use seconds, optionally with an s, m, or h suffix (0 disables)"
        )));
    }
    let number: u64 = number.trim_start_matches('0').parse().unwrap_or(0);
    let seconds = match unit {
        Some('m') => number * 60,
        Some('h') => number * 3600,
        _ => number,
    };
    Ok(seconds)
}

#[derive(Debug)]
enum StdinMode {
    Inherit,
    Null,
    File(PathBuf),
}

fn exec_sandbox(
    ctx: &Context,
    name: &str,
    workdir: &str,
    tty: bool,
    argv: &[String],
    env: &[(String, String)],
    stdin: StdinMode,
) -> Result<i32, Failure> {
    let mut args: Vec<String> = vec!["sandbox".into(), "exec".into(), "-n".into(), name.into()];
    if tty {
        args.push("--tty".into());
    } else {
        args.push("--no-login-shell".into());
    }
    args.push("--workdir".into());
    args.push(workdir.to_string());
    for (key, value) in env {
        args.push("--env".into());
        args.push(format!("{key}={value}"));
    }
    args.push("--".into());
    args.extend(argv.iter().cloned());
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut command = ctx.openshell(&words);
    match stdin {
        StdinMode::Inherit => {
            command.stdin(Stdio::inherit());
        }
        StdinMode::Null => {
            command.stdin(Stdio::null());
        }
        StdinMode::File(path) => {
            let file = fs::File::open(path)
                .map_err(|_| Failure::usage("could not read the prompt from stdin"))?;
            command.stdin(Stdio::from(file));
        }
    }
    signals::capture();
    let mut child = command.spawn().map_err(|error| {
        signals::release();
        Failure::dep(format!(
            "cannot run openshell: {error}; install it from https://github.com/NVIDIA/OpenShell"
        ))
    })?;
    signals::child(Some(child.id()));
    let status = child.wait();
    signals::child(None);
    signals::release();
    let status = status.map_err(|error| {
        Failure::dep(format!(
            "cannot run openshell: {error}; install it from https://github.com/NVIDIA/OpenShell"
        ))
    })?;
    Ok(crate::process::exit_code(status))
}
