# Proposal

## Why

Discovery pass 6 recorded the open defect `fs-list-reads-host-directory`.
`GET /api/fs/list` read whatever host directory the TUI named in
`location[directory]`, and any absolute `path`, with `readdirSync`. That
breaks the bridge's invariant that it reads no host path on a client's
behalf. It also listed the wrong tree: the project the TUI works on lives in
the sandbox workdir.

## What Changes

- A read-only sandbox reader, `bridge/src/sandbox.ts`, builds
  `openshell sandbox exec -n <sandbox> --no-login-shell --workdir <workdir> -- <argv>`
  from the variables the helper already sets (`OPENSHELL_BIN`,
  `OPENMAKI_SANDBOX`). It never passes `--env`.
- `GET /api/fs/list` lists the sandbox workdir path that corresponds to the
  client's directory (`ls -1Ap`). A path outside that directory lists
  nothing, and without a sandbox the list is empty. The host read is removed.
- A scripted `openshell` (`bridge/test/fake-openshell.ts`) is injected
  through `OPENSHELL_BIN`, the test seam for sandbox reads. The test harness
  and `make test-ui` use it.
- Close the defect. `fs-list-sandbox` becomes `verified` and the route
  `served-live`.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: the sandbox transport requirement gains a
  sandbox-read scenario.

## Impact

`bridge/src/sandbox.ts` (new), `bridge/src/bridge.ts`,
`bridge/src/spec-answers.ts` (host read removed), test harness, a new test,
`tui-discovery.sh`, statuses, defects and the report. No bind mount, no new
binary in the sandbox (`ls` is in the image), no `--env`.
