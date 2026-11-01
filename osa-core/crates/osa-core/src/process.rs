//! Child-process helpers: exact exit-code propagation and process replacement
//! with `exec`, so signals, TTY state, and status pass through unchanged.

use std::os::unix::process::CommandExt;
use std::os::unix::process::ExitStatusExt;
use std::process::{Command, ExitStatus};

/// The shell's exit status for a finished child: its code, or `128 + signal`.
pub fn exit_code(status: ExitStatus) -> i32 {
    status
        .code()
        .unwrap_or_else(|| 128 + status.signal().unwrap_or(0))
}

/// Replaces this process with the command, so the child owns signals and the
/// exit status. Returns only when the child cannot be started.
pub fn exec(command: &mut Command) -> i32 {
    // Only the program name: the argument list and environment may carry a
    // credential somewhere the child expects it, and `Command`'s own debug
    // output would print it.
    let description = command.get_program().to_string_lossy().into_owned();
    let error = command.exec();
    let status = if error.kind() == std::io::ErrorKind::NotFound {
        127
    } else {
        126
    };
    eprintln!("osa: cannot run {description}: {error}");
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_status_propagates_unchanged() {
        let status = Command::new("sh")
            .arg("-c")
            .arg("exit 7")
            .status()
            .expect("child runs");
        assert_eq!(exit_code(status), 7);
    }

    #[test]
    fn inherited_stdout_keeps_the_terminal_attached() {
        let parent_tty = unsafe { libc::isatty(1) == 1 };
        let status = Command::new("sh")
            .arg("-c")
            .arg("test -t 1")
            .status()
            .expect("child runs");
        let expected = if parent_tty { 0 } else { 1 };
        assert_eq!(status.code(), Some(expected));
    }
}
