# Proposal

## Why

The route and feature matrices behind `docs/compatibility.md` were enumerated
offline in the snapshot era, without reading pinned upstream docs or source, so
they cover ~25% of the pinned contract and contain at least one row for a route
that does not exist upstream. Measured against the vendored pin: 142 `/api/*`
operations in `bridge/src/openapi-2.0.32.json`, 35 rows in
`bridge/compat/statuses.json`, 108 upstream operations with no row, and one
phantom row (`GET /api/session/{sessionID}/terminal`, absent from the pin).
Nothing in the loop detects a row whose route never existed upstream — that
finding class is named in neither the discovery skill nor the enforced
vocabulary — which is why the phantom survived.

## What Changes

- Re-derive the route enumeration from the vendored OpenAPI 2.0.32 pin (all
  `/api/*` operations) and the wire-feature enumeration from pinned Maki
  `sdk_mode.rs` v0.6.4 and pinned OpenCode `session-event.ts` at tag v2.0.32,
  then diff that enumeration against the current 35 route rows and 21 feature
  rows.
- Add a row for every upstream operation missing from `statuses.json`,
  classified `unhandled` when the bridge 404s it (the honest answer for the
  bulk of the 108) or `deferred` when the bridge answers it minimally without
  implementing the surface.
- Remove the phantom `GET /api/session/{sessionID}/terminal` row: it names a
  route absent from the pinned contract, so no status can truthfully describe
  it.
- Refresh any existing row the diff contradicts, with the pinned source line as
  its evidence.
- Name "a matrix row whose route does not exist in the pinned upstream" as a
  fourth discovery finding class in `running-feature-discovery`, so a phantom
  is caught by the loop rather than surviving it.
- Regenerate `docs/compatibility.md`. It grows from 35 route rows to roughly
  140; this is a reporting-size change only and changes no bridge behavior.

No runtime behavior changes. The bridge source, its route dispatch, and the
offline test suite are untouched; this change touches the status file, the
generated report, the discovery skill, and the evidence matrices.

## Capabilities

### New Capabilities

(none — this change re-baselines the evidence behind an existing capability; it
introduces no new observable behavior)

### Modified Capabilities

- `opencode-tui-bridge`: the "Generated compatibility report" requirement gains
  the pinned-upstream enumeration as the source of the route matrix, and the
  "Defect inventory and discovery loop" requirement gains "a matrix row absent
  from the pinned upstream" as a named discovery finding class.

## Impact

- `bridge/compat/statuses.json` — grows from 35 route rows to ~140; one row
  removed. This is the machine-readable source of the report.
- `docs/compatibility.md` — regenerated, roughly 4x the route rows.
- `scripts/gen-compat.ts` — likely unchanged (it renders whatever the status
  file holds); verified during implementation, and any change is limited to
  rendering the larger route set.
- `.opencode/skills/running-feature-discovery/SKILL.md` — two lines naming the
  phantom-row finding class.
- Evidence matrices in this change's `evidence/` directory, copied forward from
  the archived iteration-1 matrices.
- Unaffected: `bridge/src/**`, `bridge/test/**`, `bridge/defects.json`, the
  `make test` stub suite, and every security invariant in `AGENTS.md`. This
  change reads vendored upstream files and adds no network, mount, env, or
  egress surface.
