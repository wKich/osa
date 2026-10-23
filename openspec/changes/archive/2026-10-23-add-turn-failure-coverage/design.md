# Design

## Context

See proposal.md — Why. The shipped translator already maps a Maki `result`
frame to turn end: `handleResult` computes `ok` from `subtype === "success"`
and `!is_error`, emits `session.step.ended` with `finish: ok ? "stop" :
"error"`, and ends the execution with succeeded or failed
(`bridge/src/translator.ts:311-333`). The offline harness replays recorded
`*.jsonl` fixtures through that translator and diffs a projected sequence
against a committed golden (`bridge/test/lib/projection.ts`), and every
existing fixture ends in a success result.

## Goals / Non-Goals

**Goals:**
- Make the failure half of "Turn completion is reported" executable with one
  fixture, one golden, and one report row.
- Keep `make test-bridge` offline and free of new harness code.

**Non-Goals:**
- No translator or bridge change (the mapping exists; this change pins it).
- No coverage for a child that dies mid-turn (`abortTurn`): that is a bridge
  lifecycle path, not the `result` wire shape, and it needs a scripted-child
  exit knob rather than a fixture. It stays unrecorded here.
- No attempt at the remaining `unverified` rows: interrupt, model switch,
  steering, attachments, retry visibility, the SDK handshake, and richer
  permission vocabulary all need runtime behavior.

## Decisions

1. **Derive the fixture from `maki-plain.jsonl` rather than authoring a new
   turn.** Copy the captured turn byte for byte and rewrite only its `result`
   line to the pinned error subtype. The assistant frames then stay real
   captured wire, while the result shape comes from `sdk_mode.rs` v0.6.4
   L995–L1000 (recorded in `rebaseline-compat-iteration-3/evidence/
   maki-sdk-wire-features.md`). Alternative: a hand-authored minimal error
   turn — rejected because a second near-duplicate assistant transcript can
   drift alongside the captured one without anyone noticing.
2. **Provenance is `mixed`, not `captured`.** The assistant output is
   captured; the rewired result frame is source-derived. The existing
   `maki-retry.jsonl` sets the precedent for the kind and note.
3. **The fixture joins the `FIXTURES` loop with its own golden**, unlike
   `maki-retry` (which asserts equality with the plain golden). A failure
   turn legitimately differs from the plain one, so equality would be wrong;
   the golden pins the failure frames themselves.
4. **The new report row cites `bridge/test/golden.test.ts`.** Crosscheck
   requires a test or fixture path for `verified`, and the row's claim is
   exactly what that loop asserts. Nothing points into this change directory,
   so archiving needs no path rewrite.
5. **The spec delta uses MODIFIED, not ADDED.** The failed-turn behavior is
   part of "Translate the prompt into an OpenCode transcript"; the added
   scenario makes its observable detail explicit (`finish: "error"`, the wire
   message, no success frame) without restating the requirement.

## Risks / Trade-offs

- [The rewritten result uses a failure message and fields no real Maki run
  produced] → The mapping does not branch on any field except `subtype` and
  the message source, both pinned from the SDK source; the golden records
  exactly what was assumed.
- [The plain-turn golden and this one drift apart] → They replay the same
  captured assistant frames, so a translator change that alters part
  rendering moves both together and the diff names the frame.
- [Statuses/report drift] → `make compat` regenerates
  `docs/compatibility.md` and fails on a diff; part of the task gate.
