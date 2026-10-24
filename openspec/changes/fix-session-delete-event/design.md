# Design

The frame is emitted while the session is still registered, so its envelope
carries the session location like every other session frame; the child is
killed first, so no later frame of that session follows the delete.
