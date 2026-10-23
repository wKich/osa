# Tasks

## 1. Passes

- [x] 1.1 `bun bridge/test/discovery.ts`, `make test-ui`,
      `bun scripts/compat-drift.ts`, `cd bridge && bun test`,
      `bun scripts/gen-compat.ts --check`. Verify: recorded in
      `evidence/discovery-log.md`; nothing appended; no drift.

## 2. Record

- [x] 2.1 Copy the matrices forward and refresh the stale rows. Verify:
      `grep -n "(i7)" evidence/*.md`; nothing under `archive/` edited;
      `git diff bridge/compat/statuses.json` is empty.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate --archived` after the archive. Verify: all exit 0.
