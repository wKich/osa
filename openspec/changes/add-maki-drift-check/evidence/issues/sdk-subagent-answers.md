# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: answer a subagent's permission ask

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** A subagent waits on its own answer channel, whose sender only the TUI receives (maki-lua/src/api/agent.rs v0.6.4 L858–L867, L1478–L1486), while stream-json answers go to the main agent's channel (src/sdk_mode.rs L483–L495, L633). Allowing or rejecting a subagent's can_use_tool leaves the run waiting until interrupted.

**Ask:** Route a control_response for a subagent's request id to that subagent's answer channel.

**Blocks in maki-oss:** subagent-permissions; journey reject-permission-with-reason.
