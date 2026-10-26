# claude-oss: the Claude Code sandbox helper

`bin/claude-oss` runs [Claude Code](https://code.claude.com/docs/en/overview)
inside a per-project OpenShell sandbox, the way `bin/maki-oss` runs Maki and
`bin/opencode-oss` runs OpenCode. All three are thin front-ends over the same
core, `lib/oss-core.sh`, so the lifecycle, safe patch sync, policy review,
provider setup, idle stop, and the safety rules behave identically.
[docs/helper.md](helper.md) is the reference for that shared behavior. This
page covers only what differs.

The security model is unchanged:

- the sandbox is the boundary, and nothing is bind-mounted;
- credentials reach the sandbox only through provider profiles;
- `--env` and `--env-from` refuse credential-like names;
- egress stays deny-by-default;
- `rm` needs confirmation.

Claude Code never logs in inside the sandbox, and the helper never reads your
host's Claude Code login (`~/.claude/`, `~/.config/anthropic`, the keychain).

## Install

From a clone of this repository:

```sh
./bin/claude-oss image build      # claude-agent:local from claude-oss/image
./bin/claude-oss provider setup   # an API key or a subscription token
./bin/claude-oss doctor
```

Put the repository's `bin/` on `PATH` to call it as `claude-oss`. Keep `lib/`
and `claude-oss/` next to `bin/`, because the helper loads them from the
repository root.

## Configuration

Settings resolve the same way as for `maki-oss`: flags, then
`CLAUDE_OSS_<KEY>` environment variables, then
`${XDG_CONFIG_HOME:-$HOME/.config}/claude-oss/config.toml`, then defaults.
The keys and the file format are the ones in
[docs/helper.md](helper.md#configuration). Only the names and the defaults
differ:

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

Host state lives under the one shared root, `~/.local/state/osa/` (see
[Shared state and the project registry](helper.md#shared-state-and-the-project-registry)),
so `osa projects` and `osa status` list Claude projects next to Maki and
OpenCode ones. In the same project directory each front-end keeps its own
sandbox (`mk-…`, `oc-…`, `cc-…` with the same path hash), config file, and
session directory. The `tui` key is accepted but ignored, because the
OpenCode TUI mode is a `maki-oss` feature. There is no `fish` plugin for
`claude-oss`.

A minimal config:

```toml
providers = "claude-anthropic-oauth"
model = "sonnet"
```

## Credentials

Two curated profiles, both limited to `api.anthropic.com:443` and to the
binary `/usr/local/bin/claude`:

| Provider | Credential | Header | Billing |
|---|---|---|---|
| `claude-anthropic` | `ANTHROPIC_API_KEY` | `x-api-key` | per call (Anthropic Console) |
| `claude-anthropic-oauth` | `CLAUDE_CODE_OAUTH_TOKEN` | `Authorization: Bearer` | your Claude Pro/Max plan |

**Subscription token.** Create it on the host, never in a sandbox:

```sh
claude setup-token                 # prints a long-lived token for your plan
export CLAUDE_CODE_OAUTH_TOKEN=…   # paste it, then:
claude-oss provider setup --env CLAUDE_CODE_OAUTH_TOKEN --attach --yes
```

The token is stored only in the OpenShell provider record on the gateway. It
is valid for about a year and limited to inference. If a gateway might be
compromised, revoke the token from your Claude account. See
[Claude Code authentication](https://code.claude.com/docs/en/authentication).

**API key.** A stored Anthropic key in the Maki or OpenCode store maps to
`claude-anthropic` through
[`claude-oss/providers/stores.tsv`](../claude-oss/providers/stores.tsv):

```sh
claude-oss provider setup --from maki --credential anthropic --yes
# or: ANTHROPIC_API_KEY=… claude-oss provider setup --env ANTHROPIC_API_KEY --yes
```

With `--env`, the variable name picks the profile. With `--file` or the
hidden prompt, the wizard asks whether the value is an API key or a
subscription token. Either way the value is exported only into the
environment of the `openshell` child process and never appears in argv,
files, or output.

**Choosing the credential for a project.** `provider setup` records the
provider in `~/.config/claude-oss/config.toml`, and the session commands
attach it when they create a project's sandbox. If you created the provider
yourself with `openshell provider create`, pick it in one of these ways:

```sh
# Every project: put it in the config file
echo 'providers = "claude-anthropic-oauth"' >> ~/.config/claude-oss/config.toml

# One shell or one command: the environment overrides the file
CLAUDE_OSS_PROVIDERS=claude-anthropic claude-oss run "reply OK"

# One sandbox, at creation
claude-oss up --provider claude-anthropic-oauth
```

Providers are attached when the sandbox is created. To switch an existing
project's sandbox between the API key and the subscription, attach the other
one and detach the first:

```sh
claude-oss provider attach claude-anthropic-oauth
openshell sandbox provider detach <sandbox> claude-anthropic
```

`claude-oss status` shows the sandbox name and its attached providers. You
can also run `claude-oss rm --yes` and start again with a different
`providers` setting.

**One at a time.** Claude Code uses `ANTHROPIC_API_KEY` in preference to the
subscription token. When both providers are attached, the API key is billed,
and `doctor` warns:

```text
warn  credentials: claude-anthropic and claude-anthropic-oauth are both attached to 'cc-…'; Claude Code uses the API key (claude-anthropic), not the subscription; detach one: openshell sandbox provider detach cc-… <provider>
```

Not supported: providers that need `ANTHROPIC_BASE_URL` (a different base
URL would leave the credential unbound), Bedrock and Vertex, `apiKeyHelper`,
and logging in through the browser.

## Sessions

| Command | In-sandbox command |
|---|---|
| bare `claude-oss`, `claude-oss claude` | the image's API key approval step, then `claude --dangerously-skip-permissions [--model M] [session flags]` on a TTY |
| `claude-oss run "<prompt>"` | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions [--model M] [session flags] "<prompt>"` |

- **Permission prompts are off; the guardrails are not.** Both modes run
  with `--dangerously-skip-permissions`, as `opencode-oss` runs with
  `--auto`. The image's root-owned managed settings
  (`/etc/claude-code/managed-settings.json`) deny `sudo`, `su`, `ssh`,
  `scp`, in-sandbox `claude` authentication, and edits to Claude Code's own
  config and the guardrail files. Managed deny rules hold in every
  permission mode.
- **`run` closes stdin** and streams Claude Code's stream-json events
  unchanged. The exit code is Claude Code's. `--timeout` uses the same
  in-sandbox wrapper as `maki-oss`.
- **No first-run screens.** The image seeds `/sandbox/.claude.json` with
  onboarding done and `/sandbox/project` trusted. Claude Code asks once
  whether to use an `ANTHROPIC_API_KEY` it finds, and its default answer
  disables the key, so the interactive launch first runs
  `/usr/local/libexec/claude-oss/approve-api-key`. That step records the
  attached placeholder as approved, inside the sandbox. A custom `--workdir`
  is trusted once in the TUI.
- **No traffic outside the model endpoint.** The managed settings turn off
  auto-update, telemetry, error reporting, and marketplace auto-install. A
  session reaches only `api.anthropic.com`.

On exit, both session kinds run the same patch sync and network-proposal
check as `maki-oss` (see [Safe session sync](helper.md#safe-session-sync)).

### Model selection

The model resolves from `--model`, then `CLAUDE_OSS_MODEL`, then the config
file's `model`, and reaches Claude Code as `--model` in both modes. Aliases
such as `sonnet` and `opus` work, as do full model names. With no model set,
Claude Code picks its own default, which both profiles cover. Nothing is
written to your project or to the sandbox config.

### Session flags

| Option | Claude Code flag |
|---|---|
| `--continue`, `-c` | `--continue` |
| `--resume ID`, `-r ID` | `--resume ID` |
| `--session-id ID` | `--session-id ID` (must be a UUID) |

Any two of these together are a usage error, and so is a `--session-id` that
is not a UUID. Both are raised before any sandbox work.

Claude Code keeps headless and interactive sessions apart for `--continue`:
`claude-oss --continue` after a `claude-oss run` opens the last interactive
session, not the run. To pick a run up in the TUI, pass `--resume` with the
`session_id` from the run's events:

```sh
claude-oss run "start a refactor plan" | tail -n 1 | jq -r .session_id
claude-oss --resume <session_id>
```

Sessions live in the sandbox under `/sandbox/.claude/projects/`. They
survive `stop`/`start`, but not `rm`.

## MCP status

`claude-oss mcp status` compares the servers under `mcpServers` in the
host's Claude Code user config (`$CLAUDE_CONFIG_DIR/.claude.json` when that
is set, else `~/.claude.json`) with those in the sandbox's
`/sandbox/.claude.json`. It uses the same gate vocabulary as
`maki-oss mcp status`, and expects the provider for server `<name>` to be
named `claude-mcp-<name>`. `doctor` prints the same table.

- `http` and `sse` servers are checked against the URL's host. Servers with
  a `command` are stdio servers.
- The base image declares no MCP servers. A missing server points to an
  environment image built `FROM claude-agent:local` that declares it. The
  image has no Node, so `npx`-launched servers need a runtime there.
- Project-scoped servers in a project's `.mcp.json` travel with the upload
  and are outside this comparison. Keep secrets out of that file.
- The files are parsed with `jq`. Without `jq`, `mcp status` exits 2, and
  `doctor` prints `skipped: jq not found`. An unparsable file is reported as
  `unreadable`.

## Image

`claude-agent:local` installs the official native Claude Code binary at a
pinned version, checked against the SHA-256 from the release manifest. It
has no Node or Bun, runs as uid/gid 1500, and holds no credential or login
state. `claude-oss image build --claude-version V` passes a new version as a
build argument. The checksums must be bumped with it, or the build fails.
See [`claude-oss/README.md`](../claude-oss/README.md#build-the-image).
