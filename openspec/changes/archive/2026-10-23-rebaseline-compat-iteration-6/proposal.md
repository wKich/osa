# Proposal

## Why

`add-route-triage` made the 21 reachable `served-faked` routes a queue, but
none of them had a decision. The TUI reads synthesized data from every one of
them, and some of it is wrong in ways the user sees: a connected MCP server
that does not exist, a running shell, a `sample` branch in the footer. One
route also reads a host directory on the client's behalf.

## What Changes

- Run the discovery passes and re-read the pinned upstream sources (Maki
  v0.6.4 workspace, OpenCode v2.0.32 TUI/client) for each untriaged route.
- Copy the matrices forward from `rebaseline-compat-iteration-5` and record
  the route consumers, the sandbox-side sources and the triage, marked
  **(i6)**.
- Append three defects found in the committed TUI capture.
- Add nine feature rows (eight capability rows, one pin-blocked), link twelve
  routes to them, and accept three routes whose synthesized answer is correct.

## Impact

Records only: `bridge/compat/statuses.json`, `bridge/defects.json`, three
defect captures, the TUI captures refreshed by `make test-ui`, regenerated
`docs/compatibility.md`, evidence. No runtime, test or spec change.
