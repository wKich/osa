## ADDED Requirements

### Requirement: Update a session's title and metadata
`PATCH /api/session/{sessionID}` SHALL answer 204 for a known session and 404
`SessionNotFoundError` otherwise. A non-empty `title` SHALL become the
session's title and SHALL be announced with `session.renamed`; an empty or
null `title` SHALL regenerate the title with Maki's first-prompt rule when the
session has a prompt. `metadata` SHALL be stored, returned by session reads,
and announced with `session.metadata.updated`. A renamed session SHALL keep
its title when its first run ends.

#### Scenario: The rename dialog renames the tab
- **WHEN** the user renames a session to `Renamed by journey`
- **THEN** the bridge emits `session.renamed` with that title and the tab
  shows it

#### Scenario: An empty title regenerates Maki's
- **WHEN** a session whose first prompt was `first prompt text` is patched
  with `title: null`
- **THEN** its title becomes `first prompt text`
