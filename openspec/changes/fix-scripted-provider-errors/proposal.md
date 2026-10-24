# Proposal

## Why

The first live runs of `see-failed-turn-error` and `see-provider-retry`
showed real Maki wording provider failures differently from the scripted
child added in `extend-journey-turns`: a 400 reads
`API error (400): <raw response body>` and a 503 retry reads
`Server error (503)`, where the child said `API error (<status>): <message>`
for both. The live verdict was worse than offline (`see-provider-retry`
broke, waiting for text real Maki never shows). Pinned source:
`maki-providers/src/error.rs` v0.6.4 keeps the body as the message
(L387–L412) and words retries by status (`retry_message`, L427–L440).

## What Changes

- The scripted child's `fail` turn reports the mock provider's JSON error
  body as the message, and a retry notice worded `Rate limited` (429),
  `Provider is overloaded` (529), or `Server error (<status>)` (5xx).
- Its test pins both wordings.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the failing-call scenario names the pinned wording.

## Impact

`bridge/test/fake-maki.ts`, `bridge/test/journeys/harness/fake-maki-script.test.ts`.
No bridge runtime change.
