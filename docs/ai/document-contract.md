# Document contract

This page is the source of truth for pages under `docs/ai/`. Read it before
adding, moving, or rewriting one. `scripts/check-playbooks.sh` enforces the
mechanical parts; this page explains why they exist.

## Phase IDs

The canonical phases are shared by every agent. Local phase numbers may stay
different; the router maps them to these IDs.

| ID | Phase | Gate |
|---|---|---|
| P0 | Preflight / audit | Every required host tool is present and reports a usable version. |
| P1 | Host tools | The engine, OpenShell CLI and gateway, and any host-only agent CLI are installed; a CLI baked into the image is verified at P3. |
| P2 | Repository + helper | The repository and helper resolve, and the shell is prepared. |
| P3 | Image | The agent image builds, reports the pinned agent version, and the post-build diagnostic passes. |
| P4 | Provider | The provider profile is imported and the provider is created. |
| P5 | Sandbox | The sandbox reaches `Ready` with the chosen policy and provider. |
| P6 | Verify | Every isolation check reports its expected result. |
| P7 | Run | The smoke test and the real task complete through the sandbox. |
| P8 | Report | Results are collected, the sandbox is cleaned up, and the user has a summary. |

## Naming

Shared pages describe work that every agent follows. Where a step differs, a
shared page names the difference in a per-agent adapter table or links the
agent's reference; it never chooses a default agent. Agent pages describe one
front-end and live in per-agent subdirectories once an `align-*` change moves
them. `environment-playbook.md` is the shared procedure with a four-agent
adapter table, and `examples/environments/reference/` is its Maki worked
example.

- **Shared:** `onboarding.md` (the router), `host-playbook.md`,
  `environment-playbook.md`, `references.md`, `document-contract.md`.
- **Maki:** `playbooks/maki.md`, `reference/maki.md`,
  `verification/maki.md`.
- **OpenCode:** `playbooks/opencode.md`, `reference/opencode.md`,
  `verification/opencode.md`.
- **Claude:** `playbooks/claude.md`, `reference/claude.md`,
  `verification/claude.md`.
- **Codex:** `playbooks/codex.md`, `reference/codex.md`,
  `verification/codex.md`.

The `Doc` metadata value is a stable ID, not a path: `router-onboarding`,
`playbook-maki`, `reference-opencode`, `verification-claude`. Codex uses
`playbook-codex`, `reference-codex`, and `verification-codex`. Until an
`align-*` change moves a page, the existing path stays and the ID does not
change with it.

## Metadata

Every enforced page starts with this table. `Doc`, `Kind`, `Agent`, `Covers`,
and `Verified` are required. `Kind` is one of `router`, `playbook`,
`verification`, or `reference`. Wrap every value in backticks; the checker
reads `Kind` only from the backticked form, so a table that merely discusses
kinds does not opt a page in.

```markdown
| Field | Value |
|---|---|
| Doc | `playbook-maki` |
| Kind | `playbook` |
| Agent | `Maki` |
| Covers | `P3-P8` |
| Preconditions | `docs/ai/host-playbook.md` `P0-P2` |
| Handoff | `docs/ai/verification/maki.md` |
| Verification | `docs/ai/verification/maki.md` |
| Reference | `docs/helper.md` |
| Verified | OpenShell v0.1.5, Maki v0.6.5, 2026-10-25 |
```

Kind-specific rows:

| Kind | Extra rows |
|---|---|
| `router` | none |
| `playbook` | `Preconditions`, `Handoff`, `Verification`, `Reference` |
| `verification` | `Reference` |
| `reference` | none |

A value is a path or an ID, not a Markdown link, so moving a file does not
change the table shape. `Agent` is the agent name, or `shared` for a page that
serves all agents. `Verified` records the versions and dates of the real runs
the page covers; a page may list more than one run, separated by semicolons. A
page that has not been run says `not yet verified` and explains the gap in
`Scope`.

## Required sections

The checker dispatches on `Kind`. A file with no metadata `Kind` is skipped,
so only pages that opt in are enforced. A page is never forced into another
kind's template.

| Kind | Required top-level sections | Required blocks |
|---|---|---|
| `router` | `Scope`, `Copy this prompt`, `Phase map`, `Stop if`, `Invariants`, `See also` | none |
| `playbook` | `Scope`, `Inputs`, `Handoff`, `Invariants`, `See also` | every `## Phase` block needs `### Run`, `### Verify`, and `### Stop if` |
| `verification` | `Scope`, `Invariants`, `See also` | every `## Check` block needs `### Run`, `### Verify`, and `### Stop if` |
| `reference` | `Scope`, `See also` | none |

Every `### Verify` block contains a line starting with `Expected:` and states
the result that lets the reader continue. Every `### Stop if` block names the
mismatch that ends the run and what to report instead of working around it.
Fenced code blocks are ignored when headings are checked, so a template or an
example cannot satisfy the requirement for a real section.

## Templates

`Covers: P3-P8` is the playbook default because the shared host playbook owns
`P0-P2`. A playbook with a host-only preflight (for example the Codex login or
the optional host Maki check) MAY declare `P0-P8` and SHALL explain the extra
host phase in its metadata note or `Scope`.

### Router

```markdown
| Field | Value |
|---|---|
| Doc | `router-onboarding` |
| Kind | `router` |
| Agent | `shared` |
| Covers | `P0-P8` |
| Verified | OpenShell v0.1.5, Maki v0.6.5, 2026-10-25 |

# Onboarding

## Scope

Who this page is for and which agents it routes.

## Copy this prompt

A copy-paste prompt that names the project, names the host agent, and forbids
switching agents.

## Phase map

The canonical `P0`-`P8` table with one column per agent, or an explicit shared
marker for phases that apply to all four.

## Stop if

The conditions that end an onboarding run, and the report to leave behind.

## Invariants

The security invariants, restated without relaxation.

## See also

The agent playbooks, references, and verification pages.
```

### Playbook

```markdown
| Field | Value |
|---|---|
| Doc | `playbook-maki` |
| Kind | `playbook` |
| Agent | `Maki` |
| Covers | `P3-P8` |
| Preconditions | `docs/ai/host-playbook.md` `P0-P2` |
| Handoff | `docs/ai/verification/maki.md` |
| Verification | `docs/ai/verification/maki.md` |
| Reference | `docs/helper.md` |
| Verified | OpenShell v0.1.5, Maki v0.6.5, 2026-10-25 |

# Playbook: Maki

## Scope

What this path covers, what it does not, and where the shared host steps end.

## Inputs

What the user must supply, and what the agent may discover itself.

## Phase 1 — Name

### Run

The commands, decisions, and expected side effects.

### Verify

Expected: the exact result that allows the next phase.

### Stop if

The mismatch that ends the run, and the command output to report.

## Handoff

Where the next phase of work continues.

## Invariants

The security invariants, restated without relaxation.

## See also

The host playbook, references, verification page, and helper reference.
```

### Verification

```markdown
| Field | Value |
|---|---|
| Doc | `verification-maki` |
| Kind | `verification` |
| Agent | `Maki` |
| Covers | `P6` |
| Reference | `docs/ai/playbooks/maki.md` |
| Verified | OpenShell v0.1.5, Maki v0.6.4, 2026-10-22; sync matrix, 2026-10-26 |

# Verification: Maki

## Scope

Which sandbox and agent version these checks apply to.

## Check 1 — Name

### Run

The command that observes the boundary.

### Verify

Expected: the output that proves the check passed.

### Stop if

The output that proves isolation is broken, and what to report.

## Invariants

The security invariants, restated without relaxation.

## See also

The agent playbook, reference, and shared verification notes.
```

### Reference

```markdown
| Field | Value |
|---|---|
| Doc | `reference-maki` |
| Kind | `reference` |
| Agent | `Maki` |
| Covers | `P4, P5` |
| Verified | OpenShell v0.1.5, Maki v0.6.5, 2026-10-25 |

# Reference: Maki

## Scope

Which agent and configuration surface this page describes.

## Config paths

The agent's store, settings, and project-local configuration paths.

## Profiles

The provider profiles and credential discovery this agent uses.

## MCP

The MCP servers, transports, and runtime dependencies this agent expects.

## Store shape

What a portable environment store looks like for this agent.

## Differences

Where this agent intentionally differs from the other front-ends.

## See also

The agent playbook, verification page, and shared references.
```
