# Proposal

## Why

Recording `manage-queued-prompts` wrote
`DELETE /api/session/{sessionID}/inbox/msg_…` to the journey request log:
the harness normalizes `ses_` and `per_` path ids but not message ids, so a
route that names a message (`inbox/{inboxID}`, `message/{messageID}`) entered
the measured route set as a literal path, and the measured-route gate failed
on a route that is not in the contract.

## What Changes

- Journey request logs name `inbox/msg_…` and `message/msg_…` path segments
  `{inboxID}` and `{messageID}`, the pinned contract's parameter names.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the reproducibility requirement names the id
  normalization of request logs.

## Impact

`bridge/test/journeys/harness/record.ts` and its test. No bridge runtime
change; committed logs carry no message-id path yet.
