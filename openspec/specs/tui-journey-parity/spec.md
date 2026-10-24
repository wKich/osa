# tui-journey-parity Specification

## Purpose

Measures how closely the OpenCode TUI driven by Maki through the bridge looks
and behaves like the OpenCode TUI driven by a real OpenCode server, one user
journey at a time, so "native" is a number with evidence rather than a claim.

## Requirements

### Requirement: Journey catalog
The repository SHALL keep a machine-readable journey catalog with one row per
user journey the OpenCode TUI offers at the pinned OpenCode version. Each row
SHALL carry a unique kebab-case `slug`, a `name`, a one-sentence
`description`, an `area`, a `scenario`, a `source` citing the OpenCode TUI
source at the pinned tag that defines the journey (a command, keybinding, or
dialog), the route and feature rows it exercises, a `scope`
(`reachable|out-of-scope`), a `blockedBy` (`pin|none`), a `status`, and
evidence. A `scenario` SHALL list ordered user steps and at least one named
checkpoint stating what the reference screen shows after a step. An
`out-of-scope` row SHALL state why. Journeys SHALL be enumerated from the
pinned TUI source, not sampled from observed traffic, and a row SHALL NOT
name a journey the pinned TUI does not offer.

#### Scenario: A catalog row is complete
- **WHEN** the offline suite reads the journey catalog
- **THEN** every row has a unique slug, a name, a description, an area, a
  scenario with ordered steps and at least one checkpoint, a source citation,
  a valid scope, blockedBy, and status, and a row missing any of them fails
  the suite

#### Scenario: Linked rows exist
- **WHEN** a journey names route or feature rows it exercises
- **THEN** each named route and feature has a row in the compatibility status
  file, and an unknown name fails the suite

#### Scenario: An out-of-scope journey says why
- **WHEN** a journey row is `out-of-scope`
- **THEN** it carries a non-empty reason, and a row without one fails the
  suite

### Requirement: Journey status measures parity with real OpenCode
A journey's `status` SHALL be one of `unrecorded` (no reference recording
yet), `referenced` (a reference recording of the real OpenCode TUI backed by a
real OpenCode server exists, and the Maki side has not been compared),
`parity` (the Maki side matches the reference at every checkpoint), `diverges`
(the Maki side completes the journey but at least one checkpoint differs), or
`broken` (the Maki side cannot complete the journey). Any status past
`unrecorded` SHALL cite a committed reference snapshot. `parity`, `diverges`,
and `broken` SHALL also cite a committed Maki-side snapshot and the comparison
result. A checkpoint difference MAY be accepted only with a written reason
explaining why the Maki-side screen is correct; `parity` SHALL NOT be reported
while an unaccepted difference remains. `blockedBy: pin` SHALL cite the pinned
upstream source that prevents closing the gap.

#### Scenario: Parity needs both sides
- **WHEN** a journey row reports `parity`
- **THEN** its evidence names a reference snapshot, a Maki-side snapshot, and
  a comparison with no unaccepted checkpoint difference, each a committed
  file, and a row lacking any of them fails the suite

#### Scenario: An unrecorded journey claims nothing
- **WHEN** a journey has no reference recording
- **THEN** its status is `unrecorded`, and any other status without a
  reference snapshot fails the suite

#### Scenario: An accepted difference carries its reason
- **WHEN** a checkpoint difference is accepted
- **THEN** the row records the checkpoint and a non-empty reason, and the
  report shows the reason beside the journey

### Requirement: Journey lens in the compatibility report
The generated compatibility report SHALL render a journey lens: a table of
every journey with slug, name, area, status, and evidence, split by scope, and
a burndown line with reachable journey counts by status and a native parity
score equal to `parity` journeys over reachable journeys. The score SHALL
exclude `out-of-scope` journeys from both numerator and denominator. The
catalog SHALL be validated by the same report generator and offline suite as
the status file, and `make compat` SHALL fail while the committed report
disagrees with the catalog.

#### Scenario: The parity score is reported
- **WHEN** the report is regenerated
- **THEN** the burndown shows reachable journey counts by status and the
  native parity score as a percentage of reachable journeys

#### Scenario: A catalog change fails the gate until the report is refreshed
- **WHEN** a journey's status changes in the catalog
- **THEN** `make compat` exits non-zero until the regenerated report is
  committed
