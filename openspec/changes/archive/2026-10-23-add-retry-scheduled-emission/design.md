# Design

## Context

See `proposal.md` — Why. Two pinned facts decide the shape:

- Maki emits `system{subtype:"api_retry", attempt, retry_delay_ms, error}`
  during a turn (`src/sdk_mode.rs` v0.6.4 L1081). `error` is a plain string
  and the fixture `bridge/test/fixtures/maki-retry.jsonl` already records two
  such frames (provenance `mixed`: source-derived retry frames spliced into a
  captured turn).
- OpenCode pins `RetryScheduled` as `session.retry.scheduled`, durable with
  `aggregate: "sessionID", version: 1`, schema
  `{sessionID, assistantMessageID, attempt: PositiveInt, at: NonNegativeInt,
  error: SessionError.Error}` where `SessionError.Error` is
  `{type, message, status?, response?}`
  (https://github.com/sst/opencode/blob/v2.0.32/packages/schema/src/session-event.ts,
  https://github.com/sst/opencode/blob/v2.0.32/packages/schema/src/session-error.ts).

`bridge/src/translator.ts:118` currently accepts `system.init` and lets every
other `system` subtype fall out of the switch; the bridge's `emit` stamps
`sessionID`, `assistantMessageID`, and the durable envelope
(`bridge/src/bridge.ts:78`).

## Goals / Non-Goals

**Goals:**

- One retry frame produces exactly one pinned retry event, in arrival order,
  inside the open turn.
- The turn's parts and terminal status are unchanged by retry frames.
- The existing mixed fixture and provenance carry the evidence; no new
  fixture or scripted-child knob.

**Non-Goals:**

- TUI-level rendering of the retry event (not measured; this change pins the
  emission only).
- Using `retry_delay_ms` (Maki's schedule hint) or `session.retry`-adjacent
  events (`session.step.failed`, compaction) the bridge does not emit.
- Any change to failing-turn mapping or error text for terminal failures.

## Decisions

1. **Map in `Translator`, not the bridge.** The translator is the wire→event
   boundary and the golden harness replays it directly; emission there is the
   only place a translation can be pinned offline without a live child.
   Alternative: intercept `system` frames in `onMakiFrame` — would duplicate
   the turn-id/envelope logic and escape the golden replay.

2. **Emit only while a turn is open.** `session.retry.scheduled` requires
   `assistantMessageID`; a retry outside a turn has no assistant message to
   name and cannot happen on Maki's wire (retries are provider calls inside a
   turn). Such a frame stays silently tolerated, which keeps the event
   schema-valid instead of emitting an empty id.

3. **Field mapping.** `attempt` is the frame's positive integer (fall back to
   `1` only if the child sends something the pin's `PositiveInt` rejects);
   `at` is the bridge's `Date.now()` (the pinned field is epoch
   milliseconds, not the child's `retry_delay_ms`); `error` wraps the child's
   string as `{type: "Error", message}` — the same shape the translator
   already uses for `session.tool.failed` and `session.execution.failed`.
   `sessionID` and `assistantMessageID` come from the existing `emit` helper.

4. **Durable version 1**, matching the pin's `options` block, added to
   `DURABLE_VERSION` (`translator.ts:32`) so the event reaches the SSE frame
   with `durable.aggregateID = sessionID` like the other durable events.

5. **Golden: extend the retry fixture's projection, keep the equality test.**
   Add `maki-retry` to the `FIXTURES` list so `golden/maki-retry.json` pins
   the two retry frames in context, and keep the "undisturbed transcript"
   test by comparing the same projection with `session.retry.scheduled`
   filtered out against `golden/maki-plain.json`. The replay harness must
   admit the turn on the first retry frame as well (`projection.ts:82`),
   because live the turn opens at prompt admission before the child is
   written to. `at` joins the projection's `STRIP` set like the other
   timestamps. Alternative: a separate spawned-bridge test would need a new
   `fake-maki.ts` retry knob and would duplicate what the golden already
   proves.

## Risks / Trade-offs

- **The TUI may ignore the event.** The row claims emission, not rendering;
  a live TUI capture would be needed to claim the status line shows retries.
  Recorded as a non-goal.
- **`at` is bridge-local time.** It is a non-negative epoch millisecond as the
  pin requires, but it names when the bridge saw the retry, not the
  provider's schedule. The child's `retry_delay_ms` remains unused.
- **Pin drift on the event schema.** The vendored OpenAPI does not carry SSE
  event envelopes, so `make compat-drift` cannot catch a changed
  `RetryScheduled`; the version and field names are pinned by this test and
  the source link above.
- **Malformed `attempt` is normalized, not rejected.** A non-positive or
  non-integer attempt becomes `1`, preserving a schema-valid event rather
  than failing the turn for a cosmetic field.

## Migration Plan

None: additive event emission, no persistence or route change. Rollback is
reverting the translator branch and the regenerated report.
