# Design

## Context

kiss stores model providers in `modelProviders` and snapshots the resolved
one on each task as `AgentTask.modelProvider` (`id` = model, `providerType`
`openai` (default) or `anthropic`, `baseUrl`, `apiKey`, `isExternal`). The
key is therefore in the task document oskhs already reads — host-side, in
the trusted oskhs process.

## Explore findings (OpenShell 0.1.5, Maki 0.6.4, 2026-10-23)

1. `openshell provider create` has no `--secret-material-env`;
   `--credential KEY` (no `=VALUE`) reads the value from the CLI's own
   environment, so it never appears in a process list. `provider update
   --credential KEY` rotates it; `provider get` shows only credential key
   names, and labels are not readable back.
2. A profile endpoint with `protocol: rest`, `enforcement: enforce`, and
   `rules: [{allow: {method, path}}]` (glob paths) enforces at L7: in a
   throwaway sandbox (curl added to the profile's binaries for the test
   only), the placeholder-bearing `GET /openai/v1/models` → 200, while
   `GET /openai/v1/files`, `POST /openai/v1/embeddings`,
   `POST /anthropic/v1/messages`, `GET /v2/whatever` → 403
   `policy_denied` (`layer: l7`, naming the missing rule).
3. Maki custom providers (`~/.config/maki/providers.toml`): `protocol =
   "openai"` with `base_url = https://api.synthetic.new/openai/v1` sends
   `<base>/chat/completions`; `protocol = "anthropic"` with `base_url =
   https://api.synthetic.new/anthropic` sends `<base>/v1/messages`. Both
   answered through the rule-restricted profiles above with
   `api_key_env` naming the profile's credential variable.
4. A provider attached to a running sandbox applies to the next `sandbox
   exec` (each round is a new process).
5. The dev stand's key is valid on both of Synthetic's APIs, so two
   genuinely different provider configurations (protocol, base URL, model)
   can be tested without copying any other credential.

## Decisions

1. **Profile per (protocol, base URL).** Id `oskhs-<protocol>-<host slug>-
   <first 6 hex of sha256(baseUrl)>`, endpoint host and port from `baseUrl`
   (443 for https), rules from the protocol and the URL's path (finding 3),
   bearer auth for OpenAI, `x-api-key` header for Anthropic, binaries
   `/usr/local/bin/maki`. Imported once (workspace scope) when `profile
   describe` does not know it; the id changes whenever its content would.
2. **Provider per project.** `oskhs-<project>`, type = that profile id,
   credential `OSKHS_MODEL_API_KEY`. oskhs keeps `{type, fingerprint}` per
   provider in `<state dir>/oskhs/providers.json` (mode 0600), fingerprint =
   first 16 hex of sha256 over type, base URL and key; a missing provider is
   created, a changed key is `provider update`d, a changed type is deleted
   and re-created. A lost state file costs one redundant update.
3. **Only this provider in the sandbox.** The sandbox is created with it as
   its only provider; on an existing sandbox oskhs attaches it if missing
   and detaches any other provider (an earlier hand-attached one, or a
   previous profile after a type change).
4. **Maki config.** Each round writes `/sandbox/.config/maki/providers.toml`
   with slug `kiss`, the protocol, base URL, `api_key_env`, and the model
   id, and runs `--model kiss/<id>`. It holds no credential, only the
   variable's name.
5. **Internal models.** `isExternal === false` requires `--internal-models`;
   otherwise the round fails before any sandbox call with a message naming
   the model and the flag.
6. **Fallback.** A task without `modelProvider` (not produced by kiss today)
   uses the worker's `--model`/`--provider` as in B1.3c; without those it
   fails with a message.
7. **Never spell the placeholder.** Files oskhs writes into the sandbox
   name the variable only; the evidence describes the stand-in in prose.

## Risks

- The key is stored in the gateway's provider record; gateway operators
  can read it (roadmap, model credentials). Per-gateway keys and spend
  limits are B5.
- Rule paths are exact globs per protocol; a provider whose API needs
  another inference path (for example streaming on a different route) is
  refused until the rule list grows.
