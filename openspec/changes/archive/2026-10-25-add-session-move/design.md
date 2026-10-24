# Design

Maki's session store is global with each session's cwd as a field
(`maki-storage/src/sessions.rs` v0.6.4), so `-r` resumes the session from the
new directory, and Maki tells its model the new working directory itself
(`maki-agent/src/agent/frame.rs` L269–L271). Destinations outside the
sandbox workdir are refused: the bridge serves one project.

Accepted on the journey: the title, `Exit code: 0`, and OpenCode's
"Instructions updated: core/environment" notice.
