# Proposal

## Why

`answer-mcp-form` cannot be scripted with waits alone. On the reference the
MCP tool call stays pending: OpenCode 2.0.32 creates the elicitation form on
the server but its TUI never presents it in a session. Its spinner keeps the
screen changing, so no idle wait settles, while the Maki side finishes at
once. A journey needs a fixed delay to compare both sides at the same point.

## What Changes

- A `pause(ms)` step waits a fixed time whatever the screen does.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement adds the pause step.

## Impact

`bridge/test/journeys/harness/{journey,driver}.ts` and the driver test. No
recorded journey uses it yet.
