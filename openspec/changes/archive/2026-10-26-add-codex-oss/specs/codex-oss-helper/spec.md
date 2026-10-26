# Spec Delta

## Purpose

`codex-oss` is the Codex CLI counterpart of `maki-oss`, `opencode-oss`, and
`claude-oss`: a thin, safe workflow helper that creates and manages a
per-project OpenShell sandbox running Codex natively, with the same
lifecycle, sync, policy, and provider features, and a ChatGPT-plan login
that stays on the host and the gateway.

## ADDED Requirements

### Requirement: Feature parity with maki-oss

`codex-oss` SHALL satisfy every `helper-cli` requirement with these
substitutions, and SHALL NOT satisfy the requirements that are Maki-only:

| `helper-cli` term | `codex-oss` term |
|---|---|
| `maki-oss` | `codex-oss` |
| `MAKI_OSS_*` env vars | `CODEX_OSS_*` |
| `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml` | `…/codex-oss/config.toml` |
| default image `maki-agent:local` | `codex-agent:local` |
| default policy `examples/policies/maki-minimal.yaml` | `codex-oss/policies/minimal.yaml` |
| default sandbox name `mk-{project}-{hash}` | `cx-{project}-{hash}` |
| registry agent tag `mk` | `cx` |
| curated profiles `examples/providers/` and its catalog | `codex-oss/providers/` and `stores.tsv` |
| `maki-oss maki` and bare `maki-oss` | `codex-oss codex` and bare `codex-oss` |
| "Maki" as the launched agent | Codex |

The state root `${XDG_STATE_HOME:-$HOME/.local/state}/osa/` is shared and is
not substituted. The Maki-only requirement is the `tui = "opencode"` bridge
mode. Provider setup follows the Codex provider setup requirement below
instead of the credential-store flow. The parity covers the same areas as
`claude-oss`:

- settings resolution
- up/status/start/stop/rm
- run with `--timeout`
- `--continue`/`--resume`, with the `--session-id` refusal below
- upload/download and safe patch sync
- the `--env` credential-name guard
- doctor
- confirmation on `rm`
- credential handling and remembering providers
- the shared session ensure routine and the no-provider behavior
- policy proposals and the post-session proposal check
- SIGINT/SIGTERM handling
- idle stop, which waits on the in-sandbox `codex` process
- `mcp status`

`codex-oss` SHALL NOT offer `fish install` or `fish uninstall`.

#### Scenario: Same command surface
- **WHEN** a user runs `codex-oss help`
- **THEN** it lists `doctor`, `image build`, `init`/`up`, `codex`, `run`, `upload`, `download`, `status`, `list`, `logs`, `start`/`stop`, `rm`, `policy show|edit|apply|review|approve|reject`, `provider add|attach|list|setup`, `mcp status`, and `help`, and it does not list `maki`, `opencode`, `claude`, or `fish`

#### Scenario: Settings resolve with the Codex prefix
- **WHEN** `CODEX_OSS_IMAGE=custom:tag` is exported and `codex-oss up` creates a sandbox
- **THEN** the sandbox is created from `custom:tag`, and `CLAUDE_OSS_IMAGE` has no effect on `codex-oss`

#### Scenario: Safe sync after a session
- **WHEN** a `codex-oss run` session changes files in a git project whose host tree still matches the uploaded baseline
- **THEN** the helper collects a patch on exit and applies it to the host by the same rules as `maki-oss`, keeping its sync state under `.codex-oss`

#### Scenario: Credential guard
- **WHEN** a user passes `--env CODEX_CHATGPT_TOKEN=x` to `codex-oss up`
- **THEN** the helper refuses it, exactly as `maki-oss` refuses a credential-like name, unless `--allow-env CODEX_CHATGPT_TOKEN` is given

#### Scenario: osa sees Codex projects
- **WHEN** `codex-oss up` registers a project and the user runs `osa projects --json` and `osa status --json` in that folder
- **THEN** the entry has agent `cx`, and its full status matches what `codex-oss status` reports

### Requirement: Codex launch contract

- **Headless:** `codex-oss run "<prompt>"` SHALL execute
  `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`,
  followed by the resolved `-m` model and session arguments and the prompt.
  Its stdin SHALL be closed, so the run cannot wait on input. It SHALL
  stream Codex's stdout unchanged and exit with Codex's exit code. With
  `--timeout`, it uses the same in-sandbox wrapper as `maki-oss`.
- **Interactive:** bare `codex-oss` and `codex-oss codex` SHALL attach
  `codex --dangerously-bypass-approvals-and-sandbox` on a TTY, followed by
  the resolved `-m` model and session arguments.
- **Account header:** both modes SHALL receive
  `CODEX_CHATGPT_ACCOUNT_ID` from the helper's configuration as a per-exec
  environment value. It is not a credential and is never written into the
  sandbox. When it is not configured, the helper SHALL fail before any
  sandbox work and name `codex-oss provider setup` as the fix.

The helper MUST NOT pass `-c`, `--profile`, `--ignore-rules`,
`--dangerously-bypass-hook-trust`, `--oss`, or any option that overrides the
image's managed configuration.

#### Scenario: Headless argv
- **WHEN** a user runs `codex-oss run --model gpt-5.6-terra "reply OK"` against the test stub
- **THEN** the stub receives `exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-terra "reply OK"` with stdin at end of file and `CODEX_CHATGPT_ACCOUNT_ID` in the exec environment

#### Scenario: Interactive argv
- **WHEN** a user runs bare `codex-oss` against the test stub on a TTY
- **THEN** the stub receives `--dangerously-bypass-approvals-and-sandbox` and no `exec`

#### Scenario: Missing account ID
- **WHEN** the configuration has no account ID and the user runs `codex-oss run "hi"`
- **THEN** it exits 1 naming `codex-oss provider setup`, and no gateway command runs

#### Scenario: Exit code passes through
- **WHEN** the in-sandbox `codex` exits 3
- **THEN** `codex-oss run` exits 3

### Requirement: Model delivery

The resolved model (from `--model`, `CODEX_OSS_MODEL`, or the config file's
`model`) SHALL reach Codex as `-m <model>` in both headless and interactive
mode. The helper MUST NOT write the model into the project tree or into the
sandbox's Codex configuration. With no resolved model, Codex's own default
applies, and `doctor` SHALL report the model as Codex's default.

#### Scenario: Model reaches the TUI
- **WHEN** `model = "gpt-6-astra"` is in the config file and the user runs bare `codex-oss` against the test stub
- **THEN** the stub receives `-m gpt-6-astra`, and the helper writes the model to no file in the project or the sandbox

### Requirement: Session flag mapping

The helper SHALL map the shared session options to Codex's resume command:

| Option | Headless | Interactive |
|---|---|---|
| `--continue` | `codex exec resume --last …` | `codex resume --last --include-non-interactive …` |
| `--resume ID` | `codex exec resume … ID` | `codex resume … ID` |

`--session-id` SHALL be a usage error that says Codex cannot create a
session with a chosen ID and names `--resume`. Combining `--continue` with
`--resume` SHALL be a usage error. Both errors SHALL be raised before any
sandbox work.

#### Scenario: Continue a headless run
- **WHEN** a user runs `codex-oss run --continue "next"` against the test stub
- **THEN** the stub receives `exec resume --last` with the launch flags and the prompt `next`

#### Scenario: Interactive continue includes runs
- **WHEN** a user runs `codex-oss --continue` against the test stub on a TTY
- **THEN** the stub receives `resume --last --include-non-interactive`

#### Scenario: Resume by ID
- **WHEN** a user runs `codex-oss run --resume 0199aa00-0000-7000-8000-000000000001 "next"` against the test stub
- **THEN** the stub receives `exec resume` with that ID followed by the prompt

#### Scenario: Session ID refused
- **WHEN** a user runs `codex-oss run --session-id abc "hi"`
- **THEN** it exits 1 with a usage error naming `--resume`, and no gateway command runs

### Requirement: Codex provider setup

`codex-oss provider setup` SHALL set up the `codex-chatgpt` provider from a
ChatGPT login made on the host:

- It SHALL run the host's `codex login` with a new, empty, private
  `CODEX_HOME` and file credential storage, using the browser flow by
  default and device-code login with `--device-auth`. With
  `--device-auth`, it SHALL first say that device-code login must be
  enabled in the ChatGPT security settings.
- It SHALL read the access token, refresh token, account ID, OAuth client
  ID, and access-token expiry from that login. It SHALL read the client ID
  and expiry from the token claims, not from a constant.
- It SHALL import the `codex-chatgpt` profile when missing, create or update
  the `codex-chatgpt` provider with the access token, and configure gateway
  refresh with the client ID, the refresh token as secret material, and the
  expiry.
- It SHALL store the account ID as `account_id` in
  `~/.config/codex-oss/config.toml`.
- It SHALL delete the temporary `CODEX_HOME` on success, on failure, and on
  interrupt.
- It MUST NOT read, write, or copy the host's `~/.codex`, and MUST NOT pass
  any token value in an argument, a file outside the temporary home, or its
  output.

Running it again SHALL replace the provider's credential and refresh
configuration with a new login. The `--from`, `--file`, `--field`, and
`--env` sources SHALL be usage errors that name the login flow. Without a `codex`
binary on the host, it SHALL exit 2 and say how to install one.

#### Scenario: Setup from a host login
- **WHEN** the user runs `codex-oss provider setup --yes` with the test stub's `codex login` producing a login
- **THEN** the helper imports the profile, creates provider `codex-chatgpt`, configures refresh with the stub token's client ID and expiry, writes `account_id` to the config file, removes the temporary home, and no token value appears in any argument, file, or output

#### Scenario: Host Codex home untouched
- **WHEN** the user runs `codex-oss provider setup --yes` on a host with a `~/.codex` directory
- **THEN** no file under `~/.codex/` is opened or changed

#### Scenario: Interrupted login cleans up
- **WHEN** the stub `codex login` is interrupted
- **THEN** the temporary `CODEX_HOME` no longer exists and no provider is created

#### Scenario: Store source refused
- **WHEN** the user runs `codex-oss provider setup --from maki --credential openai`
- **THEN** it exits 1 with a usage error naming the ChatGPT login flow

### Requirement: Refresh health in doctor

`doctor` SHALL report the `codex-chatgpt` refresh status from the gateway:

- `ok` with the expiry when refresh is configured and the last refresh
  succeeded;
- `warn` when refresh is not configured, when the last refresh failed, or
  when the credential expires within 24 hours;
- `warn` when the gateway's recorded lifetime (expiry minus last refresh)
  is not longer than the profile's refresh lead time, which means the
  gateway refreshes continuously, naming the README section that explains
  it.

These checks SHALL NOT change the exit code, and a missing gateway or
provider SHALL skip them.

#### Scenario: Continuous refresh detected
- **WHEN** the stub reports an expiry one hour after the last refresh and the profile's refresh lead time is one hour
- **THEN** `codex-oss doctor` prints a `warn` line about continuous refresh, and the exit code is unaffected

#### Scenario: Healthy refresh
- **WHEN** the stub reports a configured refresh that succeeded with an expiry nine days away
- **THEN** `codex-oss doctor` prints an `ok` line with the expiry

### Requirement: Codex MCP status

`codex-oss mcp status` SHALL compare the servers in the `[mcp_servers.<name>]`
tables of the host's Codex configuration (`${CODEX_HOME:-~/.codex}/config.toml`)
with those in the sandbox's `/sandbox/.codex/config.toml`. It SHALL report one
line per server name with the same gate vocabulary as `maki-oss mcp status`,
and SHALL expect the provider for server `<name>` to be named
`codex-mcp-<name>`. A server with a `url` SHALL count as http with the URL's
hostname, and a server with a `command` SHALL count as stdio with that
command. A server with `enabled = false` SHALL count as disabled. `doctor`
SHALL include the same table. A file whose MCP servers are not written as
tables SHALL be reported as unreadable, naming the table form.

#### Scenario: Host server missing in the sandbox
- **WHEN** the host config has `[mcp_servers.docs]` with a `url` and the sandbox config has no such table
- **THEN** `codex-oss mcp status` reports `docs` with the same not-in-sandbox gate that `maki-oss` uses, and names provider `codex-mcp-docs`

#### Scenario: Inline-table servers
- **WHEN** the sandbox config defines `mcp_servers` as an inline table
- **THEN** the report names that file as unreadable and names the table form

### Requirement: Codex image build

`codex-oss image build` SHALL build `codex-oss/image` with the configured
engine and tag the result with the resolved image (default
`codex-agent:local`). `--codex-version V` SHALL pass the version as a build
argument. Because the Dockerfile pins per-architecture checksums, the helper
SHALL fail the build rather than skip verification when the version has no
matching checksums, and SHALL say which build arguments need new values:
the checksums of both `codex` and `codex-code-mode-host`.

#### Scenario: Version without checksums
- **WHEN** a user runs `codex-oss image build --codex-version 9.9.9`
- **THEN** the build fails, the helper exits 2, and the error names the checksum build arguments
