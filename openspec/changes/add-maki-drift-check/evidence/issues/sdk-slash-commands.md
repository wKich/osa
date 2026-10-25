# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: list and run slash commands

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** SDK mode announces `slash_commands: []` (src/sdk_mode.rs v0.6.4 L624) and `SdkParams` (L542–L557) has no commands; custom commands cannot be listed or run headless.

**Ask:** Announce the session's commands (builtin and plugin) on `system.init` and accept a command invocation on stdin.

**Blocks in maki-oss:** slash-commands.
