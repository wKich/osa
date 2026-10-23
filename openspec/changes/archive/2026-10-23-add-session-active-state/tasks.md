# Tasks

## 1. Capability

- [x] 1.1 Answer `/api/session/active` from the session registry. Verify:
      `session-active.test.ts`.

## 2. Records

- [x] 2.1 Flip `session-active-live` and its route. Verify:
      `crosscheck.test.ts`, `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `bun bridge/test/discovery.ts`, `make test`, `make test-bridge`,
      `make compat`, `make lint`, `openspec validate add-session-active-state`.
      Verify: all exit 0.
