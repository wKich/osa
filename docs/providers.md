# Providers: any API key, one sandbox

`maki-oss provider setup` turns an API key you already hold into a working
OpenShell provider. It finds the key in a local credential store (Maki or
OpenCode), or reads it from a JSON file, a host environment variable, or a
hidden prompt; resolves a provider profile; lints and imports it; creates or
updates the provider instance; and can attach it to the project sandbox.

Credential values never appear in argv, output, shell history, or files. The
wizard exports the value only into the environment of the `openshell` child
process, and the sandbox process still sees an opaque stand-in in place of the
key (see the placeholder entry in [`docs/glossary.md`](glossary.md)). Never
write a credential into the sandbox environment with `openshell sandbox create
--env` or `--env-from`: both bypass the placeholder, and the helper refuses
credential-like names on either path.

Upstream reference: the Maki provider docs and the OpenShell profile docs are
indexed, with the versions this repository was verified against, in
[`docs/ai/references.md`](ai/references.md). The machine-readable mapping from
credential-store slugs to profiles is
[`examples/providers/catalog.tsv`](../examples/providers/catalog.tsv).

## The model: profile, provider, placeholder

| Piece | Lives | What it is |
|---|---|---|
| **Profile** | Gateway, imported from `examples/providers/*.yaml` | A reusable definition: credential environment variable, endpoint hosts, allowed binaries |
| **Provider** | Gateway (`openshell provider ...`) | An instance of one profile with your credential bound to it |
| **Placeholder** | Sandbox process environment | The opaque stand-in the sandbox sees in place of the key — the proxy substitutes the real value only at the profile's endpoints |

The profile also contributes the network policy that lets `/usr/local/bin/maki`
reach the provider endpoint, so an attached provider is both a credential and
the egress rule for it. This is why the base policy can stay network-free:
`examples/policies/maki-minimal.yaml` adds no endpoints of its own.

## Curated catalog

Every profile below names only `/usr/local/bin/maki` (the path used by
`examples/maki-image`) and binds one host at port 443, read-write, L7 enforced.

| Profile | Environment variable | Endpoint | Notes |
|---|---|---|---|
| `maki-anthropic` | `ANTHROPIC_API_KEY` | `api.anthropic.com` | Header `x-api-key` |
| `maki-openrouter` | `OPENROUTER_API_KEY` | `openrouter.ai` | Bearer |
| `maki-deepseek` | `DEEPSEEK_API_KEY` | `api.deepseek.com` | Bearer |
| `maki-synthetic` | `SYNTHETIC_API_KEY` | `api.synthetic.new` | Bearer |
| `maki-openai` | `OPENAI_API_KEY` | `api.openai.com` | Platform API key only; ChatGPT OAuth is not supported |
| `maki-google` | `GEMINI_API_KEY` | `generativelanguage.googleapis.com` | Header `x-goog-api-key` |
| `maki-mistral` | `MISTRAL_API_KEY` | `api.mistral.ai` | Standard and coding plans share the host |
| `maki-xai` | `XAI_API_KEY` | `api.x.ai` | Public API key only; xAI OAuth is not supported |
| `maki-zai` | `ZHIPU_API_KEY` | `api.z.ai` | Pay-as-you-go |
| `maki-zai-coding` | `ZHIPU_API_KEY` | `api.z.ai` | Coding plan; see the plan step below |
| `maki-xiaomi-token-plan-sgp` | `XIAOMI_API_KEY` | `token-plan-sgp.xiaomimimo.com` | Bearer; Singapore region host |
| `maki-minimax-coding-plan` | `MINIMAX_API_KEY` | `api.minimax.io` | Header `x-api-key`; the endpoint speaks the Anthropic protocol |
| `maki-kimi-for-coding` | `KIMI_API_KEY` | `api.kimi.ai` | Bearer |
| `maki-nano-gpt` | `NANO_GPT_API_KEY` | `nano-gpt.com` | Bearer |
| `maki-opencode` | `OPENCODE_API_KEY` | `opencode.ai` | OpenCode Zen |
| `maki-opencode-go` | `OPENCODE_API_KEY` | `opencode.ai` | Opencode Go |
| `mcp-context7` | `CONTEXT7_API_KEY` | `mcp.context7.com` | MCP server profile (`protocol: mcp`); header `x-api-key` |
| `mcp-synthetic` | `MCP_SYNTHETIC_API_KEY` | `api.synthetic.new` | stdio MCP server profile; upstream API endpoint the server process calls, Bearer |

The two `mcp-*` profiles back MCP servers rather than model calls and are not
in `catalog.tsv`, so the wizard does not resolve them from a stored slug — set
them up with `maki-oss provider setup --profile examples/providers/<id>.yaml
--env <VAR> --yes`. See [`docs/mcp-migration.md`](mcp-migration.md).

The wizard resolves a stored credential to its profile through
`catalog.tsv`, including aliases such as `opencode:zai-coding-plan` and
`maki:zhipuai-coding-plan`, both of which map to `maki-zai-coding`.

## Wizard usage

Interactive:

```sh
maki-oss provider setup
```

Detected credentials are listed as `store:slug (api-key)`. OAuth entries are
listed as `(oauth)`; selecting one exits with guidance and changes nothing.
When no store matches, the wizard offers a JSON file, an environment variable,
or a hidden prompt, then either a catalog match or the custom flow.

Non-interactive (every prompt has a flag):

| Flag | Meaning |
|---|---|
| `--from maki\|opencode` | Credential store to scan |
| `--credential SLUG` | Store entry to use (required with `--from` on a non-TTY) |
| `--file PATH` | JSON credential file |
| `--field PATH` | Field path inside `--file` (default `.api_key`; nested paths need `jq`) |
| `--env VAR` | Host environment variable holding the key |
| `--profile FILE` | Use this profile instead of the catalog or custom flow |
| `--name NAME` | Provider instance name (default: the profile id) |
| `--yes` | Confirm create/update/overwrite without prompting |
| `--attach` / `--no-attach` | Attach to the project sandbox, or never attach |

```sh
# Migrate the OpenCode Go key already stored by Maki.
maki-oss provider setup --from maki --credential opencode-go --yes

# From a JSON file or a host environment variable, with a shipped profile.
maki-oss provider setup --file ~/.secrets/creds.json --field api_key \
    --profile examples/providers/maki-deepseek.yaml --yes
maki-oss provider setup --env DEEPSEEK_API_KEY \
    --profile examples/providers/maki-deepseek.yaml --yes
```

Store-sourced credentials resolve through the catalog automatically; the
generic file/env/prompt sources need `--profile`, or an interactive session
for the custom flow, because they carry no store slug.

Behavior notes:

- When stdin is not a terminal, the wizard refuses to guess: without the
  flags needed to complete the flow it exits non-zero **before** any profile
  import or provider create/update.
- `provider setup` lints every profile before import and aborts with no
  gateway change when lint fails. Import is skipped when the profile id is
  already in the platform catalog.
- An existing provider is offered an update (`provider update --from-existing`)
  instead of creating a duplicate; on a non-TTY, pass `--yes` to accept it.
- Attachment is opt-in: `--attach`, or answer `y` at the interactive prompt.
  The attach always uses `--wait` so the sandbox applies the credential before
  you run Maki.
- For sandboxes, `provider setup` prints the follow-up commands (`up
  --provider`, `provider attach`, `run --model`), and for `maki-zai-coding` it
  prints the plan line to add to the sandbox's Maki `providers.toml`; it never
  writes into the sandbox.

### Scripted interactive runs

`MAKI_OSS_INTERACTIVE=1` makes the wizard treat piped stdin as interactive,
which is how the test suite drives the prompts. It changes only where prompts
read from; credential handling is identical.

## Custom providers

When no curated profile matches, the interactive wizard collects the provider
id (kebab-case), the credential environment variable, the endpoint host, and an
optional API path prefix, validates each field, and fills
[`examples/providers/template.yaml`](../examples/providers/template.yaml) into:

```
${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/profiles/<id>.yaml
```

The generated file contains profile configuration only — never the credential
value. If the target already exists, the wizard asks before overwriting; with
`--yes` it overwrites, and on a non-TTY without `--yes` it stops.

To write a profile by hand, copy the template, edit `id`, `display_name`,
`env_vars`, and `host`, then lint and import it:

```sh
cp examples/providers/template.yaml /tmp/my-provider.yaml
# edit /tmp/my-provider.yaml
openshell profile lint -f /tmp/my-provider.yaml
openshell profile import -f /tmp/my-provider.yaml --global
maki-oss provider setup --profile /tmp/my-provider.yaml --env MY_PROVIDER_API_KEY --yes
```

## Verify

```sh
openshell profile describe maki-opencode-go   # endpoint, binary, credential keys
openshell provider list                       # instance names only
maki-oss status                               # providers attached to the sandbox
```

Inside the sandbox, confirm the placeholder (never the value):

```sh
openshell sandbox exec -n maki --no-login-shell -- printenv OPENCODE_API_KEY
# v3789022262450335270_OPENCODE_API_KEY   (a placeholder, never the key)
```

`make lint-profiles` lints every `examples/providers/*.yaml` with the real
`openshell` CLI; it skips with a message when the CLI is absent.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `credential_endpoint_mismatch` at request time | A `<PROVIDER>_BASE_URL` override in the sandbox makes the profile endpointless | Remove the override and use the profile as imported |
| `profile not found` on `provider create` | Profile not imported, or imported to another scope | `openshell profile import -f <file> --global` |
| `provider 'X' already exists` on setup | Non-TTY without `--yes` | Rerun with `--yes` to update it |
| OAuth entry selected | The store entry has no API key | Use an API-key credential; see [`docs/migrating-providers.md`](migrating-providers.md) |
| `nested field paths are not supported` | `jq` is missing | Install `jq`, or use the single-level key |
| `profile lint failed` | Invalid YAML or schema drift | Run `openshell profile lint -f <file>` and fix the reported field; see [`docs/ai/references.md`](ai/references.md) |
| Z.AI coding models missing | Plan not selected in the sandbox | Add `[zai] plan = "coding"` to the sandbox's Maki `providers.toml` |

See also [`docs/ai/references.md`](ai/references.md), the only index of
external OpenShell and Maki documentation, and
[`docs/setup-guide.md`](setup-guide.md) for the end-to-end sandbox flow.
