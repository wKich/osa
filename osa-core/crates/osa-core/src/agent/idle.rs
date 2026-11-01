//! The detached idle-stop watcher: a session stamps its close, the watcher
//! sleeps the idle period, and stops the sandbox only when its stamp is still
//! the latest and no agent process runs inside.

use std::fs;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::context::Context;
use super::failure::{Failure, Outcome};
use super::profile::AgentProfile;

const POLL_SECS: u64 = 2;

fn scan_script(agent: &str) -> String {
    format!(
        "for f in /proc/[0-9]*/comm; do\n    c=\n    {{ read -r c <\"$f\"; }} 2>/dev/null || continue\n    if [ \"$c\" = {agent} ]; then printf \"busy\\n\"; exit 0; fi\ndone\nprintf \"idle\\n\""
    )
}

fn state_dir(_profile: &AgentProfile, name: &str) -> PathBuf {
    let home = std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into());
    PathBuf::from(home)
        .join(".local/state/osa/sessions")
        .join(name)
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn stamp(dir: &Path) -> String {
    fs::read_to_string(dir.join("idle"))
        .map(|text| text.trim().to_string())
        .unwrap_or_default()
}

fn log(dir: &Path, event: &str) {
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    let line = format!("{} {event}\n", timestamp(now()));
    let path = dir.join("idle.log");
    use std::io::Write;
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

pub fn timestamp(seconds: i64) -> String {
    let (year, month, day, hour, minute, second) = civil_from_seconds(seconds);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}")
}

fn civil_from_seconds(seconds: i64) -> (i64, i64, i64, i64, i64, i64) {
    let days = seconds.div_euclid(86400);
    let remainder = seconds.rem_euclid(86400);
    let (year, month, day) = civil_from_days(days);
    (
        year,
        month,
        day,
        remainder / 3600,
        (remainder % 3600) / 60,
        remainder % 60,
    )
}

pub(crate) fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let day_of_era = z - era * 146097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    (year + i64::from(month <= 2), month, day)
}

fn write_stamp(dir: &Path, token: &str) {
    let _ = fs::create_dir_all(dir);
    let temp = dir.join(format!("idle.{}", std::process::id()));
    if fs::write(&temp, format!("{token}\n")).is_ok() {
        let _ = fs::rename(&temp, dir.join("idle"));
    }
}

/// Writes this session's start stamp and spawns the watcher. A zero period
/// disables it: no stamp, no watcher.
pub fn arm(ctx: &Context, name: &str, seconds: u64) {
    if seconds == 0 {
        return;
    }
    let dir = ctx.session_state_dir(name);
    write_stamp(&dir, &format!("{}.{}", now(), std::process::id()));
    let executable = std::env::current_exe().unwrap_or_else(|_| PathBuf::from(ctx.program()));
    let arg0 = ctx.repo_root.join("bin").join(ctx.program());
    let mut command = Command::new(&executable);
    command
        .arg0(if arg0.exists() { arg0 } else { executable })
        .arg("__idle-watch")
        .arg(name)
        .arg(std::process::id().to_string())
        .arg(seconds.to_string());
    if let Some(gateway) = ctx.gateway() {
        command.arg("--gateway").arg(gateway);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            libc::signal(libc::SIGHUP, libc::SIG_IGN);
            Ok(())
        });
    }
    match command.spawn() {
        Ok(child) => {
            let _ = child.id();
            log(
                &dir,
                &format!(
                    "armed secs={seconds} session={} watcher={}",
                    std::process::id(),
                    child.id()
                ),
            );
        }
        Err(_) => log(&dir, "arm-failed"),
    }
}

/// `__idle-watch NAME PID SECS [--gateway G]`: waits for the session to exit,
/// stamps the close, sleeps, and stops the sandbox when it is still idle.
pub fn watch(profile: &AgentProfile, args: &[std::ffi::OsString]) -> Outcome {
    let words: Vec<String> = args
        .iter()
        .map(|word| word.to_string_lossy().into_owned())
        .collect();
    let usage = || {
        Failure::usage(format!(
            "usage: {} __idle-watch NAME PID SECS",
            profile.name
        ))
    };
    if words.len() < 3 {
        return Err(usage());
    }
    let name = words[0].clone();
    let Ok(pid) = words[1].parse::<i32>() else {
        return Err(usage());
    };
    let Ok(seconds) = words[2].parse::<u64>() else {
        return Err(usage());
    };
    let mut gateway = None;
    let mut index = 3;
    while index < words.len() {
        match words[index].as_str() {
            "--gateway" if index + 1 < words.len() => {
                gateway = Some(words[index + 1].clone());
                index += 2;
            }
            _ => return Err(usage()),
        }
    }
    let dir = state_dir(profile, &name);
    while unsafe { libc::kill(pid, 0) } == 0 {
        std::thread::sleep(std::time::Duration::from_secs(POLL_SECS));
    }
    let token = format!("{}.{}", now(), std::process::id());
    write_stamp(&dir, &token);
    log(&dir, &format!("closed session={pid}"));
    std::thread::sleep(std::time::Duration::from_secs(seconds));
    if stamp(&dir) != token {
        log(&dir, &format!("superseded session={pid}"));
        return Ok(());
    }
    let scan_script = scan_script(profile.agent_command);
    let scan = {
        let mut command = Command::new("openshell");
        if let Some(gateway) = &gateway {
            command.arg("-g").arg(gateway);
        }
        command
            .args([
                "sandbox",
                "exec",
                "-n",
                &name,
                "--no-login-shell",
                "--",
                "sh",
                "-c",
                &scan_script,
                &format!("{}-idle", profile.name),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
    };
    let answer = scan
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default();
    match answer.as_str() {
        "idle" => {}
        "busy" => {
            log(&dir, &format!("busy session={pid}"));
            return Ok(());
        }
        _ => {
            log(&dir, &format!("scan-failed session={pid}"));
            return Ok(());
        }
    }
    let mut command = Command::new("openshell");
    if let Some(gateway) = &gateway {
        command.arg("-g").arg(gateway);
    }
    let stopped = command
        .args(["sandbox", "stop", &name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if stopped {
        log(&dir, &format!("stopped session={pid}"));
    } else {
        log(&dir, &format!("stop-failed session={pid}"));
    }
    Ok(())
}

pub struct IdleState {
    pub state: &'static str,
    pub period: Option<u64>,
    pub deadline: Option<String>,
    pub estimated: bool,
    pub event: Option<String>,
    pub time: Option<String>,
}

fn local_epoch(value: &str) -> Option<i64> {
    let parts: Vec<&str> = value.split(['-', 'T', ':']).collect();
    if parts.len() != 6 {
        return None;
    }
    let numbers: Vec<i64> = parts
        .iter()
        .map(|part| part.parse::<i64>().ok())
        .collect::<Option<Vec<_>>>()?;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    tm.tm_year = (numbers[0] - 1900) as libc::c_int;
    tm.tm_mon = (numbers[1] - 1) as libc::c_int;
    tm.tm_mday = numbers[2] as libc::c_int;
    tm.tm_hour = numbers[3] as libc::c_int;
    tm.tm_min = numbers[4] as libc::c_int;
    tm.tm_sec = numbers[5] as libc::c_int;
    tm.tm_isdst = -1;
    let epoch = unsafe { libc::mktime(&mut tm) };
    (epoch >= 0).then_some(epoch as i64)
}

fn utc_iso(epoch: i64) -> String {
    format!("{}Z", timestamp(epoch))
}

fn file_mtime(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

fn process_alive(pid: i64) -> bool {
    pid > 0 && unsafe { libc::kill(pid as i32, 0) } == 0
}

/// Prints the state row (`state TAB period ...`) for DIR, the internal probe
/// the suite uses to check every idle-stop state without a gateway.
pub fn state_row(ctx: &Context, args: &[std::ffi::OsString]) -> Outcome {
    if args.is_empty() || args.len() > 2 {
        return Err(Failure::usage(format!(
            "usage: {} __idle-state DIR [SECS]",
            ctx.program()
        )));
    }
    let dir = PathBuf::from(args[0].clone());
    let period = args.get(1).map(|word| word.to_string_lossy().into_owned());
    print!(
        "{}",
        crate::state::idle_state(&dir, period.as_deref()).to_tsv()
    );
    Ok(())
}

/// The idle-stop state of a session directory, read from its files only.
pub fn state(dir: &Path, configured: Option<u64>) -> IdleState {
    let mut state = IdleState {
        state: "none",
        period: configured,
        deadline: None,
        estimated: false,
        event: None,
        time: None,
    };
    if configured.is_none() {
        state.period = None;
    }
    if configured == Some(0) {
        state.state = "off";
        return state;
    }
    let Ok(text) = fs::read_to_string(dir.join("idle.log")) else {
        return state;
    };
    let last = text
        .lines()
        .rev()
        .find(|line| line.split_whitespace().count() >= 2)
        .map(str::to_string);
    let Some(last) = last else {
        return state;
    };
    let mut fields = last.split_whitespace();
    let Some(stamp) = fields.next() else {
        return state;
    };
    let event = fields.next().unwrap_or("").to_string();
    let epoch = local_epoch(stamp);
    if let Some(epoch) = epoch {
        state.time = Some(utc_iso(epoch));
    }
    let session = last
        .split("session=")
        .nth(1)
        .and_then(|rest| rest.split_whitespace().next())
        .and_then(|pid| pid.parse::<i64>().ok());
    if let Some(session) = session {
        let token = format!("session={session}");
        let armed = text
            .lines()
            .rev()
            .filter(|line| line.split_whitespace().nth(1) == Some("armed"))
            .find(|line| line.split_whitespace().any(|field| field == token))
            .and_then(|line| {
                line.split("secs=")
                    .nth(1)
                    .and_then(|rest| rest.split_whitespace().next())
                    .and_then(|value| value.parse::<u64>().ok())
            });
        if let Some(armed) = armed {
            state.period = Some(armed);
        }
    }
    state.event = Some(event.clone());
    let mut base = None;
    match event.as_str() {
        "armed" => {
            if session.is_some_and(process_alive) {
                state.state = "running";
            } else {
                state.state = "counting";
                state.estimated = true;
                base = file_mtime(&dir.join("idle")).or(epoch);
            }
        }
        "closed" => {
            state.state = "counting";
            base = epoch;
        }
        "stopped" => state.state = "stopped",
        "superseded" | "busy" => state.state = "skipped",
        "stop-failed" | "scan-failed" => state.state = "failed",
        _ => {}
    }
    if let (Some(base), Some(period)) = (base, state.period) {
        state.deadline = Some(utc_iso(base + period as i64));
    }
    state
}

pub fn state_json(state: &IdleState) -> String {
    let period = state
        .period
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let estimated = if state.estimated { "true" } else { "false" };
    format!(
        "{{\"period\":{period},\"state\":{},\"deadline\":{},\"estimated\":{estimated},\"last_event\":{},\"last_time\":{}}}",
        json_string(state.state),
        json_nullable(state.deadline.as_deref()),
        json_nullable(state.event.as_deref()),
        json_nullable(state.time.as_deref()),
    )
}

pub fn state_text(state: &IdleState) -> String {
    let mut text = match state.state {
        "off" => "off".to_string(),
        "none" => "no session has run".to_string(),
        "running" => "session running".to_string(),
        "counting" => match &state.deadline {
            None => "counting down".to_string(),
            Some(deadline) if state.estimated => {
                format!("counting down; stop due about {deadline} (estimated)")
            }
            Some(deadline) => format!("counting down; stop due {deadline}"),
        },
        "stopped" => format!("stopped at {}", state.time.as_deref().unwrap_or("-")),
        "skipped" => format!(
            "skipped ({} at {})",
            state.event.as_deref().unwrap_or("-"),
            state.time.as_deref().unwrap_or("-")
        ),
        "failed" => format!(
            "stop failed ({} at {})",
            state.event.as_deref().unwrap_or("-"),
            state.time.as_deref().unwrap_or("-")
        ),
        other => other.to_string(),
    };
    if let Some(period) = state.period {
        if state.state != "off" {
            text.push_str(&format!(" (period {period}s)"));
        }
    }
    text
}

fn json_string(value: &str) -> String {
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

fn json_nullable(value: Option<&str>) -> String {
    value.map(json_string).unwrap_or_else(|| "null".to_string())
}
