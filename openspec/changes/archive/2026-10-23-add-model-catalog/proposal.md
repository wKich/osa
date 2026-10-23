# Proposal

## Why

Discovery pass 6 linked `GET /api/model`, `/api/provider` and
`/api/integration` to `model-catalog-live`. All three answered synthesized
`sample` rows:
- The model picker listed one placeholder model until a child announced its
  own.
- The provider label was `sample`.
- One phantom integration with a `sample` credential made the TUI show
  "connected".

Maki reports its real catalog and provider auth from the CLI inside the
sandbox.

## What Changes

- `readModelCatalog` (`bridge/src/sandbox.ts`) runs `maki models` and
  `maki auth status` in one sandbox exec at boot.
- The model list is the announced (else configured) model first, then the
  catalog. Providers are the union of the catalog and the auth status.
  Integrations are the env-backed providers, with their variable as the
  method and connection.
- The scripted sandbox gains `FAKE_SANDBOX_BIN`, which holds a committed
  scripted `maki` in the pinned output shapes. It also gets a fixed `PATH`,
  so no host-installed tool answers for the sandbox, and the real git binary
  (`FAKE_SANDBOX_GIT_DIR`). A timed-out read ends its transport with TERM
  before KILL, and the scripted openshell forwards it.
- `bridge/test/model-catalog.test.ts` covers it. `model-catalog-live` becomes
  `verified` and the three routes `served-live`. Tests that boot their own
  bridges get a 20s budget.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the requirement "Describe Maki's model catalog
  and provider connections".

## Impact

`bridge/src/sandbox.ts`, `bridge/src/bridge.ts`, test seams, `tui-discovery.sh`,
a new test, statuses and the report. No credential value is read. `auth status`
prints variable names, never values.
