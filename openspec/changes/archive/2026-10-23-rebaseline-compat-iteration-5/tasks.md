# Tasks

## 1. Passes

- [x] 1.1 `bun bridge/test/discovery.ts`, `make test-ui`,
      `bun scripts/compat-drift.ts`, `cd bridge && bun test`,
      `bun scripts/gen-compat.ts --check`. Verify: results recorded in
      `evidence/discovery-log.md`; discovery appended nothing; no drift.
- [x] 1.2 Re-enumerate pinned routes, wire kinds and events against the
      matrices. Verify: 143 = 143 routes; 51/51 events recorded; no wire kind
      missing.

## 2. Record

- [x] 2.1 Copy the matrices forward and refresh the stale rows. Verify:
      `grep -n "(i5)" evidence/*.md`; nothing under `archive/` edited.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate rebaseline-compat-iteration-5`. Verify: all exit 0.
