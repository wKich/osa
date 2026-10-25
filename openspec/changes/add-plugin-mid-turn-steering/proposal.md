# Proposal

## Why

OpenCode steers a prompt sent mid-turn into the running turn. Under the bridge
it is queued instead and reported as `queue`, because the pinned SDK sends each
stdin `user` to the input queue, answered by its own later run
(`src/sdk_mode.rs` v0.6.4 L682–L702, L763). So `mid-turn-steering` is `degraded`.
A `tool.*.output` layer can append text to the next tool result the model reads
mid-turn (https://github.com/tontinton/maki/blob/v0.6.4/site/docs/content/hooks/_index.md,
"Tool slots").

## What Changes

- For a `steer` delivery while a turn runs, the bridge writes the prompt to the
  mailbox and does not send it on stdin.
- The `maki_bridge` plugin's `tool.*.output` layer drains the session's pending
  steer messages and appends them to the result, marked as the user's words, so
  the model reads them within the running turn.
- At `TurnEnd`, any steer text that was not delivered (the turn made no further
  tool call) is handed back. The bridge then sends it as a queued prompt and
  reports `queue`, today's behavior, so nothing is lost.
- The bridge reports `steer` only when the plugin confirmed delivery, and the
  inbox frames say which happened.
- `mid-turn-steering` is re-triaged against the queue/steer journeys.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `maki-bridge-plugin`: adds the steer drain on tool output and the hand-back at
  turn end.
- `opencode-tui-bridge`: a steer prompt is delivered into the running turn when
  the plugin can, and is queued otherwise.

## Impact

- Depends on `add-maki-bridge-plugin`.
- `bridge/src/` prompt admission and inbox frames; plugin layer and `TurnEnd`
  autocmd; `queue-prompt-while-running` and `manage-queued-prompts` journeys may
  change verdict; `statuses.json`.
- Risk: the transcript shows the steer text where OpenCode shows it, but the
  model sees it inside a tool result. The design records how the transcript
  renders it.
