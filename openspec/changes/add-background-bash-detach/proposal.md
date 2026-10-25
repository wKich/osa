# Proposal

## Why

ctrl+b moves a running shell call to the background in OpenCode. Under the
bridge it cannot: the pinned SDK has no request to detach a running call
(`src/sdk_mode.rs` v0.6.4 L818–L880), so `tool-background` is `degraded` and
`background-blocking-tools` is `broken`. Maki's `bash` tool is itself a Lua
plugin (`plugins/bash/init.lua`). Plugins can run named background jobs
(`maki.fn.jobstart`, `jobwait`, `jobattach`), and those survive the call until
the session ends
(https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/lua-api/_index.md).

## What Changes

- The `maki_bridge` plugin provides a `bash` tool with the built-in's schema and
  output. It runs the command as a session-owned job and waits for either the
  job's exit or a detach signal in the mailbox.
- On the TUI's background request (`POST /api/session/{id}/background`), the
  bridge writes the detach signal for the running call. The tool then returns at
  once with a result naming the job, and the job keeps running.
- The bridge reports the call as moved to the background in OpenCode's frames.
  A later job exit is surfaced through the job's own output, which the shell
  journey reads.
- The image's `init.lua` turns off the bundled tool (`plugins.bash = { enabled = false }`,
  https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/configuration/_index.md)
  and the plugin registers `bash` in its place. If the plugin is absent, the
  bundled `bash` stays on, so the image never loses its shell tool.
- `tool-background` and `background-blocking-tools` are re-recorded.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `maki-bridge-plugin`: adds the detachable `bash` tool and the detach signal.
- `opencode-tui-bridge`: `POST /api/session/{id}/background` detaches a running
  shell call instead of being answered from the spec.

## Impact

- Depends on `add-maki-bridge-plugin`.
- Plugin `bash` replacement, with parity tests against the built-in's output
  format; `bridge/src/` background route (moves from `served-faked` to
  `served-live`); fake child emulation; `background-blocking-tools` journey;
  `statuses.json`.
- Risk: drifting from the built-in `bash` on Maki updates. `make maki-drift`
  gains a check that the built-in's schema matches the replacement.
