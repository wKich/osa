# Design

## Context

See proposal.md — Why. The shipped path is small and already load-bearing:

- `synthesize` forces the deferred list surfaces empty after sampling the
  pinned schema: `/(form|permission|terminal)$/` and `/(message|inbox)$/`
  both get `data: []` (`bridge/src/spec-answers.ts:146-150`).
- `sessionRoute` checks the session id before dispatching any `rest` route, so
  an unknown session takes the `SessionNotFoundError` branch
  (`bridge/src/bridge.ts:174`, `:337-367`).
- The black-box harness (`startBridge()` + `fake-maki.ts`) already drives
  these routes without a real child.

The route rows for `GET /api/session/{id}/message`, `/inbox`, and `/form` are
`deferred` in `bridge/compat/statuses.json`; only the form route's empty list
appears in a captured request log (`bridge/test/fixtures/bridge-requests.jsonl`).

## Goals / Non-Goals

**Goals:**

- Prove the empty-answer and unknown-session halves of the deferred read
  surfaces with one offline test file.
- Keep the route status honest (`deferred`) while making its evidence a test.

**Non-Goals:**

- No replay, inbox bodies, or fork semantics: those need runtime state the
  bridge does not keep. The `Message replay / resume` feature row stays
  `unverified`.
- No new fixture: the test needs no wire input, so no provenance entry.
- No runtime change: the behavior is shipped.

## Decisions

1. **Assert `data` is empty, not the whole body.** The message route also
   carries a synthesized paging cursor; pinning the cursor would freeze an
   opaque value the TUI does not use when the page is empty. The meaningful
   claim is "no row".
2. **Validate each body against the vendored OpenAPI 2.0.32** with the same
   `validateBody` helper the contract test uses, so an empty answer that
   drifts from the pinned shape fails here rather than only in a capture.
3. **Snapshot the emitted frame count around the three reads, after the
   child's model announcement.** These are pure reads; an event emitted here
   would mean a route is driving the transcript. Waiting for the announcement
   keeps the asynchronous `model.updated` from landing between the snapshots.
4. **A new feature row (`deferred-session-surface-contract`), not a status
   flip.** The route rows stay `deferred` because the surfaces are still not
   implemented; the new row claims only the verified empty-answer contract.
   Alternative: flip the route rows to `served-faked` — rejected because it
   would claim the surface is answered, not merely kept empty.
5. **The test uses its own bridge.** The reads do not need a turn, but a
   separate bridge keeps the shared session tests' turn counters untouched.

## Risks / Trade-offs

- [The TUI later depends on a cursor or a non-empty inbox for a real feature]
  → This test only requires `data` empty; adding real content is a deliberate
  behavior change with its own spec delta.
- [Route evidence moving from source to a test hides who answers the route]
  → The test exercises the shipped entrypoint, and the row stays `deferred`,
  so the report still says the surface is unimplemented.
- [Statuses/report drift] → `make compat` regenerates `docs/compatibility.md`
  and fails on a diff; part of the task gate.
