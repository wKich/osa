# Proposal

## Why

A user arriving with Maki, OpenCode, or Claude Code has no single AI-facing
entry point that says: keep the agent you already use, put the same agent in
an OpenShell sandbox, and migrate only that agent's configuration. The docs
are Maki-first, the OpenCode and Claude pages are references rather than
ordered paths, and `docs/mcp-migration.md` documents an OpenCode-to-Maki
switch as if it were the default. With three front-ends, that is now both
confusing and a product mismatch: osa is agent-agnostic at the helper layer,
but its onboarding still privileges Maki.

## What Changes

- Add `docs/ai/onboarding.md` as the single neutral entry point:
  - the one rule: same agent, no translation; the reading agent is the
    onboarding assistant, not necessarily the target;
  - a short copy-paste prompt that names the project and host agent, forbids
    switching agents, forbids asking for a pasted key, requires an
    audit-first plan, and requires stopping on mismatch;
  - a task index using the user's vocabulary: setup, binary, OpenShell,
    configs, migrations;
  - the canonical phase map `P0`-`P8` with Maki, OpenCode, and Claude
    columns;
  - the same-agent migration matrix for the three agents: credentials, MCP,
    settings, skills, commands, plugins, project config;
  - an add-binary section distinguishing helper, agent version, tool binary,
    and a new front-end;
  - stop conditions and a short report format;
  - the security invariants.
- Update `AGENTS.md` and `README.md` to neutral framing ("your coding agent:
  Maki, OpenCode, or Claude Code") and link `docs/ai/onboarding.md` first.
- Add one-line path notes to the existing agent pages so a reader entering
  there is routed correctly:
  - `docs/ai/host-playbook.md` and `docs/ai/agent-playbook.md` are the Maki
    path;
  - `docs/opencode-oss.md` is the OpenCode path;
  - `docs/claude-oss.md` is the Claude path.
- **Does not rename or move** existing docs, add per-agent playbooks, or
  rewrite the migration and environment docs. Those are follow-up changes
  (`align-maki-docs`, `align-opencode-docs`, `align-claude-docs`,
  `clarify-migration-and-environment`).
- **Does not change** any helper, image, policy, provider, or sandbox
  behavior.

## Capabilities

### New Capabilities

- `agent-onboarding`: the repository's guarantee that any onboarding
  assistant can identify the user's existing agent, put that same agent in
  its matching OpenShell sandbox, follow the shared phase and gate contract,
  and migrate same-agent configuration without translating between agents.

### Modified Capabilities

_None._ This change adds the onboarding entry point; it does not change the
behavior of `helper-cli`, `host-setup`, `environment-layer`, `opencode-oss`,
or `claude-oss`.

## Impact

- **New file:** `docs/ai/onboarding.md`.
- **Edited files:** `AGENTS.md`, `README.md`, and short path notes in
  `docs/ai/host-playbook.md`, `docs/ai/agent-playbook.md`,
  `docs/opencode-oss.md`, `docs/claude-oss.md`.
- **New capability spec:** `openspec/specs/agent-onboarding/spec.md` after
  sync.
- **Tests:** a docs asset check that the prompt, same-agent rule, and all
  three agent rows exist; `scripts/check-links.sh`; the
  `add-doc-contract` linter.
- **Dependency:** `add-claude-oss` must land first, because the onboarding
  guide's Claude column and path note link to its docs. `add-doc-contract`
  must land first so the guide uses the canonical phases and headers.
- **No security-boundary change.** The guide repeats the existing
  invariants; it never introduces a bind mount, a secret in `--env`, a
  wildcard egress rule, or an in-sandbox login.
