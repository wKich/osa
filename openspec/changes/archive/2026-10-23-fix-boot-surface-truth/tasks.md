# Tasks

## 1. Fix

- [x] 1.1 Answer `/api/info` from bridge state (pid, URL, tmp,
      `persistentPty: false`). Verify: `boot-surface.test.ts`.
- [x] 1.2 Empty the plugin/reference/shell/command/MCP/MCP-resource lists and
      make the agent list one primary `build` agent. Verify:
      `boot-surface.test.ts`; goldens updated for the agent id only.

## 2. Records

- [x] 2.1 Close `boot-lists-phantom-rows` and `info-advertises-terminals`; flip
      the statuses rows. Verify: `crosscheck.test.ts`, `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `bun bridge/test/discovery.ts` (appends nothing), `make test`,
      `make test-bridge`, `make compat`, `make lint`,
      `openspec validate fix-boot-surface-truth`. Verify: all exit 0.
