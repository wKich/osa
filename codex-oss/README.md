# codex-oss

Run OpenAI's [Codex CLI](https://github.com/openai/codex) natively inside an
NVIDIA OpenShell sandbox, with the same isolation as the other agent paths in
this repository:

- a pinned, agent-only image;
- credentials only from OpenShell provider profiles;
- egress denied by default;
- files moved only by explicit upload and download.

The credential is your ChatGPT plan. You log in on the host, in a throwaway
Codex home. The OpenShell gateway keeps the refresh token as secret material
and refreshes the access token itself. The sandbox sees only a placeholder,
holds no `auth.json`, and Codex never logs in there.

The `codex-oss` helper (`bin/codex-oss`) does every step for you.
[Without the helper](#without-the-helper) lists the plain `docker` and
`openshell` commands it runs.

| Path | What it is |
|---|---|
| `image/Dockerfile` | Base image `codex-agent:local`: pinned native `codex` and `codex-code-mode-host`, uid/gid 1500, no Node/Bun, no MCP, no plugins, no login state |
| `image/managed_config.toml` | Root-owned `/etc/codex/managed_config.toml`: the `chatgpt-oss` provider, project trust, the traffic and feature switches, no `auth.json` |
| `image/default.rules` | Root-owned `/etc/codex/rules/default.rules`: forbids `sudo`, `su`, `ssh`, `scp`, `codex login`, `codex logout` |
| `providers/codex-chatgpt.yaml` | `CODEX_CHATGPT_TOKEN` as a bearer token to `chatgpt.com/backend-api/codex/**`, bound to `/usr/local/bin/codex`, refreshed by the gateway |
| `providers/catalog.tsv` | Profile → credential env var, example model |
| `providers/stores.tsv` | Empty: no credential store holds a ChatGPT login |
| `providers/template.yaml` | Inert profile template for providers you add by hand |
| `policies/minimal.yaml` | Sandbox policy: filesystem floor, hard Landlock, uid/gid 1500, no egress of its own |

The security invariants in [`AGENTS.md`](../AGENTS.md) apply unchanged. In
particular:

- Never pass a credential through `--env`/`--env-from`.
- Never log in inside a sandbox (`codex login`, `--with-api-key`,
  `--with-access-token`, device auth).
- Never create, upload, or mount an `auth.json` or the host's `~/.codex`.
- Never override the provider's base URL.
- Never write the provider placeholder prefix into a file the agent can read.

## Quick start with the helper

From the repository root (or with its `bin/` on `PATH`), with the Codex CLI
installed on the host:

```sh
bin/codex-oss image build          # codex-agent:local
bin/codex-oss provider setup       # browser login; or --device-auth
bin/codex-oss doctor               # refresh: ok, expires …
```

`provider setup` records `providers = "codex-chatgpt"` and your `account_id`
in `~/.config/codex-oss/config.toml`, and each new project sandbox attaches
the provider. Then, from any project directory:

```sh
codex-oss                                       # TUI, no login or trust screen
codex-oss run "reply OK"                        # headless; prints JSONL events
codex-oss run --resume <thread_id> "and now?"
codex-oss status
codex-oss rm --yes
```

The first session creates the project's sandbox (`cx-<directory>-<hash>`),
uploads the project, and attaches the remembered provider. On exit, the
helper collects the sandbox changes as a patch and applies it only when the
sandbox baseline still matches the host. See
[`docs/ai/playbooks/codex.md`](../docs/ai/playbooks/codex.md) for the ordered
path and [`docs/ai/reference/codex.md`](../docs/ai/reference/codex.md) for the
command reference and the differences from `maki-oss`.

## Without the helper

### Build the image

```sh
docker build -t codex-agent:local codex-oss/image
docker run --rm codex-agent:local codex --version   # codex-cli 0.164.0
```

The Dockerfile downloads `codex-<arch>-unknown-linux-musl.tar.gz` and
`codex-code-mode-host-<arch>-unknown-linux-musl.tar.gz` from the GitHub
release `rust-v<version>`. It checks each archive against its pinned SHA-256
and installs both binaries under `/usr/local/bin/`. Codex runs every shell
command through `codex-code-mode-host`; without it, every tool call fails.

To bump the version, change `CODEX_VERSION` and all four `*_SHA256_*` args
together. Read the digests from the release:

```sh
V=0.164.0
gh release view rust-v$V -R openai/codex --json assets --jq '.assets[]
  | select(.name | test("^codex(-code-mode-host)?-(x86_64|aarch64)-unknown-linux-musl.tar.gz$"))
  | .name + " " + .digest'
```

After a bump, rerun the verification below. The managed config's feature
names and the rules location are checked at the pinned version only.

### Load the provider

Log in on the host in a throwaway home, never in `~/.codex`:

```sh
T=$(mktemp -d) && chmod 700 "$T"
CODEX_HOME=$T codex login -c 'cli_auth_credentials_store="file"'
```

Then import the profile, create the provider, and configure the gateway
refresh. Every token travels only in a child process environment:

```sh
openshell profile import -f codex-oss/providers/codex-chatgpt.yaml --global
CODEX_CHATGPT_TOKEN=$(jq -r .tokens.access_token "$T/auth.json") \
  openshell provider create --name codex-chatgpt --type codex-chatgpt \
    --credential CODEX_CHATGPT_TOKEN --global-profile
claims=$(jq -r .tokens.access_token "$T/auth.json" | cut -d. -f2 | tr '_-' '/+' \
  | awk '{l=length($0)%4; if(l==2)$0=$0"=="; else if(l==3)$0=$0"="; print}' | base64 -d)
CODEX_RT=$(jq -r .tokens.refresh_token "$T/auth.json") \
  openshell provider refresh configure codex-chatgpt \
    --credential-key CODEX_CHATGPT_TOKEN --strategy oauth2-refresh-token \
    --material "client_id=$(printf '%s' "$claims" | jq -r .client_id)" \
    --secret-material-env refresh_token=CODEX_RT \
    --credential-expires-at "$(printf '%s' "$claims" | jq -r .exp)000"
jq -r .tokens.account_id "$T/auth.json"     # keep this: the ChatGPT account ID
rm -rf "$T"
```

### Refresh

The profile's refresh block sets `max_lifetime: "864000s"`, which matches
the 240-hour access token, and `refresh_before: "300s"`. Without
`max_lifetime`, the gateway records each refresh as lasting one hour; with a
lead time of an hour or more, it then refreshes continuously. Profile
changes do not reach an existing configuration, so after changing the
refresh block, run `refresh configure` again (`codex-oss provider setup`
does). Check it with:

```sh
openshell provider refresh status codex-chatgpt
```

### Create a sandbox

```sh
openshell sandbox create --name codex --from codex-agent:local \
  --policy codex-oss/policies/minimal.yaml --provider codex-chatgpt \
  --no-auto-providers --detach
openshell sandbox upload codex . /sandbox/project
```

### Run Codex

The account ID is not a secret. Pass it on every exec, because
`sandbox exec` does not pass image environment variables through:

```sh
A=<account id>
openshell sandbox exec -n codex --workdir /sandbox/project --no-tty \
  --env CODEX_CHATGPT_ACCOUNT_ID=$A -- \
  codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
  "reply OK" </dev/null

# Continue a run by its thread_id (from the first event):
openshell sandbox exec -n codex --workdir /sandbox/project --no-tty \
  --env CODEX_CHATGPT_ACCOUNT_ID=$A -- \
  codex exec resume --json --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox <thread_id> "and now?" </dev/null

# Interactive TUI:
openshell sandbox exec -n codex --workdir /sandbox/project --tty \
  --env CODEX_CHATGPT_ACCOUNT_ID=$A -- \
  codex --dangerously-bypass-approvals-and-sandbox
```

### Bring files back

```sh
openshell sandbox download codex /sandbox/project/<file> ./
```

### Tear down

```sh
openshell sandbox delete codex
```

## Egress

All observed through `openshell logs` (OCSF events):

| Host or path | Requested by | Result |
|---|---|---|
| `POST chatgpt.com/backend-api/codex/responses` | `codex`, every turn | allowed by `codex-chatgpt` |
| other `chatgpt.com/backend-api/*` paths (`plugins/featured`, `plugins/export/curated`) | `codex` with the plugin features on | denied by the profile's path limit (`L7_REQUEST deny`); turned off in `managed_config.toml` |
| `api.github.com`, `github.com` (through `git`) | `codex` with the app and plugin features on | denied; turned off in `managed_config.toml` |
| `raw.githubusercontent.com/openai/codex/main/announcement_tip.toml` | the TUI at startup | denied; `tui.show_tooltips = false` cuts it from three requests to one, and no setting removes the last |

The gateway, not the sandbox, calls `auth.openai.com` to refresh the token.

## Verification record

Codex 0.164.0, OpenShell 0.1.5, Docker on arm64 (macOS host), ChatGPT
`prolite` plan, 2026-10-26. The canonical record, including every command and
observed result, is [`docs/ai/verification/codex.md`](../docs/ai/verification/codex.md).

The access token lasts 240 hours and the profile refreshes five minutes before
expiry; the recorded two-hour watch saw no automatic refresh and no failure.
The first scheduled refresh is a follow-up on the verification page, not a
passed check.
