# Proposal

## Why

The agent docs were restructured on this branch before `main` added the shared
operator surface: `osa dashboard`, `osa health`, `osa providers` and
`osa provider setup`, `osa images` and `osa image build`, the dashboard's Setup
and health views, and egress denials. Merging `main` updated the shared
references (`docs/helper.md`, `docs/providers.md`, `dashboard/README.md`, and
`docs/verification-log.md`), but the agent-facing path — README, quickstart,
onboarding, and the four playbooks — still sends a reader to terminal-only
provider setup and never names the dashboard, health, or image commands. A
reader who finishes setup cannot discover the Setup tab, the health panel, or
the non-interactive `--stdin` and profile-id paths that `main` now supports.

## What Changes

- **README:** keep the merged `osa dashboard --open` description, add the
  dashboard to Guides, and name `osa health` and `osa dashboard --open` beside
  the daily commands.
- **Quickstart:** add an optional dashboard step after setup, and put
  `osa dashboard --open` and `osa health <sandbox>` in Daily use.
- **Onboarding:** add a shared operator-surface section that names
  `osa dashboard`, `osa health`, `osa providers`, `osa provider setup`,
  `osa images`, and `osa image build`; route P4 through the non-interactive
  provider forms and P6 through `osa health`; link `dashboard/README.md` in See
  also.
- **Agent playbooks:** in Phase 2, name `--stdin` with a profile id and
  `osa provider setup` as the non-interactive/dashboard path; in Verify or the
  daily driver, add `osa health <sandbox>` and `osa dashboard --open`; link the
  dashboard reference. Codex keeps its host-only login and states that the
  dashboard shows the terminal command instead of a wizard.
- **Environment playbook:** use `osa images` to check the base and configured
  image and `osa image build` to build a base image; state that the dashboard
  Images section builds base images only and that store builds stay in the
  terminal.
- **Setup guide and glossary:** add the dashboard and health commands to Next
  steps, update the `osa` definition, and define the dashboard, egress denial,
  and health terms already used by the merged references.
- **AGENTS.md:** list `dashboard/README.md` with the shared references.
- **Verification:** extend the documentation asset checks so the shared
  surface stays discoverable and the provider examples never put a credential
  in argv.
- **Does not change** helper, dashboard, image, policy, provider, bridge,
  oskhs, or sandbox behavior. This is a documentation and documentation-test
  change.

## Capabilities

### New Capabilities

_None._ The dashboard, health, provider, and image behavior already has specs;
this change aligns the onboarding and environment documentation with it.

### Modified Capabilities

- `agent-onboarding`: the README, quickstart, router, and four playbooks name
  the shared dashboard, health, provider, and image surface; provider examples
  use stdin/profile ids; each playbook links the dashboard reference.
- `environment-layer`: the environment playbook verifies base and derived
  images through `osa images`/`osa image build` and states that the dashboard
  builds base images only, while store builds stay in the terminal.

## Impact

- **Edited docs:** `README.md`, `AGENTS.md`, `docs/ai/quickstart.md`,
  `docs/ai/onboarding.md`, `docs/ai/playbooks/{maki,opencode,claude,codex}.md`,
  `docs/ai/environment-playbook.md`, `docs/setup-guide.md`, and
  `docs/glossary.md`.
- **Spec deltas:** `openspec/specs/agent-onboarding/spec.md` and
  `openspec/specs/environment-layer/spec.md`.
- **Tests:** `tests/run-tests.sh` gains asset assertions for dashboard, health,
  provider, and image discoverability and for no credential in argv.
- **No dependency or API changes.** No credential path, egress rule, bind
  mount, or runtime behavior is touched.
- **Risk:** the shared surface can drift again when `main` adds commands; the
  asset checks compare required landmarks, not prose. Provider examples can
  regress to `KEY=<value>`; the existing credential test is extended to the new
  `--stdin` form.
- **Dependencies:** none. The merge of `main` that landed the shared surface is
  already in this branch.
