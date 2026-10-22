# Proposal

## Why

The compatibility report claims `stream_event` deltas translate into part
delta frames, but the entire translation path
(`Translator.handleStreamEvent`, three 1:1 delta mappings, the dedupe
against the buffered `assistant` floor) has zero test coverage — the
`stream-deltas` row sits at `unverified` with a planning note as evidence,
and no fixture has ever replayed a `stream_event` frame through the shipped
Translator.

## What Changes

- Add a recorded fixture `bridge/test/fixtures/maki-stream.jsonl`: two
  turns whose part output arrives as `stream_event` frames in the
  sdk_mode-derived envelope (`content_block_start` / `thinking_delta` /
  `text_delta` / `input_json_delta` / `content_block_stop`, plus
  `message_*` frames the translator must drop), each followed by the
  buffered `assistant` frame that must not duplicate what streamed.
- Extend the golden harness's turn admission so a leading `stream_event`
  opens the turn (live, prompt admission happens before any child frame),
  and add the fixture to the golden loop with a committed golden pinning
  incremental deltas, full-text part ends, and no duplicated frames.
- Flip the `stream-deltas` row in `bridge/compat/statuses.json` from
  `unverified` to `degraded` with the new test path as evidence, and
  regenerate `docs/compatibility.md` via `make compat`.
- No bridge runtime code changes; the translator's existing streaming
  behavior is what gets pinned.

## Capabilities

### New Capabilities

(none — no new capability path)

### Modified Capabilities

- `openspec/specs/opencode-tui-bridge/spec.md`: the "Translate the prompt
  into an OpenCode transcript" requirement gains two scenarios pinning the
  streamed path it already commits to ("for both streamed and non-streamed
  Maki output") — no existing wording changes.

## Impact

- Test assets only: `bridge/test/fixtures/`, `bridge/test/lib/projection.ts`
  (turn-admission seam), `bridge/test/golden.test.ts`,
  `bridge/compat/statuses.json`, `docs/compatibility.md`.
- The row flips to `degraded`, not `verified`: the envelope spellings are
  sdk_mode-string-derived guesses (shortcut comment in `translator.ts`,
  design decision of `add-wire-tolerance-coverage`), so the limitation —
  never captured from a live streaming provider — stays recorded next to
  the evidence.
- The remaining `unverified` rows (interrupt, model switch, steering, sdk
  handshake, subagent nesting) stay untouched: covering them means building
  runtime behavior, not coverage.
- Offline only: no Docker, gateway, or network added to `make test-bridge`.
