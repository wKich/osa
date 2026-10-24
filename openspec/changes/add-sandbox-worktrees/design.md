# Design

A worktree name is restricted to `[A-Za-z0-9._-]`, so it cannot climb out of
the data directory. The start command OpenCode runs after creating a
worktree (`commands.start`) has no project config behind it here and is not
run.
