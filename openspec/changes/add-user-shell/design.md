# Design

The user's command crosses the same boundary as Maki's bash tool: the
sandbox. `exec 2>&1` merges the streams in order, as OpenCode's combined
capture does; output is capped at the 1 MiB page OpenCode reads back. The
notice is delivered as the preamble of the next prompt because the pinned
child has no synthetic-input wire: OpenCode admits it with `resume: false`,
so it reaches the model only with the next turn, which the preamble mirrors.
