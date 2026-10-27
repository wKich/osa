# Tasks

## 1. Preconditions

- [x] 1.1 Confirm the worktree is clean and on the expected branch: `git branch --show-current`, `git rev-parse --short HEAD`, `git status --short`.
- [x] 1.2 Confirm the target files exist: `test -f README.md`, `test -f docs/helper.md`, `test -f docs/providers.md`, `test -f docs/glossary.md`, `test -f docs/setup-guide.md`, `test -f AGENTS.md`, `test -f docs/ai/onboarding.md`, `test -f docs/ai/document-contract.md`, `test -f docs/ai/host-playbook.md`, `test -f docs/ai/playbooks/maki.md`, `test -f docs/ai/playbooks/opencode.md`, `test -f docs/ai/playbooks/claude.md`, `test -f docs/ai/playbooks/codex.md`, `test -f docs/ai/verification/maki.md`, and `test -f dashboard/README.md`.
- [x] 1.3 Confirm the verification tools exist: `test -f scripts/check-playbooks.sh`, `test -f scripts/check-links.sh`, and `test -f tests/run-tests.sh`; run `make lint-docs` and `scripts/check-playbooks.sh` to record the current baseline.
- [x] 1.4 Record the defects this change removes: `grep -n 'doctor\|image build' README.md`, `grep -n 'git add -A\|git commit' docs/ai/playbooks/*.md`, `grep -n 'image build\|provider setup' docs/ai/onboarding.md | sed -n '1,20p'`, and `grep -n 'codex' docs/helper.md docs/providers.md docs/glossary.md dashboard/README.md || true`. Keep the output for the final comparison.

## 2. README: one short prompt and build-before-doctor

- [x] 2.1 Add a “Let your agent set it up” block at the start of the setup section, before the manual `Install` commands. The prompt SHALL say: set up osa for the coding agent I already run; do not switch to a different agent; read `AGENTS.md` and `docs/ai/onboarding.md`; audit first; show the plan; ask before changing anything; complete through the verification page; never ask me to paste a secret. Link the full prompt in `docs/ai/onboarding.md`. Verify `grep -q 'Let your agent set it up' README.md`, `grep -q 'docs/ai/onboarding.md' README.md`, and the block appears before `## Install` or at the top of it.
- [x] 2.2 Keep the manual commands immediately after the prompt and introduce them as “If you prefer to do it yourself.” Verify the manual `git clone` block still appears after the prompt and the README still links the four agent READMEs.
- [x] 2.3 Reorder the manual install commands to `./bin/maki-oss image build` then `./bin/maki-oss doctor`; change the `doctor` comment from “verify prerequisites” to “verify the built image and host.” Verify with `grep -n 'image build\|doctor' README.md` and confirm the first `image build` line number is lower than the first `doctor` line number in the Install block.
- [x] 2.4 Update the README Guides description of `docs/providers.md` to say it is the Maki provider catalog and link the OpenCode, Claude, and Codex provider sections. Verify `grep -q 'Maki provider' README.md` and the existing links still resolve with `scripts/check-links.sh README.md`.
- [x] 2.5 Reorder `docs/helper.md`’s Install and Cookbook blocks to `image build` then `doctor`; change the Install comment to “verify the built image and host.” Verify the first `image build` line is lower than the first `doctor` line in each block.
- [x] 2.6 Make the container-engine claim match the docs: either add a Podman preflight and `engine = "podman"` / `MAKI_OSS_ENGINE=podman` path to `docs/ai/host-playbook.md`, or remove “(or Podman)” from `README.md`. Verify `grep -n 'Podman' README.md docs/ai/host-playbook.md docs/helper.md` shows the same supported-engine set everywhere.

## 3. Onboarding: prompt, phase ownership, and Codex path

- [x] 3.1 Update the full prompt in `docs/ai/onboarding.md` so the agent reads `AGENTS.md`, `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`, and the chosen agent playbook, audits first, asks before host changes, completes all canonical phases, and ends with the report. Keep the no-secret-paste rule. Verify the prompt names `host-playbook.md` and `playbooks/`.
- [x] 3.2 Rewrite the `P2` row so it covers clone, `bin/` on `PATH`, and the helper resolution check only; remove `image build`, `provider setup`, and the provider import from that row. Move the image build and post-build `doctor` to `P3`; keep the provider at `P4`. Verify `grep -n '| P2 ' docs/ai/onboarding.md` does not contain `image build` or `provider setup`, and `grep -n '| P3 \|| P4 ' docs/ai/onboarding.md` does.
- [x] 3.3 Update the local-numbering map so `P2` is shell preparation only, `P3` owns the image phase, and `P4` owns the provider phase. Verify the map has no `Phases 1-2` on the `P2` row for Maki and no image/provider action on `P2`.
- [x] 3.4 Change the Codex skills destination in the migration matrix from `/sandbox/.agents/` to `/sandbox/.agents/skills/`. Verify `grep -q '/sandbox/.agents/skills/' docs/ai/onboarding.md` and `grep -q '/sandbox/.agents/' docs/ai/environment-playbook.md` agree.
- [x] 3.5 Change “then the host playbook for the user's agent” to “then the shared host playbook, then the user's agent playbook” and make the handoff target explicit. Verify the phrase “host playbook for the user's agent” is gone.
- [x] 3.6 Update the onboarding `See also` and the Maki/Codex `Covers` descriptions only where they contradict the new phase ownership. Verify `scripts/check-playbooks.sh` exits `0`.
- [x] 3.7 Update the `P1` gate wording in `docs/ai/onboarding.md` and `docs/ai/document-contract.md` so it says shared host tools plus any host-only agent CLI, with image-baked CLIs verified at `P3`. Verify the `P1` row no longer implies that every agent CLI is installed before the image exists.

## 4. Maki playbook: helper-first, optional host CLI, safe preparation

- [x] 4.1 Add a “Choose one path” note near the top: the helper path is primary; the raw `docker`/`openshell` path is a fallback for debugging and must not be mixed in the same run. Verify `grep -q 'Choose one path' docs/ai/playbooks/maki.md`.
- [x] 4.2 Restructure Phase 1 (image) so `./bin/maki-oss image build` and `./bin/maki-oss doctor` come first; put the raw `docker build` block under “Raw fallback.” Verify `grep -n 'maki-oss image build\|docker build' docs/ai/playbooks/maki.md` shows the helper line first.
- [x] 4.3 Restructure Phase 2 (provider) so `./bin/maki-oss provider setup` comes first; put the raw profile lint/import/provider create block under “Raw fallback.” Verify the helper command appears before `openshell profile lint`.
- [x] 4.4 Restructure Phase 4 (sandbox) so `maki-oss up` comes first; put the raw `openshell sandbox create` block under “Raw fallback.” State the helper sandbox name `mk-<project>-<hash>` and the raw name `maki`. Verify `grep -n 'maki-oss up\|openshell sandbox create' docs/ai/playbooks/maki.md` shows the helper line first.
- [x] 4.5 Restructure Phases 6–7 so the helper run/status/cleanup commands come first and the raw `sandbox exec`/`download`/`delete` commands are the fallback. Remove the “Helper shortcut” paragraph that says it performs Phases 2–7 after the raw walkthrough; replace it with the choose-one note from 4.1. Verify `grep -q 'Helper shortcut' docs/ai/playbooks/maki.md` returns nothing.
- [x] 4.6 Make the host Maki CLI optional: in Inputs, Phase 0, Verify, and Stop if, state that the image-pinned binary is authoritative and a missing host `maki` does not stop the helper path. If a host check remains, label it optional and remove it from `Stop if`. Verify `grep -n 'maki --version' docs/ai/playbooks/maki.md` is either absent or accompanied by “optional,” and the `Stop if` block does not name it.
- [x] 4.7 Replace the project-preparation block with the consent-based version: existing git repo → add/verify ignore entries only; no git repo → ask before `git init`; never `git add -A` or `git commit`; name `.env` as a secret that stays ignored; state the helper handles a dirty baseline. Verify `grep -n 'git add -A\|git commit' docs/ai/playbooks/maki.md` returns nothing and `grep -q 'dirty baseline' docs/ai/playbooks/maki.md` succeeds.
- [x] 4.8 In the Daily driver one-time list, put `maki-oss image build` before `maki-oss doctor`. Verify `grep -n 'image build\|doctor'` in that section shows the build first.
- [x] 4.9 Update the Maki playbook metadata `Covers: P0-P8` with a one-line explanation of the host-only preflight, and keep `Preconditions: docs/ai/host-playbook.md P0-P2`. Verify the metadata still passes `scripts/check-playbooks.sh`.

## 5. OpenCode, Claude, and Codex playbooks: safe preparation and consistency

- [x] 5.1 Replace the `git init` / `git add -A && git commit` block in `docs/ai/playbooks/opencode.md` with the same consent-based preparation from 4.7. Verify no `git add -A` or `git commit` remains and the block names the helper’s dirty-baseline behavior.
- [x] 5.2 Replace the same block in `docs/ai/playbooks/claude.md`. Verify no `git add -A` or `git commit` remains and `.env` is named as a file that stays ignored.
- [x] 5.3 Replace the same block in `docs/ai/playbooks/codex.md`. Keep the host `codex` CLI requirement for the one-time ChatGPT login, but verify the project-preparation step never commits.
- [x] 5.4 Confirm OpenCode and Claude keep `Covers: P3-P8`, and Codex keeps `Covers: P0-P8` with an explanation for its host-only preflight. Verify the metadata still passes `scripts/check-playbooks.sh`.
- [x] 5.5 Verify all four playbooks use the helper as the primary path and label the raw commands as fallback. For Maki use the line-order checks from 4.2–4.5; for the other three confirm the helper command appears before the first raw `openshell sandbox create` with `grep -n`.

## 6. Shared references: helper, providers, glossary, dashboard, AGENTS

- [x] 6.1 Update `docs/helper.md`: the intro names `maki-oss`, `opencode-oss`, `claude-oss`, and `codex-oss`; the code layout includes `bin/codex-oss`; the configuration table is labelled “Maki defaults” and links each agent reference for its own prefix and paths; the Fish section says only Maki and OpenCode have fish plugins. Verify all four helper names appear and `grep -q 'codex-oss' docs/helper.md` succeeds.
- [x] 6.2 Update `docs/providers.md` with a scope line: it is the Maki provider catalog; OpenCode, Claude, and Codex provider setup lives in their playbooks/references. Verify the page names all four agents and links the other provider sections.
- [x] 6.3 Update `docs/glossary.md`: add `cc` and `cx` to the agent tags; make the base-image definition name each agent’s base image; make the MCP-config definition name the selected agent’s config; make the project-layer definition name all four front-ends. Verify `grep -q 'cc'`, `grep -q 'cx'`, and all four helper names appear.
- [x] 6.4 Update `dashboard/README.md` to add `codex-oss` to the projects-registered list. Verify the line names all four front-ends.
- [x] 6.5 Update `AGENTS.md`’s “Start here” list to include `docs/ai/playbooks/opencode.md`, `docs/ai/playbooks/claude.md`, `docs/helper.md`, and `docs/providers.md`, and keep onboarding first. Verify the file lists all four playbooks and the two shared references.
- [x] 6.6 Update the provider pointers in `docs/ai/reference/opencode.md`, `docs/ai/reference/claude.md`, and `docs/ai/reference/codex.md` so `docs/providers.md` is described as the Maki provider catalog, not “shared provider forms.” Point each agent’s provider setup to its own playbook/reference. Verify the three references no longer imply `docs/providers.md` covers their provider setup.
- [x] 6.7 Run `scripts/check-links.sh docs README.md AGENTS.md` and confirm 0 failures.

## 7. Setup guide: starting point, version, order, and key handling

- [x] 7.1 Add a “Before you start” repository step: clone `https://github.com/wKich/osa.git`, `cd osa`, and `export PATH="$PWD/bin:$PATH"`, or state that the guide starts after README Install and link there. Verify the guide no longer claims a clean machine without saying how the repository and helper are resolved.
- [x] 7.2 Pin the OpenShell install to `OPENSHELL_VERSION=v0.1.5` and change the prerequisite expectation from “0.1.5 or later” to the pinned version. Verify the command matches `docs/ai/host-playbook.md` and `docs/ai/references.md`.
- [x] 7.3 Move the `maki-oss mcp status` paragraph from the image section to after the sandbox-creation section. Verify `grep -n 'mcp status\|sandbox create' docs/setup-guide.md` shows the sandbox step first.
- [x] 7.4 Replace the inline `ANTHROPIC_API_KEY=<your-key> openshell provider create ...` recipe with the wizard or a hidden `read -rs` export followed by `openshell provider create ... --from-existing`. Verify `grep -n 'ANTHROPIC_API_KEY=<' docs/setup-guide.md` returns nothing and the recipe does not echo the key.
- [x] 7.5 Keep the setup guide’s raw command reference intact; do not turn it into a duplicate of the Maki playbook. Verify the guide still links `docs/ai/playbooks/maki.md` and `docs/ai/environment-playbook.md`.
- [x] 7.6 Reconcile `docs/ai/verification/maki.md` with the `0.6.5` pin: if a current run exists, record it; otherwise label checks 1–6 as the historical `0.6.4` run and add a current `0.6.5` note that does not claim a run. Verify the metadata and the scope paragraph name the same version and do not present the old result as current.

## 8. Document contract and spec deltas

- [x] 8.1 Update `docs/ai/document-contract.md` so `P1` is shared host tools plus any host-only agent CLI, `P2` is repository/helper/shell, `P3` includes the image and post-build diagnostic, and `P4` is the provider. Update the playbook template to use `Covers: P3-P8` as the default and state the `P0-P8` exception for a host-only preflight. Verify `grep -n 'P1\|P2\|P3\|P4' docs/ai/document-contract.md` agrees with `docs/ai/onboarding.md`.
- [x] 8.2 Confirm the `agent-onboarding` delta at `openspec/changes/align-osa-setup-path/specs/agent-onboarding/spec.md` has three MODIFIED requirements with headers exactly matching the current spec (“Short copy-paste onboarding prompt”, “Canonical phase map with one column per front-end”, “Discoverable and neutrally framed”) and four ADDED requirements. Verify each requirement has at least one `#### Scenario:`.
- [x] 8.3 Confirm the `host-setup` delta at `openspec/changes/align-osa-setup-path/specs/host-setup/spec.md` has two MODIFIED requirements with headers exactly matching the current spec (“Host tooling installation and verification”, “Per-agent host steps live in the agent playbook”). Verify each requirement has at least one `#### Scenario:`.
- [x] 8.4 Run `openspec validate align-osa-setup-path --strict` and confirm it exits `0`; run `openspec status --change align-osa-setup-path` and confirm the required artifacts are done.
- [x] 8.5 Confirm no spec under `openspec/specs/` is edited by the planning change; the deltas are the only spec files in the change directory. Verify `git diff --name-only openspec/specs` prints nothing in the planning session.

## 9. Asset tests

- [x] 9.1 Extend `test_asset_agent_onboarding` in `tests/run-tests.sh` with a README prompt check: `grep -Fq 'Let your agent set it up' "$ROOT/README.md"` and the block links `docs/ai/onboarding.md`.
- [x] 9.2 Add a phase-ownership check: extract the `P2`, `P3`, and `P4` rows from `docs/ai/onboarding.md`; assert `P2` does not contain `image build` or `provider setup`, `P3` contains `image build`, and `P4` contains `provider setup`.
- [x] 9.3 Add a safe-preparation check: `grep -L` or a loop over the four playbooks asserts none contains `git add -A` or `git commit`, and each contains `dirty baseline` or an equivalent consent phrase.
- [x] 9.4 Add a helper-first check: in `docs/ai/playbooks/maki.md`, the first `maki-oss up` line number is lower than the first `openshell sandbox create` line number; in the other three playbooks, the helper `up` line is lower than the first raw create line.
- [x] 9.5 Add a build-before-doctor check for `README.md`, the `## Install` and Cookbook sections of `docs/helper.md`, and the Maki daily-driver list: compare the first `image build` and first `doctor` line numbers in each block.
- [x] 9.6 Add a four-agent shared-reference check: `docs/helper.md`, `docs/providers.md`, `docs/glossary.md`, and `dashboard/README.md` each name Maki, OpenCode, Claude, and Codex (or `codex-oss`), and `docs/ai/onboarding.md` contains `/sandbox/.agents/skills/`.
- [x] 9.7 Register any new test function in the runner and confirm it is called by `make test`. Verify `make test` exits `0`.

## 10. Gates and acceptance

- [x] 10.1 Run `scripts/check-playbooks.sh` and confirm `check-playbooks: ok`.
- [x] 10.2 Run `scripts/check-links.sh docs README.md AGENTS.md` and confirm 0 failures.
- [x] 10.3 Run `make lint-docs`, `make test`, and `make lint`; all must exit `0`.
- [x] 10.4 Run the acceptance greps: no `git add -A` or `git commit` in `docs/ai/playbooks/*.md`; no `image build`/`provider setup` in the onboarding `P2` row; `OPENSHELL_VERSION=v0.1.5` in `docs/setup-guide.md`; no `ANTHROPIC_API_KEY=<` in `docs/setup-guide.md`; `/sandbox/.agents/skills/` in onboarding; and all four helper names in the shared references.
- [x] 10.5 Confirm the security invariants are intact in the edited text: no host bind mounts, no secret in `--env`/`--env-from`, credentials only through provider profiles, deny-by-default egress, uid/gid 1500, no in-sandbox authentication for any agent, and no literal provider-placeholder prefix. `make test` includes the placeholder-spelling check.
- [x] 10.6 Self-review the final diff for truthfulness: the host Maki CLI is optional; the image pin is authoritative; no helper behavior is claimed to have changed; the setup guide is still a manual reference, not a second quick start; and the Maki playbook’s raw fallback still shows the explicit-control path.
- [x] 10.7 Confirm `git diff --stat` is limited to the docs, `AGENTS.md`, `dashboard/README.md`, `tests/run-tests.sh`, the two spec deltas, and this change directory. Do not commit in the planning session.
