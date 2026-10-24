# Design

Only the interrupt path changes: a failed run that the TUI did not interrupt
keeps `session.step.ended` with `finish: "error"` until the failed-turn
journey pins its shape. No usage rides on the failed step, as OpenCode only
attaches usage when it has both cost and tokens.
