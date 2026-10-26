# Tasks

## 1. Preconditions

- [x] 1.1 Confirm the worktree is on branch `docs/align-agent-pages`, clean, and at commit `9f6aa0e`: `git branch --show-current`, `git rev-parse --short HEAD`, `git status --short`.
- [x] 1.2 Confirm the target pages and source material exist: `test -f docs/claude-oss.md`, `test -f claude-oss/README.md`, `test -f docs/ai/onboarding.md`, `test -f docs/ai/host-playbook.md`, `test -f docs/ai/reference/opencode.md`, and `test -f openspec/specs/claude-oss/spec.md`.
- [x] 1.3 Record the old-path reference set before editing: `grep -rn 'docs/claude-oss.md\|claude-oss\.md' docs AGENTS.md README.md claude-oss bin tests openspec/specs` shows the paths this change updates.

## 2. Create the Claude playbook

- [x] 2.1 Create `docs/ai/playbooks/claude.md` with the contract metadata: `Doc: playbook-claude`, `Kind: playbook`, `Agent: Claude`, `Covers: P3-P8`, `Preconditions: docs/ai/host-playbook.md P0-P2`, `Handoff: claude-oss/README.md#verification-record`, `Verification: claude-oss/README.md#verification-record`, `Reference: docs/ai/reference/claude.md`, `Verified: OpenShell v0.1.5, Claude Code v2.1.308, 2026-10-26`. Verify `scripts/check-playbooks.sh docs/ai` exits 0 and `grep -q '| Doc | `playbook-claude` |' docs/ai/playbooks/claude.md`.
- [x] 2.2 Add `## Scope`, `## Inputs`, `## Handoff`, `## Invariants`, and `## See also`, plus seven `## Phase` blocks (image build, credentials/provider, policy, sandbox create, isolation checks, run Claude, collect/cleanup), each with `### Run`, `### Verify` containing `Expected:`, and `### Stop if`. Verify `scripts/check-playbooks.sh docs/ai` exits 0 and `grep -c '^## Phase' docs/ai/playbooks/claude.md` prints `7`.
- [x] 2.3 Keep the Claude-specific behavior in the phases: API key or host-created subscription token, no `/login`/`claude auth`/`claude setup-token` in the sandbox, no `ANTHROPIC_BASE_URL` or `apiKeyHelper`, default `/sandbox/.claude/` and `/sandbox/.claude.json`, the API-key approval step, `--dangerously-skip-permissions`, `-p --output-format stream-json --verbose`, `--resume`, `</dev/null`, and profiles binding `/usr/local/bin/claude`. Verify with the matching `grep -q --` checks on the playbook.
- [x] 2.4 Make the playbook helper-first with raw-command fallbacks, and link shared explanations instead of copying them: `docs/helper.md`, `docs/providers.md`, `docs/ai/environment-playbook.md`, and the reference. Verify `grep -q 'claude-oss image build'`, `grep -q 'docker build -t claude-agent:local'`, `grep -q 'docs/helper.md'`, and `grep -q 'docs/providers.md'` on the playbook.

## 3. Move the flat page to the reference and update current links

- [x] 3.1 Move `docs/claude-oss.md` to `docs/ai/reference/claude.md` with `git mv`, so there is no redirect stub and the old path is gone. Verify `test ! -e docs/claude-oss.md` and `test -f docs/ai/reference/claude.md`.
- [x] 3.2 Add the reference metadata (`Doc: reference-claude`, `Kind: reference`, `Agent: Claude`, `Covers: P3-P8`, `Verified: not yet verified`) and the required `## Scope` / `## See also`, stating that it is the Claude Code path and linking back to onboarding. Verify `scripts/check-playbooks.sh docs/ai` exits 0.
- [x] 3.3 Reshape the reference into a thin index: `Config paths`, `Credentials`, `Profiles`, `Sessions` (with model selection and session flags), `MCP`, `Store`, and `Differences`, keeping the Maki/OpenCode delta table, credential rules, profile naming, session flags, MCP status, store shape, and unique differences, and linking the playbook and shared docs instead of copying procedures. Verify the headings exist and the file stays a thin index (about 135 lines).
- [x] 3.4 Update `claude-oss/README.md`'s reference links to the new reference and ordered playbook. Verify `! grep -rn 'docs/claude-oss.md' claude-oss/README.md` and `scripts/check-links.sh docs/ai/reference/claude.md`.
- [x] 3.5 Update `docs/ai/host-playbook.md`'s `See also` Claude links to the new playbook and reference. Verify `! grep -q 'docs/claude-oss.md' docs/ai/host-playbook.md` and `scripts/check-links.sh docs/ai/host-playbook.md`.
- [x] 3.6 Add the Claude Code upstream links (docs index, authentication, setup) to `docs/ai/references.md`, update its intro and playbook bullet for all three agents, and link the pack from the reference instead of spelling external links on the page. Verify `grep -q '^## Claude Code' docs/ai/references.md`, `! grep -q 'https://' docs/ai/reference/claude.md`, and `scripts/check-links.sh docs/ai/references.md`.

## 4. Update the onboarding router

- [x] 4.1 Update the Claude P0-P8 cells in `docs/ai/onboarding.md` to link the new playbook (and the reference where it carries the detail), with P6 pointing at `claude-oss/README.md#verification-record`. Verify `! grep -q 'docs/claude-oss.md\|\.\./claude-oss.md' docs/ai/onboarding.md` and every playbook/reference target exists.
- [x] 4.2 Add a Claude column to the local numbering table and update the text that calls the Claude page unnumbered; update `See also` to name the Claude playbook and reference separately. Verify `grep -q 'Claude agent playbook' docs/ai/onboarding.md` and `! grep -q 'Claude page is still an unnumbered' docs/ai/onboarding.md`.
- [x] 4.3 Manually verify every Claude anchor in the onboarding links because `scripts/check-links.sh` strips fragments: compare each `#…` against the target headings. Report the anchor list in the task report.

## 5. Update the helper and tests

- [x] 5.1 Update only the documentation strings in `bin/claude-oss`: the header comment, the help footer, `OSS_CONFIG_EXAMPLE`, and `OSS_MCP_FIX_DOC`, pointing at `docs/ai/reference/claude.md`. Verify `! grep -n 'docs/claude-oss.md' bin/claude-oss` and `git diff -- bin/claude-oss` shows no logic change.
- [x] 5.2 Update the placeholder-spelling scan path in `tests/run-tests.sh` from `$ROOT/docs/claude-oss.md` to `$ROOT/docs/ai/reference/claude.md`. Verify the scan path exists and run the focused Claude test (or the full suite) so the assertion is exercised.
- [x] 5.3 Confirm no other current reference remains: `grep -rn 'docs/claude-oss.md\|claude-oss\.md' docs AGENTS.md README.md claude-oss bin tests openspec/specs` returns only the intentional removed-source carve-out in the spec and historical archive records. Verify by inspection and record the result.

## 6. Specs and sync

- [x] 6.1 Confirm the `claude-oss` delta modifies the self-contained requirement, names the two new docs paths, keeps the old `docs/claude-oss.md` as the removed source, keeps the README verification-record requirement, and updates the no-cross-subproject scenario. Verify the delta contains both new paths.
- [x] 6.2 Confirm the `agent-onboarding` delta names `docs/ai/playbooks/claude.md` and `docs/ai/reference/claude.md` in the "Agent page names its path" scenario and changes no other requirement.
- [x] 6.3 Confirm the `host-setup` delta replaces `docs/claude-oss.md` with the Claude playbook in the per-agent requirement, keeps the reference out of the owner list, and keeps its scenarios truthful.
- [x] 6.4 Sync all three deltas to `openspec/specs/claude-oss/spec.md`, `openspec/specs/agent-onboarding/spec.md`, and `openspec/specs/host-setup/spec.md`. Verify `openspec validate align-claude-docs --strict` exits 0 and `grep -rn 'docs/claude-oss.md' openspec/specs` matches only the removed-source carve-out in `openspec/specs/claude-oss/spec.md`.

## 7. Gates, review, and commit

- [x] 7.1 Run `scripts/check-playbooks.sh docs/ai` and confirm `check-playbooks: ok`.
- [x] 7.2 Run `openspec validate align-claude-docs --strict` and confirm it exits 0.
- [x] 7.3 Run `make lint-docs`, `scripts/check-links.sh`, `make test`, and `make lint`; confirm all exit 0.
- [x] 7.4 Self-review for completeness, truthfulness, security invariants, and scope: no host bind mounts, no secrets via `--env`/`--env-from`, credentials only through provider profiles, deny-by-default egress, uid/gid 1500, no in-sandbox Claude authentication, no `ANTHROPIC_BASE_URL`/`apiKeyHelper`, no host Claude config mount, and no placeholder spelling. Verify `git diff --stat` is limited to the files named in this change.
- [x] 7.5 Commit only the named files with a docs message, for example `docs: align the Claude pages with the document contract`, and record the commit SHA in the task report.
