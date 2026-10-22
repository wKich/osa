# Proposal

## Why

Roadmap slice B1.3d. Sandbox rounds still use one model and one provider
attached by hand for every project, while kiss configures a `ModelProvider`
per project (`providerType`, `baseUrl`, model `id`, `apiKey`, `isExternal`)
and snapshots it on every task. Each project must answer with its own model,
and its key must reach the sandbox only as an OpenShell placeholder, bound to
the inference endpoints of its provider host and nothing else.

## What Changes

- Per task, oskhs derives from `task.modelProvider`:
  - a **custom profile per provider host and protocol** (`oskhs-<protocol>-
    <host>-<hash>`): `protocol: rest`, `enforcement: enforce`, inference-only
    `rules` instead of `access` — OpenAI protocol `POST <base>/chat/completions`
    and `GET <base>/models`; Anthropic protocol `POST <base>/v1/messages` and
    `GET <base>/v1/models` — credential `OSKHS_MODEL_API_KEY`, binary
    `/usr/local/bin/maki` only;
  - a **provider instance per project** (`oskhs-<project>`), created or
    updated with `--credential OSKHS_MODEL_API_KEY` so the value travels in
    the CLI's environment, never its argv (OpenShell 0.1.5 has no
    `--secret-material-env`; `--credential KEY` is its equivalent),
    re-synced whenever the provider's type, URL, or key changes;
  - attachment of that provider — and only that one — to `repo-<project>`;
  - a Maki custom provider (`providers.toml`, slug `kiss`) pointing at the
    same base URL with `api_key_env = OSKHS_MODEL_API_KEY`, and the round's
    model `kiss/<id>`.
- Internal models (`isExternal: false`) run only on a worker started with
  `--internal-models` (its gateway reaches the internal network); elsewhere
  the task is closed with an error saying so.
- The provider host's egress rule is the profile's endpoint; nothing else is
  added to the sandbox policy.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `oskhs-worker`: model and credentials come from the task's kiss
  `ModelProvider`.

## Impact

- New: `oskhs/src/kiss/model.ts` (profile/provider/Maki config derivation
  and sync), tests; changed: `kiss/sandboxRound.ts`, `round.ts` (sandbox
  providers, Maki config file), CLI flags; `oskhs/test/live/devstand.ts`
  (project-level marker, model provider snapshot); `docs/oskhs.md`,
  `docs/roadmap.md`.
- Upstream behavior relied on (measured 2026-10-23, see design):
  OpenShell profile L7 `rules`
  (https://docs.nvidia.com/openshell/how-it-works/providers/profiles.md),
  `provider create/update --credential KEY`, Maki custom providers in
  `providers.toml` (https://maki.sh/docs/providers/).
