# Discovery pass: v0.6.5 / v2.1.4

## The passes

| Pass | Command | Result |
| --- | --- | --- |
| API discovery | `bun bridge/test/discovery.ts` | 6 scenarios, 6 clean, 0 known defects deduped, **0 appended** |
| TUI discovery | `make test-ui` (real `opencode v2.1.4`) | PASS: 41 requests served without 404, PONG rendered, permission round-tripped, 0 open defects; normalized route set is the committed capture |
| Pin drift | `bun scripts/compat-drift.ts` | opencode v2.1.4 / maki 0.6.5; 124 routes / 293 schemas; no drift against the vendored contract |
| Offline suite | `cd bridge && bun test` | 225 pass, 0 fail (after the live evidence refresh) |
| Report consistency | `bun scripts/gen-compat.ts --check` | matches |

## Enumeration (from source at the pins)

- Routes: **148** pinned `/api/*` operations
  (`bridge/src/openapi-2.1.4.json`) = 148 rows in
  `bridge/compat/statuses.json`; none missing, none phantom. The six new
  operations are out-of-scope rows; the previous `GET /auth/connect/{code}`
  row was removed because the served surface is scoped to `/api/*` (see
  `route-classification.md`).
- Events: **53** types in `packages/schema/src/session-event.ts` at v2.1.4,
  all 53 with a row in `opencode-tui-features.md`. The two new types are
  `session.archived` / `session.unarchived`; the bridge emits neither
  (archiving is contract-only).
- Wire: every inbound kind, control subtype, outbound kind and
  `stream_event` delta in `src/sdk_mode.rs` at v0.6.5 has a row in
  `maki-sdk-wire-features.md`. The wire files are byte-identical to v0.6.4.

## Scoreboard

Reachable routes: **52 `served-live`, 12 `served-faked` (all triaged),
3 `deferred`, 0 `unhandled`**. Reachable features: **55 `verified`,
13 `degraded`** (all `blockedBy: pin`), **0 `unverified`**, 0 untriaged.
Out of scope: 81 routes and 1 feature (`sdk-control-handshake`). Open
defects: 0 (18 entries, all `fixed`). Rows added to `statuses.json`:
6 routes, 1 feature (`agent-todos`).

Journeys: 53 `parity`, 7 `diverges` (all pin-blocked features: compaction,
undo/redo, question/form relay, MCP connect/disconnect, model variants), and
2 `broken` (background tools and reject-with-reason, both pin-blocked
harnesses), plus 6 `unrecorded` out-of-scope rows. The new
`see-agent-todos` journey is `parity`; its only accepted difference is the
session title Maki generates from the first prompt.

## Triage notes

- **Todo rendering** is the only newly reachable behavior. Maki's
  `TodoWrite` / `todo_write` now maps to `todowrite`, and OpenCode v2.1.4
  renders it in both the transcript and the sidebar.
- **Session archiving** (`session.archived` / `session.unarchived`,
  `GET /api/session?archived`, `PATCH /api/session/{id}` `archived`) is
  contract-only: the TUI exposes no archive control, and the bridge neither
  applies nor emits it.
- **Client MCP, voice, heap dump, saved-permission edit** are out-of-scope
  operations with no Maki counterpart or no TUI surface; all are
  `served-faked` from the pinned spec.
- **New-designs/free-model experiments** stay out of scope; they are
  OpenCode-side experiments, not a bridge surface.
- No new defect was appended; the two broken journeys are the recorded
  pin-blocked verdicts, unchanged by the pin move.
