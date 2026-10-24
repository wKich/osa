# Proposal

## Why

`change-working-directory` (`/cd sub`) on the Maki side kept the footer on
the workdir and ran the next `pwd` there: `POST /api/session/{id}/move` was
answered from the contract. OpenCode moves the session — its location,
project subpath, a durable `session.moved` and a `↳ Moved to` row (core
`session/move.ts` v2.0.32 L64–L157) — and its next turn runs in the new
directory.

## What Changes

- The move route resolves the destination against the session's directory.
  It must exist as a directory inside the sandbox workdir; otherwise the
  route refuses with the pinned messages.
- After the running turn, the bridge restarts the session's Maki child in the
  new directory, resuming the same Maki session (`-r <id>`, `src/cli.rs`
  v0.6.4 L53–L63) on the model spec it ran (`-m` or the last acked
  `set_model`; a bare announced id is no valid spec). It re-applies plan mode
  and records `session.moved` (durable) with a `location-switched` history
  row.
- A replaced child's exit no longer fails the session; Maki's cwd check
  compares against the session's directory.
- The scripted child honours `-r <id>` and reads its workdir from the child
  options.
- `change-working-directory`: recorded, `parity` offline and live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the session-move requirement.

## Impact

`bridge/src/{bridge,history,maki}.ts`, `bridge/test/{session-move.test,fake-maki}.ts`,
rows. The child still runs inside the sandbox through `openshell sandbox
exec --workdir`; no host path, `--env` value or policy change.
