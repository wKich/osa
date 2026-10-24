# Proposal

## Why

`open-subagent-session` delegates to a subagent and opens it from the
composer's subagent picker. OpenCode runs a subagent as a child session —
`parentID`, the task's description as title, the subagent's agent — whose
transcript holds the subagent's prompt and reply, and the parent's subagent
tool part names it in `metadata.sessionID` (`core/src/tool/plugin/subagent.ts`
v2.0.32 L184–L215; `tui/src/routes/session/index.tsx` L3122–L3155). The
bridge rendered a Maki subagent's frames inline in the parent, so there was
nothing to open, and live the subagent's streamed reply leaked into the
parent: the pinned child streams a subagent's deltas unflagged
(`src/sdk_mode.rs` v0.6.4 L1022–L1050) and flags only buffered frames.

The same pass recorded `background-blocking-tools` as a pin limit: the
pinned SDK cannot detach a running call.

## What Changes

- A Maki `Task` call opens a child session (no Maki child of its own:
  its frames arrive through the parent's) announced with `session.created`;
  the subagent's prompt starts its turn; the frames flagged with the task's
  id, and the unflagged stream events while the task runs (except the task's
  own streamed block), feed the child; the task's result ends the child's
  turn. The task's tool part carries `metadata.sessionID`.
- `GET /api/session?parentID=<id>` lists a session's children,
  `parentID=null` the roots.
- Pin record: `background-blocking-tools` (`blockedBy: pin`), feature
  `tool-background`, route `POST /api/session/{sessionID}/background` linked.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: the subagent rendering requirement moves from
  inline parts to a child session.

## Impact

`bridge/src/{translator,bridge}.ts`, `bridge/test/session-subagent.test.ts`,
statuses, journeys, evidence, the report. No sandbox, egress, or credential
change.
