## ADDED Requirements

### Requirement: Manage the project's worktrees in the sandbox
The bridge SHALL list, create, remove and refresh the project's git
worktrees in the sandbox, creating each with `git worktree add --detach`
under the sandbox user's data directory, and SHALL open a session in, or move
a session into, one of them.

#### Scenario: A new worktree gets its own session
- **WHEN** the user creates the worktree `feature-x` from `/worktrees`
- **THEN** the TUI opens a new session whose footer names
  `<WORKTREES>/feature-x`, and `git worktree list` in the sandbox shows it

#### Scenario: An escaping name is refused
- **WHEN** a create names `../escape`
- **THEN** the route answers `400` with a `WorktreeError`
