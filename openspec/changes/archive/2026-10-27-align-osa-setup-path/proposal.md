# Proposal

## Why

The setup docs have a strong structure but no single ordered path. A human who
wants to hand setup to an agent must find the prompt inside a long router; an
agent that follows the playbooks can run `doctor` before the image exists, run
the same work in `P2`, `P3`, and `P4`, mix the helper and raw sandbox paths, or
commit the user's uncommitted work while preparing an upload. The shared
reference pages also still describe only some of the four agents. The result is
a setup flow that looks complete but is easy to execute incorrectly.

This change makes the human input one short prompt and makes the agent's route
one ordered, safe path from that prompt to a verified sandbox. It also brings
the high- and medium-severity findings from the setup-docs review into the
documentation contract so the same drift is caught by tests.

## What Changes

- Add a short "let your agent set it up" prompt to `README.md` as the first
  setup entry, with the full prompt kept in `docs/ai/onboarding.md`.
- Make the agent route explicit and single: README prompt → onboarding router →
  shared host playbook → the chosen agent playbook → the verification page.
- Fix the canonical phase map so each action has one owner: `P2` is repository,
  helper, and shell; `P3` is the image; `P4` is the provider. Remove the
  duplicate image build and provider setup from `P2`.
- Make every agent playbook helper-first with a clearly separated raw fallback,
  and state that the two paths must not be mixed in one run. The helper sandbox
  names (`mk-`, `oc-`, `cc-`, `cx-`) and raw fallback names are both stated.
- Replace the `git init` / `git add -A && git commit` project-preparation block
  in the playbooks with a consent-based preparation step that never commits the
  user's work and never commits secrets.
- Order the first-run commands as `image build` then `doctor` in `README.md`,
  `docs/helper.md` (Install and Cookbook), and the Maki daily-driver section.
- Reconcile the Maki verification record with the 0.6.5 pin: record the current
  run if one exists, or mark checks 1–6 as the historical 0.6.4 run and add a
  current 0.6.5 note. Do not carry an old result forward as current.
- Treat a host `maki` CLI as optional for the helper path. The image pin remains
  authoritative; a missing host CLI no longer stops onboarding.
- Make the container-engine claim match the documented preflight: either add a
  Podman preflight and `engine = "podman"` path to the host playbook, or narrow
  the README to the engine the playbook verifies.
- Bring the shared references to four agents: `docs/helper.md`,
  `docs/providers.md`, `docs/glossary.md`, `dashboard/README.md`, `AGENTS.md`,
  the OpenCode, Claude, and Codex provider pointers, and the Codex skills path
  in onboarding. Pages that remain Maki-scoped say so explicitly instead of
  reading as the default for every agent.
- Make `docs/setup-guide.md` truthful about its starting point, pin OpenShell to
  the version the host playbook verifies, move `mcp status` after sandbox
  creation, and replace the inline-key manual recipe with a hidden-input path.
- Add asset checks to `tests/run-tests.sh` for the one-prompt entry, phase
  ownership, safe project preparation, build-before-doctor order, and
  four-agent shared references.
- **Does not** change helper, image, policy, provider, bridge, oskhs, dashboard
  runtime, or sandbox behavior. This is a documentation and documentation-test
  change.

## Capabilities

### New Capabilities

_None._ The one-prompt entry and the ordered path are behavior of the existing
onboarding and host-setup capabilities; no new runtime capability is introduced.

### Modified Capabilities

- `agent-onboarding`: the prompt becomes the primary README entry; the phase
  map gives each action one owner; each playbook has one primary path; project
  preparation is consent-based and never commits; credential commands never
  expose a value; first-run commands are ordered; and the shared reference
  pages name all four front-ends or state their Maki scope.
- `host-setup`: the host `maki` CLI becomes optional for the helper path, the
  engine claim matches a documented preflight, the shared host playbook remains
  the only host-provisioning path, and the image pin remains authoritative.

## Impact

- **Edited docs:** `README.md`, `docs/helper.md`, `docs/providers.md`,
  `docs/glossary.md`, `docs/setup-guide.md`, `AGENTS.md`,
  `docs/ai/onboarding.md`, `docs/ai/document-contract.md`,
  `docs/ai/host-playbook.md`, `docs/ai/playbooks/{maki,opencode,claude,codex}.md`,
  `docs/ai/reference/{opencode,claude,codex}.md`,
  `docs/ai/verification/maki.md`, and `dashboard/README.md`.
- **Spec deltas:** `openspec/specs/agent-onboarding/spec.md` and
  `openspec/specs/host-setup/spec.md`.
- **Tests:** `tests/run-tests.sh` gains assertions for the setup path; no
  helper behavior is exercised differently.
- **No dependency or API changes.** No credential path or egress rule is
  touched. No host bind mount is introduced.
- **Risk:** the README prompt and the onboarding prompt can drift; the asset
  check compares the entry points and the required landmarks rather than exact
  prose. The helper-first playbook restructure can hide raw commands; the raw
  fallback sections stay, but they are marked "do not run in the same pass".
- **Dependencies:** none. The change builds on the landed four-agent playbooks
  and references.
