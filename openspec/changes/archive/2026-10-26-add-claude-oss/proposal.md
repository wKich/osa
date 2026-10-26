# Proposal: add-claude-oss

## Why

osa runs Maki and OpenCode inside OpenShell sandboxes, but Claude Code, the
third agent on the roadmap (G4, A5), still runs only on the host. Conveyor
already parses Claude's stream format, so a sandboxed Claude runner is the
missing piece. The shared core `lib/oss-core.sh` now makes a new agent a thin
front-end rather than a fork. A local check of Claude Code 2.1.310 showed both
of its credential forms fit OpenShell's placeholder substitution as they are:

- an API key travels in `x-api-key`;
- a `claude setup-token` subscription token travels in
  `Authorization: Bearer`.

So both the per-call API and Pro/Max subscriptions can work with no
credential inside the sandbox and no in-sandbox login.

## What Changes

- Add a `claude-oss/` subproject next to `opencode-oss/`:
  - `image/Dockerfile`: an agent-only base image (`claude-agent:local`). It
    installs the official native Claude Code binary at a pinned version,
    checked against a per-architecture SHA-256, at
    `/usr/local/bin/claude`. The image has no Node or Bun runtime, runs as
    uid/gid 1500, and leaves Claude Code on its default `~/.claude/` and
    `~/.claude.json` under `/sandbox`.
  - `image/managed-settings.json`: root-owned Claude Code managed settings at
    `/etc/claude-code/managed-settings.json`. They hold deny rules that apply
    in every permission mode, and an `env` block that turns off auto-update,
    telemetry, error reporting, and other nonessential traffic.
  - `image/claude.json`: a seed for `/sandbox/.claude.json` that marks
    onboarding done and trusts the sandbox project directory, so the TUI
    opens without first-run screens.
  - `image/approve-api-key`: a root-owned launcher step that approves the
    attached API key placeholder before an interactive session, because
    Claude Code's own approval prompt defaults to ignoring the key.
  - `providers/claude-anthropic.yaml`: binds `ANTHROPIC_API_KEY` as the
    `x-api-key` header.
  - `providers/claude-anthropic-oauth.yaml`: binds `CLAUDE_CODE_OAUTH_TOKEN`
    as a bearer token.
  - Both profiles allow only `api.anthropic.com:443` and only the binary
    `/usr/local/bin/claude`. `catalog.tsv`, `stores.tsv`, and `template.yaml`
    complete the provider set.
  - `policies/minimal.yaml`: the same filesystem, Landlock, and process
    floor as the other agents.
  - `README.md`: the guide, with the helper first and the raw commands as
    the fallback, plus the recorded verification.
- Add `bin/claude-oss`, a Claude Code front-end over `lib/oss-core.sh`. It
  has the `opencode-oss` command surface, minus `fish`.
  - **Identity:** `CLAUDE_OSS_*` environment variables,
    `~/.config/claude-oss/config.toml`, sandbox names
    `cc-{project}-{hash}`, and registry agent tag `cc`.
  - **Headless:** `claude -p --output-format stream-json --verbose
    --dangerously-skip-permissions`, with stdin closed.
  - **Interactive:** `claude --dangerously-skip-permissions` on a TTY.
  - **Model:** passed with `--model` in both modes.
  - **Sessions:** `--continue`, `--resume ID`, and `--session-id UUID` pass
    through. The helper refuses a `--session-id` that is not a UUID before
    any sandbox work.
  - **`provider setup`:** takes an API key, or a token produced by
    `claude setup-token` on the host. `doctor` warns when both providers are
    attached, because the API key then takes precedence.
  - **`mcp status`:** compares the `mcpServers` entries in the host and
    sandbox `.claude.json` files.
- Teach `bin/osa` the `cc` tag, add `docs/claude-oss.md`, add a root
  `README.md` pointer, and add Makefile lint and test entries.
- **Not in this change:** providers that need `ANTHROPIC_BASE_URL` (Z.ai,
  Kimi, DeepSeek, MiniMax, Synthetic), Bedrock and Vertex, mounting host
  `~/.claude` or `~/.config/anthropic`, Claude Code's built-in bubblewrap
  sandbox, the fish plugin, the dashboard, oskhs, and Conveyor runner work.

## Capabilities

### New Capabilities

- `claude-oss`: running Claude Code natively inside an OpenShell sandbox.
  Covers the pinned agent-only image, the managed settings and their deny
  and traffic rules, the first-run seed, the two Claude-bound provider
  profiles and their credential headers, the minimal policy, egress
  limited to the model endpoint, and the documented and verified headless,
  interactive, and file-transfer workflows.
- `claude-oss-helper`: the `claude-oss` command. It has parity with
  `helper-cli` under the Claude substitutions, plus Claude-specific
  requirements for launch, session-flag mapping, provider setup with the
  subscription token, provider precedence in `doctor`, and MCP status.

### Modified Capabilities

- `osa-project-layer`: the "Shared state root" requirement lists the agent
  front-ends that share the state root. It gains `claude-oss`.

## Impact

- **New:** `claude-oss/`, `bin/claude-oss`, `docs/claude-oss.md`, and Claude
  cases in `tests/run-tests.sh` with a `tests/stub/claude` stub.
- **Modified:** `bin/osa` (the `cc` tag), root `README.md` (one pointer),
  `Makefile` (lint and test targets), and `AGENTS.md` (the same
  placeholder and no-in-sandbox-login rules, stated for Claude Code).
  `lib/oss-core.sh` changes only if a hook gap turns up, and then without
  changing `maki-oss` or `opencode-oss` behavior, which their unchanged
  tests prove.
- **Dependencies:** `downloads.claude.ai` or GitHub releases at image build
  time only. At run time the sandbox reaches only `api.anthropic.com`.
- **OpenShell state:** users import a third set of profiles (`claude-*`).
  A Claude sandbox attaches `claude-anthropic` or `claude-anthropic-oauth`,
  never `maki-anthropic` or `opencode-anthropic`.
- **Accounts:** a subscription token from `claude setup-token` is valid for
  a year and limited to inference. It lives only in the OpenShell provider
  record on the gateway, like every other credential.

Upstream references:

- Claude Code setup (versions, manifest, checksums, signing):
  https://code.claude.com/docs/en/setup.md
- Authentication precedence (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`,
  `setup-token`): https://code.claude.com/docs/en/authentication.md
- CLI flags (`-p`, `--output-format`, `--session-id`, `--resume`):
  https://code.claude.com/docs/en/cli-reference.md and
  https://code.claude.com/docs/en/headless.md
- Managed settings and precedence:
  https://code.claude.com/docs/en/managed-settings.md and
  https://code.claude.com/docs/en/settings.md
- Permission modes (deny rules hold in bypass mode):
  https://code.claude.com/docs/en/permission-modes.md
- Network endpoints and the nonessential-traffic switch:
  https://code.claude.com/docs/en/network-config.md and
  https://code.claude.com/docs/en/data-usage.md
- Environment variables: https://code.claude.com/docs/en/env-vars.md
- MCP configuration: https://code.claude.com/docs/en/mcp.md
- OpenShell profiles (binaries, endpoints, credential binding):
  https://docs.nvidia.com/openshell/how-it-works/providers/profiles.md
- OpenShell sandboxes (create, exec, upload/download):
  https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md
