# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: request compaction and forward compaction events

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** Under `-p --input-format stream-json` there is no way to ask for a compaction: the inbound control subtypes are `initialize`, `interrupt`, `set_permission_mode` and `set_model` (src/sdk_mode.rs v0.6.4 L818–L880), and `AutoCompacting`/`CompactionDone` are dropped from the wire (L1057–L1058).

**Ask:** A `compact` control_request (optionally with instructions) that runs the same compaction `/compact` runs in the TUI, and stream-json `system` frames for compaction start and end with the summary.

**Blocks in maki-oss:** session-compaction; journey compact-session.
