# Tasks

## 1. Preconditions and baseline

- [ ] 1.1 Confirm the branch contains the `main` merge and the merged shared references: `git log --oneline -1`, `test -f docs/helper.md`, `grep -Fq 'osa dashboard' docs/helper.md`, `grep -Fq 'osa health' docs/helper.md`, and `grep -Fq 'osa images' docs/helper.md`.
- [ ] 1.2 Confirm the target pages exist and the documentation tools are available: `test -f README.md`, `test -f docs/ai/quickstart.md`, `test -f docs/ai/onboarding.md`, `test -f docs/ai/environment-playbook.md`, `test -f docs/setup-guide.md`, `test -f docs/glossary.md`, `test -f dashboard/README.md`, `test -f scripts/check-playbooks.sh`, `test -f scripts/check-links.sh`, and `test -f tests/run-tests.sh`.
- [ ] 1.3 Record the baseline: `make lint-docs`, `scripts/check-playbooks.sh`, `scripts/check-links.sh docs README.md AGENTS.md`, and `openspec validate align-agent-docs-with-main --strict`; keep the output for comparison.

## 2. README and quickstart

- [ ] 2.1 In `README.md`, add `osa health <sandbox>` and `osa dashboard --open` to the daily-command area, and add the dashboard reference to Guides. Verify `grep -Fq 'osa health' README.md`, `grep -Fq 'osa dashboard --open' README.md`, and `grep -Fq 'dashboard/README.md' README.md`.
- [ ] 2.2 In `docs/ai/quickstart.md`, add an optional step after provider setup: start `osa dashboard --open`, use the Setup tab for providers and base images, and use Projects for health, egress denials, and resolve. Verify the step names `osa dashboard --open`, `Setup`, and `Projects`, and links `dashboard/README.md`.
- [ ] 2.3 In `docs/ai/quickstart.md` Daily use, add `osa dashboard --open` and `osa health <sandbox>`. Verify both commands appear below the setup steps and `scripts/check-links.sh docs/ai/quickstart.md` reports no failures.
- [ ] 2.4 Keep the merged dashboard description and the existing security invariants unchanged; verify `git diff README.md docs/ai/quickstart.md` adds no bind mount, `--env` credential, wildcard egress, or in-sandbox login instruction.

## 3. Onboarding router

- [ ] 3.1 Add a shared operator-surface section to `docs/ai/onboarding.md` that names `osa dashboard`, `osa health`, `osa providers`, `osa provider setup`, `osa images`, and `osa image build`, and links `dashboard/README.md`. Verify all six command names and the link appear in the section.
- [ ] 3.2 State the dashboard boundary in that section: loopback by default, token for mutations and sensitive reads, `--read-only`, and provider credentials only through the Setup wizard's stdin handoff. Verify the four statements appear and no page claims the dashboard stores credentials.
- [ ] 3.3 Update the P4 row and the P4 note to name the non-interactive forms `--stdin` with `--profile ID` and `osa provider setup TAG --profile ID`; keep the Codex login as the terminal-only exception. Verify `grep -n '| P4 ' docs/ai/onboarding.md` names `provider setup` and `--stdin` without naming a credential value.
- [ ] 3.4 Update the P6 row to name `osa health <sandbox>` beside the agent's `mcp status` and verification page, without making health a gate for sandbox creation. Verify the P6 row contains `osa health` and P5 contains no health requirement.
- [ ] 3.5 Add `dashboard/README.md` and `docs/helper.md#osa-health` to the See also list. Verify both links resolve with `scripts/check-links.sh docs/ai/onboarding.md` and `scripts/check-playbooks.sh` still passes.

## 4. Agent playbooks

- [ ] 4.1 In `docs/ai/playbooks/maki.md` Phase 2, add `pass show <entry> | maki-oss provider setup --stdin --profile <id>` and `osa provider setup mk --profile <id> --attach <sandbox> --json` as the non-interactive forms, and state that the wizard remains the human path. Verify the examples use stdin or an externally populated environment variable and contain no `KEY=<value>`.
- [ ] 4.2 In `docs/ai/playbooks/maki.md`, add `osa health <sandbox>` to the Verify section or Daily driver and `osa dashboard --open` to Daily driver; add `dashboard/README.md` to See also. Verify all three landmarks appear.
- [ ] 4.3 Repeat 4.1 and 4.2 for `docs/ai/playbooks/opencode.md` with the `oc` tag and `opencode-oss` commands. Verify the page names `osa health`, `osa dashboard --open`, and the dashboard link.
- [ ] 4.4 Repeat 4.1 and 4.2 for `docs/ai/playbooks/claude.md` with the `cc` tag and `claude-oss` commands. Verify the page names `osa health`, `osa dashboard --open`, and the dashboard link.
- [ ] 4.5 In `docs/ai/playbooks/codex.md`, add `osa health <sandbox>` and `osa dashboard --open`, link `dashboard/README.md`, and state that Codex provider setup is the host-only terminal login and the dashboard shows that command instead of a wizard. Verify `codex-oss provider setup` remains the only Codex provider path and no `--stdin` example is added for Codex.
- [ ] 4.6 Confirm every playbook keeps its metadata, phase ownership, helper-first, and safe-preparation rules. Verify `scripts/check-playbooks.sh` exits `0` and `grep -n 'git add -A\|git commit' docs/ai/playbooks/*.md` returns nothing.

## 5. Environment playbook

- [ ] 5.1 In `docs/ai/environment-playbook.md`, add `osa images` to the base-image check: report the base tag, engine, presence, and configured image for the selected agent. Verify the page names `osa images` before the base build.
- [ ] 5.2 Add `osa image build TAG` as the shared base-build command and state that the dashboard Images section builds base images only. Verify the page states both and does not claim a dashboard build produces or selects a store image.
- [ ] 5.3 Keep the environment store build as a terminal `docker build` and state that selecting the derived image stays in the helper's `image` setting. Verify the store build is not sent to the dashboard and the `image` setting instruction remains.
- [ ] 5.4 Update the report format to include the `osa images` result (base tag, present or missing, configured image). Verify the report block names the base image and the configured image separately.

## 6. Setup guide, glossary, and AGENTS

- [ ] 6.1 In `docs/setup-guide.md` Next steps, add `osa dashboard --open` for the Projects, Setup, and Rules views and `osa health <sandbox>` for the read-only idle, MCP, and doctor report; link `dashboard/README.md`. Verify both commands and the link appear.
- [ ] 6.2 In `docs/glossary.md`, update the `osa` entry to include `health`, `providers`, `images`, and `dashboard`, and add definitions for **Dashboard**, **Egress denial**, and **Project health** that match `dashboard/README.md`. Verify each term is defined once and the four agent names remain.
- [ ] 6.3 In `AGENTS.md`, add `dashboard/README.md` to the shared references near `docs/helper.md`. Verify `grep -Fq 'dashboard/README.md' AGENTS.md` succeeds and the onboarding link remains first.
- [ ] 6.4 Run `scripts/check-links.sh docs README.md AGENTS.md` and confirm 0 failures.

## 7. Documentation asset checks

- [ ] 7.1 Extend `test_asset_agent_onboarding` in `tests/run-tests.sh` to require `osa dashboard`, `osa health`, and `dashboard/README.md` in `README.md` and `docs/ai/quickstart.md`. Verify the assertions fail when one landmark is removed in a scratch copy and pass on the real file.
- [ ] 7.2 Extend the same test to require `osa dashboard`, `osa health`, and `dashboard/README.md` in each of the four `docs/ai/playbooks/*.md`. Verify all four pages are checked in one loop.
- [ ] 7.3 Extend the same test to require `osa images` and `osa image build` in `docs/ai/environment-playbook.md`, and to reject `KEY=<value>` in the four playbooks and the setup guide. Verify the new assertions run under `make test`.
- [ ] 7.4 Confirm no new test script or dependency is added: `git diff --stat tests/run-tests.sh` shows only the existing `test_asset_agent_onboarding` block, and `git diff --name-only` contains no new executable.

## 8. Gates and acceptance

- [ ] 8.1 Run `make lint-docs`, `scripts/check-playbooks.sh`, `scripts/check-links.sh docs README.md AGENTS.md`, and `openspec validate align-agent-docs-with-main --strict`; all must exit `0`.
- [ ] 8.2 Run `make test` and confirm the documentation asset cases pass with the new landmarks.
- [ ] 8.3 Self-review the diff: no helper, dashboard, image, policy, provider, bridge, oskhs, or sandbox behavior changes; no host bind mount; no credential in `--env`, `--env-from`, argv, or an example; egress stays deny-by-default; no in-sandbox authentication; no literal provider-placeholder prefix.
- [ ] 8.4 Confirm the final diff is limited to `README.md`, `AGENTS.md`, `docs/ai/quickstart.md`, `docs/ai/onboarding.md`, the four `docs/ai/playbooks/*.md`, `docs/ai/environment-playbook.md`, `docs/setup-guide.md`, `docs/glossary.md`, `tests/run-tests.sh`, and this change directory.
