# Dogfooding: migrating this machine's credentials

> **Historical record.** This is the 2026-10-18 dogfood run, not part of current
> onboarding. Current onboarding keeps the agent you already run; use the
> same-agent migration matrix in [`docs/ai/onboarding.md`](ai/onboarding.md).

A worked procedure for moving **every** credential a host already holds in Maki
or OpenCode into OpenShell providers, and for keeping them in sync afterwards.
It is the audit → classify → migrate → verify loop run against a real machine,
written so the next run repeats it verbatim.

[`docs/migrating-providers.md`](migrating-providers.md) explains the mechanism;
this guide is the checklist. [`docs/providers.md`](providers.md) covers the
wizard flags.

## 1. Audit both stores

List slugs and auth types only — never values:

```sh
jq -r 'to_entries[] | "\(.key) \(.value.type // "api")"' ~/.local/share/opencode/auth.json
for f in ~/.local/state/maki/auth/*.json; do
  printf '%s\t' "$(basename "$f" .json)"
  jq -r 'if has("refresh") then "oauth" else "api" end' "$f"
done
```

Cross-check against the gateway and the remembered list:

```sh
maki-oss provider list
grep ^providers ~/.config/maki-oss/config.toml
```

Anything in a store that has no gateway provider is un-migrated.

## 2. Classify every un-migrated slug

| Outcome | How to recognise it | Action |
|---|---|---|
| Already migrated | gateway has a provider of the same profile id | nothing |
| Catalog-mapped | `grep -P '^\w+\t<slug>\t' examples/providers/catalog.tsv` hits | one `provider setup` command |
| Needs a profile | models.dev knows the endpoint, no catalog row | write `examples/providers/*.yaml`, add a catalog row, then migrate |
| Not migratable | OAuth entry, or a loopback/private endpoint | document it and skip |

Endpoint and credential environment variable come from the agent's own
provider registry — the same catalog the sandboxed Maki reads:

```sh
jq -r --arg s <slug> '.[$s] | "env=\((.env // [])|join(",")) api=\(.api // "-") npm=\(.npm // "-")"' \
  ~/.cache/maki/models-dev-catalog.json      # Maki
jq -r --arg s <slug> '.[$s] | "env=\((.env // [])|join(",")) api=\(.api // "-") npm=\(.npm // "-")"' \
  ~/.cache/opencode/models.json              # OpenCode, for slugs Maki lacks
```

Two details decide the profile file:

- **`npm`** — `@ai-sdk/anthropic` means an Anthropic-protocol endpoint, so the
  profile uses `auth_style: header`, `header_name: x-api-key` (see
  [`examples/providers/maki-minimax-coding-plan.yaml`](../examples/providers/maki-minimax-coding-plan.yaml)).
  Anything else is `auth_style: bearer`.
- **Region** — `token-plan-cn` and `token-plan-sgp` are different hosts, so they
  are different profiles. Name the profile after the slug (`maki-<slug>`) and
  copy [`examples/providers/template.yaml`](../examples/providers/template.yaml),
  keeping the profile to one host and no `path:` prefix, exactly like the
  curated catalog.

The slug a store uses need not be the slug Maki's registry uses
(`opencode:kimi-for-coding` is `kimi-code-plan-global` to Maki, same host). The
catalog row is what reconciles them.

## 3. Pick a source of record

Some keys exist in both stores. When they are byte-identical either store works;
hashing proves it without printing a value:

```sh
jq -r '.api_key' ~/.local/state/maki/auth/synthetic.json | shasum -a 256
jq -r '.synthetic.key' ~/.local/share/opencode/auth.json  | shasum -a 256
```

Identical hashes → migrate from one store only. Different hashes → the two
stores hold different keys: decide which one the sandbox should use before
running step 4, because the second run *updates* the provider to the other key.

## 4. Migrate

One command per slug. The wizard reads the key from the store, lints the
profile, imports it, creates the provider, and remembers it in the config file;
the value never reaches argv or output:

```sh
for slug in zai-coding-plan synthetic xiaomi-token-plan-sgp \
            minimax-coding-plan kimi-for-coding nano-gpt; do
  maki-oss provider setup --from opencode --credential "$slug" --yes --no-attach
done
```

Non-TTY runs need a catalog row for the slug — without one the wizard exits
before touching the gateway and asks for `--profile FILE` or a terminal. That
is what step 2's "needs a profile" outcome is for.

`--no-attach` keeps step 4 free of policy effects: creating a provider widens
nothing. Attaching it is what adds the endpoint to a sandbox's effective policy,
so attach deliberately (`maki-oss up --provider <name>`), not by habit.

## 5. Verify

```sh
maki-oss provider list                 # one row per migrated credential
openshell profile list --type provider --global
grep ^providers ~/.config/maki-oss/config.toml
```

Each provider row shows `CREDENTIAL_KEYS 1`, never a value. Confirm no secret
landed in a generated profile or in the config file:

```sh
grep -R -l -e 'sk-' -e 'api_key:' ~/.config/maki-oss/ ; echo "exit=$?"
# expect: no matches, exit=1
```

Inside a running sandbox the credential is still an opaque placeholder:

```sh
openshell sandbox exec -n maki --no-login-shell -- printenv MINIMAX_API_KEY
# ..._MINIMAX_API_KEY   (a placeholder, never the key)
```

## 6. Re-sync after a rotation

There is no sync command and no drift detection. When a key rotates in the
store, rerun step 4 for that slug — an existing provider is updated in place
(`provider update --from-existing`), never duplicated. When a new provider
appears in a store, add it to the loop. When it has no catalog row, that is a
step-2 outcome again.

## This machine's run — 2026-10-18

Source: OpenCode store, cross-checked against the Maki store (hash-identical
for the three overlapping slugs). 6 slugs migrated, 8 providers total.

| Slug | Profile | Note |
|---|---|---|
| `zai-coding-plan` | `maki-zai-coding` | existing curated profile; the sandbox's Maki needs `[zai] plan = "coding"` in `providers.toml` |
| `synthetic` | `maki-synthetic` | existing curated profile |
| `xiaomi-token-plan-sgp` | `maki-xiaomi-token-plan-sgp` | **new** profile; `XIAOMI_API_KEY`, `token-plan-sgp.xiaomimimo.com` |
| `minimax-coding-plan` | `maki-minimax-coding-plan` | **new** profile; `MINIMAX_API_KEY`, Anthropic-protocol endpoint on `api.minimax.io` |
| `kimi-for-coding` | `maki-kimi-for-coding` | **new** profile; `KIMI_API_KEY`, `api.kimi.ai` |
| `nano-gpt` | `maki-nano-gpt` | **new** profile; `NANO_GPT_API_KEY`, `nano-gpt.com` |

Not migrated, deliberately:

- **`openai`** — `{"type": "oauth"}` in OpenCode and an access/refresh pair in
  the Maki store. Short-lived tokens, no refresh path here; see
  [`docs/migrating-providers.md`](migrating-providers.md#oauth-limitations).
- **`localhost`** — `http://127.0.0.1:8888/v1`, a local unsloth server. A
  sandbox has its own network namespace, so the host's loopback is unreachable
  from inside; a provider would be a credential bound to an endpoint that does
  not exist there. Keep it host-side.

All 8 are remembered in `~/.config/maki-oss/config.toml`, so the next bare
`maki-oss` attaches all 8 and widens the sandbox's effective policy by exactly
those 8 hosts. Trim the list to what a session needs if that is wider than the
work requires.
