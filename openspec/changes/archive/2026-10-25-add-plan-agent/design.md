# Design

The mode control is written before the next user frame on the same stdin, and
Maki reads the mode when that frame arrives, so the turn runs in it. The
selection is reported at once (as OpenCode does) and rolled back if Maki
refuses the mode; the two pinned modes are always valid.
