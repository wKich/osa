# Proposal

## Why

OpenCode's `/undo` reverts the last exchange's messages and its file changes.
Under the bridge neither happens: the pinned SDK has no rewind (`src/sdk_mode.rs`
v0.6.4 L818–L880; rewind is `maki-ui/src/app/session.rs` L455), so
`session-revert` is `degraded`. Plugins cannot edit history. They can see every
file write before it happens through `tool.<name>.input` layers
(https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/hooks/_index.md),
which is enough to restore files.

## What Changes

- The `maki_bridge` plugin installs input layers on Maki's file-writing tools
  (`write`, `edit` and its optional `multiedit` and `insert_lines`, per the
  `plugins.edit` options in the configuration reference; changes made through
  `bash` are out of scope). Before each call it saves the
  target's prior content, or its absence, to a per-turn snapshot in the mailbox.
- On `/undo` (`revert` routes), the bridge restores the last turn's snapshot in
  the sandbox and reports the reverted files as OpenCode does. `/redo` re-applies
  the saved post-turn content.
- Partial by design: the transcript and Maki's history keep the exchange, so the
  model still remembers it. That part stays pin-blocked with its current
  citation.
- `session-revert` stays `degraded` with a narrower title. `undo-previous-message`
  and `redo-reverted-message` are re-recorded, with any screen change triaged.
- Decision for the design: whether a file-only undo is worth the extra surface
  when the journeys still diverge on the transcript. The change may close as
  "not worth it" with that reason recorded.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `maki-bridge-plugin`: adds per-turn file snapshots.
- `opencode-tui-bridge`: revert and restore undo and redo the last turn's file
  changes.

## Impact

- Depends on `add-maki-bridge-plugin`.
- Plugin layers; `bridge/src/` revert routes (`revert/stage` leaves
  `served-faked`); snapshot size limits in the sandbox state dir; two session
  journeys; `statuses.json`.
