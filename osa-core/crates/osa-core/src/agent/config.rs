//! The front-end `config.toml`: the common keys plus the keys a profile owns.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use super::profile::{config_path_in, AgentProfile};

/// Keys every front-end reads.
pub const COMMON_KEYS: [&str; 13] = [
    "image",
    "policy",
    "providers",
    "cpu",
    "memory",
    "sandbox_name",
    "engine",
    "gateway",
    "tls_dir",
    "workdir",
    "model",
    "tui",
    "idle_stop",
];

#[derive(Debug, Default)]
pub struct Config {
    values: BTreeMap<String, String>,
    pub path: PathBuf,
}

impl Config {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }
}

#[derive(Debug)]
pub struct ConfigError {
    path: PathBuf,
    problems: Vec<String>,
}

impl ConfigError {
    pub fn problems(&self) -> &[String] {
        &self.problems
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "invalid configuration in {}",
            self.path.display()
        )
    }
}

pub fn load(profile: &AgentProfile) -> Result<Config, ConfigError> {
    let path = config_path_in(&super::profile::config_home(), profile);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(_) if !path.is_file() => String::new(),
        Err(_) => {
            return Err(ConfigError {
                path,
                problems: Vec::new(),
            })
        }
    };
    from_text(&path, profile, &text)
}

pub fn from_text(path: &Path, profile: &AgentProfile, text: &str) -> Result<Config, ConfigError> {
    let mut config = Config {
        values: BTreeMap::new(),
        path: path.to_path_buf(),
    };
    let mut problems = Vec::new();
    let entries = parse(text, profile, &mut problems);
    if !problems.is_empty() {
        return Err(ConfigError {
            path: path.to_path_buf(),
            problems: problems
                .into_iter()
                .map(|problem| format!("{}:{problem}", path.display()))
                .collect(),
        });
    }
    for (key, value) in entries {
        config.values.insert(key, value);
    }
    Ok(config)
}

/// Parses the flat `key = "value"` file. Comments and blank lines are ignored;
/// every other nonconforming line is reported with its line number. Keys
/// outside the common set and the profile's own set are refused.
fn parse(text: &str, profile: &AgentProfile, problems: &mut Vec<String>) -> Vec<(String, String)> {
    let mut entries = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let number = index + 1;
        let line = line.trim_end_matches([' ', '\t']);
        let trimmed = line.trim_start_matches([' ', '\t']);
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            problems.push(format!("{number}: expected: key = \"value\""));
            continue;
        };
        let key = key.trim_matches([' ', '\t']);
        if !valid_key(key) {
            problems.push(format!("{number}: invalid key <{key}>"));
            continue;
        }
        if !COMMON_KEYS.contains(&key) && !profile.owned_config_keys.contains(&key) {
            problems.push(format!("{number}: unknown key <{key}>"));
            continue;
        }
        let value = value.trim_start_matches([' ', '\t']);
        let Some(rest) = value.strip_prefix('"') else {
            problems.push(format!(
                "{number}: value for <{key}> must be a quoted string"
            ));
            continue;
        };
        let mut parsed = String::new();
        let mut characters = rest.char_indices();
        let mut closed = None;
        let mut tabbed = false;
        while let Some((at, character)) = characters.next() {
            match character {
                '"' => {
                    closed = Some(at);
                    break;
                }
                '\\' => match characters.next() {
                    Some((_, '"')) => parsed.push('"'),
                    Some((_, '\\')) => parsed.push('\\'),
                    Some((_, other)) => {
                        parsed.push('\\');
                        parsed.push(other);
                    }
                    None => break,
                },
                '\t' => {
                    problems.push(format!(
                        "{number}: tab characters are not supported in values"
                    ));
                    tabbed = true;
                    break;
                }
                other => parsed.push(other),
            }
        }
        let Some(closed) = closed else {
            if !tabbed {
                problems.push(format!("{number}: unterminated value for <{key}>"));
            }
            continue;
        };
        let trailing = rest[closed + 1..].trim_start_matches([' ', '\t']);
        if !trailing.is_empty() && !trailing.starts_with('#') {
            problems.push(format!("{number}: unexpected text after value for <{key}>"));
            continue;
        }
        entries.push((key.to_string(), parsed));
    }
    entries
}

/// Adds or replaces one key in the config file, preserving every other line.
pub fn set_value(profile: &AgentProfile, key: &str, value: &str) -> std::io::Result<PathBuf> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let path = config_path_in(&super::profile::config_home(), profile);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    let assignment = format!("{key} = \"{escaped}\"\n");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    let mut replaced = false;
    for line in existing.lines() {
        let trimmed = line.trim_start_matches([' ', '\t']);
        let is_key =
            trimmed.starts_with(&format!("{key} ")) || trimmed.starts_with(&format!("{key}="));
        if !replaced && is_key {
            lines.push(assignment.trim_end_matches('\n').to_string());
            replaced = true;
        } else {
            lines.push(line.to_string());
        }
    }
    if !replaced {
        if lines.is_empty() {
            lines.push(format!(
                "# {0} configuration. See docs/helper.md.",
                profile.name
            ));
        }
        lines.push(assignment.trim_end_matches('\n').to_string());
    }
    let text = format!("{}\n", lines.join("\n"));
    let temp = path.with_extension("toml.tmp");
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temp)?;
        let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
        file.write_all(text.as_bytes())?;
    }
    fs::rename(&temp, &path)?;
    Ok(path)
}

fn valid_key(key: &str) -> bool {
    let mut characters = key.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_lowercase())
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::profile::{CODEX, MAKI};

    const PATH: &str = "/tmp/config.toml";

    #[test]
    fn flat_values_round_trip_with_escapes() {
        let config = from_text(
            Path::new(PATH),
            &MAKI,
            "image = \"x\"\nmodel = \"a \\\"b\\\" c\"\n",
        )
        .expect("valid");
        assert_eq!(config.get("image"), Some("x"));
        assert_eq!(config.get("model"), Some("a \"b\" c"));
    }

    #[test]
    fn unknown_keys_name_the_file_and_key() {
        let error = from_text(Path::new(PATH), &MAKI, "opennshell_path = \"/x\"\n")
            .expect_err("unknown key");
        assert!(error.to_string().contains("config.toml"));
        assert!(error.problems()[0].contains("unknown key <opennshell_path>"));
        assert!(error.problems()[0].contains(":1:"));
    }

    #[test]
    fn a_profile_own_key_is_accepted() {
        let config = from_text(Path::new(PATH), &CODEX, "account_id = \"a\"\n").expect("owned key");
        assert_eq!(config.get("account_id"), Some("a"));
    }

    #[test]
    fn a_key_another_profile_owns_is_refused() {
        assert!(from_text(Path::new(PATH), &MAKI, "account_id = \"a\"\n").is_err());
    }
}
