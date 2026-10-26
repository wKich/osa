| Field | Value |
|---|---|
| Doc | `reference-claude` |
| Kind | `reference` |
| Agent | `Claude` |
| Covers | `P3-P8` |
| Verified | not yet verified |

# Reference: Claude Code

## Scope

The Claude Code path: Claude-specific paths and differences. The ordered path
is [the playbook](../playbooks/claude.md), the pinned run is the
[verification record](../../../claude-oss/README.md#verification-record);
shared behavior is in [helper](../../helper.md), [providers](../../providers.md),
and the [environment playbook](../environment-playbook.md). This is an index,
not a procedure, so `Verified` says `not yet verified`.

## Config paths

| | `maki-oss` | `claude-oss` |
|---|---|---|
| Environment prefix | `MAKI_OSS_` | `CLAUDE_OSS_` |
| Config file | `…/maki-oss/config.toml` | `…/claude-oss/config.toml` |
| `image` default | `maki-agent:local` | `claude-agent:local` |
| `policy` default | `examples/policies/maki-minimal.yaml` | `claude-oss/policies/minimal.yaml` |
| `sandbox_name` default | `mk-{project}-{hash}` | `cc-{project}-{hash}` |
| Registry agent tag | `mk` | `cc` |
| In-sandbox sync state | `/sandbox/.maki-oss/` | `/sandbox/.claude-oss/` |
| Curated profiles | `examples/providers/` | `claude-oss/providers/` |

Claude reads `~/.claude/` and `~/.claude.json` on the host and uses
`/sandbox/.claude/` and `/sandbox/.claude.json` in the sandbox; project
`.claude/`, `.mcp.json`, `CLAUDE.md`, and `AGENTS.md` upload with the project,
and no host config or credential store is copied.

## Credentials

Both curated profiles are limited to `api.anthropic.com:443` and `/usr/local/bin/claude`:

| Provider | Credential | Header | Billing |
|---|---|---|---|
| `claude-anthropic` | `ANTHROPIC_API_KEY` | `x-api-key` | per call (Anthropic Console) |
| `claude-anthropic-oauth` | `CLAUDE_CODE_OAUTH_TOKEN` | `Authorization: Bearer` | your Claude Pro/Max plan |

**Subscription token.** Create it on the host with `claude setup-token`, never
in a sandbox, then pass it to `provider setup` (playbook
[Phase 2](../playbooks/claude.md#phase-2--load-the-provider-profile-and-create-the-provider)).
It lives only in the OpenShell provider record, is inference-only, and lasts
about a year; revoke it if a gateway is compromised. See
[references](../references.md).

**API key.** A stored Maki or OpenCode Anthropic key maps to `claude-anthropic`
through [`stores.tsv`](../../../claude-oss/providers/stores.tsv). `--env` picks
the profile by variable name; `--file` or the hidden prompt asks which
credential it is. The value reaches only the `openshell` child process, never
argv, files, or output.

`provider setup` records the provider in `~/.config/claude-oss/config.toml`,
and session commands attach it at creation; set `providers`, export
`CLAUDE_OSS_PROVIDERS`, or pass `--provider` to `up`. Attach only one: the API
key wins over the subscription, and `doctor` warns. Switch by attaching the
other and detaching the first.

Not supported: `ANTHROPIC_BASE_URL`, Bedrock, Vertex, `apiKeyHelper`, and browser login.

## Profiles

Shipped profiles are the `claude-*` set under `claude-oss/providers/`; each
binds only `api.anthropic.com:443` and `/usr/local/bin/claude`, and a sandbox
attaches `claude-<name>`, not `maki-<name>`. `stores.tsv` maps only an
Anthropic API key; the example model is in
[`catalog.tsv`](../../../claude-oss/providers/catalog.tsv).

## Sessions

| Command | In-sandbox command |
|---|---|
| bare `claude-oss`, `claude-oss claude` | the image's API key approval step, then `claude --dangerously-skip-permissions [--model M] [session flags]` on a TTY |
| `claude-oss run "<prompt>"` | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions [--model M] [session flags] "<prompt>"` |

Both modes use `--dangerously-skip-permissions`; the root-owned managed
settings still deny `sudo`, `su`, `ssh`, `scp`, in-sandbox `claude`
authentication, and config edits. `run` closes stdin and streams stream-json.
The seed trusts `/sandbox/project`; an interactive API-key run first executes
`/usr/local/libexec/claude-oss/approve-api-key`. Only `api.anthropic.com` is
reachable. Sessions live under `/sandbox/.claude/projects/`; the default
`/sandbox/.claude/` and `/sandbox/.claude.json` are used because `sandbox exec`
does not pass image `ENV`.

The model resolves from `--model`, then `CLAUDE_OSS_MODEL`, then config
`model`; aliases such as `sonnet` and `opus` work, and with no model Claude
Code picks its own default. Nothing is written to the project or to the
sandbox config.

| Option | Claude Code flag |
|---|---|
| `--continue`, `-c` | `--continue` |
| `--resume ID`, `-r ID` | `--resume ID` |
| `--session-id ID` | `--session-id ID` (must be a UUID) |

Any two together are a usage error, and `--session-id` must be a UUID; both
fail before sandbox work. An interactive `claude-oss --continue` after a
`claude-oss run` opens the last interactive session, not the run; use
`--resume` with the run's `session_id` to pick the run up. Sessions survive
`stop`/`start`, not `rm`.

## MCP

`claude-oss mcp status` compares `mcpServers` in
`$CLAUDE_CONFIG_DIR/.claude.json` (or `~/.claude.json`) with
`/sandbox/.claude.json`, using the `maki-oss` gate vocabulary and provider name
`claude-mcp-<name>`. `.mcp.json` servers upload with the project. The base
declares none; a missing server or runtime points to a store built
`FROM claude-agent:local`. Without `jq`, `mcp status` exits 2; an unparsable
file is `unreadable`.

## Store

A store builds `FROM claude-agent:local` and copies `config/` into
`/sandbox/.claude/` (`settings.json`, `skills/`, `commands/`) and
`/sandbox/.claude.json` (`mcpServers`); it selects its tag through the helper's
`image`. Keep the managed settings at least as strict and never bake a
credential. A stdio runtime belongs in the store; plugins have no supported
path. See the [environment playbook](../environment-playbook.md).

## Differences

- No Node/Bun and no ripgrep; 2.1.308 has no Grep/Glob tool, so searches use
  Bash `grep`.
- `tui` is ignored; no fish plugin.
- Profiles bind `/usr/local/bin/claude`; renaming or wrapping it breaks egress.

## See also

- [`docs/ai/onboarding.md`](../onboarding.md) — choose Maki, OpenCode, or Claude Code.
- [`docs/ai/playbooks/claude.md`](../playbooks/claude.md) — the ordered Claude path.
- [`claude-oss/README.md`](../../../claude-oss/README.md) — raw path and verification record.
- [`docs/verification.md`](../../verification.md) — isolation checklist.
