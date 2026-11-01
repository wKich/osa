//! Per-front-end identity. One shared pipeline, four profiles as data.

use std::path::{Path, PathBuf};

/// What differs between `maki-oss`, `opencode-oss`, `claude-oss`, and
/// `codex-oss`. Everything else in the front-end is shared.
pub struct AgentProfile {
    /// The command name and the name used in messages.
    pub name: &'static str,
    /// Registry agent tag and the default sandbox-name prefix.
    pub tag: &'static str,
    /// Environment-variable prefix: `<PREFIX>_<KEY>`.
    pub env_prefix: &'static str,
    /// XDG directory that holds `config.toml`.
    pub config_name: &'static str,
    /// The agent executable launched inside the sandbox.
    pub agent_command: &'static str,
    /// Base sandbox image tag built for this front-end.
    pub base_image: &'static str,
    /// Config keys this front-end owns beyond the common set.
    pub owned_config_keys: &'static [&'static str],
    /// In-sandbox sync state directory name.
    pub state_name: &'static str,
    /// `/tmp` prefix for the helper's transient files.
    pub tmp_prefix: &'static str,
    /// Default name pattern (`{project}` and `{hash}` expand).
    pub default_name: &'static str,
    /// Default policy file, relative to the repository root.
    pub default_policy: &'static str,
}

impl AgentProfile {
    /// `<XDG_CONFIG_HOME or $HOME/.config>/<config_name>/config.toml`.
    pub fn config_path(&self) -> PathBuf {
        config_path_in(&config_home(), self)
    }

    /// The variable name a setting is read from, e.g. `MAKI_OSS_MODEL`.
    pub fn env_name(&self, key: &str) -> String {
        format!("{}_{}", self.env_prefix, key)
    }

    /// The setting's environment value, or `None` when unset or empty.
    pub fn env_setting(&self, key: &str) -> Option<String> {
        std::env::var(self.env_name(key))
            .ok()
            .filter(|value| !value.is_empty())
    }
}

/// The XDG config root, with the same fallback the shell helper used.
pub fn config_home() -> PathBuf {
    match std::env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => {
            let home = std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into());
            PathBuf::from(home).join(".config")
        }
    }
}

pub fn config_path_in(config_home: &Path, profile: &AgentProfile) -> PathBuf {
    config_home.join(profile.config_name).join("config.toml")
}

pub const MAKI: AgentProfile = AgentProfile {
    name: "maki-oss",
    tag: "mk",
    env_prefix: "MAKI_OSS",
    config_name: "maki-oss",
    agent_command: "maki",
    base_image: "maki-agent:local",
    owned_config_keys: &[],
    state_name: ".maki-oss",
    tmp_prefix: "maki-oss",
    default_name: "mk-{project}-{hash}",
    default_policy: "examples/policies/maki-minimal.yaml",
};

pub const OPENCODE: AgentProfile = AgentProfile {
    name: "opencode-oss",
    tag: "oc",
    env_prefix: "OPENCODE_OSS",
    config_name: "opencode-oss",
    agent_command: "opencode",
    base_image: "opencode-agent:local",
    owned_config_keys: &[],
    state_name: ".opencode-oss",
    tmp_prefix: "opencode-oss",
    default_name: "oc-{project}-{hash}",
    default_policy: "opencode-oss/policies/minimal.yaml",
};

pub const CLAUDE: AgentProfile = AgentProfile {
    name: "claude-oss",
    tag: "cc",
    env_prefix: "CLAUDE_OSS",
    config_name: "claude-oss",
    agent_command: "claude",
    base_image: "claude-agent:local",
    owned_config_keys: &[],
    state_name: ".claude-oss",
    tmp_prefix: "claude-oss",
    default_name: "cc-{project}-{hash}",
    default_policy: "claude-oss/policies/minimal.yaml",
};

pub const CODEX: AgentProfile = AgentProfile {
    name: "codex-oss",
    tag: "cx",
    env_prefix: "CODEX_OSS",
    config_name: "codex-oss",
    agent_command: "codex",
    base_image: "codex-agent:local",
    owned_config_keys: &["account_id"],
    state_name: ".codex-oss",
    tmp_prefix: "codex-oss",
    default_name: "cx-{project}-{hash}",
    default_policy: "codex-oss/policies/minimal.yaml",
};

pub const ALL: [&AgentProfile; 4] = [&MAKI, &OPENCODE, &CLAUDE, &CODEX];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn every_profile_has_a_distinct_config_path() {
        let home = Path::new("/home/sandbox/.config");
        let mut paths = HashSet::new();
        for profile in ALL {
            println!(
                "{} tag={} env={} config={} agent={} image={} keys={:?}",
                profile.name,
                profile.tag,
                profile.env_prefix,
                config_path_in(home, profile).display(),
                profile.agent_command,
                profile.base_image,
                profile.owned_config_keys
            );
            assert!(
                paths.insert(config_path_in(home, profile)),
                "{} shares a config path with another front-end",
                profile.name
            );
        }
    }

    #[test]
    fn every_profile_names_its_own_environment_prefix() {
        let prefixes: HashSet<&str> = ALL.iter().map(|profile| profile.env_prefix).collect();
        let tags: HashSet<&str> = ALL.iter().map(|profile| profile.tag).collect();
        assert_eq!(prefixes.len(), ALL.len());
        assert_eq!(tags.len(), ALL.len());
        assert_eq!(MAKI.env_name("MODEL"), "MAKI_OSS_MODEL");
        assert_eq!(CODEX.env_name("ACCOUNT_ID"), "CODEX_OSS_ACCOUNT_ID");
    }
}
