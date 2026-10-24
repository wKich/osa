## MODIFIED Requirements

### Requirement: Compare normalized text snapshots per checkpoint
Each side's terminal output SHALL be rendered by a headless terminal emulator
into a text screen at every checkpoint. Volatile tokens (ids, timestamps,
durations — including one a dialog cuts mid-unit after a footer's model —,
the padding a right-aligned clock takes from its own width, ports, temporary
paths, and provider and model labels) SHALL be normalized with the same rules
on both sides before comparison, and the
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

#### Scenario: A cut duration and a clock's padding are not differences
- **WHEN** a dialog cuts a footer's `700ms` to `700m`, or a timeline shows
  `9:59 PM` on one run and `10:05 PM` on the next
- **THEN** both normalize to the same text

#### Scenario: The footer's workdir padding is not a difference
- **WHEN** one side's footer reads `<WORKDIR>:main  2` and the other's
  `<WORKDIR>:main            2` because their workdir paths differ in length
- **THEN** both normalize to the same text

