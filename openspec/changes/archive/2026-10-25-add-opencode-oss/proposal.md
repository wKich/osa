# Proposal: add-opencode-oss

## Why

The repository runs Maki inside OpenShell sandboxes, but OpenCode can only
reach a sandbox indirectly through the TUI bridge, which translates OpenCode's
client protocol onto Maki. People who want OpenCode itself as the sandboxed
agent have no image, provider profiles, or guide for it. Generalizing
`bin/maki-oss` behind an `--agent` flag would touch about 3,900 lines of
landed lifecycle and sync code for one more agent. A small parallel subproject
gives OpenCode the same isolation guarantees without that risk.

## What Changes

- Add a self-contained top-level `opencode-oss/` subproject next to
  `bridge/`, `dashboard/`, and `oskhs/`, containing:
  - `image/Dockerfile`: an agent-only base image (`opencode-agent:local`)
    that installs the pinned native OpenCode **2.1.4** binary from the npm
    platform tarball (`@opencode/cli-linux-arm64` /
    `@opencode/cli-linux-x64-baseline`). It needs no Node or Bun, runs as
    uid/gid 1500, and bakes the model catalog at build time so that
    `opencode models` works with no network.
  - `image/config/opencode.json`: the global OpenCode config. It disables
    updates and sharing and adds deny rules for privilege escalation, remote
    shells, in-sandbox `opencode auth`, and edits to the agent's own config.
    It has no catch-all allow and declares no MCP servers, plugins, or
    provider blocks.
  - `providers/opencode-*.yaml` plus `providers/catalog.tsv`: provider
    profiles forked from `examples/providers/`. Each keeps the same endpoint
    and env var, but its `binaries` list is `/usr/local/bin/opencode`.
  - `policies/minimal.yaml`: the same filesystem, Landlock, and process floor
    as `examples/policies/maki-minimal.yaml`.
  - `README.md`: a guide covering build, profile import, sandbox create,
    headless `opencode run --standalone --auto --format json`, interactive TUI
    over `openshell sandbox exec --tty`, and explicit `openshell sandbox
    upload` / `download`. It also includes a verification checklist and a
    record of the observed output.
- Add a one-line pointer from the root `README.md` Guides list to
  `opencode-oss/README.md`.
- **Not in this change:** a `bin/opencode-oss` lifecycle helper (deferred to
  an optional slice 2), changes to `bin/maki-oss`, `bridge/`, `oskhs/`, or
  `dashboard/`, patch-based sync, environment-store support for OpenCode MCP
  servers, and the bridge's OpenCode pin, which belongs to
  `update-maki-and-opencode-pins`.

## Capabilities

### New Capabilities

- `opencode-oss`: Running the OpenCode agent natively inside an OpenShell
  sandbox. Covers the pinned agent-only image, the offline model catalog, the
  baked global config and its deny rules, the OpenCode-bound provider
  profiles, the minimal policy, and the documented, verified headless,
  interactive, and file-transfer workflows.

### Modified Capabilities

None. The new policy lives under `opencode-oss/policies/`, not
`examples/policies/`, so `sandbox-policy` is not modified. The new spec
restates the same filesystem floor for its own policy.

## Impact

- **New files only**, under `opencode-oss/`, plus one README line. No
  existing behavior changes.
- **Dependencies:** the npm registry (`registry.npmjs.org`) at image build
  time only. `models.dev` / `models.opencode.ai` are reached only at build
  time, to seed the catalog.
- **OpenShell state:** users import a second set of provider profiles
  (`opencode-*`). One OpenShell provider per credential key can be attached
  to a sandbox, so an OpenCode sandbox attaches `opencode-<name>` instead of
  `maki-<name>`.
- **Coordination:** `update-maki-and-opencode-pins` (in progress on `main`,
  uncommitted) also moves to OpenCode 2.1.4. This change pins 2.1.4
  independently in its own Dockerfile and does not touch the bridge pin.

Upstream references:

- OpenShell profiles (`binaries`, endpoints, credential binding):
  https://docs.nvidia.com/openshell/how-it-works/providers/profiles.md
- OpenShell sandboxes (create, exec, upload/download):
  https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md
- OpenShell policies (base vs effective policy):
  https://docs.nvidia.com/openshell/how-it-works/policies/overview.md
- OpenCode config (`update`, `share`, `{env:VAR}`): https://opencode.ai/docs/config/
- OpenCode permissions: https://opencode.ai/docs/permissions/
- OpenCode CLI (`run`, `--standalone`, `--auto`, `models`): https://opencode.ai/docs/cli/
- OpenCode providers and models: https://opencode.ai/docs/providers/,
  https://opencode.ai/docs/models/
- OpenCode config schema (the deprecated `permission` object vs the
  `permissions` ruleset): https://opencode.ai/config.json
