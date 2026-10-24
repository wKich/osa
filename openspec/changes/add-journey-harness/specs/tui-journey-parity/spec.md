# Spec Delta

## ADDED Requirements

### Requirement: Record a journey on both sides from one script
A recorded journey SHALL have one executable script that drives both sides:
the key input, waits on rendered screen content, checkpoint markers whose ids
match the journey's catalog checkpoints, and the model turns the journey
needs. The reference side SHALL run the real OpenCode server and TUI at the
pinned OpenCode version against a local scripted model provider that replays
those turns, in a temporary home and workdir, with no credentials and no
network beyond loopback. The Maki side SHALL run the same TUI against the
bridge, with a scripted Maki child that replays the same turns as Maki wire
frames. A script SHALL NOT wait on fixed delays alone: every step that depends
on the TUI reacting SHALL wait for screen content or a bounded timeout that
fails the run.

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
