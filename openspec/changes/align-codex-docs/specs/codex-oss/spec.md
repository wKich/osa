# Spec Delta

## MODIFIED Requirements

### Requirement: Self-contained subproject with recorded verification

All Codex sandbox deliverables SHALL live under `codex-oss/`, except:

- the `bin/codex-oss` helper front-end
- the `cx` tag in `bin/osa`
- the shared helper core in `lib/`
- `docs/ai/playbooks/codex.md`, `docs/ai/reference/codex.md`, and
  `docs/ai/verification/codex.md`
- the removed source `docs/codex-oss.md` (moved to the reference)
- the shared pages that point at them: `docs/ai/onboarding.md`,
  `docs/ai/host-playbook.md`, `docs/ai/references.md`, and
  `docs/ai/document-contract.md`
- the four-agent navigation lines in `docs/ai/playbooks/maki.md`,
  `docs/ai/playbooks/opencode.md`, `docs/ai/playbooks/claude.md`,
  `docs/ai/reference/opencode.md`, and `docs/ai/reference/claude.md`
- the Codex rules in `AGENTS.md`
- the `Makefile` lint and test entries and the Codex cases and stubs in
  `tests/`
- one pointer from the root `README.md`

Codex work MUST NOT modify `bridge/`, `oskhs/`, `dashboard/`, `examples/`,
`opencode-oss/`, or `claude-oss/`, or change the observable behavior of
`bin/maki-oss`, `bin/opencode-oss`, or `bin/claude-oss`.
`docs/ai/verification/codex.md` SHALL be the canonical verification record: it
SHALL carry the pinned Codex and OpenShell versions, the run date, each
acceptance check's command, and its observed result. `codex-oss/README.md`
SHALL summarize the pinned versions and date and link to that page rather than
duplicate the full record.

#### Scenario: No cross-subproject edits

- **WHEN** `git diff --stat` for a Codex change is inspected
- **THEN** every changed path is under `codex-oss/`, `lib/`, `tests/`,
  `openspec/specs/`, or that change's `openspec/changes/` directory, or is
  `bin/codex-oss`, `bin/osa`, `docs/codex-oss.md` (the removed source),
  `docs/ai/playbooks/codex.md`, `docs/ai/reference/codex.md`,
  `docs/ai/verification/codex.md`, `docs/ai/onboarding.md`,
  `docs/ai/host-playbook.md`, `docs/ai/references.md`,
  `docs/ai/document-contract.md`, `docs/ai/playbooks/maki.md`,
  `docs/ai/playbooks/opencode.md`, `docs/ai/playbooks/claude.md`,
  `docs/ai/reference/opencode.md`, `docs/ai/reference/claude.md`,
  `Makefile`, or the root `README.md`
- **AND** no changed path is under `bridge/`, `oskhs/`, `dashboard/`,
  `examples/`, `opencode-oss/`, or `claude-oss/`

#### Scenario: Other front-ends unchanged

- **WHEN** `make test` runs after the change
- **THEN** the existing `maki-oss`, `opencode-oss`, and `claude-oss` cases
  pass unchanged

#### Scenario: Verification record exists

- **WHEN** `docs/ai/verification/codex.md` is read
- **THEN** it records the commands and observed output for the image, provider
  setup, refresh interval, egress, headless, continued, interactive, and
  file-transfer checks at the pinned version

#### Scenario: README points at the verification record

- **WHEN** `codex-oss/README.md` is read
- **THEN** it summarizes the pinned versions and date and links to
  `docs/ai/verification/codex.md` instead of repeating the full table
