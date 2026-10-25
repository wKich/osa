# Proposal

## Why

A subagent's permission ask shows in its child session but cannot be answered.
Under the pinned SDK the subagent waits on an answer channel that only Maki's TUI
receives (`maki-lua/src/api/agent.rs` v0.6.4 L858–L867, L1478–L1486), so
`subagent-permissions` is `degraded` and `reject-permission-with-reason` is
`broken`. A `permission.prompt` layer fires for a subagent's call too: `ctx:task_id()`
names it, and it may answer `allow`, or `deny` with `guidance`
(https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/hooks/_index.md,
"Permission prompt").

## What Changes

- The `maki_bridge` plugin's `permission.prompt` layer handles calls whose
  `ctx:task_id()` is a subagent. It writes the request (tool, input, scopes,
  task id) to the mailbox and polls for the answer, staying inside the hook's
  60-second window.
- The bridge polls the mailbox while a subagent runs, shows the request as the
  child session's permission (the same frames the attributed ask uses today), and
  writes the user's reply back: once, always (session-scoped, as for the main
  agent), or reject with an optional reason that becomes `guidance`.
- If no answer comes before the window closes, the layer answers `deny` with a
  guidance line saying the user did not answer. A run never hangs on an
  unanswerable prompt.
- `subagent-permissions` and `reject-permission-with-reason` are re-recorded.
  The target is `parity`. Any remaining difference is triaged as a defect or an
  accepted diff.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `maki-bridge-plugin`: adds the subagent permission relay over the mailbox.
- `opencode-tui-bridge`: a subagent's permission ask becomes answerable, and a
  reject reason reaches the subagent as guidance.

## Impact

- Depends on `add-maki-bridge-plugin`.
- `bridge/src/` subagent permission path and the mailbox poller (cadence and
  cost of `openshell sandbox exec` per poll); plugin layer; fake child emulation;
  two permission-area journeys; `statuses.json`.
- Risk: polling latency against the 60-second window. The design picks the poll
  interval and the timeout behavior.
