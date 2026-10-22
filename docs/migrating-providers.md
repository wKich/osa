# Migrating provider credentials from Maki or OpenCode

Maki and OpenCode keep provider credentials host-side. This guide moves an
API-key credential from one of those stores into an OpenShell provider without
retyping the key, and explains what to do when the store holds an OAuth login
instead.

The fast path is [`maki-oss provider setup`](providers.md); the manual recipes
below use the same profile files for when you want to see each step.

## Supported stores and paths

| Agent | Path | API-key shape | OAuth shape |
|---|---|---|---|
| Maki, built-in providers | `~/.local/state/maki/auth/<slug>.json` | `{"api_key": "..."}` | `{"access": "...", "refresh": "...", "expires": ...}` |
| Maki, plugins | `~/.local/state/maki/auth/plugins/<slug>.json` | `{"api_key": "..."}` or `{"key": "..."}` | refresh fields as above |
| OpenCode | `~/.local/share/opencode/auth.json` | per slug: `{"type": "api", "key": "..."}` | per slug: `{"type": "oauth", ...}` |

A slug that maps through [`examples/providers/catalog.tsv`](../examples/providers/catalog.tsv)
gets a curated profile; slugs without a mapping go through custom profile
generation in the wizard. Aliases such as `zai-coding-plan` (OpenCode) and
`zhipuai-coding-plan` (Maki) resolve to `maki-zai-coding`.

The scanner reads only the slug and the auth type. Credential values are never
printed, logged, or copied anywhere except the environment of the `openshell`
child process that creates the provider.

## Wizard walkthrough

Check what the stores hold (no values shown; `maki-oss` does this for you):

```sh
jq -r 'to_entries[] | "\(.key) \(.value.type)"' ~/.local/share/opencode/auth.json
jq -r 'keys[]' ~/.local/state/maki/auth/*.json
```

Run the wizard:

```console
$ maki-oss provider setup
Detected credentials:
  1. maki:opencode-go (api-key)
  2. opencode:deepseek (api-key)
  3. opencode:openai (oauth)
Select 1-3, or g for another source, q to quit: 1
Using curated profile 'maki-opencode-go'.
Linting profile 'maki-opencode-go'...
Importing profile 'maki-opencode-go' globally...
Provider 'maki-opencode-go' created.

Next steps:
  attach at creation:            maki-oss up --provider maki-opencode-go
  attach to an existing sandbox: maki-oss provider attach maki-opencode-go
  pick a model headless:         maki-oss run --model <provider/model> "..."
```

The same flow non-interactively, suitable for scripts:

```sh
maki-oss provider setup --from maki --credential opencode-go --yes
```

Then create or attach the sandbox with the provider (or rerun `provider setup
--attach` to attach immediately):

```sh
maki-oss up --provider maki-opencode-go
maki-oss run --model opencode-go/deepseek-v4.1-flash "summarize the repo"
```

## Manual recipes

`jq` → one-shot environment prefix → `maki-oss provider add --from-existing`.
The command substitution keeps the value out of argv and out of the command
line, and the prefix exports it only for that one child process.

### Maki built-in (`api_key`)

```sh
openshell profile lint -f examples/providers/maki-opencode-go.yaml
openshell profile import -f examples/providers/maki-opencode-go.yaml --global

OPENCODE_API_KEY="$(jq -r '.api_key' ~/.local/state/maki/auth/opencode-go.json)" \
  maki-oss provider add maki-opencode-go --type maki-opencode-go --from-existing

maki-oss provider attach maki-opencode-go
```

### Maki plugin (`api_key` or `key`)

```sh
MISTRAL_API_KEY="$(jq -r '.api_key // .key' ~/.local/state/maki/auth/plugins/mistral.json)" \
  maki-oss provider add maki-mistral --type maki-mistral --from-existing
```

### OpenCode (`type: api`, per slug)

```sh
DEEPSEEK_API_KEY="$(jq -r '.deepseek.key' ~/.local/share/opencode/auth.json)" \
  maki-oss provider add maki-deepseek --type maki-deepseek --from-existing
```

### A provider with no curated profile

Generate or copy a profile first, then use its environment variable:

```sh
cp examples/providers/template.yaml /tmp/my-provider.yaml
# edit id, env_vars, and host
openshell profile lint -f /tmp/my-provider.yaml
openshell profile import -f /tmp/my-provider.yaml --global
MY_PROVIDER_API_KEY="$(jq -r '.server.key' ~/.local/share/opencode/auth.json)" \
  maki-oss provider add my-provider --type my-provider --from-existing
```

`maki-oss provider setup --file/--env` wraps these recipes and performs the
lint-before-import check itself.

## OAuth limitations

OAuth entries cannot be used here:

- Maki OAuth files (for example `openai.json` after `maki auth login openai`,
  or an xAI login) contain short-lived `access` and rotating `refresh` tokens.
- OpenCode marks such entries with `{"type": "oauth"}`; they have no `key`.

The wizard lists them as `(oauth)` and refuses to select them. Why not extract
the access token anyway:

- it expires mid-run, and the helper has no way to refresh it;
- the refresh grant belongs to the agent that owns the login; copying it into
  a static provider would break the agent's own session;
- gateway-managed refresh (`oauth2_refresh_token`) needs profile-declared token
  URLs and refresh material and is outside this change's scope.

If you need the provider behind an OAuth login:

1. Prefer the provider's API-key path when it offers one — for example an
   `OPENAI_API_KEY` or `XAI_API_KEY` — and run the wizard against that.
2. Otherwise keep using the OAuth login outside the sandbox until OpenShell
   refresh metadata is configured for the provider (see
   [`docs/ai/references.md`](ai/references.md)).
3. Never copy a live access token into a profile or pass it with
   `openshell sandbox create --env` or `--env-from`.

## Security rationale

The migration path keeps the project's boundary intact:

- **The credential lands in the gateway, not the sandbox.** The sandbox process
  receives an opaque stand-in in place of the key, and the proxy substitutes
  the real value only at the profile's endpoints, for the profile's binary.
- **No credential in argv or on disk.** Values move through the child-process
  environment only; generated profiles contain configuration, never secrets,
  and the wizard never echoes a value.
- **Egress stays deny-by-default.** Importing a profile adds exactly one host;
  no wildcard hosts or `tls: skip` are introduced.
- **`maki auth login` still never runs inside the sandbox.** If the access token
  expires, re-import the credential on the host and update the provider.

## Verification

The wizard, the scanner listings, and the credential non-exposure assertions
run against fixture stores under a temporary `HOME` in `make test` (see
`tests/run-tests.sh`, cases `setup-*`). The manual `jq` expressions above were
checked against fixture files with the same shapes as the real stores:

```sh
tmp=$(mktemp -d)
mkdir -p "$tmp/auth"
printf '{"api_key": "fixture"}\n' > "$tmp/auth/opencode-go.json"
jq -r '.api_key' "$tmp/auth/opencode-go.json"     # fixture
rm -rf "$tmp"
```

For a full audit → migrate → verify run against a real host, including slugs
with no curated profile and the ones that cannot be migrated at all, see
[`docs/dogfood-migration.md`](dogfood-migration.md).

The real-gateway dry run of the wizard is recorded in
[`docs/verification-log.md`](verification-log.md).
