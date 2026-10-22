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

### Requirement: Defect inventory and discovery loop
The repository SHALL maintain a machine-checkable defect inventory for the
OpenCode TUI bridge, seeded from the archived `known-defects.md` entries
(message-order inversion and synthesized model name), and SHALL provide a
scripted discovery pass that runs repeatable explorational sessions against
the bridge and appends each newly observed rendering or protocol defect with
its capture reference and a status. Each inventory entry SHALL link the
evidence that reproduces it; fixing an entry belongs to a later change, which
flips its status.

The repository SHALL record, for every fixture the offline suite asserts
against, whether that fixture was captured from a live run or authored from
the pinned upstream source, and SHALL keep that record complete: a fixture
without a recorded provenance, or a recorded provenance naming a fixture that
no longer exists, fails the suite.

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

#### Scenario: A fixture without provenance fails the suite
- **WHEN** a fixture is added to the offline suite without recording whether it
  was captured or authored, or a recorded provenance names a removed fixture
- **THEN** the suite fails and names the fixture, so the stronger claim is
  never the silent default

#### Scenario: A coverage change declares its fixture kind
- **WHEN** a later change adds a fixture to cover a recorded-but-uncovered row
- **THEN** it records that fixture's provenance in the same change, so the
  report can keep distinguishing observed evidence from authored shapes
