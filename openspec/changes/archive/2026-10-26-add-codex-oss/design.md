# Design: add-codex-oss

## Context

See proposal.md for the motivation and specs/ for the requirements. This
change adds a fourth front-end over `lib/oss-core.sh`. `bin/claude-oss` is
the closest reference: the identity variables, the `agent_*` hooks, and the
two optional hooks it added (`agent_generic_profile`,
`agent_missing_env_hint`) are the surface a front-end supplies.

Facts that shape the approach come from three sources: `spike.md` (Codex
0.155.1, OpenShell 0.1.5, a `prolite` ChatGPT plan), the archived
`add-claude-oss` design, and the local Codex help output.

- **Backend.** `https://chatgpt.com/backend-api/codex` accepts a custom
  provider with `env_key` (bearer) and `env_http_headers`
  (`ChatGPT-Account-Id`), with no `auth.json` and no extra headers.
  `gpt-6-astra` and `gpt-5.6-terra` work. `gpt-5.5` is rejected for
  ChatGPT accounts.
- **Tokens.** The access token lasts 240 h, and `earliest_refresh_at` is
  216 h. Its `client_id` claim is the OAuth client ID. OpenAI issues a new
  refresh token on each refresh but accepted the old one for at least
  11 minutes.
- **Gateway refresh.**
  - `token_url` must sit in the profile credential's `refresh` block; the
    gateway rejects it as material.
  - The gateway records each refresh's expiry as now + 1 h and ignores
    `expires_in`. With `refresh_before: 3600s`, it refreshed every 30 s to
    3 min.
  - Profile edits did not change an existing configuration's schedule.
- **Image environment.** `openshell sandbox exec` does not pass image `ENV`
  to the agent (the archived Claude spike). Only `HOME=/sandbox` holds, so
  Codex uses `/sandbox/.codex`.
- **Skills.** Codex reads `~/.agents/skills` outside `CODEX_HOME`.
- **Sessions.**
  - `codex exec resume [--last | ID] [PROMPT]` and
    `codex resume [--last | ID]` take the same launch options as their
    parents.
  - Interactive `resume --last` skips `exec` sessions unless
    `--include-non-interactive` is given.
  - There is no flag to create a session with a chosen ID.
- **Codex's own sandbox.** On Linux it uses bubblewrap. Under OpenShell it
  is off and `--dangerously-bypass-approvals-and-sandbox` is the launch
  mode, which matches `claude-oss`.

## Goals / Non-Goals

**Goals:**

- `bin/codex-oss` stays a front-end of a few hundred lines. Core changes are
  limited to optional hooks with no-op defaults.
- Every guardrail that matters (provider, base URL, traffic switches,
  command rules) lives in root-owned files under `/etc/codex/`.
- No token ever exists in the sandbox, and the refresh token exists only in
  gateway secret material, apart from the moments it spends in the helper's
  temporary login home.

**Non-Goals:**

- Option B (host-side refresh). It is designed below only as the fallback;
  its code is written only if task 1.1 fails, after `/opsx:update`.
- Running Node-based stdio MCP servers. The image has no Node, the same as
  the other agents.
- Using the Conveyor JSONL events from `codex exec --json`.

## Decisions

### D1. Front-end identity

| Variable | Value |
|---|---|
| `PROGRAM` | `codex-oss` |
| `OSS_ENV_PREFIX` | `CODEX_OSS` |
| `OSS_CONFIG_NAME` / `OSS_TMP_PREFIX` | `codex-oss` |
| `OSS_STATE_NAME` | `.codex-oss` |
| `OSS_PROFILES_DIR` | `$repo_root/codex-oss/providers` |
| `OSS_CATALOG_FILE` | `$OSS_PROFILES_DIR/stores.tsv` (header only: no store holds a ChatGPT login) |
| `OSS_CUSTOM_PROFILE_PREFIX` | `codex-` |
| `OSS_AGENT_NAME` / `OSS_AGENT_PROCESS` | `Codex` / `codex` |
| `OSS_AGENT_TAG` | `cx` |
| `OSS_HOST_MCP_CONFIG` | `${CODEX_HOME:-$HOME/.codex}/config.toml` |
| `OSS_SANDBOX_MCP_CONFIG` | `/sandbox/.codex/config.toml` |
| `OSS_MCP_PROVIDER_PREFIX` | `codex-mcp-` |
| `DEFAULT_IMAGE` | `codex-agent:local` |
| `DEFAULT_POLICY` | `$repo_root/codex-oss/policies/minimal.yaml` |
| `DEFAULT_NAME` | `cx-{project}-{hash}` |

`bin/osa`'s `front_end` maps `cx` to `bin/codex-oss`. `OSS_HOST_MCP_CONFIG`
is only read by `mcp status`, never by provider setup (see D7).

### D2. Image: GitHub musl release, pinned by checksum

The image starts from `ubuntu:24.04` and takes the build arguments
`CODEX_VERSION`, `CODEX_SHA256_AMD64`, `CODEX_SHA256_ARM64`,
`CODEX_HOST_SHA256_AMD64`, and `CODEX_HOST_SHA256_ARM64`. From the
`openai/codex` GitHub release `rust-v$CODEX_VERSION` it downloads two
archives, `codex-<arch>-unknown-linux-musl.tar.gz` and
`codex-code-mode-host-<arch>-unknown-linux-musl.tar.gz`. It checks each
archive's SHA-256 and installs the binaries to `/usr/local/bin/`. Codex
0.164.0 runs every shell command through `codex-code-mode-host`; without it,
every tool call fails (gate 1.2). The image then runs `codex --version` as a
smoke test. The README records how to read the release asset digests
(`gh release view … --json assets`) when bumping the version. The pin is
0.164.0, the latest stable release at implementation time.

The provider profile authorizes only `/usr/local/bin/codex`. Gate 1.3 saw
no network use by `codex-code-mode-host`.

The image creates `/sandbox/.codex` owned by uid 1500 for sessions and logs.
It creates no `/sandbox/.agents` and sets no `CODEX_HOME`.

- *Alternative:* the npm package `@openai/codex`. Rejected: it needs Node,
  and its `codex.js` is only a launcher for the same native binary.
- *Alternative:* the glibc build. The musl build is static, so it carries no
  libc coupling to the base image.

### D3. Guardrails in `/etc/codex/`

There are two root-owned files, mode `0644`:

- **`/etc/codex/managed_config.toml`** holds:
  - `model_provider = "chatgpt-oss"` and the `[model_providers.chatgpt-oss]`
    table: `base_url`, `wire_api = "responses"`,
    `env_key = "CODEX_CHATGPT_TOKEN"`, `requires_openai_auth = false`, and
    `env_http_headers = { "ChatGPT-Account-Id" = "CODEX_CHATGPT_ACCOUNT_ID" }`;
  - `[projects."/sandbox/project"] trust_level = "trusted"`;
  - `check_for_update_on_startup = false`, `analytics.enabled = false`,
    `otel.metrics_exporter = "none"`, `feedback.enabled = false`;
  - `[features]` set to `false` for `apps`, `plugins`, `remote_plugin`,
    `plugin_sharing`, `skill_mcp_dependency_install`, `in_app_updates`, and
    `daemon_auto_start`. The first six reach `api.github.com`, `github.com`
    (through `git`), and `chatgpt.com/backend-api/plugins/*` (gate 1.3).
    The daemon would outlive a session and keep the idle stop from
    firing;
  - `tui.show_tooltips = false`, which removes most TUI fetches of
    `raw.githubusercontent.com/openai/codex/main/announcement_tip.toml`.
    One fetch remains with no config key; the sandbox denies it;
  - `cli_auth_credentials_store = "ephemeral"`, so nothing ever writes
    `auth.json`.

  Gate 1.2 confirmed that the managed layer wins over both a user
  `config.toml` and `-c` overrides at 0.164.0.
- **Command rules:** `/etc/codex/rules/default.rules` holds `prefix_rule`
  entries with `decision = "forbidden"` for `sudo`, `su`, `ssh`, `scp`,
  `codex login`, and `codex logout`. Gate 1.2 confirmed that Codex loads
  this system location and enforces it under
  `--dangerously-bypass-approvals-and-sandbox`.

Codex has no per-path edit deny. The configuration is protected by its
location (root-owned, outside `/sandbox`), not by a rule.

- *Alternative:* bake the provider into `/sandbox/.codex/config.toml`.
  Rejected: the agent can rewrite it and redirect the provider.
- *Alternative:* pass the provider on every exec with `-c`. Rejected:
  `run`'s argv would grow with configuration, and the agent can still pass
  its own `-c` to a nested `codex`.

### D4. Credential profile

`codex-chatgpt.yaml`:

```yaml
credentials:
  - name: access_token
    env_vars: [CODEX_CHATGPT_TOKEN]
    required: true
    auth_style: bearer
    header_name: authorization
    refresh:
      strategy: oauth2_refresh_token
      token_url: https://auth.openai.com/oauth/token
      refresh_before: "300s"
      max_lifetime: "864000s"
      material:
        - {name: client_id, required: true, secret: false}
        - {name: refresh_token, required: true, secret: true}
endpoints:
  - {host: chatgpt.com, port: 443, path: /backend-api/codex/**,
     protocol: rest, access: read-write, enforcement: enforce}
binaries: [/usr/local/bin/codex]
```

Without `max_lifetime`, the gateway records each refresh as lasting 1 h,
and the spike's `refresh_before: 3600s` then refreshed continuously. In gate
1.1, a fresh `configure` against this profile recorded the 240 h expiry
after a forced rotation, so the next refresh falls 5 minutes before the
token expires. Gate 1.1 is the evidence, recorded in `spike.md`.

`CODEX_CHATGPT_ACCOUNT_ID` is not in the profile. It is not a secret, the
core's credential-name guard does not match it, and it travels per exec
(D5).

### D5. Launch and session hooks

```text
headless:    codex exec [resume (--last | ID)] --json --skip-git-repo-check \
                   --dangerously-bypass-approvals-and-sandbox [-m M] PROMPT
interactive: codex [resume (--last --include-non-interactive | ID)] \
                   --dangerously-bypass-approvals-and-sandbox [-m M]
```

- `agent_exec_env` adds `CODEX_CHATGPT_ACCOUNT_ID` from the resolved
  `account_id` setting (flag-free: env `CODEX_OSS_ACCOUNT_ID`, then the
  config file). `agent_check_session_flags` runs before any sandbox work,
  so the missing-account check goes there too.
- `agent_check_session_flags` refuses `--session-id`. The core already
  refuses `--continue` together with `--resume`.
- `agent_exec_stdin` returns `null`: `codex exec` reads piped stdin as part
  of the prompt.
- The interactive `--continue` adds `--include-non-interactive`, so
  `codex-oss --continue` after `codex-oss run` reopens the run. This
  differs from `claude-oss`, and the doc says so.
- With no model set, Codex picks its default, which is valid for the
  ChatGPT backend. `doctor` reports the model and does not warn. At
  0.164.0, the TUI showed `GPT-6.1-Sol` as its default, while headless
  runs in the spike used `gpt-6-astra`. The catalog's example model is
  `gpt-6-astra`, which works in both modes.

### D6. Optional core hook for a non-store provider setup

The core's `cmd_provider_setup` reads a credential value from a store, a
file, an env var, or a prompt, and then creates a provider. A ChatGPT login
has no such value: it produces four related values and needs a refresh
configuration. The core gains one optional hook with a no-op default, the
same pattern `claude-oss` used:

- `agent_provider_setup`: when defined, `cmd_provider_setup` calls it after
  option parsing and before any source handling, and returns its status.
  `maki-oss`, `opencode-oss`, and `claude-oss` do not define it, so their
  behavior and tests stay unchanged.

The hook reuses the core's helpers: `require_openshell`, the confirmation
`ask`, `remember_provider`, `config_set_value`, and the `--attach`
handling.

The account ID needs a config key the core does not know, and the core
rejects unknown keys. A second optional variable follows the same pattern:

- `OSS_AGENT_CONFIG_KEYS`: a space-separated list of extra keys the
  front-end accepts. Each one is loaded into `config_agent_<key>`.
  `codex-oss` sets it to `account_id`; the other front-ends leave it unset,
  so they still reject that key.

- *Alternative:* a separate `codex-oss login` command. Rejected: it splits
  provider setup into two commands and breaks the shared command surface.

### D7. Provider setup flow

```text
tmp=$(mktemp -d)            # 0700, removed by trap on EXIT/INT/TERM
CODEX_HOME=$tmp codex login [--device-auth] -c cli_auth_credentials_store="file"
  read $tmp/auth.json with jq into shell variables (never echoed):
    access, refresh, account_id
  decode the access JWT payload (base64url -> jq): client_id, exp
openshell profile import codex-oss/providers/codex-chatgpt.yaml  (if missing)
CODEX_CHATGPT_TOKEN=$access openshell provider create|update codex-chatgpt \
    --credential CODEX_CHATGPT_TOKEN
OSS_RT=$refresh openshell provider refresh configure codex-chatgpt \
    --credential-key CODEX_CHATGPT_TOKEN --strategy oauth2-refresh-token \
    --material client_id=$client_id --secret-material-env refresh_token=OSS_RT \
    --credential-expires-at ${exp}000
config_set_value account_id $account_id
rm -rf $tmp
```

- Token values reach a child process only through its environment, which
  is the `helper-cli` rule. `client_id`, `exp`, and `account_id` are not
  secret.
- On re-run with existing refresh metadata, the helper runs
  `refresh delete` before `configure`. A fresh configure is how the gateway
  picks up the profile's schedule (spike Q1).
- `jq` is required. Without it, setup exits 2.
- The base64url decode uses `tr '_-' '/+'`, padding, and `base64 -d`, which
  is POSIX-portable across macOS and Linux.
- The host `~/.codex` is never opened. The temporary `CODEX_HOME` keeps the
  provider's login separate from the user's host Codex session, so the two
  never share a refresh token.

### D8. Doctor

`agent_doctor_extra` prints:

- the model;
- the account ID's presence;
- the refresh health from
  `openshell provider refresh status codex-chatgpt` (JSON output if the
  CLI offers it, otherwise the table);
- the MCP section.

The continuous-refresh check compares `EXPIRES_AT - LAST_REFRESH` with the
profile's `refresh_before`, read from the repository profile file. It is
`warn` only and never changes the exit code.

### D9. MCP status over TOML

`agent_mcp_servers FILE` scans with `awk`:

- `[mcp_servers.<name>]` headers, optionally quoted;
- the `url`, `command`, and `enabled` keys within each table, up to the
  next header.

An `mcp_servers = {` inline table or `[mcp_servers]` with dotted keys makes
the function fail, and the core reports the file as unreadable. The doc
names the supported table form. A full TOML parser is not worth a
dependency for one report.

### D10. Option B, the fallback (only if task 1.1 fails)

If task 1.1 fails, `codex-oss provider refresh` refreshes the token from
the host:

- It runs on demand, and `doctor` names it when the expiry is under
  24 hours.
- It posts the stored refresh token to `auth.openai.com/oauth/token` with
  `curl`, from the child environment only.
- It runs `openshell provider update --credential CODEX_CHATGPT_TOKEN
  --credential-expires-at …`.
- It stores the rotated refresh token.

The refresh token would live in the macOS keychain (`security`) or in a
`0600` file under `${XDG_STATE_HOME}/osa/credentials/` on Linux. That
choice is made in the `/opsx:update` that switches to B. No B code is
written while A holds.

### D11. Tests and stubs

- The openshell stub's agent exec case already records argv, environment
  keys, and stdin. It is extended to `codex`, as it was for `claude`.
- `tests/stub/codex` is a host stub for `codex login` only. It writes a
  fake `auth.json` into the given `CODEX_HOME`, with unsigned JWTs whose
  payloads carry `client_id` and `exp`. It can be told to fail or hang so
  that cleanup is tested.
- The openshell stub gains `provider refresh configure|status|delete`,
  recording argv and the env-var names it was given (never values, the same
  as `STUB_CREDENTIAL_ENV`).

### D12. AGENTS.md

AGENTS.md gains the Codex forms of the existing rules:

- no `codex login` in a sandbox;
- no `auth.json` in a sandbox;
- no upload or mount of `~/.codex`;
- no base-URL override.

It describes the placeholder in prose only.

## Risks / Trade-offs

- **[The gateway refreshes hourly against OpenAI's 9-day
  `earliest_refresh_at`]** → About 24 refreshes a day is far from the
  continuous refresh the spike saw. The README records the observed rate.
  `doctor` warns on continuous refresh. If OpenAI rate-limits or revokes,
  switch to D10.
- **[Saving of the rotated refresh token is unproven while OpenAI accepts
  old tokens]** → The evidence comes from the first scheduled refresh,
  about 2026-11-05, when OpenAI has had days to reject the original token.
  `codex-oss/README.md` notes that `doctor` must still report refresh `ok`
  after it. If the gateway does not save rotated tokens, that refresh or the
  next one fails visibly in `doctor`, and re-running `provider setup`
  recovers. A one-day wait was considered and dropped: it adds no refresh
  and does not guarantee that OpenAI has rejected the old token yet.
- **[Custom-provider use of the ChatGPT backend is undocumented]** → It is
  the official binary with its own backend URL. An upstream change shows up
  as a failed run, and the pinned version plus the README procedure contain
  it.
- **[Command rules may not apply under bypass mode, or may be
  agent-writable]** → The OpenShell policy (non-root, deny-by-default
  egress) is the boundary. The README records which case holds (task 1.2).
- **[Path scoping may not be enforced for credential injection]** → The
  guide then states that the `codex` binary can use the token on any
  `chatgpt.com` path (task 7.3).
- **[The access token can reach more of the account than inference]** → It
  never enters the sandbox. Only `/usr/local/bin/codex` gets the
  substitution, on the profile's host.
- **[The `-c` precedence over managed configuration is unverified]** → Task
  1.2 tests it. If `-c` wins, the README records that the agent could
  redirect a nested `codex`, and the egress policy still confines it to
  `chatgpt.com`.

## Migration Plan

New files, a new command, and one optional core hook. Rollback is deleting
`bin/codex-oss`, `codex-oss/`, the `cx` line in `bin/osa`, the hook call in
`lib/oss-core.sh`, and the docs, then removing the `codex-chatgpt` provider
and profile from the gateway. The spike's `codex-spike` provider and profile
are removed separately, by the user, once implementation no longer needs
them.
