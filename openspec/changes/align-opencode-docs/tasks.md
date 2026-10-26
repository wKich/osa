# Tasks

## 1. Preconditions

- [x] 1.1 Confirm the worktree is on branch `docs/align-agent-pages`, clean, and at commit `80c5fc0`: `git branch --show-current`, `git rev-parse --short HEAD`, `git status --short`.
- [x] 1.2 Confirm the target pages and source material exist: `test -f docs/opencode-oss.md`, `test -f docs/ai/playbooks/maki.md`, `test -f docs/ai/reference/maki.md`, `test -f opencode-oss/README.md`, `test -f docs/ai/onboarding.md`, and `test -f docs/ai/document-contract.md`.
- [x] 1.3 Record the old-path reference set before editing: `grep -rn 'docs/opencode-oss.md' docs AGENTS.md README.md opencode-oss bin tests openspec/specs` and `grep -rn 'opencode-oss.md#' docs opencode-oss` both show the paths this change updates.

## 2. Create the OpenCode playbook

- [x] 2.1 Create `docs/ai/playbooks/opencode.md` with the contract metadata from the brief: `Doc: playbook-opencode`, `Kind: playbook`, `Agent: OpenCode`, `Covers: P3-P8`, `Preconditions: docs/ai/host-playbook.md P0-P2`, `Handoff: opencode-oss/README.md#verification-record`, `Verification: opencode-oss/README.md#verification-record`, `Reference: docs/ai/reference/opencode.md`, `Verified: OpenShell v0.1.5, OpenCode v2.1.4, 2026-10-25`. Verify `scripts/check-playbooks.sh docs/ai` exits 0 and `grep -q '| Doc | `playbook-opencode` |' docs/ai/playbooks/opencode.md`.
- [x] 2.2 Add `## Scope`, `## Inputs`, `## Handoff`, `## Invariants`, and `## See also`, plus seven `## Phase` blocks (image build, provider profile, policy, sandbox create, isolation checks, run OpenCode, collect/cleanup), each with `### Run`, `### Verify` containing `Expected:`, and `### Stop if`. Verify `scripts/check-playbooks.sh docs/ai` exits 0 and `grep -c '^## Phase' docs/ai/playbooks/opencode.md` prints `7`.
- [x] 2.3 Keep the OpenCode-specific behavior in the phases: `--standalone` everywhere, `</dev/null` for headless runs, `--auto` for `run`, TUI model selection through `/models` or the project `opencode.json`, `OPENCODE_DISABLE_MODELS_FETCH=1`, no in-sandbox authentication, and profiles binding `/usr/local/bin/opencode`. Verify with `grep -q -- '--standalone'`, `grep -q '</dev/null'`, `grep -q -- '--auto'`, `grep -q '/models'`, `grep -q 'OPENCODE_DISABLE_MODELS_FETCH=1'`, `grep -q 'opencode auth login'`, and `grep -q '/usr/local/bin/opencode'` on the playbook.
- [x] 2.4 Make the playbook helper-first with raw-command fallbacks, and link shared explanations instead of copying them: `docs/helper.md`, `docs/providers.md`, `docs/mcp-migration.md`, `docs/ai/environment-playbook.md`, and the reference. Verify `grep -q 'opencode-oss image build'`, `grep -q 'docker build -t opencode-agent:local'`, `grep -q 'docs/helper.md'`, and `grep -q 'docs/providers.md'` on the playbook.

## 3. Move the flat page to the reference and update current links

- [x] 3.1 Move `docs/opencode-oss.md` to `docs/ai/reference/opencode.md` with `git mv`, so there is no redirect stub and the old path is gone. Verify `test ! -e docs/opencode-oss.md` and `test -f docs/ai/reference/opencode.md`.
- [x] 3.2 Add the reference metadata (`Doc: reference-opencode`, `Kind: reference`, `Agent: OpenCode`, `Covers: P3-P8`, `Verified: not yet verified`) and the required `## Scope` / `## See also`, with the OpenCode path note linking back to onboarding. Verify `scripts/check-playbooks.sh docs/ai` exits 0.
- [x] 3.3 Reshape the reference to OpenCode-specific sections: `Config paths`, `Profiles`, `Sessions/model selection`, `MCP`, `Store`, and `Differences`, keeping the existing agent-specific detail (config differences table, model overlay, session flags, MCP gate vocabulary, store shape, image pin, not-supported list) and linking shared pages instead of copying them. Verify `grep -q '^## Config paths'`, `grep -q '^## Profiles'`, `grep -q '^## Sessions'`, `grep -q '^## MCP'`, `grep -q '^## Store'`, and `grep -q '^## Differences'` on the reference.
- [x] 3.4 Update `docs/helper.md`'s OpenCode pointer to `docs/ai/reference/opencode.md`; update `opencode-oss/README.md`'s command-reference link to the reference and the ordered path to the playbook, and its `#personal-environment` link to the reference's store section. Verify `! grep -rn 'docs/opencode-oss.md' docs/helper.md opencode-oss/README.md` and `scripts/check-links.sh` exits 0.
- [x] 3.5 Update `docs/ai/host-playbook.md`'s `See also` OpenCode links to the new playbook and reference. Verify `! grep -q 'docs/opencode-oss.md' docs/ai/host-playbook.md` and `scripts/check-links.sh` exits 0.

## 4. Update the onboarding router

- [x] 4.1 Update the OpenCode P0-P8 cells in `docs/ai/onboarding.md` to link the new playbook (and the reference where it carries the detail), with P6 pointing at `opencode-oss/README.md#verification-record`. Verify `! grep -q 'docs/opencode-oss.md\|\.\./opencode-oss.md' docs/ai/onboarding.md` and every `playbooks/opencode.md` and `reference/opencode.md` target exists.
- [x] 4.2 Update the local numbering table so OpenCode is no longer described as an unnumbered reference, and update `See also` to name the OpenCode playbook and reference separately. Verify `grep -q 'OpenCode agent playbook' docs/ai/onboarding.md` and `! grep -q 'OpenCode and Claude pages are' docs/ai/onboarding.md`.
- [x] 4.3 Manually verify every OpenCode anchor in the onboarding links because `scripts/check-links.sh` strips fragments: compare each `#…` against the headings in `docs/ai/playbooks/opencode.md` and `docs/ai/reference/opencode.md`. Report the anchor list in the task report.

## 5. Update the helper, README, and tests

- [x] 5.1 Update only the documentation strings in `bin/opencode-oss`: the header comment, the help footer, `OSS_CONFIG_EXAMPLE`, and `OSS_MCP_FIX_DOC`, pointing at `docs/ai/reference/opencode.md`. Verify `! grep -n 'docs/opencode-oss.md' bin/opencode-oss` and `git diff -- bin/opencode-oss` shows no logic change.
- [x] 5.2 Update the one expected message in `tests/run-tests.sh` that quotes `OSS_MCP_FIX_DOC` to `docs/ai/reference/opencode.md`. Verify `! grep -n 'docs/opencode-oss.md' tests/run-tests.sh` and run `tests/run-tests.sh` (or the focused OpenCode MCP test) so the assertion is exercised.
- [x] 5.3 Confirm no other current reference remains: `grep -rn 'docs/opencode-oss.md\|opencode-oss\.md' docs AGENTS.md README.md opencode-oss bin tests openspec/specs` returns nothing outside an explicitly historical record. Verify by inspection and record the result.

## 6. Specs and sync

- [x] 6.1 Confirm the `opencode-oss` delta modifies the self-contained requirement, names the two new docs paths, keeps the README verification-record requirement, and updates the no-cross-subproject scenario. Verify `grep -q 'Self-contained subproject with recorded verification' openspec/changes/align-opencode-docs/specs/opencode-oss/spec.md` and `grep -q 'docs/ai/playbooks/opencode.md' openspec/changes/align-opencode-docs/specs/opencode-oss/spec.md`.
- [x] 6.2 Confirm the `agent-onboarding` delta names `docs/ai/playbooks/opencode.md` and `docs/ai/reference/opencode.md` in the "Agent page names its path" scenario and changes no other requirement. Verify `grep -q 'docs/ai/reference/opencode.md' openspec/changes/align-opencode-docs/specs/agent-onboarding/spec.md`.
- [x] 6.3 Confirm the `host-setup` delta replaces `docs/opencode-oss.md` with the OpenCode playbook and reference in the per-agent requirement and keeps its scenarios truthful. Verify `! grep -q 'docs/opencode-oss.md' openspec/changes/align-opencode-docs/specs/host-setup/spec.md`.
- [x] 6.4 Sync all three deltas to `openspec/specs/opencode-oss/spec.md`, `openspec/specs/agent-onboarding/spec.md`, and `openspec/specs/host-setup/spec.md`. Verify `! grep -rn 'docs/opencode-oss.md' openspec/specs` and `openspec validate align-opencode-docs --strict` exits 0.

## 7. Gates, review, and commit

- [x] 7.1 Run `scripts/check-playbooks.sh docs/ai` and confirm `check-playbooks: ok`.
- [x] 7.2 Run `openspec validate align-opencode-docs --strict` and confirm it exits 0.
- [x] 7.3 Run `make lint-docs`, `scripts/check-links.sh`, `make test`, and `make lint`; confirm all exit 0.
- [x] 7.4 Self-review for completeness, truthfulness, security invariants, and scope: no host bind mounts, no secrets via `--env`/`--env-from`, credentials only through provider profiles, deny-by-default egress, uid/gid 1500, no in-sandbox OpenCode auth, no host agent config or credential store mount, and no placeholder spelling. Verify `git diff --stat` is limited to the files named in this change.
- [x] 7.5 Commit only the named files with a docs message, for example `docs: align the OpenCode pages with the document contract`, and record the commit SHA in the task report.
