# Proposal

## Why

The repository now has three agent front-ends (`maki-oss`, `opencode-oss`,
`claude-oss`), but its agent docs have no shared shape: the Maki playbooks are
phase-gated sequences, the OpenCode and Claude pages are references, and the
same concepts are named differently. Planning a symmetric docs structure
without a contract would turn every move into a content rewrite. The contract
must land first so later changes only move and fill pages, not invent their
structure.

## What Changes

- Add `docs/ai/document-contract.md`, defining:
  - the canonical phases `P0`-`P8` and their gates;
  - the naming rule for shared documents (`onboarding`, `host-playbook`,
    `environment-playbook`) versus agent documents (`playbooks/<agent>.md`,
    `reference/<agent>.md`, `verification/<agent>.md`);
  - the page header metadata table (`Doc`, `Agent`, `Covers`,
    `Preconditions`, `Handoff`, `Verification`, `Reference`, `Verified`);
  - the playbook template: `Scope`, `Inputs`, `Phase N` sections with `Run`,
    `Verify`, and `Stop if`, then `Handoff`, `Invariants`, `See also`;
  - the verification template: checks with a command, an `Expected:` result,
    and stop conditions;
  - the lighter reference template: scope, config paths, profiles, MCP,
    store shape, differences, and links.
- Add `scripts/check-playbooks.sh`, which validates every page carrying
  `Doc:` metadata against its template and exits non-zero with the file and
  the missing section.
- Add a `make lint-docs` target that runs the checker; include it in `make
  lint` only if the existing docs already pass.
- Retrofit the metadata header and section headings into
  `docs/ai/host-playbook.md` and `docs/ai/agent-playbook.md` so the checker
  has real targets. Do not move or rename either file here.
- **Does not change** any helper, image, policy, provider, or sandbox
  behavior. This is documentation and development tooling only.

## Capabilities

### New Capabilities

_None._ This change introduces a documentation contract and a linter. It
changes no observable runtime behavior, so it deliberately opts out of spec
deltas with `skip_specs: true`.

### Modified Capabilities

_None._

## Impact

- **New files:** `docs/ai/document-contract.md`,
  `scripts/check-playbooks.sh`.
- **Edited files:** `docs/ai/host-playbook.md`,
  `docs/ai/agent-playbook.md`, `Makefile` (one target).
- **No code, image, policy, provider, or sandbox changes.** The security
  boundary, credential path, and egress rules are untouched.
- **Risk:** an over-strict checker blocks legitimate pages. Mitigate with a
  small fixture and a per-kind required-section list rather than a single
  universal template.
- **Follow-up:** `add-agent-onboarding` supplies the first new page that uses
  the contract; `align-maki-docs`, `align-opencode-docs`, and
  `align-claude-docs` use it when pages move.
