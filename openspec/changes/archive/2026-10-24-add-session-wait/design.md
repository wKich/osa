# Design

`wait` polls the session every 50 ms until `translator.inTurn` is false and
no prompt is held, or the child is gone (a dead child has no loop to wait on).
The pin-blocked journeys keep the pinned TUI behavior on screen; the bridge
still answers their routes from the spec, and the report shows them `pin`.
