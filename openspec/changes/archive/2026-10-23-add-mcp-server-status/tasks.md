# Tasks

## 1. Capability

- [x] 1.1 Read and merge the sandbox `mcp.toml` files; answer `/api/mcp` with
      the observed state. Verify: `mcp-status.test.ts`.
- [x] 1.2 `FAKE_MAKI_TOOLS` and an isolated scripted-sandbox home. Verify: the
      suite passes with a host `~/.config/maki/mcp.toml` present;
      `make test-ui` passes.

## 2. Records

- [x] 2.1 Flip `mcp-server-status` and its route. Verify: `crosscheck.test.ts`,
      `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `bun bridge/test/discovery.ts`, `make test`, `make test-bridge`,
      `make compat`, `make lint`, `openspec validate add-mcp-server-status`.
      Verify: all exit 0.
