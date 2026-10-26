# Spike: add-codex-oss gating questions

## Environment

- Date: 2026-10-26 (UTC times below).
- Host: macOS, arm64.
- `codex-cli 0.155.1`: the bun global native binary,
  `@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`.
- `openshell 0.1.5`, local gateway, workspace scope `default`.
- Account: ChatGPT login. The token `chatgpt_plan_type` claim is `prolite`.
  There is no OpenAI API key.
- Login used a throwaway `CODEX_HOME` in the session scratchpad, with
  `-c cli_auth_credentials_store="file"`. `~/.codex` was not touched.
  No token value appears in this file.

## Step 0: login

- `codex login --device-auth` failed. The account must first enable
  device-code login for Codex in ChatGPT → Settings → Security.
  `provider setup --device-auth` must surface that requirement.
- The browser flow (`codex login`, localhost:1455 callback) succeeded.
  It requested the scopes
  `openid profile email offline_access api.connectors.read api.connectors.invoke`
  with `originator=codex_cli_rs`.
- `auth.json` keys: `auth_mode` (`chatgpt`),
  `tokens.{id_token, access_token, refresh_token, account_id}`, and
  `last_refresh`. The refresh token is an opaque 196-character string.

## Q3: access token lifetime

**Verdict: answered, 240 h.**

Evidence, from claims decoded with jq. Only non-secret claims were printed.

| Token | `iss` | `aud` | `client_id` | `exp - iat` | `chatgpt_account_id` |
|---|---|---|---|---|---|
| access | `https://auth.openai.com` | `["https://api.openai.com/v1"]` | `app_EMoamEEZ73f0CkXaXp7hrann` | 864000 s (240 h) | present, equals `tokens.account_id` |
| id | `https://auth.openai.com` | `["app_EMoamEEZ73f0CkXaXp7hrann"]` | — | 3600 s | present |

- The token endpoint returns `expires_in: 864000` on refresh. It also
  returns `earliest_refresh_at`, which was 216 h (9 days) after issue.
  OpenAI therefore expects a refresh about one day before expiry, not
  more often.
- The client ID comes from the access token `client_id` claim and the id
  token `aud`. Implementation must read it from the token, not hard-code it.

**Consequence:** a 10-day lifetime makes both options workable. Even the
option B host-side refresh only needs to run about every 9 days.

## Q2a: backend acceptance on the host

**Verdict: yes.**

Evidence:

- Setup: a second empty `CODEX_HOME` with no `auth.json`. The access token
  and account ID were passed only in the environment of one command.
- The command:

  ```
  CODEX_HOME=<empty> codex exec --json --skip-git-repo-check \
    -c model_provider=chatgpt-oss \
    -c 'model_providers.chatgpt-oss.base_url="https://chatgpt.com/backend-api/codex"' \
    -c 'model_providers.chatgpt-oss.wire_api="responses"' \
    -c 'model_providers.chatgpt-oss.env_key="CODEX_CHATGPT_TOKEN"' \
    -c 'model_providers.chatgpt-oss.requires_openai_auth=false' \
    -c 'model_providers.chatgpt-oss.env_http_headers={"ChatGPT-Account-Id"="CODEX_CHATGPT_ACCOUNT_ID"}' \
    "Reply with the single word: ok" </dev/null
  ```

- The base URL appears literally in the binary strings.
- Results:

  | Model | Result |
  |---|---|
  | default (`gpt-6-astra`, read from the session rollout) | exit 0, `agent_message` "ok" |
  | `gpt-5.6-terra` | exit 0, "ok" |
  | `gpt-5.5` | exit 1, `invalid_request_error` / `model_not_found`: "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account." |

- No extra headers were needed (no `originator`, no `version`).
- The empty `CODEX_HOME` held no `auth.json` afterwards.
- `env_http_headers` maps a header to an env var. The account ID can
  therefore come from the environment, not a literal in `config.toml`.
- Side observation: even with an empty `CODEX_HOME`, codex loaded
  user-level skills from `~/.agents/skills` on the host and ran read-only
  `sed` commands on them. This does not affect the sandbox, which has no
  such directory. It does show that codex reads skill paths outside
  `CODEX_HOME`.

**Consequence:** the change is not a no-go. A sandbox can authenticate with
a bearer placeholder and the account header, with no `auth.json`.

## Q1: gateway refresh

**Verdict: partial.** Gateway refresh works repeatedly, but it is
mis-scheduled.

### How refresh is configured

- `token_url` cannot be material. The first attempt passed it with
  `--material` and was rejected:
  `refresh token endpoints must be defined by the provider profile, not material`.
- The profile itself must carry a `refresh` block on the credential.
  This block worked (`openshell profile update`; `resource_version` must
  be copied from `profile export`):

  ```yaml
  credentials:
    - name: access_token
      env_vars: [CODEX_CHATGPT_TOKEN]
      auth_style: bearer
      header_name: authorization
      refresh:
        strategy: oauth2_refresh_token
        token_url: https://auth.openai.com/oauth/token
        refresh_before: "3600s"
        material:
          - {name: client_id, required: true, secret: false}
          - {name: refresh_token, required: true, secret: true}
  ```

- With that block in place, configure succeeded:

  ```
  SPIKE_RT=<from auth.json> openshell provider refresh configure codex-spike \
    --credential-key CODEX_CHATGPT_TOKEN --strategy oauth2-refresh-token \
    --material client_id=app_EMoamEEZ73f0CkXaXp7hrann \
    --secret-material-env refresh_token=SPIKE_RT \
    --credential-expires-at 1793876698000
  ```

  Status afterwards: `configured`, `EXPIRES_AT 2026-11-05 11:04:58`.
- The provider was created with
  `CODEX_CHATGPT_TOKEN=... openshell provider create --name codex-spike --type codex-spike --credential CODEX_CHATGPT_TOKEN`.
- `openshell profile lint` fails for an id that already exists on the
  gateway ("custom provider profile already exists"). Lint is therefore
  not purely offline.

### Rotations

| Step | Status | EXPIRES_AT | LAST_REFRESH |
|---|---|---|---|
| `refresh rotate` #1 | `refreshed` | 12:09:37 | 11:09:37 |
| `refresh rotate` #2 | `refreshed` | 12:09:46 | 11:09:46 |
| automatic | `refreshed` | 12:10:17 | 11:10:17 |
| automatic | `refreshed` | 12:12:17 | 11:12:17 |
| automatic | `refreshed` | 12:15:17 | 11:15:17 |

Every refresh succeeded and no error was recorded.

### Does OpenAI enforce rotation?

- After both rotations, one curl to `auth.openai.com/oauth/token` used the
  original refresh token from `auth.json`. It returned HTTP 200 with
  `access_token`, `refresh_token`, `id_token`, `expires_in: 864000` and
  `earliest_refresh_at`. The tokens were discarded unread.
- A second refresh with the original token returned a refresh token whose
  SHA-256 differs from the one sent.
- Conclusion: OpenAI issues a new refresh token on each refresh, but it
  still accepted the old one for at least 11 minutes, through five or more
  gateway refreshes. Reusing the old token did not revoke the token
  family; gateway refreshes kept succeeding afterwards.

### What this proves and what it does not

- The gateway calls the token endpoint itself and injects the new access
  token. Status and timing show this.
- Whether it saves the rotated refresh token cannot be proven while the
  old token stays valid. The refreshes would succeed with the original
  token too. The intended test, "the original fails, the gateway still
  succeeds", is not available.

### Gateway scheduling defect

- The gateway records `EXPIRES_AT` as refresh time + 1 h. It ignores
  `expires_in: 864000`.
- With `refresh_before: 3600s`, the next refresh therefore falls due
  immediately. The gateway refreshed by itself every 30 s to 3 min until
  the refresh config was deleted at 11:15.
- A profile update to `refresh_before: "300s"` and
  `max_lifetime: "864000s"` did not change that schedule. Resolved
  refresh settings appear to be fixed when `refresh configure` runs. A
  re-configure was not tested, because the gateway held the only current
  refresh token.
- This polling conflicts with OpenAI's `earliest_refresh_at` (9 days) and
  risks rate limiting or session revocation.

**Consequence: option A holds only conditionally.**

- Before A ships, implementation must show that a fresh `configure` with
  `refresh_before` well under 1 h (for example `"300s"`) gives an hourly
  refresh, not a continuous one.
- Better still, find a profile or material setting under which the gateway
  honors `expires_in` or `earliest_refresh_at`.
- If neither works, use option B. It is cheap given Q3: a host
  `provider refresh` about every 9 days, followed by
  `openshell provider update`.
- Either way, the rotated-token-saving property stays unverified while
  OpenAI accepts old refresh tokens.

## Q2b: in-sandbox run and path scoping

**Verdict: not run (partial). Path scoping is declared in the schema but
not verified.**

- The in-sandbox exec was skipped as not cheap. It needs a
  `codex-agent` image with the binary at `/usr/local/bin/codex`, which
  does not exist yet. Egress hosts were not observed.
- Path scoping: the OpenShell profile schema supports `endpoints[].path`,
  where `/v1/**` matches `/v1` and its descendants. Endpoint `rules`
  (`allow: {method, path}`) and `deny_rules` also exist.
- The spike profile set `path: /backend-api/codex/**` on `chatgpt.com:443`.
  The gateway accepted it and `profile export` shows it.
- Whether the proxy enforces the path for credential injection was not
  tested.

## Spike state left behind

- Kept on the gateway, at the user's request:
  - the `codex-spike` profile (workspace scope, `resource_version` 3);
  - the `codex-spike` provider. It holds an access token valid until about
    2026-11-05 and has no refresh config.
- Deleted: both throwaway `CODEX_HOME` directories, including `auth.json`,
  and the refresh config.

## Open items for implementation

- **Refresh schedule:** re-run `configure` with `refresh_before` well under
  the gateway's assumed lifetime. Look for a way to honor `expires_in` or
  `earliest_refresh_at`. Otherwise use option B. `doctor` must flag a
  `LAST_REFRESH` that keeps advancing.
- **Rotation evidence:** the "saves the rotated token" property can only be
  tested if OpenAI starts rejecting old refresh tokens. Re-check later, for
  example after a day, by checking whether the original token is still
  accepted.
- **Profile layout:** `token_url`, `refresh_before`, `max_lifetime` and
  material names go in the profile's credential `refresh` block. Only
  `client_id` (non-secret) and `refresh_token` (secret) are passed at
  configure time. `profile update` needs the current `resource_version`.
- **Egress set:** to be observed in a sandbox run. Expected `chatgpt.com`
  only. Check whether codex also reaches `chatgpt.com/backend-api/wham/...`
  (seen in the binary strings) or other telemetry hosts with the switches
  off.
- **Model IDs:** the default `gpt-6-astra` and `gpt-5.6-terra` work.
  `gpt-5.5` is rejected for ChatGPT accounts. Others in the binary
  (`gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.3-codex`) were not tried.
- **Path scoping:** verify that `path: /backend-api/codex/**` is enforced.
  For example, a request to another `chatgpt.com` path should be denied or
  should arrive without the credential. If not, document the wider
  exposure.
- **Deny rules under `--dangerously-bypass-approvals-and-sandbox`:** not
  tested. The image must also not contain `~/.agents/skills`, since codex
  reads it outside `CODEX_HOME`.
- **Device auth:** `provider setup --device-auth` needs device-code login
  enabled in ChatGPT security settings. The browser flow needs a local
  browser and port 1455 on the host.

## Final recommendation

- Proceed with option A, but update the proposal first:
  - put the refresh block in the profile;
  - make the refresh-scheduling check a gate;
  - make option B the documented fallback.
- Q2 passes, so the change is not a no-go.
- Q3 makes option B cheap.
- Q1 is partial: the gateway refreshes and injects tokens, but its 1 h
  lifetime assumption causes continuous refresh, and saving of the rotated
  token cannot be proven while OpenAI accepts old refresh tokens.

## Apply gates (2026-10-26, Codex 0.164.0, OpenShell 0.1.5)

### Task 1.1: refresh schedule

- Profile `codex-gate`: the spike profile with `refresh_before: "300s"` and
  `max_lifetime: "864000s"` in the credential `refresh` block.
- Setup:
  1. A new throwaway host login.
  2. `provider create --credential CODEX_CHATGPT_TOKEN`.
  3. A fresh `refresh configure` with `client_id` from the token claim and
     `--credential-expires-at` from `exp`.
  4. The throwaway home was deleted.
- After configure, `EXPIRES_AT` was the token `exp` and `NEXT_REFRESH` was
  `exp - 300 s`.
- One forced `refresh rotate` at 13:26:49Z refreshed with
  `EXPIRES_AT 2026-11-05 13:26:49`, which is +240 h, not +1 h.
  A fresh configure with `max_lifetime` set therefore fixes the spike's
  continuous refresh. The next refresh is due 2026-11-05 13:21:49.
- Two-hour watch, 13:27Z to 15:27Z, polling `refresh status` every
  minute: the row never changed. There was no automatic refresh and no
  failure, and `LAST_REFRESH` stayed at the forced rotation (13:26:49Z).
- **Verdict: pass.** Option A holds. A fresh `configure` against a profile
  with `max_lifetime: "864000s"` and `refresh_before: "300s"` refreshes
  once per 240 h token, five minutes before expiry.

### Task 1.2: managed configuration and rules

Offline (`docker run --network none`, `codex doctor --json`):

- `/etc/codex/managed_config.toml` loads. The effective provider is
  `chatgpt-oss` with env key `CODEX_CHATGPT_TOKEN`, no OpenAI auth
  requirement, and ephemeral auth storage.
- A user `/sandbox/.codex/config.toml` that sets another `model_provider`
  and overrides `model_providers.chatgpt-oss.base_url` has no effect.
- The same holds for `-c model_provider=…` and
  `-c model_providers.chatgpt-oss.base_url=…`: the managed layer wins.
- `codex exec --strict-config` reports no configuration error. The only
  failure offline is the missing token.

Live (sandbox `cx-gate`, provider `codex-gate`):

- `/etc/codex/rules/default.rules` is loaded and enforced under
  `--dangerously-bypass-approvals-and-sandbox`. `sudo -n true` and
  `codex login status` were rejected with "policy forbids commands
  starting with …".
- New requirement: 0.164.0 runs every shell command through the
  companion binary `/usr/local/bin/codex-code-mode-host`. Without it, each
  run emits an error event and every tool call fails. The image now
  installs it from the same release, pinned by its own SHA-256.
- Headless `reply OK` returned `ok`, exit 0. `exec resume <thread_id>`
  recalled the first reply.
- `printenv CODEX_CHATGPT_TOKEN` shows the placeholder.
- `/sandbox/.codex` has no `auth.json`.

### Task 1.3: egress and path scoping

All observations are from `openshell logs` (OCSF).

- Every inference call was `POST https://chatgpt.com/backend-api/codex/responses`,
  allowed by `_provider_codex_gate`.
- **Path scoping is enforced at L7.** `GET /backend-api/plugins/featured`
  and `/backend-api/plugins/export/curated` on `chatgpt.com` were denied
  with `L7_REQUEST deny`.
- With default features, the sandbox denied these, and runs still
  completed:
  - `codex` reaching `api.github.com:443`;
  - `git-remote-http` reaching `github.com:443`;
  - the plugin catalog paths above.
- After turning off `apps`, `plugins`, `remote_plugin`, `plugin_sharing`,
  `skill_mcp_dependency_install`, `in_app_updates`, and
  `daemon_auto_start`, the GitHub and plugin calls stopped.
- The TUI fetches
  `raw.githubusercontent.com/openai/codex/main/announcement_tip.toml`.
  `tui.show_tooltips = false` cut it from 3 attempts to 1. No config key
  was found for the last one. The sandbox denies it, and the TUI still
  opens.
- Interactive: `codex --dangerously-bypass-approvals-and-sandbox` over
  `sandbox exec --tty` opened directly on the prompt, with "permissions:
  YOLO mode", in `~/project`, with default model `GPT-6.1-Sol`. There was
  no login and no trust prompt.
- No call reached `auth.openai.com`, statsig, or any other host.
- The ChatGPT backend returned one HTTP 429 after about 6 requests in
  3 minutes. Codex's retry recovered.
