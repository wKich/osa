| Field | Value |
|---|---|
| Doc | `reference-codex` |
| Kind | `reference` |
| Agent | `Codex` |
| Covers | `P3-P8` |
| Verified | not yet verified |

# Reference: Codex

## Scope

The Codex path: Codex-specific paths and differences for a reader who already
has the shared procedure. This page is an index: the ordered path is
[the playbook](../playbooks/codex.md), the pinned run is
[the verification page](../verification/codex.md), and shared behavior lives
in [helper](../../helper.md), [providers](../../providers.md), and the
[environment playbook](../environment-playbook.md). This is an index, not a
procedure, so `Verified` says `not yet verified`.

## Config paths

Settings resolve the same way as for `maki-oss`: flags, then
`CODEX_OSS_<KEY>` environment variables, then
`${XDG_CONFIG_HOME:-$HOME/.config}/codex-oss/config.toml`, then defaults. The
keys and the file format are the ones in [helper](../../helper.md#configuration),
plus `account_id`. Only the names and the defaults differ:

| | `maki-oss` | `codex-oss` |
|---|---|---|
| Environment prefix | `MAKI_OSS_` | `CODEX_OSS_` |
| Config file | `…/maki-oss/config.toml` | `…/codex-oss/config.toml` |
| `image` default | `maki-agent:local` | `codex-agent:local` |
| `policy` default | `examples/policies/maki-minimal.yaml` | `codex-oss/policies/minimal.yaml` |
| `sandbox_name` default | `mk-{project}-{hash}` | `cx-{project}-{hash}` |
| Registry agent tag | `mk` | `cx` |
| In-sandbox sync state | `/sandbox/.maki-oss/` | `/sandbox/.codex-oss/` |
| Curated profiles | `examples/providers/` | `codex-oss/providers/` |

`account_id` is your ChatGPT account ID. Codex sends it as the
`ChatGPT-Account-Id` header. It is not a secret: `provider setup` writes it,
and the helper passes it on every exec as `CODEX_CHATGPT_ACCOUNT_ID`. Without
it, session commands stop before any sandbox work and name `provider setup`.

Host state lives under the shared root, `~/.local/state/osa/`, so
`osa projects` and `osa status` list Codex projects next to the others. The
`tui` key is accepted but ignored. There is no `fish` plugin for `codex-oss`.

A config after `provider setup`:

```toml
providers = "codex-chatgpt"
account_id = "…"
model = "gpt-6-astra"
```

## Credentials

There is one curated provider, `codex-chatgpt`: your ChatGPT plan, with the
access token refreshed by the OpenShell gateway.

```sh
codex-oss provider setup               # browser login, callback on localhost:1455
codex-oss provider setup --device-auth # device code; enable it first in
                                       # ChatGPT > Settings > Security
```

`provider setup` does the following:

1. It runs `codex login` on the host in a new, private, throwaway
   `CODEX_HOME`, never in `~/.codex`. The provider's login is separate from
   your own Codex session, so the two never share a refresh token, which
   OpenAI rotates on use.
2. It reads the access token, refresh token, and account ID, and takes the
   OAuth client ID and the expiry from the token's claims.
3. It imports `codex-chatgpt` and creates (or updates) the provider with the
   access token.
4. It runs `openshell provider refresh configure` with the refresh token as
   secret material, so the gateway refreshes the access token before it
   expires.
5. It writes `account_id` and `providers` to the config file, and deletes
   the throwaway home, also on failure or Ctrl-C.

Every token travels only in the environment of an `openshell` child process
and never in argv, files, or output. The refresh token lives only in the
gateway's secret refresh material, and the sandbox sees only a placeholder for
the access token. Run `provider setup` again to replace the login. Without a
terminal it needs `--yes`.

`--from`, `--file`, `--field`, and `--env` are refused: no credential store
holds a ChatGPT login.

**Refresh.** Access tokens last 240 hours. The profile's refresh block sets
`max_lifetime: "864000s"` and `refresh_before: "300s"`, so the gateway
refreshes about five minutes before expiry. `doctor` reports the state:

```text
ok    refresh: codex-chatgpt refreshed, expires 2026-11-05 13:26:49 UTC
```

It warns when refresh is not configured, when the last refresh failed, when
the token expires within 24 hours, and when the gateway refreshes
continuously. The last one happens when the gateway records a lifetime no
longer than the lead time. A configuration made before the profile had
`max_lifetime` gets one hour, for example. The fix is to run `provider setup`
again, which configures refresh fresh.

Not supported: OpenAI API keys (`OPENAI_API_KEY`, `CODEX_API_KEY`), ChatGPT
Enterprise access tokens (`CODEX_ACCESS_TOKEN`), non-OpenAI providers, and
any login inside the sandbox.

## Profiles

The shipped profile is `codex-chatgpt` under `codex-oss/providers/`. It binds
only `chatgpt.com/backend-api/codex/**` to `/usr/local/bin/codex` and carries
the gateway refresh block; the proxy denies every other `chatgpt.com` path.
The example model is in [`catalog.tsv`](../../../codex-oss/providers/catalog.tsv).
[`stores.tsv`](../../../codex-oss/providers/stores.tsv) is empty because no
credential store holds a ChatGPT login. Do not override the provider's base
URL in the sandbox: a different URL would leave the credential unbound.

## Sessions

| Command | In-sandbox command |
|---|---|
| bare `codex-oss`, `codex-oss codex` | `codex [resume …] --dangerously-bypass-approvals-and-sandbox [-m M]` on a TTY |
| `codex-oss run "<prompt>"` | `codex exec [resume …] --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox [-m M] "<prompt>"` |

- **Approvals are off, and the guardrails stay on.** Codex's own bubblewrap
  sandbox is bypassed, because the OpenShell sandbox is the boundary.
  Root-owned files under `/etc/codex/` hold the guardrails:
  - `managed_config.toml` pins the provider, the base URL, and the traffic
    switches. It ranks above `~/.codex/config.toml` and `-c` overrides.
  - `rules/default.rules` forbids `sudo`, `su`, `ssh`, `scp`,
    `codex login`, and `codex logout`. The rules hold under bypass mode.
- **`run` closes stdin** and streams Codex's JSONL events unchanged. The
  exit code is Codex's. `--timeout` uses the same in-sandbox wrapper as
  `maki-oss`.
- **No first-run screens.** `/sandbox/project` is trusted and no login is
  needed, so the TUI opens on the prompt. A custom `--workdir` is trusted
  once in the TUI.
- **Traffic.** The managed config turns off the update check, analytics,
  metrics, feedback, apps, plugins, in-app updates, startup tips, and the
  background app-server daemon. A session reaches only
  `chatgpt.com/backend-api/codex/**`. The proxy denies every other
  `chatgpt.com` path. The TUI still makes one fetch of
  `raw.githubusercontent.com` that no setting turns off; the sandbox denies
  it, and the TUI works without it.

On exit, both session kinds run the same patch sync and network-proposal
check as `maki-oss` (see [Safe session sync](../../helper.md#safe-session-sync)).

The model resolves from `--model`, then `CODEX_OSS_MODEL`, then the config
file's `model`, and reaches Codex as `-m` in both modes. A ChatGPT account
accepts the Codex models (for example `gpt-6-astra` or `gpt-5.6-terra`) and
rejects API-only ones such as `gpt-5.5`. With no model set, Codex picks its
default; at 0.164.0 the TUI shows `GPT-6.1-Sol`. Nothing is written to your
project or to the sandbox config.

| Option | `run` | TUI |
|---|---|---|
| `--continue`, `-c` | `codex exec resume --last …` | `codex resume --last --include-non-interactive …` |
| `--resume ID`, `-r ID` | `codex exec resume … ID` | `codex resume … ID` |
| `--session-id ID` | refused | refused |

Codex cannot start a session with a chosen ID, so `--session-id` is a usage
error, as is `--continue` together with `--resume`. Both are raised before any
sandbox work. In the TUI, `--continue` includes headless runs, so
`codex-oss --continue` after a `codex-oss run` reopens the run. The session
ID of a run is the `thread_id` of its first event:

```sh
codex-oss run "start a refactor plan" | head -n 1 | jq -r .thread_id
codex-oss --resume <thread_id>
```

Sessions live in the sandbox under `/sandbox/.codex/sessions/`. They survive
`stop`/`start`, but not `rm`.

## MCP

`codex-oss mcp status` compares the `[mcp_servers.<name>]` tables in the
host's Codex config (`$CODEX_HOME/config.toml`, else `~/.codex/config.toml`)
with those in the sandbox's `/sandbox/.codex/config.toml`. It uses the same
gate vocabulary as `maki-oss mcp status`, and expects the provider for server
`<name>` to be named `codex-mcp-<name>`. `doctor` prints the same table.

- A server with a `url` is checked against the URL's host. A server with a
  `command` is a stdio server. `enabled = false` excludes a server.
- Only the table form is read. A file that defines `mcp_servers` as an
  inline table, or as dotted keys under `[mcp_servers]`, is reported as
  `unreadable`. Rewrite it as `[mcp_servers.<name>]` tables.
- The base image declares no MCP servers. A missing server points to an
  environment image built `FROM codex-agent:local` that declares it in
  `/sandbox/.codex/config.toml`. The image has no Node, so `npx`-launched
  servers need a runtime there.

## Store

A store builds `FROM codex-agent:local` and copies its configuration into
`/sandbox/.codex/config.toml` (`[mcp_servers.<name>]` tables), and may bake
skills into `/sandbox/.agents/`. It selects its tag through the helper's
`image` setting. Keep the managed config and rules at least as strict as the
base image and never bake a credential. A stdio runtime belongs in the store;
plugins have no recorded same-agent path, so report one by name. See the
[environment playbook](../environment-playbook.md).

## Differences

- Native Codex binaries only: no Node or Bun, so the npm launcher and
  `npx`-launched MCP servers need a store runtime.
- Runs as uid/gid 1500 and holds no credential or login state.
- `tui` is ignored; no fish plugin.
- Profiles bind `/usr/local/bin/codex`; renaming or wrapping it breaks egress.
- The credential is a ChatGPT plan only; there is no API-key or Enterprise
  token path and no in-sandbox login.
- Codex reads global config from `/sandbox/.codex/`, because `sandbox exec`
  does not pass image `ENV`. `AGENTS.md` stays with the project, and a custom
  `--workdir` is trusted once in the TUI.

## See also

- [`docs/ai/onboarding.md`](../onboarding.md) — choose Maki, OpenCode, Claude
  Code, or Codex.
- [`docs/ai/playbooks/codex.md`](../playbooks/codex.md) — the ordered Codex
  path.
- [`codex-oss/README.md`](../../../codex-oss/README.md) — raw path and
  verification summary.
- [`docs/ai/verification/codex.md`](../verification/codex.md) — the
  verification record.
- [`docs/helper.md`](../../helper.md) — shared helper commands and sync.
- [`docs/providers.md`](../../providers.md) — shared provider forms.
- [`docs/ai/references.md`](../references.md) — upstream documentation index.
