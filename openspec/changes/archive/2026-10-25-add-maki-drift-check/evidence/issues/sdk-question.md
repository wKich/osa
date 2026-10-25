# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: forward the question tool to the client

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** Under the SDK the question tool opens a window with no effect and returns a dismissal (plugins/question/question_form.lua v0.6.4 L598–L628; maki-lua/src/api/ui/mod.rs L749–L755); the wire has no question ask (src/sdk_mode.rs L1122–L1160).

**Ask:** A control_request carrying the questions and options, answered with the chosen labels, the way can_use_tool is answered.

**Blocks in maki-oss:** agent-questions; journey answer-agent-question.
