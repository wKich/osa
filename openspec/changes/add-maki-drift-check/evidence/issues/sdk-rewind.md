# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: rewind (and fork) a session at an earlier message

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** The SDK offers no rewind request (src/sdk_mode.rs v0.6.4 L818–L880), and `--fork-session` copies the whole loaded session (src/cli.rs L114–L117). The TUI's rewind picker (maki-ui/src/components/rewind_picker.rs) has no headless counterpart.

**Ask:** A control_request that rewinds the session to a given message (dropping later history, optionally restoring files) and a fork variant that cuts at a message, each acknowledged with the resulting message ids.

**Blocks in maki-oss:** session-revert, session-fork-at-message; journeys undo-previous-message, redo-reverted-message.
