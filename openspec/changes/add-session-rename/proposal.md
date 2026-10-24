# Proposal

## Why

The `rename-session` journey breaks: the TUI's rename dialog submits
`PATCH /api/session/{sessionID}` (`session.update`), which the bridge answered
from the spec with no state, so the tab keeps the old title. The real handler
renames the session, regenerates a title for an empty one, and sets metadata
(`server/src/handlers/session.ts` v2.0.32 L259–L281).

## What Changes

- `PATCH /api/session/{sessionID}`: a non-empty `title` renames the session
  and emits `session.renamed`; an empty or null title regenerates Maki's
  title (its first-prompt rule); `metadata` is stored, returned on reads, and
  announced with `session.metadata.updated`. `permissions` are not applied:
  they are Maki's rule set, which the pinned SDK cannot change.
- A renamed session keeps its title when its first run ends.
- Route `PATCH /api/session/{sessionID}` becomes `served-live` (feature
  `session-rename`); `rename-session` is recorded.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the session update requirement.

## Impact

`bridge/src/bridge.ts`, `bridge/test/session-title.test.ts`, statuses,
journeys, journey evidence, the report. No sandbox, egress, or credential
change.
