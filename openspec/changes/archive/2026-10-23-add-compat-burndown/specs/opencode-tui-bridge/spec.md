# Spec Delta

## MODIFIED Requirements

### Requirement: Generated compatibility report
The repository SHALL keep `docs/compatibility.md` as a generated artifact with
three lenses: served routes with a status (served-live, served-faked,
deferred, unhandled), wire features with a status (verified, unverified,
degraded, buggy) and a link to the evidence or test that justifies it, and a
version matrix recording the pinned OpenCode version, Maki version, and
transport mode. The report SHALL be rendered by a script from a
machine-readable status file, and `make compat` SHALL regenerate it and exit
non-zero when the committed report differs from the regenerated output.

Every route and feature row in the status file SHALL carry a `scope` (`reachable|out-of-scope`)
and a `blockedBy` (`pin|none`). `reachable` means a route is measured in the
committed request captures or served live, and a capability is on the
translation surface for the pin;
`out-of-scope` means the pinned upstream has no counterpart or the repository
has decided not to serve it. Reachability SHALL be derived from the committed
request captures rather than assumed from the contract, and a route present in
a capture SHALL NOT be reported `out-of-scope`. `blockedBy: pin` marks a row
whose remaining gap cannot be closed without an upstream wire change.

The report SHALL render a burndown over the reachable surface before the full
tables: reachable route counts by status, reachable feature counts split by
`blockedBy`, the number of open defect-inventory entries, and up to three
reachable feature rows that are neither `verified`, nor `blockedBy: pin`, nor
`out-of-scope`. The full route and feature tables SHALL remain in the report
so every row stays auditable.

The route lens SHALL be enumerated from the pinned OpenAPI contract rather
than sampled from observed traffic: every operation the pinned contract
defines for the served API surface SHALL carry exactly one row, whatever the
bridge does with it, so a route the bridge neither implements nor answers
truthfully is reported rather than absent. A row SHALL NOT name a route the
pinned contract does not define. Each enumerated row's evidence SHALL be a
committed artifact that exists in the repository — the pinned contract itself,
or the bridge source that answers the route — so the row is auditable without
re-deriving it.

Where a feature row's evidence depends on a fixture that was authored from the
pinned upstream source rather than captured from a live run, the report SHALL
say so on that row, so a reader can tell a status proved against an observed
run from one proved against a reading of the pin. A feature row SHALL carry the
`contract-only` caveat when its evidence proves the bridge's translation
behavior but not the upstream wire shape that behavior was given.

#### Scenario: Regeneration is a no-op on a clean tree
- **WHEN** a maintainer runs `make compat` with statuses unchanged
- **THEN** the committed `docs/compatibility.md` matches the regenerated file
  and the command exits 0

#### Scenario: A status change fails the gate until the report is refreshed
- **WHEN** a test run flips a feature status (for example, a `buggy` entry
  whose fix now passes its golden test)
- **THEN** `make compat` exits non-zero, and committing the regenerated report
  makes it pass again

#### Scenario: Every row carries its evidence
- **WHEN** a maintainer reads any route or feature row in the report
- **THEN** the row links the capture, log, or test name that produced its
  status, and the version matrix names the pinned OpenCode and Maki versions
  and the sandbox transport

#### Scenario: The route lens is complete against the pin
- **WHEN** every operation the pinned OpenAPI defines for the served API
  surface is compared with the route rows in the status file
- **THEN** each pinned operation has exactly one row, and every row's route
  appears in the pinned contract

#### Scenario: A row is auditable without re-deriving it
- **WHEN** a maintainer reads an enumerated route row
- **THEN** its evidence resolves to a committed file — the pinned contract or
  the bridge source that answers the route — rather than to a measurement that
  would have to be repeated

#### Scenario: An authored fixture is visible on the row it proves
- **WHEN** a feature row's evidence consumes a fixture authored from the pinned
  upstream source rather than captured from a live run
- **THEN** the row says the wire shape is source-derived, and a reader can
  distinguish it from a row proved against an observed run

#### Scenario: Contract-only evidence is marked on the row
- **WHEN** a feature's evidence proves the bridge's translation of a wire shape
  but no live run has exercised that shape upstream
- **THEN** the row carries the `contract-only` caveat rather than claiming
  unqualified verification

#### Scenario: Every row declares its scope and blocker
- **WHEN** the status file is read
- **THEN** every route and feature row has a `scope` of `reachable` or
  `out-of-scope` and a `blockedBy` of `pin` or `none`, and a row with neither
  fails the offline suite

#### Scenario: A measured route is never out of scope
- **WHEN** a route appears in a committed TUI or bridge request capture
- **THEN** its status row reports `scope: reachable`, and a captured route
  with no row or an `out-of-scope` row fails the offline suite

#### Scenario: The burndown reports the reachable surface
- **WHEN** the report is regenerated
- **THEN** it lists reachable route counts by status, reachable feature counts
  split by `blockedBy`, the open defect count, and up to three next items, none
  of which is `verified`, `blockedBy: pin`, or `out-of-scope`

#### Scenario: Out-of-scope rows leave the denominator
- **WHEN** a route or feature is marked `out-of-scope`
- **THEN** it stays listed with its status and evidence but is excluded from
  the burndown counts and from the next-item list
