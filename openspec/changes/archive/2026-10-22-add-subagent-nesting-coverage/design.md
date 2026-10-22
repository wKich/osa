# Design

## Context

Maki's SDK mode runs parent and subagent turns through one event pump writing
to one stdout: every `AssistantPayload`/`UserPayload` carries
`parent_tool_use_id` when the envelope came from a subagent
(`src/sdk_mode.rs` v0.6.4, L1016–L1121; the field is skipped when absent),
and exactly one `result` frame ends the run — `emit_turn_result` fires only on
run-level `Done`/`Error` (L1178, L1181), and `result_text` accumulates only
from parent frames (L1074, L1098). The shipped `Translator.handleAssistant`
ignores the flag and renders parts in arrival order under the turn's message
id; `handleUser` maps `tool_result`s by tool id. The behavior exists and is
source-faithful — nothing pins it, so the cross-map row stays `unverified`.
See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Make "subagent-flagged frames render in the transcript" an executable
  claim: one fixture, one committed golden, one statuses row flip.
- Keep `make test-bridge` fully offline.

**Non-Goals:**
- No translator or bridge runtime changes: the golden lens pins the shipped
  flattening, and no test seam here demands new behavior.
- No child-session separation (OpenCode's `session/child sessions API`
  counterpart): subagent output renders inline in the owning transcript;
  building child sessions is a runtime feature, not coverage, and the
  limitation stays recorded on the row's design record.
- Control-plane rows (interrupt, model switch, steering, sdk handshake) stay
  as recorded — they need runtime forwarding.

## Decisions

1. **The row flips `unverified` → `verified`** (decided with the user). This
   is deliberately unlike `stream-deltas` → `degraded`: there the envelope
   spellings were sdk_mode-*string*-derived guesses; here the nesting shape
   comes from the same declared source of truth every verified row rests on —
   `src/sdk_mode.rs` at the pinned tag `v0.6.4`, with line references already
   recorded in the archived `maki-sdk-wire-features.md`. The two limitations
   (no live subagent capture; inline flattening instead of child sessions)
   are recorded in this design and in the test comment that is the row's
   evidence, not as a status downgrade.
2. **Fixture derives from `maki-tool.jsonl`, copied verbatim for the parent
   frames**, with source-pinned nested frames appended around them: an
   `assistant` carrying `parent_tool_use_id` (subagent text + tool_use), the
   matching flagged `user` `tool_result`, and the parent's closing frames
   before one terminal `result`. Copying verbatim keeps `maki-tool`'s
   committed golden as a cross-check that the new fixture changed only the
   nesting input, not the shared shapes.
3. **One run, one terminal `result` in the fixture** — source-pinned (decision
   context), not an assumption: a per-subagent `result` would be premature
   turn close, and maki has no such emission path. Scenario 3 of the added
   requirement pins exactly that no flagged frame ends the turn early.
4. **The golden lens, not `fake-maki.ts`.** Nesting is a translation claim
   about frame rendering; `runFixture` already routes interleaved
   `assistant`/`user`/`result` frames through the shipped translator with the
   turn open, so no harness or scripted-child change is needed.
5. **Evidence points at `bridge/test/golden.test.ts`**, where a comment
   records the limitations from decision 1; `crosscheck.test.ts` accepts a
   test path for `verified`. The evidence lives under `bridge/test/`, so
   archiving this change moves nothing the row links to (no archive-path
   note needed).
6. **This supersedes the lumped prior conclusion** ("subagent-nesting needs
   runtime forwarding or a live capture first", recorded in the archived
   `stream-delta`, `wire-tolerance`, and `permission-reply-policy`
   designs): those designs did not check the source; the source check above
   shows the gap was coverage, not behavior.

## Risks / Trade-offs

- [The fixture's interleaving pattern differs from a live subagent turn] →
  The translator flattens order-insensitively, so ordering variance changes
  only frame order in the input; a gated live subagent capture (like the
  `user-prompt-shape-live` capture) would replace the fixture input without
  touching the golden's meaning.
- [The golden pins inline flattening as the committed behavior] → That is the
  row's verified claim; child-session separation would be a deliberate future
  behavior change with its own spec delta, and the report records the
  limitation today.
- [Subagent permission asks share the parent's `can_use_tool` shape with no
  parent marker] → Pre-existing property of maki's wire, already covered by
  the `permission-round-trip` row; out of scope here and unchanged.
- [Statuses/report drift] → `make compat` regenerates
  `docs/compatibility.md` and fails on a diff; part of the task gate.

## Open Questions

None — the per-subagent `result` question that blocked earlier attempts is
resolved from source (decision 3).
