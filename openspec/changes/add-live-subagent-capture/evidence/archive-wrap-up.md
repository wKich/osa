# Archive wrap-up (task 5.3)

At archive time OpenSpec moves this change under
`openspec/changes/archive/<YYYY-MM-DD>-add-live-subagent-capture/`. Every
evidence file below must be rewritten to that dated path (today: `2026-10-23`):

- `evidence/capture-note.md`
  → `openspec/changes/archive/2026-10-23-add-live-subagent-capture/evidence/capture-note.md`
- `evidence/shape-comparison.md`
  → `openspec/changes/archive/2026-10-23-add-live-subagent-capture/evidence/shape-comparison.md`
- `evidence/redaction-scan.md`
  → `openspec/changes/archive/2026-10-23-add-live-subagent-capture/evidence/redaction-scan.md`
- `evidence/archive-wrap-up.md` (this file)
  → `openspec/changes/archive/2026-10-23-add-live-subagent-capture/evidence/archive-wrap-up.md`

No row in `bridge/compat/statuses.json` or `bridge/defects.json` points its
`evidence` key into this change's directory: the `subagent-nesting` row points
at `bridge/test/golden.test.ts`, which stays put. So no evidence key needs
rewriting, and `crosscheck.test.ts` stays green after the archive commit. The
fixture's `provenance.json` entry names the capture script, not this change
directory.
