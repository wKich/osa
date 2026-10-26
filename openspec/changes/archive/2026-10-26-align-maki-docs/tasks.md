# Tasks

## 1. Preconditions

- [x] 1.1 Confirm `add-doc-contract` and `add-agent-onboarding` have landed: `test -f docs/ai/document-contract.md`, `test -f docs/ai/onboarding.md`, `test -f scripts/check-playbooks.sh`, and `make lint-docs` exits 0. Stop if any is missing.
- [x] 1.2 Confirm the Maki playbook is still at the old path and the new paths do not exist yet: `test -f docs/ai/agent-playbook.md`, `test ! -e docs/ai/playbooks/maki.md`, `test ! -e docs/ai/reference/maki.md`.

## 2. Move the Maki playbook

- [x] 2.1 Create `docs/ai/playbooks/` and move the file with `git mv docs/ai/agent-playbook.md docs/ai/playbooks/maki.md`. Verify `test -f docs/ai/playbooks/maki.md` and `test ! -e docs/ai/agent-playbook.md`.
- [x] 2.2 Update the page title and metadata for the new path: `# Playbook: Maki`, `Doc: playbook-maki`, `Kind: playbook`, `Agent: Maki`, `Covers: P0, P3-P8`, `Preconditions: docs/ai/host-playbook.md P0-P2`, `Handoff: docs/verification.md`, `Verification: docs/verification.md`, `Reference: docs/ai/reference/maki.md`, and the existing `Verified` values. Verify `scripts/check-playbooks.sh` exits 0 and `grep -q 'P0, P3-P8' docs/ai/playbooks/maki.md` succeeds.
- [x] 2.3 Rewrite the relative links for the new directory: `../host-playbook.md`, `../../verification.md`, `../../helper.md`, `../../providers.md`, and any other `../` targets. Verify `scripts/check-links.sh docs/ai/playbooks/maki.md` reports no failures and `grep -n 'agent-playbook' docs/ai/playbooks/maki.md` returns nothing.

## 3. Add the Maki reference

- [x] 3.1 Add `docs/ai/reference/maki.md` with metadata (`Doc: reference-maki`, `Kind: reference`, `Agent: Maki`, `Covers: P0, P3-P8`, `Verified: not yet verified`) and the `Scope`, `Config paths`, `Profiles`, `MCP`, `Store`, `Differences`, and `See also` sections. Keep it a link index: point at `docs/helper.md`, `docs/providers.md`, `docs/mcp-migration.md`, and `docs/ai/environment-playbook.md` instead of copying their content. Verify `scripts/check-playbooks.sh` exits 0 and the file contains each section with `grep`.
- [x] 3.2 Verify every link in the new reference resolves with `scripts/check-links.sh docs/ai/reference/maki.md`, and confirm it contains no credential value or placeholder spelling with `grep -E 'sk-|Bearer [A-Za-z0-9]|openshell:resolve:env:' docs/ai/reference/maki.md` returning no matches.

## 4. Update current references

- [x] 4.1 Update `docs/ai/onboarding.md`: replace every `agent-playbook.md` link with `playbooks/maki.md` in the phase map and `See also`, and update the `See also` description to `P0, P3-P8`. Verify `grep -q 'playbooks/maki.md' docs/ai/onboarding.md` and `grep -n 'agent-playbook.md' docs/ai/onboarding.md` returns nothing.
- [x] 4.2 Update `docs/ai/host-playbook.md`: the metadata `Handoff`, the Scope paragraph, the `## Handoff` section, and `## See also` must point at `docs/ai/playbooks/maki.md` (relative `playbooks/maki.md` where appropriate). Verify `grep -n 'agent-playbook.md' docs/ai/host-playbook.md` returns nothing and `scripts/check-links.sh docs/ai/host-playbook.md` passes.
- [x] 4.3 Update `docs/ai/references.md`, `AGENTS.md`, and `docs/setup-guide.md` to the new playbook path. Verify `grep -rn 'agent-playbook.md' docs AGENTS.md README.md` returns no current-doc hits; if an archived change under `openspec/changes/archive/` matches, leave it untouched.
- [x] 4.4 Run `scripts/check-links.sh` over the whole `docs/` tree and confirm 0 failures.

## 5. Spec and verification gates

- [x] 5.1 Confirm the `host-setup` delta names `docs/ai/playbooks/maki.md` and no `docs/ai/agent-playbook.md` remains in the delta: `grep -q 'playbooks/maki.md' openspec/changes/align-maki-docs/specs/host-setup/spec.md` and `! grep -q 'agent-playbook.md' openspec/changes/align-maki-docs/specs/host-setup/spec.md`.
- [x] 5.2 Run `openspec validate align-maki-docs --strict` and confirm it exits 0.
- [x] 5.3 Run `make lint-docs`, `scripts/check-links.sh`, and `make test`; all must exit 0. `make test` includes the onboarding asset checks and the placeholder-spelling check.
- [x] 5.4 Run `make lint`; it must exit 0.

## 6. Scope check

- [x] 6.1 Confirm the diff is limited to the moved `docs/ai/playbooks/maki.md`, the new `docs/ai/reference/maki.md`, `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`, `docs/ai/references.md`, `AGENTS.md`, `docs/setup-guide.md`, and this change's directory with `git diff --stat`. There must be no `docs/verification.md` move, no host-playbook content trim, no OpenCode/Claude doc move, and no helper/code change.
- [x] 6.2 Confirm no credential value or placeholder spelling was added: `test_no_placeholder_spelling` passes, and `git diff` contains no real key shape (`sk-`, a bearer token, or a literal `api_key = "..."` value).
- [x] 6.3 Record the follow-ups in the final summary: `align-maki-verification` moves and restructures `docs/verification.md`; `align-host-playbook` trims the Maki-specific image/provider/daily-driver content. Neither is in this diff.
