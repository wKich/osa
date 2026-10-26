# Tasks

## 1. Preconditions

- [x] 1.1 Confirm `add-claude-oss` has landed and `docs/claude-oss.md`, `claude-oss/README.md`, and `openspec/specs/claude-oss/spec.md` exist. Verify with `test -f` for each path and `openspec list --json` showing `add-claude-oss` is no longer active. Stop if the Claude docs are not on the branch.
- [x] 1.2 Confirm `add-doc-contract` has landed and `docs/ai/document-contract.md` and `scripts/check-playbooks.sh` exist. Verify with `test -f` for both and `make lint-docs` exiting 0. Stop if the contract is missing.

## 2. Onboarding guide

- [x] 2.1 Write `docs/ai/onboarding.md` with the metadata header, the one rule, the copy-paste prompt, the task index, inputs, the canonical phase map, the migration matrix, the add-binary section, stop conditions, the report format, and the invariants. Verify `grep -q '^| Kind | \`router\`' docs/ai/onboarding.md`, `grep -q 'same coding agent' docs/ai/onboarding.md`, `grep -q '^## Copy this prompt' docs/ai/onboarding.md`, and `scripts/check-playbooks.sh` exits 0 for the router kind.
- [x] 2.2 Fill the same-agent matrix for credentials, MCP, settings, skills, commands, plugins, and project-local configuration, with a Maki, OpenCode, and Claude column. Verify each item and each agent appears with `grep` (for example `grep -q 'OpenCode'`, `grep -q 'Claude'`, and one row per item), and `scripts/check-links.sh docs/ai/onboarding.md` reports no failures.
- [x] 2.3 Add the `P0`-`P8` phase map with a Maki, OpenCode, and Claude column, or an explicit shared marker for phases that apply to all three. Verify every phase ID `P0` through `P8` appears and each agent column is present with `grep`.
- [x] 2.4 Add the stop conditions table and the report format. Verify the table names a disconnected gateway, a version mismatch, no key or OAuth-only, a loopback endpoint, an unsupported item, a missing stdio runtime, a policy denial, a parked workspace, and a sandbox not `Ready`; verify the report block names host, image, provider, sandbox, migrated, unsupported, verification, and next.

## 3. Discoverability and framing

- [x] 3.1 Update `AGENTS.md` to neutral framing ("your coding agent: Maki, OpenCode, Claude Code") and make `docs/ai/onboarding.md` the first Start here entry. Verify with `grep -q 'docs/ai/onboarding.md' AGENTS.md` and `grep -q 'claude-oss' AGENTS.md`.
- [x] 3.2 Update `README.md` to neutral framing and add the onboarding guide first in the Guides list, with the existing Maki, OpenCode, and Claude pointers preserved. Verify with `grep -q 'docs/ai/onboarding.md' README.md`, `grep -q 'opencode-oss' README.md`, and `grep -q 'claude-oss' README.md`.
- [x] 3.3 Add a one-line path note to `docs/ai/host-playbook.md` and `docs/ai/agent-playbook.md` ("Maki path; return to onboarding for OpenCode or Claude"), and to `docs/opencode-oss.md` and `docs/claude-oss.md` ("OpenCode path" / "Claude path; return to onboarding"). Verify each file contains the note and `scripts/check-links.sh` still passes.

## 4. Tests and documentation checks

- [x] 4.1 Add an asset test to `tests/run-tests.sh` that asserts `docs/ai/onboarding.md` exists, contains the same-agent rule, contains the prompt, names Maki, OpenCode, and Claude, and has a matrix row for credentials, MCP, settings, skills, commands, plugins, and project configuration. Verify the new case runs under `make test` and passes.
- [x] 4.2 Add assertions that `AGENTS.md` and `README.md` link `docs/ai/onboarding.md`. Verify the same `make test` case fails when either link is removed (run it against a temporary copy, then restore), and passes again.
- [x] 4.3 Run `scripts/check-links.sh`, `make lint-docs`, and `make test`; all must exit 0. Also run the existing `test_no_placeholder_spelling` case and confirm it still passes.
- [x] 4.4 Run `openspec validate add-agent-onboarding --strict`; it must exit 0.

## 5. Scope check

- [x] 5.1 Confirm the diff is limited to `docs/ai/onboarding.md`, `AGENTS.md`, `README.md`, the four path-note files, `tests/run-tests.sh`, and this change's directory with `git diff --stat`. There must be no file moves, no per-agent playbooks, no reference/verification moves, and no changes to `docs/mcp-migration.md`, `docs/migrating-providers.md`, `docs/dogfood-migration.md`, or `docs/ai/environment-playbook.md`.
- [x] 5.2 Confirm no credential value, placeholder spelling, host path, or sandbox behavior was introduced: run `test_no_placeholder_spelling`, inspect the diff for `sk-`/`Bearer`/`api_key`, and confirm the change adds no `openshell sandbox` command that bypasses the helper.
