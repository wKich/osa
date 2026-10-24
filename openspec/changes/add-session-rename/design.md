# Design

The title lives where the bridge already keeps it (add-session-title). The
real server's empty-title path calls its title generator; Maki's generator
is `generate_title` over the first prompt (`maki-storage/src/sessions.rs`
v0.6.4 L677–L695), so the bridge reapplies it. Maki's own session file is not
renamed: the SDK wire has no title control (`sdk_mode.rs` v0.6.4 control
subtypes L818–L880), and the TUI reads titles only from the bridge.
Permission rules: the real server stores a ruleset the agent evaluates; Maki
evaluates its own layered rules and the SDK offers no way to replace them, so
the bridge logs and ignores a `permissions` patch rather than claim it.
