## ADDED Requirements

### Requirement: Navigation surfaces are recorded at parity
The catalog SHALL record the command palette, sidebar, status, help, debug,
theme and exit journeys with reference, offline and live snapshots.

#### Scenario: The palette runs a command
- **WHEN** the user opens the palette, filters to `sidebar` and selects it
- **THEN** both sides list the same commands and show the sidebar
