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
- Update the spec requirements that name the flag list, and record on the
  `stream-deltas` row what this change does and does not prove.
- Observe it live through a gated run — one Maki session in the sandbox with
  `-m synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`, capturing whether
  `stream_event` frames actually arrive — and let that observation, not the
  fixture, decide the row's status.

No change to `bridge/src/translator.ts` — it already handles the delta
envelopes.

## Capabilities

### New Capabilities

(none — the transcript requirement already covers streamed output; this change
makes the invocation match it)

### Modified Capabilities

- `opencode-tui-bridge`: "Sandbox transport and host exposure" names the SDK
  flags, so its flag list gains the partial-message request; "Translate the
  prompt into an OpenCode transcript" gains a scenario proving deltas reach the
  stream through the shipped bridge rather than only through a projected
  fixture.

## What still needs proving

A live Maki session can only show deltas arriving if the model actually
streams. The archived `e2e-note.md` recorded that the *model* used then
(`syn:small:text`) never streams — a property of that model, not of the
provider or the network.

Observation is therefore attempted with **`synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`**
on the already-registered `maki-synthetic` profile. That profile already
carries its own egress rule (single host, port 443, scoped to the Maki
binary), so this needs **no new credential and no new network rule** — only
the `-m` model spec differs from the offline suite's.

The observation is gated and skipped when the sandbox, gateway, or image is
absent, and its outcome decides the `stream-deltas` row: a capture that shows
deltas arriving earns the flip to `verified`; a run that shows the model does
not stream keeps it `degraded`, now with the reason narrowed from "the
provider never streams" to this specific model.

## Impact

- `bridge/src/maki.ts` — one flag in `SDK_FLAGS`.
- `bridge/test/fake-maki.ts` — emits `stream_event` frames only when the flag
  is present.
- `bridge/test/session-api.test.ts` (or a sibling test) — one assertion that
  deltas arrive over SSE.
- `bridge/compat/statuses.json` — the `stream-deltas` row's note.
- `openspec/specs/opencode-tui-bridge/spec.md` — two MODIFIED requirements.
- `docs/compatibility.md` — regenerated.
- Security surface: unchanged. No endpoint, no credential, no `--env` value,
  no bind mount, no authentication change; the flag only widens what the child
  writes to its stdout pipe, which the bridge already logs under the existing
  no-credentials-in-logs requirement.

## Note on classification

This is not a `fix-…` change: no entry in `bridge/defects.json` describes it,
and the discovery pass cannot append one, since a defect entry requires a
capture that reproduces the failure and the synthetic model cannot produce a
streaming turn to fail against. Nothing is broken from the user's view — the
transcript is correct, just delivered all at once — so it is recorded as
enabling coverage rather than as a defect.
