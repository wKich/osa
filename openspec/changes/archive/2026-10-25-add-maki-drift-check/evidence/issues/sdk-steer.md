# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: steer a running turn

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** Each stdin `user` goes to the session's input queue and is answered by a later run, never folded into the running one (src/sdk_mode.rs v0.6.4 L682–L702, L763).

**Ask:** A delivery flag on `user` (or a control) that injects the message into the running turn, as the TUI's mailbox does.

**Blocks in maki-oss:** mid-turn-steering.
