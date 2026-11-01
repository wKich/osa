//! State-tree behavior: the paths, the locks, the pending kinds, the project
//! fingerprint, and the idle-stop report.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Barrier};
use std::thread;

use osa_core::flat::FlatEntry;
use osa_core::state::{self, Claim, Holder, StatePaths};

fn stdout(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn scratch(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osa-state-{label}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch directory");
    dir
}

#[test]
fn state_root_covers_the_three_environment_shapes() {
    let shapes: [(&str, Option<&str>, Option<&str>, &str); 3] = [
        (
            "xdg",
            Some("/tmp/xdg-state"),
            Some("/home/me"),
            "/tmp/xdg-state/osa",
        ),
        ("home", None, Some("/home/me"), "/home/me/.local/state/osa"),
        ("neither", None, None, "/tmp/.local/state/osa"),
    ];
    for (label, xdg, home, expected) in shapes {
        let paths = StatePaths::from_vars(xdg.map(Into::into), home.map(Into::into));
        let expected = PathBuf::from(expected);
        assert_eq!(paths.root, expected, "{label}");
        assert_eq!(paths.registry, expected.join("projects"), "{label}");
        assert_eq!(paths.sessions(), paths.root.join("sessions"));
    }
}

#[test]
fn fingerprint_matches_the_documented_value_for_a_fixture_repository() {
    let dir = scratch("fingerprint");
    let repo = dir.join("repo");
    fs::create_dir_all(&repo).expect("repository");
    let git = |args: &[&str]| {
        let status = Command::new("git")
            .args([
                "-c",
                "user.email=fixture@example.com",
                "-c",
                "user.name=fixture",
            ])
            .args(args)
            .current_dir(&repo)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git runs");
        assert!(status.success(), "git {args:?}");
    };
    git(&["init", "-q"]);
    fs::write(repo.join("tracked.txt"), "one\n").expect("tracked file");
    git(&["add", "tracked.txt"]);
    git(&["commit", "-qm", "base"]);
    fs::write(repo.join("tracked.txt"), "one\ntwo\n").expect("unstaged change");
    fs::write(repo.join("staged.txt"), "staged\n").expect("staged file");
    git(&["add", "staged.txt"]);
    fs::write(repo.join("untracked.txt"), "untracked\n").expect("untracked file");

    let head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo)
        .output()
        .expect("git runs");
    let head = String::from_utf8_lossy(&head.stdout).trim().to_string();
    let first = state::project_fingerprint(&repo).expect("a git project");
    assert!(
        first.starts_with(&format!("{head}-")),
        "the fingerprint does not name HEAD: {first}"
    );
    assert_eq!(
        state::project_fingerprint(&repo).as_deref(),
        Some(first.as_str()),
        "the fingerprint is not stable while the tree is unchanged"
    );
    fs::write(repo.join("tracked.txt"), "one\nthree\n").expect("changed tracked file");
    assert_ne!(
        state::project_fingerprint(&repo).as_deref(),
        Some(first.as_str()),
        "the fingerprint did not move with the worktree"
    );
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_plain_folder_has_no_fingerprint() {
    let dir = scratch("plain");
    assert_eq!(state::project_fingerprint(&dir), None);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn cksum_matches_the_system_implementation() {
    let dir = scratch("cksum");
    for (index, text) in ["", "one\n", "one\ntwo\n", "binary\u{0}\u{1}bytes"]
        .into_iter()
        .enumerate()
    {
        let path = dir.join(format!("payload-{index}"));
        fs::write(&path, text).expect("payload");
        let output = Command::new("cksum")
            .arg(&path)
            .output()
            .expect("cksum runs");
        let fields: Vec<String> = stdout(&output)
            .split_whitespace()
            .map(str::to_string)
            .collect();
        let (crc, length) = state::cksum(text.as_bytes());
        assert_eq!(fields[0], crc.to_string(), "crc for {text:?}");
        assert_eq!(fields[1], length.to_string(), "length for {text:?}");
    }
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn pending_kind_derives_the_documented_kinds() {
    let dir = scratch("pending-kinds");
    let session = dir.join("session");

    assert_eq!(state::pending_kind(&session), None, "no marker");

    fs::create_dir_all(&session).expect("session");
    let patch = session.join("retained.patch");
    fs::write(&patch, "diff\n").expect("patch");

    let mut marker = FlatEntry::new();
    marker.push("version", "1").expect("pair");
    marker.push("kind", "parked").expect("pair");
    marker.push("patch", patch.to_string_lossy()).expect("pair");
    fs::write(session.join("pending"), marker.to_text()).expect("marker");
    assert_eq!(state::pending_kind(&session).as_deref(), Some("parked"));

    let mut marker = FlatEntry::new();
    marker.push("version", "1").expect("pair");
    marker.push("patch", patch.to_string_lossy()).expect("pair");
    fs::write(session.join("pending"), marker.to_text()).expect("marker");
    assert_eq!(state::pending_kind(&session).as_deref(), Some("retained"));

    fs::write(&patch, "").expect("empty patch");
    assert_eq!(state::pending_kind(&session).as_deref(), Some("parked"));

    let missing = session.join("missing.patch");
    let mut marker = FlatEntry::new();
    marker
        .push("patch", missing.to_string_lossy())
        .expect("pair");
    fs::write(session.join("pending"), marker.to_text()).expect("marker");
    assert_eq!(state::pending_kind(&session).as_deref(), Some("parked"));

    fs::remove_dir_all(&dir).ok();
}

fn sleeper() -> std::process::Child {
    Command::new("sleep")
        .arg("30")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("sleeper runs")
}

fn stop(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn a_session_and_a_resolve_never_both_claim_the_lock() {
    for round in 0..25 {
        let dir = scratch(&format!("locks-{round}"));
        let mut session_pid = sleeper();
        let mut resolve_pid = sleeper();
        let (session_id, resolve_id) = (session_pid.id(), resolve_pid.id());
        let barrier = Arc::new(Barrier::new(2));

        let session_dir = dir.clone();
        let session_barrier = Arc::clone(&barrier);
        let session_thread = thread::spawn(move || {
            session_barrier.wait();
            state::claim_session(&session_dir, session_id)
        });

        let resolve_dir = dir.clone();
        let resolve_barrier = Arc::clone(&barrier);
        let resolve_thread = thread::spawn(move || {
            resolve_barrier.wait();
            state::claim_resolve(&resolve_dir, resolve_id)
        });

        let session_claim = session_thread.join().expect("thread").expect("claim");
        let resolve_claim = resolve_thread.join().expect("thread").expect("claim");

        let session_acquired = matches!(&session_claim, Claim::Acquired(_));
        let resolve_acquired = matches!(&resolve_claim, Claim::Acquired(_));
        assert!(
            !(session_acquired && resolve_acquired),
            "both starters acquired the lock"
        );
        if !session_acquired && !resolve_acquired {
            assert!(matches!(&session_claim, Claim::Busy(_)));
            assert!(matches!(&resolve_claim, Claim::Busy(_)));
        }
        if let Claim::Busy(holder) = &session_claim {
            match holder {
                Holder::Pid(pid) => assert_eq!(*pid, resolve_id),
                Holder::Unknown => {}
            }
        }
        if let Claim::Busy(holder) = &resolve_claim {
            match holder {
                Holder::Pid(pid) => assert_eq!(*pid, session_id),
                Holder::Unknown => {}
            }
        }

        drop(session_claim);
        drop(resolve_claim);
        assert!(
            !dir.join("resolve.d").exists(),
            "a resolve directory outlived its claim"
        );
        let leftovers = fs::read_dir(&dir)
            .expect("lock directory")
            .filter_map(Result::ok)
            .count();
        assert_eq!(leftovers, 0, "a lock file outlived its claim");

        stop(&mut session_pid);
        stop(&mut resolve_pid);
        fs::remove_dir_all(&dir).ok();
    }
}

#[test]
fn a_stale_lock_is_not_an_obstacle() {
    let dir = scratch("stale-locks");
    let dead = Command::new("sh")
        .arg("-c")
        .arg("echo $$")
        .output()
        .expect("child runs");
    let dead_pid: u32 = stdout(&dead).trim().parse().expect("pid");

    fs::write(dir.join(format!("session.{dead_pid}")), "").expect("session lock");
    assert!(!state::lock_busy(&dir));
    assert_eq!(state::session_holder(&dir, false), None);
    assert_eq!(state::session_holder(&dir, true), None);
    assert!(!dir.join(format!("session.{dead_pid}")).exists());

    let resolve = dir.join("resolve.d");
    fs::create_dir_all(&resolve).expect("resolve directory");
    fs::write(resolve.join("pid"), format!("{dead_pid}\n")).expect("pid file");
    assert!(!state::lock_busy(&dir));
    assert_eq!(state::resolve_holder(&dir, true), None);
    assert!(!resolve.exists());

    fs::create_dir_all(&resolve).expect("resolve directory");
    assert_eq!(state::resolve_holder(&dir, false), Some(Holder::Unknown));
    assert!(state::lock_busy(&dir));
    fs::remove_dir_all(&dir).ok();
}

fn local_time(epoch: i64) -> String {
    let gnu = Command::new("date")
        .args(["-d", &format!("@{epoch}"), "+%Y-%m-%dT%H:%M:%S"])
        .output();
    if let Ok(output) = gnu {
        if output.status.success() {
            return stdout(&output).trim_end().to_string();
        }
    }
    let bsd = Command::new("date")
        .args(["-r", &epoch.to_string(), "+%Y-%m-%dT%H:%M:%S"])
        .output()
        .expect("date runs");
    stdout(&bsd).trim_end().to_string()
}

fn idle_line(dir: &Path, seconds_ago: i64, rest: &str) {
    fs::create_dir_all(dir).expect("session directory");
    let epoch = now() - seconds_ago;
    let line = format!("{} {rest}\n", local_time(epoch));
    let mut log = fs::read_to_string(dir.join("idle.log")).unwrap_or_default();
    log.push_str(&line);
    fs::write(dir.join("idle.log"), log).expect("idle log");
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("after the epoch")
        .as_secs() as i64
}

fn assert_idle(dir: &Path, period: Option<&str>, expected: &str) -> state::IdleState {
    let actual = state::idle_state(dir, period);
    assert_eq!(actual.state, expected, "idle state for {}", dir.display());
    assert_eq!(
        actual.to_tsv().split('\t').count(),
        6,
        "idle row fields for {}",
        dir.display()
    );
    actual
}

#[test]
fn idle_state_reports_every_documented_state() {
    let dir = scratch("idle");
    let dead = Command::new("sh")
        .arg("-c")
        .arg("echo $$")
        .output()
        .expect("child runs");
    let dead_pid = stdout(&dead).trim().to_string();
    let live_pid = std::process::id();

    assert_idle(&dir.join("none"), Some("3600"), "none");
    assert_idle(&dir.join("none"), Some("0"), "off");

    let running = dir.join("running");
    idle_line(
        &running,
        30,
        &format!("armed secs=3600 session={live_pid} watcher=1"),
    );
    fs::write(running.join("idle"), format!("{}.{}\n", now(), live_pid)).expect("idle stamp");
    assert_idle(&running, None, "running");

    let counting = dir.join("counting");
    idle_line(
        &counting,
        900,
        &format!("armed secs=3600 session={dead_pid} watcher=1"),
    );
    idle_line(&counting, 600, &format!("closed session={dead_pid}"));
    assert_idle(&counting, None, "counting");
    let counted = assert_idle(&counting, Some("1800"), "counting");
    assert_eq!(counted.period.as_deref(), Some("3600"));

    let no_armed = dir.join("no-armed");
    idle_line(&no_armed, 600, &format!("closed session={dead_pid}"));
    assert_idle(&no_armed, Some("1800"), "counting");

    let estimated = dir.join("estimated");
    idle_line(
        &estimated,
        120,
        &format!("armed secs=3600 session={dead_pid} watcher=1"),
    );
    fs::write(estimated.join("idle"), format!("{}.{dead_pid}\n", now())).expect("idle stamp");
    assert!(assert_idle(&estimated, None, "counting").estimated);

    for (event, expected) in [
        ("stopped", "stopped"),
        ("superseded", "skipped"),
        ("busy", "skipped"),
        ("stop-failed", "failed"),
        ("scan-failed", "failed"),
    ] {
        let session = dir.join(event);
        idle_line(
            &session,
            3700,
            &format!("armed secs=60 session={dead_pid} watcher=1"),
        );
        idle_line(&session, 3600, &format!("closed session={dead_pid}"));
        idle_line(&session, 3540, &format!("{event} session={dead_pid}"));
        assert_idle(&session, None, expected);
    }

    fs::remove_dir_all(&dir).ok();
}
