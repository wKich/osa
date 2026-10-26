# claude-oss Specification

## Purpose

Runs the Claude Code agent natively inside an NVIDIA OpenShell sandbox with
the same isolation guarantees as the Maki and OpenCode paths: a pinned
agent-only image, credentials only through provider profiles, deny-by-default
egress, and explicit file transfer.

## Requirements

### Requirement: Pinned agent-only Claude Code image

The repository SHALL provide a Docker build context under `claude-oss/image`
that builds an image (default tag `claude-agent:local`) containing the
official native Claude Code binary at `/usr/local/bin/claude`. The binary
SHALL be pinned to an exact version by a single build argument and verified
against a per-architecture SHA-256 before it is installed. The build SHALL
fail when the checksum does not match. The image MUST run as uid/gid 1500
with home `/sandbox`. Claude Code SHALL use its default locations under that
home, `/sandbox/.claude/` and `/sandbox/.claude.json`, because
`openshell sandbox exec` does not pass image environment variables to the
agent. The image MUST NOT contain a Node.js or Bun runtime, an MCP server definition, a
Claude Code plugin, a credential value, or any Claude Code login state. It
SHALL build on both arm64 and amd64 hosts.

#### Scenario: Version is pinned
- **WHEN** the image is built without build arguments and `claude --version` runs in it
- **THEN** it prints the version that the Dockerfile's version argument pins

#### Scenario: Checksum mismatch fails the build
- **WHEN** the version argument is changed and the SHA-256 arguments are not
- **THEN** the build fails before `/usr/local/bin/claude` is installed

#### Scenario: Image runs as the sandbox user
- **WHEN** `id` and `echo $HOME` run in a sandbox created from the image
- **THEN** they report uid and gid 1500 and `/sandbox`

#### Scenario: Image is agent-only
- **WHEN** the image filesystem is searched for `node`, `bun`, MCP server definitions, and plugin directories
- **THEN** none are found

#### Scenario: Image carries no credential
- **WHEN** the image filesystem and environment are searched for API keys, OAuth tokens, `.credentials.json`, and `~/.config/anthropic` profiles
- **THEN** none are found

### Requirement: Managed settings hold the guardrails

The image SHALL ship Claude Code managed settings at
`/etc/claude-code/managed-settings.json`, owned by root and not writable by
uid 1500. The settings SHALL:

- deny these tool actions: `sudo`, `su`, `ssh`, `scp`, the `claude`
  authentication subcommands (`setup-token`, `auth`, `login`), and file
  edits (which cover writes) under `/sandbox/.claude/`, `/etc/claude-code/`,
  and `/usr/local/libexec/claude-oss/`, and of `/sandbox/.claude.json`;
- set, through their `env` block, the switches that turn off auto-update,
  telemetry, error reporting, and other nonessential traffic;
- suppress the bypass-mode confirmation dialog.

The settings MUST NOT contain a catch-all allow rule, an `apiKeyHelper`, a
forced login method or organization, a base-URL override, an MCP server, a
plugin, or an enabled built-in sandbox. The pinned Claude Code version MUST
accept the settings without a settings error. The deny rules MUST still
apply when a session runs with `--dangerously-skip-permissions`.

#### Scenario: Settings are accepted
- **WHEN** `claude -p` runs in the image with the managed settings in place
- **THEN** it reports no settings or schema error

#### Scenario: Settings cannot be changed by the agent
- **WHEN** uid 1500 tries to write `/etc/claude-code/managed-settings.json`
- **THEN** the write fails

#### Scenario: Deny wins under bypass mode
- **WHEN** a headless run with `--dangerously-skip-permissions` is asked to run `sudo -n true` and to write a file under `/sandbox/.claude/`
- **THEN** Claude Code refuses both actions, and the file is not created

### Requirement: First run needs no interaction

An interactive Claude Code session in a fresh sandbox SHALL open on the
prompt with no onboarding, theme picker, folder trust dialog, or bypass-mode
confirmation. The trust state SHALL cover the default in-sandbox project
directory, `/sandbox/project`. The seed state SHALL contain no credential
value.

Claude Code asks once whether to use an `ANTHROPIC_API_KEY` found in the
environment, and its default answer, No, makes it ignore the key from then
on. The image SHALL therefore ship a root-owned launcher step,
`/usr/local/libexec/claude-oss/approve-api-key`, that records the attached
key's placeholder as approved in `/sandbox/.claude.json` inside the sandbox
before an interactive session starts. The step SHALL do nothing when no API
key is attached. Trust for a custom `--workdir`, which cannot be seeded,
SHALL be asked at most once per sandbox.

#### Scenario: Fresh sandbox opens on the prompt
- **WHEN** a sandbox is created from `claude-agent:local` with `claude-anthropic` attached and a project uploaded, and the launcher step followed by `claude --dangerously-skip-permissions` attaches on a TTY in `/sandbox/project`
- **THEN** the first screen is the Claude Code prompt, with no onboarding, trust, bypass, or API key prompt

#### Scenario: Second session asks nothing
- **WHEN** a second interactive session attaches to the same sandbox
- **THEN** no approval or trust prompt is shown

#### Scenario: Launcher step without an API key
- **WHEN** only `claude-anthropic-oauth` is attached and the launcher step runs
- **THEN** it exits 0 without changing `/sandbox/.claude.json`

### Requirement: Claude-bound provider profiles

The repository SHALL provide OpenShell provider profiles under
`claude-oss/providers/`:

- `claude-anthropic`: binds `ANTHROPIC_API_KEY` as the `x-api-key` header.
- `claude-anthropic-oauth`: binds `CLAUDE_CODE_OAUTH_TOKEN` as a bearer
  token in the `authorization` header.

Each profile SHALL allow only `api.anthropic.com` on port 443 and SHALL
authorize only the binary `/usr/local/bin/claude`. A `catalog.tsv` SHALL map
each profile ID to its credential env var and an example model.

#### Scenario: Every profile lints
- **WHEN** `openshell profile lint --from claude-oss/providers` runs
- **THEN** every profile passes

#### Scenario: Profiles authorize only Claude Code
- **WHEN** the `binaries` lists of all profiles under `claude-oss/providers/` are read
- **THEN** each one is exactly `/usr/local/bin/claude`

#### Scenario: Catalog matches profiles
- **WHEN** `catalog.tsv` is compared with the profile files
- **THEN** every catalog row names an existing profile, and every profile has a row

### Requirement: Minimal Claude sandbox policy

The repository SHALL provide `claude-oss/policies/minimal.yaml` that grants
read-write access only to `/sandbox`, `/tmp`, and `/dev/null`, grants
read-only access to system paths, requires Landlock as a hard requirement,
runs processes as uid/gid 1500, and grants no network egress of its own.

#### Scenario: Filesystem floor holds in a sandbox
- **WHEN** a process in a sandbox created with this policy writes to `/sandbox/x`, `/tmp/x`, and `/etc/x`
- **THEN** the first two succeed and the write to `/etc/x` fails

### Requirement: Credentials only through provider profiles

A Claude sandbox SHALL receive model credentials only from an attached
OpenShell provider profile. The guide MUST NOT instruct:

- passing a credential through `--env` or `--env-from`;
- logging in inside the sandbox (`/login`, `claude auth`, `claude setup-token`);
- setting `ANTHROPIC_BASE_URL` or an `apiKeyHelper`;
- mounting or uploading the host's `~/.claude`, `~/.claude.json`, or
  `~/.config/anthropic`.

The subscription token SHALL be created with `claude setup-token` on the
host. No file under `claude-oss/` may contain the literal
provider-placeholder prefix.

#### Scenario: Sandbox sees only an opaque stand-in
- **WHEN** `claude-anthropic-oauth` is attached and `printenv CLAUDE_CODE_OAUTH_TOKEN` runs in the sandbox
- **THEN** the value is not the real token

#### Scenario: Subscription token authenticates through the proxy
- **WHEN** `claude-anthropic-oauth` is the only attached provider and a headless run starts
- **THEN** the run completes with a model reply

#### Scenario: API key authenticates through the proxy
- **WHEN** `claude-anthropic` is the only attached provider and a headless run starts
- **THEN** the run completes with a model reply

#### Scenario: No placeholder spelling in the subproject
- **WHEN** every file under `claude-oss/` is searched for the provider-placeholder prefix
- **THEN** no match is found

### Requirement: Egress limited to the model endpoint

A Claude sandbox SHALL reach only the endpoints contributed by its attached
provider profile. Claude Code's update check, telemetry, error reporting,
feedback, claude.ai connectors, plugin marketplaces, and any other outbound
call MUST be either disabled by configuration or denied by the sandbox. A
denial MUST NOT prevent a headless run from completing.

#### Scenario: No call outside the profile
- **WHEN** a headless run and an interactive session complete and the sandbox logs are read
- **THEN** they show no allowed or denied connection by `/usr/local/bin/claude` to any host other than `api.anthropic.com`

#### Scenario: Run completes with egress restricted
- **WHEN** a headless run starts in a sandbox whose only egress comes from one Claude profile
- **THEN** it exits 0 with a result event

### Requirement: Documented and verified workflows

The guide SHALL document, and the verification SHALL demonstrate:

- a headless run with
  `claude -p --output-format stream-json --verbose --dangerously-skip-permissions --model <model> "<prompt>"`
  that returns machine-readable events ending in a result event;
- a continued session (`--continue` or `--resume <id>`);
- an interactive TUI started with `claude` over
  `openshell sandbox exec --tty`;
- both credential kinds.

#### Scenario: Headless run returns JSON
- **WHEN** the documented headless command runs with stdin from `/dev/null`
- **THEN** stdout is newline-delimited JSON whose last event is a result event, and the exit code is 0

#### Scenario: Session continues
- **WHEN** a second headless run passes `--resume` with the session ID from the first run's events
- **THEN** the reply shows knowledge of the first run's prompt

#### Scenario: Interactive TUI attaches
- **WHEN** the documented interactive command runs on a TTY
- **THEN** the Claude Code TUI opens in the project directory

### Requirement: Explicit file transfer

Project files SHALL move into and out of a Claude sandbox only through
`openshell sandbox upload` and `openshell sandbox download`. The guide MUST
NOT use host bind mounts or automatic sync.

#### Scenario: File created in the sandbox is downloaded
- **WHEN** a headless run creates a file in the project and the user downloads it
- **THEN** the file exists on the host with the content Claude Code wrote

### Requirement: Self-contained subproject with recorded verification

All Claude sandbox deliverables SHALL live under `claude-oss/`, except:

- the `bin/claude-oss` helper front-end
- the `cc` tag in `bin/osa`
- the shared helper core in `lib/`
- `docs/ai/playbooks/claude.md` and `docs/ai/reference/claude.md`
- the removed source `docs/claude-oss.md` (moved to the reference)
- the shared pages that point at them: `docs/ai/onboarding.md`,
  `docs/ai/host-playbook.md`, and `docs/ai/references.md`
- the Claude Code rules in `AGENTS.md`
- the `Makefile` lint and test entries and the Claude cases and stub in
  `tests/`
- one pointer from the root `README.md`

Claude work MUST NOT modify `bridge/`, `oskhs/`, `dashboard/`, `examples/`, or
`opencode-oss/`, or change the observable behavior of `bin/maki-oss` or
`bin/opencode-oss`. `claude-oss/README.md` SHALL record the verification
commands and their observed results for the pinned version.

#### Scenario: No cross-subproject edits

- **WHEN** `git diff --stat` for a Claude change is inspected
- **THEN** every changed path is under `claude-oss/`, `lib/`, `tests/`,
  `openspec/specs/`, or that change's `openspec/changes/` directory, or is
  `bin/claude-oss`, `bin/osa`, `docs/claude-oss.md` (the removed source),
  `docs/ai/playbooks/claude.md`, `docs/ai/reference/claude.md`,
  `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`, `docs/ai/references.md`,
  `Makefile`, or the root `README.md`
- **AND** no changed path is under `bridge/`, `oskhs/`, `dashboard/`,
  `examples/`, or `opencode-oss/`

#### Scenario: Other front-ends unchanged
- **WHEN** `make test` runs after the change
- **THEN** the existing `maki-oss` and `opencode-oss` cases pass unchanged

#### Scenario: Verification record exists
- **WHEN** `claude-oss/README.md` is read
- **THEN** it records the commands and observed output for the image, both credential kinds, headless, continued, interactive, and file-transfer checks at the pinned version
