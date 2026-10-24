## ADDED Requirements

### Requirement: Reload the sandbox-backed location state
The bridge SHALL answer `POST /api/location/reload` with `204` after
re-reading the model catalog, the checkout's git state, its worktrees and its
skills from the sandbox.

#### Scenario: A changed catalog is picked up
- **WHEN** `maki models` lists a new model and the user runs `/reload`
- **THEN** the refetched model list names it
