//! `doctor` and the MCP readiness report: the prerequisite checks, the
//! per-agent extras, and the per-server gate table shared by `mcp status`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::agents;
use super::commands::json_str;
use super::context::Context;
use super::failure::{Failure, Outcome};

struct Check {
    status: &'static str,
    name: String,
    detail: String,
}

struct Doctor {
    status: i32,
    have_openshell: bool,
    gateway_ok: bool,
    engine_ok: bool,
    checks: Vec<Check>,
    print: bool,
}

impl Doctor {
    fn check(&mut self, status: &'static str, name: &str, detail: &str) {
        if self.print {
            println!("{status:<5} {name}: {detail}");
        }
        self.checks.push(Check {
            status,
            name: name.to_string(),
            detail: detail.to_string(),
        });
    }
}

#[derive(Debug, Clone)]
struct McpServer {
    name: String,
    transport: String,
    enabled: bool,
    host: String,
    argv0: String,
}

struct McpProfile {
    host: PathBuf,
    sandbox: String,
    provider_prefix: &'static str,
    requires_jq: bool,
    fix_image: &'static str,
    fix_doc: &'static str,
}

fn mcp_profile(ctx: &Context) -> McpProfile {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into()));
    match ctx.profile.name {
        "maki-oss" => McpProfile {
            host: home.join(".config/maki/mcp.toml"),
            sandbox: "/sandbox/.config/maki/mcp.toml".into(),
            provider_prefix: "mcp-",
            requires_jq: false,
            fix_image: "an environment image",
            fix_doc: "docs/ai/environment-playbook.md",
        },
        "opencode-oss" => McpProfile {
            host: home.join(".config/opencode/opencode.json"),
            sandbox: "/sandbox/.config/opencode/opencode.json".into(),
            provider_prefix: "opencode-mcp-",
            requires_jq: true,
            fix_image: "an environment image built FROM opencode-agent:local",
            fix_doc: "docs/ai/reference/opencode.md",
        },
        "claude-oss" => McpProfile {
            host: std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or(home)
                .join(".claude.json"),
            sandbox: "/sandbox/.claude.json".into(),
            provider_prefix: "claude-mcp-",
            requires_jq: true,
            fix_image: "an environment image built FROM claude-agent:local",
            fix_doc: "docs/ai/reference/claude.md",
        },
        _ => McpProfile {
            host: std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"))
                .join("config.toml"),
            sandbox: "/sandbox/.codex/config.toml".into(),
            provider_prefix: "codex-mcp-",
            requires_jq: false,
            fix_image: "an environment image built FROM codex-agent:local",
            fix_doc: "docs/ai/reference/codex.md",
        },
    }
}

pub fn doctor(ctx: &Context) -> Outcome {
    let doctor = collect_doctor(ctx, true)?;
    doctor_mcp_section(ctx, &doctor);
    if doctor.status == 0 {
        Ok(())
    } else {
        Err(Failure::silent(doctor.status))
    }
}

fn collect_doctor(ctx: &Context, print: bool) -> Result<Doctor, Failure> {
    if !crate::state::command_in_path("jq") {
        ctx.warn("jq not found; falling back to grep-based parsing");
    }
    let mut doctor = Doctor {
        status: 0,
        have_openshell: false,
        gateway_ok: false,
        engine_ok: false,
        checks: Vec::new(),
        print,
    };

    let openshell = find_in_path("openshell");
    match &openshell {
        Some(path) => {
            doctor.check("ok", "openshell CLI", &path.to_string_lossy());
            doctor.have_openshell = true;
        }
        None => {
            doctor.check("fail", "openshell CLI", "not found on PATH");
            doctor.status = super::cli::EX_DEP;
        }
    }

    if doctor.have_openshell {
        let status = ctx
            .openshell(&["status", "--output", "json"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        match status {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout);
                let connected = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("status")
                            .and_then(|value| value.as_str())
                            .map(str::to_string)
                    })
                    .unwrap_or_default();
                if connected == "connected" {
                    doctor.check("ok", "gateway", "connected");
                    doctor.gateway_ok = true;
                } else {
                    let shown = if connected.is_empty() {
                        "unknown"
                    } else {
                        &connected
                    };
                    doctor.check(
                        "fail",
                        "gateway",
                        &format!("not connected (status: {shown})"),
                    );
                    if doctor.status == 0 {
                        doctor.status = super::cli::EX_GATEWAY;
                    }
                }
            }
            _ => {
                doctor.check("fail", "gateway", "unreachable (openshell status failed)");
                if doctor.status == 0 {
                    doctor.status = super::cli::EX_GATEWAY;
                }
            }
        }
    } else {
        doctor.check("skip", "gateway", "openshell CLI unavailable");
    }

    let engine = ctx.engine();
    match find_in_path(&engine) {
        Some(path) => {
            let running = Command::new(&engine)
                .arg("version")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
            if running {
                doctor.check(
                    "ok",
                    "container engine",
                    &format!("{engine} ({})", path.to_string_lossy()),
                );
                doctor.engine_ok = true;
            } else {
                doctor.check(
                    "fail",
                    "container engine",
                    &format!("{engine} is installed but not running"),
                );
                doctor.status = super::cli::EX_DEP;
            }
        }
        None => {
            doctor.check(
                "fail",
                "container engine",
                &format!("{engine} not found on PATH"),
            );
            doctor.status = super::cli::EX_DEP;
        }
    }

    let image = ctx.image();
    let image_present = doctor.engine_ok
        && Command::new(&engine)
            .args(["image", "inspect", &image])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
    if image_present {
        doctor.check("ok", "image", &format!("{image} present"));
    } else {
        doctor.check(
            "fail",
            "image",
            &format!(
                "{image} not found (build it: {} image build)",
                ctx.program()
            ),
        );
        doctor.status = super::cli::EX_DEP;
    }

    let policy = ctx.policy();
    if Path::new(&policy).is_file() {
        doctor.check("ok", "policy file", &policy);
    } else {
        doctor.check("fail", "policy file", &format!("{policy} not found"));
        doctor.status = super::cli::EX_DEP;
    }

    let providers = ctx.providers();
    if !doctor.have_openshell {
        doctor.check("skip", "providers", "openshell CLI unavailable");
    } else if providers.is_empty() {
        doctor.check("ok", "providers", "none configured");
    } else {
        let known = provider_names(ctx).unwrap_or_default();
        let mut missing = String::new();
        for provider in &providers {
            if provider.is_empty() {
                continue;
            }
            if !known.iter().any(|name| name == provider) {
                missing.push(' ');
                missing.push_str(provider);
            }
        }
        if missing.is_empty() {
            doctor.check("ok", "providers", &providers.join(" "));
        } else {
            doctor.check("fail", "providers", &format!("not found:{missing}"));
            if doctor.status == 0 {
                doctor.status = super::cli::EX_GATEWAY;
            }
        }
    }

    doctor_extra(ctx, &mut doctor)?;
    Ok(doctor)
}

fn doctor_extra(ctx: &Context, doctor: &mut Doctor) -> Result<(), Failure> {
    match ctx.profile.name {
        "opencode-oss" => {
            let model = ctx.model();
            if model.is_empty() {
                doctor.check(
                    "warn",
                    "model",
                    &format!(
                        "none set; OpenCode's default may be a model no attached profile covers (set model = \"provider/model\" in {})",
                        ctx.profile.config_path().display()
                    ),
                );
            } else {
                doctor.check("ok", "model", &model);
            }
        }
        "claude-oss" => {
            let model = ctx.model();
            if model.is_empty() {
                doctor.check("ok", "model", "Claude Code's default");
            } else {
                doctor.check("ok", "model", &model);
            }
            if doctor.gateway_ok {
                if let Ok(name) = ctx.sandbox_name() {
                    if let Ok(attached) = ctx.attached_providers(&name) {
                        if attached.iter().any(|value| value == "claude-anthropic")
                            && attached
                                .iter()
                                .any(|value| value == "claude-anthropic-oauth")
                        {
                            doctor.check(
                                "warn",
                                "credentials",
                                &format!(
                                    "claude-anthropic and claude-anthropic-oauth are both attached to '{name}'; Claude Code uses the API key (claude-anthropic), not the subscription; detach one: openshell sandbox provider detach {name} <provider>"
                                ),
                            );
                        }
                    }
                }
            }
        }
        "codex-oss" => {
            let model = ctx.model();
            if model.is_empty() {
                doctor.check("ok", "model", "Codex's default");
            } else {
                doctor.check("ok", "model", &model);
            }
            let account = ctx
                .profile
                .env_setting("ACCOUNT_ID")
                .or_else(|| ctx.config.get("account_id").map(str::to_string))
                .unwrap_or_default();
            if account.is_empty() {
                doctor.check(
                    "warn",
                    "account",
                    &format!(
                        "no ChatGPT account ID; run '{} provider setup'",
                        ctx.program()
                    ),
                );
            } else {
                doctor.check("ok", "account", "ChatGPT account ID configured");
            }
            codex_refresh(ctx, doctor);
        }
        _ => {
            if agents::resolved_tui(ctx)? == "opencode" {
                match find_in_path("bun") {
                    Some(path) => doctor.check("ok", "bun", &path.to_string_lossy()),
                    None => {
                        doctor.check(
                            "fail",
                            "bun",
                            "not found on PATH (required by tui = \"opencode\")",
                        );
                        doctor.status = super::cli::EX_DEP;
                    }
                }
                match find_in_path("opencode") {
                    Some(path) => doctor.check("ok", "opencode", &path.to_string_lossy()),
                    None => {
                        doctor.check(
                            "fail",
                            "opencode",
                            "not found on PATH (required by tui = \"opencode\")",
                        );
                        doctor.status = super::cli::EX_DEP;
                    }
                }
                let bridge = ctx.repo_root.join("bridge/src/bridge.ts");
                if bridge.is_file() {
                    doctor.check("ok", "bridge entrypoint", &bridge.to_string_lossy());
                } else {
                    doctor.check(
                        "fail",
                        "bridge entrypoint",
                        &format!("{} not found", bridge.display()),
                    );
                    doctor.status = super::cli::EX_DEP;
                }
            }
        }
    }
    Ok(())
}

fn codex_refresh(ctx: &Context, doctor: &mut Doctor) {
    if !doctor.gateway_ok {
        return;
    }
    let known = provider_names(ctx).unwrap_or_default();
    if !known.iter().any(|name| name == "codex-chatgpt") {
        return;
    }
    let output = ctx
        .openshell(&["provider", "refresh", "status", "codex-chatgpt"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    let text = output
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    let mut row = None;
    for line in text.lines() {
        let fields: Vec<&str> = line
            .split("  ")
            .map(str::trim)
            .filter(|field| !field.is_empty())
            .collect();
        if fields.get(1) == Some(&"CODEX_CHATGPT_TOKEN") {
            row = Some((
                fields.get(3).copied().unwrap_or("").to_string(),
                fields.get(5).copied().unwrap_or("").to_string(),
                fields.get(7).copied().unwrap_or("").to_string(),
                fields.get(8).copied().unwrap_or("").to_string(),
            ));
            break;
        }
    }
    let Some((state, expires, last, failure)) = row else {
        doctor.check(
            "warn",
            "refresh",
            &format!(
                "codex-chatgpt has no gateway refresh; run '{} provider setup' again",
                ctx.program()
            ),
        );
        return;
    };
    if state.contains("fail") || state.contains("error") {
        let failure = if failure.is_empty() || failure == "-" {
            "-"
        } else {
            &failure
        };
        doctor.check(
            "warn",
            "refresh",
            &format!(
                "codex-chatgpt last refresh failed ({state}, {failure}); run '{} provider setup' again",
                ctx.program()
            ),
        );
        return;
    }
    if !failure.is_empty() && failure != "-" {
        doctor.check(
            "warn",
            "refresh",
            &format!(
                "codex-chatgpt last refresh failed ({failure}); run '{} provider setup' again",
                ctx.program()
            ),
        );
        return;
    }
    let Some(expires_s) = epoch(&expires) else {
        doctor.check(
            "ok",
            "refresh",
            &format!("codex-chatgpt {state} (expiry not reported)"),
        );
        return;
    };
    if let Some(last_s) = epoch(&last) {
        let lead = refresh_lead(ctx);
        if expires_s - last_s <= lead {
            doctor.check(
                "warn",
                "refresh",
                &format!(
                    "the gateway recorded codex-chatgpt as expiring {}s after its last refresh, within the {lead}s lead time, so it refreshes continuously; see 'Refresh' in codex-oss/README.md",
                    expires_s - last_s
                ),
            );
            return;
        }
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    if expires_s - now < 86400 {
        doctor.check(
            "warn",
            "refresh",
            &format!("codex-chatgpt expires {expires} UTC, in under 24 hours"),
        );
        return;
    }
    doctor.check(
        "ok",
        "refresh",
        &format!("codex-chatgpt {state}, expires {expires} UTC"),
    );
}

fn refresh_lead(ctx: &Context) -> i64 {
    let path = ctx.repo_root.join("codex-oss/providers/codex-chatgpt.yaml");
    let Ok(text) = std::fs::read_to_string(path) else {
        return 0;
    };
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("refresh_before:") else {
            continue;
        };
        let value = rest.trim().trim_matches('"');
        let (number, unit) = match value.chars().last() {
            Some(last @ ('s' | 'm' | 'h')) => (&value[..value.len() - 1], Some(last)),
            _ => (value, None),
        };
        let Ok(number) = number.parse::<i64>() else {
            continue;
        };
        return match unit {
            Some('m') => number * 60,
            Some('h') => number * 3600,
            _ => number,
        };
    }
    0
}

fn epoch(value: &str) -> Option<i64> {
    let parts: Vec<&str> = value.split(['-', ' ', ':']).collect();
    if parts.len() != 6 {
        return None;
    }
    let numbers: Vec<i64> = parts
        .iter()
        .map(|part| part.parse::<i64>().ok())
        .collect::<Option<Vec<_>>>()?;
    let (year, month, day, hour, minute, second) = (
        numbers[0], numbers[1], numbers[2], numbers[3], numbers[4], numbers[5],
    );
    if !(1970..=9999).contains(&year) {
        return None;
    }
    Some(days_from_civil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146097 + day_of_era - 719468
}

pub fn mcp_status(ctx: &Context) -> Outcome {
    ctx.require_openshell()?;
    let profile = mcp_profile(ctx);
    if profile.requires_jq && !crate::state::command_in_path("jq") {
        let file = profile
            .host
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        return Err(Failure::dep(format!(
            "mcp status needs jq to read {}; install jq",
            file.unwrap_or_else(|| "the agent config".to_string())
        )));
    }
    let name = ctx.sandbox_name()?;
    if ctx.sandbox_phase(&name)?.is_none() {
        ctx.say(&format!(
            "No sandbox '{name}' for this project; run '{} up' first.",
            ctx.program()
        ));
        return Ok(());
    }
    ctx.say(&format!("MCP readiness for sandbox '{name}':"));
    let readiness = match collect_readiness(ctx, &name, &profile) {
        Ok(readiness) => readiness,
        Err(_) => {
            return Err(Failure::gateway(format!(
                "cannot read MCP readiness from the gateway; try '{} doctor'",
                ctx.program()
            )))
        }
    };
    render_readiness(&readiness);
    if !readiness.any {
        ctx.say("  no MCP servers configured (host or sandbox declares no enabled server).");
        return Ok(());
    }
    if readiness.failed > 0 {
        return Err(Failure::silent(super::cli::EX_GATEWAY));
    }
    Ok(())
}

fn doctor_mcp_section(ctx: &Context, doctor: &Doctor) {
    let profile = mcp_profile(ctx);
    println!();
    println!("MCP readiness (informational):");
    if profile.requires_jq && !crate::state::command_in_path("jq") {
        println!("  skipped: jq not found");
        return;
    }
    if !doctor.have_openshell || !doctor.gateway_ok {
        println!("  skipped (gateway unavailable)");
        return;
    }
    let Ok(name) = ctx.sandbox_name() else {
        return;
    };
    match ctx.sandbox_phase(&name) {
        Ok(None) => {
            println!("  no sandbox '{name}' (run '{} up' first)", ctx.program());
        }
        Ok(Some(_)) => match collect_readiness(ctx, &name, &profile) {
            Err(_) => println!("  cannot read MCP readiness from the gateway"),
            Ok(readiness) => {
                render_readiness(&readiness);
                if !readiness.any {
                    println!("  none configured");
                }
            }
        },
        Err(_) => println!("  cannot read MCP readiness from the gateway"),
    }
}

struct Gate {
    name: &'static str,
    status: &'static str,
    fix: Option<String>,
}

struct ServerReport {
    name: String,
    transport: String,
    gates: Vec<Gate>,
}

struct Readiness {
    any: bool,
    failed: i32,
    errors: Vec<String>,
    servers: Vec<ServerReport>,
}

fn render_readiness(readiness: &Readiness) {
    for error in &readiness.errors {
        println!("  unreadable: {error}");
    }
    for server in &readiness.servers {
        let mut line = format!("  {}:", server.name);
        for gate in &server.gates {
            line.push_str(&format!(" {}={}", gate.name, gate.status));
        }
        line.push_str(&format!(" transport={}", server.transport));
        println!("{line}");
        for gate in &server.gates {
            if let Some(fix) = &gate.fix {
                println!("    fix: {fix}");
            }
        }
    }
}

fn collect_readiness(
    ctx: &Context,
    name: &str,
    profile: &McpProfile,
) -> Result<Readiness, Failure> {
    let host_result = parse_servers(ctx, &profile.host);
    let sandbox_text = sandbox_cat(ctx, name, &profile.sandbox).unwrap_or_default();
    let sandbox_result = parse_sandbox_servers(ctx, &sandbox_text);

    if host_result.is_err() || sandbox_result.is_err() {
        let mut errors = Vec::new();
        if host_result.is_err() {
            errors.push(format!(
                "host config {} (cannot parse it)",
                profile.host.display()
            ));
        }
        if sandbox_result.is_err() {
            errors.push(format!(
                "sandbox config {} (cannot parse it)",
                profile.sandbox
            ));
        }
        return Ok(Readiness {
            any: true,
            failed: 1,
            errors,
            servers: Vec::new(),
        });
    }
    let host = host_result.unwrap_or_default();
    let sandbox = sandbox_result.unwrap_or_default();
    let attached = ctx.attached_providers(name)?;

    let policy = ctx
        .openshell(&["policy", "get", name, "--full"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();

    let mut names: Vec<String> = Vec::new();
    for server in host.iter().chain(sandbox.iter()) {
        if server.enabled && !names.contains(&server.name) {
            names.push(server.name.clone());
        }
    }
    let mut readiness = Readiness {
        any: !names.is_empty(),
        failed: 0,
        errors: Vec::new(),
        servers: Vec::new(),
    };
    for server_name in names {
        let host_server = host.iter().find(|server| server.name == server_name);
        let sandbox_server = sandbox.iter().find(|server| server.name == server_name);
        let sandbox_gate = if sandbox_server.is_some() {
            "ok"
        } else {
            "missing"
        };
        let endpoint_host = sandbox_server
            .or(host_server)
            .map(|server| server.host.clone())
            .unwrap_or_default();
        let provider = format!("{}{}", profile.provider_prefix, server_name);
        let transport = if host_server
            .into_iter()
            .chain(sandbox_server)
            .any(|server| server.transport == "http")
        {
            "http"
        } else {
            "stdio"
        };
        let provider_gate = if attached.iter().any(|value| value == &provider) {
            "ok"
        } else {
            "missing"
        };

        let mut gates: Vec<Gate> = Vec::new();
        if transport == "stdio" {
            let argv0 = sandbox_server
                .or(host_server)
                .map(|server| server.argv0.clone())
                .unwrap_or_default();
            let runtime_gate = if !argv0.is_empty() && sandbox_probe(ctx, name, &argv0) {
                "ok"
            } else {
                "missing"
            };
            let fix = if sandbox_gate == "missing" {
                Some(format!(
                    "build and select {} that declares '{server_name}' (see {})",
                    profile.fix_image, profile.fix_doc
                ))
            } else {
                None
            };
            gates.push(Gate {
                name: "sandbox",
                status: sandbox_gate,
                fix,
            });
            let fix = if runtime_gate == "missing" && sandbox_gate == "ok" {
                Some(format!(
                    "build and select {} that provides the runtime '{argv0}' for '{server_name}' (see {})",
                    profile.fix_image, profile.fix_doc
                ))
            } else {
                None
            };
            gates.push(Gate {
                name: "runtime",
                status: runtime_gate,
                fix,
            });
            let fix = if provider_gate == "missing" {
                Some(format!("{} provider attach {provider}", ctx.program()))
            } else {
                None
            };
            gates.push(Gate {
                name: "provider",
                status: provider_gate,
                fix,
            });
        } else {
            let endpoint_gate = if endpoint_host.is_empty() || !policy.contains(&endpoint_host) {
                "missing"
            } else {
                "ok"
            };
            let fix = if sandbox_gate == "missing" {
                Some(format!(
                    "build and select {} that declares '{server_name}' (see {})",
                    profile.fix_image, profile.fix_doc
                ))
            } else {
                None
            };
            gates.push(Gate {
                name: "sandbox",
                status: sandbox_gate,
                fix,
            });
            let fix = if provider_gate == "missing" {
                Some(format!("{} provider attach {provider}", ctx.program()))
            } else {
                None
            };
            gates.push(Gate {
                name: "provider",
                status: provider_gate,
                fix,
            });
            let fix = if endpoint_gate == "missing" {
                Some(format!(
                    "the endpoint for '{endpoint_host}' comes from the provider profile; run '{} provider attach {provider}' or import a profile that declares it",
                    ctx.program()
                ))
            } else {
                None
            };
            gates.push(Gate {
                name: "endpoint",
                status: endpoint_gate,
                fix,
            });
        }
        if gates.iter().any(|gate| gate.status != "ok") {
            readiness.failed += 1;
        }
        readiness.servers.push(ServerReport {
            name: server_name,
            transport: transport.to_string(),
            gates,
        });
    }
    Ok(readiness)
}

fn parse_servers(ctx: &Context, path: &Path) -> Result<Vec<McpServer>, ()> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path).map_err(|_| ())?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    match ctx.profile.name {
        "maki-oss" => Ok(toml_servers(&text, "[mcp.", "command")),
        "opencode-oss" => json_servers(&text, "mcp", true),
        "claude-oss" => json_servers(&text, "mcpServers", false),
        _ => codex_toml_servers(&text),
    }
}

fn parse_sandbox_servers(ctx: &Context, text: &str) -> Result<Vec<McpServer>, ()> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    match ctx.profile.name {
        "maki-oss" => Ok(toml_servers(text, "[mcp.", "command")),
        "opencode-oss" => json_servers(text, "mcp", true),
        "claude-oss" => json_servers(text, "mcpServers", false),
        _ => codex_toml_servers(text),
    }
}

fn json_servers(text: &str, key: &str, opencode: bool) -> Result<Vec<McpServer>, ()> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| ())?;
    let Some(map) = value.get(key).and_then(|value| value.as_object()) else {
        return Ok(Vec::new());
    };
    let mut servers = Vec::new();
    for (name, entry) in map {
        let kind = entry.get("type").and_then(|value| value.as_str());
        let url = entry
            .get("url")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let transport = if (opencode && kind == Some("remote"))
            || (!opencode && matches!(kind, Some("http") | Some("sse")))
            || !url.is_empty()
        {
            "http"
        } else if entry.get("command").is_some() {
            "stdio"
        } else {
            "unknown"
        };
        let enabled = entry
            .get("enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let host = host_from_url(url);
        let argv0 = match entry.get("command") {
            Some(serde_json::Value::Array(values)) => values
                .first()
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            Some(serde_json::Value::String(value)) => value.clone(),
            _ => String::new(),
        };
        servers.push(McpServer {
            name: name.clone(),
            transport: transport.to_string(),
            enabled,
            host,
            argv0,
        });
    }
    Ok(servers)
}

fn toml_servers(text: &str, prefix: &str, command_key: &str) -> Vec<McpServer> {
    let mut servers = Vec::new();
    let mut current: Option<(String, String, String, bool)> = None;
    let flush = |current: &mut Option<(String, String, String, bool)>,
                 servers: &mut Vec<McpServer>| {
        if let Some((name, url, command, enabled)) = current.take() {
            let transport = if !url.is_empty() {
                "http"
            } else if !command.is_empty() {
                "stdio"
            } else {
                "unknown"
            };
            servers.push(McpServer {
                name,
                transport: transport.to_string(),
                enabled,
                host: host_from_url(&url),
                argv0: command,
            });
        }
    };
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') {
            flush(&mut current, &mut servers);
            if let Some(rest) = trimmed.strip_prefix(prefix) {
                let name = rest
                    .split(']')
                    .next()
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                current = Some((name, String::new(), String::new(), true));
            } else {
                current = None;
            }
            continue;
        }
        let Some((name, url, command, enabled)) = current.as_mut() else {
            continue;
        };
        let _ = name;
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key == "url" {
            *url = unquote(value);
        } else if key == command_key {
            *command = first_array_word(value);
        } else if key == "enabled" {
            *enabled = unquote(value) != "false";
        }
    }
    flush(&mut current, &mut servers);
    servers
}

fn codex_toml_servers(text: &str) -> Result<Vec<McpServer>, ()> {
    let mut servers = Vec::new();
    let mut current: Option<(String, String, String, bool)> = None;
    let mut in_root = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("mcp_servers") && trimmed.contains('=') {
            return Err(());
        }
        if trimmed.starts_with('[') {
            if let Some((name, url, command, enabled)) = current.take() {
                servers.push(McpServer {
                    name,
                    transport: if !url.is_empty() {
                        "http".to_string()
                    } else if !command.is_empty() {
                        "stdio".to_string()
                    } else {
                        "unknown".to_string()
                    },
                    enabled,
                    host: host_from_url(&url),
                    argv0: command,
                });
            }
            let header = trimmed.trim_start_matches('[').trim_end_matches(']').trim();
            if header == "mcp_servers" {
                in_root = true;
                continue;
            }
            in_root = false;
            if let Some(rest) = header.strip_prefix("mcp_servers.") {
                let name = rest.split('.').next().unwrap_or("").trim_matches('"');
                current = Some((name.to_string(), String::new(), String::new(), true));
            }
            continue;
        }
        if in_root && trimmed.contains('=') {
            return Err(());
        }
        let Some((_, url, command, enabled)) = current.as_mut() else {
            continue;
        };
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        match key.trim() {
            "url" => *url = unquote(value.trim()),
            "command" => *command = unquote(value.trim()),
            "enabled" => *enabled = unquote(value.trim()) != "false",
            _ => {}
        }
    }
    if let Some((name, url, command, enabled)) = current.take() {
        servers.push(McpServer {
            name,
            transport: if !url.is_empty() {
                "http".to_string()
            } else if !command.is_empty() {
                "stdio".to_string()
            } else {
                "unknown".to_string()
            },
            enabled,
            host: host_from_url(&url),
            argv0: command,
        });
    }
    Ok(servers)
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''))
    {
        value[1..value.len().saturating_sub(1)].to_string()
    } else {
        value.to_string()
    }
}

fn first_array_word(value: &str) -> String {
    let value = value.trim();
    let value = value.strip_prefix('[').unwrap_or(value);
    let first = value.split(',').next().unwrap_or("");
    unquote(first.trim().trim_end_matches(']').trim())
}

fn host_from_url(url: &str) -> String {
    let mut host = url;
    if let Some((_, rest)) = host.split_once("://") {
        host = rest;
    }
    host.split(['/', ':', '?']).next().unwrap_or("").to_string()
}

fn sandbox_cat(ctx: &Context, name: &str, path: &str) -> Option<String> {
    let output = ctx
        .openshell(&[
            "sandbox",
            "exec",
            "-n",
            name,
            "--no-login-shell",
            "--",
            "cat",
            path,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn sandbox_probe(ctx: &Context, name: &str, program: &str) -> bool {
    ctx.openshell(&[
        "sandbox",
        "exec",
        "-n",
        name,
        "--no-login-shell",
        "--",
        "command",
        "-v",
        program,
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|status| status.success())
    .unwrap_or(false)
}

fn provider_names(ctx: &Context) -> Option<Vec<String>> {
    let output = ctx
        .openshell(&["provider", "list", "--names"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::to_string)
            .collect()
    })
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// `__health-json` / `__health`: one report of the idle stop, MCP readiness,
/// and the doctor checks. Read-only: nothing here starts a sandbox.
pub fn health(ctx: &Context, json: bool) -> Outcome {
    let name = ctx.sandbox_name()?;
    let dir = ctx.session_state_dir(&name);
    let period = super::session::resolved_idle_stop(ctx).ok();
    let idle_state = super::idle::state(&dir, period);
    let profile = mcp_profile(ctx);

    let mut mcp_error: Option<String> = None;
    let mut readiness: Option<Readiness> = None;
    if profile.requires_jq && !crate::state::command_in_path("jq") {
        mcp_error = Some("mcp status needs jq; install jq".to_string());
    } else if !crate::state::command_in_path("openshell") {
        mcp_error = Some("openshell CLI not found on PATH".to_string());
    } else {
        match ctx.sandbox_phase(&name) {
            Err(_) => {
                mcp_error = Some(format!(
                    "cannot reach the gateway; try '{} doctor'",
                    ctx.program()
                ))
            }
            Ok(None) => {
                mcp_error = Some(format!(
                    "no sandbox '{name}'; run '{} up' first",
                    ctx.program()
                ))
            }
            Ok(Some(phase)) if phase != "Ready" => {
                mcp_error = Some(format!("sandbox is not running (phase: {phase})"))
            }
            Ok(Some(_)) => match collect_readiness(ctx, &name, &profile) {
                Ok(report) => readiness = Some(report),
                Err(_) => {
                    mcp_error = Some(format!(
                        "cannot read MCP readiness from the gateway; try '{} doctor'",
                        ctx.program()
                    ))
                }
            },
        }
    }

    let doctor = collect_doctor(ctx, false)?;

    if !json {
        ctx.say(&format!(
            "Health of sandbox '{name}' ({}):",
            ctx.profile.tag
        ));
        ctx.say(&format!(
            "Idle stop: {}",
            super::idle::state_text(&idle_state)
        ));
        ctx.say("");
        ctx.say("MCP readiness:");
        if let Some(error) = &mcp_error {
            ctx.say(&format!("  error: {error}"));
        } else if let Some(report) = &readiness {
            if !report.any {
                ctx.say("  none configured");
            } else {
                render_readiness(report);
            }
        }
        ctx.say("");
        ctx.say("Doctor:");
        for check in &doctor.checks {
            println!("{:<5} {}: {}", check.status, check.name, check.detail);
        }
        return Ok(());
    }

    let mcp = match &mcp_error {
        Some(error) => format!(
            "{{\"supported\":true,\"ok\":false,\"error\":{},\"servers\":[]}}",
            json_str(error)
        ),
        None => {
            let report = readiness.unwrap_or(Readiness {
                any: false,
                failed: 0,
                errors: Vec::new(),
                servers: Vec::new(),
            });
            let ok = report.errors.is_empty() && report.failed == 0;
            let mut servers = String::new();
            for server in &report.servers {
                if !servers.is_empty() {
                    servers.push(',');
                }
                let mut gates = String::new();
                for gate in &server.gates {
                    if !gates.is_empty() {
                        gates.push(',');
                    }
                    let ok = if gate.status == "ok" { "true" } else { "false" };
                    let fix = gate
                        .fix
                        .as_ref()
                        .map(|fix| json_str(fix))
                        .unwrap_or_else(|| "null".to_string());
                    gates.push_str(&format!(
                        "{{\"gate\":{},\"ok\":{ok},\"fix\":{fix}}}",
                        json_str(gate.name)
                    ));
                }
                servers.push_str(&format!(
                    "{{\"name\":{},\"transport\":{},\"gates\":[{gates}]}}",
                    json_str(&server.name),
                    json_str(&server.transport)
                ));
            }
            let error = if report.errors.is_empty() {
                "null".to_string()
            } else {
                json_str(&report.errors.join("; "))
            };
            format!(
                "{{\"supported\":true,\"ok\":{},\"error\":{error},\"servers\":[{servers}]}}",
                if ok { "true" } else { "false" }
            )
        }
    };
    let mut checks = String::new();
    for check in &doctor.checks {
        if !checks.is_empty() {
            checks.push(',');
        }
        checks.push_str(&format!(
            "{{\"name\":{},\"status\":{},\"detail\":{}}}",
            json_str(&check.name),
            json_str(check.status),
            json_str(&check.detail)
        ));
    }
    println!(
        "{{\"sandbox\":{},\"agent\":{},\"idle\":{},\"mcp\":{mcp},\"doctor\":{{\"ok\":{},\"error\":null,\"checks\":[{checks}]}}}}",
        json_str(&name),
        json_str(ctx.profile.tag),
        super::idle::state_json(&idle_state),
        if doctor.status == 0 { "true" } else { "false" },
    );
    Ok(())
}
