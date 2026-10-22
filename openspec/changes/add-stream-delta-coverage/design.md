# Design

## Context

`Translator.handleStreamEvent` (`bridge/src/translator.ts`) implements the
`stream_event` enhancement: the three 1:1 delta mappings from mapping-table
row 4 (`thinking_delta` → `session.reasoning.delta`, `text_delta` →
`session.text.delta`, `input_json_delta` → `session.tool.input.delta`),
part lifecycle frames from `content_block_start`/`content_block_stop`, and
the dedupe that keeps the buffered `assistant` message from re-emitting a
part the stream already rendered. Nothing pins any of it. The golden
harness (`bridge/test/lib/projection.ts`) replays recorded `*.jsonl`
fixtures through the shipped Translator and already routes `stream_event`
frames to it. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Make "streamed deltas translate into part delta frames, once" an
  executable claim: one fixture, one committed golden, one statuses row
  flip.
- Keep `make test-bridge` fully offline.

**Non-Goals:**
- No translator or bridge runtime changes (the behavior exists; this
  change only pins it).
- No claim about the real wire envelope: the fixture uses the
  sdk_mode-derived spelling the translator's primary branch accepts, and
  the row stays `degraded` until a live streaming capture exists.
- Control-plane rows (interrupt, model switch, steering, sdk handshake)
  and `subagent-nesting` stay as recorded; covering them means building
  runtime behavior, not coverage.

## Decisions

1. **The row flips to `degraded`, not `verified`.** The report vocabulary
   defines `degraded` as "works, with a limitation recorded in the
   evidence"; the limitation is that `stream_event` envelope spellings are
   sdk_mode-string-derived guesses, never captured from a streaming
   provider (`add-wire-tolerance-coverage` design recorded this exact
   reason the row could not be honestly `verified`). The fixture proves the
   translation behavior against a recorded-shape frame; the wire shape
   itself stays open, and the limitation is stated in the test that is the
   row's evidence.
2. **One fixture, two turns.** Turn 1 streams thinking + text and replays
   the buffered `maki-plain` assistant afterward: pins incremental deltas
   (split text) *and* the no-duplication dedupe. Turn 2 streams a
   `tool_use` input (`input_json_delta` split so the concatenation equals
   the buffered `JSON.stringify(input)` byte-for-byte) and then replays
   `maki-tool`'s buffered assistant + tool_result: pins
   `session.tool.input.delta` and proves streamed and buffered parts coexist
   in one turn without duplicated `tool.input.*` frames. Both turns in one
   fixture keeps a single golden that shows the Q-A-A ordering across turns.
3. **`message_start`/`message_stop` frames are in the fixture on purpose**:
   the translator's default branch must drop them, and the golden shows
   they emit nothing (tolerance of the named-but-unrendered sdk_mode
   variants).
4. **The fixture's buffered frames are copied verbatim from
   `maki-plain.jsonl` / `maki-tool.jsonl`**, not rewritten: the committed
   goldens for those fixtures then act as a cross-check that the streamed
   prefix changed only the delta frames.
5. **Turn admission moves to the first part-bearing frame** (harness only,
   `projection.ts`): live, the bridge opens the turn at prompt admission,
   before the child is written anything, so streamed part frames follow
   `session.step.started`. The harness previously admitted a turn only at
   the buffered `assistant` frame, which would put streamed deltas *before*
   the turn boundary frames — an artifact of the harness, not the bridge.
   `assistant` and `stream_event` now share the admission branch.
6. **Statuses evidence points at the test that asserts it**
   (`bridge/test/golden.test.ts`), where the limitation from decision 1 is
   recorded in a comment on the new test; `crosscheck.test.ts` requires
   test/fixture paths for `verified` rows and accepts this row either way.
   Because the evidence lives under `bridge/test/`, archiving this change
   moves nothing the row links to (no archive-path note needed).

## Risks / Trade-offs

- [The fixture's envelope spelling differs from the real wire] → That is
  why the row is `degraded`: the buffered path is the floor and unknown
  envelope spellings degrade to buffering, not a broken transcript. A live
  streaming capture (gated, like the `user-prompt-shape-live` capture) is
  the upgrade path; it then flips the row to `verified`.
- [The committed golden pins guessed shapes as if they were behavior] →
  The golden pins the *translator's* output for a given input, which is
  exactly the claim; the guess lives only in the input fixture, which a
  live capture would replace.
- [Harness admission change alters other goldens] → It cannot: existing
  fixtures begin with `system.init` + `assistant`, never a leading
  `stream_event`, so the new admission branch is inert for them; the gate
  proves it.
- [Statuses/report drift] → `make compat` regenerates
  `docs/compatibility.md` and fails on a diff; part of the task gate.
