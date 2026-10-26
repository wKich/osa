# Proposal

## Why

`docs/ai/environment-playbook.md` claims to be the agent-agnostic procedure for
composing a personal environment, but every stage is Maki-shaped:
`maki-agent:local`, Maki config paths, `maki-oss provider setup`, `maki-oss mcp
status`, `MAKI_OSS_IMAGE`, a Maki-only store layout, a Maki-only report, and a
prompt that accepts only "Maki and/or OpenCode". An OpenCode, Claude Code, or
Codex reader must translate the page before it applies, and the
`environment-layer` spec requires an agent-neutral procedure while naming only
Maki. The current page and contract contradict each other.

## What Changes

- Rewrite `docs/ai/environment-playbook.md` as one shared procedure with a
  per-agent adapter table for Maki, OpenCode, Claude Code, and Codex. The table
  covers the base image, helper config path, store config directory, image
  setting, provider setup, MCP config, skills and plugins, and agent-specific
  limitations.
- Keep `examples/environments/reference/` as the Maki worked example. The
  playbook, the reference store's README, and the contract say it is the Maki
  example, not the only prerequisite or a default store for other agents.
- Generalize every stage: audit sources for all four agents, the five-bucket
  classification, the store skeleton, build and image selection, boundary
  verification, the report, the paste-able prompt, and the invariants.
- Update `docs/ai/document-contract.md` so a shared page may carry a per-agent
  adapter table, and so shared pages do not choose a default agent.
- Update the onboarding `See also` wording and any reference-store wording that
  still implies the environment layer is Maki-only. No document paths move.
- Update `openspec/specs/environment-layer/spec.md`: the procedure requirement
  becomes genuinely agent-agnostic with adapter-table scenarios; the store
  boundary, reference store, and derived-image requirements name the selected
  agent's base image and helper instead of assuming `maki-oss`. The capability
  purpose is edited directly during sync because OpenSpec deltas cannot modify
  an existing capability's purpose.
- **Does not** change any helper, image, policy, provider, bridge, oskhs,
  dashboard, sandbox, or credential behavior, and does not ship a new
  environment store for OpenCode, Claude Code, or Codex.

## Capabilities

### New Capabilities

_None._ This change makes an existing documentation procedure match its
existing contract; no new runtime behavior is introduced.

### Modified Capabilities

- `environment-layer`: the documented procedure is agent-agnostic and carries a
  four-agent adapter table; the environment store builds from the selected
  agent's base image; the reference store is explicitly the Maki worked
  example; each front-end helper selects its derived image through its own
  existing `image` setting.

## Impact

- **Edited files:** `docs/ai/environment-playbook.md`,
  `docs/ai/document-contract.md`, `docs/ai/onboarding.md`,
  `examples/environments/reference/README.md`, and any `See also` or reference
  wording that still says the store procedure is Maki-only.
- **Spec deltas:** `openspec/specs/environment-layer/spec.md` (four modified
  requirements), with the purpose updated directly during sync.
- **No path moves and no new redirects.** The environment playbook stays at its
  shared path; the Maki reference store stays under `examples/environments/`.
- **No code, image, policy, provider, bridge, oskhs, dashboard, or sandbox
  changes.** No credential path or egress rule is touched.
- **Risk:** the adapter table drifts from the per-agent pages. The design keeps
  one row per agent and links each agent reference instead of duplicating its
  procedure; acceptance greps and the link checker catch stale paths.
- **Dependencies:** `align-codex-docs` may land first and move Codex to
  `docs/ai/reference/codex.md`. Until then the Codex row links the current
  `docs/codex-oss.md` and `codex-oss/README.md`; paths are updated by whichever
  change lands second.
