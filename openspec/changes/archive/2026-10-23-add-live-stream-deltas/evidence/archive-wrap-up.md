# Archive wrap-up (tasks 4.3 and 6.3)

At archive time OpenSpec moves this change under
`openspec/changes/archive/<YYYY-MM-DD>-add-live-stream-deltas/`. Every evidence
file below must be rewritten to that dated path (today: `2026-10-23`):

- `evidence/stream-live.jsonl`
  → `openspec/changes/archive/2026-10-23-add-live-stream-deltas/evidence/stream-live.jsonl`
- `evidence/stream-note.md`
  → `openspec/changes/archive/2026-10-23-add-live-stream-deltas/evidence/stream-note.md`
- `evidence/archive-wrap-up.md` (this file)
  → `openspec/changes/archive/2026-10-23-add-live-stream-deltas/evidence/archive-wrap-up.md`

No row in `bridge/compat/statuses.json` or `bridge/defects.json` points its
`evidence` key into this change's directory, so no evidence key needs
rewriting and `crosscheck.test.ts` stays green after the archive commit:

- `stream-deltas` points at `bridge/test/fixtures/maki-stream-live.jsonl`, the
  byte-identical copy of `evidence/stream-live.jsonl` that the suite replays.
  It has to stay under `bridge/` — a verified row must name an existing test or
  fixture, and the archived path would not be one.
- The other rows are unchanged by this change; the authored `maki-stream.jsonl`
  fixture keeps its provenance entry and its own golden.

The capture also lives in this change's `evidence/` for the record. That copy is
prose-and-capture only; no artifact or test resolves it after the change is
archived.
