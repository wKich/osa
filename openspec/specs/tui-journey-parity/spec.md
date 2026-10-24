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

### Requirement: Record a journey on both sides from one script
A recorded journey SHALL have one executable script that drives both sides:
the key input, waits on rendered screen content, checkpoint markers whose ids
match the journey's catalog checkpoints, and the model turns the journey
needs. The reference side SHALL run the real OpenCode server and TUI at the
pinned OpenCode version against a local scripted model provider that replays
those turns, in a temporary home and workdir, with no credentials and no
network beyond loopback. The Maki side SHALL run the same TUI against the
bridge, with a scripted Maki child that replays the same turns as Maki wire
frames. A model turn SHALL be one of: a text reply, optionally paced chunk by
chunk; a shell call; a tool call spelled per side, carrying the result the
pinned Maki tool returns; or a model-call failure with an HTTP status. Both
sides SHALL run with the TUI's update check disabled, so no run asks the
OpenCode release feed. A script SHALL NOT wait on fixed delays alone: every
step that depends on the TUI reacting SHALL wait for screen content or a
bounded timeout that fails the run.

#### Scenario: One script, two sides
- **WHEN** a journey with a script is recorded
- **THEN** the reference and Maki-side runs consume the same steps and model
  turns, and each produces one snapshot per catalog checkpoint

#### Scenario: Script checkpoints match the catalog
- **WHEN** a journey script names a checkpoint id that the journey's catalog
  row lacks, or misses one it has
- **THEN** the offline suite fails and names the journey

#### Scenario: The reference run needs no credentials
- **WHEN** the reference side runs
- **THEN** it reads no credential, provider key, or user configuration from
  the host, and its only network peer is the loopback scripted provider

#### Scenario: A stalled step fails instead of passing late
- **WHEN** the screen content a step waits for does not appear within its
  timeout
- **THEN** the run fails, names the journey, step, and side, and no snapshot
  or status is written for it

#### Scenario: A paced turn can be interrupted
- **WHEN** a script interrupts a paced text turn mid-stream
- **THEN** the mock provider stops streaming, and the scripted Maki child ends
  the run with the pinned cancelled result and no buffered message

#### Scenario: A failing model call follows each side's retry rule
- **WHEN** a turn answers the model call with 503 and the next turn is text
- **THEN** both sides retry into the text turn, and the scripted Maki child
  emits one `api_retry` naming `API error (503): <message>`

#### Scenario: No update check runs
- **WHEN** any journey records
- **THEN** the TUI's environment carries `OPENCODE_DISABLE_AUTOUPDATE=1` and no
  home-screen snapshot shows an update hint

### Requirement: Compare normalized text snapshots per checkpoint
Each side's terminal output SHALL be rendered by a headless terminal emulator
into a text screen at every checkpoint. Volatile tokens (ids, timestamps,
durations, ports, temporary paths, and provider and model labels) SHALL be
normalized with the same rules on both sides before comparison, and the
comparison SHALL be made per checkpoint. The reference snapshot, Maki-side
snapshot, and comparison result SHALL be committed per journey, and the
journey's status SHALL follow from the comparison: no differing checkpoint and
a completed run is `parity`, a completed run with a differing checkpoint is
`diverges`, a Maki-side run that cannot reach a checkpoint is `broken`.

#### Scenario: Status follows the committed comparison
- **WHEN** the offline suite re-compares a journey's committed snapshots
- **THEN** the result reproduces the journey's committed status, and a status
  that disagrees with its snapshots fails the suite

#### Scenario: Normalization is symmetric
- **WHEN** both sides differ only in a normalized token class
- **THEN** the checkpoint compares equal, and the same normalization rules
  were applied to both sides

#### Scenario: A real difference survives normalization
- **WHEN** a checkpoint differs in transcript content, layout, or a dialog
- **THEN** the comparison reports that checkpoint as differing and the
  journey is not `parity` unless the difference is accepted with a reason

### Requirement: Gated journey recording target
`make test-journeys` SHALL record and compare every journey that has a script,
write its snapshots, comparison, and Maki-side request log, and update the
journey's catalog status and evidence. It SHALL skip cleanly when `opencode`
or `bun` is unavailable and SHALL NOT join the default offline `make test`.
Maki-side journey request logs SHALL count as committed request captures for
route reachability.

#### Scenario: Missing tools skip cleanly
- **WHEN** `make test-journeys` runs on a host without `opencode`
- **THEN** it prints a skip message and exits 0 without changing any file

#### Scenario: Journey traffic widens the measured set
- **WHEN** a Maki-side journey log records a route whose status row is
  `out-of-scope`
- **THEN** the offline suite fails until that route is recorded `reachable`

### Requirement: Live journey comparison against real Maki
`make test-journeys-live` SHALL run every scripted journey against the OpenCode
TUI, the bridge, and the real pinned Maki binary inside an OpenShell sandbox,
render and normalize the screens with the same rules as the offline
comparison, and compare them with the journey's committed reference
snapshots. The live verdict SHALL follow the offline verdict rule and SHALL be
recorded on the journey row as live evidence: the live snapshots, the
comparison, the Maki and image versions, and the verdict. The live Maki
side SHALL run with a journey-only config that mirrors the reference
OpenCode config: the same loopback model provider, permission asking on, and
the same MCP server set (none unless the journey declares one), uploaded over
the image's baked files inside the run's sandbox. The target SHALL
skip cleanly, changing no file, when `openshell`, a reachable gateway, or the
project image is unavailable, and SHALL NOT join the default offline
`make test`.

#### Scenario: A live run records its verdict
- **WHEN** `make test-journeys-live` completes a scripted journey
- **THEN** the journey row carries live evidence with committed snapshots, a
  comparison, the Maki and image versions, and a verdict of `parity`,
  `diverges`, or `broken`

#### Scenario: Live evidence stays reproducible offline
- **WHEN** the offline suite re-compares a journey's committed live snapshots
  with its reference snapshots
- **THEN** the result reproduces the committed live verdict, and a mismatch
  fails the suite

#### Scenario: No gateway skips cleanly
- **WHEN** `make test-journeys-live` runs without a reachable OpenShell
  gateway
- **THEN** it prints a skip message, exits 0, and changes no file

#### Scenario: The live Maki side has the reference's MCP set
- **WHEN** a live journey runs in a sandbox built from an image that bakes
  MCP servers
- **THEN** the journey config replaces the baked MCP file with one that
  declares no server, and the bridge's `GET /api/mcp` lists none

### Requirement: Live runs keep the sandbox boundary
A live journey run SHALL use a dedicated sandbox created for the run from the
project image with the minimal policy and no provider attached, and SHALL
delete it when the run ends, whether it passed or failed. The scripted model
provider SHALL run inside that sandbox on its own loopback. The run SHALL NOT
add a network rule, provider profile, credential, bind mount, or `--env`
value, SHALL NOT make the host's loopback reachable from the sandbox, and
SHALL NOT use or modify any other sandbox.

#### Scenario: The run's sandbox is throwaway
- **WHEN** a live run ends, by success, failure, or interruption
- **THEN** the sandbox it created no longer exists, and no other sandbox was
  created, attached, or changed

#### Scenario: No egress is added
- **WHEN** the live run's sandbox is inspected during the run
- **THEN** its effective policy equals the minimal policy with no provider
  rules, and Maki's only model endpoint is the in-sandbox loopback provider

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
