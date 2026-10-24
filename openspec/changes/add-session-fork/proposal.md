# Proposal

## Why

`fork-session-from-message` needs `POST /api/session/{sessionID}/fork`, which
the bridge answered from the spec (deferred). The TUI's fork dialog offers
"Full session" and each user message. The pinned Maki CLI continues a stored
session under a new id in SDK mode (`-r <id> --fork-session`,
`src/cli.rs` v0.6.4 L53–L63, L114–L117), which is the full-session fork; it
cannot cut a session's history at a message.

## What Changes

- `session.fork` without `before`: a new bridge session whose Maki child is
  spawned with `-r <parent's Maki session id> --fork-session`; its transcript
  is the parent's settled messages copied under the real projector's ids
  (`core/src/session/projector.ts` v2.0.32 L195–L229); its title is the
  parent's with the fork suffix (L51–L56); `fork` names the parent and a
  `through` boundary; `session.forked` (durable 2) announces it.
- With `before`: an unknown message is 404 `MessageNotFoundError`; a known one
  is 400 `InvalidRequestError` — the cut fork is a pin limit
  (`session-fork-at-message`). An empty session is 400 `empty_session`, as
  the real handler answers.
- Route `served-live`/reachable (feature `session-fork`).

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the fork requirement.

## Impact

`bridge/src/{bridge,maki,history}.ts`, `bridge/test/{session-fork,argv}.test.ts`,
statuses, journeys, evidence, the report. The forked child runs through the
same sandbox transport; no sandbox, egress, or credential change.
