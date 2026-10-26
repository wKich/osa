# Design: add-claude-oss

## Context

See proposal.md for the motivation and specs/ for the requirements. This
change adds a third front-end over `lib/oss-core.sh`. `bin/opencode-oss` is
the closest reference: its identity variables and hooks (`agent_*`,
`OSS_*`) are the whole surface a front-end supplies.

Facts that shape the approach, from the Claude Code docs (see the proposal's
references) and from a local check on 2026-10-26 with Claude Code 2.1.310:

- **Credential headers.** The check pointed Claude Code at a local listener
  with fake credentials.
  - `ANTHROPIC_API_KEY` went out as `x-api-key`.
  - `CLAUDE_CODE_OAUTH_TOKEN` went out as `Authorization: Bearer`, with
    beta `oauth-2025-04-20`.
  - Neither value was checked for format locally.
  - The token run made no refresh call.
  Both header styles already exist in osa profiles: `auth_style: header`
  and `auth_style: bearer`.
- **Precedence.** Claude Code uses `ANTHROPIC_API_KEY` before
  `CLAUDE_CODE_OAUTH_TOKEN`. `--bare` ignores the token altogether.
- **Managed settings.** `/etc/claude-code/managed-settings.json` ranks above
  every other source. Its deny rules hold in every permission mode,
  including `bypassPermissions`. Settings also carry an `env` block.
- **Nonessential traffic.** `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
  turns off auto-update, telemetry, error reporting, feedback, and feature
  flags. `DISABLE_UPDATES=1` blocks every update path. With these set, an
  API-key or token session needs only `api.anthropic.com`.
- **Distribution.** The native binary needs no Node. Builds are published
  at `downloads.claude.ai/claude-code-releases/<ver>/<platform>/claude`,
  with a GPG-signed `manifest.json` that lists a SHA-256 per platform. The
  same builds are attached to GitHub releases as
  `claude-linux-<arch>.tar.gz`.
- **Headless.** `-p --output-format stream-json` requires `--verbose`.
  `--session-id` must be a UUID. `--continue` without `-p` skips sessions
  started with `-p`.
- **First run.** Interactive mode shows:
  - onboarding;
  - a folder trust dialog, keyed on the project root in `.claude.json`;
  - a bypass-mode confirmation, suppressible with
    `skipDangerousModePermissionPrompt`;
  - a one-time approval of an `ANTHROPIC_API_KEY`.
  Headless mode shows none of these. The onboarding key names are not in
  the official docs.
- **Another implementation.** GeoFront (kontur) runs Claude Code by
  bind-mounting the host's `~/.claude` and `~/.config/anthropic` read-write
  and logging in through the browser. That puts real refresh tokens in the
  agent's reach and breaks two osa invariants. This design takes only
  GeoFront's image recipe; its explicit `CLAUDE_CONFIG_DIR` does not carry
  over (see the spike results).

### Spike results (2026-10-26, Claude Code 2.1.308, OpenShell 0.1.5)

- **Image ENV does not reach the agent.** In a sandbox from an image with
  `ENV CLAUDE_CONFIG_DIR=/sandbox/.claude`, `sandbox exec` showed the
  variable empty, while `HOME=/sandbox` held. Claude Code therefore uses its
  defaults, `/sandbox/.claude/` and `/sandbox/.claude.json`, and the seed
  goes to the latter.
- **Seed works at the default path.** With `hasCompletedOnboarding` and
  `projects["/sandbox/project"].hasTrustDialogAccepted`, a fresh sandbox's
  TUI skipped onboarding and trust. Without the seed, onboarding probed
  `platform.claude.com`, was denied, and exited with "Unable to connect to
  Anthropic services".
- **API key approval defaults to No.** The next screen asked "Do you want to
  use this API key?" with `No (recommended)` selected. The placeholder holds
  a per-provider hex id, so no image-time approval can match it. Writing
  the value's last 20 characters to `customApiKeyResponses.approved` in
  `/sandbox/.claude.json` before the session suppressed the prompt. This key
  is not in the official docs.
- **Managed settings load.** The TUI warned that `Write(...)` deny rules
  never match and that `Edit(...)` covers writes. With a placeholder key,
  it also warned that remote managed settings failed with 401, as expected.
- **Egress.** With real providers, headless and seeded interactive sessions
  reached only `api.anthropic.com`: `/v1/messages`, `/api/claude_code/settings`,
  `/api/claude_code/policy_limits`, and `/api/hello`. The settings `env`
  block was enough; the per-exec fallback is not needed.
- **Both credentials work end to end.** A headless `reply OK` returned
  `OK` and exit 0 with only `claude-anthropic`, and again with only
  `claude-anthropic-oauth`. `printenv` in each sandbox showed a placeholder.
- **Deny rules hold in bypass mode.** A run with
  `--dangerously-skip-permissions` reported both `sudo -n true` and a
  Write under `/sandbox/.claude/` as permission denials, and the file was
  not created. `--resume <id>` recalled the first run's word.
- **No ripgrep needed.** 2.1.308 has no Grep or Glob tool. Searches run
  through Bash (`grep -rl`), so the image adds no ripgrep.

## Goals / Non-Goals

**Goals:**

- `bin/claude-oss` stays a front-end of a few hundred lines, like
  `bin/opencode-oss`. Duplicated core logic is a missed extraction and is
  fixed in the core.
- Guardrails live in the image as root-owned managed settings, so the agent
  cannot change them and the helper need not repeat them on every exec.
- A Pro/Max subscription works with no credential in the sandbox and no
  in-sandbox login.

**Non-Goals:**

- Interactive OAuth inside the sandbox and refresh-token handling.
- Mapping Claude Code's own auth profiles (`~/.config/anthropic`).
- Running stdio MCP servers that need Node. The image has no Node, the same
  constraint as `opencode-oss`.

## Decisions

### D1. Front-end identity

`bin/claude-oss` mirrors `bin/opencode-oss`:

| Variable | Value |
|---|---|
| `PROGRAM` | `claude-oss` |
| `OSS_ENV_PREFIX` | `CLAUDE_OSS` |
| `OSS_CONFIG_NAME` / `OSS_TMP_PREFIX` | `claude-oss` |
| `OSS_STATE_NAME` | `.claude-oss` |
| `OSS_PROFILES_DIR` | `$repo_root/claude-oss/providers` |
| `OSS_CATALOG_FILE` | `$OSS_PROFILES_DIR/stores.tsv` |
| `OSS_CUSTOM_PROFILE_PREFIX` | `claude-` |
| `OSS_AGENT_NAME` / `OSS_AGENT_PROCESS` | `Claude Code` / `claude` |
| `OSS_AGENT_TAG` | `cc` |
| `OSS_HOST_MCP_CONFIG` | `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json` |
| `OSS_SANDBOX_MCP_CONFIG` | `/sandbox/.claude.json` |
| `OSS_MCP_PROVIDER_PREFIX` | `claude-mcp-` |
| `DEFAULT_IMAGE` | `claude-agent:local` |
| `DEFAULT_POLICY` | `$repo_root/claude-oss/policies/minimal.yaml` |
| `DEFAULT_NAME` | `cc-{project}-{hash}` |

The tag is `cc` rather than `cl`, so it reads as "Claude Code" and cannot be
mistaken for a CLI abbreviation. `bin/osa`'s `front_end` maps `cc` to
`bin/claude-oss`.

### D2. Image: direct native download, pinned by checksum

The Dockerfile starts from `ubuntu:24.04`, like `opencode-oss`. It takes
three build arguments: `CLAUDE_VERSION`, `CLAUDE_SHA256_AMD64`, and
`CLAUDE_SHA256_ARM64`. It downloads
`downloads.claude.ai/claude-code-releases/$CLAUDE_VERSION/linux-<arch>/claude`,
checks the SHA-256, installs the binary to `/usr/local/bin/claude`, and
runs `claude --version` as a smoke test. The README records how to read the
checksums from the signed manifest when bumping the version. The initial pin
is the `stable` channel version on the day of implementation.

The image sets no `CLAUDE_CONFIG_DIR` (see the spike results), and it adds
`jq` for the launcher step in D4. It adds no ripgrep.

- *Alternative:* `install.sh`. Rejected: it always downloads `latest`
  first and installs under `~/.local`, which is not the path a profile can
  bind.
- *Alternative:* the GitHub release tarball, as GeoFront uses. It is
  equivalent, and kept as the documented fallback source.
- *Alternative:* npm. Rejected: it needs Node at build time, against the
  agent-only image rule.

### D3. Guardrails in managed settings

`claude-oss/image/managed-settings.json` is copied to
`/etc/claude-code/managed-settings.json`, owned by `root:root` with mode
`0644`. The policy's read-only system paths keep it immutable at run time
as well. It holds:

- `permissions.deny`: Bash rules for `sudo`, `su`, `ssh`, `scp`, and
  `claude setup-token`, `claude auth`, `claude login`, plus Edit rules
  (which also cover writes) for `/sandbox/.claude/**`,
  `/sandbox/.claude.json`, `/etc/claude-code/**`, and
  `/usr/local/libexec/claude-oss/**`;
- `env`: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
  `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`,
  `DISABLE_UPDATES=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`,
  and `ENABLE_CLAUDEAI_MCP_SERVERS=false`;
- `skipDangerousModePermissionPrompt: true` and
  `skipWebFetchPreflight: true`.

Claude Code's built-in sandbox stays at its default (off). Under OpenShell,
bubblewrap could not mount `/proc` anyway, and the outer sandbox is the
boundary.

- *Alternative:* the per-exec env route that `opencode-oss` uses
  (`agent_exec_env`). Not needed: task 1.2 showed the settings `env` block
  stops every startup request outside `api.anthropic.com`.

### D4. First-run seed and the API key launcher step

The image writes `/sandbox/.claude.json`, owned by uid 1500 with mode
`0600`. It marks onboarding as completed, sets a theme, and records
`projects["/sandbox/project"].hasTrustDialogAccepted = true`. The core's
default workdir is `/sandbox/project`, so the default layout is trusted.
Claude Code updates the file in place after that. A custom `--workdir` is
trusted once in the TUI, and the answer persists with the sandbox.

The API key approval cannot be seeded at build time, and its default answer
disables the key. The image therefore ships
`/usr/local/libexec/claude-oss/approve-api-key`, root-owned. Inside the
sandbox it adds the last 20 characters of `$ANTHROPIC_API_KEY` (the
placeholder) to `customApiKeyResponses.approved` with `jq`, removes them
from `rejected`, and does nothing when no key is set. The helper's
interactive argv runs it right before Claude Code:

```text
sh -c '/usr/local/libexec/claude-oss/approve-api-key; exec "$@"' sh claude ...
```

This keeps the step in the front-end's argv hook, so the core needs no new
hook. The raw-command guide either runs the same step or tells the user to
answer Yes once.

- *Alternative:* the helper edits `.claude.json` with a separate exec.
  Rejected: it needs a pre-session core hook.
- *Alternative:* an `apiKeyHelper` that prints the env var. Rejected: its
  output goes in both auth headers, and the proxy substitutes only the
  bound one.

### D5. Credentials

There are two profiles, both bound to `api.anthropic.com:443` and
`/usr/local/bin/claude`:

| Profile | Env var | `auth_style` | `header_name` |
|---|---|---|---|
| `claude-anthropic` | `ANTHROPIC_API_KEY` | `header` | `x-api-key` |
| `claude-anthropic-oauth` | `CLAUDE_CODE_OAUTH_TOKEN` | `bearer` | `authorization` |

OpenShell attaches one provider per credential key. These two keys differ,
so a sandbox could hold both. `doctor` warns about that rather than refusing
it, because a user may switch between them on purpose.

- *Alternative:* send the API key as `ANTHROPIC_AUTH_TOKEN`, which skips
  the interactive approval. Rejected: Anthropic API keys go in
  `x-api-key`, and Bearer auth for API keys is unverified.
- *Alternative:* copy the host login (GeoFront's model). Rejected: it puts
  refresh tokens in the sandbox.

### D6. Launch and session hooks

```text
headless:    claude -p --output-format stream-json --verbose \
                    --dangerously-skip-permissions [--model M] [session] PROMPT
interactive: sh -c '<approve-api-key>; exec "$@"' sh \
             claude --dangerously-skip-permissions [--model M] [session]
```

- `agent_exec_stdin` returns `null`, so the headless exec gets `</dev/null`.
  The docs don't say whether `-p` waits on an open stdin, so the helper
  closes it as `opencode-oss` does.
- `agent_check_session_flags` refuses the three combinations of
  `--continue`, `--resume`, and `--session-id`. It also checks
  `--session-id` against
  `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`.
  It uses `grep -E`, keeping the script POSIX.
- Session flags pass through unchanged. Claude Code's
  `--continue` keeps `-p` sessions and interactive sessions apart, so
  `claude-oss --continue` after `claude-oss run` opens the last interactive
  session, not the run. `docs/claude-oss.md` says so and points to
  `--resume <id>` from the run's events.
- With no model set, Claude Code picks its own default model, which the
  Anthropic profiles cover. So `doctor` only reports the model and does not
  warn as `opencode-oss` does.

### D7. Provider setup wiring

`stores.tsv` maps `maki:anthropic` and `opencode:anthropic` to
`claude-anthropic`. No store holds a setup token. The subscription route
uses the core's generic sources (host env var, JSON file, hidden prompt)
with the curated `claude-anthropic-oauth` profile.

If the core's generic-source flow can reach only a custom-generated profile,
task 4.2 adds the smallest agent hook that offers the curated profiles as
choices. A user can always pass
`--profile claude-oss/providers/claude-anthropic-oauth.yaml`.
`agent_setup_hint` prints the example model from `catalog.tsv`, and for the
token route the `claude setup-token` reminder.

*As implemented:* the generic flow reached only custom profiles, so the core
gained two optional hooks with no-op defaults (no `maki-oss` or
`opencode-oss` change):

- `agent_generic_profile KIND ENV` runs before custom setup for a non-store
  source and may set `agent_profile_id`. `claude-oss` maps
  `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` directly, and otherwise
  asks interactively which credential it is.
- `agent_missing_env_hint VAR` runs when `--env VAR` is unset. `claude-oss`
  points to `claude setup-token` on the host for the token variable.

### D8. MCP status

`agent_mcp_servers FILE` uses `jq` over the top-level `.mcpServers`:

- `type` `http` or `sse` (or a `url`) counts as http, with the URL's
  hostname;
- a `command` counts as stdio, with the command;
- every listed server counts as enabled, because the file has no
  per-server `enabled` flag.

Project-scoped `.mcp.json` servers travel with the project upload and are
outside the comparison. The guide says so.

### D9. AGENTS.md

AGENTS.md gains Claude Code to the existing rules:

- no in-sandbox login (`/login`, `claude auth`, `claude setup-token`);
- no `ANTHROPIC_BASE_URL` and no `apiKeyHelper` in the sandbox;
- never mount or upload `~/.claude`, `~/.claude.json`, or
  `~/.config/anthropic`.

It describes the placeholder in prose only, as it does now.

## Risks / Trade-offs

- **[Undocumented keys (`hasCompletedOnboarding`,
  `customApiKeyResponses`) change between versions]** → Both are verified
  at the pinned version (spike results) and re-checked on each version bump
  in the README procedure. If one stops working, the user sees the prompt
  and answers it once per sandbox.
- **[A setup token in the gateway is a one-year inference credential]** →
  It is stored like every other provider credential, never in the sandbox.
  The guide says to revoke it from the Claude account if a gateway is
  compromised.
- **[A subscription used from a sandboxed agent may hit plan limits or
  terms]** → This is the official Claude Code client using its documented
  `setup-token` flow. The guide links the authentication page and leaves
  plan use to the user.
- **[Feature-flag fetching is off, so flag-gated features are missing]** →
  This is accepted. Sandboxed sessions are for coding work. Remote Control
  and similar features are out of scope.
- **[`--dangerously-skip-permissions` by default]** → It matches `--auto` in
  `opencode-oss` and YOLO in Maki images. Managed deny rules, the OpenShell
  policy, and egress limits stay in force, and the flag refuses to run as
  root.
- **[Plaintext transcripts under `/sandbox/.claude/projects`]** → They hold
  only placeholder values and whatever the agent printed. They stay in the
  sandbox and leave only through explicit download.
- **[The header check went through a base-URL override, not the real
  endpoint]** → Live verification (task 7.3) runs both credential kinds
  against `api.anthropic.com` through the OpenShell proxy.

## Migration Plan

New files and a new command only. Rollback is deleting `bin/claude-oss`,
`claude-oss/`, the `cc` line in `bin/osa`, and the docs. Existing
`mk`/`oc` registry entries and sandboxes are untouched.
