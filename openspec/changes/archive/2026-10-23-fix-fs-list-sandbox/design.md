# Design

## Context

- OpenCode v2.0.32 TUI:
  - `tui/src/app.tsx` L218–L222 lists `process.cwd()` at startup and roots
    the data layer at `response.location.directory`.
  - `tui/src/prompt/directory-completion.ts` L14 lists subpaths for `/cd`
    completion, keeping `type === "directory"` and resolving `path` against
    `location.directory`.
- The helper starts the bridge with `OPENSHELL_BIN`, `OPENMAKI_SANDBOX` and
  `OPENMAKI_CWD` (the sandbox workdir, `bin/maki-oss` L1274–L1278). The child
  already runs through `openshell sandbox exec` (`bridge/src/maki.ts`).

## Decisions

1. **Same transport, read-only.** Sandbox reads reuse the child's exec shape
   with a fixed argv. Nothing new is mounted, uploaded or passed by
   environment.
2. **The client's directory maps onto the workdir.** The TUI's `location`
   names its host directory, which the bridge already treats as the session
   directory (design decision 5 of `add-opencode-tui-bridge`). Paths under it
   map to the same relative path in the workdir. Anything else has no meaning
   in the sandbox and lists nothing. The answer's location keeps the client's
   path, so completion resolves entries as before.
3. **No sandbox, no listing.** A `MAKI_CHILD_CMD`-only run has no sandbox, so
   it answers empty instead of falling back to a host read.
4. **The test seam is `OPENSHELL_BIN`.** The scripted openshell refuses any
   argv that is not the read shape, and that includes an `--env`.

## Risks / Trade-offs

- Each listing costs one exec round trip. The TUI lists once at startup and
  on `/cd` completion only.
