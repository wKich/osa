# Proposal

## Why

`ask-side-question` (`/btw`) calls `POST /api/session/{sessionID}/generate`,
"transient text from the current session context without mutating session
history" (`server/src/handlers/session.ts` v2.0.32 L596–L609), which the
bridge answered with a synthesized `sample`. The pinned Maki SDK has no such
request, but its CLI forks a stored session in SDK mode
(`-r <id> --fork-session`, `src/cli.rs` v0.6.4 L53–L63, L114–L117) and deletes
a stored session (`maki session delete <id> --force`, L303–L321).

## What Changes

- `session.generate` spawns a throwaway child forked from the session's
  stored Maki session, sends the prompt, denies every tool ask (generate runs
  no tool loop), answers `{data: {text}}` from the reply, kills the child, and
  deletes the fork from Maki's store. Failures answer 503
  `ServiceUnavailableError`; an unknown session 404; an empty prompt 400.
- The session's own frames and history are untouched.
- Route `served-live`/reachable (feature `session-generate`); the scripted
  child names a forked run's session, and the scripted sandbox's `maki`
  records the delete.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the side-question requirement.

## Impact

`bridge/src/bridge.ts`, `bridge/test/session-generate.test.ts`,
`bridge/test/fake-maki.ts`, `bridge/test/sandbox-bin/maki`, statuses,
journeys, evidence, the report. The throwaway child runs through the same
sandbox transport; no sandbox, egress, or credential change.
