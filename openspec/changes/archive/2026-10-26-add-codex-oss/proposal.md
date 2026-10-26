# Proposal: add-codex-oss

## Why

osa runs Maki, OpenCode, and Claude Code inside OpenShell sandboxes, but
OpenAI's Codex CLI, the other agent on the Conveyor roadmap, still runs only
on the host. `lib/oss-core.sh` and the landed `claude-oss` front-end make a
fourth agent a thin front-end. The target account is a ChatGPT Pro login,
not an OpenAI API key, so this change is built around ChatGPT-plan auth.

That auth has no long-lived token like Claude's `setup-token`. A ChatGPT
login holds an access token and a refresh token. Codex normally keeps both
in `auth.json`, which would put a live refresh token inside the sandbox. A
spike with `codex-cli` 0.155.1 and `openshell` 0.1.5 (`spike.md`) showed a
way around that:

- **Backend accepts a custom provider.** It authenticates with a bearer
  token from `env_key` and a `ChatGPT-Account-Id` header from
  `env_http_headers`, with no `auth.json` (tested on the host with a
  `prolite` plan).
- **Access tokens last 240 h.** OpenAI sets `earliest_refresh_at` at 216 h.
- **Gateway refreshes the token itself.** OpenShell refreshes the
  credential on the gateway with a profile-defined `oauth2_refresh_token`
  block and injects the new access token. The refresh token stays in
  gateway secret material.
- **Gateway mis-schedules refreshes.** It assumes a 1 h token lifetime, so
  with the tested settings it refreshed continuously.

## What Changes

- Add a `codex-oss/` subproject next to `claude-oss/`:
  - `image/Dockerfile`: an agent-only base image (`codex-agent:local`):
    - installs the native Codex binary at a pinned version, from the GitHub
      release musl build, checked against a per-architecture SHA-256, at
      `/usr/local/bin/codex`;
    - does not use the npm wrapper;
    - has no Node or Bun runtime;
    - runs as uid/gid 1500 with home `/sandbox`, so Codex uses its default
      `CODEX_HOME`, `/sandbox/.codex` (`openshell sandbox exec` does not
      pass image environment variables to the agent);
    - contains no `/sandbox/.agents/skills`, because Codex reads skills
      outside `CODEX_HOME`.
  - `image/managed_config.toml`, root-owned under `/etc/codex/`, so the
    agent cannot rewrite it:
    - a custom model provider, `chatgpt-oss`, with:
      - `base_url = "https://chatgpt.com/backend-api/codex"`;
      - `wire_api = "responses"`;
      - `env_key = "CODEX_CHATGPT_TOKEN"`;
      - `requires_openai_auth = false`, so no `auth.json` is read or
        written;
      - `env_http_headers` mapping `ChatGPT-Account-Id` to
        `CODEX_CHATGPT_ACCOUNT_ID`, so the image stays account-neutral;
    - trust for `/sandbox/project`, so the TUI opens without a trust prompt;
    - the update check, analytics, OTel metrics export, and feedback turned
      off.
  - Root-owned command rules under `/etc/codex/`, forbidding `sudo`, `su`,
    `ssh`, `scp`, and `codex login`/`logout`. Codex has no per-path edit
    deny, so the guardrail for its configuration is the root-owned managed
    layer above, not a rule.
  - `providers/codex-chatgpt.yaml`:
    - binds `CODEX_CHATGPT_TOKEN` as a bearer credential;
    - carries a `refresh` block: strategy `oauth2_refresh_token`,
      `token_url` `https://auth.openai.com/oauth/token`, `refresh_before`,
      and material `client_id` (not secret) and `refresh_token` (secret).
      The gateway rejects a `token_url` passed as material;
    - allows only `chatgpt.com:443` with `path: /backend-api/codex/**`, and
      only the binary `/usr/local/bin/codex`;
    - `catalog.tsv`, `stores.tsv`, and `template.yaml` complete the provider
      set.
  - `policies/minimal.yaml`: the same filesystem, Landlock, and process
    floor as the other agents.
  - `README.md`: the guide, with the helper first and the raw commands as
    the fallback, plus the recorded verification.
- Add `bin/codex-oss`, a Codex front-end over `lib/oss-core.sh`. It has the
  `claude-oss` command surface.
  - **Identity:** `CODEX_OSS_*` environment variables,
    `~/.config/codex-oss/config.toml`, sandbox names `cx-{project}-{hash}`,
    and registry agent tag `cx`.
  - **Headless:** `codex exec --json --skip-git-repo-check
    --dangerously-bypass-approvals-and-sandbox`, with stdin closed.
  - **Interactive:** `codex --dangerously-bypass-approvals-and-sandbox` on a
    TTY.
  - **Model:** passed with `-m` in both modes.
  - **Exec environment:** `CODEX_CHATGPT_ACCOUNT_ID` (not secret) is passed
    on every exec.
  - **Sessions:**
    - `--continue` maps to `resume --last`, and `--resume ID` maps to
      `resume ID` (`codex exec resume` when headless, `codex resume` in the
      TUI).
    - `--session-id` is refused before any sandbox work, because Codex
      cannot create a session with a chosen ID.
  - **`provider setup`:**
    - runs `codex login` on the host in a throwaway `CODEX_HOME`, so the
      host's own `~/.codex` session never shares a refresh token with the
      gateway;
    - uses the browser flow by default, which needs a local browser and
      port 1455. `--device-auth` is offered, with a note that device-code
      login must first be enabled in ChatGPT → Settings → Security;
    - reads `client_id`, the account ID, and `exp` from the token claims,
      without hard-coding them;
    - creates the `codex-chatgpt` provider with `--credential`;
    - runs `refresh configure` with the refresh token as secret material
      and `--credential-expires-at`;
    - stores the account ID in `~/.config/codex-oss/config.toml`;
    - deletes the throwaway directory.
  - **`doctor`:** reports the refresh status and token expiry, and warns
    when `LAST_REFRESH` keeps advancing, which means the gateway is
    refreshing continuously.
  - **`mcp status`:** compares the `[mcp_servers]` tables in the host and
    sandbox `config.toml` files.
- Teach `bin/osa` the `cx` tag. Add `docs/codex-oss.md`, a root `README.md`
  pointer, Makefile lint and test entries, and a `tests/stub/codex` stub.
- **Spike results (`spike.md`):** Q2, backend acceptance: yes. Q3, token
  lifetime: 240 h. Q1, gateway refresh: partial. The gateway refreshes and
  injects tokens, but it schedules refreshes as if tokens last 1 h. Whether
  it saves the rotated refresh token cannot be proven while OpenAI still
  accepts old refresh tokens.
- **Refresh-schedule gate, the first implementation task:**
  - A fresh `refresh configure` with `refresh_before` well under 1 h (for
    example `300s`) must refresh no more often than hourly.
  - Better: a setting under which the gateway honors `expires_in` or
    `earliest_refresh_at`.
  - If neither holds, use option B. A host-side `codex-oss provider refresh`
    runs about every 9 days: it calls `auth.openai.com`, then runs
    `openshell provider update --credential CODEX_CHATGPT_TOKEN
    --credential-expires-at …`. The design decides where the host keeps the
    refresh token in that case.
- **Verified during implementation:**
  - the egress set of a sandbox run, expected `chatgpt.com` only. Check
    whether `backend-api/wham` or telemetry hosts are reached with the
    switches off;
  - model IDs: `gpt-6-astra` (the default) and `gpt-5.6-terra` work, and
    `gpt-5.5` is rejected for ChatGPT accounts;
  - whether the proxy enforces `path: /backend-api/codex/**` for the
    injected credential;
  - whether Codex's command rules hold under
    `--dangerously-bypass-approvals-and-sandbox`, and whether the managed
    layer wins over a user `config.toml` and `-c` overrides;
  - after the first scheduled gateway refresh (about 2026-11-05), whether
    `doctor` still reports refresh `ok`, which is what proves the gateway
    saves the rotated token.

  The guide records each result. Where a limit cannot be enforced, the guide
  states the wider exposure.
- **Not in this change:**
  - OpenAI API-key auth (`OPENAI_API_KEY`, `CODEX_API_KEY`);
  - ChatGPT Enterprise access tokens (`CODEX_ACCESS_TOKEN`);
  - `auth.json` in the sandbox, or any login inside the sandbox;
  - non-OpenAI Responses-API providers;
  - mounting host `~/.codex`;
  - Codex's built-in sandbox;
  - the fish plugin, the dashboard, oskhs, and the Conveyor JSONL parser.

## Capabilities

### New Capabilities

- `codex-oss`: running Codex CLI natively inside an OpenShell sandbox. It
  covers:
  - the pinned agent-only image and its baked configuration;
  - the managed configuration, the command rules, and the traffic
    switches;
  - the ChatGPT-bound provider profile with its gateway refresh block;
  - the minimal policy, and egress limited to the ChatGPT Codex backend
    path;
  - the documented and verified headless, interactive, and file-transfer
    workflows.
- `codex-oss-helper`: the `codex-oss` command. It has parity with
  `helper-cli` under the Codex substitutions. Codex-specific requirements
  cover:
  - launch, and the account-ID exec environment;
  - session-flag mapping and the `--session-id` refusal;
  - `provider setup` with a throwaway host login and gateway refresh;
  - refresh status and continuous-refresh detection in `doctor`;
  - TOML-based `mcp status`.

### Modified Capabilities

- `osa-project-layer`: the "Shared state root" requirement lists the agent
  front-ends that share the state root. It gains `codex-oss`, which MUST NOT
  create a per-tool root.

## Impact

- **New:** `codex-oss/`, `bin/codex-oss`, `docs/codex-oss.md`, Codex cases
  in `tests/run-tests.sh`, and `tests/stub/codex`.
- **Modified:**
  - `bin/osa`: the `cx` tag;
  - root `README.md`: one pointer;
  - `Makefile`: lint and test targets;
  - `AGENTS.md`: the placeholder and no-in-sandbox-login rules, stated for
    Codex.

  `lib/oss-core.sh` changes only if a hook gap turns up, and then without
  changing the other front-ends' behavior, which their unchanged tests
  prove.
- **Dependencies:** GitHub releases at image build time only. At run time
  the sandbox reaches only `chatgpt.com/backend-api/codex/**`. The gateway,
  not the sandbox, reaches `auth.openai.com` to refresh the token.
- **OpenShell state:**
  - Users import a fourth profile set (`codex-*`). A Codex sandbox attaches
    only `codex-chatgpt`.
  - This is the first osa provider with gateway-side credential refresh.
  - `profile update` needs the current `resource_version`.
  - `profile lint` fails for an id that already exists on the gateway, so
    it is not purely offline.
  - The spike's `codex-spike` profile and provider remain on the gateway.
    Implementation uses the new id `codex-chatgpt` and does not reuse them.
- **Accounts:** the provider holds a dedicated ChatGPT login, kept apart
  from the host's Codex session. Its refresh token lives only in gateway
  secret material, or with option B, in the host store the design chooses.

Upstream references:

- Codex authentication (login, device auth, credential storage):
  https://learn.chatgpt.com/docs/auth
- Codex configuration (`model_providers`, `env_key`, `env_http_headers`,
  `requires_openai_auth`, `projects.<path>.trust_level`, `analytics`,
  `otel`, `feedback`, `check_for_update_on_startup`, `requirements.toml`):
  https://learn.chatgpt.com/docs/config-file/config-reference
- Codex releases (native musl binaries): https://github.com/openai/codex/releases
- OpenShell profiles (binaries, endpoints, `path`, credential binding):
  https://docs.nvidia.com/openshell/how-it-works/providers/profiles.md
- OpenShell sandboxes (create, exec, upload/download):
  https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md
- OpenShell credential refresh: no public page has been found. The
  behavior of the profile credential `refresh` block and of
  `openshell provider refresh configure|status|rotate` is recorded in
  `spike.md`.
