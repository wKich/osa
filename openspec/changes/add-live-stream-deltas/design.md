# Design

## Context

Pinned Maki `sdk_mode.rs` v0.6.4 reads `cli.include_partial_messages` into
`EventPump.include_partial_messages` and gates every `stream_event` emission
on it — `TextDelta`, `ThinkingDelta`, `ToolStart`, and `finish_message`. The
child argv the bridge builds (`bridge/src/maki.ts:28`) is
`-p --input-format stream-json --output-format stream-json` plus trust and
model, with no such flag, and a grep across `bridge/`, `scripts/`, `bin/`,
`docs/`, `Makefile` finds no mention of it anywhere in the repository.

Downstream of that gate everything is already in place: `translator.ts:131`
dispatches `stream_event`, and `:204-243` handles `content_block_start`,
`text_delta`, `thinking_delta`, and `input_json_delta`, emitting
`session.text.delta` / `session.reasoning.delta` / `session.tool.input.delta`
and suppressing duplicates from the buffered message. The spec requirement at
`opencode-tui-bridge/spec.md:70` already commits to "both streamed and
non-streamed Maki output."

So the gap is one missing flag in one argv, plus the absence of any test that
looks at that argv at all. `childArgv` is exported from `maki.ts:31` with the
comment "exported so the shape can be asserted without spawning," and
`grep childArgv` across `bridge/` and `scripts/` returns only its definition
and its one call site — nothing asserts it.

See proposal.md for why; this document is only how the flag is added and
proved.

## Goals / Non-Goals

**Goals:**

- The child is asked for partial output, so the existing translator path can
  receive deltas in a real session.
- The flags the spec names are asserted by a test, not just written down.
- A bridge-level test fails if the flag is ever dropped.
- `stream-deltas` records what this change proved and what it did not.

**Non-Goals:**

- Changing `bridge/src/translator.ts`. It already handles the envelopes.
- Forcing the observation to succeed. The gated run in D4 decides the
  outcome: if `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` does not
  stream, the change records that narrower claim rather than reaching for a
  different model or a different provider on its own.
- Choosing a model for anyone else. The model spec above is what the change
  was given; picking another is a decision, not a default.
- Raising a pin or reading a doc newer than it.

## Decisions

### D1 — One flag, no other source change

`SDK_FLAGS` gains `--include-partial-messages`. That is the entire
`bridge/src` change, which keeps it reviewable in one line and means the
behavior it unlocks was already built and already golden-tested — this change
connects an existing wire to an existing consumer.

**Alternative considered:** implement streaming by emitting deltas from the
buffered `assistant` message on the bridge side. Rejected — it would invent a
shape Maki does not send, it would still show nothing until the model's text
arrives, and it would put translation logic where the wire already speaks.

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
The knob keeps every existing test's frames byte-identical and scopes the new
behavior to the one test that asks for it.

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

After this change the request is made and the translation is proven, but no
live run has shown deltas arriving. The change therefore runs one gated
observation — `maki -p --input-format stream-json --output-format stream-json
--include-partial-messages -m synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`
inside the sandbox, on the already-registered `maki-synthetic` profile, whose
egress rule already exists — and the capture decides:

- **deltas observed** → the row flips to `verified` with the capture as
  evidence, because the claim is now an observation rather than a fixture.
- **model does not stream** → the row stays `degraded`, and the note narrows
  from "the provider never streams" to this specific model, which is a smaller
  and more accurate claim than the one the archived `e2e-note.md` left behind.

Neither branch invents a status: `verified` for this row would otherwise be
exactly the self-confirming claim the provenance work exists to expose, and
the gate costs one sandbox run either way.

**Alternative considered:** flip it to `verified` now, since the golden and the
new bridge test both pass. Rejected for the reason above — both tests feed the
bridge a child we control, so neither observes a real model streaming.

**Why no new credential or network rule:** the observation names a different
*model* on the *same* registered profile, and every profile in
`examples/providers/` already carries its own single-host, port-443 rule scoped
to the Maki binary. The earlier framing — that this needed a
"streaming-capable provider, a credential, and a live egress rule" — was wrong;
it conflated a model choice with a provider and network choice.

### D5 — No `bridge/defects.json` entry

A defect entry needs a capture that reproduces the failure, and reproducing
this one needs a streaming model the suite cannot reach. Recorded instead as
coverage that this change enables, per the classification note in the
proposal.

### D6 — Sequencing with the open capture change

`add-live-subagent-capture` is open and also writes `bridge/compat/statuses.json`
(a different row: the `subagent-nesting` caveat) and
`bridge/test/golden.test.ts`. This change writes `statuses.json` (the
`stream-deltas` note), `bridge/src/maki.ts`, `bridge/test/fake-maki.ts`, and a
test. Different rows, no shared file between them except `statuses.json`.

They can be worked in either order, but not interleaved — each should regenerate
`docs/compatibility.md` from its own completed edit, and each carries its own
evidence paths to rewrite at archive time. Landing the capture change first
keeps the bookkeeping linear.

## Risks / Trade-offs

- **[The flag spelling is wrong or ignored]** → Pinned `sdk_mode.rs` opens with
  `cli.warn_ignored_flags()`, so an unknown flag warns and is dropped instead
  of failing. Task 1 verifies the spelling against the installed binary and
  captures stderr before any source edit, and falls back to the prompt-text
  route only if the flag turns out not to exist. Same gate the capture change
  uses for its own flag.
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
  for more, and the emitted shapes mirror the ones the archived fixtures and
  `StreamSynth` in the pinned source already spell.

## Migration Plan

One commit: the flag, the argv assertion, the scripted-child knob plus its
test, the two spec deltas, the `stream-deltas` note, and the regenerated
report. The suite gates it — `make test`, `make test-bridge`, `make compat`.
Rollback is a revert to one line in `SDK_FLAGS`, and with it the new test and
assertion, since they describe the flag's presence.

## Open Questions

None that change the specs, the approach, or the task breakdown. Whether a
real streaming model produces the sequence the translator expects is the
question this change deliberately leaves to a later, credential-backed change,
and D4 keeps the status honest until it is answered.
