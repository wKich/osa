# Proposal

## Why

`view-usage-statistics` (`/stats`) showed `Jan 1970` and an empty chart on
the Maki side: `GET /api/experimental/session/stats` was answered from the
contract. The bridge is the server of record for its sessions, so it can
count them as OpenCode counts its stored messages.

## What Changes

- `bridge/src/session-stats.ts`: the aggregate of the pinned handler (core
  `session/stats.ts` v2.0.32 L84–L360) over the bridge's session histories.
  It counts root sessions and subagents, root prompts, and one step per
  assistant message with its tokens, cost and model. It also builds activity
  per day in the requested time zone with the longest streak, and tool calls
  by state (`summary`, or `detail` with a median duration). An inverted range
  is refused.
- The route becomes `served-live`/reachable, with feature `session-stats`.
- `view-usage-statistics`: recorded, `parity` offline and live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the stats requirement.

## Impact

`bridge/src/{bridge,history,session-stats}.ts`, a test, catalog rows. The
counts cover the sessions this bridge process has served; Maki's own store
is not read.
