# Proposal: add-opencode-oss-helper

## Why

`opencode-oss/` ships an image, provider profiles, a policy, and a guide,
but every step is a raw `docker`/`openshell` command. Users must also
remember OpenCode-specific traps:

- closing stdin for headless runs
- choosing a model the TUI cannot take as a flag
- `--standalone` on every call
- no sync back to the host

`maki-oss` solves the same problems for Maki with a tested helper. The user
wants feature parity: `opencode-oss` should do everything `maki-oss` does,
but specialized for OpenCode, just as `maki-oss` is specialized for Maki.
`extract-oss-core` makes that a thin front-end rather than a fork.

## What Changes

- Add `bin/opencode-oss`, an OpenCode front-end over `lib/oss-core.sh`, with
  the same command surface as `maki-oss` minus the Maki-only parts:
  - `doctor`, `image build`, `init`/`up`
  - bare `opencode-oss` / `opencode-oss opencode` (interactive TUI) and
    `run "<prompt>"` (headless JSON)
  - `upload`/`download` with safe patch sync on session exit
  - `status`/`list`/`logs`/`start`/`stop`/`rm`
  - `policy show|edit|apply|review|approve|reject`
  - `provider add|attach|list|setup`, `mcp status`, `help`
  - the common options: `--name`, `--image`, `--policy`, `--provider`,
    `--cpu`, `--memory`, `--engine`, `--gateway`, `--workdir`, `--env`,
    `--env-from`, `--allow-env`, `--model`, `--continue`,
    `--resume`/`--session-id`, `--timeout`, `--idle-stop`, `--no-sync`,
    `--yes`, and the provider and logs options
- Specialize it for OpenCode:
  - **Identity:** `OPENCODE_OSS_*` env, `~/.config/opencode-oss/config.toml`,
    `opencode-{project}` sandbox names, and `.opencode-oss` sync state.
  - **Defaults:** `opencode-agent:local`, `opencode-oss/policies/minimal.yaml`,
    and `opencode-oss/providers`.
  - **Launch:** every call uses `--standalone`. Headless is
    `opencode run --standalone --auto --format json`, with stdin closed.
    Interactive is the native `opencode --standalone` TUI.
  - **Model:** passed with `--model` for runs. For the TUI, which has no
    model flag, it goes in as a non-secret config overlay passed to that
    exec only. The user's project is never edited.
  - **Sessions:** Maki's `--resume ID` and `--session-id ID` both map to
    OpenCode's `--session ID`; `--continue` passes through.
  - **Egress:** the helper turns off OpenCode's catalog fetch per exec, so
    sessions no longer trigger the denied `models.opencode.ai` request.
  - **`mcp status`:** compares the `mcp` key in the host and sandbox
    `opencode.json`.
  - **`provider setup`:** maps the Maki and OpenCode credential stores to
    the `opencode-*` profiles through a new
    `opencode-oss/providers/stores.tsv`. After setup it prints the
    provider's example model.
  - **`image build`:** builds `opencode-oss/image` with
    `--opencode-version`.
- Not carried over: the `tui = "opencode"` bridge mode (Maki-only), `fish`
  install, dashboard, oskhs, and playbooks. The user scoped this to the
  helper only.
- Update `opencode-oss/README.md` to lead with the helper and keep the raw
  commands as the "without the helper" path. Add `docs/opencode-oss.md` as
  the command reference, and extend `make lint`/`make test` to cover
  `bin/opencode-oss`.

## Capabilities

### New Capabilities

- `opencode-oss-helper`: the `opencode-oss` command. It has parity with
  `helper-cli` under the substitutions above, and adds OpenCode-specific
  requirements for launch, model selection, session-flag mapping, MCP
  status, and provider setup.

### Modified Capabilities

- `opencode-oss`: the "Self-contained subproject with recorded
  verification" requirement currently confines deliverables to
  `opencode-oss/` and forbids touching `bin/maki-oss`. It changes to allow
  the helper front-end in `bin/`, the shared core in `lib/`, and the docs
  and Makefile entries for the helper, while still forbidding changes to
  `bridge/`, `oskhs/`, `dashboard/`, and `examples/`.

## Impact

- **New:** `bin/opencode-oss`, `opencode-oss/providers/stores.tsv`,
  `docs/opencode-oss.md`, and OpenCode cases in `tests/run-tests.sh`, with a
  `tests/stub/opencode` extension if needed.
- **Modified:** `opencode-oss/README.md` and `Makefile` (lint and test
  targets). `lib/oss-core.sh` changes only if a hook gap turns up, and then
  without changing `maki-oss` behavior, which the unchanged Maki tests
  prove.
- **Depends on:** `extract-oss-core`, which must be merged first.
- **User state:** new config file `~/.config/opencode-oss/config.toml`, and
  sandboxes named `opencode-<project>`. Existing `maki-oss` config and
  sandboxes are untouched.

Upstream references:

- OpenCode CLI (`run`, `--standalone`, `--auto`, `--session`, `--format`):
  https://opencode.ai/docs/cli/
- OpenCode config (`OPENCODE_CONFIG_CONTENT`, `model`, `mcp`):
  https://opencode.ai/docs/config/
- OpenShell sandboxes (`exec --env` for non-secret values,
  upload/download): https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md
