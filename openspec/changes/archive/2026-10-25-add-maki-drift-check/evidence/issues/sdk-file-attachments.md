# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: non-image attachments on `user`

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** The inbound `user` decodes only text and image blocks (src/sdk_mode.rs v0.6.4 L786–L816); a PDF or other document block is dropped.

**Ask:** Accept `document` content blocks (base64 PDF and text) as the providers that support them do.

**Blocks in maki-oss:** prompt-attachments.
