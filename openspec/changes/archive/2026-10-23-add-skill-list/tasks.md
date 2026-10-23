# Tasks

## 1. Capability

- [x] 1.1 Scan the sandbox skill directories and answer `/api/skill`. Verify:
      `skill-list.test.ts`.

## 2. Records

- [x] 2.1 Flip `skill-list-live` and its route. Verify: `crosscheck.test.ts`,
      `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `make test-ui`, `bun bridge/test/discovery.ts`, `make test`,
      `make test-bridge`, `make compat`, `make lint`,
      `openspec validate add-skill-list`. Verify: all exit 0.
