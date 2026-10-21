# Design

## Context

The translator already tolerates `system` frames other than `init` by
ignoring them (`translator.ts` `onFrame` → `system` case falls through), but
nothing pins that: the `api-retry-tolerance` row in
`bridge/compat/statuses.json` is `unverified` with a planning note as
evidence. The golden harness (`bridge/test/lib/projection.ts`) replays
recorded `*.jsonl` fixtures through the shipped Translator and diffs a
projected frame sequence against a committed golden; `system` frames are
already in its replay path. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Make "an `api_retry` frame leaves the transcript undisturbed" an
  executable claim: one fixture, one assertion, one statuses row flip.
- Keep `make test-bridge` fully offline.

**Non-Goals:**
- No translator or bridge runtime changes (the behavior exists; this change
  only pins it).
- `stream-deltas` stays `unverified`: its envelope spellings are guesses
  (shortcut comment in `translator.ts`) and no real streaming capture
  exists — a self-authored fixture would test our own guess.
- Control-plane rows (interrupt, model switch, sdk handshake) and
  `subagent-nesting` stay as recorded; covering them means building runtime
  behavior, not coverage.

## Decisions

1. **The retry fixture is derived from `maki-plain.jsonl`, not written from
   scratch**: copy it and interleave
   `{"type":"system","subtype":"api_retry","attempt":…,"retry_delay_ms":…,"error":…}`
   lines mid-turn. Alternative: a hand-authored minimal turn — rejected,
   because a second near-duplicate transcript golden can drift alongside the
   first without anyone noticing.
2. **The assertion is golden *equality*, not a new golden**: the test
   asserts `project(runFixture("maki-retry"))` deep-equals the committed
   `golden/maki-plain.json`. That literal identity *is* the requirement
   ("identical to the same turn replayed without those frames"). The
   fixture is deliberately **not** added to the `FIXTURES` loop in
   `golden.test.ts`, which would mint a duplicate `maki-retry.json` golden
   and weaken the claim to "matches its own copy".
3. **Field shape comes from the recorded wire inventory**
   (`maki-sdk-wire-features.md` row 2, `sdk_mode.rs` v0.6.4 L1081), not
   from guesswork — the reason this row can be honestly `verified` while
   `stream-deltas` cannot.
4. **Statuses evidence points at the test that asserts it**
   (`bridge/test/golden.test.ts`), matching how other `verified` rows cite
   their checking test; `bridge/test/crosscheck.test.ts` accepts only
   test/fixture paths for `verified`, and this satisfies it. Because the
   evidence lives under `bridge/test/`, archiving this change moves nothing
   the row links to (no archive-path note needed).

## Risks / Trade-offs

- [The fixture's `api_retry` field spelling could differ from the real
  wire] → Mitigation: tolerance does not depend on the fields (any
  non-`init` `system` frame falls through), and the spelling is recorded
  from the pinned SDK source; worst case the test documents tolerance of a
  near-identical frame.
- [Equality assertion breaks if the plain-turn golden itself changes] →
  That is intended coupling: a transcript change must reseed
  `maki-plain.json`, and this row then re-verifies against the same new
  baseline.
- [Statuses/report drift] → `make compat` regenerates
  `docs/compatibility.md` and fails on a diff; part of the task gate.
