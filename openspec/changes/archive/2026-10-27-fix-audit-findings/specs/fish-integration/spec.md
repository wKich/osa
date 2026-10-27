# Spec Delta

## MODIFIED Requirements

### Requirement: Fisher-compatible plugin layout
The repository SHALL provide a fish plugin at `fish/` containing `functions/` and `completions/` entries for every front-end that ships a fish plugin: `maki-oss` and `opencode-oss` today, plus `conf.d/maki-oss.fish`, so that `fisher install ./fish` installs each function and its completions into a user's fish configuration. The function bodies SHALL share one implementation where the only difference is the command name and its environment override, so a behavior fix applies to both front-ends.

#### Scenario: Fresh install resolves the command
- **WHEN** a user runs `fisher install ./fish` and opens a new fish session with a stubbed `openshell` on `PATH`
- **THEN** `type maki-oss` and `type opencode-oss` report functions, `fish -n` reports no syntax errors for the installed files, and both commands print usage

### Requirement: Completions for commands and options
The completion files SHALL complete the subcommands `doctor`, `image`, `init`, `up`, `maki` (or `opencode`), `run`, `upload`, `download`, `status`, `list`, `logs`, `policy`, `provider`, `mcp`, `start`, `stop`, `rm`, `fish`, and `help`, plus the provider subcommands `add`, `attach`, `list`, and `setup`, the mcp subcommand `status`, and the common flags `--name`, `--image`, `--policy`, `--provider`, `--env`, `--env-from`, `--yes`, `--allow-env`, `--model`, `--from`, `--credential`, `--profile`, `--continue`, `--resume`, `--session-id`, `--timeout`, `--no-sync`, `--discard`, and `--idle-stop`. Each front-end MAY also complete its own image-version flag. A flag accepted by the helper MUST have a matching completion in every front-end that accepts it.

#### Scenario: Subcommand completion
- **WHEN** the user types `maki-oss ` and presses Tab in a fish session with the plugin installed
- **THEN** the completion list includes `doctor`, `up`, `run`, `status`, and `mcp`

#### Scenario: Flag completion
- **WHEN** the user types `maki-oss run --` and presses Tab
- **THEN** the completion list includes `--name`, `--yes`, `--model`, `--continue`, `--timeout`, and `--env-from`

#### Scenario: Opencode flag completion
- **WHEN** the user types `opencode-oss upload --` and presses Tab
- **THEN** the completion list includes `--discard` and `--env-from`

#### Scenario: Session resume completion
- **WHEN** the user types `maki-oss maki --res` and presses Tab
- **THEN** the completion list offers `--resume`, and `--continue` and `--session-id` are both offered after `maki-oss maki --`

#### Scenario: Provider setup completion
- **WHEN** the user types `maki-oss provider ` and presses Tab
- **THEN** the completion list includes `setup`

#### Scenario: MCP subcommand completion
- **WHEN** the user types `maki-oss mcp ` and presses Tab
- **THEN** the completion list includes `status`

### Requirement: Symlink fallback install
`maki-oss fish install` and `opencode-oss fish install` SHALL install their function and completion entries without fisher by symlinking them into `${XDG_CONFIG_HOME:-$HOME/.config}/fish`, and SHALL be idempotent. Each SHALL share one install/uninstall implementation so the link-safety rules cannot drift. `fish uninstall` SHALL remove only links that point into this repository and SHALL leave foreign files untouched.

#### Scenario: Idempotent symlink install
- **WHEN** the user runs `maki-oss fish install` or `opencode-oss fish install` twice
- **THEN** both runs exit 0, the second reports the plugin is already installed, and no duplicate or broken links exist

#### Scenario: Uninstall leaves user files alone
- **WHEN** the user has a file in `~/.config/fish/functions/` that was not installed by the helper and runs `maki-oss fish uninstall` or `opencode-oss fish uninstall`
- **THEN** that file is not deleted and the command reports it was skipped
