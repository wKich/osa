# Proposal

## Why

The document contract and onboarding router have landed, but Maki still uses
the old flat path. `docs/ai/agent-playbook.md` is the page a reader follows
into the sandbox, while the contract's target tree names
`docs/ai/playbooks/maki.md` and `docs/ai/reference/maki.md`. The Maki path is
the right pilot for the `align-*` pattern: it proves the move, link, and spec
mechanics once before the OpenCode and Claude slices repeat them.

## What Changes

- Move `docs/ai/agent-playbook.md` to `docs/ai/playbooks/maki.md` without
  rewriting its phase content. Update the title, metadata paths, `Covers`
  value, and relative links for the new location.
- Add `docs/ai/reference/maki.md`, a thin Maki-specific reference/index:
  config and state paths, provider profiles, MCP, environment-store shape,
  and Maki-only differences. It links to the shared helper, provider, MCP,
  and environment docs instead of copying them.
- Update every current reference to the old playbook path:
  `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`,
  `docs/ai/references.md`, `AGENTS.md`, and `docs/setup-guide.md`.
- Update the `host-setup` capability's handoff requirement from
  `docs/ai/agent-playbook.md` to `docs/ai/playbooks/maki.md`.
- **Does not move or rewrite `docs/verification.md`.** Its 400+ line
  checklist needs a section-by-section conversion to the contract's
  `## Check` / `### Run` / `### Verify` template; that is the separate
  `align-maki-verification` change.
- **Does not trim `docs/ai/host-playbook.md`.** Moving its Maki-specific
  image, provider, and daily-driver content into the playbook is the separate
  `align-host-playbook` change.
- **Does not change** any helper, image, policy, provider, or sandbox
  behavior.

## Capabilities

### New Capabilities

_None._ This change only moves and indexes existing documentation.

### Modified Capabilities

- `host-setup`: the "Clear boundary to the sandbox playbook" requirement and
  its handoff scenario name `docs/ai/agent-playbook.md`. They move to
  `docs/ai/playbooks/maki.md`. The requirement's behavior is unchanged.

## Impact

- **Moved file:** `docs/ai/agent-playbook.md` →
  `docs/ai/playbooks/maki.md`.
- **New file:** `docs/ai/reference/maki.md`.
- **Edited files:** `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`,
  `docs/ai/references.md`, `AGENTS.md`, `docs/setup-guide.md`.
- **Spec delta:** `openspec/specs/host-setup/spec.md` (path only).
- **No code, image, policy, provider, or sandbox changes.** No credential
  path or egress rule is touched.
- **Risk:** every old link must be updated; `scripts/check-links.sh` is the
  gate. There is no redirect stub in this slice, so a missed link is a visible
  failure rather than a silent stale path.
- **Dependencies:** `add-doc-contract` and `add-agent-onboarding` have
  landed. `align-maki-verification` and `align-host-playbook` are follow-ups,
  not prerequisites.
