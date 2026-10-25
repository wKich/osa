# Spec Delta

## MODIFIED Requirements

### Requirement: Self-contained subproject with recorded verification

All OpenCode sandbox deliverables SHALL live under `opencode-oss/`, except:

- the `bin/opencode-oss` helper front-end
- the shared helper core in `lib/`
- `docs/opencode-oss.md`
- the `Makefile` lint and test entries for the helper
- one pointer from the root `README.md`

OpenCode work MUST NOT modify `bridge/`, `oskhs/`, `dashboard/`,
`examples/`, or the observable behavior of `bin/maki-oss`.
`opencode-oss/README.md` SHALL record the verification commands and their
observed results for the pinned version.

#### Scenario: No cross-subproject edits
- **WHEN** `git diff --stat` for an OpenCode change is inspected
- **THEN** every changed path is under `opencode-oss/`, `lib/`, `tests/`, or that change's `openspec/changes/` directory, or is `bin/opencode-oss`, `docs/opencode-oss.md`, `Makefile`, or the root `README.md`

#### Scenario: maki-oss behavior unchanged
- **WHEN** an OpenCode change is applied and `make test` runs
- **THEN** every existing `maki-oss` test passes without edits

#### Scenario: Verification record exists
- **WHEN** a reader opens `opencode-oss/README.md`
- **THEN** it lists each acceptance check with the command run, the date, the OpenCode and OpenShell versions, and the observed result
