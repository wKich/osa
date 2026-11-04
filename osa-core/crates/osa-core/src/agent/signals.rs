//! Session signal handling: INT and TERM interrupt the child, then the
//! session finishes its sync and proposal check instead of dying in place.
//! SIGHUP is ignored, so a closed harness wrapper never kills the helper
//! before the idle watcher is armed.

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering};

static SIGNAL: AtomicI32 = AtomicI32::new(0);
static CHILD: AtomicI32 = AtomicI32::new(0);
/// Pointer to the exec's interrupt flag, so a typed exec — which owns no
/// local child — still ends its stream when a signal arrives. The handler
/// only stores into it: the value is set before capture and cleared after, so
/// the pointer stays valid for the handler's lifetime.
static INTERRUPT: AtomicUsize = AtomicUsize::new(0);

extern "C" fn handler(signal: libc::c_int) {
    SIGNAL.store(signal, Ordering::Relaxed);
    let flag = INTERRUPT.load(Ordering::Relaxed);
    if flag != 0 {
        // SAFETY: `watch_interrupt` stores a live `AtomicBool` that outlives
        // `capture`, and `unwatch_interrupt` clears it before that value drops.
        unsafe {
            (*(flag as *const AtomicBool)).store(true, Ordering::Relaxed);
        }
    }
    let pid = CHILD.load(Ordering::Relaxed);
    if pid > 0 {
        unsafe {
            libc::kill(pid, signal);
        }
    }
}

pub fn install() {
    unsafe {
        libc::signal(libc::SIGHUP, libc::SIG_IGN);
    }
}

/// Installs the INT/TERM handlers for the duration of an agent exec.
pub fn capture() {
    unsafe {
        libc::signal(libc::SIGINT, handler as *const () as libc::sighandler_t);
        libc::signal(libc::SIGTERM, handler as *const () as libc::sighandler_t);
    }
}

/// Point the handler at the exec's interrupt flag for the session.
pub fn watch_interrupt(flag: &std::sync::Arc<AtomicBool>) {
    INTERRUPT.store(std::sync::Arc::as_ptr(flag) as usize, Ordering::Relaxed);
}

pub fn unwatch_interrupt() {
    INTERRUPT.store(0, Ordering::Relaxed);
}

pub fn release() {
    unsafe {
        libc::signal(libc::SIGINT, libc::SIG_DFL);
        libc::signal(libc::SIGTERM, libc::SIG_DFL);
    }
}

pub fn child(pid: Option<u32>) {
    CHILD.store(pid.map(|pid| pid as i32).unwrap_or(0), Ordering::Relaxed);
}

/// The signal that interrupted the session, if any.
pub fn taken() -> Option<i32> {
    match SIGNAL.swap(0, Ordering::Relaxed) {
        0 => None,
        signal => Some(signal),
    }
}

/// The exit code a session reports after an interruption.
pub fn interrupted_code(signal: i32) -> i32 {
    128 + signal
}
