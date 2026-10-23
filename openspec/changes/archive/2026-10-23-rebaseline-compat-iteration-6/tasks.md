# Tasks

## 1. Passes

- [x] 1.1 `bun bridge/test/discovery.ts`, `make test-ui`,
      `bun scripts/compat-drift.ts`, `cd bridge && bun test`,
      `bun scripts/gen-compat.ts --check`. Verify: recorded in
      `evidence/discovery-log.md`; no drift; discovery appended nothing.
- [x] 1.2 Re-read the pinned sources for the 21 untriaged reachable routes.
      Verify: one triage row per route in `evidence/cross-map.md`.

## 2. Record

- [x] 2.1 Append the three defects with their captures. Verify:
      `crosscheck.test.ts` (every capture exists).
- [x] 2.2 Add the feature rows, links and accepts. Verify:
      `bun scripts/gen-compat.ts` reports 6 untriaged reachable routes.
- [x] 2.3 Copy the matrices forward. Verify: `grep -n "(i6)" evidence/*.md`;
      nothing under `archive/` edited.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate --archived` after the archive (a records-only change has no spec delta to validate on its own). Verify: all exit 0.
