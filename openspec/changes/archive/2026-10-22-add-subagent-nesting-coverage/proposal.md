# Proposal

## Why

The cross-map row `subagent-nesting` — "Subagent transcript nesting via
`parent_tool_use_id`" — has been `unverified` since the bridge shipped: maki
streams subagent turns through the same stdout as the parent run, flagged by
`parent_tool_use_id`, and nothing in this repository pins what the bridge does
with those frames. The row was repeatedly deferred by earlier coverage changes
as "needs runtime forwarding, a live capture first"; a source check of
`src/sdk_mode.rs` at the pinned tag `v0.6.4` supersedes that: the flag's
payload shape and the one-`result`-per-run turn structure are pinned at the
repo's declared source of truth, and the shipped translator already renders
the frames source-faithfully. The behavior exists — only the coverage is
missing.

## What Changes

- A new golden fixture `bridge/test/fixtures/maki-subagent.jsonl`, derived
  from `maki-tool.jsonl`, carrying the source-pinned nesting shape:
  `parent_tool_use_id` at the payload top level beside `message` on `assistant`
  and `user` frames, subagent frames interleaved with parent frames within one
  run, and exactly one terminal `result`.
- The fixture joins the golden suite in `bridge/test/golden.test.ts`, pinning
  the committed translation: nested parts render inline in the transcript in
  arrival order, under the turn's assistant message id, and nested
  `tool_result`s map to `session.tool.success`/`session.tool.failed` by tool
  id.
- `bridge/compat/statuses.json`: the `subagent-nesting` row flips
  `unverified` → `verified` with `bridge/test/golden.test.ts` as evidence,
  then `make compat` regenerates `docs/compatibility.md`.

## Capabilities

- **Modified**: `opencode-tui-bridge` — one ADDED requirement committing to
  how subagent-flagged frames render (inline flattening in the session
  transcript), behavior the shipped translator already has and this change
  verifies.

## Impact

- Test assets only: `bridge/test/fixtures/`, `bridge/test/golden.test.ts`,
  `bridge/compat/statuses.json`, `docs/compatibility.md`.
- No bridge or translator runtime change: the shipped behavior is what gets
  pinned.
- No `fake-maki.ts` change: the lens is the golden projection (translation),
  not the API-level child seam.
- The recorded limitations — no live subagent capture, and inline flattening
  instead of OpenCode's child-sessions counterpart — stay visible in the
  change's design record next to the flipped row.
