# Proposal

## Why

Recording `reject-permission-with-reason` (the TUI asks for a reason only
when rejecting a subagent's ask: `tui/src/routes/session/permission.tsx`
v2.0.32 L248–L251) live showed defect `subagent-ask-in-parent-session`: the
bridge filed every `can_use_tool` under the parent session with the parent's
message as source, so the dialog fell back to `- rm -f probe.txt` and a
reject skipped the reason stage. Behind it sits a Maki limit: under the
pinned SDK a subagent's ask cannot be answered at all — the subagent waits
on its own answer channel, handed only to Maki's TUI (`maki-lua/src/api/
agent.rs` v0.6.4 L858–L867, L1478–L1486), while stream-json answers reach
the main agent's (`src/sdk_mode.rs` L483–L495, L633). Allowing or rejecting
live both left the run waiting.

## What Changes

- The translator records which child session each subagent tool call
  belongs to (from the routed stream block or flagged frame; a call not seen
  yet while a task runs is the running subagent's), and the bridge files the
  ask under that child with the child's message as source, answering through
  the parent's Maki process. Interrupting the parent settles its children's
  asks.
- The scripted child models a subagent's ask as the pinned SDK does: it is
  sent, and nothing but an interrupt ends the wait.
- `reject-permission-with-reason`: recorded (`broken` offline and live, the
  same), `blockedBy: "pin"` with the citation above; feature
  `subagent-permissions` (`degraded`, pin); defect `fixed`.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the subagent-ask requirement.

## Impact

`bridge/src/{bridge,translator}.ts`, `bridge/test/{fake-maki,subagent-permission.test}.ts`,
catalog rows. No egress, credential, or `--env` change.
