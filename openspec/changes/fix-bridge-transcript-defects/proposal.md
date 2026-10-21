# Proposal

## Why

This is iteration 1 of the polish loop agreed for the OpenCode TUI bridge:
discover features on both protocol sides, record them, test them, check
compatibility, record bugs, fix, repeat. The loop machinery landed with
`add-bridge-verification` (offline suite, generated `docs/compatibility.md`,
defect inventory, scripted discovery). A first discovery run against the
current build confirms exactly two open defects — user prompts rendering
after the assistant responses they caused, and a synthesized model name on
the status line — and the compatibility table's feature lens currently lists
only the bridge behaviors already under test, not the two protocol surfaces
they sit between. Maki's SDK wire (v0.6.4) and OpenCode's server contract
(2.0.32, 119 routes of which the TUI's measured 33 are served) have never
been inventoried side by side, so nothing says which capabilities exist,
which are covered, and which are simply undiscovered.

## What Changes

- Record the two-sided feature inventory as change evidence: the Maki SDK
  wire surface at v0.6.4 (outbound `system`/`assistant`/`user`/
  `stream_event`/`result`, inbound `user`/`control_request`/
  `control_response`/`control_cancel_request`, control subtypes `initialize`
  and `can_use_tool`, `assistant.model` and `parent_tool_use_id` fields, SDK
  session flags) and the OpenCode surface (all 119 vendored routes grouped by
  TUI-measured vs contract-only, plus the interaction features the TUI
  exposes), with a cross-map that assigns every entry a coverage status and
  feeds new rows into `bridge/compat/statuses.json`.
- Fix `message-order-inversion`: the bridge represents each user prompt in
  the transcript before the assistant output it caused (the first step of
  which is establishing the exact user-message event shape the real server
  emits, from the pinned contract and the captured TUI run).
- Fix `synthesized-model-name`: session events, the model list, and the
  status line carry the model the Maki child actually announced
  (`system.init.model`, `assistant.model`) instead of values synthesized
  from the pinned spec.
- Close both inventory entries: expected-failure markers drop, goldens flip
  to the corrected expectations, `bridge/compat/statuses.json` rows move to
  `verified`, `docs/compatibility.md` regenerates, and a re-run of the
  scripted discovery pass reports zero open defects.

Explicitly out of scope for this iteration (next loop iterations): the
`stream-deltas` unverified row, `permission-reask` degradation, interrupt/
cancel round trip, subagent transcript nesting, message replay
(`GET /api/session/{id}/message`), model/agent switching mid-session, and
every other cross-map entry this iteration only records.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-tui-bridge`: two MODIFIED requirements with added scenarios —
  the transcript requirement gains prompt-before-response ordering and the
  model-identity requirement (folded into the boot/config surface
  requirement) gains "the reported model is the one the Maki child
  announced". No existing scenario changes meaning.

## Impact

- **Code**: `bridge/src/bridge.ts` and `bridge/src/translator.ts` (prompt
  admission emits the user-message frame; model identity flows from child
  frames to `/api/model`, session state, and `session.step.started`);
  `bridge/src/spec-answers.ts` loses its synthesized model default on live
  paths.
- **Tests/data**: `bridge/test/golden/*` defect goldens flip from
  expected-failure to verified; `bridge/defects.json` entries close;
  `bridge/compat/statuses.json` gains the cross-map's new feature rows
  (unverified/deferred with evidence links into this change's evidence) and
  flips the two fixed rows; `docs/compatibility.md` regenerates.
- **Evidence** (this change): `evidence/maki-sdk-wire-features.md`,
  `evidence/opencode-tui-features.md`, `evidence/cross-map.md`, and the
  discovery-pass output that deduped the two defects.
- **Upstream coupling**: the model field is verified against Maki v0.6.4
  source (`src/sdk_mode.rs`: `system.init`, `assistant.model`) and the
  user-message event shape against the vendored OpenAPI 2.0.32 and
  `evidence/tui-run.typescript`; if the event shape cannot be established
  from those, the ordering task records what is missing instead of guessing.
