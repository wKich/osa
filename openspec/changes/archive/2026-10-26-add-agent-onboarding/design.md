# Design

## Context

See `proposal.md` — Why. The repository now has three front-ends over the
shared core: `maki-oss`, `opencode-oss`, and `claude-oss`. The current docs
are asymmetric:

- `docs/ai/host-playbook.md` and `docs/ai/agent-playbook.md` are Maki-only
  phase playbooks;
- `docs/opencode-oss.md` and `docs/claude-oss.md` are reference pages;
- `docs/mcp-migration.md` treats OpenCode → Maki as the default migration;
- `docs/ai/environment-playbook.md` describes a Maki-shaped store.

`add-doc-contract` supplies the canonical phases, metadata header, and
templates. `add-claude-oss` is in flight and must land first, because the
onboarding guide's Claude column and path note link to its docs.

Constraints:

- No file moves or renames in this change.
- No per-agent playbooks, no reference/verification moves, no migration
  rewrite. Those are the `align-*` and `clarify-*` follow-ups.
- No helper, image, policy, provider, or sandbox behavior changes.
- The security invariants are repeated, never relaxed.

## Goals / Non-Goals

**Goals:**

- One neutral entry point that any onboarding assistant can follow.
- The same-agent rule stated before any command or table.
- A short prompt that works for a bare host, an existing setup, and a user
  who runs more than one agent.
- A three-agent phase map and migration matrix that link to the canonical
  docs instead of duplicating them.
- Neutral `AGENTS.md` and `README.md` framing, with a one-line path note on
  each agent page.

**Non-Goals:**

- Creating `playbooks/<agent>.md`, `reference/<agent>.md`, or
  `verification/<agent>.md`. The `align-*` changes do that.
- Rewriting `mcp-migration.md`, `migrating-providers.md`,
  `dogfood-migration.md`, or `environment-playbook.md`. That is
  `clarify-migration-and-environment`.
- Adding a new helper, profile, image, policy, or sandbox command.
- Touching `docs/claude-oss.md` or the `claude-oss` spec until
  `add-claude-oss` lands.

## Decisions

### D1 — One router, not a fourth playbook

`docs/ai/onboarding.md` is a router: the same-agent rule, the prompt, the
phase map, the migration matrix, stop conditions, and the report format. The
actual commands stay in the agent pages it links.

- **Why:** a fourth full playbook would duplicate the shared host steps and
  drift. The router is the one place that must be read first.
- **Alternative rejected:** extend `host-playbook.md` — it is the Maki host
  path and has a spec that forbids sandbox commands; making it the router
  would overload its contract.

### D2 — Same-agent rule before any command

The first section states that osa runs the user's existing agent in its own
sandbox, and that a cross-agent switch is not migration. The reading agent
is the onboarding assistant, not necessarily the target.

- **Why:** the current Maki-first docs teach the wrong default. A reader who
  skims to the command table must still see the rule.
- **Alternative rejected:** put the rule in a footnote or a "notes" section —
  an agent following the prompt would miss it.

### D3 — Prompt at the top, audit before mutation

The prompt names the project and host agent, says "same agent," forbids
asking for a pasted key, requires an audit-first plan, and requires stopping
on mismatch. The guide defines the consent gates: audit is read-only; host
installs and shell edits need one approval; sandbox deletion needs its own
confirmation.

- **Why:** an onboarding run mutates the host. A short prompt cannot carry
  every branch, but it can carry the safety posture.
- **Alternative rejected:** a long prompt that lists every phase — it
  duplicates the guide and becomes another document to keep in sync.

### D4 — Canonical phase map with three agent columns

The guide uses `P0`-`P8` from `add-doc-contract`. Each phase names the Maki,
OpenCode, and Claude path, or marks the phase as shared. A mapping table
connects the existing local phase numbers to the canonical IDs.

- **Why:** three parallel playbooks with different numbers would make the
  matrix and the prompt ambiguous.
- **Alternative rejected:** renumber the existing Maki playbooks now — it
  breaks anchors and mixes a router change with a content move.

### D5 — Same-agent migration matrix, no cross-agent translation

The matrix has one column per agent and covers credentials, MCP, settings,
skills, commands, plugins, and project config. Each row names the source,
destination, and verification. Cross-agent switching is explicitly out of
scope and is reported, not transformed.

- **Why:** it is the only way to keep the guide honest for three agents with
  different stores and config schemas.
- **Alternative rejected:** a shared "config" row — it would hide the fact
  that Maki, OpenCode, and Claude have different paths and file formats.

### D6 — Add-binary section distinguishes four cases

The guide distinguishes the helper on `PATH`, the pinned agent version, a
tool binary, and a new agent front-end. Tool binaries go into the environment
store. The agent binary path is policy-bound and must not move.

- **Why:** "add binary" is ambiguous and is a common user request.
- **Alternative rejected:** leave it to the agent pages — the user asks the
  router, and the router should point at the correct mechanism.

### D7 — Discoverability and neutral framing

`AGENTS.md` and `README.md` link the onboarding guide first and describe the
product as supporting the user's coding agent (Maki, OpenCode, Claude Code).
Each agent page gets one line naming its path and linking back.

- **Why:** an agent reading only `AGENTS.md` must not conclude that Maki is
  the default.
- **Alternative rejected:** rely on the README Guides list alone — many
  agents read `AGENTS.md` first.

### D8 — Verification is document-level, not a live run

The change adds an asset test:
- the guide exists;
- the prompt and the same-agent rule are present;
- the phase map has Maki, OpenCode, and Claude columns;
- the matrix has a row for each item and each agent;
- `AGENTS.md` and `README.md` link the guide.

It also runs `scripts/check-links.sh` and the `add-doc-contract` checker. No
sandbox or live gateway run is required for a docs-only change.

- **Why:** a live three-agent run is expensive and belongs to each agent's
  own verification page. The document contract is what this change adds.
- **Alternative rejected:** a live dry run for all three agents — it would
  duplicate the existing verification records and make the change much
  larger.

### D9 — Dependency order is part of the design

This change is applied only after:
1. `add-claude-oss` lands (the Claude docs and spec exist);
2. `add-doc-contract` lands (the metadata header and `P0`-`P8` exist).

If either is missing, the change is blocked rather than partially applied.

- **Why:** the guide's Claude column, path note, and matrix rows would
  otherwise link to files that are not on `main`.
- **Alternative rejected:** add a placeholder Claude column — it would ship a
  guide that sends users to a missing path.

## Risks / Trade-offs

- **The matrix rots as agent paths change** → the asset test checks row
  presence, and `scripts/check-links.sh` checks every link; the per-agent
  `align-*` changes own the detailed content.
- **The prompt is too long or too branchy** → keep the prompt short; the
  guide carries the branches and the phase table.
- **The phase map is too wide for Markdown** → split it into shared phases
  and an agent-specific table, not one four-column table.
- **`mcp-migration.md` still teaches cross-agent switching** → this change
  labels the model; `clarify-migration-and-environment` reframes the page.
- **Conflicts with in-flight `add-claude-oss`** → land that change first and
  rebase before applying this one.
- **A user runs two agents** → the prompt asks which one to onboard first;
  the guide explicitly says one agent per run, then repeat.

## Migration Plan

1. Land `add-claude-oss`.
2. Land `add-doc-contract`.
3. Add `docs/ai/onboarding.md`.
4. Update `AGENTS.md` and `README.md` framing and links.
5. Add the one-line path notes to the Maki, OpenCode, and Claude pages.
6. Add the asset test; run the link check and the docs checker.
7. Rollback: delete the guide, revert the link/framing edits, and remove the
   asset test. No runtime state or user data is involved.
