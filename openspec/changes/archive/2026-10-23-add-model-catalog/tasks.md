# Tasks

## 1. Capability

- [x] 1.1 Read `maki models` and `maki auth status` in the sandbox; answer the
      model, provider and integration lists. Verify: `model-catalog.test.ts`.
- [x] 1.2 Hermetic scripted sandbox (`FAKE_SANDBOX_BIN`, fixed `PATH`, real
      git dir) and TERM-then-KILL on a read timeout. Verify: the suite passes
      three runs in a row with a host `maki` installed; `make test-ui` passes.

## 2. Records

- [x] 2.1 Flip `model-catalog-live` and its three routes. Verify:
      `crosscheck.test.ts`, `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `bun bridge/test/discovery.ts`, `make test`, `make test-bridge`,
      `make compat`, `make lint`, `openspec validate add-model-catalog`.
      Verify: all exit 0.
