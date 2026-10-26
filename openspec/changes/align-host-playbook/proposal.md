# Proposal

## Why

`docs/ai/host-playbook.md` claims to be the shared P0-P2 host path, but its
content installs the Maki CLI, runs Maki-only helper commands, builds
`maki-agent:local`, runs the Maki provider wizard, installs the Maki fish
function, sets `MAKI_OSS_BIN`, and documents the Maki daily-driver loop. An
OpenCode or Claude Code reader following the router lands on a Maki page that
cannot be used as written. The page must either become genuinely shared or stop
claiming it is.

## What Changes

- Make `docs/ai/host-playbook.md` the shared P0-P2 path: preflight, host
  tooling, then repository and shell, verified with the shared `osa` command.
  It ends by handing off to onboarding, which routes to the chosen agent.
- Move the Maki-only host steps into `docs/ai/playbooks/maki.md`: the
  `maki --version` check and install pointer, the fish function and
  `MAKI_OSS_BIN` fallback, the helper alternatives for doctor/image/provider,
  and the daily-driver loop with sync and policy review.
- Update the Maki P0-P2 cells in `docs/ai/onboarding.md` and the one-line
  descriptions in `AGENTS.md` and `README.md`.
- Update the `host-setup` spec so the shared page is agent-neutral and add a
  requirement that per-agent host steps live in that agent's page.
- Update the `agent-onboarding` "Agent page names its path" scenario so the
  shared page says it is shared while the Maki playbook says it is the Maki
  path.
- **Does not change** any helper, image, policy, provider, bridge, oskhs, or
  sandbox behavior, and does not move `docs/verification.md`.

## Capabilities

### New Capabilities

_None._ This change moves documentation and tightens the existing contract.

### Modified Capabilities

- `host-setup`: the shared host playbook no longer installs or verifies an
  agent CLI, image, provider, fish integration, or daily-driver loop. The Maki
  playbook owns those steps, and a new requirement makes that split explicit.
  The versions requirement moves the Maki version check to the Maki playbook.
- `agent-onboarding`: the "Agent page names its path" scenario must describe
  `docs/ai/host-playbook.md` as shared rather than as the Maki path.

## Impact

- **Edited files:** `docs/ai/host-playbook.md`, `docs/ai/playbooks/maki.md`,
  `docs/ai/onboarding.md`, `AGENTS.md`, `README.md`.
- **Spec deltas:** `openspec/specs/host-setup/spec.md` and
  `openspec/specs/agent-onboarding/spec.md` (one scenario).
- **No code, image, policy, provider, bridge, oskhs, or sandbox changes.** No
  credential path, egress rule, or runtime behavior is touched.
- **Risk:** the host page must contain no Maki command, and the moved content
  must still be findable in the Maki playbook. `scripts/check-playbooks.sh`,
  `scripts/check-links.sh`, and `make test` are the gates.
- **Dependencies:** `align-maki-docs` and `align-maki-verification` are not
  prerequisites for this page split; the Maki playbook already exists at its
  contract path.
