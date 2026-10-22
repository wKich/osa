# Archive wrap-up (task 4.3)

At archive time OpenSpec moves this change under
`openspec/changes/archive/<YYYY-MM-DD>-add-live-stream-deltas/`. Every evidence
file below must be rewritten to that dated path (today: `2026-10-23`):

- `evidence/stream-live.jsonl`
  → `openspec/changes/archive/2026-10-23-add-live-stream-deltas/evidence/stream-live.jsonl`
- `evidence/stream-note.md`
  → `openspec/changes/archive/2026-10-23-add-live-stream-deltas/evidence/stream-note.md`
- `evidence/archive-wrap-up.md` (this file)
  → `openspec/changes/archive/2026-10-23-add-live-stream-deltas/evidence/archive-wrap-up.md`

At the time this note was written no row in `bridge/compat/statuses.json` or
`bridge/defects.json` pointed its `evidence` key into this change's directory:
the `stream-deltas` row points at `bridge/test/golden.test.ts`, which stays
put. If the live observation flips that row to `verified`, its `evidence` key
must still name a test under `bridge/` (the cross-check suite requires it), so
the capture stays a supporting file and no evidence key needs rewriting.
