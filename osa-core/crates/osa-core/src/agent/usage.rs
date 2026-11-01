//! The usage text each front-end prints for `help`, `--help`, and `-h`.
//!
//! The text is shipped as data so a help screen change never touches the
//! dispatcher; the files match the shell helper's wording byte for byte.

use super::profile::AgentProfile;

const MAKI: &str = include_str!("usage/maki-oss.txt");
const OPENCODE: &str = include_str!("usage/opencode-oss.txt");
const CLAUDE: &str = include_str!("usage/claude-oss.txt");
const CODEX: &str = include_str!("usage/codex-oss.txt");

pub fn for_profile(profile: &AgentProfile) -> &'static str {
    match profile.name {
        "maki-oss" => MAKI,
        "opencode-oss" => OPENCODE,
        "claude-oss" => CLAUDE,
        "codex-oss" => CODEX,
        other => panic!("no usage text for {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::profile::ALL;

    #[test]
    fn every_front_end_lists_its_own_configuration_prefix() {
        for profile in ALL {
            let text = for_profile(profile);
            assert!(
                text.contains("Usage:"),
                "{} has no usage block",
                profile.name
            );
            assert!(
                text.contains(&format!("{}_<KEY>", profile.env_prefix)),
                "{} does not name its environment prefix",
                profile.name
            );
            assert!(
                text.contains(&format!("{}/config.toml", profile.config_name)),
                "{} does not name its config path",
                profile.name
            );
        }
    }
}
