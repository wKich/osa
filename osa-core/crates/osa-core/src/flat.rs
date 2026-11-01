//! The flat TOML version 1 codec: the registry entry, pending marker, and
//! configuration file contract shared with the agent front-ends.

use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

pub const STATE_VERSION: &str = "1";

#[derive(Debug)]
pub enum FlatError {
    InvalidKey(String),
    UnsupportedValue { key: String, found: &'static str },
    Io(io::Error),
}

impl fmt::Display for FlatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FlatError::InvalidKey(key) => {
                write!(
                    f,
                    "invalid key <{key}>: use lowercase letters, digits, and underscores"
                )
            }
            FlatError::UnsupportedValue { key, found } => {
                write!(
                    f,
                    "value for <{key}> contains a {found}, which cannot be stored"
                )
            }
            FlatError::Io(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for FlatError {}

impl From<io::Error> for FlatError {
    fn from(err: io::Error) -> Self {
        FlatError::Io(err)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseProblem {
    pub line: usize,
    pub message: String,
}

impl fmt::Display for ParseProblem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.line, self.message)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Parsed {
    pub entry: FlatEntry,
    pub problems: Vec<ParseProblem>,
}

impl Parsed {
    pub fn is_ok(&self) -> bool {
        self.problems.is_empty()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FlatEntry {
    pairs: Vec<(String, String)>,
}

impl FlatEntry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_pairs<I, K, V>(pairs: I) -> Result<Self, FlatError>
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let mut entry = FlatEntry::new();
        for (key, value) in pairs {
            entry.push(key, value)?;
        }
        Ok(entry)
    }

    pub fn push(
        &mut self,
        key: impl Into<String>,
        value: impl Into<String>,
    ) -> Result<(), FlatError> {
        let key = key.into();
        let value = value.into();
        if !valid_key(&key) {
            return Err(FlatError::InvalidKey(key));
        }
        for (needle, found) in [('\n', "newline"), ('\t', "tab")] {
            if value.contains(needle) {
                return Err(FlatError::UnsupportedValue { key, found });
            }
        }
        self.pairs.push((key, value));
        Ok(())
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    pub fn pairs(&self) -> &[(String, String)] {
        &self.pairs
    }

    pub fn is_empty(&self) -> bool {
        self.pairs.is_empty()
    }

    /// `key = "value"` lines, one pair per line, with only `\\` and `\"`
    /// escaped inside a value.
    pub fn to_text(&self) -> String {
        let mut out = String::new();
        for (key, value) in &self.pairs {
            out.push_str(key);
            out.push_str(" = \"");
            escape_into(value, &mut out);
            out.push_str("\"\n");
        }
        out
    }

    /// `key<TAB>value` lines, the shape the shell parser prints as data.
    pub fn to_tsv(&self) -> String {
        let mut out = String::new();
        for (key, value) in &self.pairs {
            out.push_str(key);
            out.push('\t');
            out.push_str(value);
            out.push('\n');
        }
        out
    }

    /// Reads everything the shell's `awk` parser reads: blank lines, `#`
    /// comment lines, a trailing comment after a value, unknown keys, and
    /// quoted values with the closed `\\`/`\"` escape set. A malformed line is
    /// reported with its line number and skipped; the rest of the file still
    /// yields its pairs.
    pub fn parse(text: &str) -> Parsed {
        let mut entry = FlatEntry::new();
        let mut problems = Vec::new();
        let mut push_problem = |line: usize, message: String| {
            problems.push(ParseProblem { line, message });
        };
        for (index, raw) in text.split('\n').enumerate() {
            let number = index + 1;
            let line = trim_end_ascii_space(raw);
            if line.is_empty() || trim_start_ascii_space(line).starts_with('#') {
                continue;
            }
            let Some(eq) = line.find('=') else {
                push_problem(number, "expected: key = \"value\"".to_string());
                continue;
            };
            let key = trim_ascii_space(&line[..eq]);
            let value = trim_start_ascii_space(&line[eq + 1..]);
            if !valid_key(key) {
                push_problem(number, format!("invalid key <{key}>"));
                continue;
            }
            if !value.starts_with('"') {
                push_problem(number, format!("value for <{key}> must be a quoted string"));
                continue;
            }
            let Some(quoted_end) = quoted_end(value) else {
                push_problem(number, format!("unterminated value for <{key}>"));
                continue;
            };
            let quoted = &value[1..quoted_end];
            let rest = trim_start_ascii_space(&value[quoted_end + 1..]);
            if !rest.is_empty() && !rest.starts_with('#') {
                push_problem(number, format!("unexpected text after value for <{key}>"));
                continue;
            }
            if quoted.contains('\t') {
                push_problem(
                    number,
                    "tab characters are not supported in values".to_string(),
                );
                continue;
            }
            entry.pairs.push((key.to_string(), unescape(quoted)));
        }
        Parsed { entry, problems }
    }
}

/// Reads a file as a flat entry. `Err` carries the file name and every problem
/// the parser found, each already prefixed with the line number as the shell
/// parser prints it.
pub fn read_entry(path: &Path) -> Result<Parsed, Vec<String>> {
    let text = fs::read_to_string(path).unwrap_or_default();
    let parsed = FlatEntry::parse(&text);
    if parsed.is_ok() {
        return Ok(parsed);
    }
    let messages = parsed
        .problems
        .iter()
        .map(|problem| format!("{}:{}: {}", path.display(), problem.line, problem.message))
        .collect();
    Err(messages)
}

/// Replaces `path` with the entry: a mode `600` temporary file in the same
/// directory, then an atomic rename. A failed write leaves the previous file
/// in place and removes the temporary file.
pub fn write_atomic(path: &Path, entry: &FlatEntry) -> Result<(), FlatError> {
    for (key, value) in &entry.pairs {
        if !valid_key(key) {
            return Err(FlatError::InvalidKey(key.clone()));
        }
        for (needle, found) in [('\n', "newline"), ('\t', "tab")] {
            if value.contains(needle) {
                return Err(FlatError::UnsupportedValue {
                    key: key.clone(),
                    found,
                });
            }
        }
    }
    let text = entry.to_text();
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    if !directory.as_os_str().is_empty() {
        fs::create_dir_all(directory)?;
    }
    let temp = temp_path(path);
    let result = (|| -> io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(text.as_bytes())?;
        file.flush()?;
        fs::rename(&temp, path)?;
        Ok(())
    })();
    if let Err(err) = result {
        let _ = fs::remove_file(&temp);
        return Err(FlatError::Io(err));
    }
    Ok(())
}

fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{}", std::process::id()));
    PathBuf::from(name)
}

fn escape_into(value: &str, out: &mut String) {
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            other => out.push(other),
        }
    }
}

/// The index of the closing quote of the value that starts at index 0, using
/// the `^"([^"\\]|\\.)*"` grammar: a backslash escapes the character after it.
fn quoted_end(value: &str) -> Option<usize> {
    let bytes = value.as_bytes();
    let mut index = 1;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => return Some(index),
            b'\\' => index += 1,
            _ => {}
        }
        index += 1;
    }
    None
}

fn unescape(quoted: &str) -> String {
    let first = replace_all(quoted.as_bytes(), b"\\\"", b"\"");
    let second = replace_all(&first, b"\\\\", b"\\");
    String::from_utf8(second).unwrap_or_default()
}

fn replace_all(haystack: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(haystack.len());
    let mut index = 0;
    while index < haystack.len() {
        if haystack[index..].starts_with(needle) {
            out.extend_from_slice(replacement);
            index += needle.len();
        } else {
            out.push(haystack[index]);
            index += 1;
        }
    }
    out
}

pub fn valid_key(key: &str) -> bool {
    let mut bytes = key.bytes();
    match bytes.next() {
        Some(first) if first.is_ascii_lowercase() => {}
        _ => return false,
    }
    bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn is_ascii_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

fn trim_end_ascii_space(text: &str) -> &str {
    text.trim_end_matches(|ch: char| ch.is_ascii() && is_ascii_space(ch as u8))
}

fn trim_start_ascii_space(text: &str) -> &str {
    text.trim_start_matches(|ch: char| ch.is_ascii() && is_ascii_space(ch as u8))
}

fn trim_ascii_space(text: &str) -> &str {
    trim_end_ascii_space(trim_start_ascii_space(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializer_escapes_only_backslash_and_quote() {
        let entry = FlatEntry::from_pairs([
            ("version", "1"),
            ("reason", "a \\ b \"quoted\" # not a comment"),
        ])
        .expect("valid entry");
        assert_eq!(
            entry.to_text(),
            "version = \"1\"\nreason = \"a \\\\ b \\\"quoted\\\" # not a comment\"\n"
        );
    }

    #[test]
    fn serializer_refuses_a_newline() {
        let err = FlatEntry::from_pairs([("reason", "one\ntwo")]).unwrap_err();
        assert!(matches!(
            err,
            FlatError::UnsupportedValue {
                found: "newline",
                ..
            }
        ));
    }

    #[test]
    fn serializer_refuses_a_tab() {
        let err = FlatEntry::from_pairs([("reason", "one\ttwo")]).unwrap_err();
        assert!(matches!(
            err,
            FlatError::UnsupportedValue { found: "tab", .. }
        ));
    }

    #[test]
    fn serializer_refuses_an_invalid_key() {
        let err = FlatEntry::from_pairs([("Bad-Key", "value")]).unwrap_err();
        assert!(matches!(err, FlatError::InvalidKey(_)));
    }

    #[test]
    fn writer_keeps_the_previous_file_when_a_value_is_refused() {
        let dir = std::env::temp_dir().join(format!("osa-flat-test-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("entry.toml");
        let good = FlatEntry::from_pairs([("version", "1"), ("agent", "mk")]).expect("entry");
        write_atomic(&path, &good).expect("write");
        let before = fs::read_to_string(&path).expect("read");

        let mut bad = good.clone();
        bad.pairs
            .push(("reason".to_string(), "two\nlines".to_string()));
        assert!(write_atomic(&path, &bad).is_err());

        assert_eq!(fs::read_to_string(&path).expect("read"), before);
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .expect("dir")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name != "entry.toml")
            .collect();
        assert!(
            leftovers.is_empty(),
            "temporary files remain: {leftovers:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writer_sets_mode_600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("osa-flat-mode-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("entry.toml");
        let entry = FlatEntry::from_pairs([("version", "1")]).expect("entry");
        write_atomic(&path, &entry).expect("write");
        let mode = fs::metadata(&path).expect("meta").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parser_accepts_blank_comment_and_trailing_comment_lines() {
        let text =
            "\n# a comment\n  # an indented comment\nversion = \"1\"   \nreason = \"x\" # why\n";
        let parsed = FlatEntry::parse(text);
        assert!(parsed.is_ok(), "{:?}", parsed.problems);
        assert_eq!(parsed.entry.get("version"), Some("1"));
        assert_eq!(parsed.entry.get("reason"), Some("x"));
    }

    #[test]
    fn parser_accepts_an_unknown_key() {
        let parsed = FlatEntry::parse("version = \"1\"\nfuture_field = \"v\"\n");
        assert!(parsed.is_ok());
        assert_eq!(parsed.entry.get("future_field"), Some("v"));
    }

    #[test]
    fn parser_accepts_escapes_and_decodes_them_in_order() {
        let parsed = FlatEntry::parse("a = \"q\\\"q\"\nb = \"s\\\\s\"\nc = \"x\\\\\\\"y\"\n");
        assert!(parsed.is_ok(), "{:?}", parsed.problems);
        assert_eq!(parsed.entry.get("a"), Some("q\"q"));
        assert_eq!(parsed.entry.get("b"), Some("s\\s"));
        assert_eq!(parsed.entry.get("c"), Some("x\\\"y"));
    }

    #[test]
    fn parser_reports_each_rejected_form() {
        let cases = [
            ("no equals sign\n", "expected: key = \"value\""),
            ("Bad = \"v\"\n", "invalid key <Bad>"),
            ("1bad = \"v\"\n", "invalid key <1bad>"),
            ("key = value\n", "value for <key> must be a quoted string"),
            ("key = \"v\n", "unterminated value for <key>"),
            ("key = \"v\" x\n", "unexpected text after value for <key>"),
            (
                "key = \"v\tx\"\n",
                "tab characters are not supported in values",
            ),
        ];
        for (text, message) in cases {
            let parsed = FlatEntry::parse(text);
            assert_eq!(parsed.entry.get("key"), None, "{text:?} was accepted");
            assert_eq!(parsed.problems.len(), 1, "{text:?}");
            assert_eq!(parsed.problems[0].message, message, "{text:?}");
            assert_eq!(parsed.problems[0].line, 1, "{text:?}");
        }
    }

    #[test]
    fn parser_keeps_good_lines_after_a_bad_one() {
        let parsed = FlatEntry::parse("bad line\nversion = \"1\"\n");
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.entry.get("version"), Some("1"));
    }
}
