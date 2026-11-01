//! The shared state root: its layout, the lock and pending-marker semantics,
//! the project fingerprint, and the idle-stop report.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const OSA_STATE_DIR: &str = "osa";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatePaths {
    pub base: PathBuf,
    pub root: PathBuf,
    pub registry: PathBuf,
}

impl StatePaths {
    pub fn from_env() -> Self {
        Self::from_vars(env::var_os("XDG_STATE_HOME"), env::var_os("HOME"))
    }

    /// `$XDG_STATE_HOME` (or `$HOME/.local/state`, or `/tmp/.local/state`).
    pub fn from_vars(xdg: Option<OsString>, home: Option<OsString>) -> Self {
        let xdg = xdg.filter(|value| !value.is_empty());
        let home = home.filter(|value| !value.is_empty());
        let base = match (xdg, home) {
            (Some(xdg), _) => PathBuf::from(xdg),
            (None, Some(home)) => PathBuf::from(home).join(".local").join("state"),
            (None, None) => PathBuf::from("/tmp").join(".local").join("state"),
        };
        let root = base.join(OSA_STATE_DIR);
        let registry = root.join("projects");
        StatePaths {
            base,
            root,
            registry,
        }
    }

    pub fn sessions(&self) -> PathBuf {
        self.root.join("sessions")
    }

    pub fn session_dir(&self, sandbox: &str) -> PathBuf {
        self.sessions().join(sandbox)
    }

    /// Registry entries, sorted by file name, one path per `.toml` file.
    pub fn registry_entries(&self) -> Vec<PathBuf> {
        let mut entries: Vec<PathBuf> = fs::read_dir(&self.registry)
            .map(|dir| {
                dir.filter_map(Result::ok)
                    .map(|item| item.path())
                    .filter(|path| {
                        path.extension().is_some_and(|ext| ext == "toml") && path.is_file()
                    })
                    .collect()
            })
            .unwrap_or_default();
        entries.sort();
        entries
    }

    /// The registry entry for SANDBOX, found by file name.
    pub fn entry_file(&self, sandbox: &str) -> Option<PathBuf> {
        let wanted = format!("{sandbox}.toml");
        self.registry_entries()
            .into_iter()
            .find(|path| path.file_name().is_some_and(|name| name == wanted.as_str()))
    }
}

pub fn pid_live(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

pub fn parse_pid(text: &str) -> Option<u32> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Holder {
    Pid(u32),
    /// A resolve directory whose PID is not written yet.
    Unknown,
}

/// The PID of a live session holding LOCK_DIR. With CLEAN, files left by dead
/// sessions are removed on the way.
pub fn session_holder(lock_dir: &Path, clean: bool) -> Option<u32> {
    for path in lock_files(lock_dir, "session.") {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let suffix = &name["session.".len()..];
        if let Some(pid) = parse_pid(suffix) {
            if pid_live(pid) {
                return Some(pid);
            }
        }
        if clean {
            let _ = fs::remove_file(&path);
        }
    }
    None
}

/// The live resolve holding LOCK_DIR, or `Unknown` while its PID is not
/// written yet. With CLEAN, a dead resolve's directory is removed.
pub fn resolve_holder(lock_dir: &Path, clean: bool) -> Option<Holder> {
    let dir = lock_dir.join("resolve.d");
    if !dir.is_dir() {
        return None;
    }
    let pid_file = dir.join("pid");
    if !pid_file.is_file() {
        return Some(Holder::Unknown);
    }
    let pid = fs::read_to_string(&pid_file)
        .ok()
        .and_then(|text| parse_pid(text.trim_end_matches('\n')));
    if let Some(pid) = pid {
        if pid_live(pid) {
            return Some(Holder::Pid(pid));
        }
    }
    if clean {
        let _ = fs::remove_dir_all(&dir);
    }
    None
}

/// True while a live session or resolve holds LOCK_DIR. Read-only.
pub fn lock_busy(lock_dir: &Path) -> bool {
    session_holder(lock_dir, false).is_some() || resolve_holder(lock_dir, false).is_some()
}

fn lock_files(lock_dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(lock_dir)
        .map(|dir| {
            dir.filter_map(Result::ok)
                .map(|item| item.path())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with(prefix))
                        && path.is_file()
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// A lock this process announced and must remove when done.
#[derive(Debug)]
pub struct LockGuard {
    path: PathBuf,
    directory: bool,
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        if self.directory {
            let _ = fs::remove_dir_all(&self.path);
        } else {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[derive(Debug)]
pub enum Claim {
    Acquired(LockGuard),
    /// The other side announced first and is live.
    Busy(Holder),
}

/// Announces a session, then checks for a live resolve: of two concurrent
/// starters at least one sees the other.
pub fn claim_session(lock_dir: &Path, pid: u32) -> io::Result<Claim> {
    fs::create_dir_all(lock_dir)?;
    let own = lock_dir.join(format!("session.{pid}"));
    fs::write(&own, b"")?;
    if let Some(holder) = resolve_holder(lock_dir, true) {
        let _ = fs::remove_file(&own);
        return Ok(Claim::Busy(holder));
    }
    Ok(Claim::Acquired(LockGuard {
        path: own,
        directory: false,
    }))
}

/// Announces a resolve directory (created atomically), then checks for a live
/// session or another resolve.
pub fn claim_resolve(lock_dir: &Path, pid: u32) -> io::Result<Claim> {
    fs::create_dir_all(lock_dir)?;
    for _ in 0..3 {
        let dir = lock_dir.join("resolve.d");
        match fs::create_dir(&dir) {
            Ok(()) => {
                fs::write(dir.join("pid"), format!("{pid}\n"))?;
                if let Some(holder) = session_holder(lock_dir, true) {
                    let _ = fs::remove_dir_all(&dir);
                    return Ok(Claim::Busy(Holder::Pid(holder)));
                }
                return Ok(Claim::Acquired(LockGuard {
                    path: dir,
                    directory: true,
                }));
            }
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
                match resolve_holder(lock_dir, true) {
                    Some(holder) => return Ok(Claim::Busy(holder)),
                    None => continue,
                }
            }
            Err(err) => return Err(err),
        }
    }
    Ok(Claim::Busy(Holder::Unknown))
}

/// The pending kind recorded in a session directory: `retained`, `parked`, or
/// nothing. A marker without a kind is retained when its patch has content and
/// parked otherwise.
pub fn pending_kind(session_dir: &Path) -> Option<String> {
    let marker = session_dir.join("pending");
    if !marker.is_file() {
        return None;
    }
    let entry = fs::read_to_string(&marker)
        .map(|text| crate::flat::FlatEntry::parse(&text).entry)
        .unwrap_or_default();
    if let Some(kind) = entry.get("kind").filter(|kind| !kind.is_empty()) {
        return Some(kind.to_string());
    }
    let patch = entry.get("patch").unwrap_or("");
    if !patch.is_empty() && fs::metadata(patch).is_ok_and(|meta| meta.len() > 0) {
        Some("retained".to_string())
    } else {
        Some("parked".to_string())
    }
}

/// HEAD plus a checksum of `git status` and the diff against HEAD, so commits
/// and tracked, staged, unstaged, and untracked non-ignored changes all count.
/// Optional locks stay off so the fingerprint never writes the project index.
pub fn project_fingerprint(dir: &Path) -> Option<String> {
    if !command_in_path("git") {
        return None;
    }
    let inside = git(dir, &["rev-parse", "--is-inside-work-tree"])?;
    if inside != "true" {
        return None;
    }
    let head = git(dir, &["rev-parse", "-q", "--verify", "HEAD"])
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "none".to_string());
    let mut payload = git_bytes(
        dir,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    )
    .unwrap_or_default();
    if head != "none" {
        let diff = git_bytes(
            dir,
            &["diff", "HEAD", "--no-ext-diff", "--no-color", "--binary"],
        )
        .unwrap_or_default();
        payload.extend_from_slice(&diff);
    }
    let sum = cksum(&payload);
    Some(format!("{head}-{}-{}", sum.0, sum.1))
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let output = git_command(dir, args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .trim_end_matches('\n')
            .to_string(),
    )
}

fn git_bytes(dir: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = git_command(dir, args).output().ok()?;
    Some(output.stdout)
}

fn git_command(dir: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(std::process::Stdio::null());
    command
}

pub fn command_in_path(name: &str) -> bool {
    env::var_os("PATH")
        .map(|path| env::split_paths(&path).any(|dir| dir.join(name).is_file()))
        .unwrap_or(false)
}

/// The POSIX `cksum` value: a CRC over the bytes and then over the length.
pub fn cksum(bytes: &[u8]) -> (u32, usize) {
    let table = crc_table();
    let mut crc: u32 = 0;
    for byte in bytes {
        crc = (crc << 8) ^ table[(((crc >> 24) ^ u32::from(*byte)) & 0xff) as usize];
    }
    let mut length = bytes.len() as u64;
    while length != 0 {
        crc = (crc << 8) ^ table[(((crc >> 24) ^ ((length & 0xff) as u32)) & 0xff) as usize];
        length >>= 8;
    }
    (!crc, bytes.len())
}

fn crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    for (index, slot) in table.iter_mut().enumerate() {
        let mut crc = (index as u32) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04c1_1db7
            } else {
                crc << 1
            };
        }
        *slot = crc;
    }
    table
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdleState {
    pub state: String,
    pub period: Option<String>,
    pub deadline: Option<String>,
    pub estimated: bool,
    pub event: Option<String>,
    pub time: Option<String>,
}

impl IdleState {
    pub fn period_number(&self) -> Option<u64> {
        self.period
            .as_deref()
            .and_then(|period| period.parse().ok())
    }

    /// The tab-separated line the shell's `idle_state` prints, `-` for an
    /// empty field.
    pub fn to_tsv(&self) -> String {
        format!(
            "{}\t{}\t{}\t{}\t{}\t{}\n",
            self.state,
            self.period.as_deref().unwrap_or("-"),
            self.deadline.as_deref().unwrap_or("-"),
            self.estimated,
            self.event.as_deref().unwrap_or("-"),
            self.time.as_deref().unwrap_or("-")
        )
    }

    /// The one-line description `osa status --quick` prints.
    pub fn describe(&self) -> String {
        let mut text = match self.state.as_str() {
            "off" => "off".to_string(),
            "none" => "no session has run".to_string(),
            "running" => "session running".to_string(),
            "counting" => match (self.deadline.as_deref(), self.estimated) {
                (None, _) => "counting down".to_string(),
                (Some(deadline), true) => {
                    format!("counting down; stop due about {deadline} (estimated)")
                }
                (Some(deadline), false) => format!("counting down; stop due {deadline}"),
            },
            "stopped" => format!("stopped at {}", self.time.as_deref().unwrap_or("-")),
            "skipped" => format!(
                "skipped ({} at {})",
                self.event.as_deref().unwrap_or("-"),
                self.time.as_deref().unwrap_or("-")
            ),
            "failed" => format!(
                "stop failed ({} at {})",
                self.event.as_deref().unwrap_or("-"),
                self.time.as_deref().unwrap_or("-")
            ),
            other => other.to_string(),
        };
        if self.state != "off" {
            if let Some(period) = self.period.as_deref() {
                text.push_str(&format!(" (period {period}s)"));
            }
        }
        text
    }
}

/// The idle-stop state of a session directory, read from its files only.
pub fn idle_state(dir: &Path, period: Option<&str>) -> IdleState {
    let mut result = IdleState {
        state: "none".to_string(),
        period: period.filter(|value| !value.is_empty()).map(str::to_string),
        deadline: None,
        estimated: false,
        event: None,
        time: None,
    };
    if result.period.as_deref() == Some("0") {
        result.state = "off".to_string();
        return result;
    }
    let Ok(text) = fs::read_to_string(dir.join("idle.log")) else {
        return result;
    };
    let last = text.split('\n').rfind(|line| split_fields(line).len() >= 2);
    let Some(last) = last else {
        return result;
    };
    let fields = split_fields(last);
    result.event = fields.get(1).map(|field| field.to_string());
    let first = last.split_once(' ').map_or(last, |(first, _)| first);
    let epoch = local_epoch(first);
    result.time = epoch.and_then(utc_iso);
    let session = session_from_line(last);
    if let Some(session) = session.as_deref() {
        if let Some(secs) = armed_secs(&text, session) {
            result.period = Some(secs);
        }
    }
    let mut base = None;
    match result.event.as_deref().unwrap_or("") {
        "armed" => match session.as_deref().and_then(parse_pid) {
            Some(pid) if pid_live(pid) => result.state = "running".to_string(),
            _ => {
                result.state = "counting".to_string();
                result.estimated = true;
                base = file_mtime(&dir.join("idle")).or(epoch);
            }
        },
        "closed" => {
            result.state = "counting".to_string();
            base = epoch;
        }
        "stopped" => result.state = "stopped".to_string(),
        "superseded" | "busy" => result.state = "skipped".to_string(),
        "stop-failed" | "scan-failed" => result.state = "failed".to_string(),
        _ => {}
    }
    if let (Some(base), Some(period)) = (base, result.period_number()) {
        result.deadline = utc_iso(base + period as i64);
    }
    result
}

fn split_fields(line: &str) -> Vec<&str> {
    line.split(|ch: char| ch.is_ascii_whitespace() && !matches!(ch, '\n'))
        .filter(|field| !field.is_empty())
        .collect()
}

/// The `session=N` carried by an idle log line, using the same greedy match the
/// shell's `sed` uses: the last occurrence followed by a digit.
fn session_from_line(line: &str) -> Option<String> {
    let needle = " session=";
    let mut search = line.len();
    while let Some(at) = line[..search].rfind(needle) {
        let rest = &line[at + needle.len()..];
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        if !digits.is_empty() {
            return Some(digits);
        }
        search = at;
        if search == 0 {
            break;
        }
    }
    None
}

/// The `secs=` of the last `armed` line that names SESSION.
fn armed_secs(text: &str, session: &str) -> Option<String> {
    let wanted = format!("session={session}");
    let mut armed = None;
    for line in text.split('\n') {
        let fields = split_fields(line);
        if fields.get(1).is_some_and(|field| *field == "armed")
            && fields.iter().skip(2).any(|field| *field == wanted)
        {
            armed = Some(line);
        }
    }
    let line = armed?;
    last_number_after(line, " secs=")
}

fn last_number_after(line: &str, needle: &str) -> Option<String> {
    let mut search = line.len();
    while let Some(at) = line[..search].rfind(needle) {
        let rest = &line[at + needle.len()..];
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        if !digits.is_empty() {
            return Some(digits);
        }
        search = at;
        if search == 0 {
            break;
        }
    }
    None
}

/// Seconds since the epoch for a local `YYYY-mm-ddTHH:MM:SS` time.
pub fn local_epoch(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() != 19 {
        return None;
    }
    let digits = |range: std::ops::Range<usize>| -> Option<i64> {
        let slice = &text[range];
        if slice.bytes().all(|byte| byte.is_ascii_digit()) {
            slice.parse().ok()
        } else {
            None
        }
    };
    let year = digits(0..4)?;
    let month = digits(5..7)?;
    let day = digits(8..10)?;
    let hour = digits(11..13)?;
    let minute = digits(14..16)?;
    let second = digits(17..19)?;
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    tm.tm_year = (year - 1900) as libc::c_int;
    tm.tm_mon = (month - 1) as libc::c_int;
    tm.tm_mday = day as libc::c_int;
    tm.tm_hour = hour as libc::c_int;
    tm.tm_min = minute as libc::c_int;
    tm.tm_sec = second as libc::c_int;
    tm.tm_isdst = -1;
    let epoch = unsafe { libc::mktime(&mut tm) };
    if epoch == -1 {
        return None;
    }
    Some(epoch as i64)
}

/// ISO 8601 UTC for seconds since the epoch.
pub fn utc_iso(epoch: i64) -> Option<String> {
    let seconds: libc::time_t = epoch as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let converted = unsafe { libc::gmtime_r(&seconds, &mut tm) };
    if converted.is_null() {
        return None;
    }
    Some(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday,
        tm.tm_hour,
        tm.tm_min,
        tm.tm_sec
    ))
}

pub fn file_mtime(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|delta| delta.as_secs() as i64)
}
