# Tasks

## 1. Preconditions

- [x] 1.1 Confirm the worktree is on branch `docs/align-agent-pages`, clean, and at commit `82d5f14`: `git branch --show-current`, `git rev-parse --short HEAD`, `git status --short`.
- [x] 1.2 Confirm the source material exists: `test -f docs/verification.md`, `test -f opencode-oss/README.md`, `test -f claude-oss/README.md`, and `test -f docs/ai/document-contract.md`.
- [x] 1.3 Record the old-path reference set before editing: `grep -rn 'docs/verification.md' docs AGENTS.md README.md openspec/specs` and `grep -rn 'verification-record' docs/ai opencode-oss claude-oss` show the paths this change updates.

## 2. Create the OpenSpec change

- [x] 2.1 Create the `align-agent-verification` change with `openspec new change`, and write `proposal.md`, `design.md`, and this `tasks.md` with the three modified capabilities: `host-setup`, `opencode-oss`, and `claude-oss`.
- [x] 2.2 Write the three spec deltas: `specs/host-setup/spec.md` (versions requirement and consistency/re-verification scenarios point at `docs/ai/verification/maki.md`), `specs/opencode-oss/spec.md` and `specs/claude-oss/spec.md` (verification page in the allowlist, page canonical, README summary and link).
- [x] 2.3 Confirm `openspec validate align-agent-verification --strict` accepts the artifacts before implementation.

## 3. Create the Maki verification page

- [x] 3.1 Move `docs/verification.md` to `docs/ai/verification/maki.md` with `git mv`, so no redirect stub remains. Verify `test ! -e docs/verification.md` and `test -f docs/ai/verification/maki.md`.
- [x] 3.2 Add the metadata (`Doc: verification-maki`, `Kind: verification`, `Agent: Maki`, `Covers: P6`, `Reference: docs/ai/playbooks/maki.md`, `Verified: OpenShell v0.1.5, Maki v0.6.4, 2026-10-22; Maki v0.6.5 sync matrix, 2026-10-26`), `# Verification: Maki`, `## Scope`, `## Invariants`, and `## See also`.
- [x] 3.3 Convert sections 1-6 into one `## Check` block each with `### Run`, `### Verify` containing `Expected:`, and `### Stop if`; preserve every command, expected result, and link.
- [x] 3.4 Convert section 7 into one `## Check` with `#### 7.1`-`#### 7.8` under `### Run`, then one `### Verify` and one `### Stop if`; preserve every case command and expected result.
- [x] 3.5 Convert sections 8 and 9 into one `## Check` each with `#### 8a`-`#### 8e` and `#### 9a`-`#### 9d` under `### Run`, then one `### Verify` and one `### Stop if` per check; preserve every case command and expected result.
- [x] 3.6 Keep `## Beyond this checklist`, rewrite every relative link for the new depth, and verify `scripts/check-playbooks.sh docs/ai` exits 0.

## 4. Create the OpenCode verification page

- [x] 4.1 Create `docs/ai/verification/opencode.md` with the metadata (`Doc: verification-opencode`, `Kind: verification`, `Agent: OpenCode`, `Covers: P6`, `Reference: docs/ai/playbooks/opencode.md`, `Verified: OpenShell v0.1.5, OpenCode v2.1.4, 2026-10-25`), `## Scope` (noting the helper table was 2026-10-26), `## Invariants`, and `## See also`.
- [x] 4.2 Group the recorded rows into six `## Check` blocks (image/catalog, profiles/policy, sandbox isolation/credentials/egress, headless sessions/denies, TUI/download, helper path), each with `### Run`, `### Verify` containing `Expected:` and the observed results, and `### Stop if`.
- [x] 4.3 Preserve every command, observed result, pinned version, and date from `opencode-oss/README.md`; verify no row is dropped and `scripts/check-playbooks.sh docs/ai` exits 0.

## 5. Create the Claude verification page

- [x] 5.1 Create `docs/ai/verification/claude.md` with the metadata (`Doc: verification-claude`, `Kind: verification`, `Agent: Claude`, `Covers: P6`, `Reference: docs/ai/playbooks/claude.md`, `Verified: OpenShell v0.1.5, Claude Code v2.1.308, 2026-10-26`), `## Scope`, `## Invariants`, and `## See also`.
- [x] 5.2 Group the recorded rows into four `## Check` blocks (image/guardrails/profiles, credential stand-ins and both credential kinds, session isolation/TUI/egress, helper path/sync/MCP/teardown), each with `### Run`, `### Verify` containing `Expected:` and the observed results, and `### Stop if`.
- [x] 5.3 Preserve every command, observed result, both credential kinds, pinned version, and date from `claude-oss/README.md`; verify no row is dropped and `scripts/check-playbooks.sh docs/ai` exits 0.

## 6. Update current references

- [x] 6.1 Update the Maki/OpenCode/Claude playbooks: `Handoff` and `Verification` metadata, Phase 5 link and expected result, and `See also`. Verify no playbook names `docs/verification.md` or a README verification anchor as a current target.
- [x] 6.2 Update the three references' `See also` (and the OpenCode/Claude scope sentences that name the README record) to the verification pages.
- [x] 6.3 Update the onboarding P6 cells for all three agents to `verification/<agent>.md` and the `See also` list; verify every P6 target exists.
- [x] 6.4 Update `docs/ai/environment-playbook.md` (Maki-focused section links the Maki page and names the per-agent route) and `docs/setup-guide.md` (`ai/verification/maki.md`).
- [x] 6.5 Update `README.md` and `AGENTS.md` to the appropriate verification page(s) or onboarding router.
- [x] 6.6 Update `docs/verification-log.md`: live links go to `ai/verification/maki.md`; historical prose that names the old path stays plain text.
- [x] 6.7 Confirm no current reference remains: `grep -rn 'docs/verification.md' docs AGENTS.md README.md openspec/specs` returns only archive/historical prose, and no live Markdown link points at the removed file.

## 7. Update the subproject READMEs

- [x] 7.1 Replace the full verification table in `opencode-oss/README.md` with a short "Verification record" summary (dates, pinned versions, live-profile caveat) and a link to `docs/ai/verification/opencode.md`.
- [x] 7.2 Replace the full verification table in `claude-oss/README.md` with a short "Verification record" summary (date, pinned versions) and a link to `docs/ai/verification/claude.md`.

## 8. Sync the specs

- [x] 8.1 Update `openspec/specs/host-setup/spec.md`: the `OpenShell version consistency` and `A version claim without a verification run is incomplete` scenarios name `docs/ai/verification/maki.md`.
- [x] 8.2 Update `openspec/specs/opencode-oss/spec.md`: add `docs/ai/verification/opencode.md` to the allowlist, make the page the canonical record, require the README to summarize and link, and update the verification scenarios.
- [x] 8.3 Update `openspec/specs/claude-oss/spec.md` the same way for `docs/ai/verification/claude.md`.
- [x] 8.4 Confirm `openspec/specs/agent-onboarding/spec.md` does not name `docs/verification.md`; leave it unchanged.
- [x] 8.5 Run `openspec validate align-agent-verification --strict` and confirm it exits 0.

## 9. Gates, review, and commit

- [x] 9.1 Run `scripts/check-playbooks.sh docs/ai` and confirm `check-playbooks: ok`; every verification page has at least one `## Check`, and every check has Run/Verify/Expected/Stop.
- [x] 9.2 Run `openspec validate align-agent-verification --strict`, `make lint-docs`, `scripts/check-links.sh`, `make test`, and `make lint`; confirm all exit 0.
- [x] 9.3 Manually verify every anchor in the onboarding P6 links and every playbook/reference verification link, because `scripts/check-links.sh` strips fragments; record the anchor list in the task report.
- [x] 9.4 Self-review for completeness, truthfulness, security invariants, and scope: every source check is present, no new verification claim is invented, no host bind mount, no secret via `--env`/`--env-from`, credentials only through provider profiles, deny-by-default egress, uid/gid 1500, no in-sandbox authentication, no host agent config or credential store mount, and no placeholder spelling.
- [x] 9.5 Confirm `git diff --stat` is limited to the files named in this change (plus this change's directory), and `docs/verification.md` is gone with no redirect stub.
- [x] 9.6 Mark these tasks complete and commit only the named files with a docs message, for example `docs: add per-agent verification pages and route P6`, recording the commit SHA in the task report.
