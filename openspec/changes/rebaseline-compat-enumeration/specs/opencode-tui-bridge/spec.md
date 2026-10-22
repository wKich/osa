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

The route lens SHALL be enumerated from the pinned OpenAPI contract rather
than sampled from observed traffic: every operation the pinned contract
defines for the served API surface SHALL carry exactly one row, whatever the
bridge does with it, so a route the bridge neither implements nor answers
truthfully is reported rather than absent. A row SHALL NOT name a route the
pinned contract does not define. Each enumerated row's evidence SHALL be a
committed artifact that exists in the repository — the pinned contract itself,
or the bridge source that answers the route — so the row is auditable without
re-deriving it.

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

### Requirement: Defect inventory and discovery loop
The repository SHALL maintain a machine-checkable defect inventory for the
OpenCode TUI bridge, seeded from the archived `known-defects.md` entries
(message-order inversion and synthesized model name), and SHALL provide a
scripted discovery pass that runs repeatable explorational sessions against
the bridge and appends each newly observed rendering or protocol defect with
its capture reference and a status. Each inventory entry SHALL link the
evidence that reproduces it; fixing an entry belongs to a later change, which
flips its status.

The same loop SHALL diff its recorded matrices against the pinned upstream
contract and source, and SHALL treat as a finding any matrix row whose route
or capability the pinned upstream does not define, not only rows that are
missing or that contradict a later status flip.

#### Scenario: The seed entries are present
- **WHEN** the inventory is read after this change lands
- **THEN** it contains both archived known defects with their capture
  references and a `known` status

#### Scenario: A discovery pass appends findings deterministically
- **WHEN** the scripted discovery pass runs and a session exhibits a rendering
  or protocol surprise not already listed
- **THEN** a new entry is appended with the session capture, and re-running
  without a new surprise adds nothing

#### Scenario: Inventory status feeds the report
- **WHEN** the compatibility report is generated
- **THEN** features with open inventory entries are reported as `buggy` with a
  link to the entry

#### Scenario: A matrix row naming an absent upstream route is a finding
- **WHEN** the discovery diff compares a recorded route row against the pinned
  contract and finds no such route at the pin
- **THEN** the row is reported as a finding for removal or correction, and a
  row is not left standing merely because no test references it
