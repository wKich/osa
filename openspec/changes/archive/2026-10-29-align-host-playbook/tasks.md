# Tasks

## 1. Preconditions

- [x] 1.1 Confirm the worktree is on branch `docs/align-agent-pages` at base `8c4b8b8` and clean before editing: `git branch --show-current`, `git rev-parse --short HEAD`, and `git status --short`.
- [x] 1.2 Confirm the target pages and contract exist: `test -f docs/ai/host-playbook.md`, `test -f docs/ai/playbooks/maki.md`, `test -f docs/ai/onboarding.md`, `test -f docs/ai/document-contract.md`, and `test -f openspec/specs/host-setup/spec.md`.
- [x] 1.3 Confirm the current shared page still has the Maki-only content the move replaces: `grep -q 'maki --version' docs/ai/host-playbook.md` and `grep -q 'maki-oss provider setup' docs/ai/host-playbook.md` both exit `0`. Stop if the branch already differs.

## 2. Make the host playbook shared

- [x] 2.1 Update the metadata to `Doc: host-playbook`, `Kind: playbook`, `Agent: shared`, `Covers: P0-P2`, `Preconditions: none`, `Handoff: docs/ai/onboarding.md`, `Verification: docs/ai/onboarding.md`, `Reference: docs/helper.md`, `Verified: OpenShell v0.1.5, 2026-10-25`; keep the title `# Host playbook: provision a bare host for osa` and replace the Maki-path note with a shared-path note. Verify `scripts/check-playbooks.sh docs/ai` exits `0` and `grep -q '| Handoff | \`docs/ai/onboarding.md\` |' docs/ai/host-playbook.md` succeeds.
- [x] 2.2 Rewrite Phase 1 to preflight only `docker version --format '{{.Server.Version}}'`, `openshell status`, and `uname -m`, with the expected output and stop rule. Verify `! grep -q 'maki --version' docs/ai/host-playbook.md` and `grep -q 'openshell status' docs/ai/host-playbook.md`.
- [x] 2.3 Rewrite Phase 2 to install and verify the container engine and OpenShell CLI/gateway only, keeping the Homebrew and docker-group preconditions and the gateway recovery step. Verify `grep -q 'brew --version' docs/ai/host-playbook.md`, `grep -qi 'rootless' docs/ai/host-playbook.md`, `grep -q 'brew services restart openshell' docs/ai/host-playbook.md`, and `! grep -q 'Maki CLI' docs/ai/host-playbook.md`.
- [x] 2.4 Rewrite Phase 3 to clone the repository, put `bin/` on `PATH`, verify `command -v osa`, and point to the shared `Fish setup` section plus the Maki playbook for fish integration and helper fallback variables. Verify `grep -q 'command -v osa' docs/ai/host-playbook.md`, `! grep -q 'maki-oss doctor' docs/ai/host-playbook.md`, and `! grep -q 'maki-oss image build' docs/ai/host-playbook.md`.
- [x] 2.5 Rewrite the Scope, Inputs, Handoff, Invariants, and See also sections for the shared role: onboarding handoff, no agent authentication or base-URL override, links to onboarding, document contract, Maki playbook/reference, OpenCode/Claude pages, helper, providers, and references. Verify `scripts/check-links.sh docs/ai/host-playbook.md` exits `0` and `grep -q 'maki auth login' docs/ai/host-playbook.md` fails.
- [x] 2.6 Confirm the acceptance greps: `grep -ni 'maki\|maki-oss\|maki-agent' docs/ai/host-playbook.md` shows no Maki command or version (navigation links only), and `! grep -q 'maki-oss fish install' docs/ai/host-playbook.md`.

## 3. Move the Maki-only host steps into the Maki playbook

- [x] 3.1 Add `maki --version` to Phase 0's preflight block, state the expected `maki 0.6.5`, and point at the installer listed in `docs/ai/references.md` when the CLI is absent. Verify `grep -q 'maki --version' docs/ai/playbooks/maki.md` and `grep -q 'maki 0.6.5' docs/ai/playbooks/maki.md`.
- [x] 3.2 Add a plain `## Shell preparation` section (not a `## Phase`) with `./bin/maki-oss fish install`, the `MAKI_OSS_BIN` fallback, and per-shell verification blocks. Verify `grep -q '^## Shell preparation' docs/ai/playbooks/maki.md`, `grep -q './bin/maki-oss fish install' docs/ai/playbooks/maki.md`, and `grep -q 'MAKI_OSS_BIN' docs/ai/playbooks/maki.md`.
- [x] 3.3 Add the helper alternatives `./bin/maki-oss image build` and `./bin/maki-oss doctor` to Phase 1 and verify `maki-oss doctor` exits `0` in the phase's Verify block. Verify `grep -q './bin/maki-oss image build' docs/ai/playbooks/maki.md` and `grep -q './bin/maki-oss doctor' docs/ai/playbooks/maki.md`.
- [x] 3.4 Add the helper alternative `./bin/maki-oss provider setup` to Phase 2 alongside the raw profile/provider commands. Verify `grep -q './bin/maki-oss provider setup' docs/ai/playbooks/maki.md` and `grep -q 'openshell profile import' docs/ai/playbooks/maki.md`.
- [x] 3.5 Add a plain `## Daily driver` section with the moved bare-`maki-oss` loop, `run`, `status`, `stop`, `rm`, sync/parked-workspace behavior, and `policy review`; keep the raw run and cleanup commands in Phases 6-7. Verify `grep -q '^## Daily driver' docs/ai/playbooks/maki.md`, `grep -q 'maki-oss policy review' docs/ai/playbooks/maki.md`, and `grep -q 'openshell sandbox download maki' docs/ai/playbooks/maki.md`.
- [x] 3.6 Update the Maki playbook's `See also` to include the Maki reference and keep the shared host playbook, environment playbook, verification, helper, references, and document contract links; keep `Handoff`/`Verification` on `docs/verification.md`. Verify `scripts/check-links.sh docs/ai/playbooks/maki.md` exits `0` and `grep -q 'reference/maki.md' docs/ai/playbooks/maki.md`.

## 4. Update the router and repository descriptions

- [x] 4.1 Update the Maki cells in `docs/ai/onboarding.md`: P0 points at `host-playbook.md` for shared preflight and `playbooks/maki.md` Phase 0 for `maki --version`; P1 points at `playbooks/maki.md` Phase 0 for the Maki CLI; P2 points at `playbooks/maki.md` for helper doctor/image/provider setup. Do not change the OpenCode or Claude cells. Verify `grep -q 'host-playbook.md.*Phase 1' docs/ai/onboarding.md`, `grep -q 'playbooks/maki.md.*Phase 0' docs/ai/onboarding.md`, and `git diff -- docs/ai/onboarding.md` shows no OpenCode/Claude cell edit.
- [x] 4.2 Update the local numbering table's columns to `Shared host playbook` and `Maki agent playbook`, set the P2 row to `Shell preparation, Phases 1-2` and P7's shared cell to `-`, and set the See-also descriptions to the shared host path P0-P2 and the Maki agent path P0-P8. Verify `grep -q 'Shared host playbook' docs/ai/onboarding.md`, `grep -q 'Shell preparation, Phases 1-2' docs/ai/onboarding.md`, and `grep -q 'Maki agent path' docs/ai/onboarding.md`.
- [x] 4.3 Update `AGENTS.md` and `README.md` so the host-playbook description says it provisions shared host tooling and hands off to the agent playbook, not that it installs Maki. Verify `! grep -q 'OpenShell, Maki, shell' AGENTS.md README.md` and `grep -q 'shared host tooling' AGENTS.md README.md`.

## 5. Specs and sync

- [x] 5.1 Confirm the `host-setup` delta has the new per-agent requirement and no requirement still sends a Maki-only step to the shared page: `grep -q 'Per-agent host steps live in the agent playbook' openspec/changes/align-host-playbook/specs/host-setup/spec.md` and `grep -q 'docs/ai/playbooks/maki.md' openspec/changes/align-host-playbook/specs/host-setup/spec.md`.
- [x] 5.2 Confirm the `agent-onboarding` delta changes only the "Agent page names its path" scenario and keeps the modified requirement header exact. Verify `grep -q 'Scenario: Agent page names its path' openspec/changes/align-host-playbook/specs/agent-onboarding/spec.md`.
- [x] 5.3 Make the main `host-setup` purpose agent-neutral, sync both deltas to `openspec/specs/host-setup/spec.md` and `openspec/specs/agent-onboarding/spec.md`, and leave `docs/verification.md` and the OpenCode/Claude specs untouched. Verify `grep -q 'Per-agent host steps live in the agent playbook' openspec/specs/host-setup/spec.md`, `grep -q 'shared host page says it is the shared host path' openspec/specs/agent-onboarding/spec.md`, and `git diff --name-only` names only the allowed files.

## 6. Gates

- [x] 6.1 Run `scripts/check-playbooks.sh docs/ai` and confirm it prints `check-playbooks: ok`.
- [x] 6.2 Run `openspec validate align-host-playbook --strict` and confirm it exits `0`.
- [x] 6.3 Run `make lint-docs` and confirm it exits `0`.
- [x] 6.4 Run `scripts/check-links.sh` and confirm 0 failures.
- [x] 6.5 Run `make test` and confirm it exits `0`.
- [x] 6.6 Run `make lint` and confirm it exits `0`.

## 7. Scope, self-review, and commit

- [x] 7.1 Confirm `git diff --stat` is limited to `docs/ai/host-playbook.md`, `docs/ai/playbooks/maki.md`, `docs/ai/onboarding.md`, `AGENTS.md`, `README.md`, `openspec/specs/host-setup/spec.md`, `openspec/specs/agent-onboarding/spec.md`, and `openspec/changes/align-host-playbook/`. No `docs/verification.md`, OpenCode/Claude doc, example, bridge, oskhs, or runtime change.
- [x] 7.2 Self-review for truthfulness and security: no Maki command/version on the shared page; moved commands in the Maki playbook; no placeholder spelling; no host bind mounts, `--env` secrets, in-sandbox authentication, base-URL override, or host agent config mount added.
- [x] 7.3 Commit only the named files with a docs message, e.g. `docs: make the host playbook shared and move Maki steps`, and record the commit SHA.
- [x] 7.4 Apply the review fixes: Maki `Covers` is `P0-P8`; the onboarding labels distinguish the shared host playbook from the Maki agent playbook; the versions requirement pins OpenShell to `docs/ai/references.md` and the container-engine minimum to `docs/setup-guide.md`; the shared fish handoff points at `docs/helper.md#fish-setup`; the Maki invariant includes `--env-from`; the Phase 1 helper lead-in separates build from doctor; the Phase 6 shortcut points at `## Daily driver`; and Phase 1 says `uname -m` is present. Verify with the full gate list in section 6.
