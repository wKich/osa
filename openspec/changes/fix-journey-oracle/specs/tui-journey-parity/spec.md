# Spec Delta

## ADDED Requirements

### Requirement: The journey is the native oracle
A feature or route claim SHALL NOT be reported as native from a golden or unit
test alone. The generated compatibility report SHALL show, for every
`verified` feature, the status of the reachable journeys that exercise it, and
SHALL distinguish unit-verified features from journey-verified features. A
feature listed by any reachable journey that is `broken`, or that is
`diverges` without an accepted difference, SHALL be reported as unit-verified
only; when the journey's finding is assigned to that feature, the feature row
SHALL be `buggy` with an open defect entry instead. A feature is
journey-verified only when every reachable journey that lists it is `parity`,
or is `diverges` with every difference accepted; a feature with no reachable
journey is unit-verified only. The native parity score SHALL remain the
journey score and SHALL NOT be computed from feature or route counts.

#### Scenario: A broken journey taints its verified features
- **WHEN** a feature row is `verified` and a reachable journey that lists it
  is `broken`
- **THEN** the report does not present that feature as journey-verified, and
  the feature is either `buggy` with an open defect or explicitly marked
  unit-verified only

#### Scenario: A feature without a journey is not native
- **WHEN** a feature row is `verified` but no reachable journey lists it
- **THEN** the report labels it unit-verified only and it does not contribute
  to the native parity score

#### Scenario: All linked journeys at parity make a feature journey-verified
- **WHEN** every reachable journey that lists a feature is `parity`, or is
  `diverges` with every difference accepted
- **THEN** the report labels that feature journey-verified

### Requirement: Harness evidence is trustworthy
The reference and Maki-side runs SHALL use the pinned OpenCode version, the
same terminal size, and the same model turn script. The Maki side SHALL invoke
the bridge with the same environment the helper uses: `OPENMAKI_CWD` is the
journey's workdir and `MAKI_MODEL` is the scripted model. A harness setup
failure — version mismatch, bridge boot failure, missing binary, or PTY
failure — SHALL abort the run without writing a journey status. An unreached
Maki checkpoint SHALL save the final screen and the error, and the recorder
SHALL apply the catalog's `acceptedDiffs` by checkpoint id. The harness SHALL
NOT write evidence outside the journey directory or the run's scratch area.

#### Scenario: The OpenCode version mismatch aborts
- **WHEN** the installed OpenCode version is not the version in the journey
  catalog's pin
- **THEN** the harness exits non-zero, names both versions, and changes no
  journey status or snapshot

#### Scenario: A bridge boot failure is not a product verdict
- **WHEN** the bridge fails to listen, exits before the TUI connects, or a
  required binary is missing
- **THEN** the run aborts as a harness failure and the journey catalog is left
  unchanged

#### Scenario: An unreached checkpoint leaves evidence
- **WHEN** the Maki side cannot reach a checkpoint
- **THEN** the committed diff names the checkpoint as `unreached`, the final
  screen and error are saved beside it, and the journey is `broken`

#### Scenario: An accepted difference is applied
- **WHEN** a journey row lists an `acceptedDiff` for a checkpoint
- **THEN** the recorder passes that checkpoint's reason into the comparison,
  the checkpoint is treated as accepted, and the journey can be `parity`

#### Scenario: The harness runs the production invocation
- **WHEN** the Maki side starts the bridge
- **THEN** the bridge's canonical directory is the journey workdir and its
  model is the scripted model, so the footer and model line match the
  reference after normalization

### Requirement: Offline reproducibility gate
The offline suite SHALL re-diff every committed journey snapshot and reproduce
the row's committed status. Journey scripts SHALL name exactly the checkpoints
their catalog rows name, in the catalog's order. Maki-side journey request logs
SHALL join the measured route set. `make compat` SHALL fail while the committed
report disagrees with the catalog, statuses, or defect inventory.

#### Scenario: A status that disagrees with its snapshots fails
- **WHEN** the offline suite re-diffs a journey's committed snapshots
- **THEN** the result equals the row's committed status, and a mismatch fails
  the suite and names the journey and checkpoint

#### Scenario: Script checkpoints match the catalog
- **WHEN** a journey script names a checkpoint id the catalog row lacks, or
  misses one it has
- **THEN** the offline suite fails and names the journey

#### Scenario: Journey traffic widens the measured set
- **WHEN** a Maki-side journey log records a route whose status row is
  `out-of-scope`
- **THEN** the offline suite fails until that route is recorded `reachable`

#### Scenario: The committed report is current
- **WHEN** a journey status, evidence path, or matrix row changes
- **THEN** `make compat` exits non-zero until the regenerated report is
  committed
