## ADDED Requirements

### Requirement: List Maki's builtin plugins as the server's plugins
The bridge SHALL answer `GET /api/plugin` with Maki's default builtin
plugins at the pinned version, each with a `builtin` source, the server
feature and an active state.

#### Scenario: Internal plugins include the server's
- **WHEN** the user opens `/plugins` and shows internal plugins
- **THEN** the list has a Server section, as the reference does
