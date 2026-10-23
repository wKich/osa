# Proposal

## Why

`mid-session-model-switch` was `degraded` with `blockedBy: pin`, but that
triage (from `add-compat-burndown`) is wrong. Maki v0.6.4 defines inbound
`control_request`/`set_model` (`src/sdk_mode.rs` L861–L874), resolves the spec
through its model policy (L883–L916), and acks success or error. OpenCode
v2.0.32's `POST /api/session/{id}/model` is "switch the model used by
subsequent provider turns" (vendored OpenAPI), and the TUI calls it (measured
in `bridge/test/captures/tui-last-requests.jsonl`). The iteration-4 triage
re-marks the row `capability`.

## What Changes

- The model route writes `set_model` with `<providerID>/<id>` (a bare id for
  the bridge's `maki` provider label) when the selection changes the reported
  model; re-posting the current model sends nothing.
- Bridge control requests are tracked by `request_id`: a success ack makes
  the selection the announced model and emits `model.updated`; an error ack
  is logged and changes nothing.
- A selection without `providerID` and `id` answers `400`
  `InvalidRequestError`.
- The scripted child resolves `set_model` like the pin (known providers or a
  bare id succeed, others are refused) and names the switched model on its
  assistant frames.
- `mid-session-model-switch` → `verified`, `blockedBy: none`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: "Accept mid-session model selection without retasking
  the child" is replaced by "Forward mid-session model selection to the Maki
  child".

## Impact

- Runtime: `bridge/src/bridge.ts` (`selectModel`, control acks),
  `bridge/src/maki.ts` (`setModel`, shared `control`),
  `bridge/src/translator.ts` (`announceModel`).
- Tests: `bridge/test/model-switch.test.ts` (rewritten),
  `bridge/test/fake-maki.ts`.
- Report data: `bridge/compat/statuses.json`, `docs/compatibility.md`.
- TUI-visible: the gated smoke (`make test-ui`) still passes; its boot-default
  post (`sample/sample`) equals the session's pre-announcement model and its
  later post equals the announced one, so neither sends `set_model`.
