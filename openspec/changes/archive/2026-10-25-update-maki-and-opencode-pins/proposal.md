# Proposal

## Why

The repository is one release behind on both sides of the bridge: the image and
host CLI pin Maki v0.6.4, and the bridge contract and journey catalog pin
OpenCode v2.0.32. Maki v0.6.5 ships provider fixes that affect profiles this
repository supports (OpenCode Zen/Go adaptive thinking, Gemini 3, transient
OAuth token failures), while OpenCode v2.1.4 adds a todo sidebar, removes the
TUI's five-minute fetch deadline for long requests, and changes the served
contract. Updating only one side would force the journeys to be recorded twice,
so the two pin moves and the contract rebaseline ship together.

OpenShell needs no pin move: v0.1.5 remains the latest stable release, and the
installed CLI and gateway are already v0.1.5.

Upstream references:

- [Maki v0.6.5 release](https://github.com/tontinton/maki/releases/tag/v0.6.5)
- [OpenCode v2.1.4 tag](https://github.com/anomalyco/opencode/tree/v2.1.4)
- [OpenCode V2 CLI docs](https://opencode.ai/v2/docs/cli)
- [OpenShell v0.1.5 release](https://github.com/NVIDIA/OpenShell/releases/tag/v0.1.5)

## What Changes

- **Maki v0.6.5**: bump `ARG MAKI_VERSION`, update the host CLI and the version
  labels in the host, agent, setup, reference, and roadmap docs. Record the
  provider-facing release notes and the stricter `providers.toml` validation in
  the verification log. No Maki SDK wire, route, journey, or fixture change:
  `maki-drift` reports `src/sdk_mode.rs`, `src/cli.rs`, and the MCP handshake
  unchanged.
- **OpenCode v2.1.4**: re-vendor the OpenAPI contract, update the bridge's
  reported version, and add the six new operations as out-of-scope rows: client
  MCP (HTTP and token), voice models/instructions, saved-permission update, and
  heap dump. No routes are removed. Re-triage the new TUI behavior, re-record
  every journey and live journey, refresh the committed captures and source
  citations, and regenerate the compatibility report.
- **Todo rendering**: map Maki's `TodoWrite`/`todo_write` tool parts to
  OpenCode's `todowrite` rendering name, so the new v2.1.4 todo list and sidebar
  render; the same mapping correction covers `webfetch`, `websearch`, and
  `execute`. Add the feature row, a journey, a scripted fixture, and its
  provenance entry.
- **OpenShell**: verify v0.1.5 is still the latest stable release, record that
  no pin move is required, and do not follow the v0.1.6 pre-release line in this
  change.
- **BREAKING**: none for the repository's interfaces. Maki's stricter
  `providers.toml` validation can refuse a user's hand-written config with an
  unknown key; the sandbox base image carries no `providers.toml`, and the
  generated oskhs/live-journey configs use only known keys.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-tui-bridge`: tool parts must use the names and shape OpenCode's TUI
  renders specially, including `todowrite` for Maki's todo list so the v2.1.4
  sidebar can display it.

## Impact

- `examples/maki-image/Dockerfile`, `docs/ai/host-playbook.md`,
  `docs/ai/agent-playbook.md`, `docs/ai/references.md`, `docs/setup-guide.md`,
  `docs/roadmap.md`, and `docs/verification-log.md`.
- `bridge/src/openapi-2.0.32.json` replaced by a v2.1.4 capture;
  `bridge/src/spec-answers.ts`, `bridge/src/bridge.ts`, and the route/drift
  scripts.
- `bridge/src/translator.ts` for tool names; `bridge/compat/statuses.json` for
  versions, routes, features, and citations; `bridge/compat/journeys.json` for
  the pin and all journey evidence.
- All journey snapshots/diffs and 61 live evidence entries; the committed TUI
  request capture and the fixture provenance record.
- `bridge/test/boot-surface.test.ts`, the contract helper path, the journey
  harness assertions, and the new todo golden/fixture.
- `docs/compatibility.md` regenerated; no new reachable route is expected. The
  six new operations are out-of-scope, and the thirteen existing pin-blocked
  features stay blocked because Maki v0.6.5 does not change the SDK wire.
