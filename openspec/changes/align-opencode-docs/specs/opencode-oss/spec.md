# Spec Delta

## MODIFIED Requirements

### Requirement: Self-contained subproject with recorded verification

All OpenCode sandbox deliverables SHALL live under `opencode-oss/`, except:

- the `bin/opencode-oss` helper front-end
- the shared helper core in `lib/`
- `docs/ai/playbooks/opencode.md` and `docs/ai/reference/opencode.md`
- the removed source `docs/opencode-oss.md` (moved to the reference)
- the shared pages that point at them: `docs/ai/onboarding.md`,
  `docs/ai/host-playbook.md`, and `docs/helper.md`
- the `Makefile` lint and test entries for the helper
- one pointer from the root `README.md`
- edits to `bin/maki-oss` that move shared logic into the core without
  changing its observable behavior

OpenCode work MUST NOT modify `bridge/`, `oskhs/`, `dashboard/`,
`examples/`, or the observable behavior of `bin/maki-oss`.
`opencode-oss/README.md` SHALL record the verification commands and their
observed results for the pinned version.

#### Scenario: No cross-subproject edits

- **WHEN** `git diff --stat` for an OpenCode change is inspected
- **THEN** every changed path is under `opencode-oss/`, `lib/`, `tests/`,
  `openspec/specs/`, or that change's `openspec/changes/` directory, or is
  `bin/opencode-oss`, `docs/opencode-oss.md` (the removed source),
  `docs/ai/playbooks/opencode.md`, `docs/ai/reference/opencode.md`,
  `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`, `docs/helper.md`,
  `Makefile`, the root `README.md`, or `bin/maki-oss`
- **AND** a `bin/maki-oss` edit only moves shared logic into `lib/`, so every
  existing `maki-oss` test passes without edits

#### Scenario: maki-oss behavior unchanged

- **WHEN** an OpenCode change is applied and `make test` runs
- **THEN** every existing `maki-oss` test passes without edits

#### Scenario: Verification record exists

- **WHEN** a reader opens `opencode-oss/README.md`
- **THEN** it lists each acceptance check with the command run, the date, the
  OpenCode and OpenShell versions, and the observed result
