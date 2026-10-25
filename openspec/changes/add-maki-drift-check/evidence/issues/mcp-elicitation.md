# Draft upstream issue for tontinton/maki — not posted

**Title:** MCP client: support elicitation and forward forms over the SDK

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** Maki's MCP client declares `"capabilities": {}` on initialize (maki-agent/src/mcp/protocol.rs v0.6.4 L60), so a conforming server never asks it for input, and stream-json has no message to carry a form (src/sdk_mode.rs L1122–L1160).

**Ask:** Declare `elicitation` (form mode), surface `elicitation/create` in the TUI, and forward it over stream-json as a control_request answered with the form's content.

**Blocks in maki-oss:** mcp-forms; journey answer-mcp-form.
