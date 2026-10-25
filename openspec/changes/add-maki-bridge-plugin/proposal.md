# Proposal

## Why

Thirteen reachable features are `degraded` with `blockedBy: "pin"`, because
Maki v0.6.4's stream-json SDK has no control for them (`src/sdk_mode.rs`
L818–L880). Several can be reached through Maki's Lua plugin layer anyway, which
does run under SDK mode: tool, agent and permission hooks plus autocmds fire
headless (`maki-lua/src/api/autocmd.rs` v0.6.4 L223–L230; hooks guide). The
UI-routed APIs do not: `maki.session.*`, `maki.model.set`, `maki.api.run_command`,
`maki.task.*` and `maki.ui.*` all return `no interactive UI attached`
(`maki-lua/src/api/util/command.rs` L745–L753), because only `maki-ui` attaches
the UI (`maki-ui/src/event_loop.rs` L610).
This change lays the shared foundation: a plugin the image ships, and a channel
between it and the bridge. The per-gap changes build on it.

## What Changes

- A Lua plugin `maki_bridge` baked into the base image at
  `/sandbox/.config/maki/lua/maki_bridge/`, required from the image's
  `init.lua`, with a `plugin.toml` granting only the permissions it uses.
- A mailbox channel under the sandbox's Maki state dir (`maki.env.state_dir()`):
  the plugin writes requests and reads answers as JSON files, keyed by session
  id. The bridge reads and writes them with its existing `sandboxRun`
  (`openshell sandbox exec`), so no network path or egress rule is added.
- A presence handshake: at child start the plugin writes a `hello` file with its
  version and the hooks it installed. The bridge enables plugin-backed behavior
  only when that file is there and the version matches, and keeps today's pinned
  behavior otherwise, for example under an environment image whose `init.lua`
  drops the `require`.
- Harness support: the offline fake child emulates the mailbox (the fake
  sandbox's filesystem), and the live run uploads the plugin with the journey
  config. This change modifies the archived harness, as the goal allows for a
  finding that traces to it, and records why.
- No gap closes in this change. It ships the channel with a no-op hook, plus
  tests that prove the round trip offline and live.

Follow-up changes, each closing one degraded feature through this foundation:

| Change | Feature (journey) | Plugin mechanism |
| --- | --- | --- |
| `add-persistent-always-permission` | `permission-reask` | `permission.prompt` hook reads a persisted allow-list |
| `add-agent-question-relay` | `agent-questions` (`answer-agent-question`) | `tool.question.input` returns `ask`; the bridge answers with deny guidance |
| `add-subagent-permission-relay` | `subagent-permissions` (`reject-permission-with-reason`) | `permission.prompt` hook relays a subagent's ask over the mailbox |
| `add-plugin-mid-turn-steering` | `mid-turn-steering` | `tool.*.output` hook appends steer text from the mailbox |
| `add-background-bash-detach` | `tool-background` (`background-blocking-tools`) | a `bash` replacement on `maki.fn.jobstart` that detaches on a mailbox signal |
| `add-mcp-disconnect-gate` | `mcp-toggle` (`manage-mcp-servers`, partial) | `tool.*.input` hook denies a disconnected server's calls |
| `add-edit-snapshot-revert` | `session-revert` (files only, partial) | `tool.edit/write.input` hooks snapshot files for the bridge to restore |

Out of reach for plugins, so these stay pin-blocked: manual `/compact`,
message-history rewind and fork-at-message (no history API), and MCP
elicitation (the client capabilities are fixed in Rust, `maki-agent/src/mcp/protocol.rs`
L60). Not plugin work and deferred: slash-command prompt templates and PDF
attachments, which the bridge can serve alone, and reasoning effort (needs a
wrapping Lua provider).

## Capabilities

### New Capabilities
- `maki-bridge-plugin`: the plugin the image ships, its mailbox protocol, the
  presence handshake, and how the bridge falls back when the plugin is absent.

### Modified Capabilities
- `opencode-tui-bridge`: the bridge detects the plugin at child start, and talks
  to it only over the mailbox through `openshell sandbox exec`.
- `tui-journey-parity`: offline and live journey runs install the plugin on the
  Maki side, the fake child emulates the mailbox, and a run records whether the
  plugin was present.

## Impact

- `examples/maki-image/`: new `config/lua/maki_bridge/*.lua`,
  `config/plugin.toml`, an `init.lua` `require`, and Dockerfile `COPY` lines. The
  image stays non-root (uid/gid 1500), with no new packages, network or secrets.
- `bridge/src/`: a mailbox module on `sandboxRun`, plus plugin detection at
  child init.
- `bridge/test/`: fake-maki and fake-openshell mailbox emulation, and the
  live-sandbox upload.
- Environment images that replace `init.lua` must keep the `require`. A doc note
  covers this in `docs/`.
- Upstream references at the pin:
  https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/hooks/_index.md,
  https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/plugins/_index.md,
  https://github.com/tontinton/maki/blob/v0.6.4/maki-lua/src/api/util/command.rs.
