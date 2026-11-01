//! How a front-end reports a failure: a status code and the lines that go to
//! standard error, each prefixed with the program name.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub code: i32,
    pub lines: Vec<String>,
    /// Print the "Run '<program> help' for usage." hint after the lines.
    pub usage: bool,
}

impl Failure {
    pub fn new(code: i32, line: impl Into<String>) -> Self {
        Failure {
            code,
            lines: vec![line.into()],
            usage: false,
        }
    }

    pub fn usage(line: impl Into<String>) -> Self {
        Failure {
            code: super::cli::EX_USAGE,
            lines: vec![line.into()],
            usage: true,
        }
    }

    pub fn dep(line: impl Into<String>) -> Self {
        Failure::new(super::cli::EX_DEP, line)
    }

    pub fn gateway(line: impl Into<String>) -> Self {
        Failure::new(super::cli::EX_GATEWAY, line)
    }

    /// An exit status with no message (a command that already printed what it
    /// needed to standard output).
    pub fn silent(code: i32) -> Self {
        Failure {
            code,
            lines: Vec::new(),
            usage: false,
        }
    }

    pub fn with_lines(code: i32, lines: Vec<String>, usage: bool) -> Self {
        Failure { code, lines, usage }
    }
}

pub type Outcome = Result<(), Failure>;
