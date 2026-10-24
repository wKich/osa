# Design

The checkpoint is the retained raw output rather than a serialized screen:
the client resets its terminal and replays it, which reproduces the screen
without a server-side emulator (the bridge runtime has no npm dependency).
The snapshot's `text` and `cursor` are read from the output's tail with
escapes removed — approximate, and unused by the pane. `persistentPty.read`
(screen rows for an agent tool) stays answered from the spec; no reachable
journey reads it. Session terminals are not handed off between bridge
processes (`handoff`/`shutdown` stay answered from the spec).

Remaining difference on `open-terminal-pane`: the prompt is the sandbox
shell's (`sandbox@<HOST>:~/journey-work$` live), where the reference's host
terminal runs the journey's `/bin/sh` — accepted, the terminal is the
sandbox's by design.
