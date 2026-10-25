# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: an `always` answer saved for the project

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** The permission answer decoder knows allow-once, allow-session and deny (src/sdk_mode.rs v0.6.4 L918–L927); there is no answer that persists a rule the way the TUI's always-allow writes permissions.toml.

**Ask:** An answer variant (e.g. `updatedPermissions` with a `destination` of `projectSettings`) that saves the generalized rule like the TUI does.

**Blocks in maki-oss:** permission-reask.
