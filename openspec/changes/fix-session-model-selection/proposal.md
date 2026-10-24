# Proposal

## Why

Recording `switch-model` found defect `model-choice-not-durable`. After the
user picked the second model and sent a prompt, the reply ran on it, but the
composer fell back to the first model. Two causes:

- The TUI creates the session on its selection and then re-posts that model
  (`tui/src/component/prompt/index.tsx` v2.0.32 L1233–L1241, L1283–L1286).
  The bridge started every Maki child on its configured `MAKI_MODEL`, so the
  re-post became a real switch.
- A switch was reported only as `model.updated`. The TUI reads the session's
  model from the durable `session.model.selected` (client `solid/data.ts`
  L705–L716; `context/local.tsx` L256–L264, L344), which the bridge never
  emitted. So the session kept its old model and the TUI dropped its draft.

## What Changes

- A session's Maki child starts on the model the session was created with,
  when Maki's catalog lists it; otherwise on the configured model.
- An acked `set_model` emits `session.model.selected` (durable, with
  `previous`), and the history gains a `model-switched` row, as the real
  server records it (core `session/message-updater.ts` v2.0.32 L105–L117).
- The scripted child accepts models from its catalog.
- `switch-model`: recorded offline and live, at `parity`. Accepted: the
  variant step OpenCode adds (Maki has no effort control over the SDK) and
  the title.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: the model-switch requirement.

## Impact

`bridge/src/{bridge,history}.ts`, `bridge/test/{fake-maki,model-switch.test}.ts`,
catalog rows, and one defect (`fixed`).
