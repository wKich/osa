# Proposal

## Why

The TUI's "Allow always" says the choice is saved for the project, but under
the bridge it lasts for the Maki session only. The pinned SDK decodes an
`updatedPermissions` allow as `AllowSession` and has no project or global answer
(`src/sdk_mode.rs` v0.6.4 L918–L927), so `permission-reask` stays `degraded`.
A `permission.prompt` hook can answer before the prompt shows, which also works
under SDK mode (https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/hooks/_index.md,
"Permission prompt").

## What Changes

- On an `always` reply, the bridge records the call's scopes (tool plus the
  pattern the prompt asked about) in a per-project allow-list, written to the
  plugin mailbox through `openshell sandbox exec`. It still answers the
  `can_use_tool` request with today's session allow.
- The `maki_bridge` plugin installs a `permission.prompt` layer. The layer reads
  the allow-list and answers `{ decision = "allow" }` for an exact scope match,
  so a later session in the same project is not asked again. Anything else falls
  through to the prompt.
- The allow-list never widens a rule: no glob broadening, deny rules still win,
  and escalated `ask` calls never reach the layer (hooks guide).
- `permission-reask` moves from `degraded` to `verified`, with a journey that
  allows always in one session and is not asked in the next.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `maki-bridge-plugin`: adds the persisted allow-list and its
  `permission.prompt` layer.
- `opencode-tui-bridge`: an `always` reply persists for the project, as the TUI
  wording promises.

## Impact

- Depends on `add-maki-bridge-plugin`.
- `bridge/src/` permission reply path; plugin `permission.prompt` layer;
  `bridge/compat/statuses.json` (`permission-reask`); one new or extended journey
  in the permission area.
- The allow-list lives in the sandbox state dir, never on the host, and holds no
  secrets.
