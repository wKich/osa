# Proposal

## Why

Codex is the fourth supported front-end, but it still uses the flat
`docs/codex-oss.md` page and keeps its verification record inside
`codex-oss/README.md`. Maki, OpenCode, and Claude Code each have a
contract-shaped playbook, reference, and verification page, and onboarding
routes only those three. A Codex reader therefore cannot follow the same
phase-and-gate path, and the shared pages still describe a three-agent
product.

## What Changes

- Add `docs/ai/playbooks/codex.md`: helper-first phases for the Codex-specific
  host CLI (Phase 0), image, host-only ChatGPT login and provider, policy,
  sandbox, isolation checks, run, and cleanup, with raw `docker` and
  `openshell` fallbacks and `### Run` / `### Verify` / `### Stop if` in every
  phase.
- Move `docs/codex-oss.md` to `docs/ai/reference/codex.md` with contract
  metadata, `## Scope`, and `## See also`, and trim it to Codex-specific
  config paths, credentials and gateway refresh, profiles, sessions, MCP, store
  shape, and differences. Remove the old flat path with no redirect stub.
- Add `docs/ai/verification/codex.md` by reorganizing the recorded 2026-10-26
  OpenShell v0.1.5 / Codex v0.164.0 verification table into `## Check` blocks.
  Replace the table in `codex-oss/README.md` with a short summary that links
  the canonical page. Mark the first scheduled gateway refresh as an
  unobserved follow-up, not a passed check.
- Make onboarding four-agent: add a Codex column to the phase map and local
  numbering table, a Codex column to the same-agent migration matrix, a Codex
  choice in the copy-paste prompt, the Codex safety and authentication rules,
  and Codex entries in `See also`.
- Update every current reference: `AGENTS.md`, the root `README.md`,
  `docs/ai/document-contract.md`, `docs/ai/onboarding.md`,
  `docs/ai/host-playbook.md`, `docs/ai/references.md`,
  `codex-oss/README.md`, `codex-oss/providers/stores.tsv`, the documentation
  strings in `bin/codex-oss`, and the placeholder-spelling scan path in
  `tests/run-tests.sh`. Add Codex to the sibling playbook banners and reference
  `See also` lists.
- Update the `codex-oss`, `agent-onboarding`, and `host-setup` spec deltas so
  the new paths, the canonical verification page, and four-agent onboarding
  are the contract.
- **Does not** change any helper, image, policy, provider, bridge, oskhs,
  dashboard, or sandbox behavior. The only `bin/codex-oss` edits are
  documentation path strings.
- **Does not** add a redirect stub; the old `docs/codex-oss.md` path is
  removed.
- **Does not** add a fifth agent or a new capability. Codex behavior is
  already implemented and verified; this change aligns its documentation.

## Capabilities

### New Capabilities

_None._ This change moves and reshapes documentation; no runtime behavior is
introduced.

### Modified Capabilities

- `codex-oss`: the self-contained subproject allowlist names
  `docs/ai/playbooks/codex.md`, `docs/ai/reference/codex.md`, and
  `docs/ai/verification/codex.md`, keeps `docs/codex-oss.md` only as the
  removed source, and makes the verification page the canonical record while
  the README summarizes and links it.
- `agent-onboarding`: equal treatment for four front-ends — same-agent routing,
  the canonical phase map, the same-agent migration matrix, the add-binary
  policy-bound path list, the safety and Codex host-only authentication rules,
  and the discoverable framing all name Codex.
- `host-setup`: the per-agent host-steps requirement names
  `docs/ai/playbooks/codex.md` as the owner of the Codex host CLI, image, and
  provider steps; the shared page's no-agent-CLI scenario includes
  `codex --version`; the version-consistency requirement covers the Codex pin.

## Impact

- **Moved file:** `docs/codex-oss.md` → `docs/ai/reference/codex.md`.
- **New files:** `docs/ai/playbooks/codex.md`,
  `docs/ai/verification/codex.md`.
- **Edited files:** `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`,
  `docs/ai/references.md`, `docs/ai/document-contract.md`,
  `docs/ai/playbooks/maki.md`, `docs/ai/playbooks/opencode.md`,
  `docs/ai/playbooks/claude.md`, `docs/ai/reference/opencode.md`,
  `docs/ai/reference/claude.md`, `AGENTS.md`, `README.md`,
  `codex-oss/README.md`, `codex-oss/providers/stores.tsv`, `bin/codex-oss`,
  `tests/run-tests.sh`.
- **Spec deltas:** `openspec/specs/codex-oss/spec.md`,
  `openspec/specs/agent-onboarding/spec.md`, and
  `openspec/specs/host-setup/spec.md` (paths, canonical-record ownership, and
  four-agent scenarios only).
- **No code, image, policy, provider, bridge, oskhs, dashboard, or sandbox
  changes.** No credential path or egress rule is touched; the helper keeps
  every login, refresh, account-header, bypass, resume, and MCP behavior.
- **Risk:** a missed old link or anchor is a visible failure, because there is
  no redirect stub. `scripts/check-playbooks.sh`, `openspec validate --strict`,
  `make lint-docs`, `scripts/check-links.sh`, and `make test` are the gates.
- **Risk:** the verification table is evidence from one recorded run. The page
  must preserve its versions and date and must not claim the first scheduled
  refresh, which falls after that run.
- **Dependencies:** `align-host-playbook`, `align-opencode-docs`,
  `align-claude-docs`, and `align-agent-verification` have landed, so the
  shared host path, the other three agents' contract-shaped pages, and the
  canonical verification pages already exist.
