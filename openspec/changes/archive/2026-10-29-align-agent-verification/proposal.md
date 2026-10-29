# Proposal

## Why

`docs/verification.md` is the single flat verification checklist for every
agent, while OpenCode and Claude keep their verification records as long tables
inside `opencode-oss/README.md` and `claude-oss/README.md`. The P6 cells in the
onboarding router all point at the flat page, so the per-agent records have no
contract-shaped home, the READMEs duplicate what a verification page should
own, and the document contract cannot enforce Run/Verify/Stop on any of the
three records.

## What Changes

- Move `docs/verification.md` to `docs/ai/verification/maki.md` with the
  verification metadata, `## Scope`, `## Invariants`, `## See also`, and one
  `## Check` block per existing isolation area. The recorded run is reorganized,
  not re-run: the 2026-10-22 OpenShell v0.1.5 results and the 2026-10-26 sync
  matrix re-run are preserved with their dates.
- Add `docs/ai/verification/opencode.md` and
  `docs/ai/verification/claude.md` by reorganizing the verification tables in
  the two subproject READMEs into grouped `## Check` blocks. Every command and
  observed result is preserved; the dates and pinned versions stay those of the
  recorded runs.
- Replace the full verification tables in `opencode-oss/README.md` and
  `claude-oss/README.md` with a short verification summary that names the
  pinned versions and date and links the canonical page.
- Update every current reference: the onboarding P6 cells for all three agents,
  the playbooks' `Handoff`/`Verification` metadata and Phase 5 links, the agent
  references, the environment playbook, `docs/setup-guide.md`, `README.md`,
  `AGENTS.md`, `docs/verification-log.md`, and the host-setup, opencode-oss,
  and claude-oss specs.
- **Does not** change any helper, image, policy, provider, example, bridge,
  oskhs, dashboard, or sandbox behavior. No check is dropped, and no security
  invariant is relaxed.
- **Does not** add a redirect stub; the old `docs/verification.md` path is
  removed.

## Capabilities

### New Capabilities

_None._ This change moves and reshapes documentation; no runtime behavior is
introduced.

### Modified Capabilities

- `host-setup`: the versions requirement and its consistency scenarios name
  `docs/ai/verification/maki.md` as the Maki checklist that records a
  re-verification run.
- `opencode-oss`: the self-contained allowlist names
  `docs/ai/verification/opencode.md`; the canonical verification record lives on
  that page, and `opencode-oss/README.md` keeps a short summary and link.
- `claude-oss`: the self-contained allowlist names
  `docs/ai/verification/claude.md`; the canonical verification record lives on
  that page, and `claude-oss/README.md` keeps a short summary and link.
- `agent-onboarding` is unchanged: it does not name the old path, and its
  existing phase-link requirement already covers the new P6 targets.

## Impact

- **Moved file:** `docs/verification.md` → `docs/ai/verification/maki.md`.
- **New files:** `docs/ai/verification/opencode.md`,
  `docs/ai/verification/claude.md`.
- **Edited files:** `docs/ai/onboarding.md`,
  `docs/ai/playbooks/maki.md`, `docs/ai/playbooks/opencode.md`,
  `docs/ai/playbooks/claude.md`, `docs/ai/reference/maki.md`,
  `docs/ai/reference/opencode.md`, `docs/ai/reference/claude.md`,
  `docs/ai/environment-playbook.md`, `docs/setup-guide.md`,
  `docs/verification-log.md`, `README.md`, `AGENTS.md`,
  `opencode-oss/README.md`, `claude-oss/README.md`.
- **Spec deltas:** `openspec/specs/host-setup/spec.md`,
  `openspec/specs/opencode-oss/spec.md`, and
  `openspec/specs/claude-oss/spec.md` (paths and verification-record ownership
  only).
- **No code, image, policy, provider, example, bridge, oskhs, dashboard, or
  sandbox changes.** No credential path or egress rule is touched.
- **Risk:** a missed old link or anchor is a visible failure, because there is
  no redirect stub. `scripts/check-playbooks.sh`, `openspec validate`,
  `make lint-docs`, `scripts/check-links.sh`, `make test`, and `make lint` are
  the gates.
- **Dependencies:** the `align-host-playbook` and the three `align-*-docs`
  changes have landed, so the shared host page, the playbooks, and the
  references already exist.
