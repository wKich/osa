# Draft upstream issue for tontinton/maki — not posted

**Title:** Headless SDK: set reasoning effort

**Context:** maki-oss runs Maki inside an OpenShell sandbox and drives it from
the OpenCode TUI through a bridge over `maki -p --input-format stream-json`.
Checked against v0.6.4 (the pin) and v0.6.5 (the latest release): the cited
files are unchanged in v0.6.5.

**Problem:** `set_model` takes a model spec only (src/sdk_mode.rs v0.6.4 L861–L906); `--effort`, `--thinking` and `--max-thinking-tokens` are accepted but ignored (src/cli.rs L163–L173, L181–L203).

**Ask:** Honor `--effort`/`--thinking` in SDK mode and accept an effort on `set_model` (or a `set_thinking` control).

**Blocks in maki-oss:** model-variants; journey switch-model-variant.
