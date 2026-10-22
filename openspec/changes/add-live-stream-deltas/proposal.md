# Proposal

## Why

The spec already promises transcript coverage "for both streamed and
non-streamed Maki output," and the translator already handles `stream_event`
frames end to end (`bridge/src/translator.ts:131`, `:204-243`). What was never
done is the one thing that makes them arrive: pinned Maki `sdk_mode.rs` v0.6.4
gates every `stream_event` emission behind `include_partial_messages`, and the
child invocation the bridge builds (`bridge/src/maki.ts:28`) does not pass that
flag. Nothing in `bridge/`, `scripts/`, `bin/`, or `docs/` mentions it.

So in production the child sends only the finished message, and the streaming
half of the spec requirement is dormant. The `stream-deltas` row sits at
`degraded` behind a fixture authored from source rather than observed, which
the earlier provenance work recorded but did not fix. Turning the flag on is
what closes the gap between the requirement and the invocation.

## What Changes

- Pass `--include-partial-messages` in the child's SDK flags, so the child is
  asked for partial output and the existing translator path it feeds becomes
  reachable in a real session.
- Assert the child argv in a test. `childArgv` is exported from
  `bridge/src/maki.ts` precisely "so the shape can be asserted without
  spawning," and no test asserts it — so the flags the spec names are
  currently written down and unchecked, and this change closes that.
- Teach the scripted child seam to honor the flag the way the real child
  does: `bridge/test/fake-maki.ts` emits `stream_event` frames only when it is
  passed the flag, and a bridge-level test then proves deltas reach the SSE
  stream. Dropping the flag from `SDK_FLAGS` fails that test.
- Update the spec requirements that name the flag list and the streamed-delta
  envelope, and record on the `stream-deltas` row what this change proves.
- Accept the captured delta envelope in the translator. The live run this
  change makes (see below) showed the real wire nests the variant in
  `content_block_delta` with its own `delta.type`, which the author-fixture
  spelling did not match — without this the flag would render empty parts. So
  `handleStreamEvent` accepts both spellings, and the capture becomes a
  committed fixture and golden.
- Observe it live through a gated run — one Maki session in the sandbox with
  `-m synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`, capturing the
  `stream_event` frames — and let that observation, not the fixture, decide
  the row's status.

## Capabilities

### New Capabilities

(none — the transcript requirement already covers streamed output; this change
makes the invocation match it)

### Modified Capabilities

- `opencode-tui-bridge`: "Sandbox transport and host exposure" names the SDK
  flags, so its flag list gains the partial-message request; "Translate the
  prompt into an OpenCode transcript" gains the captured delta envelope and a
  scenario proving deltas reach the stream through the shipped bridge rather
  than only through a projected fixture.

## What the observation showed

Observation ran on `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` on the
already-registered `maki-synthetic` profile, which already carries its own
egress rule (single host, port 443, scoped to the Maki binary) — **no new
credential and no new network rule**. `evidence/stream-live.jsonl` shows the
model does stream, and that Maki nests each delta in `content_block_delta`
with the variant on `event.delta.type` — a different spelling from the
authored fixture. The first replay of that capture therefore produced empty
`started`/`ended` pairs and no delta frames: the flag alone would have
replaced correct buffered text with nothing. The translator now accepts both
spellings, the capture is committed as `bridge/test/fixtures/maki-stream-live.jsonl`
with its golden, and the `stream-deltas` row flips to `verified`.

The authored fixture stays for the tool-input deltas one text turn does not
reproduce, so the two fixtures cover the wire and the edges separately.

## Impact

- `bridge/src/maki.ts` — one flag in `SDK_FLAGS`.
- `bridge/src/translator.ts` — `handleStreamEvent` accepts the captured
  `content_block_delta` envelope as well as the authored spelling.
- `bridge/test/fake-maki.ts` — emits `stream_event` frames in the captured
  spelling, only when `FAKE_MAKI_STREAM=1`.
- `bridge/test/argv.test.ts` — asserts every spec flag and the absence of
  `--env` on `childArgv`.
- `bridge/test/stream-deltas.test.ts` — one assertion that deltas arrive over
  SSE through the shipped bridge.
- `bridge/test/fixtures/maki-stream-live.jsonl`, `provenance.json`,
  `golden/maki-stream-live.json`, `golden.test.ts` — the capture and its
  golden.
- `bridge/test/capture-stream.sh` — the gated capture command.
- `bridge/compat/statuses.json` — the `stream-deltas` row.
- `openspec/specs/opencode-tui-bridge/spec.md` — two MODIFIED requirements.
- `docs/compatibility.md` — regenerated.
- Security surface: unchanged. No endpoint, no credential, no `--env` value,
  no bind mount, no authentication change; the flag only widens what the child
  writes to its stdout pipe, which the bridge already logs under the existing
  no-credentials-in-logs requirement.

## Note on classification

This is not a `fix-…` change: no entry in `bridge/defects.json` describes it,
and the gap it fixes was only observable after the flag made a streaming turn
reachable — the capture is now part of this change rather than an inventory
entry. Nothing was broken from the user's view before it: the transcript was
correct, just delivered all at once.
