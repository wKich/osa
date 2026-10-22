# Design

## Context

Pinned Maki `sdk_mode.rs` v0.6.4 reads `cli.include_partial_messages` into
`EventPump.include_partial_messages` and gates every `stream_event` emission
on it — `TextDelta`, `ThinkingDelta`, `ToolStart`, and `finish_message`. The
child argv the bridge builds (`bridge/src/maki.ts:28`) is
`-p --input-format stream-json --output-format stream-json` plus trust and
model, with no such flag, and a grep across `bridge/`, `scripts/`, `bin/`,
`docs/`, `Makefile` finds no mention of it anywhere in the repository.

Downstream of that gate the buffered path is already in place, but the delta
path is not what the change assumed. `translator.ts:131` dispatches
`stream_event`, and `:204-243` handles `content_block_start`, `text_delta`,
`thinking_delta`, and `input_json_delta` — in the spelling the authored fixture
uses (variant on the frame, flat `delta`). The live capture this change took
(2026-10-23, `evidence/stream-live.jsonl`) shows Maki nests every delta in
`content_block_delta` with the variant on `event.delta.type`. So the real gap
is two things: the missing flag, and a translator that recognizes the envelope
the flag actually produces.

So the gap is one missing flag in one argv, plus the absence of any test that
looks at that argv at all, plus one envelope spelling the translator does not
recognize. `childArgv` is exported from `maki.ts:31` with the comment
"exported so the shape can be asserted without spawning," and `grep childArgv`
across `bridge/` and `scripts/` returned only its definition and its one call
site — nothing asserted it.

See proposal.md for why; this document is only how the flag is added and
proved.

## Goals / Non-Goals

**Goals:**

- The child is asked for partial output, so the existing translator path can
  receive deltas in a real session.
- The translator renders the envelope that request actually produces, so the
  flag adds deltas instead of replacing correct text with empty parts.
- The flags the spec names are asserted by a test, not just written down.
- A bridge-level test fails if the flag is ever dropped.
- `stream-deltas` records what this change proved and what it did not.

**Non-Goals:**

- Changing the translator beyond accepting the captured envelope: no new frame
  types, no bridge-side synthesis of deltas from a buffered message.
- Forcing the observation to succeed. The gated run in D4 decides the
  outcome: if `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` does not
  stream, the change records that narrower claim rather than reaching for a
  different model or a different provider on its own.
- Choosing a model for anyone else. The model spec above is what the change
  was given; picking another is a decision, not a default.
- Raising a pin or reading a doc newer than it.

## Decisions

### D1 — One flag, plus the envelope it reaches

`SDK_FLAGS` gains `--include-partial-messages`. On the first live run this
turned out to be necessary but not sufficient: the child streamed frames in a
spelling the translator did not recognize, so content blocks opened and closed
with empty text and the buffered message was suppressed as duplicate. The
translator therefore accepts the captured envelope too — one branch in
`handleStreamEvent` that reads `content_block_delta` and takes the variant
from `event.delta.type`, with the payload read from the nested `delta`.

**Alternative considered:** implement streaming by emitting deltas from the
buffered `assistant` message on the bridge side. Rejected — it would invent a
shape Maki does not send, it would still show nothing until the model's text
arrives, and it would put translation logic where the wire already speaks.

**Alternative considered:** ship the flag alone and fix the envelope in a
follow-up. Rejected — the flag makes real streaming output worse, not better,
so it ships with the branch that makes it correct.

### D2 — The scripted child gains one knob, gated behind an env var

`bridge/test/fake-maki.ts` emits a `stream_event` sequence before its buffered
`assistant` frame only when `FAKE_MAKI_STREAM=1` is set, and the new
bridge-level test sets it.

**Why a knob rather than reading the flag from argv:** once `SDK_FLAGS`
carries the new flag, every bridge test passes it to the scripted child, so a
child that streams *whenever the flag is present* would change the frame
stream in `session-api.test.ts` and `contract.test.ts` for reasons unrelated to
what those tests assert. That is an unknown blast radius across existing
captures and assertions, paid for a proof the argv test already makes directly.
The knob emits the spelling the live capture shows (`content_block_delta`
with `event.delta.type`), so the bridge-level test exercises the real envelope
rather than the authored one. The knob keeps every existing test's frames
byte-identical and scopes the new behavior to the one test that asks for it.

The property that dropping the flag fails a test is carried by the argv
assertion (D3), which is the more direct proof anyway: it inspects what the
bridge actually passes rather than inferring it from a child's behavior.

The knob gets a one-line comment saying why it exists, so it does not read as
a feature nobody asked for.

### D3 — Assert `childArgv`, including the new flag and the absence of `--env`

A pure unit assertion over the exported function: the returned argv contains
every flag the spec's "Exec carries no environment values" scenario names,
now including `--include-partial-messages`, and contains no `--env` value. No
process is spawned, so it runs offline with the rest of the suite.

This also closes a gap that predates this change: the spec scenario asserts
"the recorded `openshell sandbox exec` argv contains…" and nothing in the
suite checked that wording before.

### D4 — `stream-deltas` follows the observation, not the fixture

The change runs one gated observation — `maki -p --input-format stream-json
--output-format stream-json --include-partial-messages -m
synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` inside the sandbox, on the
already-registered `maki-synthetic` profile, whose egress rule already exists —
and the capture decides:

- **deltas observed** → the row flips to `verified` with the capture as
  evidence, because the claim is now an observation rather than a fixture.
- **model does not stream** → the row stays `degraded`, and the note narrows
  from "the provider never streams" to this specific model, which is a smaller
  and more accurate claim than the one the archived `e2e-note.md` left behind.

The observation returned the first branch. It also returned something the
branch did not anticipate: the deltas arrive in an envelope the translator
dropped (D1), so replaying the capture before fixing it produced empty parts.
The capture therefore became a committed fixture and golden — its shape is
what the tests must replay — instead of only an evidence file.

**Alternative considered:** flip it to `verified` on the strength of the
fixture golden alone. Rejected — a fixture we author cannot observe a real
model streaming; the capture is what earns the flip.

**Why no new credential or network rule:** the observation names a different
*model* on the *same* registered profile, and every profile in
`examples/providers/` already carries its own single-host, port-443 rule scoped
to the Maki binary. The earlier framing — that this needed a
"streaming-capable provider, a credential, and a live egress rule" — was wrong;
it conflated a model choice with a provider and network choice.

### D5 — No `bridge/defects.json` entry

A defect entry needs a capture that reproduces a failure a user could hit. The
envelope gap was unobservable until this change made a streaming turn reachable
and did not exist in any shipped configuration (the flag was never passed), so
the capture belongs to this change as fixture and evidence rather than to the
inventory. Had the flag been shipped alone, the gap would have been a defect;
D1 is why it is not.

### D6 — Sequencing with the open capture change

`add-live-subagent-capture` is open and also writes `bridge/compat/statuses.json`
(a different row: the `subagent-nesting` caveat) and
`bridge/test/golden.test.ts`. This change writes `statuses.json` (the
`stream-deltas` row), `bridge/src/maki.ts`, `bridge/src/translator.ts`,
`bridge/test/fake-maki.ts`, fixtures and goldens. Different rows, no shared
file between them except `statuses.json` and `golden.test.ts`.

They can be worked in either order, but not interleaved — each should regenerate
`docs/compatibility.md` from its own completed edit, and each carries its own
evidence paths to rewrite at archive time. Landing the capture change first
keeps the bookkeeping linear.

## Risks / Trade-offs

- **[The flag spelling is wrong or ignored]** → Pinned `sdk_mode.rs` opens with
  `cli.warn_ignored_flags()`, so an unknown flag warns and is dropped instead
  of failing. Task 1 verified the spelling against the installed 0.6.4 binary
  before any source edit: the flag is listed and accepted without a warning.
- **[The wire envelope differs from the authored fixture]** → This risk
  materialized: the live capture nests the variant in `content_block_delta`,
  which the translator dropped, so passing the flag alone would have emptied
  streamed parts. D1 accepts the captured envelope, and D4 commits the capture
  as the fixture the tests replay, so the suite now fails on a regression here.
- **[More frames per message than before]** → Real OpenCode clients are built
  for this shape — it is what a streaming server sends. It also *reduces* the
  idle-stall exposure the heartbeat requirement exists for, since a long
  generation now produces frames continuously instead of one message at the
  end. The residual risk is volume on very long turns, which is a measurement
  rather than a correctness question and is noted, not guessed at.
- **[A provider that streams changes transcript timing in ways goldens don't
  cover]** → Goldens are written from fixtures, not from wall-clock, and the
  projection strips ids and timestamps; chunk boundaries differ but the
  projected sequence does not. The new bridge test asserts arrival and
  non-duplication, not chunk counts.
- **[`fake-maki` drifting from the real wire by gaining behavior]** → The knob
  means the scripted child does exactly what it did before unless a test asks
  for more, and its frames now use the captured spelling rather than a second
  guess.

## Migration Plan

One commit: the flag, the translator's envelope branch, the argv assertion,
the scripted-child knob plus its test, the capture fixture, provenance entry
and golden, the two spec deltas, the `stream-deltas` row, and the regenerated
report. The suite gates it — `make test`, `make test-bridge`, `make compat`.
Rollback is a revert to one line in `SDK_FLAGS` plus the envelope branch, and
with them the new test and assertion, since they describe the flag's presence.

## Open Questions

None. The question this change deferred — whether a real streaming model
produces the sequence the translator expects — is answered by
`evidence/stream-live.jsonl`: it does, in a nested envelope now accepted and
pinned by a committed fixture.
