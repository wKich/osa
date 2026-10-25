# Design

## Context

See `proposal.md` — Why. Today the image and host CLI run Maki v0.6.4, the
bridge serves the OpenCode v2.0.32 contract, and the journey catalog is pinned
to that TUI. The offline suites are green, `compat-drift` reports no drift, and
`maki-drift` reports Maki v0.6.5 without changes to `src/sdk_mode.rs`,
`src/cli.rs`, or the MCP handshake. OpenShell v0.1.5 is the latest stable
release and is already installed.

The two upstream changes touch the same evidence graph: the version matrix,
route/feature statuses, journey snapshots, and live evidence. Recording the
Maki side and the OpenCode side separately would force the 67 journeys and 61
live runs to be recorded twice.

## Goals / Non-Goals

**Goals:**

- Move both pins in one coherent change and keep every compatibility claim
  tied to the new tags.
- Preserve the bridge contract while adding the OpenCode v2.1.4 operations as
  explicitly out-of-scope rows.
- Adopt the new TUI todo rendering for Maki's existing `TodoWrite` tool.
- Leave a reproducible verification path: offline suites, TUI discovery,
  journey recording, live journeys, and the generated report.

**Non-Goals:**

- Implementing client-hosted MCP, session archiving, saved-permission editing,
  voice, heap dumps, or the new-designs/free-model experiments.
- Closing any `blockedBy: pin` feature. Maki v0.6.5 does not change the SDK
  wire.
- Moving OpenShell to a pre-release.
- Reworking or revising the eight untracked plugin-relay proposals.

## Decisions

### Decision: one combined pin change

Keep the Maki bump, OpenCode rebaseline, and todo adoption in one change. The
shared artifacts are the reason: a split would either duplicate the journey
recording or leave the report claiming one pin while evidence still cites the
other.

Alternative considered: `update-maki-0.6.5` plus
`rebaseline-opencode-2.1.4`. Rejected for this request because the user asked
for one combined change and the evidence would otherwise be recorded twice.

### Decision: bump Maki first, then OpenCode

Rebuild the image at v0.6.5 before recording live journeys. The SDK surface is
unchanged, so no bridge translation work follows from this step. The only
expected Maki-side source-citation shift is the `/compact` UI line
(`maki-ui/src/app/mod.rs` L1969 → L1970); `sdk_mode.rs`, `cli.rs`,
`mcp/protocol.rs`, `plugins/bash/init.lua`, `maki-storage/src/sessions.rs`, and
`maki-lua/src/api/agent.rs` keep their cited lines.

The stricter `providers.toml` validation is checked against the repository's
generated configs: the `oskhs` writer and the live-journey harness use only
known keys. A user's hand-written host config can still fail; that is recorded
as an upgrade note, not worked around.

### Decision: re-vendor the whole OpenCode contract

Replace the vendored v2.0.32 OpenAPI document with a v2.1.4 capture and update
every consumer (`spec-answers`, contract helper, drift script, route
enumeration, bridge version). The pin is the contract; adding only the six new
operations would leave the old schemas and citations in place.

The six new operations are out-of-scope: client MCP is an opt-in experiment,
voice and heap dumps have no Maki counterpart, and saved-permission editing has
no TUI surface. No new route becomes reachable by default, so the reachable
count stays at 67. The `GET /api/session` `archived` filter and
`PATCH /api/session/{id}` `archived` field are recorded as contract-only and
not served as features.

Alternative considered: keep v2.0.32 and serve the v2.1.4 TUI opportunistically.
Rejected because the report, journeys, and citations would claim the wrong
contract.

### Decision: map tool names explicitly, not by lower-casing the first letter

OpenCode renders a fixed set of tool names specially. Maki's wire names include
camel case and acronyms (`TodoWrite`, `WebFetch`, `WebSearch`,
`CodeExecution`), so the existing first-letter lower-casing produces
`todoWrite`, `webFetch`, and so on — names the TUI treats as generic. Add an
explicit mapping for the names with dedicated renderers and keep the existing
lower-case behavior for single-word tools.

The todo path is the motivating case: OpenCode v2.1.4 parses
`name === "todowrite"` with `todos: [{ content, status }]` and renders both the
transcript block and the sidebar. Maki's `todo_write` schema already carries
exactly that input. Permission requests keep Maki's original name so the
existing answer round trip is untouched.

Alternative considered: change the TUI or post-process the rendered name in the
bridge's transcript projector. Rejected because the tool part already carries
the wire name and the mapping belongs in translation.

### Decision: re-record all journeys and live evidence at the new pins

The journey catalog is pinned to the TUI tag. The v2.1.4 default keybindings
are unchanged, so the catalog is expected to keep the same 67 journeys, but
every reference snapshot, Maki snapshot, comparison, and source citation is
re-recorded. The six unrecorded/out-of-scope journeys stay unrecorded.

Live journeys run against the v0.6.5 image after it is rebuilt. If the gateway
or image is unavailable, the change must say so and keep the old live evidence
labeled v0.6.4 rather than relabeling it; the offline suites and the generated
report remain the review gate.

### Decision: leave OpenShell at v0.1.5

v0.1.5 is the latest stable release. `v0.1.6-pre.4` changes supervisor, auth,
and Kubernetes internals; it does not address the OAuth refresh/client-auth
blocker or add a `rule get` JSON mode. Record the verification that no move is
needed; do not add a pre-release pin.

### Decision: repair the route-enumeration mismatch while re-enumerating

`enumerate-routes --diff` currently reports `GET /auth/connect/{code}` as a
phantom because the status file records a non-`/api/*` path the script excludes.
While adding the six v2.1.4 rows, either teach the script to account for that
row or remove the row with a written reason. The route enumeration must be
green at the new pin; it is not part of `make test`, so record the decision in
the change evidence.

## Risks / Trade-offs

- **Citation churn** — 37 of the 38 TUI files cited by journeys changed between
  v2.0.32 and v2.1.4. Re-read each cited file at the new tag rather than
  bulk-replacing the version string.
- **Journey snapshot churn** — the TUI's default keybindings are unchanged but
  the app shell, session route, model dialog, and exit epilogue changed. Expect
  many snapshot diffs; review semantic differences and record accepted ones
  instead of loosening normalization.
- **Todo mapping changes transcript names** — existing goldens and journeys
  that render `todoWrite` will change. Add the todo fixture and journey first,
  then update the goldens after reviewing the diff.
- **Maki `providers.toml` strictness** — generated configs are valid, but a
  user's unknown key now stops startup. The upgrade note names the file to
  check.
- **Live evidence availability** — the live run needs OpenShell, the gateway,
  Docker, OpenCode, and the rebuilt image. If any is missing, the change must
  keep the old evidence and say so.
- **Parallel plugin proposals** — eight untracked proposals target pin-blocked
  features through Maki Lua hooks and cite v0.6.4. They are not part of this
  change; after the pins move, their citations and journey/status changes must
  be refreshed against v0.6.5/v2.1.4.

## Migration Plan

1. Update the Maki image and host CLI; rebuild the image and verify
   `maki --version` and the generated `providers.toml` parse.
2. Install OpenCode v2.1.4, capture the new contract, and update the bridge
   version and route/status artifacts.
3. Update the tool-name mapping, then recapture the boot requests and TUI
   discovery captures.
4. Re-record the 67 journeys; run the 61 live journeys against the rebuilt
   image.
5. Regenerate the compatibility report and run the full verification gate.
6. Rollback: restore the v0.6.4 image/build arg and the v2.0.32 vendored
   contract, journey catalog, and snapshots from the change diff.

## Open Questions

None. The only conditional is the live-run availability, which is recorded
rather than guessed.
