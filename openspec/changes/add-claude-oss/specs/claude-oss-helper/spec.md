# Spec Delta

## Purpose

`claude-oss` is the Claude Code counterpart of `maki-oss` and `opencode-oss`:
a thin, safe workflow helper that creates and manages a per-project OpenShell
sandbox running Claude Code natively, with the same lifecycle, sync, policy,
and provider features.

## ADDED Requirements

### Requirement: Feature parity with maki-oss

`claude-oss` SHALL satisfy every `helper-cli` requirement with these
substitutions, and SHALL NOT satisfy the requirements that are Maki-only:

| `helper-cli` term | `claude-oss` term |
|---|---|
| `maki-oss` | `claude-oss` |
| `MAKI_OSS_*` env vars | `CLAUDE_OSS_*` |
| `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml` | `…/claude-oss/config.toml` |
| default image `maki-agent:local` | `claude-agent:local` |
| default policy `examples/policies/maki-minimal.yaml` | `claude-oss/policies/minimal.yaml` |
| default sandbox name `mk-{project}-{hash}` | `cc-{project}-{hash}` |
| registry agent tag `mk` | `cc` |
| curated profiles `examples/providers/` and its catalog | `claude-oss/providers/` and `stores.tsv` |
| `maki-oss maki` and bare `maki-oss` | `claude-oss claude` and bare `claude-oss` |
| "Maki" as the launched agent | Claude Code |

The state root `${XDG_STATE_HOME:-$HOME/.local/state}/osa/` is shared and is
not substituted. The Maki-only requirement is the `tui = "opencode"` bridge
mode. The parity covers the same areas as `opencode-oss`:

- settings resolution
- up/status/start/stop/rm
- run with `--timeout`
- `--continue`/`--resume`/`--session-id`
- upload/download and safe patch sync
- the `--env` credential-name guard
- doctor
- confirmation on `rm`
- provider setup, credential handling, and remembering providers
- the shared session ensure routine and the no-provider behavior
- policy proposals and the post-session proposal check
- SIGINT/SIGTERM handling
- idle stop, which waits on the in-sandbox `claude` process
- `mcp status`

`claude-oss` SHALL NOT offer `fish install` or `fish uninstall`.

#### Scenario: Same command surface
- **WHEN** a user runs `claude-oss help`
- **THEN** it lists `doctor`, `image build`, `init`/`up`, `claude`, `run`, `upload`, `download`, `status`, `list`, `logs`, `start`/`stop`, `rm`, `policy show|edit|apply|review|approve|reject`, `provider add|attach|list|setup`, `mcp status`, and `help`, and it does not list `maki`, `opencode`, or `fish`

#### Scenario: Settings resolve with the Claude prefix
- **WHEN** `CLAUDE_OSS_IMAGE=custom:tag` is exported and `claude-oss up` creates a sandbox
- **THEN** the sandbox is created from `custom:tag`, and `MAKI_OSS_IMAGE` and `OPENCODE_OSS_IMAGE` have no effect on `claude-oss`

#### Scenario: Safe sync after a session
- **WHEN** a `claude-oss run` session changes files in a git project whose host tree still matches the uploaded baseline
- **THEN** the helper collects a patch on exit and applies it to the host by the same rules as `maki-oss`, keeping its sync state under `.claude-oss`

#### Scenario: Credential guard
- **WHEN** a user passes `--env CLAUDE_CODE_OAUTH_TOKEN=x` to `claude-oss up`
- **THEN** the helper refuses it, exactly as `maki-oss` refuses a credential-like name, unless `--allow-env CLAUDE_CODE_OAUTH_TOKEN` is given

#### Scenario: osa sees Claude projects
- **WHEN** `claude-oss up` registers a project and the user runs `osa projects --json` and `osa status --json` in that folder
- **THEN** the entry has agent `cc`, and its full status matches what `claude-oss status` reports

### Requirement: Claude Code launch contract

- **Headless:** `claude-oss run "<prompt>"` SHALL execute
  `claude -p --output-format stream-json --verbose --dangerously-skip-permissions`,
  followed by the resolved `--model` and session flags and the prompt. Its
  stdin SHALL be closed, so the run cannot wait on input. It SHALL stream
  Claude Code's stdout unchanged and exit with Claude Code's exit code.
  With `--timeout`, it uses the same in-sandbox wrapper as `maki-oss`.
- **Interactive:** bare `claude-oss` and `claude-oss claude` SHALL run the
  image's API key launcher step and then attach
  `claude --dangerously-skip-permissions` on a TTY, followed by the
  resolved `--model` and session flags.

The helper MUST NOT pass `--bare`, `--settings`, or a permission flag that
weakens the image's managed settings.

#### Scenario: Headless argv
- **WHEN** a user runs `claude-oss run --model claude-sonnet-5-5 "reply OK"` against the test stub
- **THEN** the stub receives `-p --output-format stream-json --verbose --dangerously-skip-permissions --model claude-sonnet-5-5 "reply OK"` with stdin at end of file

#### Scenario: Interactive argv
- **WHEN** a user runs `claude-oss --continue` against the test stub on a TTY
- **THEN** the sandbox exec runs the launcher step first, and the stub receives `--dangerously-skip-permissions --continue` and no `-p`

#### Scenario: Exit code passes through
- **WHEN** the in-sandbox `claude` exits 3
- **THEN** `claude-oss run` exits 3

### Requirement: Model delivery

The resolved model (from `--model`, `CLAUDE_OSS_MODEL`, or the config file's
`model`) SHALL reach Claude Code as `--model <model>` in both headless and
interactive mode. The helper MUST NOT write the model into the project tree
or into the sandbox's Claude Code settings or state. With no resolved model, Claude
Code's own default applies, and `doctor` SHALL report the model as Claude
Code's default.

#### Scenario: Model reaches the TUI
- **WHEN** `model = "claude-opus-5-5"` is in the config file and the user runs bare `claude-oss` against the test stub
- **THEN** the stub receives `--model claude-opus-5-5`, and the helper writes the model to no file in the project or the sandbox

### Requirement: Session flag mapping

The helper SHALL pass the shared session options through to Claude Code:

- `--continue` → `--continue`
- `--resume ID` → `--resume ID`
- `--session-id ID` → `--session-id ID`

A `--session-id` value that is not a UUID SHALL be a usage error. Combining
`--session-id` with `--continue` or `--resume`, or `--continue` with
`--resume`, SHALL be a usage error. Both errors SHALL be raised before any
sandbox work.

#### Scenario: Non-UUID session ID
- **WHEN** a user runs `claude-oss run --session-id abc "hi"`
- **THEN** it exits 1 with a usage error naming the UUID format, and no gateway command runs

#### Scenario: UUID session ID passes through
- **WHEN** a user runs `claude-oss run --session-id 123e4567-e89b-12d3-a456-426614174000 "hi"` against the test stub
- **THEN** the stub receives `--session-id 123e4567-e89b-12d3-a456-426614174000`

#### Scenario: Conflicting session options
- **WHEN** a user combines `--resume ID` with `--session-id UUID`
- **THEN** it exits 1 with a usage error before any sandbox work

### Requirement: Claude provider setup

`claude-oss provider setup` SHALL resolve a credential to one of the
`claude-*` profiles:

- an Anthropic API key, from the Maki or OpenCode credential store through
  `claude-oss/providers/stores.tsv`, a JSON file, the host env var
  `ANTHROPIC_API_KEY`, or a hidden prompt, maps to `claude-anthropic`;
- a subscription token, from the host env var `CLAUDE_CODE_OAUTH_TOKEN`, a
  JSON file, or a hidden prompt, maps to `claude-anthropic-oauth`.

When the user picks the subscription route without a token, the wizard SHALL
tell them to run `claude setup-token` on the host. It MUST NOT read the
host's Claude Code login state (`~/.claude/.credentials.json`, the system
keychain, or `~/.config/anthropic`). Credential values SHALL be handled
exactly as `helper-cli` requires: only in the child process environment,
never in arguments, files, or output. Custom profiles it generates SHALL use
the `claude-` ID prefix and bind `/usr/local/bin/claude`. On success, it
SHALL print the provider's example model from `catalog.tsv` and how to set
it as the default `model`.

#### Scenario: Token from the host environment
- **WHEN** `CLAUDE_CODE_OAUTH_TOKEN` is set on the host and the user runs `claude-oss provider setup --env CLAUDE_CODE_OAUTH_TOKEN --yes`
- **THEN** the helper creates or updates provider `claude-anthropic-oauth`, and the token appears in no argument, file, or output

#### Scenario: Stored Anthropic key
- **WHEN** the Maki store holds an `anthropic` key and the user picks it in the wizard
- **THEN** the helper creates or updates provider `claude-anthropic`

#### Scenario: Host login state is not read
- **WHEN** the user runs `claude-oss provider setup` on a host with a Claude Code login
- **THEN** the helper opens no file under `~/.claude/` or `~/.config/anthropic/` and makes no keychain query

### Requirement: Credential precedence warning

Claude Code uses an API key in preference to a subscription token. `doctor`
SHALL warn when both `claude-anthropic` and `claude-anthropic-oauth` are
attached to the project sandbox, naming the API key as the one in use and
`provider` commands as the fix. The warning SHALL NOT change the exit code.

#### Scenario: Both credentials attached
- **WHEN** both Claude providers are attached and the user runs `claude-oss doctor`
- **THEN** the output has a `warn` line naming `claude-anthropic` as the credential in use, and the exit code is unaffected

### Requirement: Claude MCP status

`claude-oss mcp status` SHALL compare the servers under the top-level
`mcpServers` key of the host's Claude Code user config
(`${CLAUDE_CONFIG_DIR}/.claude.json` when `CLAUDE_CONFIG_DIR` is set, else
`~/.claude.json`) with those in the sandbox's `/sandbox/.claude.json`. It SHALL report one line per server name
with the same gate vocabulary as `maki-oss mcp status`, and SHALL expect the
provider for server `<name>` to be named `claude-mcp-<name>`. Servers of
type `http` or `sse` SHALL count as http with the URL's hostname. Servers
with a `command` SHALL count as stdio with that command. `doctor` SHALL
include the same table. A file that cannot be parsed as JSON SHALL be
reported as unreadable.

#### Scenario: Host server missing in the sandbox
- **WHEN** the host config lists an http server `docs` and the sandbox config does not
- **THEN** `claude-oss mcp status` reports `docs` with the same not-in-sandbox gate that `maki-oss` uses, and names provider `claude-mcp-docs`

#### Scenario: Unreadable config
- **WHEN** the sandbox `.claude.json` is not valid JSON
- **THEN** the report names that file as unreadable instead of listing servers

### Requirement: Claude image build

`claude-oss image build` SHALL build `claude-oss/image` with the configured
engine and tag the result with the resolved image (default
`claude-agent:local`). `--claude-version V` SHALL pass the version as a
build argument. Because the Dockerfile pins per-architecture checksums, the
helper SHALL fail the build rather than skip verification when the version
has no matching checksums, and SHALL say which build arguments need new
values.

#### Scenario: Version without checksums
- **WHEN** a user runs `claude-oss image build --claude-version 9.9.9`
- **THEN** the build fails, the helper exits 2, and the error names the checksum build arguments
