# Spec Delta

## MODIFIED Requirements

### Requirement: Self-contained subproject with recorded verification

All Claude sandbox deliverables SHALL live under `claude-oss/`, except:

- the `bin/claude-oss` helper front-end
- the `cc` tag in `bin/osa`
- the shared helper core in `lib/`
- `docs/ai/playbooks/claude.md` and `docs/ai/reference/claude.md`
- the removed source `docs/claude-oss.md` (moved to the reference)
- the shared pages that point at them: `docs/ai/onboarding.md`,
  `docs/ai/host-playbook.md`, and `docs/ai/references.md`
- the Claude Code rules in `AGENTS.md`
- the `Makefile` lint and test entries and the Claude cases and stub in
  `tests/`
- one pointer from the root `README.md`

Claude work MUST NOT modify `bridge/`, `oskhs/`, `dashboard/`, `examples/`, or
`opencode-oss/`, or change the observable behavior of `bin/maki-oss` or
`bin/opencode-oss`. `claude-oss/README.md` SHALL record the verification
commands and their observed results for the pinned version.

#### Scenario: No cross-subproject edits

- **WHEN** `git diff --stat` for a Claude change is inspected
- **THEN** every changed path is under `claude-oss/`, `lib/`, `tests/`,
  `openspec/specs/`, or that change's `openspec/changes/` directory, or is
  `bin/claude-oss`, `bin/osa`, `docs/claude-oss.md` (the removed source),
  `docs/ai/playbooks/claude.md`, `docs/ai/reference/claude.md`,
  `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`, `docs/ai/references.md`,
  `Makefile`, or the root `README.md`
- **AND** no changed path is under `bridge/`, `oskhs/`, `dashboard/`,
  `examples/`, or `opencode-oss/`

#### Scenario: Other front-ends unchanged

- **WHEN** `make test` runs after the change
- **THEN** the existing `maki-oss` and `opencode-oss` cases pass unchanged

#### Scenario: Verification record exists

- **WHEN** `claude-oss/README.md` is read
- **THEN** it records the commands and observed output for the image, both
  credential kinds, headless, continued, interactive, and file-transfer checks
  at the pinned version
