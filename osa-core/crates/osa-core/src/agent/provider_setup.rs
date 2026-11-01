//! The interactive provider setup wizard: stored credentials, the curated
//! catalog, profile import, provider creation, and remembering the result.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use super::config;
use super::context::Context;
use super::failure::{Failure, Outcome};

#[derive(Debug, Clone)]
struct Source {
    store: String,
    slug: String,
    auth: String,
    file: PathBuf,
}

pub fn interactive(ctx: &Context) -> Outcome {
    let sources = scan_stores();
    let mut chosen = None;
    if sources.is_empty() {
        ctx.say("No stored credentials detected.");
    } else {
        ctx.say("Detected credentials:");
        for (index, source) in sources.iter().enumerate() {
            ctx.say(&format!(
                "  {}. {}:{} ({})",
                index + 1,
                source.store,
                source.slug,
                auth_label(&source.auth)
            ));
        }
        let prompt = format!(
            "Select 1-{}, or g for another source, q to quit: ",
            sources.len()
        );
        loop {
            let reply = ask(&prompt)?;
            match reply.trim() {
                "" => {
                    ctx.say("Enter a number, g, or q.");
                }
                "q" | "Q" | "quit" => {
                    ctx.say("Aborted.");
                    return Err(Failure::silent(super::cli::EX_USAGE));
                }
                "g" | "G" | "generic" => {
                    return Err(Failure::dep(
                        "generic provider setup is not ported to the Rust front-end yet",
                    ))
                }
                text => match text.parse::<usize>() {
                    Ok(number) if number >= 1 && number <= sources.len() => {
                        chosen = Some(sources[number - 1].clone());
                        break;
                    }
                    _ => ctx.say(&format!("Enter a number between 1 and {}.", sources.len())),
                },
            }
        }
    }
    let Some(source) = chosen else {
        ctx.say("Aborted.");
        return Err(Failure::silent(super::cli::EX_USAGE));
    };
    if source.auth != "api" {
        return Err(Failure::with_lines(
            super::cli::EX_USAGE,
            vec![format!(
                "the {}:{} credential is an OAuth login, not an API key; this front-end cannot use it through a provider profile",
                source.store, source.slug
            )],
            false,
        ));
    }
    let Some(value) = credential_value(&source) else {
        return Err(Failure::with_lines(
            super::cli::EX_USAGE,
            vec![format!(
                "cannot read an API key for '{}:{}' from {}",
                source.store,
                source.slug,
                source.file.display()
            )],
            false,
        ));
    };

    let profile_id = catalog_lookup(ctx, &source.store, &source.slug)
        .ok_or_else(|| Failure::dep("no curated profile matches this credential"))?;
    let profile_file = ctx
        .repo_root
        .join("examples")
        .join("providers")
        .join(format!("{profile_id}.yaml"));
    if !profile_file.is_file() {
        return Err(Failure::dep(format!(
            "catalog maps {}:{} to '{profile_id}', but {} is missing",
            source.store,
            source.slug,
            profile_file.display()
        )));
    }
    ctx.say(&format!("Using curated profile '{profile_id}'."));
    let profile_env = profile_env_var(&profile_file).ok_or_else(|| {
        Failure::usage(format!(
            "cannot read a credential env var from {} (expected: env_vars: [NAME])",
            profile_file.display()
        ))
    })?;

    let provider_name = profile_id.clone();
    ctx.require_openshell()?;
    let provider_list = ctx.gateway_provider_names()?;
    let provider_exists = provider_list.contains(&provider_name);

    ctx.say(&format!("Linting profile '{profile_id}'..."));
    ctx.run_gateway(&["profile", "lint", "-f", &profile_file.display().to_string()])?;
    if profile_in_gateway(ctx, &profile_id) {
        ctx.say(&format!("Profile '{profile_id}' is already imported."));
    } else {
        ctx.say(&format!("Importing profile '{profile_id}' globally..."));
        ctx.run_gateway(&[
            "profile",
            "import",
            "-f",
            &profile_file.display().to_string(),
            "--global",
        ])?;
    }

    if provider_exists {
        return Err(Failure::dep(format!(
            "provider '{provider_name}' already exists; pass --yes to update it"
        )));
    }
    let mut command = ctx.openshell(&[
        "provider",
        "create",
        "--name",
        &provider_name,
        "--type",
        &profile_id,
        "--from-existing",
        "--global-profile",
    ]);
    command.env(&profile_env, &value);
    let status = command
        .status()
        .map_err(|error| Failure::dep(format!("cannot run openshell: {error}")))?;
    if !status.success() {
        return Err(Failure::gateway(format!(
            "openshell command failed (exit status {})",
            crate::process::exit_code(status)
        )));
    }
    ctx.say(&format!("Provider '{provider_name}' created."));

    let path = config::set_value(ctx.profile, "providers", &provider_name)
        .map_err(|error| Failure::dep(format!("cannot write the config file: {error}")))?;
    ctx.say(&format!(
        "Remembered provider '{provider_name}' in {}.",
        path.display()
    ));

    // Only an interactive run looks for the sandbox to attach to.
    let sandbox_name = ctx.sandbox_name()?;
    if ctx.sandbox_phase(&sandbox_name)?.is_some() {
        let reply = ask(&format!(
            "Attach provider '{provider_name}' to sandbox '{sandbox_name}'? [y/N] "
        ))?;
        if matches!(reply.trim(), "y" | "Y" | "yes" | "YES") {
            ctx.run_gateway(&[
                "sandbox",
                "provider",
                "attach",
                &sandbox_name,
                &provider_name,
                "--wait",
            ])?;
            ctx.say(&format!(
                "Provider '{provider_name}' attached to '{sandbox_name}'."
            ));
        }
    }

    let model = ask("Default model for sessions (provider/model, Enter to skip): ")?;
    if !model.trim().is_empty() {
        config::set_value(ctx.profile, "model", model.trim())
            .map_err(|error| Failure::dep(format!("cannot write the config file: {error}")))?;
        ctx.say(&format!("Default model set to '{}'.", model.trim()));
    }

    ctx.say("");
    ctx.say("Next steps:");
    ctx.say(&format!(
        "  start a session:               {} (from the project directory)",
        ctx.program()
    ));
    ctx.say(&format!(
        "  attach to an existing sandbox: {} provider attach {provider_name}",
        ctx.program()
    ));
    ctx.say(&format!(
        "  pick a model headless:         {} run --model <provider/model> \"...\"",
        ctx.program()
    ));
    Ok(())
}

fn ask(prompt: &str) -> Result<String, Failure> {
    print!("{prompt}");
    let _ = io::stdout().flush();
    let mut reply = String::new();
    if io::stdin().read_line(&mut reply).is_err() || reply.is_empty() {
        return Err(Failure::with_lines(
            super::cli::EX_USAGE,
            vec!["input ended before the prompt was answered".to_string()],
            false,
        ));
    }
    Ok(reply.trim_end_matches(['\n', '\r']).to_string())
}

fn auth_label(auth: &str) -> &'static str {
    match auth {
        "api" => "api-key",
        "oauth" => "oauth",
        _ => "unknown",
    }
}

fn scan_stores() -> Vec<Source> {
    let home = std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into());
    let home = PathBuf::from(home);
    let mut sources = Vec::new();
    for dir in [
        home.join(".local/state/maki/auth"),
        home.join(".local/state/maki/auth/plugins"),
    ] {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect();
        paths.sort();
        for path in paths {
            let slug = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            let auth = classify(&path);
            sources.push(Source {
                store: "maki".to_string(),
                slug,
                auth,
                file: path,
            });
        }
    }
    let opencode = home.join(".local/share/opencode/auth.json");
    if opencode.is_file() {
        if let Ok(text) = fs::read_to_string(&opencode) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(map) = value.as_object() {
                    let mut slugs: Vec<&String> = map.keys().collect();
                    slugs.sort();
                    for slug in slugs {
                        let kind = map[slug]
                            .get("type")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("unknown");
                        let auth = match kind {
                            "api" | "api_key" => "api",
                            "oauth" => "oauth",
                            _ => "unknown",
                        };
                        sources.push(Source {
                            store: "opencode".to_string(),
                            slug: slug.clone(),
                            auth: auth.to_string(),
                            file: opencode.clone(),
                        });
                    }
                }
            }
        }
    }
    sources
}

fn classify(path: &Path) -> String {
    let Ok(text) = fs::read_to_string(path) else {
        return "unknown".to_string();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return "unknown".to_string();
    };
    if value
        .get("api_key")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.is_empty())
    {
        return "api".to_string();
    }
    if value.get("access").is_some() || value.get("refresh").is_some() {
        return "oauth".to_string();
    }
    "unknown".to_string()
}

fn credential_value(source: &Source) -> Option<String> {
    let text = fs::read_to_string(&source.file).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    if source.store == "maki" {
        return value
            .get("api_key")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
    }
    value
        .get(&source.slug)
        .and_then(|entry| entry.get("key"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn catalog_lookup(ctx: &Context, store: &str, slug: &str) -> Option<String> {
    let path = if ctx.profile.name == "maki-oss" {
        ctx.repo_root.join("examples/providers/catalog.tsv")
    } else {
        ctx.repo_root
            .join(ctx.profile.name)
            .join("providers")
            .join("stores.tsv")
    };
    let text = fs::read_to_string(path).ok()?;
    for line in text.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut fields = line.split('\t');
        let (Some(catalog_store), Some(catalog_slug), Some(id)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        if catalog_store == store && catalog_slug == slug {
            return Some(id.to_string());
        }
    }
    None
}

fn profile_env_var(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("env_vars:") {
            let rest = rest.trim();
            let rest = rest.strip_prefix('[')?.strip_suffix(']')?;
            let name = rest.split(',').next()?.trim().trim_matches(['"', '\'']);
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn profile_in_gateway(ctx: &Context, id: &str) -> bool {
    let output = ctx
        .openshell(&[
            "profile", "list", "--type", "provider", "-o", "json", "--global",
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output();
    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let payload = String::from_utf8_lossy(&output.stdout);
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) else {
        return false;
    };
    value.as_array().is_some_and(|entries| {
        entries
            .iter()
            .any(|entry| entry.get("id").and_then(serde_json::Value::as_str) == Some(id))
    })
}

// ---------------------------------------------------------------------------
// `provider setup` driven by flags, and its program form `__provider-setup`.
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct Progress {
    steps: Vec<&'static str>,
    provider: String,
    profile: String,
    attached: Option<String>,
    doing: String,
}

impl Progress {
    fn mutated(&self) -> bool {
        self.steps.iter().any(|step| *step != "linted")
    }

    fn has(&self, step: &str) -> bool {
        self.steps.contains(&step)
    }

    fn done_text(&self) -> String {
        let mut text = if self.has("created") {
            format!("created {}", self.provider)
        } else if self.has("updated") {
            format!("updated the credential of {}", self.provider)
        } else if self.has("imported") {
            format!("imported profile {}", self.profile)
        } else {
            String::new()
        };
        if self.has("remembered") {
            text.push_str(" and remembered it");
        }
        if self.has("attached") {
            if let Some(sandbox) = &self.attached {
                text.push_str(&format!(", attached to {sandbox}"));
            }
        }
        text
    }
}

enum SourceKind {
    Store { store: String, slug: String },
    File,
    Env { name: String },
    Stdin,
    Prompt,
}

struct Chosen {
    kind: SourceKind,
    value: String,
}

pub fn command(ctx: &Context, args: &[OsString]) -> Outcome {
    if !args.is_empty() {
        return Err(Failure::usage("provider setup takes no arguments"));
    }
    if ctx.profile.name == "codex-oss" {
        return codex_setup(ctx);
    }
    let mut progress = Progress::default();
    run_setup(ctx, &mut progress, false)
}

fn profiles_dir(ctx: &Context) -> PathBuf {
    if ctx.profile.name == "maki-oss" {
        ctx.repo_root.join("examples").join("providers")
    } else {
        ctx.repo_root.join(ctx.profile.name).join("providers")
    }
}

fn generated_dir(ctx: &Context) -> PathBuf {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into())).join(".config")
        });
    home.join(ctx.profile.config_name).join("profiles")
}

fn custom_prefix(ctx: &Context) -> String {
    let stem = ctx
        .profile
        .name
        .strip_suffix("-oss")
        .unwrap_or(ctx.profile.name);
    format!("{stem}-")
}

fn agent_name(ctx: &Context) -> &'static str {
    match ctx.profile.name {
        "maki-oss" => "Maki",
        "opencode-oss" => "OpenCode",
        "claude-oss" => "Claude Code",
        _ => "Codex",
    }
}

fn valid_kebab(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn valid_env_name(value: &str) -> bool {
    let mut characters = value.chars();
    match characters.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn valid_host(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('.')
        && !value.ends_with('.')
        && !value.contains("..")
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '.' || character == '-'
        })
}

fn valid_api_path(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    value.starts_with('/')
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._/*-".contains(character))
}

fn first_line(value: &str) -> String {
    value.lines().next().unwrap_or("").to_string()
}

fn profile_field(path: &Path, key: &str) -> String {
    let Ok(text) = fs::read_to_string(path) else {
        return String::new();
    };
    let prefix = format!("{key}:");
    text.lines()
        .find_map(|line| {
            line.strip_prefix(&prefix)
                .map(|rest| rest.trim().to_string())
        })
        .unwrap_or_default()
}

/// Reads a single-level JSON string field; nested paths are supported too.
fn json_field(path: &Path, field: &str) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let mut current = &value;
    for key in field.trim_start_matches('.').split('.') {
        current = current.get(key)?;
    }
    current.as_str().map(str::to_string)
}

fn store_source(store: &str, slug: &str) -> Option<Source> {
    scan_stores()
        .into_iter()
        .find(|source| source.store == store && source.slug == slug)
}

fn read_stdin_credential() -> Result<String, Failure> {
    let mut text = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut text).is_err() {
        return Err(Failure::usage("could not read the credential from stdin"));
    }
    let value = text.strip_suffix('\n').unwrap_or(&text).to_string();
    if value.is_empty() {
        return Err(Failure::usage(
            "provider setup --stdin read an empty credential",
        ));
    }
    if value.contains('\n') {
        return Err(Failure::usage(
            "provider setup --stdin accepts one line; more than one was read",
        ));
    }
    if value.len() > 65536 {
        return Err(Failure::usage(
            "provider setup --stdin accepts at most 65536 bytes",
        ));
    }
    Ok(value)
}

fn unsupported(ctx: &Context, store: &str, slug: &str, auth: &str) -> Failure {
    let _ = ctx;
    Failure::with_lines(
        super::cli::EX_USAGE,
        vec![
            format!("credential '{store}:{slug}' is '{auth}', which this workflow does not support"),
            "  API-key credentials are the supported path; for OAuth guidance see docs/migrating-providers.md".to_string(),
        ],
        false,
    )
}

fn choose_source(ctx: &Context, program: bool) -> Result<Chosen, Failure> {
    let options = &ctx.options;
    if options.stdin || program {
        if options.from.is_some() || options.file.is_some() || !options.envs.is_empty() {
            return Err(Failure::usage(
                "provider setup accepts one credential source: --from, --file, --env, or --stdin",
            ));
        }
        if options
            .profile
            .as_ref()
            .is_none_or(|value| value.is_empty())
        {
            return Err(Failure::usage(
                "provider setup --stdin needs --profile ID or --profile FILE",
            ));
        }
        return Ok(Chosen {
            kind: SourceKind::Stdin,
            value: read_stdin_credential()?,
        });
    }
    if let Some(store) = options.from.as_ref().filter(|value| !value.is_empty()) {
        if options.file.is_some() || !options.envs.is_empty() {
            return Err(Failure::usage(
                "provider setup accepts one credential source: --from, --file, or --env",
            ));
        }
        if store != "maki" && store != "opencode" {
            return Err(Failure::usage(format!(
                "provider setup --from expects maki or opencode, got '{store}'"
            )));
        }
        if options.credentials.iter().any(|value| value.contains('=')) {
            return Err(Failure::usage(
                "--credential takes the SLUG name only; inline KEY=VALUE is not accepted",
            ));
        }
        let slug = first_line(&options.credentials.join("\n"));
        if slug.is_empty() {
            if !ctx.is_interactive() {
                return Err(Failure::usage(format!(
                    "provider setup --from {store} needs --credential SLUG when stdin is not a terminal"
                )));
            }
            return interactive_source(ctx, Some(store));
        }
        let Some(source) = store_source(store, &slug) else {
            return Err(Failure::usage(format!(
                "no '{slug}' credential in the {store} store"
            )));
        };
        return source_choice(ctx, &source);
    }
    if let Some(file) = options.file.as_ref().filter(|value| !value.is_empty()) {
        if !options.envs.is_empty() {
            return Err(Failure::usage(
                "provider setup accepts one credential source: --from, --file, or --env",
            ));
        }
        let path = PathBuf::from(file);
        if !path.is_file() {
            return Err(Failure::usage(format!(
                "provider setup --file: not a file: {file}"
            )));
        }
        let field = options
            .field
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| ".api_key".to_string());
        let Some(value) = json_field(&path, &field).filter(|value| !value.is_empty()) else {
            return Err(Failure::usage(format!(
                "no string value at '{field}' in {file}"
            )));
        };
        return Ok(Chosen {
            kind: SourceKind::File,
            value,
        });
    }
    if !options.envs.is_empty() {
        let name = first_line(&options.envs.join("\n"));
        if !valid_env_name(&name) {
            return Err(Failure::usage(format!(
                "provider setup --env expects an environment variable name, got '{name}'"
            )));
        }
        let Some(value) = std::env::var(&name).ok().filter(|value| !value.is_empty()) else {
            if ctx.profile.name == "claude-oss" && name == "CLAUDE_CODE_OAUTH_TOKEN" {
                ctx.err_line("create a subscription token with 'claude setup-token' on the host (never in a sandbox), then export it and rerun");
            }
            return Err(Failure::with_lines(
                super::cli::EX_USAGE,
                vec![format!(
                    "environment variable '{name}' is not set (or empty)"
                )],
                false,
            ));
        };
        return Ok(Chosen {
            kind: SourceKind::Env { name },
            value,
        });
    }
    if !ctx.is_interactive() {
        return Err(Failure::usage(
            "provider setup needs a credential source: --from STORE --credential SLUG, --file PATH [--field PATH], or --env VAR (stdin is not a terminal)",
        ));
    }
    interactive_source(ctx, None)
}

fn source_choice(ctx: &Context, source: &Source) -> Result<Chosen, Failure> {
    if source.auth != "api" {
        return Err(unsupported(ctx, &source.store, &source.slug, &source.auth));
    }
    let value = credential_value(source)
        .ok_or_else(|| unsupported(ctx, &source.store, &source.slug, &source.auth))?;
    Ok(Chosen {
        kind: SourceKind::Store {
            store: source.store.clone(),
            slug: source.slug.clone(),
        },
        value,
    })
}

fn interactive_source(ctx: &Context, filter: Option<&str>) -> Result<Chosen, Failure> {
    let sources: Vec<Source> = scan_stores()
        .into_iter()
        .filter(|source| filter.is_none_or(|store| source.store == store))
        .collect();
    if sources.is_empty() {
        if let Some(store) = filter {
            return Err(Failure::with_lines(
                super::cli::EX_USAGE,
                vec![format!("no {store} credentials found")],
                false,
            ));
        }
        ctx.say("No stored credentials detected.");
        return ask_generic(ctx);
    }
    ctx.say("Detected credentials:");
    for (index, source) in sources.iter().enumerate() {
        ctx.say(&format!(
            "  {}. {}:{} ({})",
            index + 1,
            source.store,
            source.slug,
            auth_label(&source.auth)
        ));
    }
    loop {
        let reply = ask(&format!(
            "Select 1-{}, or g for another source, q to quit: ",
            sources.len()
        ))?;
        match reply.trim() {
            "q" | "Q" | "quit" => {
                ctx.say("Aborted.");
                return Err(Failure::silent(super::cli::EX_USAGE));
            }
            "g" | "G" | "generic" => return ask_generic(ctx),
            text => match text.parse::<usize>() {
                Ok(number) if number >= 1 && number <= sources.len() => {
                    return source_choice(ctx, &sources[number - 1]);
                }
                _ => ctx.say(&format!("Enter a number between 1 and {}.", sources.len())),
            },
        }
    }
}

fn ask_generic(ctx: &Context) -> Result<Chosen, Failure> {
    loop {
        ctx.say("Credential source:");
        ctx.say("  1. JSON file (field path)");
        ctx.say("  2. Environment variable");
        ctx.say("  3. Hidden prompt");
        let reply = ask("Select 1-3, or q to quit: ")?;
        match reply.trim() {
            "1" => {
                let path = ask("Path to JSON file: ")?.trim().to_string();
                if !Path::new(&path).is_file() {
                    ctx.say(&format!("File not found: {path}"));
                    continue;
                }
                let field = ask("Field path [.api_key]: ")?.trim().to_string();
                let field = if field.is_empty() {
                    ".api_key".to_string()
                } else {
                    field
                };
                let Some(value) =
                    json_field(Path::new(&path), &field).filter(|value| !value.is_empty())
                else {
                    ctx.say(&format!("No string value at '{field}' in {path}."));
                    continue;
                };
                return Ok(Chosen {
                    kind: SourceKind::File,
                    value,
                });
            }
            "2" => {
                let name = ask("Environment variable name: ")?.trim().to_string();
                if !valid_env_name(&name) {
                    ctx.say("Invalid variable name.");
                    continue;
                }
                let Some(value) = std::env::var(&name).ok().filter(|value| !value.is_empty())
                else {
                    ctx.say(&format!("Variable '{name}' is not set."));
                    continue;
                };
                return Ok(Chosen {
                    kind: SourceKind::Env { name },
                    value,
                });
            }
            "3" => {
                let value = ask("Credential value (input hidden): ")?.trim().to_string();
                if value.is_empty() {
                    ctx.say("No value entered.");
                    continue;
                }
                return Ok(Chosen {
                    kind: SourceKind::Prompt,
                    value,
                });
            }
            "q" | "Q" | "quit" => {
                ctx.say("Aborted.");
                return Err(Failure::silent(super::cli::EX_USAGE));
            }
            _ => ctx.say("Enter 1, 2, 3, or q."),
        }
    }
}

fn generic_profile(ctx: &Context, chosen: &Chosen) -> Option<String> {
    if ctx.profile.name != "claude-oss" {
        return None;
    }
    let env = match &chosen.kind {
        SourceKind::Env { name } => name.clone(),
        _ => String::new(),
    };
    match env.as_str() {
        "ANTHROPIC_API_KEY" => Some("claude-anthropic".to_string()),
        "CLAUDE_CODE_OAUTH_TOKEN" => Some("claude-anthropic-oauth".to_string()),
        _ => {
            if !ctx.is_interactive() {
                return None;
            }
            ctx.say("Which credential is this?");
            ctx.say("  1) Anthropic API key (claude-anthropic)");
            ctx.say("  2) Claude subscription token from 'claude setup-token' on the host (claude-anthropic-oauth)");
            ctx.say("  3) Another provider (custom profile)");
            let reply = ask("Choice [1]: ").unwrap_or_default();
            match reply.trim() {
                "2" => Some("claude-anthropic-oauth".to_string()),
                "" | "1" => Some("claude-anthropic".to_string()),
                _ => None,
            }
        }
    }
}

fn run_setup(ctx: &Context, progress: &mut Progress, program: bool) -> Outcome {
    let interactive = !program && !ctx.options.stdin && ctx.is_interactive();
    if ctx.options.stdin && ctx.profile.name == "codex-oss" {
        return Err(Failure::usage(format!(
            "{} provider setup takes no --stdin credential: it is a login on the host; run '{} provider setup' in a terminal",
            ctx.program(),
            ctx.program()
        )));
    }
    if !crate::state::command_in_path("jq") {
        ctx.warn("jq not found; JSON stores are read with a limited fallback");
    }
    let chosen = choose_source(ctx, program)?;

    let profiles = profiles_dir(ctx);
    let mut profile_file: Option<PathBuf> = None;
    if let Some(profile) = ctx
        .options
        .profile
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(profile);
        if !program && path.is_file() {
            profile_file = Some(path);
        } else if !valid_kebab(profile) || profile == "template" {
            return Err(Failure::usage(format!(
                "provider setup --profile: '{profile}' is not a profile file or a profile id (kebab-case)"
            )));
        } else if profiles.join(format!("{profile}.yaml")).is_file() {
            profile_file = Some(profiles.join(format!("{profile}.yaml")));
        } else if generated_dir(ctx).join(format!("{profile}.yaml")).is_file() {
            profile_file = Some(generated_dir(ctx).join(format!("{profile}.yaml")));
        } else {
            return Err(Failure::usage(format!(
                "provider setup --profile: no profile file or profile id '{profile}' (curated: {}; generated: {})",
                profiles.display(),
                generated_dir(ctx).display()
            )));
        }
    } else if let SourceKind::Store { store, slug, .. } = &chosen.kind {
        if let Some(id) = catalog_lookup(ctx, store, slug) {
            let file = profiles.join(format!("{id}.yaml"));
            if !file.is_file() {
                return Err(Failure::dep(format!(
                    "catalog maps {store}:{slug} to '{id}', but {} is missing",
                    file.display()
                )));
            }
            ctx.say(&format!("Using curated profile '{id}'."));
            profile_file = Some(file);
        }
    }
    if profile_file.is_none() && !matches!(chosen.kind, SourceKind::Store { .. }) {
        if let Some(id) = generic_profile(ctx, &chosen) {
            let file = profiles.join(format!("{id}.yaml"));
            if !file.is_file() {
                return Err(Failure::dep(format!(
                    "curated profile '{id}' is missing: {}",
                    file.display()
                )));
            }
            ctx.say(&format!("Using curated profile '{id}'."));
            profile_file = Some(file);
        }
    }
    if profile_file.is_none() {
        if !ctx.is_interactive() {
            return Err(Failure::usage(
                "no curated profile matches this credential; custom profiles need an interactive terminal (or pass --profile FILE)",
            ));
        }
        profile_file = Some(custom_profile(ctx, &chosen)?);
    }
    let profile_file = profile_file.expect("profile file chosen");
    let profile_id = profile_field(&profile_file, "id");
    if profile_id.is_empty() {
        return Err(Failure::usage(format!(
            "cannot read a profile id from {}",
            profile_file.display()
        )));
    }
    let Some(profile_env) = profile_env_var(&profile_file) else {
        return Err(Failure::usage(format!(
            "cannot read a credential env var from {} (expected: env_vars: [NAME])",
            profile_file.display()
        )));
    };
    let provider_name = ctx
        .options
        .provider_name
        .clone()
        .or_else(|| {
            if program {
                None
            } else {
                ctx.options.name.clone()
            }
        })
        .unwrap_or_else(|| profile_id.clone());
    if !valid_kebab(&provider_name) {
        return Err(Failure::usage(format!(
            "invalid provider name '{provider_name}': use lowercase letters, digits, and single hyphens"
        )));
    }
    progress.provider = provider_name.clone();
    progress.profile = profile_id.clone();
    ctx.require_openshell()?;

    let names = match ctx
        .openshell(&["provider", "list", "--names"])
        .stdin(Stdio::null())
        .output()
    {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).into_owned()
        }
        _ => {
            return Err(Failure::gateway(format!(
                "cannot list providers; is the gateway running? Try '{} doctor'",
                ctx.program()
            )))
        }
    };
    let provider_exists = names.lines().any(|line| line == provider_name);
    if provider_exists && !ctx.options.yes && !interactive {
        if program {
            return Err(Failure::with_lines(
                2,
                vec![format!(
                    "provider '{provider_name}' already exists; pass --yes to update its credential"
                )],
                false,
            ));
        }
        return Err(Failure::usage(format!(
            "provider '{provider_name}' already exists; pass --yes to update it (stdin is not a terminal)"
        )));
    }
    if program && ctx.options.attach == Some(true) {
        let sandbox = ctx.sandbox_name()?;
        if ctx.sandbox_phase(&sandbox)?.is_none() {
            return Err(Failure::with_lines(
                2,
                vec![format!(
                    "sandbox '{sandbox}' is not on the gateway; cannot attach"
                )],
                false,
            ));
        }
    }

    ctx.say(&format!("Linting profile '{profile_id}'..."));
    progress.doing = "lint".to_string();
    let lint = [
        "profile".to_string(),
        "lint".to_string(),
        "-f".to_string(),
        profile_file.display().to_string(),
    ];
    gateway_step(ctx, &lint, program)?;
    progress.steps.push("linted");
    if profile_in_gateway(ctx, &profile_id) {
        ctx.say(&format!("Profile '{profile_id}' is already imported."));
    } else {
        ctx.say(&format!("Importing profile '{profile_id}' globally..."));
        progress.doing = format!("import of profile '{profile_id}'");
        let import = [
            "profile".to_string(),
            "import".to_string(),
            "-f".to_string(),
            profile_file.display().to_string(),
            "--global".to_string(),
        ];
        gateway_step(ctx, &import, program)?;
        progress.steps.push("imported");
    }

    if provider_exists {
        let mut update_now = ctx.options.yes;
        if !update_now && interactive {
            update_now = confirm(&format!(
                "Provider '{provider_name}' already exists. Update it from the local credential? [y/N] "
            ))?;
        }
        if update_now {
            progress.doing = format!("update of '{provider_name}'");
            let update = [
                "provider".to_string(),
                "update".to_string(),
                provider_name.clone(),
                "--from-existing".to_string(),
            ];
            gateway_step_env(ctx, &profile_env, &chosen.value, &update, program)?;
            progress.steps.push("updated");
            ctx.say(&format!("Provider '{provider_name}' updated."));
        } else {
            ctx.say(&format!("Keeping existing provider '{provider_name}'."));
        }
    } else {
        progress.doing = format!("create of '{provider_name}'");
        let create = [
            "provider".to_string(),
            "create".to_string(),
            "--name".to_string(),
            provider_name.clone(),
            "--type".to_string(),
            profile_id.clone(),
            "--from-existing".to_string(),
            "--global-profile".to_string(),
        ];
        gateway_step_env(ctx, &profile_env, &chosen.value, &create, program)?;
        progress.steps.push("created");
        ctx.say(&format!("Provider '{provider_name}' created."));
    }

    progress.doing = format!("remembering '{provider_name}'");
    let path = super::commands::remember_provider(ctx, &provider_name)?;
    progress.steps.push("remembered");
    ctx.say(&format!(
        "Remembered provider '{provider_name}' in {}.",
        path.display()
    ));

    let attach_flag = ctx.options.attach;
    if attach_flag == Some(true) || (attach_flag != Some(false) && interactive) {
        let sandbox = ctx.sandbox_name()?;
        if ctx.sandbox_phase(&sandbox)?.is_none() {
            if attach_flag == Some(true) {
                ctx.warn(&format!(
                    "sandbox '{sandbox}' not found; skipping attach (run '{} up' first)",
                    ctx.program()
                ));
            }
        } else {
            let mut attach_now = attach_flag == Some(true);
            if !attach_now {
                attach_now = confirm(&format!(
                    "Attach provider '{provider_name}' to sandbox '{sandbox}'? [y/N] "
                ))?;
            }
            if attach_now {
                progress.doing = format!("attach to '{sandbox}'");
                let attach = [
                    "sandbox".to_string(),
                    "provider".to_string(),
                    "attach".to_string(),
                    sandbox.clone(),
                    provider_name.clone(),
                    "--wait".to_string(),
                ];
                gateway_step(ctx, &attach, program)?;
                progress.steps.push("attached");
                progress.attached = Some(sandbox.clone());
                ctx.say(&format!(
                    "Provider '{provider_name}' attached to '{sandbox}'."
                ));
            }
        }
    }

    if interactive {
        let model = ask("Default model for sessions (provider/model, Enter to skip): ")?;
        let model = model.trim().to_string();
        if !model.is_empty() {
            config::set_value(ctx.profile, "model", &model)
                .map_err(|error| Failure::dep(format!("cannot write the config file: {error}")))?;
            ctx.say(&format!("Default model set to '{model}'."));
        }
    }

    setup_hint(ctx, &profile_id);
    ctx.say("");
    ctx.say("Next steps:");
    ctx.say(&format!(
        "  start a session:               {} (from the project directory)",
        ctx.program()
    ));
    ctx.say(&format!(
        "  attach to an existing sandbox: {} provider attach {provider_name}",
        ctx.program()
    ));
    ctx.say(&format!(
        "  pick a model headless:         {} run --model <provider/model> \"...\"",
        ctx.program()
    ));
    Ok(())
}

fn confirm(prompt: &str) -> Result<bool, Failure> {
    let reply = ask(prompt)?;
    Ok(matches!(reply.trim(), "y" | "Y" | "yes" | "YES"))
}

fn gateway_step(ctx: &Context, args: &[String], program: bool) -> Outcome {
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    if !program {
        return ctx.run_gateway(&words);
    }
    let output = ctx.openshell(&words).output();
    match output {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            if !text.is_empty() {
                eprint!("{text}");
            }
            Ok(())
        }
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stderr);
            if !text.is_empty() {
                eprint!("{text}");
            }
            record_reason(&text, ctx.program());
            Err(Failure::gateway(format!(
                "openshell command failed (exit status {})",
                crate::process::exit_code(output.status)
            )))
        }
        Err(error) => Err(Failure::dep(format!("cannot run openshell: {error}"))),
    }
}

fn gateway_step_env(
    ctx: &Context,
    key: &str,
    value: &str,
    args: &[String],
    program: bool,
) -> Outcome {
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut command = ctx.openshell(&words);
    command.env(key, value);
    if !program {
        let status = command
            .status()
            .map_err(|error| Failure::dep(format!("cannot run openshell: {error}")))?;
        return if status.success() {
            Ok(())
        } else {
            Err(Failure::gateway(format!(
                "openshell command failed (exit status {})",
                crate::process::exit_code(status)
            )))
        };
    }
    match command.output() {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            if !text.is_empty() {
                eprint!("{text}");
            }
            Ok(())
        }
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stderr);
            if !text.is_empty() {
                eprint!("{text}");
            }
            record_reason(&text, ctx.program());
            Err(Failure::gateway(format!(
                "openshell command failed (exit status {})",
                crate::process::exit_code(output.status)
            )))
        }
        Err(error) => Err(Failure::dep(format!("cannot run openshell: {error}"))),
    }
}

fn setup_hint(ctx: &Context, profile: &str) {
    if ctx.profile.name == "maki-oss" && profile == "maki-zai-coding" {
        ctx.say("");
        ctx.say("Z.AI coding plan: add the following to the sandbox's Maki providers.toml");
        ctx.say("(~/.config/maki/providers.toml) before the first request:");
        ctx.say("");
        ctx.say("  [zai]");
        ctx.say("  plan = \"coding\"");
    }
    if ctx.profile.name == "claude-oss" && profile == "claude-anthropic-oauth" {
        ctx.say("");
        ctx.say("the token comes from 'claude setup-token' on the host; revoke it from your Claude account if this gateway is compromised");
    }
    let model = if ctx.profile.name == "maki-oss" {
        None
    } else {
        model_note(ctx, profile)
    };
    if let Some(model) = model {
        ctx.say("");
        ctx.say(&format!("example model: {model}"));
        ctx.say(&format!(
            "set it as the default: model = \"{model}\" in {}",
            ctx.profile.config_path().display()
        ));
    }
}

fn model_note(ctx: &Context, profile: &str) -> Option<String> {
    let text = fs::read_to_string(profiles_dir(ctx).join("catalog.tsv")).ok()?;
    let column = if ctx.profile.name == "opencode-oss" {
        3
    } else {
        2
    };
    for line in text.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&profile) {
            return fields.get(column).map(|value| value.to_string());
        }
    }
    None
}

fn custom_profile(ctx: &Context, chosen: &Chosen) -> Result<PathBuf, Failure> {
    let template = profiles_dir(ctx).join("template.yaml");
    if !template.is_file() {
        return Err(Failure::dep(format!(
            "missing profile template: {}",
            template.display()
        )));
    }
    let slug = match &chosen.kind {
        SourceKind::Store { slug, .. } => slug.clone(),
        _ => String::new(),
    };
    ctx.say("No curated profile matches; entering custom provider setup.");
    let prefix = custom_prefix(ctx);
    let default_id = if slug.is_empty() {
        String::new()
    } else {
        format!("{prefix}{slug}")
    };
    let id = loop {
        let prompt = if default_id.is_empty() {
            "Provider id (kebab-case): ".to_string()
        } else {
            format!("Provider id (kebab-case) [{default_id}]: ")
        };
        let reply = ask(&prompt)?;
        let reply = reply.trim().to_string();
        let candidate = if reply.is_empty() {
            default_id.clone()
        } else {
            reply
        };
        if valid_kebab(&candidate) {
            break candidate;
        }
        ctx.say("Use lowercase letters, digits, and single hyphens (for example: my-provider).");
    };
    let env_default = {
        let stem = id.strip_prefix(&prefix).unwrap_or(&id);
        format!("{}_API_KEY", stem.to_ascii_uppercase().replace('-', "_"))
    };
    let env = loop {
        let reply = ask(&format!("Credential env var [{env_default}]: "))?;
        let reply = reply.trim().to_string();
        let candidate = if reply.is_empty() {
            env_default.clone()
        } else {
            reply
        };
        if valid_env_name(&candidate) {
            break candidate;
        }
        ctx.say("Use letters, digits, and underscores; start with a letter or underscore.");
    };
    let host = loop {
        let reply = ask("Endpoint host (for example api.example.com): ")?;
        let candidate = reply.trim().to_string();
        if valid_host(&candidate) {
            break candidate;
        }
        ctx.say("Enter a hostname such as api.example.com.");
    };
    let path = loop {
        let reply = ask("API path prefix (optional, for example /v1): ")?;
        let candidate = reply.trim().to_string();
        if valid_api_path(&candidate) {
            break candidate;
        }
        ctx.say("Paths must start with / and use letters, digits, . _ / * - only.");
    };
    let target = generated_dir(ctx).join(format!("{id}.yaml"));
    let mut write = true;
    if target.exists() {
        if ctx.options.yes {
            ctx.say(&format!(
                "Overwriting existing generated profile {}.",
                target.display()
            ));
        } else if confirm(&format!(
            "Profile '{}' exists. Overwrite? [y/N] ",
            target.display()
        ))? {
        } else {
            ctx.say(&format!("Keeping existing profile {}.", target.display()));
            write = false;
        }
    }
    if write {
        let template_text = fs::read_to_string(&template).map_err(|_| {
            Failure::dep(format!("failed to generate profile {}", target.display()))
        })?;
        let generated = generate_profile(&template_text, &id, &env, &host, &path, agent_name(ctx));
        let _ = fs::create_dir_all(target.parent().unwrap_or(Path::new(".")));
        fs::write(&target, generated).map_err(|_| {
            Failure::dep(format!("failed to generate profile {}", target.display()))
        })?;
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o600));
        ctx.say(&format!("Generated profile {}.", target.display()));
    }
    Ok(target)
}

fn generate_profile(
    template: &str,
    id: &str,
    env: &str,
    host: &str,
    path: &str,
    agent: &str,
) -> String {
    let mut out = String::new();
    for line in template.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("id:") {
            out.push_str(&format!("id: {id}\n"));
        } else if trimmed.starts_with("display_name:") {
            out.push_str(&format!("display_name: {id}\n"));
        } else if trimmed.starts_with("description:") {
            out.push_str(&format!(
                "description: Custom inference API for the {agent} coding agent\n"
            ));
        } else if line.trim_start().starts_with("env_vars:") && line.contains('[') {
            let at = line.find('[').unwrap_or(0);
            let end = line.find(']').unwrap_or(line.len());
            out.push_str(&line[..at]);
            out.push_str(&format!("[{env}]"));
            out.push_str(&line[end + 1..]);
            out.push('\n');
        } else if line.trim_start().starts_with("- host:") {
            out.push_str(&format!("  - host: {host}\n"));
            if !path.is_empty() {
                out.push_str(&format!("    path: {path}\n"));
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

const CX_PROVIDER: &str = "codex-chatgpt";
const CX_TOKEN_ENV: &str = "CODEX_CHATGPT_TOKEN";
const CX_REFRESH_ENV: &str = "CODEX_OSS_REFRESH_TOKEN";

static LOGIN_PID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
static LOGIN_SIGNAL: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

extern "C" fn login_signal(signal: libc::c_int) {
    LOGIN_SIGNAL.store(signal, std::sync::atomic::Ordering::Relaxed);
    let pid = LOGIN_PID.load(std::sync::atomic::Ordering::Relaxed);
    if pid > 0 {
        unsafe {
            libc::kill(pid, signal);
        }
    }
}

fn b64url_decode(value: &str) -> Option<Vec<u8>> {
    let mut bits = 0u32;
    let mut width = 0u32;
    let mut bytes = Vec::new();
    for character in value.chars() {
        let digit = match character {
            'A'..='Z' => character as u32 - 'A' as u32,
            'a'..='z' => character as u32 - 'a' as u32 + 26,
            '0'..='9' => character as u32 - '0' as u32 + 52,
            '-' => 62,
            '_' => 63,
            '=' => continue,
            _ => return None,
        };
        bits = (bits << 6) | digit;
        width += 6;
        if width >= 8 {
            width -= 8;
            bytes.push((bits >> width) as u8);
            bits &= (1 << width) - 1;
        }
    }
    Some(bytes)
}

fn jwt_payload(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = b64url_decode(payload)?;
    serde_json::from_slice(&bytes).ok()
}

fn codex_setup(ctx: &Context) -> Outcome {
    let options = &ctx.options;
    if options.from.is_some()
        || options.file.is_some()
        || options.field.is_some()
        || !options.envs.is_empty()
    {
        return Err(Failure::usage(format!(
            "{} provider setup takes no credential source: it logs in to ChatGPT on the host (codex login) and keeps the tokens on the gateway",
            ctx.program()
        )));
    }
    if !crate::state::command_in_path("codex") {
        return Err(Failure::dep(
            "codex not found on PATH; install the Codex CLI on the host (https://github.com/openai/codex/releases, or npm install -g @openai/codex)",
        ));
    }
    ctx.require_openshell()?;
    let interactive = ctx.is_interactive();
    let names = match ctx
        .openshell(&["provider", "list", "--names"])
        .stdin(Stdio::null())
        .output()
    {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).into_owned()
        }
        _ => {
            return Err(Failure::gateway(format!(
                "cannot list providers; is the gateway running? Try '{} doctor'",
                ctx.program()
            )))
        }
    };
    let exists = names.lines().any(|line| line == CX_PROVIDER);
    if exists && !options.yes {
        if !interactive {
            return Err(Failure::usage(format!(
                "provider '{CX_PROVIDER}' already exists; pass --yes to replace its login (stdin is not a terminal)"
            )));
        }
        if !confirm(&format!(
            "Provider '{CX_PROVIDER}' exists. Replace its login with a new one? [y/N] "
        ))? {
            ctx.say(&format!("Keeping provider '{CX_PROVIDER}'."));
            return Ok(());
        }
    }

    // A throwaway home: the provider gets its own login, so it never shares a
    // rotating refresh token with the host's ~/.codex session.
    let login_dir = std::env::temp_dir().join(format!(
        "{}-login.{}",
        ctx.profile.tmp_prefix,
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&login_dir);
    fs::create_dir_all(&login_dir)
        .map_err(|_| Failure::dep("cannot create a temporary login directory"))?;
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(&login_dir, fs::Permissions::from_mode(0o700));

    if options.device_auth {
        ctx.say("Device-code login must be enabled first: ChatGPT > Settings > Security.");
    } else {
        ctx.say("Logging in to ChatGPT in your browser (callback on localhost:1455)...");
    }
    let mut command = std::process::Command::new("codex");
    command.arg("login");
    if options.device_auth {
        command.arg("--device-auth");
    }
    command
        .arg("-c")
        .arg("cli_auth_credentials_store=\"file\"")
        .env("CODEX_HOME", &login_dir);
    LOGIN_SIGNAL.store(0, std::sync::atomic::Ordering::Relaxed);
    let spawned = command.spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_dir_all(&login_dir);
            return Err(Failure::dep(format!("codex login failed: {error}")));
        }
    };
    LOGIN_PID.store(child.id() as i32, std::sync::atomic::Ordering::Relaxed);
    unsafe {
        libc::signal(
            libc::SIGINT,
            login_signal as *const () as libc::sighandler_t,
        );
        libc::signal(
            libc::SIGTERM,
            login_signal as *const () as libc::sighandler_t,
        );
    }
    let status = child.wait();
    LOGIN_PID.store(0, std::sync::atomic::Ordering::Relaxed);
    unsafe {
        libc::signal(libc::SIGINT, libc::SIG_DFL);
        libc::signal(libc::SIGTERM, libc::SIG_DFL);
    }
    let signal = LOGIN_SIGNAL.load(std::sync::atomic::Ordering::Relaxed);
    let code = status.map(crate::process::exit_code).unwrap_or(1);
    if signal != 0 || code != 0 {
        let _ = fs::remove_dir_all(&login_dir);
        if signal != 0 {
            return Err(Failure::silent(130));
        }
        return Err(Failure::dep(format!(
            "codex login failed (exit status {code}); no provider was changed"
        )));
    }

    let auth: serde_json::Value = fs::read_to_string(login_dir.join("auth.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(serde_json::Value::Null);
    let token = |key: &str| {
        auth.get("tokens")
            .and_then(|tokens| tokens.get(key))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let access = token("access_token");
    let refresh = token("refresh_token");
    let mut account = token("account_id");
    let _ = fs::remove_dir_all(&login_dir);
    if access.is_empty() || refresh.is_empty() {
        return Err(Failure::dep(
            "the login produced no ChatGPT tokens; log in with a ChatGPT account, not an API key",
        ));
    }
    let claims = jwt_payload(&access).unwrap_or(serde_json::Value::Null);
    let client_id = claims
        .get("client_id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let exp = claims.get("exp").and_then(serde_json::Value::as_i64);
    if account.is_empty() {
        account = claims
            .get("https://api.openai.com/auth")
            .and_then(|auth| auth.get("chatgpt_account_id"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string();
    }
    let Some(exp) = exp else {
        return Err(Failure::dep(
            "cannot read the access token expiry; no provider was changed",
        ));
    };
    if client_id.is_empty() || account.is_empty() {
        return Err(Failure::dep(
            "cannot read the client ID or account ID from the login; no provider was changed",
        ));
    }

    let profile_file = ctx
        .repo_root
        .join("codex-oss")
        .join("providers")
        .join(format!("{CX_PROVIDER}.yaml"));
    ctx.say(&format!("Linting profile '{CX_PROVIDER}'..."));
    let words = ["profile", "lint", "-f", &profile_file.display().to_string()];
    let words_ref: Vec<&str> = words.iter().map(|word| word.as_ref()).collect();
    ctx.run_gateway(&words_ref)?;
    if profile_in_gateway(ctx, CX_PROVIDER) {
        ctx.say(&format!("Profile '{CX_PROVIDER}' is already imported."));
    } else {
        ctx.say(&format!("Importing profile '{CX_PROVIDER}' globally..."));
        let profile_text = profile_file.display().to_string();
        ctx.run_gateway(&["profile", "import", "-f", &profile_text, "--global"])?;
    }

    if exists {
        let update = [
            "provider".to_string(),
            "update".to_string(),
            CX_PROVIDER.to_string(),
            "--credential".to_string(),
            CX_TOKEN_ENV.to_string(),
        ];
        gateway_step_env(ctx, CX_TOKEN_ENV, &access, &update, false)?;
        let delete = [
            "provider".to_string(),
            "refresh".to_string(),
            "delete".to_string(),
            CX_PROVIDER.to_string(),
            "--credential-key".to_string(),
            CX_TOKEN_ENV.to_string(),
        ];
        let delete_words: Vec<&str> = delete.iter().map(String::as_str).collect();
        let _ = ctx
            .openshell(&delete_words)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        ctx.say(&format!("Provider '{CX_PROVIDER}' updated."));
    } else {
        let create = [
            "provider".to_string(),
            "create".to_string(),
            "--name".to_string(),
            CX_PROVIDER.to_string(),
            "--type".to_string(),
            CX_PROVIDER.to_string(),
            "--credential".to_string(),
            CX_TOKEN_ENV.to_string(),
            "--global-profile".to_string(),
        ];
        gateway_step_env(ctx, CX_TOKEN_ENV, &access, &create, false)?;
        ctx.say(&format!("Provider '{CX_PROVIDER}' created."));
    }

    let configure = [
        "provider".to_string(),
        "refresh".to_string(),
        "configure".to_string(),
        CX_PROVIDER.to_string(),
        "--credential-key".to_string(),
        CX_TOKEN_ENV.to_string(),
        "--strategy".to_string(),
        "oauth2-refresh-token".to_string(),
        "--material".to_string(),
        format!("client_id={client_id}"),
        "--secret-material-env".to_string(),
        format!("refresh_token={CX_REFRESH_ENV}"),
        "--credential-expires-at".to_string(),
        format!("{exp}000"),
    ];
    gateway_step_env(ctx, CX_REFRESH_ENV, &refresh, &configure, false)?;
    ctx.say(&format!("Gateway refresh configured for '{CX_PROVIDER}'."));

    config::set_value(ctx.profile, "account_id", &account)
        .map_err(|error| Failure::dep(format!("cannot write the config file: {error}")))?;
    let path = super::commands::remember_provider(ctx, CX_PROVIDER)?;
    ctx.say(&format!(
        "Remembered provider '{CX_PROVIDER}' and account_id in {}.",
        path.display()
    ));

    let sandbox = ctx.sandbox_name()?;
    if ctx.sandbox_phase(&sandbox)?.is_some() {
        let mut attach_now = options.attach == Some(true);
        if !attach_now && options.attach != Some(false) && interactive {
            attach_now = confirm(&format!(
                "Attach provider '{CX_PROVIDER}' to sandbox '{sandbox}'? [y/N] "
            ))?;
        }
        if attach_now {
            ctx.run_gateway(&[
                "sandbox",
                "provider",
                "attach",
                &sandbox,
                CX_PROVIDER,
                "--wait",
            ])?;
            ctx.say(&format!(
                "Provider '{CX_PROVIDER}' attached to '{sandbox}'."
            ));
        }
    } else if options.attach == Some(true) {
        ctx.warn(&format!(
            "sandbox '{sandbox}' not found; skipping attach (run '{} up' first)",
            ctx.program()
        ));
    }

    setup_hint(ctx, CX_PROVIDER);
    ctx.say("");
    ctx.say("Next steps:");
    ctx.say(&format!(
        "  start a session:   {} (from the project directory)",
        ctx.program()
    ));
    ctx.say(&format!("  check the refresh: {} doctor", ctx.program()));
    Ok(())
}

thread_local! {
    static GATEWAY_REASON: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

fn record_reason(text: &str, program: &str) {
    let mut words: Vec<String> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(&format!("{program}: openshell command failed")) {
            continue;
        }
        let line = line.strip_prefix("Error:").unwrap_or(line).trim();
        let line = line.trim_start_matches(['×', '│', '|']).trim().to_string();
        if !line.is_empty() {
            words.push(line);
        }
    }
    if !words.is_empty() {
        GATEWAY_REASON.with(|slot| *slot.borrow_mut() = Some(words.join(" ")));
    }
}

fn json_str(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for character in value.chars() {
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

fn steps_json(steps: &[&'static str]) -> String {
    let entries: Vec<String> = steps.iter().map(|step| json_str(step)).collect();
    format!("[{}]", entries.join(","))
}

fn finish_json(
    ctx: &Context,
    progress: &Progress,
    rc: i32,
    outcome: &str,
    message: &str,
    extra: Option<(&str, String)>,
) {
    let ok = if rc == 0 { "true" } else { "false" };
    let attached = progress
        .attached
        .as_ref()
        .map(|value| json_str(value))
        .unwrap_or_else(|| "null".to_string());
    let remembered = if progress.has("remembered") {
        "true"
    } else {
        "false"
    };
    let (extra_key, extra_value) = extra.unwrap_or(("", String::new()));
    let extra_field = if extra_key.is_empty() {
        String::new()
    } else {
        format!(",{extra_key}:{extra_value}")
    };
    println!(
        "{{\"ok\":{ok},\"agent\":{},\"provider\":{},\"profile\":{},\"outcome\":{},\"attached\":{attached},\"remembered\":{remembered},\"steps\":{},\"message\":{}{extra_field}}}",
        json_str(ctx.profile.tag),
        if progress.provider.is_empty() { "null".to_string() } else { json_str(&progress.provider) },
        if progress.profile.is_empty() { "null".to_string() } else { json_str(&progress.profile) },
        json_str(outcome),
        steps_json(&progress.steps),
        json_str(message),
    );
}

pub fn program(ctx: &Context, args: &[OsString]) -> Outcome {
    if ctx.options.probe {
        if !args.is_empty() {
            return Err(Failure::usage(format!(
                "usage: {} __provider-setup --probe [--json]",
                ctx.program()
            )));
        }
        if ctx.profile.name == "codex-oss" {
            return refuse_login(ctx);
        }
        return Ok(());
    }
    if !args.is_empty() {
        return Err(Failure::usage(format!(
            "usage: {} [--name SANDBOX] __provider-setup --profile ID [--provider-name NAME] [--attach] [--yes] [--json]",
            ctx.program()
        )));
    }
    if ctx.profile.name == "codex-oss" {
        return refuse_login(ctx);
    }
    if ctx
        .options
        .profile
        .as_ref()
        .is_none_or(|value| value.is_empty())
    {
        return Err(Failure::usage("__provider-setup needs --profile ID"));
    }
    if ctx.options.attach == Some(true) && ctx.options.name.is_none() {
        return Err(Failure::usage(
            "__provider-setup --attach needs --name SANDBOX",
        ));
    }
    let mut progress = Progress::default();
    ctx.gateway_stdout_to_stderr.set(true);
    match run_setup(ctx, &mut progress, true) {
        Ok(()) => {
            let outcome = if progress.has("updated") {
                "updated"
            } else {
                "created"
            };
            let message = progress.done_text();
            if ctx.options.json {
                finish_json(ctx, &progress, 0, outcome, &message, None);
            } else {
                println!("{message}");
            }
            Ok(())
        }
        Err(failure) => {
            let reason = failure
                .lines
                .first()
                .cloned()
                .unwrap_or_else(|| format!("stopped with exit status {}", failure.code));
            if progress.mutated() {
                let gateway = GATEWAY_REASON
                    .with(|slot| slot.borrow_mut().take())
                    .unwrap_or(reason);
                let message = format!(
                    "{}; {} failed: {gateway}",
                    progress.done_text(),
                    progress.doing
                );
                if ctx.options.json {
                    finish_json(ctx, &progress, 3, "failed", &message, None);
                }
                ctx.err_line(&message);
                return Err(Failure::silent(3));
            }
            let message = format!("{reason}; nothing changed");
            let rc = if failure.code == super::cli::EX_USAGE {
                1
            } else {
                2
            };
            if ctx.options.json {
                finish_json(ctx, &progress, rc, "refused", &message, None);
            }
            ctx.err_line(&message);
            Err(Failure::silent(rc))
        }
    }
}

fn refuse_login(ctx: &Context) -> Outcome {
    let message = format!(
        "{} provider setup is a login on the host and needs a terminal; run '{} provider setup' there",
        ctx.program(),
        ctx.program()
    );
    if ctx.options.json {
        let agent = json_str(ctx.profile.tag);
        let command = json_str(&format!("{} provider setup", ctx.program()));
        let text = json_str(&message);
        println!(
            "{{\"ok\":false,\"agent\":{agent},\"provider\":null,\"profile\":null,\"outcome\":\"refused\",\"attached\":null,\"remembered\":false,\"steps\":[],\"command\":{command},\"message\":{text}}}"
        );
    }
    ctx.err_line(&message);
    Err(Failure::silent(2))
}

/// `osa providers` / `osa providers --json`: setup kind, curated and custom
/// profiles, the gateway's providers, and the remembered names.
pub fn providers_report(ctx: &Context, args: &[OsString], text: bool) -> Outcome {
    if !args.is_empty() {
        return Err(Failure::usage(format!(
            "usage: {} __providers-json",
            ctx.program()
        )));
    }
    let setup = if ctx.profile.name == "codex-oss" {
        "login"
    } else {
        "stdin"
    };
    let command = format!("{} provider setup", ctx.program());
    let gateway = if !crate::state::command_in_path("openshell") {
        Err("openshell CLI not found on PATH".to_string())
    } else {
        match ctx
            .openshell(&["provider", "list", "--names"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        {
            Ok(output) if output.status.success() => Ok(String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::to_string)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()),
            _ => Err(format!(
                "cannot list providers; is the gateway running? Try '{} doctor'",
                ctx.program()
            )),
        }
    };
    let profiles = setup_profiles(ctx);
    let remembered: Vec<String> = ctx
        .config
        .get("providers")
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();

    if text {
        print!("{} ({}): setup {setup}", ctx.profile.tag, ctx.program());
        if setup == "login" {
            print!("; run '{command}' in a terminal");
        }
        println!();
        match &gateway {
            Ok(names) => println!("  gateway:    {}", names.join(", ")),
            Err(error) => println!("  gateway:    error: {error}"),
        }
        println!("  remembered: {}", remembered.join(", "));
        println!("  profiles:");
    } else {
        print!(
            "{{\"agent\":{},\"setup\":{},\"command\":{},\"profiles\":[",
            json_str(ctx.profile.tag),
            json_str(setup),
            json_str(&command)
        );
    }
    let mut separator = "";
    for (id, source, file) in &profiles {
        let env = profile_env_var(file).unwrap_or_default();
        let note = if env.is_empty() {
            "unreadable profile".to_string()
        } else {
            profile_note(ctx, id)
        };
        if text {
            println!(
                "    {:<32} {:<24} {:<8} {}",
                id,
                if env.is_empty() { "-" } else { &env },
                source,
                note
            );
            continue;
        }
        print!(
            "{separator}{{\"id\":{},\"env\":{},\"source\":{},\"note\":{}}}",
            json_str(id),
            if env.is_empty() {
                "null".to_string()
            } else {
                json_str(&env)
            },
            json_str(source),
            if note.is_empty() {
                "null".to_string()
            } else {
                json_str(&note)
            },
        );
        separator = ",";
    }
    if text {
        return Ok(());
    }
    print!("],\"gateway\":");
    match &gateway {
        Ok(names) => {
            let entries: Vec<String> = names.iter().map(|name| json_str(name)).collect();
            print!("[{}]", entries.join(","));
        }
        Err(error) => print!("{{\"error\":{{\"message\":{}}}}}", json_str(error)),
    }
    let entries: Vec<String> = remembered.iter().map(|name| json_str(name)).collect();
    println!(",\"remembered\":[{}]}}", entries.join(","));
    Ok(())
}

fn setup_profiles(ctx: &Context) -> Vec<(String, &'static str, PathBuf)> {
    let curated = profiles_dir(ctx);
    let generated = generated_dir(ctx);
    let mut profiles = Vec::new();
    let mut curated_ids = Vec::new();
    if let Ok(entries) = fs::read_dir(&curated) {
        let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        paths.sort();
        for path in paths {
            if path.extension().is_none_or(|ext| ext != "yaml") {
                continue;
            }
            let id = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            if id == "template" || !valid_kebab(&id) {
                continue;
            }
            curated_ids.push(id.clone());
            profiles.push((id, "curated", path));
        }
    }
    if let Ok(entries) = fs::read_dir(&generated) {
        let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        paths.sort();
        for path in paths {
            if path.extension().is_none_or(|ext| ext != "yaml") {
                continue;
            }
            let id = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            if !valid_kebab(&id) || curated_ids.contains(&id) {
                continue;
            }
            profiles.push((id, "custom", path));
        }
    }
    profiles
}

fn profile_note(ctx: &Context, id: &str) -> String {
    let (path, id_column, note_column) = match ctx.profile.name {
        "maki-oss" => (profiles_dir(ctx).join("catalog.tsv"), 2, 3),
        "opencode-oss" => (profiles_dir(ctx).join("catalog.tsv"), 0, 4),
        _ => (profiles_dir(ctx).join("catalog.tsv"), 0, 3),
    };
    let Ok(text) = fs::read_to_string(path) else {
        return String::new();
    };
    for line in text.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.get(id_column) == Some(&id) {
            return fields.get(note_column).unwrap_or(&"").to_string();
        }
    }
    String::new()
}
