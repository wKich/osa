# Tasks

- [x] 1.1 Add an empty-set `mcp.toml` to `journeyMakiConfig` and upload it.
  Verify: `live-sandbox.test.ts` asserts three uploads and no `[mcp.` table.
- [x] 1.2 Re-run `resume-session-history` live. Verify: no MCP toast or
  footer count; the live request log's `GET /api/mcp` answers `[]`.
- [x] 1.3 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`,
  `openspec validate fix-live-journey-mcp-config --strict`.
