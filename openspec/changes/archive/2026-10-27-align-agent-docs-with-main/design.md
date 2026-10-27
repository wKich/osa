# Design

## Context

See `proposal.md` — Why. The branch already merged `main` at `5c55280`, so the
shared references now carry the new surface: `docs/helper.md` documents
`osa health`, `osa providers`, `osa provider setup`, `osa images`,
`osa image build`, and `osa dashboard`; `docs/providers.md` documents
`--stdin` and profile ids; `dashboard/README.md` documents the Setup, health,
egress-denial, and image views; and `docs/verification-log.md` records the real
runs. The remaining gap is the agent-facing path under `docs/ai/`.

The documentation contract is already enforced by
`scripts/check-playbooks.sh`, `scripts/check-links.sh`, and
`test_asset_agent_onboarding` in `tests/run-tests.sh`. This change edits prose
and extends that existing asset check; it does not add a new check script.

## Goals / Non-Goals

**Goals:**

- A reader who finishes setup can find the dashboard, health, provider, and
  image commands from the README, quickstart, onboarding, or their playbook.
- The non-interactive provider paths are discoverable without weakening the
  rule that a credential never appears in argv.
- The environment playbook uses the shared image commands and keeps the
  environment-store build in the terminal.
- The new landmarks are covered by the existing documentation asset check.

**Non-Goals:**

- Changing helper, dashboard, image, policy, provider, bridge, oskhs, or
  sandbox behavior.
- Re-running live OpenShell, dashboard, or image verification. The merged
  `docs/verification-log.md` records those runs.
- Adding a fifth agent or renumbering the canonical P0-P8 phases.
- Duplicating `docs/helper.md` or `dashboard/README.md` in the setup pages.

## Decisions

### D1 — The merged shared references are the source of truth

`docs/helper.md`, `docs/providers.md`, `dashboard/README.md`, and
`docs/verification-log.md` already describe the new commands and views from
`main`. The setup pages link them and name the command a reader needs; they do
not repeat flag tables, route tables, or threat-model sections.

- **Why:** one reference avoids the drift that the merge just resolved.
- **Alternative rejected:** copy the dashboard API and threat model into
  `docs/ai/onboarding.md`; it would duplicate `dashboard/README.md`.

### D2 — The dashboard is an optional shared entry, not a new phase

README, quickstart, onboarding, and the playbooks present
`osa dashboard --open` after the agent's setup path and in daily use. The
canonical P0-P8 table keeps its current ownership: the dashboard is not a gate
for creating a sandbox and does not move image build or provider setup out of
P3/P4.

- **Why:** the dashboard is optional and can be started at any time; making it
  a phase would change the phase map for no setup benefit.
- **Alternative rejected:** add a P9 phase. It would invalidate every
  `Covers` value and the host/playbook split.

### D3 — Interactive provider setup stays primary; stdin is the scripted path

Each playbook's Phase 2 keeps `provider setup` as the human path and adds
`--stdin` with `--profile ID`, plus `osa provider setup` as the non-interactive
and dashboard handoff. The examples pipe from a password manager or use an
environment variable populated outside the command; no example shows
`KEY=<value>`.

- **Why:** the wizard is still the simplest human path, while the dashboard
  needs the stdin form and a profile id.
- **Alternative rejected:** make `osa provider setup` the only documented
  path. It adds a tag argument and hides the interactive profile flow.

### D4 — Health belongs in verification and daily use, not a new isolation check

Each playbook names `osa health <sandbox>` in its Verify section or daily
driver. It is a read-only summary of idle stop, MCP readiness, and doctor; the
isolation checks in the verification pages keep their current scope.

- **Why:** health answers different questions from the isolation record and
  never starts a sandbox.
- **Alternative rejected:** add a health `## Check` to every verification
  page. That would mix a read-only status summary into the recorded isolation
  runs.

### D5 — Image reporting and base builds use the shared commands

The environment playbook uses `osa images` to report the base tag, engine,
presence, and configured image, and `osa image build TAG` to build a base. It
states that the dashboard's Images section builds base images only; a store
build remains `docker build` in the terminal.

- **Why:** `osa images` is the only read-only view that spans all four agents,
  and the dashboard build path is already base-only by spec.
- **Alternative rejected:** keep only `helper image build` examples. They do
  not show the configured image or the shared report.

### D6 — Extend the existing asset check

`test_asset_agent_onboarding` gains assertions for the dashboard, health,
provider, and image landmarks, the dashboard link, and the absence of
`KEY=<value>` in the new examples. No new script is added.

- **Why:** the existing test already owns the setup-path contract.
- **Alternative rejected:** exact-prose snapshots; they would fail on harmless
  wording changes and still miss a missing command.

## Risks / Trade-offs

- **A playbook names the dashboard but not the health command** → the asset
  check requires both landmarks in every playbook.
- **The provider example drifts back to `KEY=<value>`** → the test keeps the
  existing no-argv credential check and applies it to the new `--stdin`
  examples.
- **The setup pages duplicate the dashboard threat model** → keep only the
  loopback, token, read-only, and stdin statements and link
  `dashboard/README.md` for detail.
- **The environment playbook implies the dashboard builds stores** → the
  requirement and task check state base-only and keep the store build in the
  terminal.
- **The merge changes again before apply** → the tasks start by re-reading the
  merged references and fail if a command or view is missing.

## Migration Plan

No migration. The change is documentation plus one asset test; rollback is a
revert of the edited pages and the test block.
