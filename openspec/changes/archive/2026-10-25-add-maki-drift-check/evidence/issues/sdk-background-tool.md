# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: move a running tool call to the background

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** There is no request to detach a running call: the inbound controls are initialize, interrupt, set_permission_mode, set_model (src/sdk_mode.rs v0.6.4 L818–L880).

**Ask:** A control_request naming a running tool_use id that backgrounds it (as the TUI's ctrl+b does), with a stream-json event when the background call finishes.

**Blocks in maki-oss:** tool-background; journey background-blocking-tools.
