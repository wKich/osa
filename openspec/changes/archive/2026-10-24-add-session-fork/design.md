# Design

Session creation is factored into `openSession`, shared by create and fork.
The copied history is the bridge's projection, so the reopened fork renders
exactly the parent's settled transcript; the Maki child gets the same
history from its own store through `--fork-session`. The fork keeps the
parent's first prompt so Maki's first-run title rule never replaces the
fork title.
