# Tasks

## 1. Passes

- [x] 1.1 `bun bridge/test/discovery.ts`, `make test-ui`,
      `bun scripts/compat-drift.ts`, `cd bridge && bun test`,
      `bun scripts/gen-compat.ts --check`. Verify: results recorded in
      `evidence/discovery-log.md`; discovery appended nothing; no drift.
- [x] 1.2 Re-enumerate pinned routes and emitted events. Verify: 143 pinned
      operations = 143 rows; 23 of 51 `session-event.ts` types emitted.

## 2. Record

- [x] 2.1 Copy the matrices forward; mark the newly emitted events and the
      stale retry row; refresh the interrupt/model route rows. Verify:
      `grep -n "(i4)" evidence/*.md`; nothing under `archive/` edited.
- [x] 2.2 Edit the `agent-switch-state` and `sdk-control-handshake` titles and
      the handshake evidence. Verify: `cd bridge && bun test crosscheck`.
- [x] 2.3 Regenerate `docs/compatibility.md`. Verify: `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate rebaseline-compat-iteration-4`. Verify: all exit 0.
