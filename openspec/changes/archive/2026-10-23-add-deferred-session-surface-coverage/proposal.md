# Proposal

## Why

The route lens still carries three session read routes as `deferred`:
`GET /api/session/{id}/message`, `/inbox`, and `/form`. Each is answered
today, but only from the synthesized spec set and only the form route appears
in a captured request log — nothing in the offline suite pins that these
surfaces stay empty. A synthesized list entry here is not cosmetic: the TUI
renders it as a phantom message, inbox item, or form that blocks the
transcript (`bridge/src/spec-answers.ts`, the empty-list rules). This is the
smallest remaining slice the coverage loop can prove without a runtime change.

The newest cross-map's unverified wire rows (interrupt, model switch,
steering, attachments, retry visibility, the SDK handshake, richer permission
vocabulary) all need bridge behavior that does not exist, so they stay
recorded; this change does not touch them.

## What Changes

- Add `bridge/test/deferred-session-surfaces.test.ts`: one spawned bridge and
  one live session, asserting that `GET /api/session/{id}/message`, `/inbox`,
  and `/form` answer `200` with a contract-valid empty `data` list and emit no
  event frame, and that each route answers `404 SessionNotFoundError` for an
  unknown session instead of an empty success.
- Add the `deferred-session-surface-contract` feature row to
  `bridge/compat/statuses.json` as `verified`, citing the test.
- Point the three route rows' evidence at the test while keeping their status
  `deferred` — the surfaces are still unimplemented; only the empty-answer
  behavior is now proven.
- Regenerate `docs/compatibility.md`.
- No bridge or translator runtime change: the empty-answer behavior is shipped;
  this change only pins it.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: adds one requirement that the session read surfaces
  the bridge cannot replay from Maki answer with empty, contract-valid lists
  and 404 an unknown session, so no synthesized row reaches the transcript.

## Impact

- Tests: `bridge/test/deferred-session-surfaces.test.ts` (new; reuses
  `bridge/test/lib/bridge.ts` and the scripted-child seam; no fixture file, so
  no provenance entry).
- Report data: `bridge/compat/statuses.json` (one added feature row, three
  route evidence paths), `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
