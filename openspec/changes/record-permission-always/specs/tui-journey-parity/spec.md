## ADDED Requirements

### Requirement: Always-allow is recorded at parity
The catalog SHALL record `allow-permission-always` with reference, offline
and live snapshots.

#### Scenario: The second command is not asked again
- **WHEN** the user picks Always allow for `rm -f probe1.txt` and then asks
  for `rm -f probe2.txt`
- **THEN** the second command runs with no permission prompt on both sides
