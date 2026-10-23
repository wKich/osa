# Tasks

## 1. Fix

- [x] 1.1 Add `bridge/src/sandbox.ts` and answer `/api/fs/list` from it;
      remove the host `readdirSync`. Verify: `fs-list.test.ts`.
- [x] 1.2 Scripted `openshell` behind `OPENSHELL_BIN` in the harness and
      `tui-discovery.sh`. Verify: `fs-list.test.ts` traces the argv (no
      `--env`, no host path); `make test-ui` passes.

## 2. Records

- [x] 2.1 Close `fs-list-reads-host-directory`; flip `fs-list-sandbox` and the
      route. Verify: `crosscheck.test.ts`, `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `bun bridge/test/discovery.ts`, `make test`, `make test-bridge`,
      `make compat`, `make lint`, `openspec validate fix-fs-list-sandbox`.
      Verify: all exit 0.
